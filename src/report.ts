import type { RollbackReceipt } from "./schemas";

export function prepareReport(receipt: RollbackReceipt, receiptPath: string): string {
  return [
    "ROLLBACK RECEIPT PREPARE",
    "decision: prepared",
    `operation_id: ${receipt.operation_id}`,
    `files snapshotted: ${receipt.files.length}`,
    `receipt path: ${receiptPath}`,
    `snapshot dir: ${receipt.snapshot_dir}`,
    ""
  ].join("\n");
}

export function restoreReport(receipt: RollbackReceipt): string {
  return [
    "ROLLBACK RECEIPT RESTORE",
    "decision: restored",
    `operation_id: ${receipt.operation_id}`,
    `files restored: ${receipt.files.length}`,
    ""
  ].join("\n");
}

