# Execução2 — compressão, rompimento e reteste maker

Hipótese única de pesquisa no PR61. Formulação pullback maker anterior permanece arquivada/reprovada para operação por ausência de entradas economicamente admissíveis; não foi alterada para forçar trades. Isso não é prova contra toda família de pullbacks.

Protocolo `examples/compression-retest.plan.json`, SHA256 `1a6ef05932f597ea5834f280b0be4301e253ef58454d18a49fb65fdeea168d32`. Publicar protocolo, implementação e testes sintéticos antes do primeiro scan/replay desta hipótese; manifesto posterior vincula commit. Uma estratégia, uma parametrização, dois custos, sem grade ou retuning após resultados.

## Regras explícitas

- BTC/ETH/SOL definidos previamente. Fonte90d1h já conhecida,24/08–22/11/2026UTC exclusivo,1000h warmup, dataset `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`. São dados de desenvolvimento; não são nova validação independente.
- Contexto4h concluído: EMA50>EMA200 e três incrementos consecutivos positivos deEMA50; pelo menos250barras4h concluídas.
- Compressão: cada um dos quatro ATR14simples anteriores ao rompimento é estritamente menor que75%da média das suas próprias50observações ATR imediatamente anteriores. Nenhuma observação futura entra na média. A vela de rompimento não faz parte dessas quatro.
- Range: máxima e mínima das12velas1h anteriores, excluindo a vela de rompimento.
- Confirmação1h fechada: fechamento acima da máxima, volume>=1,5×média das20velas anteriores e corpo bullish (close−open)>=0,5ATR14da vela anterior. Transição false→true1h. Sem Bollinger/Keltner/RSI ou outra variante de entrada.
- Entrada maker no reteste: limite na máxima rompida, arredondado para baixo no tick, colocado na próxima hora; validade cinco minutos, sem perseguir preço ou converter para taker. Sem reteste/modelo de fill válido, sem entrada.
- Stop inicial=floor(mínima do range−0,25ATR anterior,tick); alvo fixo=floor(limite+3×distância atéstop,tick). **3Rbruto**, não3Rlíquido.
- Gate líquido preservado: ganho/perda no stop>=1,5 e ganho>=2×custo total modelado, incluindo taxas/base/quote/rounding. Banca17, teto10, uma posição compartilhada; risco1%/exposição25%/par15%/alt10%; prioridadeBTC→ETH→SOL, pausas anteriores e sem reuso na hora da saída.

## Trailing sem retrospectiva

Na posição efetivamente preenchida, risco inicial líquido = custo debitado−provento líquido projetado no stop inicial. Armar somente quando o lucro líquido de liquidação no **fechamento conhecido de1h** atingir pelo menos duas vezes esse risco. Máxima intrabar sozinha não arma trailing.

Depois de armado, proposta = maior **fechamento1h** conhecido desde a entrada−2ATR14atual de1h, arredondada para baixo. Nunca baixar stop; proposta não positiva ou já acima/igual ao fechamento atual é recusada. Atualização só vale na hora seguinte; não pode executar no candle que a produziu. ATR usa apenas horas fechadas até a decisão. Sem saída parcial ou regra independente de breakeven.

O alvo fixo3Rbruto permanece. Se seu payoff líquido projetado for menor que2Rlíquido, o alvo normalmente encerrará a posição antes de o trailing poder armar. Essa possibilidade será diagnosticada, não ocultada nem corrigida a posteriori com novo alvo. Payoff projetado não é expectativa estatística.

## Execução/dados compartilhados

Reutiliza componente maker da execução1: penetração além do limite, participação limitada no volume1m, cinco minutos de validade, reserva/partials/idempotência/cancelamento, quantidade vendável após taxa e poeira, stop-first/gap, bloqueio de parcial desprotegível e nenhumTPcreditado no minuto de novo fill. Extensão de trailing é opt-in; o default da hipótese1 permanece fixo e seus resultados devem reproduzir exatamente.

Coletar somente60minutos confirmados da hora de entrada de cada sinal. Nenhuma ordem retroativa na vela de confirmação. Verificar relógio/confirmado/duplicatas/conflitos e agregação1h. Minutos ausentes bloqueiam o resultado completo, em vez de inventar fill ou excluir o par. Candles não demonstram fila, agressor, spread real, latência ou preenchimento maker nativo. Todo desempenho continua condicionado a esse modelo.

Padrão usa os dados da conta informados pelo titular: maker0,10%/taker0,40%, slippage0,10%/spread0,15% modelados na saída; adverso dobra cada custo e reduz participação. Sem nova consulta privada, depósito ou ordem. Catálogo público é comparado com regras congeladas, mas mínimo de valor e acesso da conta continuam separados de minSz/lotSz/tick. Saldo real0;17é banca simulada.

## Decisão congelada

Ambos os custos precisam atingir>=30fechamentos,PF>1,25,EV/retorno líquido positivos, três blocos30d positivos,DD<10%, realizado semtop3 positivo, cobertura completa e nenhuma parcial desprotegível. Reportar porpar/motivo/fees, admissões/não fills, MFE/MAE quando houver posições e atualizações de trailing. Não selecionar pares vencedores após observar a amostra.

Sem candidata elegível, encerrar esta formulação sem coletar holdout ou iniciar outra48h. Mesmo triagem favorável continua sem aprovação Demo/real, exigindo validação independente separada e execução/proteções/reconciliação nativas. Não implementar aposta de produção para transformar teste negativo em positivo.

```sh
npm run build
npm run strategy:compression-retest -- --collect /CAMINHO/frozen1h.json /CAMINHO/minutes.json /NOVO_DIRETORIO
npm run strategy:compression-retest -- --replay /CAMINHO/frozen1h.json /CAMINHO/minutes.json /OUTRO_DIRETORIO
```

Nenhuma alteração deRailway, painel operacional, banco, segredo, taxa de produção, merge ou dinheiro real nesta execução. Sem necessidade de mais prints ou aporte para o estudo público/offline.
