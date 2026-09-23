# Crypto Bot

Bot experimental de negociação **Spot**, escrito em Node.js + TypeScript.

> Aviso: software experimental, não é recomendação financeira. Este marco executa apenas paper trading; nenhuma ordem é enviada à corretora.

## Arquitetura atual

1. Busca candles públicos fechados de 15 minutos via CCXT.
2. Usa Kraken como fonte padrão, evitando o bloqueio regional da Bybit na Railway.
3. Calcula EMA 9, EMA 21 e RSI 14 de forma determinística.
4. Gera compra somente em novo cruzamento da EMA 9 acima da EMA 21, com RSI entre 45 e 70.
5. Usa o Gemini opcionalmente como filtro de risco com saída JSON estruturada.
6. Simula entrada Spot com taxa e slippage.
7. Simula Stop-Loss e Take-Profit usando máxima e mínima dos candles fechados.
8. Emite logs de abertura, fechamento, P&L, patrimônio, drawdown e benchmark buy-and-hold.

A fonte dos candles não define a futura corretora de execução. A execução Bybit continua planejada, mas precisa de infraestrutura localizada em região aceita pela Bybit.

A IA não cria sinais, não define tamanho da posição e não altera regras de risco. Falha da IA bloqueia a compra.

## Requisitos

- Node.js 22+
- chave Gemini apenas se `GEMINI_ENABLED=true`
- nenhuma chave de corretora é usada no modo atual

## Uso local

```bash
npm install
cp .env.example .env
npm run dev
```

No Windows PowerShell, copie manualmente `.env.example` para `.env` caso `cp` não esteja disponível.

## Deploy na Railway

A Railway detecta o `Dockerfile`. O bot é um worker contínuo e não precisa de domínio público.

Variáveis principais:

- `ENVIRONMENT=LOG_ONLY`
- `MARKET_DATA_PROVIDER=kraken`
- `GEMINI_ENABLED=true` junto com `GEMINI_API_KEY`
- `PAPER_INITIAL_BALANCE_USDT=1000`
- `PAPER_TRADE_SIZE_USDT=100`
- `PAPER_FEE_RATE=0.001` (0,10%)
- `PAPER_SLIPPAGE_RATE=0.0005` (0,05%)
- `PAPER_STOP_LOSS_RATE=0.01` (1%)
- `PAPER_TAKE_PROFIT_RATE=0.02` (2%)

Consulte [`.env.example`](.env.example) para a lista completa.

## Eventos de log

- `bot_started`: configuração efetiva, sem segredos;
- `decision`: sinal, decisão da IA e aprovação;
- `paper_trade_opened`: entrada, quantidade, taxa, Stop-Loss e Take-Profit;
- `paper_trade_closed`: saída, motivo, taxas e P&L líquido;
- `paper_portfolio_snapshot`: patrimônio, P&L, drawdown, win rate e comparação buy-and-hold;
- `cycle_skipped`: o candle fechado já foi processado.

Se Stop-Loss e Take-Profit forem tocados no mesmo candle, o simulador escolhe Stop-Loss, pois candles OHLC não revelam qual nível foi atingido primeiro. Essa regra evita resultados artificialmente otimistas.

## Limitações deliberadas

- nenhuma ordem é enviada à Bybit;
- a carteira fica em memória e reinicia após um novo deploy;
- logs ainda não são um histórico persistente;
- os resultados não garantem desempenho futuro;
- a comparação começa no primeiro candle processado após o processo iniciar.

Persistência PostgreSQL e painel serão adicionados em marcos separados. Antes de habilitar Bybit Testnet serão necessários idempotência persistente, consulta de saldo e mercado, precisão de quantidade/preço, confirmação de preenchimento, kill switch e limites de exposição/perda.
