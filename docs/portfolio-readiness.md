# Refino econômico — execução 5: prontidão de carteira e orçamento

22/11/2026. Concluída a avaliação condicional. Estado:
`blocked_no_eligible_candidate`. Sem merge, ordens, alteração ativa, alocação ou
deployment solicitado. A combinação não foi simulada nem integrada: sua condição
prévia não foi atendida. Isso não é um erro de execução nem uma aprovação financeira.

Atualização posterior: a intenção atual é começar com **17 USDT**, conforme
[execução 6](refinement-independent-readiness.md). Os valores em reais abaixo
são o registro histórico da etapa 5, sem conversão ou revisão retroativa.

## Evidência consolidada

Comando novo `strategy:portfolio-readiness` lê os três relatórios das execuções
2–4, o resumo financeiro e os datasets congelados. Confere protocolo/hash,
referência, configuração/commit original e identidade dos datasets. Recalcula
cada decisão a partir das métricas, ignorando flags editáveis de aprovação.
Verifica fechamento dos blocos, contagens, expectativa e concentração; recusa
matriz incompleta, duplicada ou divergente da baseline financeira.

Há **40 linhas fornecidas e 32 únicas**. Oito linhas são repetições da baseline
entre os relatórios e foram removidas. As alternativas compartilham dados e não
são amostras independentes; não se soma P&L de carteiras isoladas para inventar
resultado combinado ou correlação.

| Candidata | Família | Resultado da prontidão |
|---|---|---|
| Referência | Trend | Líquido e expectativa negativos |
| Proximidade EMA21 | Trend | Líquido negativo, piora de PF/expectativa |
| Pullback confirmado | Trend | Negativo e amostra pequena |
| Pullback + RSI58 | Trend | Negativo e amostra pequena |
| Piso ATR 0,75% | Trend | Melhora, mas líquido e expectativa negativos |
| Trailing líquido com alvo | Trend | Negativo |
| Trailing líquido sem alvo | Trend | Melhora, mas líquido e expectativa negativos |
| Reversão confirmada | Reversão à média | Sem operações, sem amostra |

Resultado: **0 candidatas elegíveis, 0 famílias elegíveis, 0 USDT alocados**.
Nenhum melhor resultado negativo é selecionado. Zero operações não recebe
expectativa/PF favoráveis. Resultado antes das taxas não substitui líquido.

Cada candidata precisa passar nos quatro recortes 10/30 × padrão/adverso, com
lucro marcado e realizado, PF >1, expectativa positiva, pelo menos 30 fechamentos,
dois blocos positivos com pelo menos 15 e resultado sem os três melhores trades
positivo. São critérios descritivos de desenvolvimento, não prova estatística.

Mesmo passes sintéticos não alocam: uma só família encaminha para seleção e
protocolo independente de uma estratégia; duas famílias encaminham para protocolo
próprio de combinação. Não se exige uma segunda estratégia para avançar com uma
boa, nem se escolhem pesos automaticamente. Variantes trend não são tratadas como
estratégias independentes só por terem nomes diferentes.

## Condição para combinação futura

O relatório registra os requisitos, **sem afirmar que um motor combinado já foi
implementado ou testado**: caixa e limites compartilhados, identidade em cada
ordem/posição, reserva antes do envio, uma posição por par entre estratégias,
regra de conflito/ranking predefinida, orçamento compatível e comparação isolada
versus combinada após custos. Scores de famílias diferentes não são considerados
comparáveis sem regra explícita. Não há divisão 50/50 imposta.

Uma combinação pode alterar seleção, custos e exposição. Não é matematicamente
impossível melhorar carteiras com componentes negativos; os dados atuais não
oferecem fundamento suficiente para acrescentar essa tentativa e promovê-la.
Não se inventa benefício de diversificação sem replay conjunto e protocolo.

## Orçamento: o que a referência realmente permite

O orçamento de referência é **5.000 USDT**, lote teto fixo 10 USDT, até 30 posições,
exposição total 10% e altcoins 10%. Dimensionamento por risco está desativado na
referência. O estudo não foi uma simulação da banca pretendida de **R$100**.

A análise de capacidade usa o último fechamento congelado de 30/08/2026 às
23:45 UTC, regras registradas no dataset, custos dos dois cenários e carteira
vazia. Testa os mesmos lotes após arredondamento; verifica caixa, exposição,
quantidade/valor mínimos e quantidade vendável após a taxa. Não reduz o lote
silenciosamente para caber em banca menor nem aumenta a banca para atender mínimos.

| Capital ilustrativo USDT | Limite total USDT | Slots nominais de 10 USDT, com teto de posições | Pares com lote viável sob regras congeladas |
|---:|---:|---:|---:|
| 10 | 1 | 0 | 0/120 |
| 20 | 2 | 0 | 0/120 |
| 50 | 5 | 0 | 0/120 |
| 100 | 10 | 1 | 120/120 |
| 5.000 | 500 | 30 | 120/120 |

