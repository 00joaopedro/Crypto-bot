# Crypto Bot

Bot experimental de negociação **Spot**, escrito em Node.js + TypeScript.

> Aviso: software experimental, não é recomendação financeira. Ordens externas são limitadas tecnicamente ao ambiente OKX Demo com saldo virtual. Não existe modo de negociação real neste código.

## Arquitetura atual

1. Busca candles públicos fechados de 15 minutos via CCXT.
2. Usa Kraken como fonte padrão, evitando o bloqueio regional da Bybit na Railway.
3. Calcula EMA 9, EMA 21, RSI 14, volume, momentum e volatilidade de forma determinística.
4. Gera um score de entrada (1–8) com tendência, RSI, volume, momentum, volatilidade e distância estimada do stop. A EMA ainda precisa apontar para cima, mas não é necessário um cruzamento em um único candle.
5. O score é submetido ao filtro de IA quando ele está habilitado; a IA continua sendo uma barreira adicional e uma falha permanece fail-closed.
6. Usa o Gemini opcionalmente como filtro de risco com saída JSON estruturada.
7. Mantém uma carteira paper com taxa, slippage, Stop-Loss e Take-Profit.
8. Quando as duas travas Demo estão habilitadas, envia uma compra Spot virtual à OKX com TP/SL anexados.
9. Pode classificar uma lista de pares em cada candle fechado e só considera o melhor sinal elegível para a execução do par configurado. A carteira multiativos será uma etapa posterior.
8. Bloqueia duplicidade por candle e novas entradas quando existem ordens abertas no par.
9. Emite logs de abertura, fechamento, P&L, patrimônio, drawdown e benchmark buy-and-hold.
10. Persiste decisões, snapshots, operações e estado da carteira no PostgreSQL.
11. Restaura o último candle e a carteira paper após reinícios da Railway.
12. Consulta um kill switch persistente antes de acessar o mercado ou executar ordens.

A fonte dos candles não define a corretora de execução. Kraken fornece os candles e a OKX Demo recebe apenas ordens virtuais aprovadas pelas regras quantitativas e pelo filtro de IA.

A IA não cria sinais, não define tamanho da posição e não altera regras de risco. Falha da IA bloqueia a compra.

## Requisitos

- Node.js 22+
- chave Gemini apenas se `GEMINI_ENABLED=true`
- para a OKX Demo: chave, secret e passphrase criados dentro de Trading simulado

## Uso local

```bash
npm install
cp .env.example .env
npm run dev
```

No Windows PowerShell, copie manualmente `.env.example` para `.env` caso `cp` não esteja disponível.

## Deploy na Railway

A Railway detecta o `Dockerfile`. O mesmo serviço mantém o worker e serve o painel protegido.

Variáveis principais:

