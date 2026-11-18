# Validação da estratégia em dois blocos históricos

Este estudo usa candles Spot de 15 minutos da OKX para os dez pares do
manifesto. A janela de avaliação vai de 10/09 a 10/10/2026, com fim exclusivo.
Inclui 2.880 candles de avaliação e 672 anteriores de aquecimento por par.
Essa série é anterior à janela exploratória de outubro e novembro e inteira
fora dela, inclusive no aquecimento. A avaliação é retrospectiva.

- **D1–D10, 10/09 a 20/09 UTC.** Calibração pelo P&L líquido marcado no
  cenário padrão, com desempate pelo menor drawdown em USDT e pela ordem no
  manifesto. Todas as variantes perderam. O piso ATR de 1,5% teve a menor
  perda, **0,2166 USDT em 6 fechamentos**, e foi selecionado para diagnóstico.
- **D11–D20, 20/09 a 30/09 UTC, e D21–D30, 30/09 a 10/10 UTC.** A carteira
  inicia D11 com 100 USDT simulados e atravessa a fronteira de D21 com caixa,
  posições e pausas por par. Os parâmetros da variante são fixos nos dois
  blocos e nos três cenários. O P&L líquido de cada bloco usa a variação
  marcada do patrimônio. Win Rate, Profit Factor e concentração usam
  operações fechadas dentro do bloco.

| Cenário | P&L D11–D20 (USDT) | PF | Fechados | P&L D21–D30 (USDT) | PF | Fechados |
|---|---:|---:|---:|---:|---:|---:|
| Padrão | −0,5896 | 0,643 | 15 | −0,3254 | 0,500 | 7 |
| Adverso | −1,1698 | 0,337 | 14 | −0,8653 | 0,246 | 8 |
| Estresse fixo | −1,0067 | 0,400 | 13 | −0,6325 | 0,356 | 9 |

No cenário padrão, o fator de recuperação dos 20 dias foi **−0,622**.
Os três maiores ganhos representaram **49,05%** e **100%** dos ganhos dos
dois blocos, respectivamente. A remoção deles deixou o P&L realizado em
**−0,9820 USDT** e **−0,7187 USDT**. Com perdas nos dois blocos mesmo no
cenário padrão, o estudo não sustenta promover a configuração.

O [JSON de resultados](okx-2026-10-10-holdout.json) arquiva os parâmetros,
hashes dos candles, seleção, métricas de carteira e fechamentos por par
e bloco. Para gerar o relatório completo:

```sh
npm run build
npm run --silent strategy:study -- --prepare examples/okx-2026-11-17.study.json ./opcoes-estudo
npm run --silent strategy:collect -- ./candles-setembro 2026-10-10T00:00:00Z 30 ./opcoes-estudo/*.options.json
npm run --silent strategy:study -- --holdout examples/okx-2026-11-17.study.json ./candles-setembro > holdout.json
```
