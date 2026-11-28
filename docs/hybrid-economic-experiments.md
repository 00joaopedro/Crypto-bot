# Execução 2 — experimentos econômicos dos modos A/B

**Resultado: nenhuma candidata elegível.** Nenhum merge, deploy, alteração do worker48h ou ordem. Os custos/risco não foram reduzidos para obter resultado positivo.

## Protocolo e reprodução

Protocolo congelado ANTES do replay das alternativas no commit ad43c5d47e83098ea5d87a5d58f741ea7f96b272, em examples/hybrid-economic-experiments.plan.json. Hash dos bytes c7213dc6faf2dc2c89e83a9bd70a9293f29e9baed469e93e02b63d254ef1c8c8. O diagnóstico original dos filtros foi produzido antes da escolha das alternativas. Duas por modo, sem combinações ou busca posterior de novos parâmetros.

Dados: mesmos18pares e30dias, 23/10/2026 23:00UTC até22/11/2026 23:00UTC, mais250h de warmup. Não são novos dados independentes. Dataset schema-normalizado fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4. A identidade do objeto capturado no funil prévio difere por representação/ordem de campos, conforme avaliação histórica já arquivada; o runner valida a identidade schema-normalizada exata. ARB e TON continuam ausentes deste snapshot, sem substituir pares pela cobertura atual19 do Paper.

Entrada via artefato14950615105 do Actions45454188303, SHA256zip d60c37242c4fc833aa3be57b2a6ea89a5f991f5b3c4f2eedb2f63aba870d04ea. A extração e o hash foram conferidos. Quatro referências A/B×custos de lote fixo antigo foram reproduzidas exatamente ANTES dos novos12casos.

Novos casos usam banca17USDT, teto10, uma posição, risco1%, exposição total25%/ativo15%/altcoin10%. Custos0,40% ou0,80% por perna, slippage0,10%/0,20% e spread total0,15%/0,30%, com mesmos limites de liquidez do cenário. Precisão/mínimos de quantidade e venda pós-taxa preservados. Mínimo de valorUSDT continua desconhecido e não certificado. Entrada em base, ambas as pernas modeladas; observação atual de taxa não prova preenchimentos históricos.

Importante: essas baselines dimensionadas por risco não são os resultados antigos de lote10fixo. A redução de tamanho também muda admissões por liquidez/mínimos. Reduzir perda absoluta não demonstra melhora da estratégia. A referência fixa antiga não foi reescrita.

## Funil original e hipóteses

51.822 observações candle×par por modo, somente sinais com próximo candle conhecido. Não são51.822 operações nem amostras independentes. Contagens independentes se sobrepõem; sequência é declarada no JSON. Omitir um filtro no diagnóstico NÃO é prova de melhora econômica.

- A:3sinais originais; retirar apenas volume dá5, retirar apenas toque daria35. A_VOLUME_OFF remove só volume<1,1; liquidez e qualidade continuam. A_TOUCH_1_ATR amplia apenas profundidade máxima do toque de0,25para1ATR, com todos os outros filtros preservados; produz29sinais, não35, pois o toque ainda é exigido.
- B:47sinais originais; retirar só o piso ATR dá298. B_ATR_OFF mantém ADX, exaustão, confirmação, qualidade, custos e proteção. B_NET_RR_1_5 mantém sinais/saídas e exige R:R líquido>=1,5 na cotação do fechamento e na abertura. Nenhuma variante é combinada com outra.

## Todos os resultados — carteiras isoladas

| Caso | Custo | Trades | P&L USDT | PF | EV USDT/trade | DD % |
|---|---|---:|---:|---:|---:|---:|
| A_REFERENCE | account-conditioned | 3 | -0.042532 | 0.393481 | -0.014177 | 0.494884 |
| A_REFERENCE | account-cost-stress | 3 | -0.079350 | 0.225967 | -0.026450 | 0.686850 |
| A_VOLUME_OFF | account-conditioned | 5 | -0.030072 | 0.714526 | -0.006014 | 0.616929 |
| A_VOLUME_OFF | account-cost-stress | 5 | -0.083170 | 0.459934 | -0.016634 | 0.917582 |
| A_TOUCH_1_ATR | account-conditioned | 20 | -0.394978 | 0.187007 | -0.019749 | 2.323402 |
| A_TOUCH_1_ATR | account-cost-stress | 17 | -0.790884 | 0.014471 | -0.046523 | 4.652260 |
| B_REFERENCE | account-conditioned | 16 | -0.228898 | 0.178469 | -0.014306 | 1.346458 |
| B_REFERENCE | account-cost-stress | 2 | -0.105709 | 0.000000 | -0.052855 | 0.621820 |
| B_NET_RR_1_5 | account-conditioned | 0 | 0.000000 | indefinido | indefinido | 0.000000 |
| B_NET_RR_1_5 | account-cost-stress | 0 | 0.000000 | indefinido | indefinido | 0.000000 |
| B_ATR_OFF | account-conditioned | 26 | -0.473000 | 0.097451 | -0.018192 | 2.822293 |
| B_ATR_OFF | account-cost-stress | 2 | -0.105709 | 0.000000 | -0.052855 | 0.621820 |

Nenhuma posição aberta ao fim dos12casos. Picos de exposição observados ficaram em até10% da carteira nesta amostra. Esse resultado não garante teto de perdas em gaps. Métricas completas de retorno%, recuperação, concentração top3, taxas, duração e blocos: hybrid-economic-results.json. Todos os sinais admitidos/rejeitados e trades: hybrid-economic-ledgers.json. heldMinutes e médias contam candles inteiros dos trades fechados, não duração exata de fills.

