# Execução 2 — resultado da hipótese única de continuação 4h

26/11/2026. Avaliação offline concluída: **blocked_no_eligible_candidate**. Não promover esta formulação à Demo/real nem reiniciar 48h como tentativa de torná-la positiva. Nenhuma ordem, IA paga, merge, deploy, alteração de Railway ou consulta da reserva independente.

## Congelamento verificável e reprodução

Regras, código e nove testes sintéticos publicados no PR61 antes do primeiro replay histórico desta hipótese, no commit `40f262e3521a0a35043ff3656b1c3d262af95b47`. SHA256 do protocolo: `a27d84b0518336e85e0f141bae019b066dbee0d25c0ca8cc250ccee0e13b44c6`. Manifesto em `examples/channel-continuation.freeze.json`. Nenhum parâmetro econômico foi alterado depois de observar o resultado; o commit seguinte registra o manifesto, resultados e reprodução/atribuição contábil.

Dataset90d existente `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`, avaliação 24/08–22/11/2026 exclusivo UTC +1000h de warmup. Subconjunto BTC/ETH/SOL definido antes do replay. Dados conhecidos, de desenvolvimento; não walk-forward independente. Nenhuma nova coleta nem inserção de candles no banco.

O CLI foi executado e a repetição produziu resumos e ledgers idênticos byte a byte. A atribuição posterior também reproduz exatamente. O replay antigo dos quatro casos1h/4h e os42 diagnósticos da execução1 mantiveram identidade com os arquivos arquivados após a extensão opt-in do kernel.

## Resultado de todos os quatro casos

| Caso | Custo | Fechamentos | Líquido USDT | PF | EV USDT | DD máximo |
|---|---|---:|---:|---:|---:|---:|
| HORIZON_ATR_CORE (referência nos mesmos3pares) | Padrão | 0 | 0 | — | — | 0% |
| HORIZON_ATR_CORE | Estresse | 0 | 0 | — | — | 0% |
| CHANNEL_4H | Padrão | 9 | -0,514610 | 0,219417 | -0,057179 | 3,0271% |
| CHANNEL_4H | Estresse | 5 | -0,235196 | 0,396878 | -0,047039 | 2,5510% |

Banca simulada17, teto10, uma posição; limites anteriores de risco/exposição preservados. No padrão, patrimônio final16,485390USDT, retorno-3,0271%. No estresse,16,764804USDT, retorno-1,3835%. Nenhuma posição aberta ao final. Desempenho de uma carteira com9trades não se soma ao da carteira de5trades como14amostras independentes.

Custos padrão0,40% taker por perna +0,10% slippage +0,15% spread; estresse dobra cada componente. Cotações da conta eram datadas; maker/saldo utilizável/mínimo de valor/livro atual continuam sem confirmação. Não houve substituição por taxa genérica mais barata nem alegação de fill maker.

### Blocos sequenciais de desenvolvimento

| Caso | D1–D30 | D31–D60 | D61–D90 |
|---|---:|---:|---:|
| Referência padrão/estresse | 0 | 0 | 0 |
| Candidata padrão | -0,271361 | -0,243250 | 0 |
| Candidata estresse | -0,220270 | -0,014927 | 0 |

Nenhum cenário da candidata atingiu amostra>=30, PF>1,25, EV/líquido positivos, todos os blocos positivos ou lucro realizado semtop3. Ambos respeitaram o critério histórico de DD<10%, o que não basta para aprovação. Não coletada a reserva01/10–30/12/2025: sem candidata elegível, não faz sentido gastar a validação para ajustar novamente os mesmos parâmetros.

## Diagnóstico do sinal e da carteira

539fechamentos4h elegíveis por par (último fechamento sem próxima abertura não é entrada executável).20sinais após transição/qualidade: BTC7,ETH5,SOL8. Contadores de filtros independentes se sobrepõem e não são número de trades.

| Admissão da candidata | Padrão | Estresse |
|---|---:|---:|
| Entrada aceita | 9 | 5 |
| Outra posição ocupava a carteira | 6 | 4 |
| Outro par tinha prioridade naquele candle | 4 | 1 |
| Margem líquida insuficiente no fechamento de decisão | 1 | 10 |

A referência antiga nos mesmos três pares teve18rejeições pela margem econômica em cada cenário, sem entradas. Zero lucro por ausência de trades não prova vantagem. O teste novo aumentou atividade, mas gerou perda. Não comparar estes valores com o total antigo de18pares como se apenas o sinal tivesse mudado.

