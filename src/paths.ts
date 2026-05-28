import { promises as fs } from "node:fs";
import path from "node:path";
import { RollbackReceiptError } from "./types";

const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;

export function normalizeRelativeFilePath(input: string): string {
  if (input.length === 0) {
    throw new RollbackReceiptError("file path must not be empty");
  }

  if (input.includes("\0")) {
    throw new RollbackReceiptError(`file path contains a null byte: ${input}`);
  }

  if (
    input.startsWith("\\") ||
    input.startsWith("/") ||
    path.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    WINDOWS_DRIVE_PREFIX.test(input)
  ) {
    throw new RollbackReceiptError(`file path must be relative: ${input}`);
  }

  const withForwardSlashes = input.replace(/\\/g, "/");
  const normalized = path.posix.normalize(withForwardSlashes);

  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new RollbackReceiptError(`file path escapes project root: ${input}`);
  }

  if (normalized.startsWith("/")) {
    throw new RollbackReceiptError(`file path must be relative: ${input}`);
  }

  return normalized;
}

export function assertPathInside(basePath: string, candidatePath: string, label = "path"): void {
  const relative = path.relative(basePath, candidatePath);
  if (relative === "") {
    return;
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RollbackReceiptError(`${label} escapes allowed directory: ${candidatePath}`);
  }
}

export async function resolveProjectRoot(projectRoot: string, cwd = process.cwd()): Promise<string> {
  const absolute = path.resolve(cwd, projectRoot);
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch (error) {
    throw new RollbackReceiptError(`project_root does not exist: ${projectRoot}`);
  }

  const stats = await fs.lstat(real);
  if (!stats.isDirectory()) {
    throw new RollbackReceiptError(`project_root is not a directory: ${projectRoot}`);
  }

  return real;
}

export function resolveSafeRelativePath(projectRootReal: string, relativePath: string): string {
  const normalized = normalizeRelativeFilePath(relativePath);
  const absolute = path.resolve(projectRootReal, normalized);
  assertPathInside(projectRootReal, absolute, `file path ${relativePath}`);
  return absolute;
}

export async function assertNoSymlinkSegments(
  baseReal: string,
  targetAbs: string,
  options: { allowMissing?: boolean; label?: string } = {}
): Promise<void> {
  assertPathInside(baseReal, targetAbs, options.label ?? "path");

  const relative = path.relative(baseReal, targetAbs);
  if (relative === "") {
    return;
  }

  let current = baseReal;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await fs.lstat(current);
    } catch (error) {
      if (options.allowMissing && isNodeError(error, "ENOENT")) {
        return;
      }
      throw new RollbackReceiptError(`${options.label ?? "path"} does not exist: ${current}`);
    }

    if (stats.isSymbolicLink()) {
      throw new RollbackReceiptError(`${options.label ?? "path"} contains a symlink: ${current}`);
    }
  }
}

export async function assertRegularFileNoSymlink(filePath: string, label = "file"): Promise<void> {
  let stats;
  try {
    stats = await fs.lstat(filePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new RollbackReceiptError(`${label} is missing: ${filePath}`);
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new RollbackReceiptError(`${label} is a symlink: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new RollbackReceiptError(`${label} is not a regular file: ${filePath}`);
  }
}

export async function ensureRestoreParentDirectory(projectRootReal: string, targetAbs: string): Promise<void> {
  assertPathInside(projectRootReal, targetAbs, "restore target");
  const parent = path.dirname(targetAbs);
  assertPathInside(projectRootReal, parent, "restore parent directory");
  await assertNoSymlinkSegments(projectRootReal, parent, {
    allowMissing: true,
    label: "restore parent directory"
  });
  await fs.mkdir(parent, { recursive: true });
  await assertNoSymlinkSegments(projectRootReal, parent, {
    label: "restore parent directory"
  });

  const stats = await fs.lstat(parent);
  if (!stats.isDirectory()) {
    throw new RollbackReceiptError(`restore parent is not a directory: ${parent}`);
  }
}

export function requireAbsolutePath(input: string, label: string): string {
  if (!path.isAbsolute(input)) {
    throw new RollbackReceiptError(`${label} must be absolute: ${input}`);
  }
  return path.resolve(input);
}

export async function lstatIfExists(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

