# Comparação de tamanhos do universo

Esta etapa acrescenta a comparação de 15, 30, 50, 100 e todos os pares de um
conjunto histórico validado. O manifesto em
[`examples/universe-validation.study.json`](../examples/universe-validation.study.json)
congela parâmetros, capital de **100 USDT simulados**, teto de **10 USDT por
entrada**, exposição e custos antes da coleta. Esses valores são hipóteses do
estudo, não uma leitura das variáveis atualmente aplicadas na Railway.

## Método histórico

- Janela de 01/08 a 31/08/2026 UTC, fim exclusivo; 672 candles de aquecimento
  e 2.880 candles de avaliação de 15 minutos por par. A janela é separada dos
  estudos anteriores de setembro/outubro e outubro/novembro.
- O coletor consulta somente endpoints públicos da OKX. Registra o volume
  efetivamente negociado em USDT (`volCcyQuote`), valida candles confirmados,
  incrementos/mínimos disponíveis e SHA-256 de cada dataset.
- O conjunto-fonte contém até 120 instrumentos atualmente disponíveis, pela
  lista preferencial previamente declarada e depois ordem alfabética. Não usa
  P&L futuro nem o volume atual para escolher o conjunto. Instrumentos sem
  histórico contínuo são registrados como indisponíveis, sem preencher lacunas.
- Em cada candle, o ranking de liquidez usa apenas o volume dos últimos 96
  candles encerrados. `0` significa todos os instrumentos validados **desse
  conjunto**, não todos os mercados históricos ou atuais da corretora.
- A função de sinal recebe a mesma janela de 100 candles em todos os tamanhos.
  Uma entrada depende de sinal BUY, qualidade dos candles, referência BTC,
  custos, liquidez, caixa e limites comuns da carteira. A execução modelada
  acontece na abertura seguinte. Sair do ranking não encerra uma posição aberta.
- D1–D10 escolhe apenas o tamanho pelo resultado líquido no cenário padrão,
  com desempate por drawdown. Os parâmetros da estratégia permanecem fixos.
  Todos os tamanhos também aparecem separadamente no relatório.
- D11–D20 e D21–D30 iniciam uma carteira nova no primeiro bloco e mantêm
  patrimônio, posições e pausas no segundo. Taxas, slippage, spread assumido,
  teto por ordem e exposição são iguais entre os tamanhos. Cenários adversos
  são executados com os mesmos parâmetros e a escolha de tamanho fica congelada.

O estudo é **exploratório**. A fonte atual omite mercados retirados da corretora
e não contém um arquivo histórico completo de regras e livros. Há viés de
sobrevivência/cobertura. O volume real é conhecido; spread, profundidade, taxas
da conta e preenchimentos são hipóteses. O replay não reproduz o agendamento do
scanner, histerese da rotação, travas diárias/globais de perdas nem ordens Demo.
Empates de score usam a ordem do símbolo, sem o desempate de qualidade/momentum
do ranking ao vivo.
Um resultado favorável não libera dinheiro real ou altera a configuração.

## Capacidade de varredura

O [benchmark arquivado](universe-scan-benchmark.json) executa o scanner de
produção com transporte sintético, dois workers, orçamento de 20 consultas
por passagem, um par principal e um conjunto de 500 pares. Não conecta à API.

| Candidatos | Consultas da fila, além do par principal | Passagens | Intervalos mínimos entre passagens a 60 s |
|---|---:|---:|---:|
| 15 | 14 | 1 | 0 min |
| 30 | 29 | 2 | 1 min |
| 50 | 49 | 3 | 2 min |
| 100 | 99 | 5 | 4 min |
| 200 | 199 | 10 | 9 min |
| Todos os 500 da amostra | 499 | 25 | 24 min |

Esses tempos são limites inferiores e excluem rede, proteções, rate limit e
outras tarefas. A medição local de CPU no JSON não é latência da Railway/OKX.
Em execução real o candle muda após 15 minutos, o cache antigo é descartado e
o cursor continua: 500 candidatos não teriam cobertura integral do mesmo
candle nessa configuração, mesmo com rede instantânea. Não se recomenda
ativar `0` apenas para aumentar a quantidade de pares.

## Reprodução e integridade

```sh
npm ci
npm run build
npm run strategy:universe -- --collect examples/universe-validation.study.json ./dados-universo
npm run strategy:universe -- examples/universe-validation.study.json ./dados-universo
npm run --silent strategy:universe-benchmark > benchmark.json
```

