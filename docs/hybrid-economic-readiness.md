# Etapa 3 — decisão verificável após os experimentos econômicos

## Resultado

Etapa de avaliação concluída: blocked_no_eligible_candidate. Nenhuma das4alternativas da etapa2 satisfaz os critérios de desenvolvimento nos dois custos. A regra de volume A melhora alguns números mas continua negativa/insuficiente; toque A ampliado e B sem ATR pioram EV; B R:R1,5 não opera. Não há candidata para coletar holdout, integrar ou promover na Demo. Não executar validação independente de uma candidata reprovada só para completar uma lista de etapas.

O comando strategy:hybrid-economic-readiness confere hashes dos bytes do relatório, dos12ledgers e do protocolo pré-registrado. Valida dataset/estratégia, risco, matriz6×2única e identidade caso/modo/hipótese; reconcilia trades com entradas, contagens, P&L realizado, PF, EV, taxas de carteira encerrada, patrimônio e soma dos blocos. Recalcula a elegibilidade e ignora flags editáveis de status/seleção/aprovação. Mínimo30é triagem conservadora, não garantia estatística. Reconciliação agregada não substitui reconstrução dos candles/marcações por bloco, já reproduzidos pela etapa2.

Mesmo cenário sintético favorável permanece bloqueado por validação independente e pré-requisitos operacionais. O módulo é puro: não importa coletor/executor/cliente de conta ou ferramenta de deployment, não consulta período novo, não inicia testes e não envia ordens. O antigo comando de prontidão do estudo de lotefixo foi preservado como histórico; este novo comando avalia o relatório mais recente dimensionado por risco.

Política: examples/hybrid-economic-readiness.plan.json. Saída reproduzível: docs/hybrid-economic-readiness.json. As condições atuais da conta não são reconsultadas nem inventadas: foi fornecida cotação Read real0,40%/perna em19pares, mas saldo utilizável e mínimo de valor continuam desconhecidos. Paper com17simulados não exige depósito. O adaptador nativo e proteções do híbrido na Demo seguem não implementados/validados.

## Sessão Paper atual — continuar, sem reinício

Leitura Railway em24/11/2026: serviço Crypto-bot-Paper-48h live, deployment99d59867-9c9c-4053-94cb-952c2b77b23d SUCCESS, fonte fixada em6faa6bf, sem alterações pendentes. Último registro consultado24/11às18:38:55UTC(15:38:55Belém): observing, dados até18:30UTC,19pares,1fechamento,nenhuma posição aberta, netReturnUsdt=-0,03672678215361458, ordersSent=0, paidAiCalls=false. É uma fotografia consultada, não monitoramento contínuo ou resultado final. Os últimos13registros consultados são informativos; isso não apaga a falha/recuperação por candle ausente já observada às08h15Belém.

Recomendação: concluir a janela existente como observação experimental, aproximadamente25/11às14hBelém, sem trocar commit/parâmetros/custos/universo e sem zerar o volume. O relógio não certifica resultado: confirmar status completed, duração no checkpoint, cobertura e ledger. Uma falha impede chamá-la de48h ininterruptas; dados reconstruídos depois são identificados. Baixa amostra permanece inconclusiva e os resultados negativos de desenvolvimento não são revertidos pelo simples término da janela.

Não há motivo para reiniciar AGORA a mesma configuração negativa. Encerrar antes só pouparia hospedagem, sem produzir mais evidência; se houver falha persistente ou decisão de cancelar, preservar checkpoint.json/public-coverage.json e logs antes de encerrar. Não apagar lock/volume nem criar nova banca para esconder perda. Nenhuma ação de parada/reinício/deploy foi tomada nesta etapa.

Ao terminar: copiar/exportar o checkpoint preservando o original e executar o auditor da etapa1 em diretório separado. O checkpoint real ainda não está no workspace. A conclusão não equivale a auditoria desse arquivo ou à aprovação financeira. Após obter o relatório, encerrar o worker que já concluiu e manter os resultados; não iniciar outro ciclo automaticamente.

## Próximas atualizações e eventual nova janela

Podem ser implementadas no PR enquanto o worker permanece fixado no commit antigo. Atualizar a branch não atualiza automaticamente esse serviço fixado. Não precisa esperar o fim das48h para desenvolver/testar novas propostas offline. Cada mudança econômica precisa hipótese/protocolo explícito, custos comprovados, comparação com a referência e critérios anteriores à avaliação; não lançar nova grade para ajustar o mesmo histórico.

Uma nova sessão operacional só fará sentido para uma versão identificada e objetivo definido. Usar NOVO diretório persistente, código/configuração/custos/universo/risco congelados, sem misturar resultados antigos. O fingerprint atual impede migrar silenciosamente checkpoint de outra versão. Não mudar código só para preservar/adulterar o hash. O estudo antigo e seus intervalos/aquecimentos consultados são desenvolvimento; não serão chamados de holdout cego.

A próxima hipótese econômica precisa melhorar movimento capturado em relação a perda e custo, não simplesmente elevar lote/frequência. Escolher apenas estratégia justificável; duas famílias não são obrigatórias. Sem elegibilidade, manter bloqueio Demo/real e reavaliar a formulação, não a necessidade de capital maior.

## Reprodução e verificação

```sh
npm run build
npm run strategy:hybrid-economic-readiness -- docs/hybrid-economic-results.json docs/hybrid-economic-ledgers.json examples/hybrid-economic-experiments.plan.json examples/hybrid-economic-readiness.plan.json /NOVO_DIRETORIO
```

Oito testes novos cobrem evidência real negativa, hashes/identidades, flags de aprovação adulteradas, matriz incompleta/duplicada, métricas e ledger inconsistentes, cenário sintético favorável sem promoção e CLI offline sem sobrescrever saída. CI também compara o JSON arquivado e preserva a reprodução dos12experimentos e8referências históricas. Não há novo algoritmo de entrada/saída, coleta de holdout, merge ou implantação nesta entrega.
