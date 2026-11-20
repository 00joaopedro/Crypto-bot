# Execução 6 — acompanhamento e decisão sobre um piloto

## Decisão com a evidência disponível

**Não iniciar piloto real.** O resultado reproduzível é `pilot_not_authorized`
em pilot-review-current.json. As variantes de tendência falharam no controle
de desenvolvimento; a hipótese complementar também não demonstrou vantagem.
Não há novo holdout aprovado. Faltam ainda uma janela Demo validada, evidência
de configuração/commit estáveis, fills reconciliados pareados ao modelo e
condições atuais da banca e dos instrumentos. Testes de software verdes não
substituem essas evidências financeiras e operacionais.

A observação contínua de uma nova janela Demo não foi realizada nesta execução.
Não mudamos a configuração de produção nem iniciamos ordens/testes artificiais.
A causa das 48h sem fills permanece pendente do JSON da janela. Não se deve
congelar e tratar como aprovada uma configuração financeira já reprovada.

## Ferramenta de revisão, offline

```
npm run build
npm run pilot:review -- docs/limited-experiments.json
npm run pilot:review -- docs/limited-experiments.json evidencia-demo.json
```

O segundo arquivo opcional aceita apenas os seguintes grupos. Dados ausentes
continuam desconhecidos; o arquivo de saída não copia campos arbitrários:

- `demoStartUtc` e `demoExports`: início UTC e os JSONs originais exportados do
  painel. Usa a mesma avaliação de cobertura, fills, proteção e erros do teste
  de 48h. Uma janela vazia, mesmo coberta, não valida execução.
- `snapshots`: snapshots completos de configuração aplicada do diagnóstico.
  Valida hashes e compara também commit. Dois snapshots iguais são amostras
  consistentes, não prova de freeze contínuo: conferir o journal completo de
  deploys e alterações no período, incluindo alterações que tenham sido revertidas.
- `matchedExecutions`: linhas conciliadas com `symbol`, `side`, `modelPrice`,
  `observedPrice`, `modelQuantity`, `observedQuantity`, `modelFeesUsdt` e
  `observedFeesUsdt`. Desvio de preço é positivo quando adverso à compra/venda.
  A ferramenta não presume que dois fills são a mesma operação: a vinculação
  por ordem, símbolo e horário e a conversão de taxas em moeda base são prévias.
- `capital`: valores atuais em USDT de patrimônio operável, caixa, exposições,
  classificação altcoin, teto do lote, preço, mínimos, incremento, distância de
  stop, custos, liquidez e limites do dimensionamento. O formato e os nomes são
  definidos em `src/pilot-review.ts`. São entradas declaradas, não consultas
  verificadas à OKX; precisam ser confirmadas na conta e instrumento pretendidos.

O tamanho usa o orçamento de risco já existente, custos estimados, concentração
por símbolo/classe, exposição total e caixa. A quantidade é arredondada para
baixo. Se ficar abaixo do mínimo, a entrada deve ser ignorada, nunca ampliada
para operar. A estimativa de perda com stop e custos não garante perda máxima
em gaps ou falhas. Uma banca em BRL requer cotação explícita e saldo USDT
realmente disponível; não presumimos que R$100 sejam US$100, nem usamos o
patrimônio total Demo como se fosse a banca real pretendida.

## Fluxo para acompanhar resultado novo

Após uma hipótese elegível e um protocolo independente aprovado, registrar
commit, hash, horários e limites antes da janela final na Demo. Não alterar
parâmetros para produzir trades. Exportar periodicamente para não perder dados
pelo teto de 500 registros, preservando os arquivos e timestamps. Reinício ou
mudança de configuração devem ficar identificados, sem apagar evidência antiga.
Reexecutar o relatório com os exports acumulados e fills pareados ao modelo.
Divergências devem ser investigadas, não removidas da amostra silenciosamente.

Mesmo um conjunto de verificações favoráveis não habilita dinheiro real por
este código. A decisão sobre um piloto pequeno é humana e requer revisão do
resultado independente, drawdown, custos efetivos, proteção, reinícios,
reconciliação e viabilidade da banca. Este relatório é um auxílio descritivo,
não certificação estatística ou substituto da operação observada. Nenhuma
variável nova, deployment, ordem ou merge foi feito.
