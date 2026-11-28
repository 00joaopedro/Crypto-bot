# Refino econômico — primeira das sete execuções

Estado: diagnóstico descritivo, sem alteração de entrada/saída ou promoção.
A referência anterior foi reproduzida exatamente nos quatro cenários principais;
nenhuma taxa foi reduzida para melhorar o resultado. Os dados de agosto já foram
consultados: não são um novo teste cego.

## Taxas e origem da evidência

Além dos dois diagnósticos de 22/11, foi reexaminado o export de 20/11 às
20:46:39. A compra confirmada de SOL contém fee de 0,000546744 SOL sobre
0,136686 SOL preenchidos: taxa de 0,004, ou 0,40%. A evidência amplia a cobertura
de **6 para 7 pares**: BTC, ADA, DOGE, ETH, NEAR, UNI e SOL. Os outros **113**
continuam com fallback explícito. A hipótese numérica anterior para SOL já era
0,40%, portanto acrescentar essa evidência não mudou o replay financeiro.

Não há novo book pré-compra identificado nos exports: nenhum spread/slippage
histórico foi promovido a observação. As evidências de novembro não provam as
taxas históricas de agosto nem as taxas atuais da conta real. Não foram feitas
ordens de teste, consultas privadas adicionais ou alterações na conta.
O resumo lista os pares ainda sem evidência e a cobertura dos próprios trades.

## Decomposição confirmada

| Universo solicitado | Fechamentos | Antes das taxas, USDT | Taxas, USDT | Realizado líquido, USDT | PF antes/depois das taxas |
|---|---:|---:|---:|---:|---:|
| 10 + seeds | 447 | -2,51 | 35,68 | -38,18 | 0,938 / 0,398 |
| 30 + seeds | 1.078 | -11,48 | 86,02 | -97,50 | 0,894 / 0,408 |

É uma identidade contábil dos fechamentos: **antes das taxas já há spread e
slippage embutidos nos fills**. Não é um replay sem custos, nem prova causal da
parcela de prejuízo atribuível a cada regra. As taxas agravam bastante o
resultado, mas sua eliminação isolada, nessa decomposição, não deixa lucro.
Posições abertas e P&L marcado são apresentados separadamente no relatório.

No universo 10 foram 277 stops e 170 alvos; no universo 30, 678 stops e
400 alvos. A referência é fixa ATR, sem trailing e sem saída por sinal contrário.
Portanto, trailing prematuro não é a explicação única dessas perdas.

## O que o movimento do preço acrescenta

A mediana da extensão do fechamento de decisão acima da EMA21 foi **1,43 ATR**
no universo 10 e **1,38 ATR** no 30. A mediana do ATR/preço foi **0,605%** e
**0,729%**, respectivamente. Isso dá uma base concreta para testar a hipótese
previamente proposta de proximidade/pullback e o piso de volatilidade, mas não
prova que distância de 0,8 ATR ou ATR de 0,75% sejam ótimos.

O movimento médio até o fechamento do primeiro candle após a entrada proxy foi
-0,233% e -0,157%, medido contra o fill de entrada. Esse número inclui o efeito
do spread/slippage de entrada já modelado: não demonstra sozinho compra de topo.
São trades selecionados pela estratégia, não uma comparação causal contra
entradas aleatórias ou todas as oportunidades do mercado.

Excursões durante a posse usam somente candles completos anteriores ao candle
de saída. A cobertura é 405/447 e 985/1.078 trades; saídas no candle de entrada
ficam desconhecidas, não com excursão zero. O candle de saída é excluído porque
sua máxima/mínima pode ter ocorrido depois do stop. Em 154 e 446 trades,
respectivamente, uma máxima nos candles completamente mantidos alcançou o ponto
de equilíbrio estimado. Isso **não comprova uma saída executável ou lucrativa**.

As janelas de 1, 4 e 8 candles também são relatadas, mas podem conter tempo
posterior à saída. Esse fato e as amostras sem horizonte suficiente são explícitos.
Não contam como lucro perdido/recuperável nem são entradas para o bot.
Os resultados por motivo de saída, RSI e estado do filtro BTC são separados;
nenhum grupo é promovido ou removido a partir desse diagnóstico.

## Reproduzir

```sh
npm run build
npm run strategy:economics -- examples/execution-costs.plan.json examples/universe-validation.study.json DIRETORIO_CONGELADO docs/financial-reference-current.json NOVO_DIRETORIO diagnostico22a.json diagnostico22b.json diagnostico20.json
```

Requer o manifesto e os mesmos 120 datasets do artifact congelado. Confere
estudo, nomes, hashes de dados, identidade da referência, custos e resultados.
Uma mudança de custos/configuração que altere a referência exige recalibração
explícita, em vez de misturar referências no mesmo diagnóstico.
O comando gera `summary.json` completo. O
[resumo versionado](economic-diagnosis.json) conserva proveniência, cobertura,
métricas e grupos, sem copiar dados privados dos exports. O ledger é reconstruído
a partir dos mesmos candles e não há consulta à corretora ou ordem.

## Próximas seis etapas

A segunda execução testa pullback/proximidade e RSI com saídas/custos comuns.
A terceira isola volatilidade e saída; a quarta pesquisa reversão à média offline.
Todas são implementáveis sem ativar regras novas na Railway.

A quinta, carteira combinada, só tem benefício justificável se houver estratégias
com evidência útil — não combinamos perdas para forçar diversidade. A sexta
executa dados novos apenas após candidata e protocolo congelados; sem candidata,
seu resultado é bloqueio de prontidão. A sétima integra uma versão selecionada e
verifica execução/minímos/proteção antes da janela final de 48h. Sem candidata
aprovada, ainda podemos testar infraestrutura, mas não apresentá-la como versão
financeiramente validada. Duas ou três estratégias não são um requisito.

Nenhuma variável, deploy, merge ou liberação de dinheiro real nesta execução.
