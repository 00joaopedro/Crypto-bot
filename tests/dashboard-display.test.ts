import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const positionFunction = source.match(/function renderPositions\(\)\{[^\n]+\}/)?.[0];
const labelFunction = source.match(/function demoOrderLabel\(order\)\{[^\n]+\}/)?.[0];

describe('dashboard Paper and Demo display', () => {
  it('shows recorded Paper quantity and identifies the position as simulated', () => {
    const target = { innerHTML: '' };
    const context = { state: { portfoliosBySymbol: [{ symbol: 'TRX/USDT', snapshot: { positionQuantity: 12.5, positionMarketValueUsdt: 10, unrealizedPnlUsdt: 1 } }, { symbol: 'BTC/USDT', snapshot: { positionQuantity: 0 } }] }, $: () => target, escapeHtml: String, money: String };
    runInNewContext(`${positionFunction}; renderPositions()`, context);
    expect(target.innerHTML).toContain('TRX/USDT · Paper · quantidade 12.50000000');
    expect(target.innerHTML).not.toContain('BTC/USDT');
  });
  it('distinguishes explicit permission rejections from uncertain errors', () => {
    const label = runInNewContext(`${labelFunction}; demoOrderLabel`);
    expect(label({ status: 'REJECTED_CONFIRMED', result: { error: 'okx {"code":"50123","msg":"This API Key does not have trading permission for the Crypto"}' } })).toContain('50123');
    expect(label({ status: 'PENDING', result: { error: '50123' } })).toBe('PENDING');
    expect(label({ status: 'FAILED', result: { error: 'okx {broken' } })).toBe('FAILED');
  });
});

it('shows current reconciliation failure separately from the last confirmed timestamp', () => {
  const fn=source.match(/function renderDemoAccounting\(\)\{[^\n]+\}/)?.[0];
  const label={textContent:''};let shown='';
  const context={state:{demoAccounting:{status:'unavailable',reason:'checkpoint_changed_retry'},lastDemoReconciliation:{confirmedThrough:'2026-11-01T12:00:00Z',realizedPnlUsdt:12.85}},$:()=>label,setMetric:(_id:string,text:string)=>{shown=text},money:String};
  runInNewContext(`${fn}; renderDemoAccounting()`,context);
  expect(shown).toBe('—');
  expect(label.textContent).toContain('Última confirmação:');
  expect(label.textContent).toContain('histórico mudou');
  expect(label.textContent).not.toContain('P&L confirmado');
});
