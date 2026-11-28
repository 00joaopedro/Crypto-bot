# Execução 5 — segunda hipótese de entrada, isolada

Hipótese fixa, offline: Bollinger de 20 candles e 2 desvios populacionais,
RSI 14 menor que 35 e largura das bandas de até 4% da média. Entrada apenas
no toque/rompimento da banda inferior, com ao menos 84 candles disponíveis.
Não é ADX, RSI 7, alvo na banda média ou uma estratégia já ativada na Demo.
As constantes foram definidas antes de rodar esta hipótese, sem busca em grade.

Capital, lotes, BTC, saídas ATR, cooldown, exposição, custos e livro simulado
permanecem os mesmos da referência. As saídas são deliberadamente comuns para
isolar a mudança de entrada. O score da hipótese é 8, com desempate por símbolo;
não se usa esse score para misturar estratégias ao vivo. O indicador RSI do
ledger continua RSI 14 calculado no candle de decisão.

```
npm run build
npm run strategy:complementary -- examples/universe-validation.study.json DIRETORIO_CONGELADO
```

O comando valida o source.json, manifesto, filenames e hashes, e compara
universos fixos de 10/30 nos três custos. Os mesmos 120 datasets congelados de
agosto foram reutilizados. Não é um novo holdout. A composição atual da fonte,
regras dos instrumentos e liquidez assumida conservam as limitações anteriores.
As seis métricas de referência foram conferidas contra o arquivo da Execução 3
(P&L, PF, fechamentos e drawdown idênticos). Síntese: complementary-study.json.

## Resultado da hipótese de reversão à média

| Universo | Custo | Fechamentos | P&L marcado USDT | PF fechado |
|---|---|---:|---:|---:|
| 10 | padrão | 5 | -0,1514 | 0,508 |
| 10 | adverso | 1 | -0,1122 | 0 |
| 10 | estresse fixo | 1 | -0,1072 | 0 |
| 30 | padrão | 1 | -0,1445 | 0 |
| 30 | adverso | 1 | -0,1767 | 0 |
| 30 | estresse fixo | 1 | -0,1718 | 0 |

Todos os cenários foram negativos, com apenas 1–5 fechamentos. O menor prejuízo
absoluto frente à tendência não demonstra superioridade: a quantidade de trades
é muito menor. Não há evidência para combinar as hipóteses ou ativar esta entrada.
A máscara de liquidez e o caixa compartilhado podem alterar quais ordens abrem;
aumentar o universo não garante mais fechamentos sob os mesmos limites.

A avaliação combinada fica condicionada a evidência útil da hipótese isolada.
A tendência também continua reprovada no controle da Execução 4. Não adicionamos
uma segunda identidade de execução ao vivo, não modificamos limites para gerar
mais trades e não trocamos de estratégia automaticamente. Não houve deploy,
ordens, variáveis novas ou merge. O problema do teste Demo sem fills permanece
uma investigação operacional separada, pendente do JSON da janela exata.
