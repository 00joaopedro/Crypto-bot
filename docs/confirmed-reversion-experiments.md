# Refino econômico — execução 4: reversão à média confirmada

Concluída em 22/11/2026, somente offline. Protocolo
`confirmed-reversion-development-v1`. Estado `blocked_no_eligible_candidate`.
Sem merge, ordem, alteração de configuração ativa ou deployment solicitado.

## Hipótese congelada antes do replay

Uma candidata nova comparada com a referência trend arquivada, nos universos
10/30 e nos custos padrão/adversos: oito comparações. A antiga hipótese de
reversão à média (RSI14/35, alvo ATR e largura de banda) permanece inalterada;
não é silenciosamente substituída nem promovida. Não se combinam o piso ATR,
pullback ou trailing das etapas anteriores.

- Bollinger20/2: SMA de 20 fechamentos e desvio populacional dos mesmos 20.
- Setup: novo fechamento abaixo da própria banda inferior, com RSI7 <25.
- Confirmação: primeiro candle posterior verde que feche acima de sua banda
  inferior e do fechamento anterior, em até quatro candles após o setup.
- RSI7 precisa continuar **estritamente abaixo de 25 na confirmação**. Esse é
  um filtro adicional na recuperação, explicitamente fixado no protocolo.
- Queda persistente: rejeitar quando a confirmação estiver abaixo da EMA50 e
  a EMA50 estiver menor que quatro candles antes. Usa janela encerrada de
  100 candles, sem tendência futura.
- Uma tentativa por excursão: recuperação consome setup mesmo se RSI, queda,
  qualidade, custo, universo ou carteira rejeitarem. Não renovar a validade
  enquanto o preço permanece fora da banda. Novo setup exige nova saída para
  fora da banda após um fechamento de volta dentro.
- ATR zero/desvio zero descartam setup pendente. O estado começa vazio em D1,
  é separado por ativo e prossegue pelo desenvolvimento sem reset no bloco.

O alvo é a **SMA20 conhecida na confirmação**, congelada como preço absoluto.
Não acompanha a média futura, não usa a máxima posterior e não se move para
facilitar uma saída lucrativa. Entrada proxy na abertura seguinte. O stop
inicial continua ATR14 ×1,5 com piso 0,5%/teto 3%, ancorado no proxy ask da
abertura, exatamente como a proteção inicial da referência. Sem trailing,
saída por sinal contrário ou encerramento forçado no fim dos dados.

Só se admite entrada se vender no alvo estimado cobrir taxa de entrada, taxa de
saída e spread/slippage das duas pernas. Quantidade líquida em moeda base e
entrada com taxa em quote são tratadas separadamente, sem dupla cobrança.
A decisão usa os custos padrão por par; a abertura seguinte revalida preço e
custos do próprio cenário. Gap que consuma a margem rejeita a compra; não se
altera o alvo. Margem positiva é condição necessária, não previsão de lucro.
Alvo com taxa de distância fora da faixa existente do simulador (≥100%) é
rejeitado em vez de ampliar seus limites.

Mantidos orçamento de 5.000 USDT, teto de 10 USDT, seeds, períodos, liquidez,
ranking histórico, limites de posições/exposição e cooldown. O filtro de
qualidade/tradabilidade compartilhado é preservado. A candidata tem sua própria
entrada; não exige também um BUY da estratégia trend. Comparação de duas
estratégias diferentes não isola causalmente o efeito de um único indicador.

## Resultado integral

| Estratégia | Universo | Cenário | Fechamentos | P&L marcado USDT | PF | Expectativa USDT |
|---|---:|---|---:|---:|---:|---:|
| Referência trend | 10 | Padrão | 447 | -38,1826 | 0,3982 | -0,085420 |
| Reversão confirmada | 10 | Padrão | 0 | 0,0000 | Indefinido | Indefinida |
| Referência trend | 30 | Padrão | 1078 | -97,5024 | 0,4079 | -0,090447 |
| Reversão confirmada | 30 | Padrão | 0 | 0,0000 | Indefinido | Indefinida |
| Referência trend | 10 | Adverso | 405 | -82,7093 | 0,1310 | -0,204220 |
| Reversão confirmada | 10 | Adverso | 0 | 0,0000 | Indefinido | Indefinida |
| Referência trend | 30 | Adverso | 947 | -195,2272 | 0,1527 | -0,206153 |
| Reversão confirmada | 30 | Adverso | 0 | 0,0000 | Indefinido | Indefinida |

A candidata também não deixou posições abertas nem cobrou taxas. Zero resultado
vem de **zero operações**, não de vantagem, lucratividade ou drawdown validado.
Não há amostra para medir PF/expectativa ou aprovar a estratégia.

## Por que não houve operações

Contagens sobre os 120 ativos e todos os 30 dias (antes de membership/carteira,
incluindo D1–D10, não apenas D11–D30):

| Fase | Quantidade |
|---|---:|
| Novas excursões com setup | 4.196 |
| Recuperações rejeitadas pelo RSI7 ≥25 | 2.802 |
| Recuperações rejeitadas por preço abaixo da EMA50 descendente | 480 |
| Setups expirados | 867 |
| Confirmações após esses filtros | 2 |
| Confirmações rejeitadas por margem após custos | 2 |
| Sinais elegíveis antes do universo | 0 |

