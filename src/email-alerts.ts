import type { PaperTradeClosed, PaperTradeOpened } from "./paper-trader.js";

type EmailAlertOptions = {
  apiKey: string;
  from: string;
  to: string;
};

export class EmailTradeAlert {
  constructor(private readonly options: EmailAlertOptions) {}

  async sendOpened(symbol: string, trade: PaperTradeOpened): Promise<void> {
    await this.send(
      `Crypto Bot · entrada ${symbol}`,
      [
        `Entrada paper registrada em ${symbol}.`,
        `Preço: ${format(trade.entryPrice)}`,
        `Quantidade: ${format(trade.quantity)}`,
        `Notional: US$ ${format(trade.notionalUsdt)}`,
        `Taxa: US$ ${format(trade.feeUsdt)}`,
        `Stop-Loss: ${format(trade.stopLossPrice)}`,
        `Take-Profit: ${format(trade.takeProfitPrice)}`,
        "Saída: pendente.",
      ].join("\n"),
    );
  }

  async sendClosed(symbol: string, trade: PaperTradeClosed): Promise<void> {
    await this.send(
      `Crypto Bot · saída ${symbol} · ${trade.netPnlUsdt >= 0 ? "lucro" : "perda"}`,
      [
        `Saída paper registrada em ${symbol}.`,
        `Entrada: ${format(trade.entryPrice)}`,
        `Saída: ${format(trade.exitPrice)}`,
        `Quantidade: ${format(trade.quantity)}`,
        `Motivo: ${trade.reason}`,
        `Taxas totais: US$ ${format(trade.feesUsdt)}`,
        `P&L líquido: US$ ${format(trade.netPnlUsdt)} (${format(trade.netPnlPercent)}%)`,
      ].join("\n"),
    );
  }

  private async send(subject: string, text: string): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [this.options.to],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Email provider returned HTTP ${response.status}`);
    }
  }
}

function format(value: number): string {
  return Number(value.toFixed(8)).toString();
}
