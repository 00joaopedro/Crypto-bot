# Hipótese 1 v2 — NO-GO

O Swing Pullback Maker 4h/1h foi implementado, congelado e avaliado em 180dias com BTC/ETH/SOL e carteira compartilhada de17USDT. A amplitude e a coerência do alvo líquido foram corrigidas, mas a formulação não passou. Nenhuma configuração foi promovida. Não iniciar nova48h/Demo desta candidata.

## Resultado consolidado

| Métrica | Padrão | Adverso |
|---|---:|---:|
| Sinais aptos antes da carteira |23|23|
| Ordens simuladas |18|20|
| Ordens com preenchimento / fechamentos |6/6|8/8|
| Ordens sem preenchimento |12|12|
| Preenchimento modelado |33,33%|40,00%|
| Lucro líquido USDT |-0,1850075520|-0,3383870608|
| Retorno / drawdown máximo |−1,08828% /1,08828%|−1,99051% /1,99051%|
| Banca final |16,8149924480|16,6616129392|
| PF / acerto |0 /0%|0 /0%|
| Expectativa por fechamento USDT |-0,0308345920|-0,0422983826|
| Recovery factor |−1|−1|
| Saídas maker / stops taker |0/6|0/8|
| Atualizações de proteção |0|0|
| Taxas modeladas USDT |0,0544246804|0,1413887750|
| Reserva maker debitada |0|0|
| Posição ao final |nenhuma|nenhuma|

Os cenários recalculam cotações, tamanho, alvo líquido e proxy de post_only com seus custos/spreads. Portanto, o adverso tem outra carteira, com oito fills; não é apenas uma aplicação de taxas dobradas aos mesmos seis trades. O spread maior permite duas postagens que cruzavam a proxy de ask padrão. Isso não demonstra maior preenchimento real sob adversidade nem calibração de livro/fila.

| Bloco | Padrão (trades / USDT) | Adverso (trades / USDT) |
|---|---:|---:|
| D1–D60 |1 /−0,0279618658|2 /−0,0787618529|
| D61–D120 |5 /−0,1570456862|6 /−0,2596252079|
| D121–D180 |0 /0|0 /0|

| Par | Sinais | Padrão (trades / USDT) | Adverso (trades / USDT) |
|---|---:|---:|---:|
| BTC/USDT |1|1 /−0,0434006527|1 /−0,0598565227|
| ETH/USDT |12|3 /−0,0854457109|4 /−0,1604367082|
| SOL/USDT |10|2 /−0,0561611884|3 /−0,1180938299|

## O que a adaptação resolveu e o que continuou ruim

A mediana do alvo bruto projetado passou a3,26976% no padrão e4,68866% no adverso; stop mediano1,10236%/1,06679%. Todas as ordens cotadas atendem >=1,60R líquido: faixa1,60001–1,60577 padrão e1,60000–1,60375 adverso. A ativação em1R líquido fica abaixo do alvo1,6R líquido por construção. O timeout de60min modelou preenchimento de33,33%/40%; isso não certifica execução maker nativa nem permite comparação causal isolada com o timeout5min da v1, pois também mudaram regras e dados.

Entretanto, nenhum alvo maker foi preenchido. Os6/8trades saíram em stop inicial, sem ativar a proteção. As taxas efetivas do modelo nesses trades continuam sendo maker na compra e taker na saída: não se atribui taxa maker a um stop para fabricar custo redondo de0,20%.

A decomposição dos mesmos preenchimentos mostra resultado de preço bruto na quantidade vendável de−0,1091042440USDT padrão e−0,1415147030 adverso. Depois de fee de compra em base, venda, atrito taker e poeira, reconciliam exatamente−0,1850075520/−0,3383870608. Isso é atribuição do percurso observado, não novo backtest com custos zero. Cortar taxa de alvo não corrige uma sequência que não chega ao alvo.

