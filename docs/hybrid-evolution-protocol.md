# Execução 2 — protocolo de evolução offline

Congelado antes de executar as alternativas. Dados de desenvolvimento já consultados: 18 pares, 30 dias até 22/11/2026 23UTC, mais aquecimento. Não é walk-forward treinado nem holdout; os três blocos são cortes temporais descritivos da mesma carteira contínua.

A matriz em examples/hybrid-evolution.plan.json compara referências A/B/AB e mudanças isoladas de transição, regime e ROI, depois A/B/AB completos e C isolado. Custos aplicáveis mantidos: taker 0,40% e estresse 0,80% por perna, spread/slippage comuns. Maker não confirmado não é cenário favorável.

ADX/EMA do contexto só usam horas inteiramente fechadas até o fechamento do sinal. A transição usa o estado completo de sinal por par/modo, inclusive candle anterior no aquecimento, e não é zerada por posição ocupada. Nenhum filtro original de A/B é removido.

ROI líquido: 1,6% antes de 30 minutos, 1,1% de 30 até antes de 180, 0,6% depois. B preserva SMA congelada/teto original e time-stop de 90 minutos; portanto o último estágio não atua em B. Muda o alvo para a vela seguinte, nunca usa sua máxima antes de ativar o novo limiar. Stop inicial e precedência conservadora continuam.

Trava econômica dos completos e C: recompensa líquida inicial/perda líquida estimada >=0,5 e ganho líquido >=0,5 vezes custo modelado, tanto no fechamento do sinal quanto na abertura quantizada. São hipóteses de triagem, não garantia de win rate/EV ou limiares universais para produção. Alvo líquido é diferente de expectativa estatística.

C squeeze: BB20/2 dentro de Keltner EMA20 +/-1,5 ATR20 no candle anterior; rompimento confirmado da banda superior, volume>=1,5 da média anterior de20, regime1h de alta e ATR15m>=0,70%. Stop1,2% bruto e alvo3% líquido fixos; sem integração à carteira A/B. Testado como proposta nova isolada, não aprovado por estabilidade da engenharia.

Aprovação de desenvolvimento exige >=30 trades em cada custo, PF>1,25, EV/net positivos, três blocos positivos, DD<10% e lucro realizado positivo excluindo os três maiores ganhos. Critérios são triagem, não inferência estatística independente. Carteira AB completa também exige os dois modos individualmente elegíveis. Sem aprovação, não consumir holdout nem implementar Demo desta candidata.

Banca17, lote10 como teto sob limites atuais1%/25%/15%/10%, uma posição. Mínimo notional e condições reais não certificados continuam limitações; não aumentar lote ou mudar custos para produzir aprovação. Sem IA paga, ordens, merge ou mudança do worker48h no6faa6bf.
