# Hybrid research — 30-day development result

Execution 2 of the new three-execution plan. Code, original strategies and previous studies are preserved. No merge, order, deployment, Railway change or production database write was performed. This study does not approve Demo promotion or real capital.

## Frozen coverage and reproduction

- Evaluation: **2026-10-23 23:00 UTC → 2026-11-22 23:00 UTC**, end exclusive (20:00 Belém).
- Warmup starts **2026-10-13 13:00 UTC**: 1,000 quarter-hours / 250 hours before evaluation; 3,880 15m bars and 970 1h bars per included pair. Warmup is excluded from performance.
- Intended watchlist: 20 fixed pairs; 18 included. ARB/USDT absent from the Demo public list; TON/USDT absent from the public Spot list returned to this runner. These observations do not establish global or account-level unavailability. No replacement market was selected. 69,840 quarter-hours and 17,460 hours were captured, including warmup.
- Strategy protocol: `hybrid-research-v1`; collection: `examples/hybrid-collection.study.json`. First collection/code freeze commit `27eaa0c`; empty-subbar validation fix and evaluated code `835abda`. Strategy thresholds, allocation, costs and dates were not tuned after results.
- Replay schema-parsed dataset SHA256: `fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4`. Captured-object dataset SHA256: `968783685746c751248ceb4c6bc97beefe997b8d46ded0f5cbc6905317620334`. Their property order differs; values match exactly. Both identities and a sorted-key audit hash are retained in the evaluation JSON.
- All sixteen comparisons reuse the same normalized public snapshot, 17-USDT wallet, 10-USDT fixed maximum notional, one position, deterministic priority, market-quality/cooldown/minimum-quantity/liquidity admission. Runtime risk admission is not certified equivalent.
- Full JSON metrics: `hybrid-research-results.json`. All sixteen event/entry ledgers: `hybrid-research-ledgers/run-0.json` through `run-15.json` in variant/scenario order. Source, raw normalized candle files and replay outputs are in the linked Actions artifact (30-day retention). Artifact identity and hashes are in `hybrid-research-evaluation.json`.
- Reproduce after extracting the artifact: `npm run build`, then `npm run strategy:hybrid-collect -- --verify examples/hybrid-research.plan.json examples/hybrid-collection.study.json .hybrid-data`, then `npm run strategy:hybrid-research -- examples/hybrid-research.plan.json examples/pullback-reference.study.json .hybrid-data/normalized-data.json NEW-output-directory`.

## Costs

Gemini standard/stress use assumed fees 0.10%/0.20% per leg and slippage 0.05%/0.10% per leg; full modeled spread is 0.15%/0.30%. Archived account-conditioned/stress use fees 0.40%/0.80% per leg, slippage 0.10%/0.20% and full spread 0.15%/0.30%. Stress also reduces depth/participation. Entry fee is modeled in base currency, exit fee in USDT. Spread and slippage enter fills; fees are not charged twice. These are scenarios, not a new account fee audit. Of the 20 intended pairs, only BTC/DOGE/ETH/NEAR/SOL/UNI have archived exported fee evidence; all others retain declared assumptions. Public instrument rules do not prove real-account permission or fee tier.

## All alternatives — same wallet and costs

Net return includes remaining open positions marked at the final close less exit fee; it is not an executable liquidation quote. PF/EV/win rate refer only to closed trades. Recovery = net marked return / maximum marked equity drawdown in USDT. Top3 is the three largest positive closed P&Ls divided by total positive closed P&Ls, not a percentage of a negative final result. Undefined PF for A without losing trades is not a stable infinite PF.

