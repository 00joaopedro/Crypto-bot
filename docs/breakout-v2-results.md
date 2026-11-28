# Hipótese 2 v2 — NO-GO; encerramento da rodada

A última formulação autorizada foi implementada e testada: compressão/rompimento4h, reteste maker4h, alvo3R líquido e proteção/trailing em R líquido. Aumentou a janela de preenchimento e corrigiu o conflito alvo/trailing, mas não atingiu os critérios econômicos. Nenhum parâmetro foi alterado após resultado. Sem merge, promoção de configuração, Demo, dinheiro real ou mudança deRailway.

## Resultado em180dias, carteira compartilhada17USDT

| Métrica | Padrão | Adverso |
|---|---:|---:|
| Sinais |15|15|
| Ordens simuladas / com fill |14/7|14/7|
| Fechamentos |7|7|
| Preenchimento modelado |50%|50%|
| Ordens expiradas sem fill |7|7|
| PnL líquido USDT |−0,0971080974|−0,1849749366|
| Retorno percentual |−0,571224%|−1,088088%|
| Banca final |16,9028919026|16,8150250634|
| Profit Factor |0,591691|0,409556|
| Expectativa por fechamento USDT |−0,0138725853|−0,0264249909|
| Acerto |14,2857%|14,2857%|
| Drawdown máximo |1,484264%|1,924764%|
| Recovery factor |−0,381319|−0,560528|
| Alvos maker preenchidos |0|0|
| Stops iniciais / trailing |6/1|6/1|
| Proteção / armar trailing / atualizar trailing |1/1/1|1/1/1|
| Taxas modeladas USDT |0,0636518343|0,1267134045|
| Reserva maker debitada |0|0|
| Posição ao final |nenhuma|nenhuma|

| Bloco | Padrão: trades / USDT | Adverso: trades / USDT |
|---|---:|---:|
| D1–D60 |3 /+0,0528119274|3 /+0,0121943655|
| D61–D120 |1 /−0,0371435189|1 /−0,0491270076|
| D121–D180 |3 /−0,1127765058|3 /−0,1480422946|

Só1/3blocos positivos, contra os2/3exigidos, e amostra7contra30. Mesmo preencher todos os15sinais não alcançaria30fechamentos sem alterar a regra/período. PF, expectativa, PnL e concentração também reprovaram; integridade eDDpassaram.

| Par | Sinais | Padrão: trades / USDT | Adverso: trades / USDT |
|---|---:|---:|---:|
| BTC/USDT |2|1 /−0,0448915316|1 /−0,0618305914|
| ETH/USDT |11|6 /−0,0522165658|6 /−0,1231443452|
| SOL/USDT |2|0 /0|0 /0|

Um sinal encontrou posição ocupada, deixando14ordens. Nenhuma reprovação adicional por mínimo, risco, amplitude ou proxy de post_only nos cenários. Contadores individuais dos filtros se sobrepõem; não somar como funil sequencial. A carteira é compartilhada, não três bancas independentes.

## O que funcionou tecnicamente

Todas as ordens tiveram validade240min; os sete primeiros fills ocorreram após27,1,1,0,13,0 e215min. A entrada tardia de215min confirma que a simulação não encurtou a validade para uma hora. A taxa50% é modelada por penetração/participação, não confirmação de fila maker real; a comparação com a v1 não isola causalmente apenas a validade, porque também mudaram contexto e sinais.

Todos os alvos projetaram >=3R líquido: padrão3,000018–3,000711R, adverso3,000026–3,000943R. Alvo bruto mediano7,65886%/10,12115%, stop mediano1,73409%. O alvo mais distante não representa movimento previsto nem vantagem. A proteção1,2R e o armamento2R ficaram abaixo do alvo3R líquido e puderam atuar.

A única vencedora foiETH por trailing, +0,1407217405USDT padrão/+0,1283063360 adverso, após5556minutos. Registrou uma proteção, um armamento e uma atualização de trailing em cada cenário. Foi maior que uma perda típica, mas as seis perdas somaram0,2378298379/0,3132812726USDT. Ter assimetria no alvo e uma operação boa não bastou para compensar a baixa taxa de acerto.