## Interpretação

- A_VOLUME_OFF melhora PF/EV nos dois custos, mas continua negativo e só tem5fechamentos. No padrão, +0,038048USDT antes das taxas cobradas é insuficiente para0,068120USDT de taxas, resultando em -0,030072. Essa decomposição ainda embute spread/slippage; não é replay sem custos. No estresse, a perda total é maior que a referência, apesar da melhora da média por trade. Não é candidata aprovada.
- A_TOUCH_1_ATR aumenta trades de3para20no padrão, porém piora EV/PF e perde -0,394978; no estresse perde -0,790884. O problema não foi resolvido por aumentar frequência.
- B_ATR_OFF aumenta16para26trades, mas piora PF/EV e perde -0,473000 no padrão, contra -0,228898 da referência. Das298oportunidades padrão,213 são rejeitadas por alvo/custos. No estresse,240 por alvo/custos e40 por níveis inválidos; apenas2trades, iguais à referência. Menor atividade no estresse não demonstra robustez.
- B_NET_RR_1_5 tem0trades por incompatibilidade estrutural: mesmo sem custos,1,4% de alvo líquido versus1,2% de stop dá R:R máximo de1,1667. Com custos padrão o stop modelado perde aproximadamente2,1604% do desembolso e o R:R máximo fica0,6480; no estresse,0,4494. SMA mais próxima reduz ainda mais o ganho potencial. Exigir1,5 sem redesenhar a saída apenas bloqueia entradas. Este ponto corrige a proposta inicial: a trava sozinha não conserta esta formulação. Não alteramos alvo/stop depois de ver esse resultado.

Os R:R máximos pressupõem as taxas em base do cenário; não consideram rebates ou taxas maker hipotéticas. No modelo padrão, uma estrutura com ganho máximo1,4% e perda no stop2,1604% exigiria mais de60,7% de acerto se todo ganho alcançasse o teto e toda perda fosse no stop. Isso é apenas referência matemática: time-stops, alvos menores e distribuição real mudam o ponto de equilíbrio. Não é estimativa da chance de ganhar.

## Blocos de10dias — diagnóstico cronológico

| Caso | Custo | D1–10 | D11–20 | D21–30 |
|---|---|---:|---:|---:|
| A_REFERENCE | account-conditioned | 0.000000 | -0.042532 | 0.000000 |
| A_REFERENCE | account-cost-stress | 0.000000 | -0.079350 | 0.000000 |
| A_VOLUME_OFF | account-conditioned | 0.000000 | -0.030072 | 0.000000 |
| A_VOLUME_OFF | account-cost-stress | 0.000000 | -0.083170 | 0.000000 |
| A_TOUCH_1_ATR | account-conditioned | -0.035043 | -0.359935 | 0.000000 |
| A_TOUCH_1_ATR | account-cost-stress | -0.051289 | -0.739595 | 0.000000 |
| B_REFERENCE | account-conditioned | -0.083637 | -0.025336 | -0.119925 |
| B_REFERENCE | account-cost-stress | 0.000000 | -0.052934 | -0.052775 |
| B_NET_RR_1_5 | account-conditioned | 0.000000 | 0.000000 | 0.000000 |
| B_NET_RR_1_5 | account-cost-stress | 0.000000 | 0.000000 | 0.000000 |
| B_ATR_OFF | account-conditioned | -0.142076 | -0.150665 | -0.180259 |
| B_ATR_OFF | account-cost-stress | 0.000000 | -0.052934 | -0.052775 |

Blocos compartilham carteira/estado e são desenvolvimento conhecido, não walk-forward independente. A falta de operações em um bloco não vira lucro nem aprovação.

## Decisão e próximos limites

As4alternativas falham na triagem congelada: mínimo30fechamentos por cenário, EV>0, PF>1, retorno líquido>0 e três blocos positivos nos dois custos. As operantes são negativas; B_RR não opera. Não há nova candidata para consumir holdout ou integrar na Demo. Amostra maior não transforma automaticamente perdas em vantagem.

Nenhuma nova tentativa de limiar foi feita após os resultados. Não se criou motor combinado nem se escolheu uma carteira somando resultados isolados. Qualquer nova proposta precisa protocolo separado, por exemplo redesenho econômico do espaço de ganho/horizonte ou custos comprovadamente menores; isso não está implementado por esta entrega. As48h antigas permanecem observação experimental congelada.

## Reprodução e verificação

Após extrair normalized-data.json do artefato e executar npm run build:

```sh
npm run strategy:hybrid-economic -- /CAMINHO/normalized-data.json /NOVO_DIRETORIO
```

O comando é offline, valida protocolo/dataset/estratégia/risco, reproduz as4referências antigas e emite summary.json e ledgers.json. Duas execuções locais produziram os12casos e todos os ledgers exatamente iguais. Workflow híbrido fará a mesma comparação byte a byte com os JSONs arquivados. Não existem opções para enviar ordens ou alterar Railway.

Oito testes novos cobrem mudanças isoladas, preservação do default, custos líquidos sem dupla cobrança, impossibilidade de R:R, rejeição de dados diferentes, trava de admissão e critérios/duplicação de cenários/amostra insuficiente. CI completo e resultados finais serão conferidos após publicação.
