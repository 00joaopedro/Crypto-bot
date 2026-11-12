# Crypto Bot

Bot experimental de negociação **Spot**, escrito em Node.js + TypeScript.

> Aviso: software experimental, não é recomendação financeira. Ordens externas são limitadas tecnicamente ao ambiente OKX Demo com saldo virtual. Não existe modo de negociação real neste código.

## Validação histórica fora da amostra

Execute `npm run build` e depois `npm run --silent strategy:validate -- caminho/dados.json`. O arquivo deve conter `candles` com candles OHLCV de 15 minutos ordenados e sem lacunas, e `options` com `trainCandles`, `testCandles`, um único item em `candidates` e `base`. Em `base`, informe `initialBalanceUsdt`, `tradeSizeUsdt`, `feeRate`, `slippageRate`, `stopLossRate`, `takeProfitRate` e `executionProfile: "demo-proxy"`.

Cada janela de teste é posterior ao seu treino e não se sobrepõe às demais. O aquecimento não abre posições. O perfil Demo simula somente stop e alvo, pois a venda por sinal contrário está bloqueada. Esse relatório é uma aproximação: não reproduz seleção dinâmica de pares, filtros de risco de carteira, IA, saídas ATR ou execuções e taxas reais da OKX. Ele não habilita trading real nem comprova rentabilidade.

## Arquitetura atual

1. Busca candles públicos fechados de 15 minutos via CCXT.
2. Usa Kraken como fonte padrão, evitando o bloqueio regional da Bybit na Railway.
3. Calcula EMA 9, EMA 21, RSI 14, volume, momentum e volatilidade de forma determinística.
4. Gera um score de entrada (1–8) com tendência, RSI, volume, momentum, volatilidade e distância estimada do stop. A EMA ainda precisa apontar para cima, mas não é necessário um cruzamento em um único candle.
5. Opera no modo quantitativo por padrão, sem depender de IA; o score é determinístico e sujeito aos limites de risco.
6. O Gemini pode ser ativado futuramente com `AI_MODE=filter` e `GEMINI_ENABLED=true` como filtro adicional de risco.
7. Mantém uma carteira paper com taxa, slippage, Stop-Loss e Take-Profit.
8. Quando as duas travas Demo estão habilitadas, envia uma compra Spot virtual à OKX com TP/SL anexados.
9. Pode classificar uma lista de pares em cada candle fechado e só considera o melhor sinal elegível para a execução do par configurado. A carteira multiativos será uma etapa posterior.
8. Bloqueia duplicidade por candle e novas entradas quando existem ordens abertas no par.
9. Emite logs de abertura, fechamento, P&L, patrimônio, drawdown e benchmark buy-and-hold.
10. Persiste decisões, snapshots, operações e estado da carteira no PostgreSQL.
11. Restaura o último candle e a carteira paper após reinícios da Railway.
12. Consulta um kill switch persistente antes de acessar o mercado ou executar ordens.

A fonte dos candles não define a corretora de execução. Kraken fornece os candles e a OKX Demo recebe apenas ordens virtuais aprovadas pelas regras quantitativas e pelo filtro de IA.

A IA não cria sinais, não define tamanho da posição e não altera regras de risco. No modo quantitativo ela não é chamada; no modo filtro, indisponibilidade segue `AI_FAILURE_MODE`.

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
- `AI_MODE=quantitative` (padrão, operação independente de IA)
- `GEMINI_ENABLED=true` junto com `AI_MODE=filter` e `GEMINI_API_KEY` (opcional)
- `PAPER_INITIAL_BALANCE_USDT=1000`
- `PAPER_TRADE_SIZE_USDT=100`
- `PAPER_FEE_RATE=0.001` (0,10%)
- `PAPER_SLIPPAGE_RATE=0.0005` (0,05%)
- `PAPER_STOP_LOSS_RATE=0.01` (1%)
- `PAPER_TAKE_PROFIT_RATE=0.02` (2%)
- `RISK_MAX_EXPOSURE_PERCENT=0.25` (exposição máxima de 25% do patrimônio)
- `MAX_CONCURRENT_POSITIONS=2` (limite central; a configuração aceita no máximo 2)
- `RISK_PER_TRADE_PERCENT=0.01` (risco estimado máximo de 1% por operação)
- `RISK_MAX_TRADES_PER_HOUR=3` (limite inicial; a configuração aceita no máximo 5)
- `RISK_MAX_EXPOSURE_PERCENT=0.25` (exposição agregada; a configuração aceita no máximo 30%)
- `RISK_MAX_DAILY_LOSS_PERCENT=0.03` (pausa ao perder 3% no dia)
- `RISK_MAX_DRAWDOWN_PERCENT=0.10` (pausa ao atingir 10% de drawdown)
- `RISK_MAX_TRADES_PER_HOUR=3` (referência operacional; o limite efetivo por intervalo é ajustável no painel)
- `ENTRY_COOLDOWN_MINUTES=60` (intervalo mínimo entre novas entradas no mesmo par)
- `RISK_MAX_CONSECUTIVE_LOSSES=3` (pausa novas entradas após três perdas consecutivas)
- `STOP_LOSS_COOLDOWN_MINUTES=60` (cooldown adicional após stop-loss)
- `DYNAMIC_UNIVERSE_SIZE=10` (quantidade máxima de pares classificados por candle)
- `MARKET_MIN_QUOTE_VOLUME_USDT=1000000` (liquidez mínima do par)
- `MARKET_MAX_SPREAD_PERCENT=1` (spread máximo aceito)
- `UNIVERSE_SWITCH_COOLDOWN_MINUTES=60` (tempo mínimo entre rotações)
- `UNIVERSE_SWITCH_MIN_SCORE_ADVANTAGE=1` (vantagem mínima para substituir um par)
- `UNIVERSE_MAX_REPLACEMENTS=2` (máximo de substituições por candle)
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

