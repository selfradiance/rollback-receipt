import { randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { sha256File } from "./hash";
import {
  assertNoSymlinkSegments,
  assertPathInside,
  assertRegularFileNoSymlink,
  ensureRestoreParentDirectory,
  lstatIfExists,
  normalizeRelativeFilePath,
  requireAbsolutePath,
  resolveSafeRelativePath
} from "./paths";
import { restoreReport } from "./report";
import { rollbackReceiptSchema, type RollbackReceipt } from "./schemas";
import { RollbackReceiptError } from "./types";

export interface RestoreFromReceiptFileOptions {
  receiptPath: string;
  cwd?: string;
}

export interface RestoreResult {
  receipt: RollbackReceipt;
  report: string;
}

export async function restoreFromReceiptFile(options: RestoreFromReceiptFileOptions): Promise<RestoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const receiptPathAbs = path.resolve(cwd, options.receiptPath);
  const receiptJson = await readJsonFile(receiptPathAbs, "receipt");
  const receipt = rollbackReceiptSchema.parse(receiptJson);
  return restoreReceipt(receipt);
}

export async function restoreReceipt(receipt: RollbackReceipt): Promise<RestoreResult> {
  const projectRootPath = requireAbsolutePath(receipt.project_root, "receipt project_root");
  const projectRootReal = await fs.realpath(projectRootPath);
  if (projectRootPath !== projectRootReal) {
    throw new RollbackReceiptError(`receipt project_root is not a real path: ${receipt.project_root}`);
  }

  const projectRootStats = await fs.lstat(projectRootReal);
  if (!projectRootStats.isDirectory()) {
    throw new RollbackReceiptError(`receipt project_root is not a directory: ${receipt.project_root}`);
  }

  const snapshotDirPath = requireAbsolutePath(receipt.snapshot_dir, "receipt snapshot_dir");
  const snapshotDirReal = await fs.realpath(snapshotDirPath);
  if (snapshotDirPath !== snapshotDirReal) {
    throw new RollbackReceiptError(`receipt snapshot_dir is not a real path: ${receipt.snapshot_dir}`);
  }

  const snapshotDirStats = await fs.lstat(snapshotDirReal);
  if (!snapshotDirStats.isDirectory()) {
    throw new RollbackReceiptError(`receipt snapshot_dir is not a directory: ${receipt.snapshot_dir}`);
  }

  for (const file of receipt.files) {
    const normalizedPath = normalizeRelativeFilePath(file.path);
    if (normalizedPath !== file.path) {
      throw new RollbackReceiptError(`receipt file path is not normalized: ${file.path}`);
    }

    const targetAbs = resolveSafeRelativePath(projectRootReal, file.path);
    if (path.resolve(file.absolute_path) !== targetAbs) {
      throw new RollbackReceiptError(`receipt absolute_path does not match path: ${file.path}`);
    }

    const snapshotPath = requireAbsolutePath(file.snapshot_path, `receipt snapshot_path ${file.path}`);
    assertPathInside(snapshotDirReal, snapshotPath, `snapshot_path ${file.path}`);
    await assertNoSymlinkSegments(snapshotDirReal, snapshotPath, {
      label: `snapshot_path ${file.path}`
    });
    await assertRegularFileNoSymlink(snapshotPath, `snapshot file ${file.path}`);
    const snapshotReal = await fs.realpath(snapshotPath);
    assertPathInside(snapshotDirReal, snapshotReal, `snapshot_path ${file.path}`);

    const snapshotHash = await sha256File(snapshotPath);
    if (snapshotHash.sha256 !== file.sha256) {
      throw new RollbackReceiptError(`snapshot hash mismatch for ${file.path}`);
    }

    await restoreFileAtomically(snapshotPath, targetAbs, projectRootReal);

    const targetHash = await sha256File(targetAbs);
    if (targetHash.sha256 !== file.sha256) {
      throw new RollbackReceiptError(`restored target hash mismatch for ${file.path}`);
    }
  }

  return {
    receipt,
    report: restoreReport(receipt)
  };
}

async function restoreFileAtomically(snapshotPath: string, targetAbs: string, projectRootReal: string): Promise<void> {
  await ensureRestoreParentDirectory(projectRootReal, targetAbs);

  const existingTarget = await lstatIfExists(targetAbs);
  if (existingTarget?.isSymbolicLink()) {
    throw new RollbackReceiptError(`restore target is a symlink: ${targetAbs}`);
  }

  if (existingTarget && !existingTarget.isFile()) {
    throw new RollbackReceiptError(`restore target is not a regular file: ${targetAbs}`);
  }

  const parent = path.dirname(targetAbs);
  const tempPath = path.join(parent, `.rollback-receipt-restore-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}.tmp`);

  try {
    await fs.copyFile(snapshotPath, tempPath, constants.COPYFILE_EXCL);
    await fs.rename(tempPath, targetAbs);
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