| Variant | Cost case | Trades | Win % | Net USDT | Return % | PF | EV USDT | DD % | Recovery | Top3 % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | gemini-hypothesis | 109 | 25.6881 | -6.7214 | -39.5377 | 0.3446 | -0.0621 | 40.3756 | -0.9747 | 21.9644 |
| baseline | gemini-stress-hypothesis | 69 | 20.2899 | -7.1407 | -42.0042 | 0.1659 | -0.1035 | 42.0534 | -0.9980 | 50.2664 |
| baseline | account-conditioned | 57 | 15.7895 | -7.0284 | -41.3433 | 0.1120 | -0.1233 | 41.3433 | -1.0000 | 61.1112 |
| baseline | account-cost-stress | 31 | 9.6774 | -7.0131 | -41.2537 | 0.0287 | -0.2262 | 41.2537 | -1.0000 | 100.0000 |
| trend_pullback | gemini-hypothesis | 2 | 100.0000 | 0.3500 | 2.0588 | undefined | 0.1750 | 0.9059 | 2.2257 | 100.0000 |
| trend_pullback | gemini-stress-hypothesis | 1 | 100.0000 | 0.1879 | 1.1050 | undefined | 0.1879 | 0.6164 | 1.7858 | 100.0000 |
| trend_pullback | account-conditioned | 2 | 50.0000 | -0.0438 | -0.2578 | 0.7874 | -0.0219 | 1.6793 | -0.1513 | 100.0000 |
| trend_pullback | account-cost-stress | 1 | 100.0000 | 0.1363 | 0.8016 | undefined | 0.1363 | 1.3045 | 0.6144 | 100.0000 |
| mean_reversion | gemini-hypothesis | 26 | 50.0000 | -0.6063 | -3.5666 | 0.5861 | -0.0233 | 3.5666 | -1.0000 | 48.9105 |
| mean_reversion | gemini-stress-hypothesis | 16 | 37.5000 | -1.2391 | -7.2888 | 0.2656 | -0.0774 | 7.3412 | -0.9929 | 70.6695 |
| mean_reversion | account-conditioned | 17 | 35.2941 | -1.3841 | -8.1418 | 0.1919 | -0.0814 | 8.1418 | -1.0000 | 73.2196 |
| mean_reversion | account-cost-stress | 2 | 0.0000 | -0.6230 | -3.6647 | 0.0000 | -0.3115 | 3.6647 | -1.0000 | undefined |
| hybrid | gemini-hypothesis | 28 | 53.5714 | -0.2563 | -1.5078 | 0.8250 | -0.0092 | 2.9324 | -0.5068 | 46.3310 |
| hybrid | gemini-stress-hypothesis | 17 | 41.1765 | -1.0512 | -6.1838 | 0.3769 | -0.0618 | 6.2362 | -0.9916 | 63.9718 |
| hybrid | account-conditioned | 19 | 36.8421 | -1.4279 | -8.3996 | 0.2559 | -0.0752 | 8.3996 | -1.0000 | 67.3315 |
| hybrid | account-cost-stress | 3 | 33.3333 | -0.4867 | -2.8631 | 0.2187 | -0.1622 | 4.1131 | -0.6871 | 100.0000 |

## Modes within the shared hybrid

| Cost case | Mode | Trades | Net USDT | PF | EV USDT |
|---|---|---:|---:|---:|---:|
| gemini-hypothesis | TREND_PULLBACK | 2 | 0.3500 | undefined | 0.1750 |
| gemini-hypothesis | MEAN_REVERSION | 26 | -0.6063 | 0.5861 | -0.0233 |
| gemini-stress-hypothesis | TREND_PULLBACK | 1 | 0.1879 | undefined | 0.1879 |
| gemini-stress-hypothesis | MEAN_REVERSION | 16 | -1.2391 | 0.2656 | -0.0774 |
| account-conditioned | TREND_PULLBACK | 2 | -0.0438 | 0.7874 | -0.0219 |
| account-conditioned | MEAN_REVERSION | 17 | -1.3841 | 0.1919 | -0.0814 |
| account-cost-stress | TREND_PULLBACK | 1 | 0.1363 | undefined | 0.1363 |
| account-cost-stress | MEAN_REVERSION | 2 | -0.6230 | 0.0000 | -0.3115 |

## Three chronological blocks — continuous shared wallet

D1–D10: Oct23 23:00 → Nov02 23:00 UTC. D11–D20: Nov02 23:00 → Nov12 23:00 UTC. D21–D30: Nov12 23:00 → Nov22 23:00 UTC. All blocks contain 960 evaluation bars. Positions and capital carry across boundaries; these are fixed chronological diagnostics, not independent walk-forward certification or out-of-sample approval. All 30 days and warmup are now consulted development data. Per-block results for all variants are retained in JSON.

