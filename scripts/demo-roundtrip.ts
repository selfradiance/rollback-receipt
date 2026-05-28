import { promises as fs } from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli";

const DEMO_CONTENT = "Demo workspace file before agent mutation.\n";
const NOTES_CONTENT = "Notes file before deletion-style mutation.\n";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const workspaceDir = path.join(cwd, "examples", "workspace");
  const demoPath = path.join(workspaceDir, "demo.txt");
  const notesPath = path.join(workspaceDir, "notes.txt");

  await fs.rm(path.join(cwd, ".rollback-receipt"), { recursive: true, force: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(demoPath, DEMO_CONTENT);
  await fs.writeFile(notesPath, NOTES_CONTENT);

  const io = {
    cwd,
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text)
  };

  const prepareCode = await runCli(
    [
      "prepare",
      "--plan",
      "examples/mutation-plan.json",
      "--snapshot-dir",
      ".rollback-receipt/snapshots",
      "--receipt-out",
      ".rollback-receipt/prepare-receipt.json"
    ],
    io
  );
  if (prepareCode !== 0) {
    throw new Error(`prepare failed with exit code ${prepareCode}`);
  }

  await fs.writeFile(demoPath, "Mutated by demo roundtrip.\n");
  await fs.rm(notesPath);

  const restoreCode = await runCli(["restore", "--receipt", ".rollback-receipt/prepare-receipt.json"], io);
  if (restoreCode !== 0) {
    throw new Error(`restore failed with exit code ${restoreCode}`);
  }

  const restoredDemo = await fs.readFile(demoPath, "utf8");
  const restoredNotes = await fs.readFile(notesPath, "utf8");

  if (restoredDemo !== DEMO_CONTENT || restoredNotes !== NOTES_CONTENT) {
    throw new Error("roundtrip verification failed");
  }

  process.stdout.write("RESULT: SUCCESS\n");
}

await main();

