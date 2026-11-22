# Hybrid research — first execution

This is a separate offline research engine, not an operational strategy change. Protocol: `examples/hybrid-research.plan.json`; baseline identity: `examples/pullback-reference.study.json`. Historical experiments remain preserved. No exchange/account requests, Railway changes, orders, deployment or merge are part of this execution.

## Frozen design

Twenty USDT spot pairs in the requested order; unsupported/missing input pairs are reported, never silently replaced. This is a fixed research list, not a certification of current liquidity or Demo availability. Capital 17 USDT, fixed maximum notional 10 USDT, one shared position. Cash includes fees; quantity is rounded down; minimum quantity and supplied minimum notional apply, including sellable quantity after base-currency fees. The lot represents approximately 58.8% of initial capital before fees. This is an explicit research allocation, separate from the legacy 10% exposure limit; no operational risk limit is increased.

Signals use closed 15m candles and only fully completed 1h candles. Decisions enter at the following open, with modeled costs. Warmup is 1,000 quarter-hours and at least 250 completed hours. ATR is the existing simple mean of 14 true ranges; ADX uses Wilder smoothing. EMA and RSI helpers are reused. Intraday VWAP uses typical price and resets at UTC midnight. A truncated current UTC day disables the VWAP alternative. Shared market-quality gate (score >=3), liquidity/participation admission and existing pair cooldown are retained. Baseline uses its original BUY score/RSI and fixed ATR exits, under the new study's common capital, list and costs; it does not inherit the hybrid ATR floor.

All hybrid entries require ATR14/close >=0.70%. A uses 1h EMA50>EMA200; previous candle low touches EMA21 or VWAP, with penetration limited to 0.25 of the previous ATR; previous RSI14 is 40–50 and volume is below 1.1 times the preceding 20-candle average. Confirmation is green, above EMA21, RSI14<=58. The initial stop is the closer protective level: max(entry fill*0.989, previous low−1.5*signal ATR). Invalid levels reject entry. A target is +2.8% estimated net return on the actual entry cash outlay. A surviving closed candle at +1.2% estimated net arms trailing, proposing the greater valid level of +0.7% net floor and highest observed price−1.2*current ATR. Stop never decreases. Proposals at/above current close cannot execute retroactively; updates become effective only on subsequent candles. Gaps can realize less than the proposed floor.

B requires current ADX14<22, previous close below BB20/2 and previous RSI7<25, followed immediately by a green close above the current lower band. The confirmation candle does not repeat RSI7<25 and does not require A's macro trend. The target is the lower of the SMA20 known at confirmation (frozen) and +1.4% estimated net. Targets failing to cover modeled entry and exit costs reject entry. Stop is 1.2% below fill. Time stop closes at the sixth fully held candle's close; SL/TP have priority. Time-stop reports include the close-time proxy. Bollinger standard deviation is population-based.

Competing signals use frozen pair order, then A before B. Each confirmation is a single opportunity at the next open; no stale queue, same-bar reuse of released cash or second mode entry is allowed. PaperTrader supplies fee accounting, fill slippage, initial protection and conservative OHLC collision/gap handling; reports identify modes explicitly rather than calling them legacy trend trades.

## Commands and next execution

Build first. Protocol-only output (no market data required):

```sh
npm run build
npm run strategy:hybrid-research -- examples/hybrid-research.plan.json examples/pullback-reference.study.json
```

Optional supplied-data replay, for engineering validation and the next historical execution:

```sh
npm run strategy:hybrid-research -- examples/hybrid-research.plan.json examples/pullback-reference.study.json normalized-data.json NEW-output-directory
```

Input contains `asOfUtc` and `instruments` with `symbol`, `candles15m`, `candles1h`, `constraints`, optionally aligned `quoteVolumesUsdt`. Candles contain timestamp/open/high/low/close/volume. Timestamp is bar-open UTC milliseconds. Series must be aligned, contiguous and duplicate-free; overlapping hours must agree with their four quarter-hours. Only candles closed by the declared cutoff are accepted. Evaluation is limited to 30 days after warmup; shorter fixtures are explicitly incomplete. Missing pairs are listed without claiming exchange unavailability.

Runs compare baseline, A alone, B alone and A+B under four cost cases: Gemini's 0.10% fee/leg and 0.05% slippage hypothesis, its doubled stress, archived account-conditioned assumptions, and archived stress. Hypothesis cases additionally declare an assumed 0.15% full spread (0.30% stressed); none certifies the intended account's fees. Archived missing pair terms remain declared fallback, not observed terms. Stress also reduces modeled liquidity. Full ledgers and aggregate/per-mode counts, win rate, PF, EV, net equity return, drawdown, recovery and top-three profit concentration are emitted. Three 10-day blocks account for the same continuous wallet, including carry positions; they are not independently certified walk-forward validation. Open positions remain marked, not fabricated as closed trades.

**Completed here:** implementation, frozen protocol and synthetic engineering tests. **Not completed here:** public historical collection, the 30-day market comparison, independent validation, candidate selection or Demo integration. Synthetic tests are not market-performance evidence. `profitabilityValidated`, `configurationPromoted` and `realMoneyApproved` remain false. The next execution must collect/verify data and current instrument terms, preserve all alternatives and report results before considering selection. A positive development result still needs separate validation; 48h Demo is an operational check, not automatic permission for real capital.

The replay does not certify operational parity for native protection, tick-rounded triggers, partial fills/dust, scheduler, account permissions, daily/global risk admission or actual book history. End-of-bar marked equity deducts liquidation fee but is not an executable liquidation quote. No probability of profitability can be inferred from unit tests or from replacing the old strategy's rules.