O diretório guarda `source.json`, um arquivo por par, `report.json` completo e
`summary.json` agregado. A leitura confere o manifesto e os hashes. Reutilizar
um diretório completo conserva a seleção-fonte original; outro manifesto exige
outro diretório. A coleta não usa credenciais de negociação, banco ou Railway.
O workflow `Universe validation (public OKX data)` executa os mesmos comandos,
reutiliza o cache da coleta por manifesto e disponibiliza os dados como artifact.
Tem limite de 45 minutos e 30 dias de retenção dos artifacts. Erros de acesso à
API ou cobertura insuficiente não são tratados como aprovação da estratégia.

Os detalhes de campos e limites vêm da
[documentação oficial da OKX](https://www.okx.com/docs-v5/en/).
`instCategory` identifica instrumentos não cripto quando disponível, reforçando
os filtros compartilhados com a descoberta de produção.

## Resultado histórico observado

O [workflow de coleta e comparação](https://github.com/00joaopedro/Crypto-bot/actions/workflows/universe-validation.yml)
validou **120 pares**, com **3.552 candles por par** e volume efetivo em USDT.
Cinco instrumentos foram descartados por disponibilidade/qualidade do histórico.
O snapshot foi capturado em 19/11/2026 UTC e o replay computacional levou cerca
de 6,5 segundos após a coleta. A paginação levou vários minutos.

Resultado dos **20 dias D11–D30**, cenário padrão, carteira inicial de 100 USDT
simulados e teto de 10 USDT por entrada:

| Tamanho configurado | Trades fechados | P&L líquido (USDT) | Profit Factor | Drawdown máximo (USDT) |
|---|---:|---:|---:|---:|
| 15 | 41 | −1,1723 | 0,534 | 1,4475 |
| 30 | 57 | −0,6043 | 0,849 | 2,5355 |
| 50 | 56 | −0,5922 | 0,844 | 1,9530 |
| 100 | 56 | −0,5922 | 0,844 | 1,9530 |
| Todos os validados | 56 | −0,5922 | 0,844 | 1,9530 |

- **Nenhum tamanho fechou positivo em ambos os blocos.** Para 50/100/todos,
  D11–D20 perdeu 0,1513 USDT e D21–D30 perdeu 0,4409 USDT no padrão.
- No estresse de custos, todos tiveram −2,0131 USDT (PF 0,205). No cenário
  fixo de taxa de 0,20% e slippage de 0,10% por lado, o resultado foi
  −2,3923 USDT (PF 0,192). Spread foi modelado separadamente.
- O treino perdeu 1,0256 USDT em todos os tamanhos. A escolha automática
  descritiva de 15 ocorreu pelo desempate da ordem do manifesto, **não por
  superioridade demonstrada**. Ela não foi aplicada ao bot.
- Embora o conjunto-fonte tenha 120 pares, apenas **23 a 65** atenderam ao
  volume mínimo em cada candle. Configurar 100 não inventa 100 candidatos
  líquidos. Os tamanhos 50, 100 e todos terminaram com os mesmos trades.
- No padrão com 50, o modelo contou 3.469 bloqueios por exposição a altcoins,
  1.008 por regime BTC, 834 por exposição total, 65 por liquidez de execução
  e seis por pausa do par. São oportunidades repetidas por candle, não
  ordens recusadas pela corretora. Não se recomenda relaxar o risco para
  aumentar o número de operações.

A [síntese JSON](universe-validation-summary.json) registra parâmetros, fonte,
cobertura, calibração e cenários. Os datasets completos e os resultados por par
ficam no artifact do workflow, com hashes para verificar a reprodução.

**Conclusão:** a expansão não resolveu a expectativa negativa desta estratégia
nas hipóteses e no período estudados. A pequena diferença entre 30 e 50 não
justifica escolher parâmetros olhando o holdout. O valor atual
`DYNAMIC_UNIVERSE_SIZE=10` fica preservado por custo/continuidade, sem afirmar
que dez seja financeiramente melhor — esse tamanho não foi comparado aqui.
A ferramenta suporta universos maiores, mas o estudo não sustenta promoção
para dinheiro real. As 48 horas Demo são uma validação operacional separada;
não substituem evidência de rentabilidade nem são executadas por este CLI.