Padrão: oito stops e um take-profit, acerto11,11%. Pelo tamanho médio observado de ganho/perda, equilíbrio aproximado36,29% (descritivo, não probabilidade futura). Estresse: quatro stops/um alvo, acerto20%. A carteira muda com os custos/gates/duração; prejuízo menor no estresse não significa benefício causal de taxas maiores.

Quantidade de sinais, por si só, não é melhoria econômica. Duração por velas da candidata padrão: mediana46h, média77h, contando a vela inteira de saída como limite superior. O único slot fica ocupado por bastante tempo, mas não foi testada outra saída depois de observar isso.

## Custos e excursões

Em `channel-continuation-diagnosis.json`, o mesmo auditor da execução1 reconciliou os ledgers e separou custos:

- Candidata padrão: resultado-0,514610; taxas registradas modeladas0,145465USDT. Restaurando a quantidade anterior à taxa de compra, nos mesmos fills, ainda-0,370628USDT.
- Retirando também o atrito modelado do MESMO percurso de entradas/referências de saída, ainda-0,307371USDT. Portanto, não há fundamento neste teste para dizer que maker, sozinho, resolveria a formulação. Essa atribuição não é um replay de estratégia com custo zero: gates, caixa, alvos e admissões poderiam mudar.
- MFE antes da vela de saída: mediana1,4970%; MAE mediana2,2376%,9amostras. Em6/9casos houve máxima acima do equilíbrio estimado antes da saída. Isso não estabelece uma saída executável nem autoriza ajustar stop/breakeven/tempo pelo histórico já observado.
- Janelas posteriores1h/4h/8h: médias de fechamento-0,0332%/+0,1583%/+1,0733% sobre o fill, sem novos custos de saída. Não são trades, amostras independentes nem retorno realizável. Manter a saída congelada, em vez de escolher retrospectivamente a janela positiva.

O problema desta rodada inclui direção/percurso e taxa de acerto insuficientes, não somente taxa da corretora. Nenhum par/horário foi excluído por ter dado prejuízo e nenhuma conclusão sobre toda estratégia de canal ou todo regime de mercado foi extrapolada desta amostra.

## Implementação e validação

Adicionado modo somente de pesquisa `CHANNEL_BREAKOUT`, explicitamente permitido apenas na política1h `channel`. Scanner UTC4h usa somente barras concluídas, canal anterior20barras e false→true na cadência4h. Stop2ATR/alvo6ATR e o gate líquido ficam isolados; variantes antigas preservam modo, métricas e saídas. Nenhuma alteração no scanner/bot operacional ou no painel de execução.

Nove testes novos: canal sem máxima futura/própria, warmup/regime/confirmação, cadência e não repetição, gate líquido, ATR fixo/sizing, stop-first/gap, rejeição de modo/relógio/sinal inválido, amostra/cenários/blocos/concentração, carteira única/prioridade/sem reuso na vela. Tipagem/build e suíte local683aprovados+32dependentes deCI (715totais). CI final deve reproduzir os quatro novos resumos/ledgers/diagnóstico e os estudos antigos, além dePostgreSQL/HTTP,Docker e smoke móvel; resultado final registrado noPR.

```sh
npm run build
npm run strategy:channel-continuation -- /CAMINHO/frozen1h-normalized-data.json /NOVO_DIRETORIO
node scripts/channel-diagnosis.mjs /CAMINHO/frozen1h-normalized-data.json /NOVO_DIRETORIO /NOVO_DIRETORIO/diagnosis.json
```

Arquivos completos: `channel-continuation-results.json`, `channel-continuation-ledgers.json`, `channel-continuation-diagnosis.json`; regras e instruções dos prints em `channel-continuation-protocol.md`.

## Como prosseguir

Execução2 concluída com reprovação desta hipótese. Etapa3 de integração/validação nativa continua condicionada a uma candidata economicamente justificável; não iniciar Demo/real desta candidata nem repetir48h esperando outra conclusão. Leitura atual de maker/taker, caixa e regras ainda ajuda a fechar o custo/viabilidade da conta, mas não transforma retrospectivamente os resultados negativos em positivos. Uma próxima família/regime exigirá outra hipótese explícita e orçamento de testes, sem remendar esta mesma formulação após consultar os dados.
