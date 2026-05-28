import { randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { sha256File } from "./hash";
import {
  assertNoSymlinkSegments,
  assertPathInside,
  assertRegularFileNoSymlink,
  isNodeError,
  lstatIfExists,
  normalizeRelativeFilePath,
  resolveProjectRoot,
  resolveSafeRelativePath
} from "./paths";
import { prepareReport } from "./report";
import { rollbackPlanSchema, type RollbackPlan, type RollbackReceipt } from "./schemas";
import { RollbackReceiptError } from "./types";

export interface PrepareFromPlanFileOptions {
  planPath: string;
  snapshotDir: string;
  receiptOut: string;
  cwd?: string;
  createdAt?: Date;
}

export interface PrepareResult {
  receipt: RollbackReceipt;
  receiptPath: string;
  report: string;
}

interface ValidatedSourceFile {
  path: string;
  absolutePath: string;
  expectedOperation: RollbackPlan["files"][number]["expected_operation"];
  sha256: string;
  sizeBytes: number;
}

export async function prepareFromPlanFile(options: PrepareFromPlanFileOptions): Promise<PrepareResult> {
  const cwd = options.cwd ?? process.cwd();
  const planPathAbs = path.resolve(cwd, options.planPath);
  const planJson = await readJsonFile(planPathAbs, "plan");
  const plan = rollbackPlanSchema.parse(planJson);
  return preparePlan(plan, {
    planPathAbs,
    snapshotDir: options.snapshotDir,
    receiptOut: options.receiptOut,
    cwd,
    createdAt: options.createdAt
  });
}

export async function preparePlan(
  plan: RollbackPlan,
  options: Omit<PrepareFromPlanFileOptions, "planPath"> & { planPathAbs: string }
): Promise<PrepareResult> {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = await resolveProjectRoot(plan.project_root, cwd);
  const receiptPath = path.resolve(cwd, options.receiptOut);
  const normalizedFiles = validateAndSortPlanFiles(plan.files);

  const sourceFiles: ValidatedSourceFile[] = [];
  for (const file of normalizedFiles) {
    const targetAbs = resolveSafeRelativePath(projectRoot, file.path);
    await assertNoSymlinkSegments(projectRoot, targetAbs, {
      label: `target file ${file.path}`
    });
    await assertRegularFileNoSymlink(targetAbs, `target file ${file.path}`);
    const targetReal = await fs.realpath(targetAbs);
    assertPathInside(projectRoot, targetReal, `target file ${file.path}`);

    const sourceHash = await sha256File(targetAbs);
    sourceFiles.push({
      path: file.path,
      absolutePath: targetReal,
      expectedOperation: file.expected_operation,
      sha256: sourceHash.sha256,
      sizeBytes: sourceHash.sizeBytes
    });
  }

  await assertReceiptOutIsSafe(receiptPath, [
    options.planPathAbs,
    ...sourceFiles.map((file) => file.absolutePath)
  ]);

  const snapshotBase = path.resolve(cwd, options.snapshotDir);
  await fs.mkdir(snapshotBase, { recursive: true });
  const snapshotBaseReal = await fs.realpath(snapshotBase);
  const operationSnapshotDir = await createUniqueSnapshotDirectory(snapshotBaseReal, plan.operation_id);

  const receiptFiles: RollbackReceipt["files"] = [];
  for (const sourceFile of sourceFiles) {
    const snapshotPath = path.resolve(operationSnapshotDir, sourceFile.path);
    assertPathInside(operationSnapshotDir, snapshotPath, `snapshot path ${sourceFile.path}`);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.copyFile(sourceFile.absolutePath, snapshotPath, constants.COPYFILE_EXCL);
    await assertRegularFileNoSymlink(snapshotPath, `snapshot file ${sourceFile.path}`);

    const snapshotHash = await sha256File(snapshotPath);
    if (snapshotHash.sha256 !== sourceFile.sha256) {
      throw new RollbackReceiptError(`snapshot hash mismatch for ${sourceFile.path}`);
    }

    receiptFiles.push({
      path: sourceFile.path,
      absolute_path: sourceFile.absolutePath,
      expected_operation: sourceFile.expectedOperation,
      snapshot_path: await fs.realpath(snapshotPath),
      sha256: sourceFile.sha256,
      size_bytes: sourceFile.sizeBytes
    });
  }

  const receipt: RollbackReceipt = {
    schema_version: "rollback-receipt.receipt.v1",
    operation_id: plan.operation_id,
    created_at: (options.createdAt ?? new Date()).toISOString(),
    project_root: projectRoot,
    snapshot_dir: operationSnapshotDir,
    reason: plan.reason,
    files: receiptFiles,
    decision: "prepared"
  };

  await writeJsonAtomically(receiptPath, receipt);

  return {
    receipt,
    receiptPath,
    report: prepareReport(receipt, receiptPath)
  };
}

function validateAndSortPlanFiles(files: RollbackPlan["files"]): RollbackPlan["files"] {
  const seen = new Set<string>();
  const normalized = files.map((file) => ({
    ...file,
    path: normalizeRelativeFilePath(file.path)
  }));

  for (const file of normalized) {
    if (seen.has(file.path)) {
      throw new RollbackReceiptError(`duplicate file path in plan: ${file.path}`);
    }
    seen.add(file.path);
  }

  return [...normalized].sort((a, b) => a.path.localeCompare(b.path));
}

async function createUniqueSnapshotDirectory(snapshotBaseReal: string, operationId: string): Promise<string> {
  const baseName = sanitizeOperationId(operationId);
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${String(index + 1).padStart(3, "0")}`;
    const candidate = path.join(snapshotBaseReal, `${baseName}${suffix}`);
    assertPathInside(snapshotBaseReal, candidate, "snapshot directory");
    try {
      await fs.mkdir(candidate);
      const real = await fs.realpath(candidate);
      assertPathInside(snapshotBaseReal, real, "snapshot directory");
      return real;
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        continue;
      }
      throw error;
    }
  }

  const fallback = path.join(snapshotBaseReal, `${baseName}-${randomBytes(4).toString("hex")}`);
  assertPathInside(snapshotBaseReal, fallback, "snapshot directory");
  await fs.mkdir(fallback);
  const real = await fs.realpath(fallback);
  assertPathInside(snapshotBaseReal, real, "snapshot directory");
  return real;
}

function sanitizeOperationId(operationId: string): string {
  const sanitized = operationId.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 80);
  return sanitized.length > 0 ? sanitized : "operation";
}

async function assertReceiptOutIsSafe(receiptPath: string, protectedPaths: string[]): Promise<void> {
  for (const protectedPath of protectedPaths) {
    if (path.resolve(receiptPath) === path.resolve(protectedPath)) {
      throw new RollbackReceiptError(`receipt-out must not overwrite input file: ${receiptPath}`);
    }
  }

  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  const receiptStats = await lstatIfExists(receiptPath);
  if (!receiptStats) {
    return;
  }

  if (receiptStats.isSymbolicLink()) {
    throw new RollbackReceiptError(`receipt-out must not be a symlink: ${receiptPath}`);
  }

  if (receiptStats.isDirectory()) {
    throw new RollbackReceiptError(`receipt-out must not be a directory: ${receiptPath}`);
  }

  const receiptReal = await fs.realpath(receiptPath);
  for (const protectedPath of protectedPaths) {
    const protectedStats = await fs.lstat(protectedPath);
    if (receiptStats.dev === protectedStats.dev && receiptStats.ino === protectedStats.ino) {
      throw new RollbackReceiptError(`receipt-out must not hardlink to input file: ${receiptPath}`);
    }

    const protectedReal = await fs.realpath(protectedPath);
    if (receiptReal === protectedReal) {
      throw new RollbackReceiptError(`receipt-out must not overwrite input file: ${receiptPath}`);
    }
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const parent = path.dirname(filePath);
  await fs.mkdir(parent, { recursive: true });
  const tempPath = path.join(parent, `.rollback-receipt-write-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}.tmp`);
  const json = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await fs.writeFile(tempPath, json, { flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new RollbackReceiptError(`unable to read ${label}: ${filePath}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new RollbackReceiptError(`invalid JSON in ${label}: ${filePath}`);
  }
}

