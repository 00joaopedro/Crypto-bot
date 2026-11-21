# Risco Demo atribuído ao bot

O export de 21/11/2026 registra `demo_daily_loss_limit` às
03:32:39Z (00:32:39 em Belém), sem novas ordens no ciclo observado.
Antes desta correção, `inspectDemoEquityRisk` e a admissão observavam o
patrimônio integral da conta: a oscilação dos BTC/ETH/OKB iniciais também
entrava nas travas do bot. O export não contém o patrimônio exato que acionou
o limite; não é possível reconstruir a porcentagem desse evento só pelo print.

## Cálculo e evidência

Com `OKX_DEMO_BOT_BUDGET_USDT` configurado, a referência passa a ser:

`equity = orçamento + P&L realizado reconciliado + P&L não realizado das posições próprias`

A reconciliação existente confirma conta, journal, propriedade das ordens,
fills, taxas, cobertura de bills e saldos nominais. O ledger fornece quantidade
líquida após taxas base e custo restante, inclusive resíduos. As posições são
marcadas com preços atuais confirmados. Uma cotação ou reconciliação com mais
de dois minutos não é aceita. O P&L não realizado é marcação a mercado, sem
antecipar uma venda ou taxa de saída ainda não ocorrida; taxas realizadas
continuam no ledger.

Os ativos externos não entram na marcação do bot. Depósitos, retiradas e
ordens externas sem atribuição comprovada bloqueiam a entrada como
`demo_bot_risk_attribution_unconfirmed`; o motivo contábil aparece em
`attributionReason`. Não são lançados como ganho/perda e não avançam a
observação persistida. Esta mudança não implementa ajuste automático de
capital após transferências: essas situações precisam ser conciliadas.

Os limites percentuais existentes permanecem iguais. Uma perda própria de
151 USDT contra a referência diária de 5.000 bloqueia pelo limite de 3%,
mesmo que BTC externos tenham valorizado. Uma queda de preço apenas dos BTC
externos, com o ledger do bot inalterado, não aciona essa trava.

## Persistência e migração

O estado atribuído usa a chave por conta `mainUid:uid:bot-equity-v1` na tabela
existente `demo_risk_state`. O estado antigo da conta é preservado e não é
reutilizado como referência de uma carteira diferente. Não há exclusão ou
reset de histórico. Sem orçamento explícito, o modo legado continua medindo
a conta inteira; isso é identificado como `scope: account` na evidência.

A primeira observação do escopo do bot usa o orçamento como referência e
inclui conservadoramente todo o P&L reconciliado desde o marco contábil,
inclusive eventual perda anterior. Nas observações seguintes, preserva o
pico e a referência diária do mesmo dia UTC. Na virada UTC só a referência
diária muda; o pico continua preservado. Reinício e novo ciclo de estatísticas
não apagam as travas. Equity esgotado continua bloqueado mesmo no dia seguinte.

O estado também fixa orçamento e marco contábil. Mudança posterior de qualquer
um deles retorna `demo_bot_risk_basis_changed`, exigindo revisão: aumentar o
orçamento ou criar outro marco não pode apagar perdas acumuladas. Mudança
concorrente do marco durante a inspeção também bloqueia.

O bloqueio registra `riskEvidence`: escopo, orçamento, marco, horário, equity
atual, referência diária, pico, resultado realizado/não realizado, perda e
drawdown proporcionais e limites. A evidência segue para o evento operacional,
log Railway, diagnóstico e última decisão do painel. Retomadas manuais e
automáticas executam o mesmo cálculo; indisponibilidade transitória permite
somente reavaliar, nunca ignorar os demais gates ou desfazer uma pausa manual.

## Validação e implantação

Testes cobrem ativos externos, entrada, retomada, perdas próprias realizadas
e não realizadas, taxas base, resíduos, transferências/bills sem atribuição,
evidência vencida, marcação ausente, mudança de base, esgotamento, virada UTC,
persistência PostgreSQL após reabertura e rollback. O teste do loop verifica
que a pausa mantém a evidência numérica e não gera ordens ou alertas repetidos.

Não é necessária variável nova. A instância em análise já tinha
`OKX_DEMO_BOT_BUDGET_USDT=5000`. Implantar o novo commit é necessário para
alterar o comportamento online; reenviar o deployment antigo pinado não
publica a correção. Após implantação, conferir commit e diagnóstico e pedir
retomada segura. Uma pausa diária já persistida não é apagada pelo deploy:
a retomada manual revalida, ou a automática segue o prazo UTC já programado.
Não é preciso iniciar outro ciclo apenas para recuperar essa pausa.

Uma nova janela final de 48h deve identificar a versão/configuração corrigida
e começar após retomada e reconciliação confirmadas. O teste continua
operacional; a correção não cria sinais de compra, não força trades e não
altera o resultado negativo dos estudos de estratégia anteriores.