### Comparação offline com custos e liquidez (PR 1)

Após `npm run build`, execute `npm run strategy:validate -- --compare input.json`.
O documento de entrada tem `{ "candles": [...], "options": {...} }`. Cada candle
contém `timestamp` (milissegundos), `open`, `high`, `low`, `close` e `volume`
(em ativo base). Apenas candles fechados, contíguos e ordenados de 15 minutos
são aceitos. Logs operacionais exportados pelo painel não são candles e não
servem como conjunto de backtest.

`examples/strategy-comparison.options.json` mostra o formato de `options`.
Os números são exemplos, não taxas, mínimos ou liquidez verificados da OKX,
nem uma cópia certificada da configuração atual. Registre os parâmetros atuais
como `baseline`, a origem dos dados em `dataSource` e as alternativas **antes**
de observar os resultados. Inclua ao menos um cenário estritamente pior de
custos/liquidez. Alternativas não passam por busca de melhor parâmetro no teste.

O relatório inclui SHA-256 dos candles, parâmetros, resultados por janela e
cenário, retorno líquido, expectativa por trade fechado, taxas, drawdown máximo
por janela, estabilidade, entradas rejeitadas e posições abertas ao fim. Até 29
trades ou menos de três janelas recebem `insufficient_sample`; ultrapassar isso
não comprova vantagem estatística. Separe outro período intocado para validar
qualquer hipótese escolhida após a comparação. Não há escolha automática de
vencedor nem aplicação de configuração na operação.

A simulação compra na abertura seguinte ao sinal; não usa o fechamento futuro
como preço de entrada. A quantidade é arredondada para baixo sem elevar o valor
para atingir mínimos. Se stop e alvo forem tocados no mesmo candle, assume stop
primeiro, inclusive no candle de entrada. O spread assumido é acrescentado ao
slippage por lado. A liquidez limita entradas pela profundidade **assumida** e
pela participação no volume do candle anterior, sem consultar volume futuro.
Profundidade histórica real e preenchimentos parciais não são reconstruídos.

Cada janela começa sem posição e com capital novo. O retorno médio não é lucro
acumulado de uma carteira contínua. Posições abertas têm marcação a mercado com
estimativa de taxa de saída, sem liquidar artificialmente como trade fechado.
ATR, rotação de pares, IA e risco agregado de carteira permanecem fora deste
modelo. Este PR entrega a ferramenta; a avaliação empírica ainda exige candles
históricos reais, origem e custos verificáveis. Nenhuma ordem é enviada.

### Compartilhamento do histórico de diagnóstico

O painel oferece JSON e TXT com o mesmo documento JSON em UTF-8. O download
confere status HTTP, estrutura e JSON completo antes de criar o arquivo, usa
nome com data e informa bytes e registros. O servidor valida o documento antes
de enviar, informa o tamanho em bytes e mantém autenticação e `no-store`.
`scope.sectionsAtLimit` lista categorias que atingiram o limite e podem conter
mais eventos além dos exportados; isso é recorte de consulta, não corrupção do
JSON. Falhas de upload em outro aplicativo não podem ser diagnosticadas apenas
com um trecho colado; TXT é uma alternativa de compartilhamento, sem garantia
de aceitação por esse aplicativo.

### PR 2 — saídas gerenciadas e supervisão Demo

`EXIT_MANAGEMENT_ENABLED=false` mantém o caminho operacional anterior.
A supervisão de cobertura continua em cada ciclo, mesmo com entradas pausadas;
ela nunca liga o bot. Ela verifica identidade, compras e vendas comprovadas,
taxas em ativo base, quantidade líquida, saldo e tamanho da proteção ativa.
Resíduo inferior a um lote mínimo de quantidade pode permanecer como dust;
um lote inteiro descoberto bloqueia a entrada, sem aumentar a venda à força.
Uma compra parcial ainda pendente, uma saída parcial sem cobertura do restante,
proteção ausente ou evidência incompleta bloqueiam novas entradas com motivo
em `DEMO_PROTECTION_BLOCKED`. Não há venda de emergência, reposição de stop ou
cancelamento automático baseado em quantidade Paper. Uma situação descoberta
sem proteção exige intervenção; pausar entradas não elimina a exposição já aberta.

