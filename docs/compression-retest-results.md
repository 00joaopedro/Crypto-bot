# Execução2 — compressão/rompimento com reteste, resultado

28/11/2026. Avaliação concluída: **blocked_no_eligible_candidate**. Uma operação no cenário padrão, negativa; zero no adverso. Não há candidata aprovada para Demo/real, nova48h ou validação independente.

## Congelamento e fontes

Regras, implementação e oito testes sintéticos publicados antes do primeiro scan/replay no commit `a8a5dd973db08685725cd79546e222d88a625793`. SHA256 dos bytes do protocolo `1a6ef05932f597ea5834f280b0be4301e253ef58454d18a49fb65fdeea168d32`. Nenhuma alteração de entrada,5minutos de validade, custos, stop/alvo/trailing ou critérios após o resultado. O commit seguinte acrescenta manifesto e coleta; o último arquiva os resultados/diagnóstico.

Mesma fonte conhecida90d1h,24/08–22/11/2026UTC exclusivo,1000h warmup; dataset `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`. BTC/ETH/SOL predefinidos. Nova fonte1m contém1200candles confirmados em20janelas de60minutos, sem lacunas/conflitos e coerentes com1h. Catálogo público coincide com regras congeladas de quantidade/passo/tick; isso não autentica mínimo de valor, conta, regras históricas ou disponibilidade naDemo.

