import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restoreFromReceiptFile } from "../src/restore";
import { prepareFromPlanFile } from "../src/snapshot";

const tempDirs: string[] = [];

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rollback-receipt-restore-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createPreparedProject(): Promise<string> {
  const root = await makeTempProject();
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  await fs.writeFile(path.join(root, "workspace", "demo.txt"), "original demo\n");
  await fs.writeFile(path.join(root, "workspace", "notes.txt"), "original notes\n");
  await fs.writeFile(path.join(root, "workspace", "unlisted.txt"), "leave me alone\n");
  await writeJson(path.join(root, "plan.json"), {
    schema_version: "rollback-receipt.plan.v1",
    project_root: ".",
    operation_id: "restore-test",
    reason: "test restore",
    files: [
      { path: "workspace/demo.txt", expected_operation: "modify" },
      { path: "workspace/notes.txt", expected_operation: "delete" }
    ]
  });

  await prepareFromPlanFile({
    planPath: "plan.json",
    snapshotDir: ".rollback-receipt/snapshots",
    receiptOut: ".rollback-receipt/receipt.json",
    cwd: root
  });

  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("restore behavior", () => {
  it("restores mutated and deleted listed files from snapshot", async () => {
    const root = await createPreparedProject();
    await fs.writeFile(path.join(root, "workspace", "demo.txt"), "mutated\n");
    await fs.rm(path.join(root, "workspace", "notes.txt"));

    const result = await restoreFromReceiptFile({
      receiptPath: ".rollback-receipt/receipt.json",
      cwd: root
    });

    expect(result.receipt.files).toHaveLength(2);
    await expect(fs.readFile(path.join(root, "workspace", "demo.txt"), "utf8")).resolves.toBe("original demo\n");
    await expect(fs.readFile(path.join(root, "workspace", "notes.txt"), "utf8")).resolves.toBe("original notes\n");
  });

  it("rejects a missing snapshot file", async () => {
    const root = await createPreparedProject();
    const receipt = JSON.parse(await fs.readFile(path.join(root, ".rollback-receipt", "receipt.json"), "utf8"));
    await fs.rm(receipt.files[0].snapshot_path);

    await expect(
      restoreFromReceiptFile({
        receiptPath: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/does not exist|missing/);
  });

  it("rejects a snapshot hash mismatch", async () => {
    const root = await createPreparedProject();
    const receipt = JSON.parse(await fs.readFile(path.join(root, ".rollback-receipt", "receipt.json"), "utf8"));
    await fs.writeFile(receipt.files[0].snapshot_path, "tampered\n");

    await expect(
      restoreFromReceiptFile({
        receiptPath: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/hash mismatch/);
  });

  it("rejects tampered receipt path fields that are not contained and exact", async () => {
    const root = await createPreparedProject();
    const receiptPath = path.join(root, ".rollback-receipt", "receipt.json");
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    const originalAbsolutePath = receipt.files[0].absolute_path;

    receipt.files[0].absolute_path = "workspace/demo.txt";
    await writeJson(receiptPath, receipt);
    await expect(
      restoreFromReceiptFile({
        receiptPath: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/absolute_path/);

    receipt.files[0].absolute_path = originalAbsolutePath;
    receipt.files[0].snapshot_path = path.join(await fs.realpath(root), "outside-snapshot.txt");
    await fs.writeFile(receipt.files[0].snapshot_path, "original demo\n");
    await writeJson(receiptPath, receipt);
    await expect(
      restoreFromReceiptFile({
        receiptPath: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/snapshot_path.*escapes/);
  });

  it("rejects restoring over a symlink target", async () => {
    const root = await createPreparedProject();
    const outsidePath = path.join(root, "outside.txt");
    const targetPath = path.join(root, "workspace", "demo.txt");
    await fs.writeFile(outsidePath, "outside stays unchanged\n");
    await fs.rm(targetPath);
    await fs.symlink(outsidePath, targetPath);

    await expect(
      restoreFromReceiptFile({
        receiptPath: ".rollback-receipt/receipt.json",
        cwd: root
      })
    ).rejects.toThrow(/restore target is a symlink/);
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
  });

  it("uses temp-then-rename restore and does not touch unlisted files", async () => {
    const root = await createPreparedProject();
    await fs.writeFile(path.join(root, "workspace", "demo.txt"), "mutated\n");
    await fs.writeFile(path.join(root, "workspace", "unlisted.txt"), "changed but unlisted\n");

    await restoreFromReceiptFile({
      receiptPath: ".rollback-receipt/receipt.json",
      cwd: root
    });

    const workspaceFiles = await fs.readdir(path.join(root, "workspace"));
    expect(workspaceFiles.some((file) => file.startsWith(".rollback-receipt-restore-"))).toBe(false);
    await expect(fs.readFile(path.join(root, "workspace", "demo.txt"), "utf8")).resolves.toBe("original demo\n");
    await expect(fs.readFile(path.join(root, "workspace", "unlisted.txt"), "utf8")).resolves.toBe("changed but unlisted\n");
  });
});