| Hybrid cost case | Block | Trades closed | Net USDT | PF | EV USDT |
|---|---|---:|---:|---:|---:|
| gemini-hypothesis | D1-D10 | 8 | -0.3478 | 0.3561 | -0.0435 |
| gemini-hypothesis | D11-D20 | 11 | 0.3174 | 1.7860 | 0.0289 |
| gemini-hypothesis | D21-D30 | 9 | -0.2259 | 0.5664 | -0.0251 |
| gemini-stress-hypothesis | D1-D10 | 5 | -0.5684 | 0.1467 | -0.1137 |
| gemini-stress-hypothesis | D11-D20 | 6 | -0.1176 | 0.7491 | -0.0196 |
| gemini-stress-hypothesis | D21-D30 | 6 | -0.3652 | 0.3388 | -0.0609 |
| account-conditioned | D1-D10 | 5 | -0.4927 | 0.1281 | -0.0985 |
| account-conditioned | D11-D20 | 8 | -0.3189 | 0.4772 | -0.0399 |
| account-conditioned | D21-D30 | 6 | -0.6163 | 0.1715 | -0.1027 |
| account-cost-stress | D1-D10 | 0 | 0.0000 | undefined | undefined |
| account-cost-stress | D11-D20 | 2 | -0.1752 | 0.4375 | -0.0876 |
| account-cost-stress | D21-D30 | 1 | -0.3115 | 0.0000 | -0.3115 |

## Decision and explanation

**No candidate is approved.** The hybrid and B are negative in every cost case. A has only 1–2 closed trades per case and cannot establish a useful advantage; its account-conditioned case is also negative. A winning trade or a positive middle block does not validate the architecture.

Under Gemini assumptions, hybrid wins 53.57% yet average net win is 0.08058 USDT versus average net loss 0.11269 USDT. EV remains −0.00915 USDT/trade; fees total 0.56002 USDT. In the archived account-conditioned case, win rate is 36.84%, average win 0.07015 versus loss 0.15991, EV −0.07515 USDT/trade, fees 1.51730 USDT. This is an accounting description, not a fee-free counterfactual or proof that removing fees would make the strategy profitable.

The lower losses relative to baseline are a development improvement, not proof of profitability. The severe archived stress has only three hybrid trades: 32 uneconomic targets and 14 liquidity rejections sharply reduce activity, so its smaller total loss does not demonstrate robustness. Baseline cash rejections also explain why several baseline runs stop adding positions after equity falls below the fixed lot. It is not valid to compare raw loss totals without counts, EV and admissions.

Gemini hybrid has 46.33% of gross positive closed P&L concentrated in the best three trades; archived case has 67.33%. A has 100% concentration because it has at most two trades. No post-result threshold search, alternative watchlist, lower fee relabeling, fresh holdout consumption or strategy promotion was performed.

The conditional third execution (integration of an eligible candidate for Demo) remains blocked by these results. A further research proposal needs an explicit new hypothesis and account-cost evidence; it must not reuse this window as blind validation. Finishing the implementation or observing 48h of operation does not establish an economic edge.

## Data validation correction and limits

The initial collection stopped before any replay: ATOM on 2026-10-27 21:00 UTC had a zero-volume first quarter carrying 1.621 from the previous bar; the first actual trade was in the next quarter at 1.619, matching the downloaded hourly open. Hourly aggregation now compares OHLC against quarters with trades (and uses carry OHLC when all four are empty), while volume uses all quarters. Original candles remain unchanged. Other mismatches, missing intervals, malformed bars or conflicting duplicate observations still fail validation. A regression test covers both the legitimate empty-candle case and a real mismatch. Official reference: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks .

Current minSz/lotSz/tickSz are public observed terms, applied retrospectively. Quote-notional minimum remains unknown: numerical zero is only a replay placeholder, explicitly not verified exchange minimum zero. Native protection, trigger tick rounding, partial fills/dust, actual book history, zero-volume executable liquidity, scheduler, daily/global risk rules, account permissions and current account fees remain limitations. No production DB, account, credentials or order endpoint was accessed.

Validation: five added tests across this execution (1h history, freeze/identity, public rules, exact dual-timeframe collection/snapshot verification, zero-volume hourly aggregation); local 569 passed with 20 PostgreSQL skipped, typecheck/build passed. CI for evaluated code verifies 589 tests including PostgreSQL, Docker and mobile smoke; run conclusions and exact reproduction are recorded in the evaluation JSON.