- `ENVIRONMENT=LOG_ONLY` mantém somente paper trading
- `MARKET_DATA_PROVIDER=okx` (candles públicos da OKX, alinhados à execução Demo)
- `MARKET_DATA_FALLBACK_PROVIDER=kraken` (fallback opcional quando a OKX estiver indisponível)
- `EXECUTION_PROVIDER=okx-demo`
- `LIVE_TRADING_ENABLED=false` (único valor aceito neste marco)
- `OKX_API_KEY`, `OKX_SECRET_KEY` e `OKX_PASSPHRASE`
- `GEMINI_ENABLED=true` junto com `GEMINI_API_KEY`
- `PAPER_INITIAL_BALANCE_USDT=1000`
- `PAPER_TRADE_SIZE_USDT=100`
- `PAPER_FEE_RATE=0.001` (0,10%)
- `PAPER_SLIPPAGE_RATE=0.0005` (0,05%)
- `PAPER_STOP_LOSS_RATE=0.01` (1%)
- `PAPER_TAKE_PROFIT_RATE=0.02` (2%)
- `RISK_MAX_EXPOSURE_PERCENT=0.25` (exposição máxima de 25% do patrimônio)
- `RISK_PER_TRADE_PERCENT=0.01` (risco estimado máximo de 1% por operação)
- `RISK_MAX_DAILY_LOSS_PERCENT=0.03` (pausa ao perder 3% no dia)
- `RISK_MAX_DRAWDOWN_PERCENT=0.10` (pausa ao atingir 10% de drawdown)
- `RISK_MAX_TRADES_PER_HOUR=3` (referência operacional; o limite efetivo por intervalo é ajustável no painel)
- `ENTRY_COOLDOWN_MINUTES=60` (intervalo mínimo entre novas entradas no mesmo par)
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `DATABASE_CONNECTION_TIMEOUT_MS=10000`
- `DASHBOARD_PASSWORD`: senha exclusiva do painel
- `DASHBOARD_SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres
- `PORT`: fornecida automaticamente pela Railway

Para autorizar ordens com saldo virtual, use o duplo opt-in:

- `ENVIRONMENT=DEMO`
- `OKX_DEMO_TRADING_ENABLED=true`
- `OKX_DEMO_ORDER_SIZE_USDT=10`
- `OKX_DEMO_STOP_LOSS_RATE=0.01`
- `OKX_DEMO_TAKE_PROFIT_RATE=0.02`

Mesmo em `DEMO`, `LIVE_TRADING_ENABLED` deve permanecer `false`; qualquer outro valor impede a inicialização.
`DATABASE_URL` também é obrigatória quando `OKX_DEMO_TRADING_ENABLED=true`.

Use uma variável de referência da Railway para `DATABASE_URL`; não copie a URL
real para o repositório. O processo aplica migrations versionadas e idempotentes
ao iniciar. Enquanto o PostgreSQL não estiver disponível, a inicialização tenta
novamente com backoff e nenhuma ordem Demo é enviada.

## Persistência PostgreSQL

O primeiro migration cria:

- `bot_runs`: início, encerramento e configuração não secreta de cada processo;
- `decisions`: sinal quantitativo, decisão da IA e aprovação por candle;
- `portfolio_snapshots`: P&L, patrimônio, drawdown e benchmark;
- `paper_trades`: entradas e saídas paper;
- `paper_trader_state`: checkpoint usado para recuperação após restart;
- `demo_orders`: resultado das tentativas de ordem OKX Demo;
- `bot_control`: kill switch persistente para o futuro painel;
- `audit_events`: trilha de auditoria reservada para alterações do painel.

O segundo migration adiciona as configurações operacionais do painel. O painel
permite pausar/retomar o bot, escolher qualquer par Spot/USDT simultaneamente
suportado por Kraken e OKX Demo, definir o valor de cada ordem e limitar a
quantidade de ordens por intervalo. Uma mudança de configuração causa um restart
controlado para que símbolo e executor sejam reconstruídos com o novo estado.

## Painel web

Após configurar as duas variáveis `DASHBOARD_*`, gere um domínio público em
**Railway → Settings → Networking → Generate Domain**. O painel usa HTML e CSS
puros, JavaScript nativo, tema escuro por padrão e layout mobile-first.

Controles mutáveis exigem sessão autenticada e origem válida. A sessão fica em
cookie `HttpOnly`, `Secure` e `SameSite=Strict`; tentativas de login são limitadas
e toda pausa ou mudança de estratégia gera um evento de auditoria. Segredos da
OKX, do Gemini e do banco nunca são enviados ao navegador.

Cada ciclo grava snapshot, eventos e checkpoint em uma única transação. Se essa
transação falhar, o estado em memória volta ao checkpoint anterior e ordens Demo
não são executadas naquele ciclo. A proteção de duplicidade da OKX continua
ativa como uma segunda camada.

Consulte [`.env.example`](.env.example) para a lista completa.

## Eventos de log

- `bot_started`: configuração efetiva, sem segredos;
- `database_connected`: migrations concluídas e estado restaurado, quando existir;
- `database_initialization_failed`: conexão/migration falhou e será repetida;
- `database_write_failed`: escrita auxiliar falhou sem expor credenciais;
- `database_write_failed_after_order`: a ordem foi enviada, mas seu resultado não pôde ser persistido;
- `persistence_disabled`: execução LOG_ONLY sem `DATABASE_URL`;
- `okx_demo_connected`: mercados e saldo Demo foram consultados com sucesso;
- `okx_demo_execution_armed`: as duas travas Demo foram habilitadas;
- `execution_disabled`: a integração OKX continua somente leitura;
- `okx_demo_order_submitted`: ordem virtual aceita, com IDs e dados de preenchimento disponíveis;
- `okx_demo_order_skipped`: compra bloqueada por duplicidade, saldo ou ordem aberta;
- `okx_demo_order_failed`: falha fechada; o erro é registrado e não há nova tentativa no mesmo candle;
- `decision`: sinal, decisão da IA e aprovação;
- `paper_trade_opened`: entrada, quantidade, taxa, Stop-Loss e Take-Profit;
- `paper_trade_closed`: saída, motivo, taxas e P&L líquido;
- `paper_portfolio_snapshot`: patrimônio, P&L, drawdown, win rate e comparação buy-and-hold;
- `cycle_skipped`: o candle fechado já foi processado.

Se Stop-Loss e Take-Profit forem tocados no mesmo candle, o simulador escolhe Stop-Loss, pois candles OHLC não revelam qual nível foi atingido primeiro. Essa regra evita resultados artificialmente otimistas.

## Limitações deliberadas

- não existe execução em conta real;
- os resultados não garantem desempenho futuro;
- o histórico começa a ser acumulado somente após o deploy deste marco;
- o painel controla apenas o ambiente Demo; não existe execução em conta real;
- apenas um par fica ativo por vez neste primeiro marco do painel.

Antes de habilitar qualquer conta real ainda serão necessários autenticação forte
do painel, confirmação/reconciliação de preenchimentos, limites de exposição e
perda diária e uma etapa de validação prolongada em ambiente Demo.