São contagens de fases do estado, não uma partição dos setups: podem existir
pendências ao fim ou descartes por ATR/desvio zero. Confirmadas e rejeitadas
por custo se sobrepõem. Não se atribui ausência de operações à carteira ou à
corretora: os sinais já foram rejeitados antes dessas etapas.

As duas confirmações usam a SMA20 já conhecida e os custos padrão:

| Par | Distância bruta até SMA20 | Retorno estimado no alvo após custos | Decisão |
|---|---:|---:|---|
| CVX/USDT | 1,0282% | -0,1287% | Rejeitada |
| SOL/USDT | 0,4356% | -0,7145% | Rejeitada |

Nenhum limiar foi afrouxado após observar o resultado. Esses números reprovam
**esta formulação** como candidata pronta; não provam que toda reversão à média
seja inviável. Exigir RSI7 ainda <25 depois da recuperação, junto com o filtro
de queda, mostrou-se muito restritivo nesta amostra.

Um teste sintético atravessa indicadores reais, setup, confirmação, custos,
universo e carteira e abre/fecha uma operação válida com alvo congelado. Isso
verifica que o código pode admitir entradas; não é dado de mercado independente
nem evidência de lucro. Testes adicionais comprovam rejeição por gap/custos,
prioridade do stop, validade e ausência de execução retroativa.

## Identidade e reprodução

Mesmos 120 datasets congelados, artifact `14766053034`, workflow `45053465282`.
Hashes e manifesto conferidos contra a referência. Estudo completo em
`examples/pullback-reference.study.json`, hash
`d09d84a1df93330abaf253d203c4acc11ec96d7c5c74e2b42609dc8a9c647919`.
A baseline reproduziu exatamente os quatro P&Ls, PFs, fechamentos e drawdowns
arquivados. Replay integral repetido reproduziu os mesmos resultados e decisão.

```sh
npm run build
mkdir -p /tmp/confirmed-reversion-reference
cp examples/pullback-reference.study.json /tmp/confirmed-reversion-reference/study.json
cp docs/financial-reference-current.json /tmp/confirmed-reversion-reference/summary.json
npm run strategy:confirmed-reversion -- examples/confirmed-reversion-experiments.plan.json DIRETORIO_CONGELADO /tmp/confirmed-reversion-reference NOVO_DIRETORIO
```

O comando valida hashes, identidade e baseline; preserva os inputs e escreve os
dois relatórios completos e `summary.json`. O resumo versionado está em
`docs/confirmed-reversion-experiments.json`, com todas as comparações e razões,
sem exports privados. Não consulta a corretora e não envia ordens. A identificação
por modelo nos relatórios separa as simulações; não é integração operacional de
múltiplas estratégias. RSI14 do contexto legado é apenas descritivo; o gatilho
novo é RSI7 conforme o protocolo.

Taxas são as hipóteses/evidências da referência anterior: o resumo original
registra 6 pares e o diagnóstico posterior 7, incluindo SOL, sem mudança numérica
do estudo. CVX usa fallback declarado; não se converte sua taxa em evidência.
113 pares continuam sem evidência específica. Taxas Demo exportadas não comprovam
taxas históricas nem da conta real. Spread/slippage, liquidez, mínimos históricos,
região, fills, precisão/poeira e agendamento completo têm limitações já registradas.
Stop ganha toques simultâneos e gaps de baixa usam abertura pior. Não representa
banca pretendida de R$100 nem novo holdout; agosto já foi consultado repetidamente.

## Prontidão e continuação

O filtro exige resultado líquido marcado/realizado positivo, PF >1, expectativa
positiva, pelo menos 30 fechamentos, dois blocos positivos com pelo menos 15 cada
e resultado sem os três melhores trades positivo. A candidata nova e a referência
não passam. Zero operações permanece bloqueado, sem flags editáveis de promoção.

A execução 5 não deve combinar estratégias apenas para cumprir uma lista. Com a
evidência atual, nenhuma das estratégias testadas demonstrou vantagem líquida
suficiente. Uma combinação exige fundamento e protocolo próprio. Sem candidata
justificável, a etapa 6 registra bloqueio e preserva dados independentes.
Integração financeira da etapa 7 e escolha de versão para 48h continuam condicionadas.
A infraestrutura pode ser testada separadamente sem chamar isso de validação de lucro.

O método de evolução é adequado porque testa hipóteses antes da ativação,
conserva custos e resultados desfavoráveis, e exige validação independente. Os
resultados atuais ainda não demonstram uma estratégia lucrativa. Uma eventual
revisão precisa declarar nova hipótese, critérios e custos antes de consultar
seu teste; ajustar repetidamente este histórico não cria evidência independente.
As 48 horas futuras validam execução/reinício/reconciliação com versão congelada;
não garantem rentabilidade nem dispensam a etapa independente.

## Validação

17 testes novos: fórmulas e relógio causal, confirmação posterior e RSI limítrofe,
expiração/tentativa única, filtro de queda, custos nas duas moedas, alvo absoluto,
gap/custos adversos, stop simultâneo, identidade/hashes, matriz completa, amostra
insuficiente e bloqueio de promoção. Teste sintético completo confirma admissão
válida sem alterar o protocolo. Local: 523 aprovados, 20 PostgreSQL pendentes de CI.
Tipagem, build, replay reproduzido e diff check aprovados. CI verifica banco,
Docker e smoke móvel após publicação.
