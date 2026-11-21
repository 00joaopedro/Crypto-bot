# Correção NEAR: encerramento operacional e preparação das próximas 48h

## Evidência e causa

O export de 20/11/2026 atingiu 500 eventos operacionais, todos relativos ao mesmo
`partial_exit_without_live_coverage` de NEAR. Compra 2,92654375, taxa base
0,011706175, venda 2,91483757: sobra líquida aproximadamente 0,000000005 NEAR.
O incremento observado era 0,00000001 e o mínimo 1 NEAR. Os eventos retidos
cobrem somente parte da janela: não provam ausência de outras causas nas 48h.

Havia duas verificações distintas: a auditoria só reconhecia resíduo inferior
a um incremento para venda de recuperação; a admissão ainda comparava volumes
brutos e podia interpretar a taxa base como posição descoberta.

## Correções nesta execução

1. Reconhecer resíduo subincremento também em proteção nativa efetivada, somente
   após venda vinculada, ordens terminais, fills completos e taxas confirmadas.
   Exigir incremento e mínimo positivos e precisão TICK_SIZE. A sobra deve ser
   estritamente menor que o menor dos dois. Não basta estar abaixo do mínimo.
2. Reutilizar a mesma comprovação líquida na segurança/admissão para saída
   nativa efetivada. Falta de evidência continua bloqueada. Não enviar outra venda.
3. Preservar quantidade/custo residuais no ledger. Encerramento operacional
   não significa apagar saldo, inventar trade financeiro encerrado ou lucro.
4. Registrar bloqueio em transição e recuperação, suprimindo repetições iguais.
   As consultas de segurança continuam a cada ciclo. Se a gravação falhar,
   tentar novamente; após reinício, registrar o bloqueio ativo novamente.
5. Permitir reavaliação automática destas pausas técnicas quando a opção de
   auto-resume já estiver habilitada. Não é retomada incondicional: exige
   auditorias, conta/permissão, patrimônio, riscos Paper/Demo, mercado quando
   configurado e revisão de controle compatíveis. Pausa manual não é removida.

Testes reproduzem os números NEAR, taxas em moeda base, resíduo persistido,
auditoria, admissão, saída realmente parcial (inclusive submínima mas acima do
incremento), taxa/histórico ausente, venda pendente, proteção cancelada, logs
repetidos, recuperação, falha de banco e origem manual da pausa.

## Análise do estado atual

- **Código operacional:** os caminhos relacionados a este bloqueio foram
  corrigidos e possuem regressão automatizada. Stops nativos e reconciliação
  continuam obrigatórios. Não removemos proteções para gerar ordens.
- **Implantação:** consulta Railway de 20/11 retornou serviço live, branch main,
  commitSha ad3add3 e último deployment SUCCESS criado em 19/11 às 19:17 UTC.
  A origem contém pin de commit: nome da branch não prova que merges recentes
  estejam em execução. Esta revisão precisa ser implantada e lida de volta.
- **Prontidão das 48h:** condicional à implantação correta e auditoria ao vivo
  segura. Sem esse readback, não é correto afirmar que o bloqueio desapareceu
  na corretora. Validar identidade da conta, permissões, ausência de PENDING,
  cobertura das proteções, custos/mínimos, timestamp dos candles e estado da
  pausa. Outro motivo de bloqueio deve ser analisado, não ignorado.
- **Configuração:** registrar commit e hash efetivos antes da janela, preservando
  configurações de posições herdadas. Não reiniciar estatísticas enquanto a
  reconciliação estiver bloqueada. Após estar segura, abrir um único ciclo e
  manter parâmetros. Exportar antes de atingir o limite de registros.
- **Trades:** zero fills não valida execução; não forçar trades, alargar risco
  ou reduzir filtros para obter amostra. Se não houver sinais, estender a
  observação e registrar essa limitação. Proteções devem continuar durante pausa.
- **Estratégia:** tendência e hipótese complementar seguem negativas nos estudos
  já vistos. A correção melhora a confiabilidade operacional, não comprova edge.
  Não há aprovação para uso real. A revisão financeira é separada do teste técnico.
- **Banca:** usuário confirmou R$100 como orçamento pretendido para eventual
  piloto. O saldo equivalente em USDT, conversão/custos, regras atuais do
  instrumento e compatibilidade com risco permanecem a conferir. Não presumimos
  cotação nem elevamos lote para satisfazer mínimo. Nada habilita dinheiro real.

É possível concentrar a correção de código e preparação nesta execução/PR61.
A observação das 48h e sua aceitação só podem ocorrer depois da implantação,
com evidência nova. Um teste unitário ou CI verde não substitui essa observação.
