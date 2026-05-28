import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";

const tempDirs: string[] = [];

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rollback-receipt-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createCliProject(): Promise<string> {
  const root = await makeTempProject();
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  await fs.writeFile(path.join(root, "workspace", "demo.txt"), "demo before\n");
  await writeJson(path.join(root, "plan.json"), {
    schema_version: "rollback-receipt.plan.v1",
    project_root: ".",
    operation_id: "cli-test",
    reason: "cli test",
    files: [{ path: "workspace/demo.txt", expected_operation: "modify" }]
  });
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CLI behavior", () => {
  it("prepare writes a receipt and exits 0, then restore restores and exits 0", async () => {
    const root = await createCliProject();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      cwd: root,
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text)
    };

    const prepareCode = await runCli(
      [
        "prepare",
        "--plan",
        "plan.json",
        "--snapshot-dir",
        ".rollback-receipt/snapshots",
        "--receipt-out",
        ".rollback-receipt/receipt.json"
      ],
      io
    );

    expect(prepareCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("ROLLBACK RECEIPT PREPARE");
    await expect(fs.stat(path.join(root, ".rollback-receipt", "receipt.json"))).resolves.toBeTruthy();

    await fs.writeFile(path.join(root, "workspace", "demo.txt"), "mutated\n");

    const restoreCode = await runCli(["restore", "--receipt", ".rollback-receipt/receipt.json"], io);

    expect(restoreCode).toBe(0);
    expect(stdout.join("")).toContain("ROLLBACK RECEIPT RESTORE");
    await expect(fs.readFile(path.join(root, "workspace", "demo.txt"), "utf8")).resolves.toBe("demo before\n");
  });

  it("missing required flags exit nonzero", async () => {
    const root = await makeTempProject();
    const stderr: string[] = [];

    const code = await runCli(["prepare"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (text: string) => stderr.push(text)
    });

    expect(code).not.toBe(0);
    expect(stderr.join("")).toContain("missing required flag");
  });

  it("invalid JSON exits nonzero", async () => {
    const root = await makeTempProject();
    await fs.writeFile(path.join(root, "plan.json"), "{ invalid json");
    const stderr: string[] = [];

    const code = await runCli(
      [
        "prepare",
        "--plan",
        "plan.json",
        "--snapshot-dir",
        ".rollback-receipt/snapshots",
        "--receipt-out",
        ".rollback-receipt/receipt.json"
      ],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (text: string) => stderr.push(text)
      }
    );

    expect(code).not.toBe(0);
    expect(stderr.join("")).toContain("invalid JSON");
  });
});

