# Refino econômico — execução 2: entrada por pullback

Concluída em 22/11/2026. Estado: `blocked_no_eligible_candidate`.
Nenhuma configuração ativa, variável, ordem, implantação ou merge.

## Protocolo fixado antes do replay

`examples/pullback-experiments.plan.json` fixa somente quatro alternativas, sem
varrer limiares após observar os resultados. São filtros adicionais à entrada
trend de referência, com score, tendência superior, volume e qualidade originais.

- Referência: entrada original, RSI máximo 70.
- Proximidade: fechamento entre EMA21 e EMA21 + 0,8 ATR14.
- Pullback confirmado: EMA9 acima da EMA21; primeiro uma extensão maior que
  0,8 ATR, depois fechamento em recuo em relação ao anterior e mínima tocando
  EMA21 + 0,25 ATR ou abaixo. Recuperação em candle posterior verde, fechando
  acima da máxima anterior e da EMA21, com extensão final entre 0 e 0,8 ATR.
- Pullback + RSI ≤58: exatamente a confirmação anterior, com teto RSI adicional.

O setup expira após quatro candles posteriores ao recuo. Perda da direção das
EMAs, mínima abaixo da mínima do setup ou ATR zero invalidam o setup. Cada
recuperação permite **uma tentativa**, consumida inclusive se RSI, qualidade,
liquidez, carteira ou universo bloquearem a compra. Novo setup exige extensão
nova acima de 0,8 ATR; não se renova a validade em cada toque. Estado separado
por ativo, atualizado também em candles sem BUY. Não há confirmação no mesmo
candle do recuo. Usa apenas candles fechados e a mesma janela de 100 candles;
entrada continua no próximo open, nunca em um toque intrabar idealizado.

Mesmo orçamento 5.000 USDT, teto 10 USDT, seeds, limites, cooldown, custos,
ATR/stops/alvos fixos e períodos. A confirmação não troca as saídas nem desliga
filtros originais. A exposição e o giro realizados naturalmente mudam.
O estado começa vazio no início de D1 e continua pelas duas janelas avaliadas;
D1–D10 não seleciona uma variante de entrada. Universos 10/30 são ambos reportados.

## Todos os resultados

P&L marcado inclui posições restantes; PF e expectativa são dos fechamentos.
Expectativa é USDT por trade, não probabilidade de lucro futuro.

| Entrada | Universo | Cenário | Fechamentos | P&L USDT | PF | Expectativa USDT |
|---|---:|---|---:|---:|---:|---:|
| Referência | 10 | Padrão | 447 | -38,1826 | 0,3982 | -0,085420 |
| Proximidade EMA21 | 10 | Padrão | 227 | -22,5082 | 0,2968 | -0,099155 |
| Pullback confirmado | 10 | Padrão | 5 | -0,9637 | 0,2007 | -0,192744 |
| Pullback + RSI58 | 10 | Padrão | 3 | -0,2980 | 0,4481 | -0,099319 |
| Referência | 30 | Padrão | 1078 | -97,5024 | 0,4079 | -0,090447 |
| Proximidade EMA21 | 30 | Padrão | 540 | -55,8477 | 0,3238 | -0,103422 |
| Pullback confirmado | 30 | Padrão | 12 | -1,6640 | 0,2113 | -0,138663 |
| Pullback + RSI58 | 30 | Padrão | 8 | -0,7012 | 0,3887 | -0,087654 |
| Referência | 10 | Adverso | 405 | -82,7093 | 0,1310 | -0,204220 |
| Proximidade EMA21 | 10 | Adverso | 219 | -46,3977 | 0,0871 | -0,211862 |
| Pullback confirmado | 10 | Adverso | 5 | -1,4905 | 0,0813 | -0,298101 |
| Pullback + RSI58 | 10 | Adverso | 3 | -0,6170 | 0,1762 | -0,205675 |
| Referência | 30 | Adverso | 947 | -195,2272 | 0,1527 | -0,206153 |
| Proximidade EMA21 | 30 | Adverso | 503 | -107,4469 | 0,1113 | -0,213612 |
| Pullback confirmado | 30 | Adverso | 11 | -2,9241 | 0,0432 | -0,265823 |
| Pullback + RSI58 | 30 | Adverso | 7 | -1,5419 | 0,0788 | -0,220270 |

