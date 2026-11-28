# Refino econômico — execução 6: prontidão independente e banca de 17 USDT

22/11/2026. Avaliação condicional concluída: `blocked_no_eligible_candidate`.
**O teste em dados novos não foi executado.** Nenhuma janela foi selecionada,
coletada ou simulada. Sem merge, ordem, transferência, deployment solicitado ou
mudança de configuração ativa.

## Banca atual e compatibilidade

O usuário declarou intenção de começar com **17 USDT**, aumentando apenas se o
bot demonstrar viabilidade. Isso substitui a antiga intenção aproximada em reais;
não comprova depósito/saldo disponível. O protocolo novo
`examples/portfolio-readiness-17usdt.plan.json` usa versão v2 e valor planejado,
com `spendableUsdt=null`. A versão v1, seus relatórios e os estudos anteriores
continuam reproduzíveis como registros históricos.

O orçamento histórico continua **5.000 USDT**; os resultados não foram
retroativamente convertidos para uma banca de 17. O resumo atual de capacidade é
`docs/portfolio-readiness-17usdt.json`. No cenário padrão e no adverso:

| Banca planejada | Limite compartilhado de exposição (10%) | Lote fixo da referência | Pares com esse lote admitido pela capacidade |
|---:|---:|---:|---:|
| 17 USDT | 1,70 USDT total | 10 USDT | 0/120 |

1,70 é o teto **total compartilhado**, não uma cota independente para cada par.
Isso mostra incompatibilidade do lote atual com os limites atuais. Não demonstra
que toda estratégia com 17 USDT seja impossível. Um lote menor precisa ser
explicitamente desenhado e verificado contra mínimos, precisão, taxas, proteção
e risco. Não se aumenta a exposição para acomodar lote de 10, não se exige aporte
para 100 USDT e não se ativou dimensionamento novo nesta execução.

## Resultado da avaliação independente

O comando `strategy:refinement-readiness` recalcula elegibilidade dos relatórios
2–4 e confere protocolo, identidade da fonte, referência e consistência numérica.
As flags editáveis de aprovação não liberam nada. O período conhecido é
25/07/2026 a 31/08/2026 exclusivo, incluindo os 672 candles de aquecimento.
Isso identifica apenas a janela registrada, não prova completude de todo o
histórico de inspeções realizadas fora do comando.

Bloqueios registrados:

- Nenhuma das oito candidatas passou nos quatro recortes de desenvolvimento.
- A banca de 17 USDT não foi reproduzida nos testes de desempenho de 5.000 USDT.
- Estabilidade de parâmetros vizinhos ainda não demonstrada.
- Custos da conta pretendida, saldo utilizável e regras atuais não confirmados.
- Falta congelar candidata, commit, custos, universo, capital e risco elegíveis.
- Registro completo das janelas consultadas não verificado.

O teste independente futuro deve congelar tudo antes de consultar o período,
excluir sobreposição da avaliação **e do aquecimento** com todas as janelas já
vistas e definir blocos, amostra, PF/expectativa líquida, concentração, drawdown e
custos adversos antes dos resultados. Um resultado negativo reprova a candidata;
não vira ajuste do mesmo período chamado de novo teste cego.

A nova ferramenta não implementa um coletor de candles independentes nem um
atalho para aprovar as variantes novas pelo protocolo antigo de custos. Pedir
`--prepare-freeze` é recusado **antes de abrir** o arquivo proposto. Mesmo um
passe sintético de desenvolvimento permanece bloqueado pelos pré-requisitos;
a preparação/execução futura exige implementar e comprovar esses requisitos.

Estado reproduzível em `docs/refinement-independent-readiness.json`:
`independentDataCollected=false`, `newWindowSelected=false`,
`freezePrepared=false`, `holdoutExecuted=false`, `configurationPromoted=false`,
`realMoneyApproved=false`.

```sh
npm run build
npm run strategy:refinement-readiness -- examples/portfolio-readiness-17usdt.plan.json docs/pullback-experiments.json docs/volatility-exit-experiments.json docs/confirmed-reversion-experiments.json docs/financial-reference-current.json examples/universe-validation.study.json NOVO_DIRETORIO
```

A capacidade da banca usa somente os mesmos dados congelados:

```sh
npm run strategy:portfolio-readiness -- examples/portfolio-readiness-17usdt.plan.json docs/pullback-experiments.json docs/volatility-exit-experiments.json docs/confirmed-reversion-experiments.json docs/financial-reference-current.json DIRETORIO_CONGELADO OUTRO_DIRETORIO
```

## Como obter taxas, mínimos e saldo sem ordens

### Pela interface autenticada da OKX

Consultar a área de taxas da própria conta e as regras do par escolhido. Ver o
saldo **disponível de USDT da conta de negociação**, não apenas patrimônio total
ou saldo de financiamento. Ler os mínimos/regras do par. Se já existem fills,
a taxa efetivamente cobrada pode ser conferida no histórico, sem fazer nova ordem.
Demo e conta real são contextos diferentes; evidência de uma não comprova a outra.

### Coletor separado, somente leitura

Adicionado `account:inspect-readonly`, sem dependência da chave operacional do
bot. Requer uma chave dedicada com permissão **Read**, sem Trade nem Withdraw,
configurada privadamente no ambiente do comando:

- `OKX_READ_API_KEY`
- `OKX_READ_SECRET_KEY`
- `OKX_READ_PASSPHRASE`

