# Hipótese 2 v2 — protocolo da última rodada

Somente pesquisa offline em BTC/ETH/SOL, mesmo PR e sem merge. A hipótese1v2 está reprovada, resultado preservado. Esta é a segunda e última formulação autorizada, uma combinação de parâmetros e dois custos; não abrir v3 ou estender períodos para buscar aprovação.

## Regras fixadas antes do primeiro scan

O arquivo `examples/breakout-v2.plan.json` define os parâmetros e o CLI confere seu SHA256. Código, plano, protocolo e testes sintéticos são publicados antes de qualquer scan desta hipótese nos preços históricos. O manifesto posterior identifica o commit publicado. Reutiliza-se a primeira fonte1h de180dias da H1v2, identidade semântica `2448736721b5c165f789d13737cc07d675fd79d4c76afae018e059e4f8fc8310`; não recolher nem substituir a fonte. Já é desenvolvimento conhecido, não holdout. A fonte é agregada em4h UTC, sem usar vela aberta.

Compressão é a caixa das oito velas4h ANTERIORES ao rompimento: máxima−mínima <2,2ATR14 simples conhecido antes do rompimento, com esse ATR abaixo da média de30valores deATR14 terminando na última vela da caixa. Rompimento fecha acima da máxima, volume >=1,3×média20anterior e corpo positivo >=0,5ATRanterior. O corpo de0,5ATR objetiva a expressão "corpo relevante" da proposta, sem outro filtro de EMA/RSI/pavio. Não importar filtros macro da H1. Transição false→true.

Limite=topo rompido×1,0015, arredondado para baixo no tick. Post_only simulado na abertura seguinte de4h; proxy que cruzaria ask é rejeitada. Ordem vale4h completas, sem chase ou conversão taker. Stop é o MENOR entre centro da caixa−um tick e limite−1,2ATR14 conhecido na vela do rompimento, arredondado para baixo. Essa escolha resolve "melhor proteção estrutural" sem escolher depois o stop de maior resultado. Stop inválido é rejeitado.

Banca17USDT, teto10, uma posição ou ordem pendente, prioridade BTC/ETH/SOL, risco1%/exposição25%/símbolo15%/alt10% preservados. Custos e precisão da H1v2: maker0,10%, taker0,40%, slippage0,10%, spread0,15%, participação0,10% do volume minuto e penetração>um tick; adverso dobra taxas/atrito, metade da participação e >dois ticks. Fonte de taxas é a transcrição dos prints do titular, não autenticação de fills/taxas históricas. Regras públicas datadas são proxy e mínimo de valor permanece desconhecido. Custos diferentes recalculam tamanhos e cotações, podendo gerar carteiras diferentes.

Alvo maker projeta>=3R LÍQUIDOS, depois de fee na base/quote, arredondamento, poeira e reserva conservadora separada. R é perda líquida inicial no stop taker. Alvo arredondado para cima; manter alvo bruto projetado>=2% como filtro de amplitude. Alvo mais distante não demonstra expectativa nem previsão de movimento. Não aplicar o pisoATR absoluto da H1 a esta compressão relativa.

A +1,2R líquidos em fechamento1m, cancela-se o restante da compra e move-se stop para projetar+0,2R líquido após custo taker. A+2R líquidos em fechamento1m, arma-se trailing. Esses níveis ficam abaixo do alvo3R líquido; preço de ativação inclui custo taker, não confundeR bruto/líquido. A proteção passa a valer no minuto SEGUINTE. Gaps/slippage podem violar o lucro projetado.

Trailing atualiza somente no fechamento4h: maior HIGH das velas4h inteiramente detidas (abertura>minuto do primeiro fill, excluindo a vela de entrada parcial), menos0,8ATR14 da última vela4h fechada. Pode usar máximas de velas já detidas antes da ativação, todas conhecidas. Piso líquido+0,2R prevalece; arredondamento do componente técnico para baixo e piso para cima. Nunca abaixa o stop. Se proposta já está acima/igual ao fechamento, pula a alteração, sem vender retroativamente. Só vale a partir do próximo minuto. Alvo permanece3R líquido; não converter alvo maker em taker para favorecer o resultado. Sem saída parcial estratégica ou time-stop adicionais.

## Dados e execução modelada

180dias26mai–22nov2026exclusivo,1000h warmup,5320candles1h por par. Primeiro scan só após freeze publicado. Confirmados1m para TODAS as quatro horas de cada sinal, mesmo sem preenchimento, mais horas posteriores onde stop/alvo/próximoR possam ser tocados. A carteira retém reserva e propriedade durante as4horas; não encurtar silenciosamente o timeout. Coleta pública só para evidência intrabar, sem API privada ou banco operacional. Orçamento1200janelas por fase; falha/lacuna impede conclusão econômica e não vira operação inventada.

Compra e TP exigem penetração estrita além de ticks e capacidade de volume. Toque não é preenchimento; TP precisa estar repousado e não pode dar lucro no minuto da nova compra. Stop primeiro quando há ambiguidade. Limit maker preenche exatamente no limite; reserva de incerteza é custo separado, não taxa OKX nem preço abaixo do limite. Stop é taker com gap/fricção; não recebe reserva maker duplicada. Parcial não protegível pelo mínimo bloqueia, não é liquidada ficticiamente. Reprocessamento de fill é idempotente. Não reutilizar a carteira na mesma hora da saída. Fila real, latência, OCO e cancelamentos nativos continuam não certificados.

## Portão único e encerramento

Mesmos critérios da rodada H1v2:>=30fechamentos CADA cenário, três blocos completos, >=2/3blocos positivos em realizado e marcado, DD<10% e realizado positivo sem os três melhores trades. Padrão:PF>1,25, expectativa/PnL líquido positivos. Adverso:PF>=1, expectativa/PnL>=0, nunca aprovar ausência de operações. PF sem perdas mas com ganhos é ilimitado; zeroatividade é indefinida.

Somente se AMBOS os cenários passarem no desenvolvimento, abrir a reserva01out–30dez2025exclusivo90dias,1000h warmup, mesmas regras/critérios. Essa é reserva histórica anterior segundo registro do repositório, não forward test cronológico nem certificação de toda consulta humana externa. Desenvolvimento e reserva precisam passar; reprovação não permite retuning.

GO offline ainda exige revisão/validação nativa própria antes de Demo. Se a segunda formulação também reprovar com evidência completa, registrar encerramento deste ciclo de pesquisa e arquivar resultados, sem v3. Não arquivar destrutivamente o repositório, apagar código, desligar Railway ou fechar posições sem ação operacional específica. Se a evidência faltar, relatar bloqueio de dados, distinguindo-o de prejuízo comprovado. realMoneyApproved continua false; sem depósitos, ordens, deploy ou IA paga.