## Interpretação e decisão

Proximidade reduz perdas totais ao reduzir operações, enquanto **piora PF e
expectativa** em todos os quatro recortes. A confirmação sem RSI também piora
ambos. Com RSI58, PF melhora no universo 10 mas expectativa piora; no universo 30
padrão a expectativa melhora ligeiramente mas PF piora. Nenhuma alternativa
melhora simultaneamente PF e expectativa em qualquer recorte.

A confirmação é muito restritiva nesta combinação de filtros: apenas 3–12
fechamentos, abaixo do mínimo predefinido de 30 por execução e 15 por bloco.
Não é evidência suficiente para concluir que todo pullback seja inviável.
É suficiente para **não promover estas regras**. Não foram tentados novos
limiares para forçar lucro. Zero/poucas operações e menor perda total não
constituem vantagem positiva. O bloqueio também considera resultados líquidos,
PF >1, expectativa positiva, os dois blocos e resultado sem os três melhores trades.
Mesmo uma candidata aprovada nesse filtro exigiria protocolo independente e
estabilidade, sem promoção automática.

Dados já consultados de agosto, não holdout novo. Custos históricos de livro
continuam hipóteses. O resumo financeiro arquivado usado para identidade registra
6 pares com taxas evidenciadas; o diagnóstico econômico posterior ampliou para 7
com SOL, sem mudança numérica de taxa ou do hash do estudo. Os outros 113
permanecem sem evidência específica. O replay não reproduz integralmente
agendamento, região, mínimos históricos, preenchimentos ou todas as travas reais.
Não representa a banca pretendida de R$100 nem autoriza dinheiro real.

## Reprodução e evidência

`examples/pullback-reference.study.json` contém a referência completa reconstruída
com os parâmetros e seeds exportados, e custos já arquivados. Seu hash semântico
confere exatamente com `docs/financial-reference-current.json`; os quatro
resultados da baseline foram reproduzidos exatamente. Os 120 datasets do artifact
`14766053034` (workflow `45053465282`) conferiram com os hashes originais. O ZIP
baixado tem SHA256 `9900789ca690829545c91a6f1b7207e7d7b64eb8e540789f8d2bb98d09a6869e`.

```sh
npm run build
mkdir -p /tmp/pullback-reference
cp examples/pullback-reference.study.json /tmp/pullback-reference/study.json
cp docs/financial-reference-current.json /tmp/pullback-reference/summary.json
npm run strategy:pullback -- examples/pullback-experiments.plan.json DIRETORIO_CONGELADO /tmp/pullback-reference NOVO_DIRETORIO
```

O comando verifica manifesto, nomes, hashes e referência, recusa sobrescrever
entradas e grava todas as alternativas, inclusive negativas. `summary.json`
corresponde a `docs/pullback-experiments.json`; os quatro ledgers completos são
reconstruíveis, sem incorporar exports privados ao Git. Não consulta corretora.

Esta é a segunda das sete novas execuções de refino econômico. As antigas etapas
2/3 sobre custos e prontidão independente continuam registradas separadamente.
A etapa seguinte planejada é isolar volatilidade/saída, mantendo o bloqueio
financeiro até haver evidência justificável.

## Validação

12 testes novos cobrem sequência recuo/recuperação, tentativa única, RSI limítrofe,
expiração, quebra da mínima/tendência, ATR zero, causalidade e relógio; protocolo
imutável, referência/custos adulterados, matriz incompleta, amostra pequena,
concentração e bloqueio financeiro; CLI offline com identidade, hashes,
preservação dos inputs e reprodução da baseline. Suite local com `CI=true`:
491 aprovados, 20 de PostgreSQL não executados por ausência de banco local.
Tipagem, build e `git diff --check` aprovados. O CI verifica PostgreSQL, Docker e
smoke do painel móvel após publicação; seu resultado deve ser consultado no PR.
