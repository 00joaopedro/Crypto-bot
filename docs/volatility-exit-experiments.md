# Refino econômico — execução 3: volatilidade e saídas

Execução de desenvolvimento offline em 22/11/2026. Estado:
`blocked_no_eligible_candidate`. Sem merge, ordem, alteração ativa ou deployment.

## Protocolo e isolamento

`examples/volatility-exit-experiments.plan.json` fixa quatro alternativas antes
do replay, avaliadas nos universos 10/30 e nos dois cenários financeiros:

1. Referência original, saída fixa ATR14.
2. Somente piso de volatilidade: ATR14/fechamento ≥0,0075 (0,75%).
3. Somente trailing, mantendo também o alvo fixo original.
4. Somente trailing, substituindo o alvo fixo original.

A entrada é a referência anterior, sem incorporar os pullbacks reprovados, RSI58
ou combinar o piso ATR com trailing. Não se procura uma combinação positiva após
ver os resultados. Os dois modos de alvo são explícitos porque o modo trailing
anterior removia o alvo; mantê-lo poderia encerrar antes da ativação.

Mesmo capital 5.000 USDT, teto 10 USDT, seeds, datas, custos por par, seleção de
universo, filtros, cooldown e limites de exposição/posições. Os níveis iniciais
ATR, multiplicadores 1,5/3, piso de stop 0,5% e teto 3% permanecem. A remoção do
alvo pode prolongar posições e alterar entradas futuras: os resultados comparam
políticas de carteira, não apenas saídas pareadas dos mesmos trades.

## Ativação líquida e proteção

O trailing só ativa depois de um candle **sobrevivente fechar** com valor de
liquidação estimado pelo menos 1,2% acima do desembolso. Considera a quantidade
líquida de taxa em base, desembolso com taxa em quote, taxa de venda e proxy de
spread/slippage da saída. O preço de entrada já inclui spread/slippage de compra;
não se cobra a compra novamente. O cenário adverso usa seus próprios custos,
pois o limiar é retorno líquido, não um movimento bruto idêntico.

Preço de ativação = desembolso × 1,012 ÷
(quantidade líquida × (1 − taxa de saída) × (1 − slippage efetivo de saída)).

Na referência observada, isso exige aproximadamente **2,1934% acima do fill de
entrada no cenário padrão e 3,2004% no adverso**. Um pico intrabar de 1,2% ou até
um pico acima do limiar líquido, sem fechamento confirmando, não ativa.

Ativação fica registrada. A distância é 1,5 ATR14; o stop nunca diminui e conserva
a proteção inicial até haver atualização válida. O novo nível só vale no candle
seguinte, e proposta já cruzada no fechamento é descartada. Se alvo e stop forem
tocados no mesmo candle, prevalece o stop conservador. Gap abaixo do stop usa
abertura pior, sem garantir perda máxima ideal. Sem saída por sinal contrário.

Ativar em +1,2% líquido **não garante realizar nem proteger +1,2%**: a distância
do trailing, reversão, custos e gaps podem consumir esse ganho. O watermark é de
máximas já conhecidas ao fechamento, não uma ordem retroativa no melhor preço.
Os stops gerenciados mantêm o rótulo `STOP_LOSS` no ledger; esse rótulo também
pode representar um stop elevado que fechou com ganho.

A opção `researchTrailing` é restrita aos comandos offline, sem mapeamento em
variáveis ou painel. A política compartilhada operacional e seus padrões não
mudam; a referência foi reproduzida exatamente nos quatro recortes. Estado de
pesquisa preserva a ativação ao exportar/restaurar para testes reproduzíveis.

## Todos os resultados

P&L marcado considera posições abertas restantes. PF e expectativa usam apenas
fechamentos; expectativa em USDT por trade. Nenhuma das 16 combinações é positiva.

