import type { DemoBuyRequest, DemoBuyResult, OkxDemoExecutor } from "./okx-demo.js";

/** Serializes Demo orders and enforces a minimum spacing between requests. */
export class ExecutionQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastExecutionAt = 0;

  constructor(
    private readonly executor: Pick<OkxDemoExecutor, "executeApprovedBuy">,
    private readonly minimumIntervalMs = 1_000,
  ) {}

  executeApprovedBuy(request: DemoBuyRequest): Promise<DemoBuyResult> {
    const run = this.tail.then(async () => {
      const waitMs = Math.max(0, this.minimumIntervalMs - (Date.now() - this.lastExecutionAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Start the rate-limit window before invoking the provider. Rejected
      // requests must consume the slot as well, otherwise retries can burst
      // immediately after a transient exchange/network failure.
      this.lastExecutionAt = Date.now();
      return this.executor.executeApprovedBuy(request);
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}
