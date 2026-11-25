# Horizonte1h/4h — resultado de desenvolvimento

Hipótese congelada em bbd9cdd376e7d903285c91c5dfc84005eabdc0de, SHA256dosbytes do protocolo ba10e5f47fb876a420036dcd3255b269bb7972c4abc4e7bd030fb646ff94ae9f.90dias24/08–22/11/2026UTC,1000h de aquecimento,18pares fixos,3160horas/pare56.880candles1h coletados.4h derivadas de quatro horas contíguasUTC. Desenvolvimento conhecido, não holdout.

Dataset SHA256 c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde. Fonte: artefato15073810297, ZIP SHA256b98a9fa945048d2110e29e846c284786b28b297c494c1fc421143836502bb916, https://github.com/00joaopedro/Crypto-bot/actions/runs/45722652141/artifacts/15073810297 . O normalizado permanece no artefato/cache para reprodução, não no banco do bot.

## Quatro casos previamente definidos

| Saída / custo | Fechamentos | Líquido USDT | PF | EV USDT | DD máximo |
|---|---:|---:|---:|---:|---:|
| HORIZON_REFERENCE / account-conditioned | 72 | -1.459745 | 0.221562 | -0.020274 | 8.587% |
| HORIZON_REFERENCE / account-cost-stress | 41 | -1.722868 | 0.067979 | -0.042021 | 10.135% |
| HORIZON_ATR / account-conditioned | 35 | -0.562076 | 0.605222 | -0.016059 | 3.399% |
| HORIZON_ATR / account-cost-stress | 3 | 0.121177 | 2.199302 | 0.040392 | 0.819% |

Ambas usam os mesmos180sinais de entrada1h/contexto4h e a mesma carteira17USDT/teto10/uma posição/risco1%/exposição25%/15%/10%. Custos0,40% e0,80%/perna com os mesmos spreads/slippages aplicáveis. Saída original de A é referência; candidata usa stop/target ATR fixos e trava líquidaRR>=1/ganho>=custo nos quotes de decisão e abertura. A comparação não isola apenas saída: o gate também muda admissões, e duração/carteira alteram entradas posteriores. Não é comparação causal de timeframe com os30dias antigos.

## Decisão

blocked_no_eligible_candidate. Candidata padrão:35fechamentos,11alvos e24stops,WR31,43%,três blocos de30dias negativos(-0,020412/-0,372211/-0,169452). Amostra alcança o mínimo30, masPF/EV/retorno/blocos e lucro semtop3 falham. Antes de adicionar de volta as taxas debitadas, resultado -0,562076; adicionando0,468105de taxas, permanece -0,093970USDT, ainda com spread/slippage embutidos. Não é contrafactual semcustos.

Estresse:3trades(+0,121177),2alvos/1stop;154rejeições pela margem líquida contra44no padrão. Não é a mesma carteira com taxas maiores: o gate/riscos seleciona outra amostra. Apenas3operações, dois blocos semresultado e lucro semtop3 negativo(-0,101040). Nenhuma seleção favorável ou promoção a partir desse positivo.

A proposta diminuiu perdas comparada à referência1h, mas aumentou frequência frente à antiga sessão e continua EV negativa. Mais trades não foi suficiente para lucratividade; não retirar filtros ou elevar risco após consultar resultados. Todos os resultados, inclusive negativos, permanecem nos JSONs de resumo e ledgers.

## Limites e pendências externas

Instrumentos atuais usados como restrições históricas modeladas; mínimo notionalUSDT, taxas maker/fills, livro/slippage históricos e saldo real não certificados. Não há ordens, IA paga, alteração deRailway, merge, validação independente ou aprovação real. A estratégia continuaoffline.

A sessão48h verdadeira ainda requer checkpoint.json/public-coverage.json do volume. Logs resumidos não permitem auditar seu trade; esta coleta pública não os substitui. Guia de download e novo painel em docs/hybrid-panel-and-session-export.md. O painelnovo permite importar/reproduzir checkpoint, sem executar estratégias.

Reprodução local a partir do arquivo de origem baixado com ZIPverificado deve coincidir com resumo/ledgers. CI final confere essa identidade e os8+12+26casos antigos, além de testes/Docker e smoke móvel com importação/download do checkpoint. Resultado final do CI registrado noPR.
