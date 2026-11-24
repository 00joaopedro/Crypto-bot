# Execução 1 — coleta resiliente e diagnóstico do híbrido

Implementação offline/Paper no PR61. Não altera indicadores, limiares, custos, dimensionamento, saídas ou elegibilidade financeira. Não integra ordens Demo/real. O worker das48h permanece fixado em6faa6bf: NÃO implantar esta versão nele. O fingerprint compilado mudou e a retomada deliberadamente recusa trocar de código no meio da sessão. Nenhum arquivo/lock da sessão existente deve ser apagado.

## Coleta

Candle confirmado ausente é agora erro tipado, mantendo a mensagem anterior para compatibilidade. Até3tentativas por par/lote, esperas2s/4s; retentativa curta de candle ausente somente quando seu fechamento ocorreu há até dois períodos. Erros de rede classificados também recebem até3tentativas, sem multiplicar o antigo retry interno. Após esgotar, pausa de60s naquele par; os outros continuam sendo consultados. Dado histórico persistentemente ausente mantém a sessão bloqueada, sem ser imputado.

Cache em memória somente para resultados completos do mesmo horário-alvo. Trocar horário descarta o cache. Universo e ordem não mudam. A carteira só avança atomicamente quando TODOS os pares congelados estão completos no mesmo intervalo. Se houver falha, preservar checkpoint e registrar collection_blocked; não excluir um par e não inventar entradas retroativas executáveis. Dados conflitantes/malformados continuam fatais: resiliência não significa aceitar corrupção. --once falha explicitamente quando incompleto; processo contínuo permanece aguardando.

collection-events.jsonl registra tentativa/indisponibilidade/recuperação por par, horário-alvo e horário de observação, sem erro bruto. collection-health.json é o estado mais recente, não histórico. Eventos são gravados com0600. A configuração de cooldown não é persistida; após reinício os dados/ledger são restaurados e a política de tentativas recomeça, sem zerar carteira. Crash mantém lock e exige intervenção, como antes. A descoberta pública inicial do universo e falhas de integridade continuam fail-closed; não se afirma ausência universal de quedas.

## Diagnóstico

Em cada novo checkpoint temporal (e conclusão), diagnostics.json é salvo atomicamente; console emite resumo shadow_diagnostics cumulativo e shadow_trade_closed para novos fechamentos. O funil completo permanece no arquivo para evitar truncamento de linhas extensas. Contadores repetidos NÃO devem ser somados entre logs. Uma reconstrução independente do replay precisa coincidir exatamente com o ledger antes de emitir explicação.

Funil por par/modo: denominador de candles com próximo candle de execução conhecido; features, qualidade de mercado, ATR, macro/regime, toque/exaustão, RSI, volume, candle verde e recuperação. Campos passed são independentes e se sobrepõem; sequentialPassed segue a ordem listada, não demonstra causalidade. Último sinal fechado sem candle seguinte não é rejeição. Ambos os modos são diagnosticados; admissão corresponde somente à variante selecionada no perfil.

Admissão por par/modo: ocupado, prioridade compartilhada, cooldown, caixa, liquidez quando aplicável, tamanho de risco, pausa da carteira/perdas, mínimo, alvo/custo e níveis de saída. Não existe filtro R:R na estratégia atual; não inventar rejected_by_rr. O observador é opcional e não modifica o resultado histórico ou contadores legados.

Ledger: par/modo, entrada/saída, duração, motivo, P&L líquido, taxas modeladas, resultado contábil antes das taxas cobradas e custos do cenário. netBeforeChargedFeesUsdt = netPnlUsdt + feesUsdt conserva spread/slippage embutidos, não é backtest sem custos. As taxas são estimadas, mesmo quando a alíquota coincide com a conta; não há fills reais. Slippage monetário separado não é observado e não será inventado.

MFE/MAE usam apenas candles da entrada até ANTES do candle de saída. Excluem o candle inteiro de saída, pois a ordem intrabar é desconhecida. Sem candle elegível, ficam null, não zero. São excursões de preço relativas ao fill, não lucro alcançável. Não são usados como sinal ou alvo.

## Auditor de sessão antiga, sem mudar o worker

Copiar checkpoint.json do volume /data/hybrid-shadow-48h para diretório de análise preservando o original. Se houver, copiar collection-events.jsonl. O worker antigo não produz esse arquivo e o relatório declara indisponibilidade. Não são necessárias chaves privadas.

Após build:

```sh
npm run demo:hybrid-audit -- /COPIA_DA_SESSAO /DIRETORIO_DISTINTO_DE_SAIDA
```

Gera diagnostics.json0600, incluindo SHA256 dos bytes da fonte, hashes armazenados, métricas, funil e ledger reconciliado. Não escreve na sessão fonte e não faz consultas de rede. Reproduzir com este analisador não autentica o binário antigo: o fingerprint declarado fica identificado separadamente.

O checkpoint real do volume NÃO estava disponível no workspace desta implementação. Assim, o auditor foi validado em fixtures e no smoke público; nenhum número de bloqueio/saída da conta do usuário foi inventado. A execução real da auditoria da sessão fica condicionada a disponibilizar sua cópia, preferencialmente ao concluir as48h. Os exports de logs sozinhos não contêm os candles/ledger completos. Não reiniciar teste nem solicitar novas chaves para isso.

## Verificação e limites

Testes novos de atraso seguido de confirmação, ausência persistente, isolamento/cache/ordem, expiração por par, troca de alvo, corrupção, cancelamento, rede sem vazamento, funil/ledger/caixa, fonte adulterada, warmup, exclusão intrabar e CLI sem alteração da fonte. CI também reproduz os8 resultados históricos e coleta/audita/retoma o smoke público. Dados públicos consultados no smoke são desenvolvimento conhecido, não holdout.

Esta execução fornece diagnóstico e robustez; nenhuma alteração econômica experimental da execução2 está implementada ou aprovada. Reprovar uma formulação significa não promover aquela combinação de filtros/saídas/custos, não declarar inviável toda estratégia ou abandonar o projeto.
