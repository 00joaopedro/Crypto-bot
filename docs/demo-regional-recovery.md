# Recuperação de rejeição regional e janela Demo

## Incidente confirmado

O export de 21/11/2026, 21:26Z, contém a tentativa HYPE/USDT às 19:01:55Z
(16:01:55 em Belém). A resposta OKX tem `code: 1`, um único item com
`sCode: 51155`, `clOrdId` idêntico ao da intenção e `ordId` vazio. A intenção
ficou PENDING e a exceção foi registrada separadamente em FAILED. A pausa
`demo_order_not_confirmed` ocorreu às 19:01:56Z. O reconciliador anterior
somente reconhecia a rejeição 50123; a pausa também não era reavaliável.

## Recuperação implementada

- Conta confirmada e consulta autenticada da ordem exata precedem a resolução.
  Se a ordem for encontrada, o fluxo existente reconcilia a execução; isso não
  a transforma em rejeição. Se houver divergência ou evidência conflitante,
  a carteira continua bloqueada até auditoria completa.
- Uma consulta que falha não equivale a OrderNotFound. Para resolver 51155,
  exige-se resposta estruturada de um único item, identificação exata, sem
  ordem criada e mensagem compatível. Um erro genérico, lote ambíguo ou ID
  diferente permanece pendente. A regra legada 50123 continua separada.
- Intenção e falha correlata passam juntas a REJECTED_CONFIRMED em transação,
  sem apagar o erro. Auditoria e evento operacional registram o método/código.
  Não há reenvio da ordem, venda, ajuste de saldo ou fechamento financeiro.
- A migração 19 cria `demo_symbol_restrictions`, por conta e par. O bloqueio
  regional sobrevive a reinício. Não é a pausa estatística de seis horas por
  perdas. Após no mínimo seis horas, uma consulta privada atualizada que volte
  a listar o par permite solicitar a liberação; outra leitura do banco deve
  confirmar a liberação. Rejeição concorrente prevalece. A API pode mudar
  entre consulta e envio: uma nova recusa volta a bloquear o par.
- O catálogo autenticado `account/instruments?instType=SPOT` é consultado com
  cache de cinco minutos. Catálogo público, volume e sinal técnico não provam
  permissão de negociação. Conta diferente invalida o cache; falha na atualização
  não usa sucesso vencido. Endpoint indisponível mantém novas entradas bloqueadas
  com motivo explícito. A seleção e o preflight usam esse filtro; a gestão das
  posições existentes não depende de o ativo permanecer elegível para compra.
- A pausa técnica pode ser reavaliada quando AUTO_RESUME já estiver ativo,
  inclusive após restart. A liberação ainda exige todas as verificações de
  ordens, proteções, contabilidade e risco. Pausa manual não é desfeita.

## Carteira e Paper

A auditoria percorre todas as compras confirmadas mesmo se uma consulta de
proteção falhar. O resultado agregado continua bloqueado e inclui os pares
com falha; uma intenção HYPE pendente não impede consultar as outras cinco.
Stops já anexados na corretora não são cancelados por esta alteração.

O gerenciador Paper agora recebe o limite persistido no painel na inicialização
e restaura todas as posições abertas, também com risk sizing desligado. Não
depende de salvar a configuração novamente para sair do limite ambiente de 1.
Antes da retomada automática há replay exclusivo Paper, sem ordens na OKX ou
alertas de trades, para que a própria lacuna antiga não impeça sua recuperação.
Risco e revisão do controle persistido continuam sendo exigidos depois do replay.

Lacunas Paper podem ser recuperadas por paginação, com 100 candles de warmup,
no mesmo provedor, até o último candle fechado. Cada timestamp deve estar
presente; duplicatas conflitantes, preços inválidos, ausência de progresso e
orçamento excedido bloqueiam. Máximo de 32 páginas de 100 candles, orçamento
de 20 segundos entre requisições e intervalo de cinco minutos entre tentativas
por par. Chamadas individuais também têm o timeout do cliente. Não há
interpolação, mudança de corretora durante o replay, apagamento de posição ou
nova entrada histórica. Resultado, custos, risco e fechamentos recuperados
continuam sujeitos à persistência e às proteções existentes.

O Paper continua sendo uma simulação diferente da Demo: taxas configuradas
podem divergir das efetivas, e o trailing legado não é equivalente ao SL/TP
nativo fixo. Essas diferenças ficam explícitas no painel e no diagnóstico;
este PR não muda os parâmetros da estratégia para fabricar equivalência.

## Diagnóstico e validação

O painel distingue compra executada, confirmação pendente e rejeição regional.
O registro sintético de falha já reconciliado não aparece como segunda tentativa
na tabela quando a intenção correspondente está presente; ambos permanecem
no diagnóstico. O último snapshot Paper é identificado como tal. A supervisão
Demo tem horário próprio, indicação de desatualização e evento a cada cinco
minutos, inclusive com entradas pausadas.

Testes reproduzem 51155 aninhado, IDs conflitantes, batch ambíguo, ordem encontrada,
falha de consulta, isolamento por conta, restrição após restart, reavaliação de
seis horas, catálogo privado, auditoria das cinco posições após falha individual,
transação PostgreSQL, replay paginado sem entradas históricas e rótulos do painel.

Nenhuma variável nova é exigida. O novo commit deve ser implantado na Railway;
staging de origem não publica o código. Após deploy, confirmar migração, catálogo
privado, resolução HYPE, as cinco posições/proteções e reconciliação atual.
Se qualquer evidência faltar, o bloqueio permanece: iniciar um novo ciclo não
resolve ordens incertas. Somente depois da recuperação inicia-se a janela final
de 48h com versão e configuração congeladas. O histórico anterior é preservado;
a janela interrompida não é uma validação contínua de 48h ou prova de lucro.
