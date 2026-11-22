# Segunda execução — hipóteses de entrada com custos corrigidos

Estado em 22/11/2026: **nenhuma candidata elegível para validação independente**.
Nenhuma estratégia ativa, variável, ordem, deploy ou merge foi alterado.

## Protocolo fixado antes de rodar as variantes

O [plano](../examples/cost-experiments.plan.json) contém exatamente cinco
variantes: referência RSI 70; RSI 63; e margem alvo/custo de 1,5, 2 e 2,5.
São duas hipóteses de entrada, sem combinação posterior e sem busca automática.
Três múltiplos próximos verificam sensibilidade local; o RSI tem apenas um
limiar alternativo e não estabelece estabilidade de parâmetros sozinho.
Todas as tentativas, inclusive as negativas, ficam no
[resumo completo](cost-aware-experiments.json).

A referência é a reconstrução financeira da execução anterior: mesmos 120
ativos congelados, seeds, datas, janela, orçamento de 5.000 USDT, lote de 10,
exposição e até 30 posições. As taxas por par, spread/slippage, saídas ATR fixas,
cooldown e cenários adversos são idênticos entre variantes. O teto RSI 63 é uma
opção apenas deste estudo; o bot ativo continua com seu teto atual.

O filtro econômico estima, no fechamento do candle, o alvo ATR dividido pelo
movimento de preço necessário para cobrir as duas pernas de custos. Taxa de
compra em base e em quote têm fórmulas distintas; nenhuma taxa é debitada duas
vezes. O spread/slippage usa o mesmo proxy do replay. Essa margem não é EV,
probabilidade de atingir o alvo ou promessa de lucro. A ancoragem nativa no ask
continua aproximada; não reconstruímos o livro histórico.

Nenhum candle futuro, preço de preenchimento ou ranking futuro é usado na
admissão. O filtro usa custos padrão nos dois cenários: o estresse altera custos
e liquidez, sem tornar a estratégia retrospectivamente consciente do livro
adverso. Filtros mudam a exposição e o giro observados; limites e tamanho teto
são iguais, mas não afirmamos que o risco realizado foi idêntico.

## Resultados dos blocos de desenvolvimento D11–D30

Dados já consultados, não novos testes cegos. Cada linha tem dois universos
dinâmicos solicitados, acrescidos de seeds fixos. P&L marcado líquido em USDT;
PF calculado pelos fechamentos. O período completo e cada um dos dois blocos
estão no JSON, com expectativa, drawdown, recuperação e concentração de ganhos.

| Variante | P&L 10 / 30 | PF 10 / 30 | Fechamentos 10 / 30 | P&L adverso 10 / 30 |
|---|---:|---:|---:|---:|
| Referência | -38,18 / -97,50 | 0,398 / 0,408 | 447 / 1.078 | -82,71 / -195,23 |
| RSI 63 | -29,38 / -82,44 | 0,413 / 0,376 | 358 / 858 | -65,25 / -161,06 |
| Margem 1,5 | -17,74 / -58,59 | 0,589 / 0,531 | 263 / 713 | -49,47 / -135,37 |
| Margem 2 | -11,77 / -43,38 | 0,670 / 0,585 | 202 / 547 | -37,24 / -103,22 |
| Margem 2,5 | -7,81 / -33,44 | 0,724 / 0,613 | 145 / 406 | -25,46 / -77,13 |

Os **20 resultados são negativos**, assim como cada bloco. Exigir margem maior
reduziu giro e perdas, melhorou PF e expectativa por trade, mas não criou
vantagem líquida. No universo 30, RSI 63 piorou PF e expectativa por trade:
a perda total menor, isoladamente, esconderia essa deterioração. Não promovemos
a variante que perdeu menos, nem extrapolamos melhoria até um limiar lucrativo.

As taxas têm evidência para 6/120 pares; 114 usam fallback declarado de 0,40%
por perna. Não há spread histórico medido. Resultados são condicionais a essas
hipóteses, não prova de que a estratégia é inviável sob qualquer custo ou regime.
Viés de sobrevivência do conjunto e divergências de agenda/controles permanecem.

## Verificações e reprodução

```sh
npm run build
npm run strategy:cost-experiments -- examples/cost-experiments.plan.json DIRETORIO_CONGELADO DIRETORIO_DA_REFERENCIA NOVO_DIRETORIO
```

O diretório da referência contém `study.json` e `summary.json` produzidos por
`execution:calibrate`. O comando verifica hashes de protocolo, estudo, fonte e
cada dataset, além de exigir que o replay da referência reproduza os quatro
resultados financeiros arquivados. Recusa substituir os diretórios de entrada.
Gera resumo e cinco relatórios completos, sem consultar ou operar a corretora.
Os relatórios completos preservam os ledgers; somente o resumo é versionado.

Os testes verificam as duas moedas de taxa, caixa no ponto de equilíbrio,
invariantes de capital/saídas/custos, filtros por par, causalidade temporal,
protocolo restrito, matriz completa, identidade da referência e dados alterados.
A regra opcional de pesquisa não altera resultados do comparador sem essa opção.

## Decisão para a terceira execução

O screen descritivo exige resultado marcado e realizado positivos, PF > 1,
expectativa positiva e pelo menos 30 fechamentos por execução; os dois blocos
precisam ser positivos com pelo menos 15 fechamentos em cada, e o resultado
sem os três maiores ganhos deve continuar positivo. Todos os cenários e ambos
os universos são obrigatórios. Esses pisos não são significância estatística.
Mesmo um passe exigiria protocolo e dados realmente novos, sem promoção automática.

O resultado atual é `blocked_no_eligible_candidate`. A terceira etapa deve
preservar os dados independentes e registrar esse bloqueio; não tratar um replay
novo desta mesma lógica negativa como certificação. Qualquer mudança estrutural
de entrada ou de custos exige hipótese explícita e comparação em desenvolvimento
antes de consumir novos dados. Um teste Demo de 48h ainda pode verificar operação,
mas estes resultados não fundamentam uso real ou expectativa de lucro.

A terceira execução verificou e confirmou esse bloqueio: [avaliação independente](cost-independent-validation.md).
Nenhum período novo foi consumido.