Não colocar valores no chat, código, argumentos de terminal ou Git. `.env` já
é ignorado pelo repositório. A pasta `.account-terms/` agora também é ignorada.
O programa não consulta nem copia as chaves operacionais como fallback.

```sh
npm run build
npm run account:inspect-readonly -- real .account-terms/real-terms.json BTC/USDT ETH/USDT SOL/USDT
```

Para a Demo, usar `demo` e chave **Read da Demo**. Não usar o mesmo contexto como
prova da conta real. O ambiente é explícito, preso ao cliente imutável, sem fallback;
a Demo envia `x-simulated-trading: 1`. O domínio é fixado ao endpoint oficial
`https://openapi.okx.com`; não há URL arbitrária ou redirecionamento de credenciais.

| Consulta GET | Informação projetada |
|---|---|
| `/api/v5/account/config` | Confirma permissão Read; modo/condições de empréstimo usados internamente |
| `/api/v5/account/balance?ccy=USDT` | `availBal`, `cashBal`, `liab` de USDT, sem confundir `availEq` com dinheiro disponível |
| `/api/v5/public/instruments?instType=SPOT` | `minSz`, `lotSz`, `tickSz` do par spot ativo |
| `/api/v5/account/trade-fee?instType=SPOT&instId=BTC-USDT` | Cotação da taxa taker da própria conta para o par, repetida para até três pares |

A interface do cliente só expõe GET em quatro rotas permitidas. Não possui
método para ordens, cancelamentos, transferências, ajustes de saldo ou configuração.
Rejeita chave com permissão de escrita após a primeira leitura de configuração,
antes das demais consultas. São no máximo três pares para limitar chamadas de taxa.

A API de taxas usa sinal negativo para cobrança e positivo para rebate; o coletor
normaliza cobranças e deixa rebates não modelados como desconhecidos. Falha não
vira taxa padrão/zero. Regras ausentes não viram mínimo de valor zero:
`minimumNotionalUsdt=null` quando não informado. Taxas especiais/isenções podem
exigir confirmação adicional; uma cotação não é um fill nem custo histórico.

O valor `withinDeclaredBudgetUsdt` é um **limite superior**, mínimo entre 17,
disponível e caixa observado. Não é alocação. Confirmação simples de caixa exige
modo spot identificado, empréstimos desativados e passivo zero confirmado;
campos ausentes, margem ou dívida ficam `requires_account_review`.
O relatório não libera negociação nem recalibra automaticamente os estudos.

O arquivo é criado com permissão restrita (0600), sem sobrescrever um arquivo
existente. Exporta só campos permitidos, sem chaves, assinaturas, IDs, rótulos de
conta ou payload bruto. Erros não expõem mensagens brutas da API ou credenciais.
Ainda contém saldo e informações privadas: conservar fora do Git. O console não
imprime o saldo nem o relatório completo.

**Nenhuma consulta privada à conta do usuário foi realizada nesta execução.**
O coletor foi verificado com respostas simuladas e está disponível para gerar a
fotografia autenticada quando as credenciais de leitura forem configuradas.
Não foi criada chave, alterada permissão, solicitada transferência ou ordem.

Documentação oficial consultada em 22/11/2026:
[OKX API guide](https://www.okx.com/docs-v5/en/) — permissões, ambientes,
Get balance, Get instruments, Get fee rates;
[Trading Fee Rules FAQ](https://www.okx.com/help/trading-fee-rules-faq) — taxa da
própria conta/par e histórico de fills. A documentação pública não autentica os
saldos nem as taxas privadas desta conta.

## Próximo passo e janela de 48h

Obter a fotografia de leitura ajuda a definir custos, capital e lote compatíveis,
mas não resolve a falta de candidata aprovada. Mudanças de custos/lote/banca
precisam de nova referência de desenvolvimento explícita antes de usar dados
independentes. Não se publica como validada uma estratégia por ter completado
as sete avaliações. Etapa 7 financeira permanece condicionada; 48h de Demo
verificam operação de versão definida/congelada, sem garantirem renda ou lucro.

## Validação

12 testes novos: banca planejada 17 versus referência preservada; compatibilidade
v1/v2; flags adulteradas, source inválido e passe sintético ainda bloqueado;
CLI recusa proposta antes da leitura; cliente GET allowlist/HMAC/sem redirecionamento,
ambiente explícito imutável e separação Demo/real; ausência de segredos/IDs no
snapshot; limites de caixa, passivos e campos desconhecidos; mínimos/precisão,
sinal de taxas, falha sem fallback e rejeição de chaves com escrita.
O teste de orçamento existente também passou a cobrir o cenário de 17 USDT.
Local: 546 aprovados, 20 PostgreSQL pendentes de CI. Tipagem, build e geração dos
relatórios com fontes já consultadas aprovados; CI verifica banco, Docker e smoke
móvel. Não há teste real com fundos ou resultado independente declarado.

## Consulta manual pelo painel na Railway

A versão atual do PR adiciona o botão autenticado **Verificar conta (leitura)** e download sanitizado. Usa as três OKX_READ_* acima e **OKX_READ_ENVIRONMENT=real ou demo**, sem fallback para a chave operacional e sem consulta automática. O coletor CLI anterior mantém ambiente no argumento; a quarta variável é para o fluxo do painel. Instruções e serviço identificado: `docs/okx-readonly-railway.md`. O botão só existe depois da implantação da versão correspondente.
