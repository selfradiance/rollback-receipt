import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { restoreFromReceiptFile } from "./restore";
import { prepareFromPlanFile } from "./snapshot";
import { RollbackReceiptError, type CliRunOptions, UsageError } from "./types";

type FlagMap = Record<string, string>;

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text: string) => process.stderr.write(text));

  if (shouldSkipNpmInstallPrepareLifecycle(argv, env)) {
    stdout("rollback-receipt prepare lifecycle skipped during npm install\n");
    return 0;
  }

  try {
    const [command, ...rest] = argv;
    if (!command) {
      throw new UsageError("missing command: expected prepare or restore");
    }

    if (command === "prepare") {
      const flags = parseFlags(rest);
      const result = await prepareFromPlanFile({
        planPath: requiredFlag(flags, "plan"),
        snapshotDir: requiredFlag(flags, "snapshot-dir"),
        receiptOut: requiredFlag(flags, "receipt-out"),
        cwd
      });
      stdout(result.report);
      return 0;
    }

    if (command === "restore") {
      const flags = parseFlags(rest);
      const result = await restoreFromReceiptFile({
        receiptPath: requiredFlag(flags, "receipt"),
        cwd
      });
      stdout(result.report);
      return 0;
    }

    throw new UsageError(`unknown command: ${command}`);
  } catch (error) {
    stderr(`ERROR: ${formatError(error)}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

function parseFlags(args: string[]): FlagMap {
  const flags: FlagMap = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new UsageError(`unexpected argument: ${token}`);
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 2) {
      const key = token.slice(2, equalsIndex);
      flags[key] = token.slice(equalsIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const value = args[index + 1];
    if (!key || value === undefined || value.startsWith("--")) {
      throw new UsageError(`missing value for --${key}`);
    }
    flags[key] = value;
    index += 1;
  }

  return flags;
}

function requiredFlag(flags: FlagMap, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new UsageError(`missing required flag --${name}`);
  }
  return value;
}

function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    return `schema validation failed: ${error.issues.map((issue) => issue.message).join("; ")}`;
  }

  if (error instanceof RollbackReceiptError || error instanceof UsageError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function shouldSkipNpmInstallPrepareLifecycle(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return (
    argv.length === 1 &&
    argv[0] === "prepare" &&
    env.npm_lifecycle_event === "prepare" &&
    env.npm_command === "install"
  );
}

const directRunPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (directRunPath && fileURLToPath(import.meta.url) === directRunPath) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