A habilitação é deliberadamente separada: `EXIT_MANAGEMENT_ENABLED=true` permite
usar a política persistida em **novas** posições gerenciadas. `EXIT_MODE=fixed`
mantém o alvo; `EXIT_MODE=trailing_atr` omite o alvo fixo da nova proteção e aperta
o stop após candles fechados, com distância `ATR × EXIT_TRAILING_ATR_MULTIPLIER`.
Isso é um stop atualizado pelo servidor, não o trailing nativo da OKX. A primeira
proteção continua hospedada na exchange; com o servidor desligado não há novos
apertos. Posições antigas são auditadas e não são convertidas para trailing.

A ativação usa `EXIT_ACTIVATION_RATE`. `EXIT_BREAKEVEN_ENABLED=true` acrescenta
piso de preço calculado pelo custo real de aquisição dividido pela quantidade
líquida e pelos fatores de taxa/slippage de saída. A taxa Demo é o maior valor
entre o piso configurado e a taxa taker consultada na conta; se essa consulta
falhar, não se presume breakeven. Slippage continua sendo hipótese. Gaps, taxas
alteradas e execução real podem produzir perda mesmo com esse piso.

A política de ATR inicial, alvo/stop e avanço após fechamento é compartilhada
pelo modo gerenciado Paper, pelo backtest e pela Demo. O Paper também ignora
venda por sinal contrário nesse modo. A política de cada posição e seu pico
ficam salvos; mudanças de configuração afetam novas posições. Desligar a gestão
interrompe novos apertos, sem remover os stops já ativos. A recuperação de candles
exige histórico OKX contíguo e aquecimento do ATR; lacunas não são inventadas.
O candle do preenchimento Demo é excluído dos picos para não usar máximas que
podem ter ocorrido antes da compra. Backtest usa abertura seguinte e Paper
operacional usa fechamento; essa diferença de execução ainda existe.

A migração 13 cria `demo_exit_state`. Cada alteração reserva uma versão da linha
e um `reqId` antes da chamada de rede. Atualiza o **mesmo** algo com
`cxlOnFail=false`, sem trocar tamanho, remover alvo existente, cancelar ou criar
outra venda. ACK não confirma aplicação: outra leitura precisa comprovar o novo
stop. Uma resposta incerta deixa a reserva persistida, inclusive após reinício,
sem reenvio automático por timeout. Rejeição explicitamente correlacionada libera
a reserva e bloqueia entradas para revisão; a proteção anterior é preservada.
Durante a espera normal de readback, o ciclo apenas suspende novas entradas e
não altera a pausa manual. Checkpoints do PR50 fornecem pais e fills já provados;
a supervisão não publica P&L nem atribui negociações manuais ao bot.

`examples/exit-policy-comparison.options.json` compara alvo fixo, trailing e
trailing com breakeven, alterando apenas a política de saída. Os valores ainda
são exemplos e não uma configuração aprovada.

Para comparar alvo fixo e trailing, cada `baseline`/alternativa do comando
`--compare` pode conter `exitPolicy` com `mode`, `breakeven`, `atrPeriod`,
`stopMultiplier`, `targetMultiplier`, `minStopRate`, `maxStopRate`,
`trailingMultiplier`, `activationRate`, `exitFeeRate` e `exitSlippageRate`.
Os demais campos recebem os defaults do schema. Fixe os dois modos antes de
observar o resultado e use os mesmos cenários; os custos do cenário substituem
taxa/slippage da política na simulação. Isso compartilha regras, sem reproduzir
latência, fills parciais, risco de carteira ou certificar lucro. Não foi enviada
nenhuma ordem para validar essas opções na conta do usuário.

Referência do protocolo: https://www.okx.com/docs-v5/en/#order-book-trading-algo-trading-post-amend-algo-order

### Optional risk-based sizing

Keep `RISK_SIZING_ENABLED=false` until comparing the alternatives and verifying
Demo behavior. When enabled, the dashboard order size is a ceiling. The bot
divides the per-trade loss budget by the stop distance plus estimated entry and
exit costs, then caps the size by available cash and remaining portfolio limits.
`RISK_MAX_ALT_EXPOSURE_PERCENT` caps all assets other than BTC and the USDT
reserve together. `RISK_MAX_SYMBOL_EXPOSURE_PERCENT` caps each asset.

Demo uses account equity and holdings, including manually held assets. Reserved
USDT counts conservatively toward aggregate and altcoin exposure. It uses the
account taker fee for the instrument and visible ask depth within
`EXIT_SLIPPAGE_RATE`. The order is skipped if it would be below the OKX minimum
after precision and estimated base fee, or if required market data is unavailable.
A change in the Demo order journal between admission and reservation also skips
the entry. Depth and slippage are estimates and market fills or gaps can exceed
the estimated loss.

Paper uses simulated fees, cash, and the tracked positions' entry costs as an
exposure estimate. For comparisons, add an optional `riskSizing` object to an
alternative with `riskPerTrade`, `maxExposure`, `maxAltExposure`, and
`maxSymbolExposure`. Offline comparisons use the scenario's costs, liquidity
and instrument minimums. A single-symbol backtest cannot reproduce simultaneous
portfolio concentration across instruments.