Minutos SHA256 semântico `41597bafcc228485d6c92223463f3becbf22379c8e7d6a32f429c341bf2a5092`. Origem: [run46170768079/artefato15273502183](https://github.com/00joaopedro/Crypto-bot/actions/runs/46170768079/artifacts/15273502183), ZIP SHA256 `dd2ec5b7b72be2da13e39dc7b81838f40e0ac6ec36f3ac658fc67cd4d56ebf16` verificado antes da extração local. CI e replay local produziram resumos/ledgers idênticos byte a byte. Cache ausente restaura essa fonte exata; divergência é recusada antes de consultar desempenho. Não há recolhimento silencioso de dados diferentes.

## Resultado completo

| Métrica | Maker0,10%/taker0,40%, padrão | Custos dobrados/adverso |
|---|---:|---:|
| Sinais brutos |20|20|
| Ordens simuladas colocadas |9|0|
| Ordens preenchidas no modelo |1|0|
| Ordens expiradas sem preencher |8|0|
| Fechamentos |1|0|
| Resultado líquido USDT |-0,038156|0|
| PF |0|indefinido|
| Expectativa por fechamento USDT |-0,038156|indefinida|
| Win rate |0%|indefinido|
| Taxas modeladas USDT |0,008374|0|
| DD máximo modelado |0,22445%|0%|
| Patrimônio final simulado |16,961844|17|

Sem posições abertas ou reservas pendentes ao final; nenhuma ordem na corretora. Recuperação padrão-1. As três janelas sequenciais30d tiveram P&L padrão0/-0,038156/0 e adverso0/0/0. Top3de lucros não é estimável sem ganhos; resultado semtop3 permanece negativo no padrão e0no adverso. Os critérios de amostra>=30,PF>1,25,EV/retorno positivos, blocos positivos e ganho semtop3 falharam; respeitar DD<10% isoladamente não aprova nada.

Uma operação negativa não prova que toda estratégia de compressão seja ruim. Também não demonstra expectativa positiva. A combinação de amostra escassa, resultado negativo e ausência de admissões no adverso não justifica promover esta formulação. Não aumentar a janela, mudar validade ou escolher outro alvo depois de observar esse resultado para apresentá-lo como aprovação do mesmo teste.

## Funil e execução

2159decisões1h elegíveis por par;6sinaisBTC,7ETH,7SOL.20sinais após transição; mesmo preenchendo todos, não seria possível alcançar30fechamentos nesta janela. Contadores independentes de regime/compressão/volume se sobrepõem; não são operações independentes.

Padrão:10rejeições pelo gate líquido e1pela prioridade compartilhada;9ordens colocadas. Oito não penetraram/preencheram pelo modelo dentro dos5minutos e expiraram, uma preencheu. Taxa de preenchimento modelada1/9=11,11%, não estatística de execução real naOKX. Não houve parcial histórico; o preenchimento foi completo em um evento. As proteções/partials continuam validadas por testes sintéticos, não nativamente.

Adverso:20rejeições pelo gate antes de colocar ordens. Não é um segundo teste dos mesmos fills com taxa maior. Zero perdas sem operações não é estratégia lucrativa. Quantidade mínima não foi bloqueio nas20propostas estáticas de17USDT em nenhum custo.

## Operação SOL e diagnóstico de custos

Compra simulada SOL/USDT em04/10/2026 às07:01Belém, limite121,31, quantidade bruta0,014013, valor1,699917USDT. Fechamento por stop na vela de05/10às11:00–12:00Belém; não há timestamp nativo exato. Saída modelada119,19096045, quantidade vendável0,013998, poeira0,000000987SOL explicitada; holdingUpperBound1739minutos. Não houve uso de capital real.

Resultado-0,038156USDT; taxas estimadas0,008374. Somando as taxas registradas ao resultado ainda-0,029782; restaurando quantidade anterior às taxas/poeira nos mesmos fills, ainda-0,029694. Retirando também o atrito modelado do MESMO percurso de referência de saída, ainda-0,026765. São atribuições contábeis do percurso selecionado, não outro backtest com entradas/gates mais baratos.

MFE anterior à vela de saída0,8161% e MAE1,0716% sobre o fill. Excluídos minuto de entrada e vela de saída; misturam minutos integralmente detidos na hora de entrada com horas completas posteriores. Não afirmam uma saída lucrativa executável, melhor stop ou preço garantido. Não ajustar regras por essa excursão observada.

## Trailing: alvo bruto versus risco líquido

Nenhum stop foi atualizado pelo trailing. Nos nove pedidos padrão, payoff líquido projetado no alvo ficou entre1,5383 e1,9791R, abaixo do gatilho de2Rlíquidos. Portanto, o alvo fixo3R**bruto** antecedia esse gatilho nas propostas preenchidas integralmente. A possível incompatibilidade foi descrita no protocolo ANTES do replay e agora foi quantificada; não foi ocultada ou corrigida depois com outro alvo.

A única posição ainda teve pouco movimento favorável para aproximar esse gatilho. Não atribuir o resultado a trailing prematuro: ele não atuou. O código de atualização futura foi testado sinteticamente, incluindo custos/gaps, mas esse trade histórico não valida seu desempenho econômico.

## Implementação e validação

Scanner próprio paraATRrelativo/quatro velas/range12/volume/deslocamento e reteste maker. Reutilizados coletor de minutos e ledger de ordens da hipótese1. Política de trailing exige seleção explícita e só usa fechamentos/ATR conhecidos, valendo para a hora seguinte; default de saídas fixas anterior preservado. A primeira hipótese reproduziu os mesmosJSONs após essa extensão, sem modificar suas59rejeições ou resultados.

Oito testes novos: ATRalinhado/sem futuro, compressão/range anterior excluindo rompimento, macro/warmup/volume/displacement, contexto futuro,2Rlíquido versus bruto, stop que não diminui/proposta cruzada, atualização somente na próxima hora, gap e isolamento do modofixo. Tipagem/build passaram; suíte local704aprovados+32dependentes deCI,736totais. CI final e sua reprodução dos estudos antigos/novos são registrados noPR.

```sh
npm run build
npm run strategy:compression-retest -- --replay /CAMINHO/frozen1h.json /CAMINHO/minutes.json /NOVO_DIRETORIO
node scripts/compression-retest-diagnosis.mjs /CAMINHO/frozen1h.json /CAMINHO/minutes.json /NOVO_DIRETORIO /NOVO_DIRETORIO/diagnosis.json
```

Resumos, ledgers, admissões, ordens/expirações, atribuições e cotações rejeitadas estão nosJSONs `compression-retest-results`, `compression-retest-ledgers`, `compression-retest-diagnosis`; regras em `compression-retest-protocol.md` e plano congelado. Minutos preservados no artefato/cache, sem gravar90dias inteiros1m no banco ou promover configuração.

## Decisão

Arquivar a primeira formulação como candidata reprovada e manter sua infraestrutura. A segunda também não foi aprovada para avançar. Não iniciar outra48h ou operação nativa dessas configurações. Validação independente permanece não coletada; Demo/real não aprovados. Nenhum merge, ordem, IA paga, deploy, reinício, alteração deRailway, depósito ou novo print necessário nesta execução. Uma futura mudança de alvo/validez/regime será outra hipótese, não a continuação silenciosa deste teste.
