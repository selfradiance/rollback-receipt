export type ExpectedOperation = "modify" | "delete" | "replace";

export class RollbackReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackReceiptError";
  }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CliOutput = (text: string) => void;

export interface CliRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: CliOutput;
  stderr?: CliOutput;
}