MFE dos trechos integralmente detidos ficou0,2221%–1,2410% nos seis trades padrão. A medição exclui extremos do minuto de entrada/saída e mistura barras1m/1h integralmente detidas; não é máximo intrabar exato nem prova de saída alternativa executável. Detalhes e MAE no diagnóstico, sem retunar o setup.

O funil contém184transições brutas:29BTC/71ETH/84SOL. Stops técnicos inválidos39 (8/8/23) e stops abaixo de0,90%122 (20/51/51) deixam23sinais (1/12/10). A amostra máxima de23sinais já é inferior aos30fechamentos requeridos. No padrão,2postagens cruzam a proxy post_only,2perdem prioridade e1encontra posição ocupada;18ordens são simuladas. No adverso,2perdem prioridade e1encontra posição ocupada, deixando20. Contadores de filtros individuais não são etapas sequenciais e se sobrepõem.

## Decisão e integridade

Reprovou amostra, PF, EV, PnL, blocos positivos e exclusão dos três melhores ganhos. Só integridade/completude e drawdown passaram. Ausência de ganhos deixa concentração dos três melhores indefinida, não zero vantajoso. Nenhuma conclusão universal sobre toda a família de pullbacks; esta formulação congelada não justifica operação. Nada de v3, extensão de período ou ajuste pós-resultado.

Desenvolvimento26mai–22nov2026exclusivo,180dias+1000h:5320candles1h por par,15960no total, agregados em4h UTC. Coleta adicional de1800candles1m em30horas de entrada/evento, sem lacunas, duplicatas ou divergênciaOHLCV. Catálogo público bateu minSz/lotSz/tickSz congelados; não confirma mínimo de valor, saldo privado ou permissões. Parte da janela já foi vista em estudos anteriores: não é out-of-sample.

Como ambos os cenários reprovaram, a reserva01out–30dez2025 NÃO foi coletada/aberta. A hipótese2v2 NÃO foi executada nesta atualização. O encerramento do projeto só será deliberado após o resultado das DUAS v2; a primeira reprovação não arquiva nem desliga o serviço agora.

- Freeze código/protocolo/testes antes da nova fonte: `6eaf3c19a9cc4f95ecb816899d2f2cf6fafd781e`.
- Protocolo SHA256: `7d40f912f921353fd779e98d107506a313fccaa19db48b1647190a746279ad54`.
- Commit de primeira coleta: `32097a44a903717a19f8df37071dec254ed2a6ea`.
- Run origem46175882160, artefato15275935478; ZIP SHA256 `0b5fbaee216f2b84f73963ea095423035cbfb4c2609719a25920731766495c68`, verificado localmente.
- Fonte1h SHA256semântico `2448736721b5c165f789d13737cc07d675fd79d4c76afae018e059e4f8fc8310`.
- Fonte1m SHA256semântico `4c695f9124867de1b22812f48da66162620de03326dc2cc086b84bd98f126bfe`.

Resumo e ledger doCI reproduzidos byte a byte localmente. Workflow restaura a primeira fonte se faltar cache e confere identidade ANTES do replay; fonte expirada/ausente bloqueia, nunca recolhe silenciosamente. Fontes públicas ficam no artefato, sem candles gravados no banco operacional. ArquivosJSON completos: `swing-v2-results.json`, `swing-v2-ledgers.json`, `swing-v2-diagnosis.json`.

Validação técnica:14testes novos, tipagem/build aprovados; suíte local718aprovados e32dependentes deCI. CI da primeira coleta:750/750testes em131arquivos, com PostgreSQL/HTTP, build,Docker e smokeChrome móvel. Os estudos anteriores permanecem reproduzidos. Testes de engenharia não aprovam rentabilidade.

Sem merge, deploy, alteração deRailway, APIprivada, ordem Demo/real ou IA paga. Saldo real informadozero;17USDT são simulados. Não se pede depósito nem novos prints para continuar a pesquisa.
