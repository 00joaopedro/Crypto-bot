export type ManagedPosition = {
  symbol: string;
  notionalUsdt: number;
  openedAt: number;
};

export type TradeManagerOptions = {
  maxConcurrentPositions: number;
  maxExposurePercent: number;
};

/** Central gate shared by signal ranking and execution. */
export class CentralTradeManager {
  private readonly positions = new Map<string, ManagedPosition>();

  constructor(private readonly options: TradeManagerOptions) {}

  get activePositions(): ManagedPosition[] {
    return [...this.positions.values()].map((position) => ({ ...position }));
  }

  canEnter(symbol: string, notionalUsdt: number, equityUsdt: number): { allowed: boolean; reason?: string } {
    if (this.positions.has(symbol)) return { allowed: false, reason: "position_already_open" };
    if (this.positions.size >= this.options.maxConcurrentPositions) {
      return { allowed: false, reason: "max_concurrent_positions" };
    }
    const exposure = this.totalExposureUsdt + notionalUsdt;
    if (equityUsdt <= 0 || exposure / equityUsdt > this.options.maxExposurePercent) {
      return { allowed: false, reason: "max_total_exposure" };
    }
    return { allowed: true };
  }

  recordEntry(position: ManagedPosition): void {
    this.positions.set(position.symbol, { ...position });
  }

  recordExit(symbol: string): void {
    this.positions.delete(symbol);
  }

  get totalExposureUsdt(): number {
    return [...this.positions.values()].reduce((total, position) => total + position.notionalUsdt, 0);
  }
}
