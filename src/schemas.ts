import { z } from "zod";

export const expectedOperationSchema = z.enum(["modify", "delete", "replace"]);

export const rollbackPlanSchema = z
  .object({
    schema_version: z.literal("rollback-receipt.plan.v1"),
    project_root: z.string().min(1),
    operation_id: z.string().min(1),
    reason: z.string(),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            expected_operation: expectedOperationSchema
          })
          .strict()
      )
      .min(1)
  })
  .strict();

export const sha256ReceiptSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const rollbackReceiptSchema = z
  .object({
    schema_version: z.literal("rollback-receipt.receipt.v1"),
    operation_id: z.string().min(1),
    created_at: z.string().datetime(),
    project_root: z.string().min(1),
    snapshot_dir: z.string().min(1),
    reason: z.string(),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            absolute_path: z.string().min(1),
            expected_operation: expectedOperationSchema,
            snapshot_path: z.string().min(1),
            sha256: sha256ReceiptSchema,
            size_bytes: z.number().int().nonnegative()
          })
          .strict()
      )
      .min(1),
    decision: z.literal("prepared")
  })
  .strict();

export type RollbackPlan = z.infer<typeof rollbackPlanSchema>;
export type RollbackReceipt = z.infer<typeof rollbackReceiptSchema>;
export type RollbackReceiptFile = RollbackReceipt["files"][number];