Nenhum alvo maker foi preenchido. Todas as saídas efetivas foram taker, incluindo a vencedora por trailing: não atribuir custo maker/maker0,20% a esses trades. A documentação oficial daOKX esclarece que post_only pode ser cancelada para evitar taker e não garante preenchimento; TP/SL pode executar em preço diferente do gatilho: https://www.okx.com/en-br/help/how-do-i-trade-with-different-order-types . O modelo continua hipótese de execução, não certificação nativa.

## Atribuição de preço/custo e concentração

Mesmos fills/quantidade vendável, antes dasfees/atrito:−0,0057956390USDT padrão/−0,0053301700 adverso. Subtraindo compra em base, venda, atrito taker e poeira, reconciliam−0,0971080974/−0,1849749366. O preço bruto ficou perto de zero e os custos tornaram o resultado claramente negativo. Não se trata de novo backtest com custo zero e não demonstra que outra taxa produziria estratégia rentável.

A única vencedora concentrou100%dos ganhos positivos em ambos; o resultado total já é negativo. A participação dos três melhores é calculada sobre a soma dos trades positivos, não sobre PnL total negativo. Retirá-la deixa−0,2378298379/−0,3132812726USDT. MFE/MAE detalhados no diagnóstico, somente barras integralmente detidas, excluindo minutos de entrada/saída e sem contrafactual de saída executável. A vencedora teve MFE observado10,3454%; isso não aprova concentração emETH nem novo alvo ajustado depois do resultado.

Adverso recalcula preço-alvo, tamanho e proxy com seus custos, não é só débito adicional nos mesmos saldos. Neste replay os sete horários de fill/saída coincidiram entre cenários. Os resultados e todas as alternativas negativas ficam preservados.

## Integridade e rastreabilidade

- Freeze publicado antes do primeiro scan: `4b95763f1f57d5ab1bdf89c69e5ceb44116bf76a`.
- Plano SHA256 `ad5ddfc5c473dce35189a280784aaf19173005f62940573ce017d4f3f34921ec`.
- Coleta/replay inicial commit `8dfa7e9cef960fc704def38584974601beffcf0b`.
- Run46180273417/artefato15277995280, ZIP SHA256 `e344bca11bc3eebd30bcfc3aa8e824aa6ca932a190c2c4e76ca36e0e7efc71f9`, verificado localmente.
- Fonte1h reutilizada, SHA256semântico `2448736721b5c165f789d13737cc07d675fd79d4c76afae018e059e4f8fc8310`.
- Minutos SHA256semântico `c8256d448774fcecf23dbbfd85e18843017fd0e84c28f93036430723128a785f`.

26mai–22nov2026exclusivo,180dias+1000h,15960candles1h dos três pares. Não recolhemos essa fonte; reutilizamos a identidade daH1v2.4200candles1m/70horas completos/coerentes (60horas das15janelas de4h e10horas de eventos), sem lacunas/duplicatas/conflitos. Catálogo público coincidiu com regras congeladas; mínimo de valor, saldo privado e permissões continuam não confirmados. Sem candles no banco operacional.

Resumo/ledger reproduzidos byte a byte localmente a partir do ZIP verificado; diagnóstico financeiro reconcilia cada trade. Workflow restaura a primeira fonte e verifica identidade ANTES de replay, sem recolhimento silencioso. Fonte expirada/ausente bloqueia a reprodução. A reserva histórica independente01out–30dez2025continuou sem consulta porque desenvolvimento reprovou. Não alegar aprovação/reprovação out-of-sample: não chegamos ao portão que autoriza essa consulta.

13testes novos da estratégia: compressão/caixa anterior, volume/deslocamento, H1defaultpreservado,3Rnet/ativação, stopmonotônico/proposta cruzada, parcial/idempotência, fillna3ªhora, expiração4h, evidência posterior, toque/não retroatividade, gap/taker, trailing4h só no intervalo seguinte, critérios e futuro. Mais4testes da decisão final: encerramento só com evidência completa, bloqueio por dados, nenhum GOautomático para dinheiro real e recusa de proveniência adulterada. Tipagem/build aprovados; validação final peloCI no PR. O resumoH1v2 e seu ledger permaneceram exatamente iguais com a extração mínima de parâmetros do ledger compartilhado.

Decisão final dos dois modelos: `final-round-decision.json` e `final-round-decision.md`. Pesquisa encerrada sem v3; sem apagar repositório ou alterar serviço operacional.
