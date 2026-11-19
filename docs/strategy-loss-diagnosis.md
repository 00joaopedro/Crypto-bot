# Execução 2 — diagnóstico das perdas

Esta etapa explica os resultados já obtidos, antes de escolher refinamentos.
Não altera a estratégia de produção, o orçamento, os limites de perdas ou o
universo da Railway. Continua no PR 61, que ainda não foi integrado à main.

## Dados e reprodução

Reutilizamos o artifact `okx-universe-validation`, ID `14557315647`, do
[workflow original](https://github.com/00joaopedro/Crypto-bot/actions/runs/44574679437).
O ZIP foi conferido com SHA-256
`ecacf7320da8a0d7fe0e09842028869479f306a6f42539270dc0c986836ed75d`.
Contém 120 pares, 3.552 candles de 15 minutos por par, manifesto, mínimos e
incrementos congelados. Os dados incluem aquecimento e agosto de 2026.
Taxas, spread e slippage continuam sendo hipóteses, não taxas atuais da conta.

Os 15 resultados (cinco universos × três cenários) preservaram exatamente o
P&L realizado e marcado, PF, número de fechamentos, caixa, posições abertas e
drawdown publicados no estudo original. O diagnóstico acrescenta informação;
não escolhe novas entradas nem modifica os fills para melhorar o resultado.
O ledger registra o RSI e o estado do filtro BTC disponíveis no candle de
decisão, antes da execução, usando a mesma janela do estudo. Há teste que
altera candles posteriores e confirma que o contexto de entrada não muda.

Depois de extrair o artifact para um diretório de trabalho:

```sh
npm run build
npm run strategy:universe -- examples/universe-validation.study.json ./dados/.universe-data
npm run --silent strategy:diagnose -- --portfolio ./dados/.universe-data/report.json > diagnostico.json
```

Relatórios agregados antigos não contêm todos os fechamentos: o CLI os rejeita
em vez de reconstruir perdas a partir dos três maiores ganhos. A reprodução
exige os datasets completos e confere seus hashes pelo coletor existente.
O JSON completo fica no diretório de trabalho; a
[síntese arquivada](strategy-loss-diagnosis.json) conserva as identidades dos
dados, métricas e grupos do cenário padrão, sem incorporar candles ao git.

## Resultado descritivo

Todos os valores abaixo são USDT simulados dos fechamentos de D11–D30.
O ganho antes das taxas já contém o efeito de spread/slippage nos preços.

| Universo | Fechamentos | Antes das taxas | Taxas dos fechamentos | Líquido | PF líquido |
|---|---:|---:|---:|---:|---:|
| 15 | 41 | −0,3527 | 0,8196 | −1,1723 | 0,534 |
| 30 | 57 | +0,5362 | 1,1405 | −0,6043 | 0,849 |
| 50 | 56 | +0,5283 | 1,1204 | −0,5922 | 0,844 |
| 100 | 56 | +0,5283 | 1,1204 | −0,5922 | 0,844 |
| Todos os validados | 56 | +0,5283 | 1,1204 | −0,5922 | 0,844 |

No universo de 15, a perda já existe antes de descontar as taxas. Em 30 e
50, há ganho bruto pequeno, insuficiente para pagar as taxas assumidas.
Essa decomposição não simula o que ocorreria com custo zero: entradas,
quantidades, pausas e limites poderiam mudar em outro replay.

No padrão com 30 pares, 32 stops somaram −4,0141 USDT líquidos e 25 alvos
somaram +3,4099 USDT. O ganho médio foi aproximadamente 0,1364 e a perda média
0,1254 USDT. A taxa de acerto foi 43,86%; com esses ganhos e perdas médios
observados, o equilíbrio descritivo exigiria aproximadamente 47,91%.
Não é uma meta garantida ou evidência causal de que ampliar o stop resolveria.
Nenhum fechamento desse recorte mudou de ganho bruto para perda apenas por
taxas; o problema aparece no agregado da relação entre ganhos, perdas e custos.

Os 31 fechamentos com RSI de entrada acima de 63 até 70 somaram +0,3201 USDT.
Os 26 restantes somaram −0,9244. É uma separação retrospectiva com amostra
pequena: não sustenta comprar somente acima de 63 e também não sustenta assumir
que reduzir automaticamente o teto para 63 melhoraria esse resultado.

Os três maiores ganhos explicam 33,47% dos ganhos líquidos positivos no padrão
com 30; removê-los deixa −1,7456 USDT realizados. Esse cálculo é sensibilidade
contábil, sem reexecutar as mudanças de carteira que sua remoção causaria.
O denominador é a soma dos ganhos positivos, não o lucro líquido da carteira.

O filtro BTC estava habilitado e as entradas desse estudo passaram por ele.
Não há grupo comparável de entradas bloqueadas para atribuir causalmente o
resultado ao regime. As tabelas por par não autorizam banir moedas pela amostra.
Os bloqueios de exposição do relatório original são oportunidades repetidas,
não ordens rejeitadas pela corretora; não somam trades independentes.

## Como usar com um novo diagnóstico Paper

```sh
npm run --silent strategy:diagnose -- --paper diagnostico-do-painel.json > perdas-paper.json
```

O comando lê somente fechamentos Paper, junta decisões pelo mesmo par e
timestamp de entrada, separa configurações e tamanhos e sinaliza seções que
atingiram o limite de exportação. Duplicatas idênticas não dobram o P&L;
duplicatas conflitantes e contabilidade inconsistente são rejeitadas.
Contexto ausente/ambíguo continua desconhecido. Não aplica o snapshot atual
a posições antigas. O arquivo de saída não copia credenciais ou outros
campos arbitrários da entrada e registra seu SHA-256.

Ordens Demo não são convertidas em trades fechados: precisam de conciliação
de ida e volta, taxas e saldo. Paper também pode conter replay; os registros
exportados não permitem identificá-lo de forma confiável. Por isso, o resultado
não é apresentado como forward test ou evidência financeira da conta Demo.
Operações abertas e drawdown marcado devem ser avaliados no relatório de
carteira, não inferidos a partir do ledger de fechamentos.

## Hipóteses para a próxima execução

1. Fixar uma referência de saídas que corresponda ao modo Demo escolhido.
   A diferença entre trailing Paper legado e proteções Demo fixas identificada
   na Execução 1 ainda impede chamar os motores de equivalentes.
2. Comparar uma alteração de entrada e uma de saída por vez, preservando
   capital, risco e cenários de custo. Por exemplo, recuo após tendência versus
   entrada atual, e alvo fixo versus trailing gerenciado. Declarar os candidatos
   antes de ler novos resultados; evitar uma busca extensa de parâmetros.
3. Usar o período já inspecionado apenas para desenvolvimento. Congelar a
   hipótese antes de consultar dados independentes; não selecionar moedas ou
   teto de RSI pelas tabelas desta análise.

Ainda não há evidência para promover uma variante ao mercado real. Não há
variável nova para configurar, deployment ou novo ciclo Demo nesta etapa.