| Entrada/saída | Universo | Cenário | Fechamentos | P&L USDT | PF | Expectativa USDT | Drawdown USDT |
|---|---:|---|---:|---:|---:|---:|---:|
| Referência | 10 | Padrão | 447 | -38,1826 | 0,3982 | -0,085420 | 38,1826 |
| Piso ATR 0,75% | 10 | Padrão | 212 | -12,7040 | 0,6560 | -0,059925 | 13,3953 |
| Trailing com alvo | 10 | Padrão | 469 | -39,8494 | 0,3714 | -0,084967 | 39,8494 |
| Trailing sem alvo | 10 | Padrão | 398 | -26,1562 | 0,5525 | -0,065719 | 26,1562 |
| Referência | 30 | Padrão | 1078 | -97,5024 | 0,4079 | -0,090447 | 97,5024 |
| Piso ATR 0,75% | 30 | Padrão | 568 | -44,6858 | 0,5821 | -0,078672 | 44,6858 |
| Trailing com alvo | 30 | Padrão | 1132 | -103,2356 | 0,3657 | -0,091198 | 103,2356 |
| Trailing sem alvo | 30 | Padrão | 947 | -72,7665 | 0,5083 | -0,076729 | 72,7668 |
| Referência | 10 | Adverso | 405 | -82,7093 | 0,1310 | -0,204220 | 82,7093 |
| Piso ATR 0,75% | 10 | Adverso | 215 | -38,8889 | 0,2675 | -0,180879 | 38,8889 |
| Trailing com alvo | 10 | Adverso | 411 | -81,8859 | 0,1252 | -0,199236 | 81,8859 |
| Trailing sem alvo | 10 | Adverso | 361 | -60,2044 | 0,2907 | -0,166771 | 60,2044 |
| Referência | 30 | Adverso | 947 | -195,2272 | 0,1527 | -0,206153 | 195,2272 |
| Piso ATR 0,75% | 30 | Adverso | 555 | -106,4203 | 0,2599 | -0,191748 | 106,4203 |
| Trailing com alvo | 30 | Adverso | 971 | -196,3345 | 0,1354 | -0,202198 | 196,3345 |
| Trailing sem alvo | 30 | Adverso | 845 | -149,6433 | 0,2796 | -0,176855 | 149,6436 |

## O que melhorou e o que continua reprovado

O piso ATR melhorou PF e expectativa nos quatro recortes; isso é diferente da
mera redução de operações encontrada na proximidade EMA21. No padrão, PF passa
de 0,398/0,408 para 0,656/0,582 e expectativa de -0,0854/-0,0904 para
-0,0599/-0,0787. Contudo, PF permanece abaixo de 1, expectativa negativa e os
**dois blocos de desenvolvimento continuam negativos**. Não há candidata aprovada.

Trailing com alvo fixo não trouxe melhora consistente: no cenário padrão,
P&L piora para -39,85/-103,24 USDT e PF cai para 0,371/0,366. Sem o alvo fixo,
PF e expectativa melhoram em todos os recortes, mas o líquido ainda perde
-26,16/-72,77 USDT no padrão. No universo 30 resta uma posição aberta no fim,
tanto no padrão quanto no estresse; os valores não omitem essa posição.

A decomposição dos fechamentos antes das taxas, que ainda contém spread/slippage
embutidos nos fills, fica positiva no padrão: piso ATR +4,24/+0,66 USDT e trailing
sem alvo +5,64/+2,96. É um movimento melhor, porém insuficiente para pagar as taxas.
Não é simulação com taxas reais menores, prova causal do efeito isolado dos custos
nem autorização para trocar por uma taxa genérica mais favorável. No estresse,
essa mesma decomposição já volta a ser negativa.

## O alvo impede o trailing?

Nos fechamentos da referência, o alvo inicial ficava abaixo do preço necessário
para ativação líquida em **267/447 trades (universo 10) e 571/1.078 (30)** no padrão.
Desses, 97 e 210 efetivamente saíram pelo alvo. No estresse: 317/405 e 681/947,
com 105/228 saídas pelo alvo abaixo do limiar. É uma comparação geométrica da
referência, sem afirmar a ordem intrabar nem simular venda no fechamento ideal.

