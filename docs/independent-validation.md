> Este documento registra a matriz legada de 18 comparações. A avaliação atual
> das 20 comparações com custos corrigidos está em
> [terceira execução](cost-independent-validation.md).

# Execução 4 — passagem para validação independente

A terceira etapa perdeu em todos os 18 cenários. Por isso esta etapa termina
com `blocked_no_eligible_candidate`, sem consumir um novo período como holdout.
Não promovemos a variante com menor prejuízo nem a que melhora apenas um custo.
O resultado reproduzível está em independent-validation-readiness.json.

```
npm run build
npm run strategy:independent-readiness -- docs/limited-experiments.json
```

O controle confere a matriz completa (três variantes × dois universos × três
custos), rejeita duplicatas/dados inválidos e registra o hash da evidência.
Para cada candidato, exige retorno marcado positivo, PF dos fechamentos acima
de 1 e ao menos 30 fechamentos em cada cenário. São critérios conservadores
específicos deste protocolo de desenvolvimento, não requisitos universais ou
prova estatística. Não há busca automática por parâmetros ou seleção de vencedor.
Código de saída zero significa que o relatório foi produzido, não aprovação.

Mesmo uma evidência sintética que passe só retorna `frozen_protocol_required`.
Antes de ler dados independentes será preciso fixar commit, parâmetros, universo,
capital/risco, regras de custos, hashes da fonte de desenvolvimento, datas dos
períodos já consultados (incluindo aquecimento), datas independentes e critérios
de avaliação. O aquecimento também não pode sobrepor a fonte usada para ajuste.
O protocolo deve distinguir histórico retrospectivo dos vieses do conjunto de
instrumentos atuais e de um verdadeiro acompanhamento prospectivo.

A avaliação posterior não poderá trocar a configuração em função do resultado
cego. Resultado negativo reprova a hipótese; uma nova hipótese exige nova
validação independente. Passar pelo controle não resolve diferenças entre os
motores ou libera dinheiro real. Nenhum parâmetro, deploy ou merge foi feito.

## Próxima decisão técnica

Não há configuração elegível para congelar agora. O próximo trabalho é revisar
a hipótese de entrada/saída, com poucos experimentos novos previamente definidos
nos dados de desenvolvimento, em vez de repetir ajustes até acertar um holdout.
A execução operacional de 48h segue separada: o motivo de zero fills continua
pendente do JSON correspondente à janela. Este controle não corrige nem mascara
esse problema. Não se deve confundir cobertura temporal do export com execução
ou rentabilidade validadas.
