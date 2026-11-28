# Pullback maker — execução1 concluída, sem entradas admissíveis

28/11/2026. Resultado: **blocked_no_eligible_candidate**. Houve59sinais brutos, mas nenhum passou nos critérios econômicos congelados. Zero ordens simuladas, zero fills, zero fechamentos e P&L0 em ambos os custos. Isso não é lucro nem evidência de vantagem; expectativa, PF, win rate e MFE/MAE de posições permanecem indefinidos.

## Evidência e congelamento

Regras/código/testes sintéticos publicados antes do primeiro scan histórico no commit `23f0627759ba3476604d81901fb137ff20ae90a5`. Protocolo SHA256 `3ae37a9f920c1c42b1a1e30ab5aa39d8c2e29c3c20d00a57ae6d74aeb2839f62`. Manifesto de vínculo em `examples/maker-pullback.freeze.json`. Sem alteração de sinal, alvo2R, stop, gate, custos ou critérios após o resultado.

A coleta pública foi executada no commit `a69af1cc58bd90cd35f012e497afb7220a95e4e7`, run46167958759. Artefato15272675873, ZIP SHA256 `7f457b8f1d2c899fa5df803fab00412c2504e49a57251500b784a6ca0fa9bfe8`, [arquivo de origem](https://github.com/00joaopedro/Crypto-bot/actions/runs/46167958759/artifacts/15272675873).

Fonte1h existente de90dias: dataset `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`. Coletados3.540candles1m confirmados, em59janelas de60minutos, sem lacunas/conflitos e com agregação coerente com1h. Nova fonte de minutos SHA256 semântico `44b9ef6de474a1ad83861d141538d10afced695a25f4088fc7f4dc5d0d60890b`. Não foram baixados90dias inteiros de1m nem gravados candles no banco.

Consulta pública de instrumentos coincidiu com os minSz/lotSz/tickSz congelados deBTC/ETH/SOL. Isso confirma a comparação pública realizada nesta coleta, não regras históricas, mínimo de valor, saldo utilizável, acesso privado/Demo ou taxa efetivamente paga. Maker0,10% e taker0,40% são os dados transcritos pelo usuário; nenhuma nova leitura privada foi realizada.

O replay offline local reproduziu resumo e ledger doCI exatamente. A projeção de quantidade após taxa foi padronizada para a mesma aritmética decimal dos fills; conferência das118cotações (59×2) não encontrou diferença e resumo/ledger/diagnóstico permaneceram idênticos. Foi uma correção preventiva de consistência numérica, sem relaxar parâmetros ou alterar resultados.

## Resultado completo

| Cenário | Sinais brutos | Ordens simuladas | Fills / fechamentos | P&L USDT | PF / EV |
|---|---:|---:|---:|---:|---|
| Maker0,10% / taker0,40%, atrito padrão |59|0|0 /0|0|indefinidos|
| Taxas/atrito dobrados e menor participação |59|0|0 /0|0|indefinidos|

Carteira simulada começa e termina em17USDT, sem posição ou reserva pendente; nenhuma taxa debitada. Drawdown observado0, que não aprova a hipótese sem atividade. Cada um dos três blocos sequenciais de30dias tem zero operações e P&L0. Não são janelas independentes nem uma validação walk-forward cega.

Os sinais foramBTC16,ETH23,SOL20; os dois custos partem do mesmo conjunto. Havia2159fechamentos1h elegíveis por par, excluindo a última decisão sem próxima abertura. Os filtros de contexto e rejeição não são contagens independentes de trades; o funil completo está noJSON.

## Causa: payoff líquido insuficiente

No estado inicial de17USDT, as59quantidades propostas passam no mínimo de compra/venda após taxa em ambos os custos. Todos os sinais foram barrados pelo gate econômico ANTES de colocar uma ordem. Portanto, nesta carteira simulada, não foi falta de saldo, horário da coleta, dado de minuto, mínimo de quantidade ou não preenchimento da ordem.

| Diagnóstico das59propostas | Padrão | Adverso |
|---|---:|---:|
| RR líquido mediano |0,1660|-0,2752|
| Maior RR líquido encontrado |1,0763|0,5836|
| Rejeições pelo mínimo de RR1,5 |59|59|
| Rejeições pelo ganho>=2×custo |53|59|
| Rejeições por quantidade mínima |0|0|

As duas contagens econômicas se sobrepõem; não somá-las. Distância bruta mediana até stop0,4394% e até alvo0,8698%. Um alvo de2R **bruto** não vira2R líquido: comissão aproximada0,50% por ida/volta, atrito de saída e arredondamento retiram parcela relevante desse movimento. Na melhor proposta, RR líquido ainda ficou abaixo de1,5. Isso não permite concluir que qualquer estratégia maker é inviável; conclui apenas que esta formulação não produziu operações admissíveis no período consultado.

Nenhuma comparação de lucro entre maker e taker foi possível, pois não houve entrada. Não se afirma redução de taxa efetivamente paga, preenchimento real, efeito de fila, tempo de cancelamento na corretora ou segurança nativa. Zero trades não prova que a política de cinco minutos teria bom desempenho.

## Entrega técnica e limites

- Scanner separado de pesquisa1h/4h, com velas fechadas, transição, limite e stop técnicos/ticks. Sem alteração do scanner de produção ou das estratégias antigas.
- Componente puro de ordem para reutilização: reserva de caixa, fills parciais/idempotentes, expiração/cancelamento do restante, maker embase/taker emquote, quantidade vendável e poeira, proteção simulada e bloqueio de parcial abaixo do mínimo.
- Modelo1m exige penetração além do limite e limita participação no volume; toque não basta. Continua sendo hipótese de execução sem livro/fila/agressor/latência. Stops/gaps pessimistas e ausência de TP no minuto de novo fill são convenções, não garantia de limite inferior do lucro.
- Parcial desprotegível bloqueia o replay com inventário não resolvido em vez de inventar venda. Cobertura ausente também impede emitir desempenho completo da carteira.
- Esses caminhos de execução foram cobertos por testes sintéticos; não foram exercitados por trades históricos desta rodada. MFE/MAE de posições estão explicitamente null, não0. As cotações diagnósticas são projeções por sinal, não resultados de operações.
- Independente/holdout não coletado; sem Demo nativa, dinheiro real, ordens, IA paga, deploy, reinício, alteração deRailway ou merge. A conta real continua sem saldo, conforme informado; não é necessário depósito para este estudo.

## Validação e reprodução

13testes novos cobrem regras fechadas/futuro, reserva/expiração, parcial/fees/dust, idempotência/conflito, precisão semepsilon, gate bruto versus líquido, stop-first/gap e não creditar alvo retroativo, bloqueio de inventário abaixo do mínimo, cobertura/duplicatas/coerência dos minutos e rotas públicasGET sem credenciais. Tipagem/build aprovados. A suíte local anterior teve694aprovados+32dependentes deCI, antes dos dois testes adicionais; CI final deve confirmar728totais e é registrado noPR.

CI acrescenta coleta limitada/reprodução offline e comparação exata dosJSONs. Cache ausente restaura a fonte de minutos do run46167958759; fonte divergente é recusada ANTES do replay. Não há recolhimento silencioso de outra fonte após arquivar resultados. Estudos antigos permanecem reproduzíveis pelos workflows existentes.

```sh
npm run build
npm run strategy:maker-pullback -- --replay /CAMINHO/frozen1h.json /CAMINHO/minutes.json /NOVO_DIRETORIO
node scripts/maker-pullback-diagnosis.mjs /CAMINHO/frozen1h.json /CAMINHO/minutes.json /NOVO_DIRETORIO /NOVO_DIRETORIO/diagnosis.json
```

Arquivos: `maker-pullback-results.json`, `maker-pullback-ledgers.json`, `maker-pullback-diagnosis.json`, `maker-pullback-protocol.md`; minutos preservados no artefato/cache, não no banco ou Git.

## Próximo passo

Execução1 concluída sem candidata elegível. Manter essa formulação arquivada, sem retirar o gate ou ampliar alvo retrospectivamente. A hipótese2de compressão/rompimento com reteste e saída3R/trailing continua pendente e poderá reutilizar a infraestrutura, com seu próprio congelamento. Ela não está aprovada por esta entrega e também pode reprovar. Nenhuma nova janela48h é justificada por este resultado; não há necessidade de novos prints ou depósito agora.
