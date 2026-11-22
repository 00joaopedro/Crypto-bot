# Recuperação de conciliação e comandos Demo — 22/11/2026

## Evidência da ocorrência

Os dois arquivos enviados descrevem a versão `a5991a7`, deployment `72125a46-2bf9-4274-b642-ebc4abe762a5`. O deploy anterior foi aplicado com sucesso. O motivo registrado às 02:40 UTC (23:40 de 21/11 em Belém) é `demo_bot_risk_attribution_unconfirmed`, com causa `position_balance_missing`. O histórico exportado não identifica qual ativo faltou.

O log HTTP distingue o aceite do comando da conferência: pausa em 424 ms; retomada aceita em 4 ms e estado efetivamente retomado cerca de 46 segundos depois. Posteriormente, a conciliação financeira pausou novamente. Respostas 499 observadas são requisições interrompidas pelo cliente, não prova isolada de falha do controle.

## Correção executada

1. **Reconciliação de zero:** a documentação de `GET /api/v5/account/balance` descreve uma lista de saldos não zerados. O verificador tratava qualquer chave omitida como saldo não confirmado, inclusive expectativa exatamente zero. Agora uma chave ausente é aceita como zero exclusivamente quando a expectativa independente é exatamente zero: posição reconstruída por ordens próprias, fills completos e taxas, mais o inventário original, ou um saldo original já zerado. Quantidades positivas, inclusive poeira, não são arredondadas para zero. `null`, NaN, saldo USDT ausente, ordens/fills incompletos, saldo positivo desaparecido e diferenças não atribuídas continuam bloqueados.
2. **Causa rastreável:** a conciliação passa a informar ativo, quantidade esperada, leitura efetiva/ausente e origem da comparação. A evidência acompanha risco, retomada manual, verificação automática e painel, sem expor chaves ou mensagens brutas da corretora. O alerta deixa de repetir o mesmo motivo genérico.
3. **Controle previsível:** clique pendente não é reabilitado por atualização periódica; cliques duplicados e respostas antigas são descartados. Uma pausa manual confirmada limpa o resultado antigo da tentativa de retomada. A retomada informa etapa/tempo; se exceder dois minutos, é abortada e uma pausa manual é persistida para impedir conclusão tardia. Toda retomada continua sujeita a saldo, atribuição, permissão, risco, proteções e revisão do controle. A interface identifica que supervisão de ordens/proteções não equivale à autorização financeira para operar.

A fila aguarda a conclusão das consultas já enviadas; cancelar a retomada não desfaz ordens previamente enviadas. O prazo de dois minutos limita o comando manual, sem autorizar entradas por timeout. Não há nova variável de ambiente.

## Testes

- Omissão do ativo após fechamento total, inclusive no fluxo checkpoint → ledger → risco → retomada.
- Omissão de saldo original zero, saldo original positivo, saldo positivo do bot, poeira, NaN, USDT ausente e fills incompletos.
- Preservação da causa detalhada e dos limites financeiros, sem registrar perda fictícia.
- Cliques duplicados, atualização durante pausa, resposta antiga, bloqueio específico, pausa manual e timeout sem retomada tardia.
- Chrome com viewport móvel: login, sessão, retomada pendente, cancelamento, causa específica, pausa e nova retomada segura.

## Após o deploy

Atualize o painel para carregar o novo JavaScript e solicite **Retomar bot** uma vez. Aguarde a etapa indicada. A confirmação é o estado persistido Online, com conciliação atual; o aceite 202 sozinho não comprova retomada. Não é necessário iniciar outro ciclo para corrigir esse defeito. Um erro real de saldo ou histórico continua exigindo conciliação e será identificado com mais precisão. A confirmação na conta do usuário depende de aplicar este deploy; os testes não presumem saldo ou lucratividade da conta.

Referência: https://app.okx.com/docs-v5/en/#trading-account-rest-api-get-balance
