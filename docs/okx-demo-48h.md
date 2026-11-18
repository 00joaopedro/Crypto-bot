# Validação operacional de 48 horas na OKX Demo

A janela começa no primeiro ciclo operacional da revisão a validar, com o
worker ativo. Registre o SHA e ID do deploy, o ambiente, o início em UTC e a
configuração efetiva. Termine a coleta 48 horas depois. O veredito cobre a
integração Demo nesta janela. As decisões sobre a estratégia continuam
dependendo da evidência do [estudo histórico](okx-2026-11-17-study.md).

## Preparação

- Confirme o SHA do PR no deploy e a conexão ao PostgreSQL do teste. Se
  houver outra instância ativa, use um diário e uma conta OKX Demo próprios
  para a instância de teste. Dois workers da mesma conta com diários
  diferentes não compartilham reservas nem proteção contra duplicidade.
- Confira `bot_started` com execução Demo e `liveTradingEnabled: false`,
  `okx_demo_permission_checked` com permissão de trade e
  `okx_demo_execution_armed` com teto de **10 USDT por compra**. O
  PostgreSQL pode ter configurações do painel que prevalecem sobre os
  padrões do ambiente. Dimensionamento por risco pode reduzir o lote.
- Mantenha o ciclo de 15 minutos, a estratégia atual de tendência, o spread
  máximo e as proteções existentes. O teste usa sinais naturais.
- Se a capacidade do serviço e a disponibilidade Spot Demo permitirem,
  use 15 candidatos líquidos. Pontos de partida para conferir nos dois
  provedores: BTC, ETH, SOL, XRP, DOGE, SUI, NEAR, ZEC, HYPE, LIT, AVAX,
  LINK, DOT, AAVE e LTC, todos contra USDT. `SIGNAL_SCAN_SYMBOLS` define os
  pares configurados, e `DYNAMIC_UNIVERSE_SIZE` limita a descoberta
  dinâmica. Confirme os pares efetivamente escaneados no painel e em
  `signal_ranking`. Pares configurados sem mercado comum ou com pausa por
  perda podem ficar fora do ciclo. Mantenha a lista de configuração e os
  parâmetros fixos durante a janela.

## Captura e conferência

Use exportações **Baixar JSON** de 6 horas com sobreposição, por exemplo uma
a cada 4 horas, além de uma no encerramento. O teto de 500 registros é por
categoria. Se alguma categoria atingir o teto, reduza o intervalo das
capturas seguintes. Uma categoria truncada não comprova a cobertura do
período anterior. Preserve os logs do deploy para conferir reinícios e
estado do worker, inclusive nos períodos sem operação.

```sh
npm run build
npm run --silent demo:validation-report -- 2026-11-17T00:00:00Z ./capturas/*.json > demo-48h.json
```

Troque o horário de exemplo pelo início efetivo em UTC. O relatório reúne
as exportações, conta as ordens por estado, cruza preenchimentos com
verificação da proteção, resume rejeições e mostra máximo de spread
observado, reconciliações registradas e reinícios. Confira a análise junto
dos logs Railway e do painel Demo.

| Verificação | Evidência necessária |
|---|---|
| Ciclos e escopo | SHA correto, modo Demo, 48 h de logs e lacunas ou pausas identificadas |
| Spread | `ENTRY_MARKET_CHECK` para o filtro comum, e rejeições `demo_spread_exceeded` com etapa quando o livro muda entre verificações |
| Ordem | Pelo menos uma compra preenchida e confirmada no diário e na OKX Demo. Compare precisão, quantidade, valor e taxa com o comprovante da corretora |
| Proteção | `DEMO_ENTRY_PROTECTION` verificado para cada compra preenchida, com cobertura da quantidade líquida. Confirme o estado visível na OKX Demo |
| Reconciliação | Confira pendências, histórico de execuções e o marco confirmado do painel. Se houver reinício, confira retomada, proteções e ausência de ordens duplicadas antes de validar recuperação |

Sem compra preenchida, a confirmação de execução e proteção é inconclusiva.
Sem reinício observado, a recuperação permaneceu sem demonstração na janela.
Registre qual etapa ficou sem evidência. Falha de proteção, divergência de
ordem ou persistência exigem investigação antes de prosseguir com novas
entradas. Mantenha a supervisão e as proteções existentes durante a
investigação.
