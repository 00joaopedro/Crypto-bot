# Auditoria de fidelidade da execução

Registra a configuração aplicada e compara hipóteses do estudo histórico com
Paper e OKX Demo. Não altera sinais, stops, limites ou seleção de pares.

## Evidência da implantação

Na consulta somente de leitura de 19/11/2026, o último deployment retornado pela
Railway era `ad3add3`, branch `codex/paper-demo-entry-spread`, criado em
18/11/2026 às 19:40 UTC. A referência desta alteração é o merge do PR 60,
`a741230`. Merge e deployment não foram tratados como equivalentes. A Railway
também retornou uma alteração em estágio pendente; seu conteúdo não foi
confirmado e ela não foi aplicada nesta execução.

As variáveis retornaram valores ocultos. Configuração atual, ajustes persistidos
do painel, taxas da conta e proteção de posições não foram confirmados por essa
consulta. Defaults do código não provam a configuração em produção. Será
necessário implantar a instrumentação e exportar novo diagnóstico para obter
essa evidência. Nenhum deployment, saldo, variável ou controle do bot foi alterado.

## Diferenças materiais encontradas

| Aspecto | Comportamento e limitação |
|---|---|
| Tamanho | Demo usa o valor persistido do painel; Paper usa seu próprio valor persistido ou fallback do ambiente. Risco, saldo e precisão podem reduzir o preenchimento. Tetos iguais não provam fills iguais. |
| Taxas | Paper usa `PAPER_FEE_RATE`; Demo consulta taxa taker e recebe taxas nos fills, inclusive em moeda base. Cotação atual não prova taxa histórica nem a de outros pares. |
| Preenchimento | Paper simula candles e slippage; o estudo usa execução posterior e spread modelado; Demo executa no livro. Filtro de spread comum não torna resultados idênticos. |
| ATR | O processo calcula stops e alvos por ATR limitado mesmo com gestão desativada. O estudo só usa ATR com política correspondente. Stops fixos configurados podem ser apenas fallbacks. |
| Saída legada | Sem gestão, Paper ainda recebe trailing percentual. Demo tem proteções fixas sem gestor equivalente desse trailing legado. O relatório aponta `legacy_trailing_mismatch`. |
| Gestão de saída | Paper observa OHLC e usa seus custos no breakeven. Demo depende de proteção nativa, confirmação de alterações e reconciliação. Venda Demo por sinal contrário continua desabilitada. |
| Indicadores | EMA 9/21 e RSI 14; teto de compra compilado em 70. Não há EMA 200 de 1h. Não descrever RSI 63 ou EMA 200 como regras já aplicadas. |
| Carteira | Replay não reproduz todos os controles de pausa, frequência, agendamento, desempate, troca de universo e reconciliação. Mesmo sinal pode ser admitido em um motor e bloqueado em outro. |
| Exposição a altcoins | O estudo aplica sempre o teto por classe. O Paper só aplica seu teto específico de altcoins com `RISK_SIZING_ENABLED=true`. Um valor configurado com a função desligada não é uma restrição ativa equivalente. |
| Recuperação | Posições restauradas podem carregar política anterior; configuração atual não reconstitui todo o histórico. |

Essas diferenças são documentadas sem mudar a estratégia durante a auditoria.
Corrigir equivalência de saída exige experimento posterior explícito.

## Evidência nova

No boot e após aplicar configurações do painel, `execution_config_applied`
registra snapshot de campos permitidos, ajustes usados e política de saída.
`EXECUTION_CONFIG_APPLIED` guarda a evidência no PostgreSQL quando disponível.
Falha na gravação deixa `configurationPersistence` indisponível e gera diagnóstico,
sem alterar a execução das ordens.

`configurationHash` identifica configuração e política independentemente do
horário. Não identifica sozinho o código; commit e deployment são separados
quando disponíveis. Novas entradas Paper mantêm o hash na posição, persistência
e fechamento após reinício. Posições antigas continuam sem atribuição. Eventos
operacionais recebem o hash atual, sem atribuição retroativa de ordens antigas.
`quotedTakerFeeRate` em novas compras Demo distingue cotação de taxas dos fills;
reconciliação posterior pode trazer outra evidência. Credenciais, URLs de banco,
senhas, destinatários e IDs de recuperação não fazem parte da projeção.

## Consulta

Após implantar, use **Baixar JSON** nos logs: o documento recebe
`executionFidelity` sem substituir registros. A rota autenticada
`GET /api/execution-fidelity` também fornece a evidência. Consulta taxa taker,
quantidade mínima e incremento do par principal em modo somente de leitura,
com cache de 60 segundos por executor/par. Falhas ficam desconhecidas, sem
assumir taxas Paper. O polling normal do painel não passa a consultar taxas.

```sh
npm run build
npm run execution:fidelity -- diagnostico.json examples/universe-validation.study.json
```

O comparador é offline e não envia ordens. Valida o snapshot e relata diferenças
de capital inicial, tamanho, custos, RSI, ATR, janela de indicadores, filtro BTC,
exposição, posições e cooldown. O primeiro cenário do estudo é a referência de
custos; demais cenários não representam taxas confirmadas da conta.
O resultado permanece `equivalence_not_established`: campos iguais não eliminam
as limitações dos motores. Arquivos antigos sem snapshot são rejeitados. O hash
detecta inconsistências, mas não autentica a origem do documento.

Nenhuma variável nova é necessária. `COMPILED_MAX_BUY_RSI` descreve o código no
relatório; **não** é uma variável para criar na Railway.

## Próximo passo

Cruzar commit, hash, estudo, fills e taxas observadas antes de atribuir resultados
a uma configuração. Separar operações sem atribuição e posições herdadas;
comparar com capital e risco equivalentes. Ainda falta confirmar as condições
da implantação e medir o efeito das diferenças de saída. Esta auditoria não
valida lucratividade nem substitui teste operacional Demo.
