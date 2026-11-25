# Execução 3 — decisão verificável e portão operacional

## Resultado

Execução de avaliação concluída: `blocked_no_eligible_candidate`, zero candidatas elegíveis. Esta é a decisão da matriz mais recente, de26casos da execução2, não da matriz antiga de12casos. As10alternativas continuam sem satisfazer os critérios congelados. Não foi executado holdout, coletado período independente, implementado/promovido adaptador híbrido nativo ou iniciada nova sessão48h.

O pequeno positivo do C no custo padrão não supera estresse negativo, apenas2trades e concentração integral dos ganhos positivos em1operação. A/B completo também não passa. Ausência de operações não é rentabilidade. Não flexibilizar critérios após consultar resultados nem executar Demo para substituir vantagem econômica ausente.

## Entrega

Novo comando, exclusivamente offline:

```sh
npm run strategy:hybrid-evolution-readiness -- docs/hybrid-evolution-results.json docs/hybrid-evolution-ledgers.json examples/hybrid-evolution.plan.json examples/hybrid-evolution-readiness.plan.json /NOVO_DIRETORIO
```

O plano vincula por SHA256 os bytes do relatório, ledgers e protocolo já congelados. Confere dataset, critérios/protocolo, risco, nomes das26combinações e modo/custo correspondente. Recalcula seleção a partir dos números, ignorando status/seleção/aprovação editáveis do JSON. A função importa somente crypto/util, Zod e a triagem pura extraída; não carrega coletor, PaperTrader, cliente de conta ou executor. Extração preserva integralmente resultados anteriores.

Reconciliados: contagens e identidade de entradas/fechamentos; fechamento sem entrada/duplicatas; sinal anterior à abertura; carteira compartilhada sem sobreposição nem reuso na mesma vela; universo da fonte; taxas de entrada em base e saída taker modeladas por par; quantidade/preço/proventos; caixa líquido; PF, EV, win rate; top3 e lucro semtop3; detalhamento por modo, inclusive C; fechamentos nos blocos corretos; soma dos retornos dos blocos, patrimônio, recuperação; tempo em posição/ocupação de capital. Carteiras encerradas reconciliam todas as taxas e o retorno com o ledger. Posição aberta não é tratada como fechamento.

Não reconstrói candles, trajetória do drawdown ou marcações intrabloco. A identidade dos bytes e a reprodução da execução2 no CI continuam sendo a evidência dessas séries, não autenticidade de fills. Taxa/livro/slippage históricos são modelos; quote Read não prova cobrança efetiva. Mesmo dados sintéticos favoráveis continuam bloqueados por validação independente e pré-requisitos operacionais.

Resultado reproduzível em `docs/hybrid-evolution-readiness.json`. Os comandos/relatórios legados de prontidão permanecem disponíveis para suas matrizes antigas.

## Sessão Paper existente — observação operacional separada

Consulta somente de metadados e últimos logs Railway em25/11/2026: fonte continua fixada no6faa6bf, deployment99d59867 SUCCESS, nenhum staged change. Log final às16:53:10UTC /13:53:10Belém registra `completed`, cobertura declarada até16:45UTC,19pares,1fechamento, resultado -0,03672678215361458USDT, posição aberta null, nenhuma ordem/IApaga/aprovação real. O encerramento foi feito pelo worker original, não por esta execução.

Isso confirma o evento final e o resumo reportado, não auditoria do arquivo persistido ou48h ininterruptas. Há falha/recuperação de candle já conhecida. Não foi obtida cópia do volume nesta execução. Checkpoint completo e public-coverage precisam ser copiados e auditados offline para reconciliar a sessão real; o auditor existente pode fazê-lo sem alterar os originais. Logs resumidos não substituem esses arquivos. O timestamp desta observação não é misturado ao relatório determinístico.

Não foi reiniciado ciclo, alterada fonte/variável ou aplicado deploy. Nova compilação exige diretório/sessão separados; não migrar fingerprint de checkpoint antigo. Nenhuma decisão do titular é necessária para manter o bloqueio econômico.

## O que continua condicionado

| Condição | Estado |
|---|---|
| Vantagem econômica da candidata nos critérios congelados | Reprovada nesta formulação |
| Protocolo independente e dados ainda não consultados | Não executados; sem candidata elegível |
| Banca17, teto10 e limites existentes | Preservados; sem aumento para vencer mínimos |
| Saldo utilizável, mínimo de valor e acesso da conta | Não certificados por esta avaliação |
| Maker para proposta post-only | Desconhecido; não presumido mais barato |
| Entrada híbrida, stop/OCO/trailing/time-stop nativos e reconciliação | Não validados; nenhum adaptador aprovado |
| Kill switch e limites no futuro adaptador nativo | Precisam validação de integração; proteções Paper não provam execução na corretora |
| Nova janela48h e dinheiro real | Não autorizados pelo relatório |

Não repetir48h da candidata reprovada esperando que a mesma lógica se torne rentável. As três execuções encerram esta formulação com decisão negativa; qualquer nova hipótese econômica deve ser explicitamente definida/congelada antes de experimentar. Implementar infraestrutura de ordens nesta fase não resolve expectativa negativa.

## Validação

Oito testes novos: matriz real negativa, identidade/risco/custos, flags falsas/matriz incompleta, PF/EV/concentração/modos/blocos/recuperação, caixa/taxas, sobreposição/posição aberta, caso favorável sintético sem promoção e CLI sem sobrescrita. CI confere a decisão arquivada e reproduz8referências,12experimentos antigos e26casos atuais/ledgers. Nenhuma chave nova, consulta privada, IA paga, ordem, merge, deploy ou reinício.
