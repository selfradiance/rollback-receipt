import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256File } from "../src/hash";
import { prepareFromPlanFile } from "../src/snapshot";

const tempDirs: string[] = [];

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rollback-receipt-snapshot-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function plan(files: Array<{ path: string; expected_operation: "modify" | "delete" | "replace" }>) {
  return {
    schema_version: "rollback-receipt.plan.v1",
    project_root: ".",
    operation_id: "test-operation",
    reason: "test",
    files
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("prepare behavior", () => {
  it("snapshots listed regular files, sorts receipt entries, and records matching hashes", async () => {
    const root = await makeTempProject();
    await fs.mkdir(path.join(root, "workspace"), { recursive: true });
    await fs.writeFile(path.join(root, "workspace", "b.txt"), "bravo\n");
    await fs.writeFile(path.join(root, "workspace", "a.txt"), "alpha\n");
    const planPath = path.join(root, "plan.json");
    await writeJson(
      planPath,
      plan([
        { path: "workspace/b.txt", expected_operation: "modify" },
        { path: "workspace/a.txt", expected_operation: "delete" }
      ])
    );

    const result = await prepareFromPlanFile({
      planPath: "plan.json",
      snapshotDir: ".rollback-receipt/snapshots",
      receiptOut: ".rollback-receipt/receipt.json",
      cwd: root,
      createdAt: new Date("2026-05-28T00:00:00.000Z")
    });

    expect(result.receipt.files.map((file) => file.path)).toEqual(["workspace/a.txt", "workspace/b.txt"]);

    const firstEntry = result.receipt.files[0];
    const sourceHash = await sha256File(path.join(root, "workspace", "a.txt"));
    expect(firstEntry.sha256).toBe(sourceHash.sha256);
    expect(firstEntry.size_bytes).toBe(sourceHash.sizeBytes);
    await expect(fs.readFile(firstEntry.snapshot_path, "utf8")).resolves.toBe("alpha\n");

    const receiptOnDisk = JSON.parse(await fs.readFile(path.join(root, ".rollback-receipt", "receipt.json"), "utf8"));
    expect(receiptOnDisk).toEqual(result.receipt);
  });

  it("rejects a missing listed file", async () => {
    const root = await makeTempProject();
    const planPath = path.join(root, "plan.json");
    await writeJson(planPath, plan([{ path: "missing.txt", expected_operation: "modify" }]));

    await expect(
      prepareFromPlanFile({
        planPath: "plan.json",
        snapshotDir: ".rollback-receipt/snapshots",
        receiptOut: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/missing/);
  });

  it("rejects a directory instead of a regular file", async () => {
    const root = await makeTempProject();
    await fs.mkdir(path.join(root, "workspace"), { recursive: true });
    const planPath = path.join(root, "plan.json");
    await writeJson(planPath, plan([{ path: "workspace", expected_operation: "replace" }]));

    await expect(
      prepareFromPlanFile({
        planPath: "plan.json",
        snapshotDir: ".rollback-receipt/snapshots",
        receiptOut: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/regular file/);
  });

  it("blocks receipt-out overwrite of plan, listed files, hardlinks, and symlinks", async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, "target.txt"), "target\n");
    const planPath = path.join(root, "plan.json");
    await writeJson(planPath, plan([{ path: "target.txt", expected_operation: "modify" }]));

    await expect(
      prepareFromPlanFile({
        planPath: "plan.json",
        snapshotDir: ".rollback-receipt/snapshots",
        receiptOut: "plan.json",
        cwd: root
      })
    ).rejects.toThrow(/receipt-out/);

    await expect(
      prepareFromPlanFile({
        planPath: "plan.json",
        snapshotDir: ".rollback-receipt/snapshots",
        receiptOut: "target.txt",
        cwd: root
      })
    ).rejects.toThrow(/receipt-out/);

    const hardlinkPath = path.join(root, "hardlink-receipt.json");
    await fs.link(path.join(root, "target.txt"), hardlinkPath);
    await expect(
      prepareFromPlanFile({
        planPath: "plan.json",
        snapshotDir: ".rollback-receipt/snapshots",
        receiptOut: "hardlink-receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/hardlink/);

    const symlinkPath = path.join(root, "symlink-receipt.json");
    await fs.symlink(path.join(root, "target.txt"), symlinkPath);
    await expect(
      prepareFromPlanFile({
        planPath: "plan.json",
        snapshotDir: ".rollback-receipt/snapshots",
        receiptOut: "symlink-receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/symlink/);
  });
});

