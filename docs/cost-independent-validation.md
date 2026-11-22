# Terceira execução — prontidão para validação independente

Resultado de 22/11/2026: **bloqueada por ausência de candidata elegível**.
A execução desta etapa é a conferência e decisão reproduzível, não um backtest
cego concluído. Nenhum período novo foi coletado, aberto ou simulado. Não houve
mudança no bot ativo, Railway, variáveis, ordens, fundos ou merge.

## Resultado concreto

A segunda etapa registrou cinco variantes × dois universos × dois custos,
totalizando 20 comparações. Todas tiveram resultado marcado, realizado e
expectativa negativos. O melhor PF padrão foi 0,724 no universo 10 e 0,613 no
universo 30; os custos adversos pioraram ambos. Exigir mais margem alvo/custo
reduziu perdas, mas não produziu candidata lucrativa nas hipóteses testadas.

O [relatório desta etapa](cost-independent-readiness.json) recalcula o screen
pelos números, ignorando flags de aprovação editáveis no relatório de entrada.
As cinco candidatas estão com `readyToFreeze=false` e o estado é
`blocked_no_eligible_candidate`. Não promovemos a menos negativa. A parte
financeira continua sem aprovação; completar três etapas não altera esse fato.

```sh
npm run build
npm run strategy:independent-readiness -- docs/cost-aware-experiments.json docs/financial-reference-current.json examples/universe-validation.study.json
```

O modo antigo com `docs/limited-experiments.json` continua disponível e separado.
Seu relatório de 18 comparações não substitui a matriz atual de 20. Código de
saída zero significa relatório produzido, não estratégia aprovada.

## O que é verificado

- Protocolo, estudo-fonte, referência financeira, configuração e commit atribuídos.
- Mesmos hashes de datasets, sem símbolos duplicados; cobertura de taxas coerente.
- Matriz completa de cinco variantes, dois universos e dois cenários, sem duplicatas.
- Referência numérica idêntica à da primeira etapa, incluindo os dois blocos.
- Soma dos resultados e fechamentos dos blocos, expectativa × quantidade de trades,
  fator de recuperação e resultado após remoção dos três maiores ganhos coerentes.
- Critérios da segunda etapa em todos os cenários: resultados marcado e realizado
  positivos, PF > 1, expectativa positiva, ao menos 30 fechamentos por execução,
  ambos os blocos positivos com ao menos 15 fechamentos e resultado ainda positivo
  sem os três maiores ganhos. São filtros de desenvolvimento, não prova estatística.
- Para uma futura candidata de margem alvo/custo, seus três limiares vizinhos
  precisam passar. O RSI 63 isolado não tem evidência de estabilidade local e,
  mesmo se passasse no screen, não estaria pronto para congelamento por si só.

Os hashes verificam consistência, não autenticidade dos exports nem a verdade dos
resultados. Permanecem taxas comprovadas em 6/120 pares, 114 fallbacks e hipóteses
de livro, slippage, sobrevivência e execução já documentadas na referência.

## Protocolo futuro, condicionado a uma candidata aprovada

O comando aceita opcionalmente um quarto arquivo `freeze.json`. Com a evidência
atual ele falha antes de abrir esse arquivo. Mesmo dados sintéticos positivos
nos testes só permitem preparar um protocolo, jamais declarar lucro validado,
executar um replay, autorizar conta real ou enviar ordem.

Um protocolo futuro precisa fixar commit, candidata, hashes da evidência e da
referência, universo, capital/risco e custos. Define 20 dias de avaliação em dois
blocos de 10, candles de 15m e aquecimento suficiente. Os critérios projetados
para esse protocolo são resultado marcado e realizado positivos em cada bloco,
pelo menos 30 fechamentos e PF mínimo 1,25 por bloco, sem alterar custos/risco.
Esses valores são escolhas do projeto; não garantem lucro futuro e não substituem
análise de incerteza, concentração, regimes ou simulação adversa.

A fonte já consultada ocupa **25/07/2026 00:00 UTC a 31/08/2026 00:00 UTC**,
incluindo 672 candles de aquecimento. O validador recusa sobreposição da avaliação
ou do seu aquecimento com esse intervalo ou com outras janelas declaradas como
consultadas. O histórico completo de consultas também deve ser registrado: o
código não consegue provar que a declaração de dados inéditos é verdadeira.
Não escolhemos datas independentes agora e não reservamos um período já lido
como se fosse novo. Preparação não equivale a execução ou validação de dados.

## Como avançar com foco

O bloqueio indica que os ajustes leves avaliados não resolveram a vantagem da
entrada/saída nas condições de custo atuais. O próximo avanço de estratégia
exige uma hipótese estrutural explícita em desenvolvimento, com poucas variantes
e referência comum; não aumentar uma grade de parâmetros até encontrar lucro.
Antes de atribuir o problema exclusivamente à lógica, a cobertura de taxas e
custos reais dos pares candidatos ainda precisa ser melhorada: grande parte
permanece estimada. Nenhuma dessas incertezas justifica reduzir artificialmente
os custos do teste ou ampliar exposição para produzir trades.

A janela Demo de 48h pode verificar integração com versão/parâmetros congelados.
Ela não deve ser apresentada como confirmação de rentabilidade nem como etapa
que libera automaticamente os R$100 pretendidos. Uma candidata com evidência
favorável fora da amostra, execução correta e mínimos/risco compatíveis com o
saldo efetivo em USDT continua sendo necessária para avaliar um eventual piloto.
