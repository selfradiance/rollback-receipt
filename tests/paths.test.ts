import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoSymlinkSegments,
  resolveProjectRoot,
  resolveSafeRelativePath
} from "../src/paths";

const tempDirs: string[] = [];

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rollback-receipt-paths-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("path safety", () => {
  it("accepts a normal relative path inside project root", async () => {
    const root = await makeTempProject();
    const projectRoot = await resolveProjectRoot(".", root);

    const resolved = resolveSafeRelativePath(projectRoot, "src/demo.txt");

    expect(resolved).toBe(path.join(projectRoot, "src", "demo.txt"));
  });

  it("rejects an absolute path", async () => {
    const root = await makeTempProject();
    const projectRoot = await resolveProjectRoot(".", root);

    expect(() => resolveSafeRelativePath(projectRoot, path.join(root, "file.txt"))).toThrow(/relative/);
  });

  it("rejects traversal outside project root", async () => {
    const root = await makeTempProject();
    const projectRoot = await resolveProjectRoot(".", root);

    expect(() => resolveSafeRelativePath(projectRoot, "../outside.txt")).toThrow(/escapes project root/);
  });

  it("rejects rooted backslash and UNC-style paths", async () => {
    const root = await makeTempProject();
    const projectRoot = await resolveProjectRoot(".", root);

    expect(() => resolveSafeRelativePath(projectRoot, "\\tmp\\file.txt")).toThrow(/relative/);
    expect(() => resolveSafeRelativePath(projectRoot, "\\\\server\\share\\file.txt")).toThrow(/relative/);
  });

  it("rejects symlink path segments and symlink final targets", async () => {
    const root = await makeTempProject();
    const projectRoot = await resolveProjectRoot(".", root);
    await fs.mkdir(path.join(root, "real", "inner"), { recursive: true });
    await fs.writeFile(path.join(root, "real", "inner", "file.txt"), "content\n");

    await fs.symlink(path.join(root, "real"), path.join(root, "linked-dir"), "dir");
    await fs.symlink(path.join(root, "real", "inner", "file.txt"), path.join(root, "linked-file.txt"));

    await expect(
      assertNoSymlinkSegments(projectRoot, path.join(projectRoot, "linked-dir", "inner", "file.txt"), {
        label: "target file"
      })
    ).rejects.toThrow(/symlink/);

    await expect(
      assertNoSymlinkSegments(projectRoot, path.join(projectRoot, "linked-file.txt"), {
        label: "target file"
      })
    ).rejects.toThrow(/symlink/);
  });
});

