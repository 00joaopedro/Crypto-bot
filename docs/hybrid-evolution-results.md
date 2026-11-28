# Execução 2 — evolução de regimes, transição, ROI e squeeze

Execução offline concluída. Nenhuma candidata elegível; nenhuma configuração promovida. Protocolo congelado antes das alternativas no commit b39637e2506811c141101e35c3d93a6f3601c452, SHA256 dos bytes 21819470719e6bc5f7d33a5493ddb49f408c9d94af011cd1fa2fcc36d5e94f49.

## Fonte e comparação

Mesmos18pares/30dias até22/11/2026 23UTC,250h de contexto, dataset SHA256 fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4. ZIP recuperado do artefato14959201744 com digest verificado5bf16903a3257feb5e1dcc0e2fccfdbd23c85f90cb28f78bb743b3b6798bc428. Nenhum dado independente coletado. Blocos D1–10/D11–20/D21–30 são cortes descritivos da mesma carteira contínua, não walk-forward treinado.

Treze configurações × dois custos =26comparações. Taxa0,40%/perna e estresse0,80%, entrada em base; spread/slippage e limites comuns. Banca17USDT, teto10 sob risco1% e exposição25%/15%/10%, uma posição. Referências A/B por risco reproduzidas exatamente nos4casos antes de avaliar as alternativas. Não comparar diretamente com o antigo lote fixo10.

## Todos os resultados

| Configuração | Trades padrão | Líquido USDT padrão | PF padrão | EV USDT padrão | Trades estresse | Líquido USDT estresse | PF estresse |
|---|---:|---:|---:|---:|---:|---:|---:|
| A_REFERENCE | 3 | -0.042532 | 0.393481 | -0.014177 | 3 | -0.079350 | 0.225967 |
| B_REFERENCE | 16 | -0.228898 | 0.178469 | -0.014306 | 2 | -0.105709 | 0.000000 |
| AB_REFERENCE | 19 | -0.270842 | 0.221697 | -0.014255 | 5 | -0.184583 | 0.111505 |
| A_TRANSITION | 3 | -0.042532 | 0.393481 | -0.014177 | 3 | -0.079350 | 0.225967 |
| B_TRANSITION | 16 | -0.228898 | 0.178469 | -0.014306 | 2 | -0.105709 | 0.000000 |
| A_REGIME | 0 | 0.000000 | — | — | 0 | 0.000000 | — |
| B_REGIME | 7 | -0.127629 | 0.066131 | -0.018233 | 1 | -0.052934 | 0.000000 |
| A_ROI | 3 | -0.014676 | 0.581606 | -0.004892 | 3 | -0.092266 | 0.099545 |
| B_ROI | 16 | -0.228898 | 0.178469 | -0.014306 | 2 | -0.105709 | 0.000000 |
| A_FULL | 0 | 0.000000 | — | — | 0 | 0.000000 | — |
| B_FULL | 1 | -0.036715 | 0.000000 | -0.036715 | 0 | 0.000000 | — |
| AB_FULL | 1 | -0.036715 | 0.000000 | -0.036715 | 0 | 0.000000 | — |
| C_SQUEEZE | 2 | 0.014156 | 1.384397 | 0.007078 | 2 | -0.002115 | 0.960178 |

WR, EV em estresse, DD, recuperação, taxas, duração, ocupação de capital, concentração, separação por modo e os três blocos estão integralmente em hybrid-evolution-results.json; cada entrada/saída e admissão em hybrid-evolution-ledgers.json. PF/EV indefinidos sem trades não significam aprovação.

## Diagnóstico concreto

- Transição não retirou nenhum sinal: os3sinais A e47B já eram eventos isolados nesse histórico. É proteção lógica testada, sem melhora econômica medida aqui.
- Regime1h eliminou os3sinais A. B caiu de47para19sinais; passou de16trades/-0,228898/PF0,1785 para7/-0,127629/PF0,0661 no padrão: menor perda total acompanhada de EV pior (-0,018233 por trade). Isso não demonstra melhora de seleção.
- ROI A mudou -0,042532 para-0,014676 no padrão, mas de-0,079350 para-0,092266 no estresse. Somente3operações; não robusto. B não mudou seus trades: SMA/time-stop encerraram antes de obter benefício dos degraus.
- Completo A/B fez1trade perdedor (-0,036715) no padrão e0noestresse. Regime A bloqueado e R:R líquido B rejeitaram candidatos; ausência de perda por ausência de atividade não é sucesso.
- C squeeze fez2trades: +0,014156USDT/PF1,3844 padrão, -0,002115/PF0,9602 estresse. Um único ganho responde por100% dos ganhos positivos; sem os três maiores, resultado padrão -0,036826. Dois trades não estimam vantagem.
- Todos os fechamentos dessas alternativas ocorreram no bloco D11–D20. D1–D10 e D21–D30 sem ganho/trades não atendem ao critério previamente congelado de blocos positivos.

## Decisão e próximos passos

blocked_no_eligible_candidate. Nenhuma passou30fechamentos/custo, PF>1,25, EV e retorno positivos nos dois custos e três blocos, DD<10% e resultado realizado positivo excluindo os3maiores ganhos. A carteira AB completa também exige os dois modos individualmente elegíveis. Não selecionar somente o pequeno positivo C nem suavizar critério depois de vê-lo.

Execução2 está concluída como experimento: sem holdout, integração nativa, nova sessão48h ou aprovação de dinheiro real. A execução3 poderá consolidar bloqueios e revisar evidência operacional; não há candidata aprovada para implantar. Repetir48h da mesma estratégia não corrige sua expectativa. Qualquer reformulação de horizonte/entrada/saída exige nova hipótese explícita, antes de novo replay.

## Escopo e limites

Mudanças opt-in somente no comparador; o scanner/runtime não seleciona a evolução por variável. A/B originais, trailing e proteção inicial permanecem por padrão. C isolado possui identificação VOLATILITY_SQUEEZE, stop1,2% bruto, alvo3% líquido e nenhum novo trailing/time-stop/carteira. ROI temporal aplicado no início da vela, segundo idade conhecida; nenhuma máxima usada retroativamente; stop precede alvo em ambiguidade e gaps adversos continuam.

Taxa maker, fills/livro histórico, mínimo notional e saldo disponível não certificados. Modelo Paper herdado de taxa/poeira mantém limitações declaradas; precisão atual do instrumento não é projetada ao passado. Alvo líquido/R:R potencial não equivale a EV estatística. Não houve ordem, IA paga, merge ou alteração Railway. Sessão antiga6faa6bf preservada; esta compilação muda fingerprint, não deve migrar seu checkpoint.

Validação: testes novos de horas fechadas/futuro, transições, fronteiras ROI, ativação temporal, time-stop B, stop/gap, custos, squeeze, identificaçãoC, critérios/matriz/protocolo e CLI sem sobrescrita. Workflow reproduz8referências antigas,12experimentos anteriores/ledgers e26casos novos/ledgers, além de prontidão e smoke público. Resultados efetivos do CI registrados no PR após conclusão.