Na política com alvo mantido, apenas 57/469 e 166/1.132 posições ativaram trailing
no padrão; 134 e 293 saíram pelo alvo sem ativação prévia. Sem alvo, 140/398 e
329/948 posições ativaram. Os universos diferem porque saídas alteram ocupação e
reentradas. Parte dos alvos encerra antes de o trailing poder atuar; remover os
alvos **não resolveu a expectativa negativa**.

## Evidência, reprodução e limites

Mesmos 120 datasets congelados do artifact `14766053034`, com todos os hashes
conferidos contra a referência financeira e `source.json`. O estudo completo
`examples/pullback-reference.study.json` continua com hash
`d09d84a1df93330abaf253d203c4acc11ec96d7c5c74e2b42609dc8a9c647919`.
A baseline reproduziu exatamente P&L, PF, fechamentos e drawdown arquivados.

```sh
npm run build
mkdir -p /tmp/volatility-exit-reference
cp examples/pullback-reference.study.json /tmp/volatility-exit-reference/study.json
cp docs/financial-reference-current.json /tmp/volatility-exit-reference/summary.json
npm run strategy:volatility-exits -- examples/volatility-exit-experiments.plan.json DIRETORIO_CONGELADO /tmp/volatility-exit-reference NOVO_DIRETORIO
```

O comando valida identidade, hashes e matriz, preserva os inputs e mantém todas
as tentativas. Gera resumo e os quatro relatórios com ledger completo; o resumo
publicado é `docs/volatility-exit-experiments.json`. Nenhuma consulta à corretora.
Taxas: identidade financeira antiga registra 6 pares; diagnóstico posterior
registra 7 com SOL, sem mudança do valor numérico e do hash. 113 sem evidência
específica. Taxas Demo exportadas não comprovam taxas históricas nem da conta real.

Dados de agosto já foram inspecionados: desenvolvimento, não novo holdout.
Sobrevivência do pool, OHLC, histórico de mínimos/região, custos de livro e
agendamento/risco operacional têm as mesmas limitações anteriores. Os relatórios
separam taxas totais de taxas dos fechamentos quando há posição aberta; P&L
marcado e realizado não devem ser confundidos. O orçamento não representa R$100.

O filtro de desenvolvimento exige lucro marcado/realizado, PF >1, expectativa
positiva, mínimo 30 fechamentos, dois blocos com pelo menos 15 e retorno positivo,
e retorno sem os três melhores trades positivo. Mesmo aprovação nesses critérios
não é promoção automática ou validação independente. Nesta execução todas as
variantes continuam bloqueadas; não foram ajustados novos limiares.

## Continuação objetiva

A execução 2 reprovou as regras testadas de pullback; taxas não são a explicação
única, porque a referência também perdia antes das taxas. A execução 3 encontrou
melhor movimento em volatilidade maior e em trailing sem alvo, porém sem vantagem
líquida. Isso é progresso de diagnóstico, não bot lucrativo.

Próxima hipótese planejada: execução 4, reversão à média offline com rejeição
confirmada, proteção e espaço até SMA20 após custos, fixada antes do replay.
Carteira combinada só tem fundamento com candidatas justificáveis; não somar
estratégias negativas para forçar diversidade. Dados novos e integração financeira
continuam condicionados. Se não houver candidata, revisar estratégia/custos e
registrar bloqueio, em vez de colocar dinheiro real por ter concluído as etapas.

## Validação

15 testes novos: fórmula líquida em ambas as moedas; ativação por fechamento,
watermark, persistência, gap, proteção inicial, alvo opcional e prioridade do stop;
piso ATR causal com entrada posterior; invariantes, parâmetros congelados,
matriz incompleta, resultado negativo e pequenas amostras; CLI offline com hashes,
referência adulterada e preservação dos inputs. Suite local com `CI=true`:
506 aprovados, 20 PostgreSQL pendentes de CI. Tipagem, build, replay integral e
diff check aprovados. CI verifica PostgreSQL, Docker e smoke móvel após publicação.
