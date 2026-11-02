import { z } from "zod";
import { exitPolicySchema } from "./exit-policy.js";
export const demoExitStateSchema = z.object({
  policy: exitPolicySchema,
  accountIdentity: z.object({ uid: z.string().regex(/^\d+$/), mainUid: z.string().regex(/^\d+$/) }).strict(),
  lastCandle: z.number().int().nonnegative(),
  highWatermark: z.number().finite().nonnegative(),
  stop: z.number().finite().nonnegative().default(0),
  pending: z.object({ requestId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/), stop: z.number().positive().finite() }).strict().nullable().default(null),
  closed: z.boolean().default(false),
}).strict();
export type DemoExitState = z.infer<typeof demoExitStateSchema>;