Os dois cenários deram as mesmas contagens de capacidade nessa fotografia;
isso não significa mesmos custos ou rentabilidade. Slots nominais são uma conta
ilustrativa do teto de exposição/lote, não promessa de posições executáveis.
É capacidade de caixa/exposição/mínimos; não verifica sinal, membership líquido,
liquidez de execução, região ou admissão operacional completa. Viabilidade de lote
não é sinal, alocação ou recomendação de aporte. Nenhuma
posição foi aberta nesta análise e todos os orçamentos por estratégia ficam nulos.

### Limitações materiais da banca

O coletor em `src/universe-study-cli.ts` captura `minSz` e `lotSz`, mas grava
`minimumNotionalUsdt: 0` literalmente para todos os 120 pares. Isso não é
comprovação independente de mínimo atual de valor igual a zero. Os resultados de
capacidade dependem dessa hipótese, dos preços e regras congelados; é necessário
confirmar os termos aplicáveis antes de execução real.

R$100 não foram convertidos por câmbio presumido. Não há saldo líquido confirmado
em USDT, custos de conversão/transferência nem fotografia atual das regras e
liquidez da conta pretendida. Estado da banca real:
`blocked_spendable_usdt_and_current_terms_unconfirmed`.

Não se importam como ativos os limites dormentes de risco por operação/par, nem
se aprova sizing adaptativo. Uma política futura de tamanho menor exige desenho
explícito, proteção e mínimos verificados. Aumentar banca ou dividir o saldo não
é uma demonstração de vantagem econômica. Gaps e execução podem exceder estimativas
baseadas no stop inicial; todas as limitações do replay anterior continuam.

## Reprodução

```sh
npm run build
npm run strategy:portfolio-readiness -- examples/portfolio-readiness.plan.json docs/pullback-experiments.json docs/volatility-exit-experiments.json docs/confirmed-reversion-experiments.json docs/financial-reference-current.json DIRETORIO_CONGELADO NOVO_DIRETORIO
```

Gera `summary.json`, versionado em `docs/portfolio-readiness.json`. Usa todos os
120 datasets cujos hashes coincidem com os relatórios e o manifesto, mas **não
repete as simulações de performance** nem simula uma carteira combinada. A
reprodução integral de cada estratégia permanece nos comandos das etapas 2–4.
Hashes e verificações provam consistência interna; não autenticam a origem dos
exports nem provam que as métricas foram produzidas corretamente pelos dados.
Não acessa corretora, banco, Railway ou ordens.

## Rota mais eficiente com a evidência atual

O roteiro ajudou a separar falhas operacionais de economia da estratégia. Após
os resultados negativos e a ausência de candidata, a prioridade passa a ser:

1. Confirmar, por leitura da conta pretendida, taxas por par, moeda cobrada,
   saldo líquido utilizável e mínimos/regras. Não usar uma taxa genérica menor
   ou confundir condições Demo com as da conta onde se pretende obter renda.
2. Refazer a referência econômica apenas se novas evidências alterarem os custos
   ou o capital. Se houver inviabilidade de mínimos/exposição, definir isso
   antes de gastar novos testes em estratégia. Não presumir que custos menores
   transformarão automaticamente uma estratégia negativa em lucro.
3. Depois, uma hipótese econômica explícita por vez, com custos confirmados,
   critério de parada e protocolo antes do replay. Menor giro ou horizonte maior
   pode ser pesquisado como hipótese; não foi testado nem aprovado aqui.
4. Só uma candidata justificável avança para dados independentes congelados e
   depois integração. Mais estratégias e mais capital não são requisitos para
   tornar uma lógica sem vantagem demonstrada pronta.

A OKX orienta conferir a taxa da própria conta/par enquanto autenticado e a taxa
cobrada no fill. Ordens limitadas podem ser taker; não basta trocar o tipo de
ordem e assumir custo maker. Fonte oficial consultada em 22/11/2026:
[Trading Fee Rules FAQ](https://www.okx.com/help/trading-fee-rules-faq), seções 2–6.
A documentação pública não revela as taxas privadas da conta deste usuário.

Etapa 6 continua bloqueada sem candidata; dados novos não foram consultados.
Etapa 7 financeira e a escolha de versão aprovada para 48h também dependem da
candidata. As 48h podem verificar execução e reconciliação da versão definida,
sem se tornarem garantia de lucro ou substituírem validação independente.

Os resultados atuais não sustentam contar com este bot como renda previsível
no curto prazo. O processo pode descobrir uma configuração viável ou mostrar
que o projeto precisa de outra hipótese. Nenhum ganho ou prazo para lucrar é
prometido como consequência de completar sete etapas.

## Validação

11 testes novos: evidência real negativa, deduplicação sem pooling, flags de
aprovação adulteradas, matriz/identidade/protocolo inválidos, blocos/expectativa
incoerentes, uma família versus duas sintéticas, ausência de alocação/promoção,
capacidade com lote fixo/exposição compartilhada, mínimos pós-taxa em base,
reserva de taxa em quote, regras não verificadas e CLI com preservação de inputs
e rejeição de hash adulterado. Fixtures sintéticas não autenticam performance.
Local: 534 testes aprovados, 20 PostgreSQL pendentes de CI. Tipagem, build,
gerador com dados congelados e diff check aprovados; CI verifica banco, Docker
e smoke móvel após publicação.
