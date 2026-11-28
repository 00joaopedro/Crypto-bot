# Execução 1 — custos, oportunidades e capacidade de 17 USDT

26/11/2026. Diagnóstico histórico concluído; atualização autenticada da conta pendente. Estado `diagnosis_complete_account_refresh_pending`. Nenhuma estratégia selecionada, parâmetro ajustado, ordem, IA paga, merge, reinício ou deploy.

## Escopo e identidade

Analisados separadamente os 12 casos econômicos, 26 de evolução, quatro de horizonte e a sessão real de 48h Paper. São 42 casos históricos mais uma sessão; há referências repetidas e períodos sobrepostos. Não somar operações/ganhos entre casos como evidências independentes. Todas as alternativas negativas continuam arquivadas. Não foi consultado holdout nem escolhida uma nova estratégia nesta execução.

Fontes públicas recuperadas do artefato 15072833477 do run 45723755295, ZIP SHA256 `8ab8d901086731df9ca641f339d8c473ab8332d0556e850a2ff164e13a27da54`. Verificados os datasets semânticos congelados: 15m `fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4` após a mesma normalização de esquema do estudo original; 1h `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`. Não houve nova coleta histórica nem substituição de fonte.

Checkpoint recebido: SHA256 dos bytes `9fe103f40a0f0b26b47e8ca47a029f77707428a70eb79ea05a3373102e769327`; cobertura `afacb4811cfd5c6c517e199a2f6ca51f41e156e1175b7f4b403f41b7bd3f4d4f`. Auditor existente reexecutado: selos, candles e ledger reconciliados, 19 pares, sessão completed, uma operação e nenhuma posição aberta. Não é preciso pedir novamente esses arquivos. Essa reprodução não prova ausência de interrupções; os logs antigos já registram falha/recuperação por candle.

`opportunity-cost-diagnosis.json` contém fontes/hashes, todos os casos, decomposição, MFE/MAE, janelas posteriores, grupos por modo/par/saída/sessão UTC, funil da sessão e capacidade condicional. Não contém credenciais, identificação de conta ou saldos reais privados. O CLI gera também `trade-attribution.json` com os detalhes por trade; pode ser reproduzido pelos arquivos originais, sem consultá-los na corretora.

## O que o diagnóstico mostrou

| Estudo / caso / custo padrão | Fechamentos | Líquido USDT | Sem taxas nos mesmos fills | Sem taxas/atrito no mesmo percurso de referências |
|---|---:|---:|---:|---:|
| 30d A referência | 3 | -0,042532 | -0,001813 | +0,016076 |
| 30d B referência | 16 | -0,228898 | -0,012955 | +0,081916 |
| 30d A com ROI temporal | 3 | -0,014676 | +0,026267 | +0,044254 |
| 30d C squeeze | 2 | +0,014156 | +0,041666 | +0,053752 |
| 90d referência 1h/4h | 72 | -1,459745 | -0,518872 | -0,105514 |
| 90d candidata ATR/gate | 35 | -0,562076 | -0,094348 | +0,111141 |
| 48h Paper original | 1 | -0,036727 | -0,023340 | -0,017459 |

As últimas duas colunas são atribuição contábil do MESMO conjunto de entradas, valores e referências de saída. Não representam novo backtest com taxas zero: nesse caso gates, alvos/trailing, caixa e trades admitidos poderiam mudar. Não são previsões de lucro com maker. Os diferentes estudos/timeframes também não são comparação causal controlada.

Na candidata de 90 dias, a identidade da decomposição é:

`+0,111141 movimento de referência − 0,205489 atrito entrada/saída − 0,467728 efeito econômico das taxas = −0,562076 USDT`.

Há um pequeno movimento bruto favorável nesse percurso, mas ele não sustenta os custos usados. Mesmo zerando somente taxas nos fills registrados, o resultado permanece negativo. Na referência de 72 trades, até o percurso sem atrito é negativo: custo não explica tudo. O positivo do squeeze continua com dois trades, concentração e estresse negativo; nenhum caso foi aprovado.

**Taxa em moeda base:** somar as taxas registradas ao P&L não equivale exatamente a restaurar a quantidade anterior à taxa de compra. Essa moeda valorizou/desvalorizou até a venda. Atribuição nova mostra ambos os números e o residual de reavaliação, sem corrigir retroativamente os estudos antigos. Para a candidata, o antigo add-back de taxas dá -0,093970 USDT; restaurar a quantidade no mesmo fill dá -0,094348 USDT. Ambos permanecem negativos.

### Movimento após entrada e payoff

- Candidata 90d: win rate 31,43%; acerto de equilíbrio observado pelo tamanho médio de ganhos/perdas de aproximadamente 43,09%. Esse cálculo é descritivo, não uma taxa futura garantida.
- MFE anterior à vela de saída disponível em 34/35 trades: mediana 3,1023%; MAE mediana 2,0499%; em 26 trades houve máxima acima do equilíbrio estimado antes da vela de saída. Isso não prova que uma saída lucrativa era executável, nem autoriza otimizar stop/breakeven retrospectivamente.
- Duração por velas: mediana 840 minutos (14h), média 1047 minutos (~17h27). Inclui a vela inteira de saída como limite superior; não é tempo de fill exato. Há custo de oportunidade para a única posição, mas girar antes não foi demonstrado como melhoria.
- Janelas de 1h/4h/8h após entrada têm médias de fechamento de -0,1564%/-0,0935%/+0,0172%, ainda sem desconto adicional de saída. Podem incluir preços posteriores à saída e sobrepor outros trades; não são operações independentes ou retornos realizáveis.
- 48h: A teve zero sinais (macro de alta não passou); B teve dois, APT aceito e ARB rejeitado pelo alvo/custo. A operação APT perdeu até no percurso sem atrito. Seu MFE antes da vela de saída foi apenas 0,006355% sobre o fill. Não há fundamento para esperar que saída parcial ou maker salvassem esse movimento específico.

Os grupos por par e blocos fixos de seis horas UTC permitem diagnóstico, mas não foram usados para excluir pares/horários perdedores ou afirmar que um horário tem menor liquidez. Não há livro histórico/fila de execução para validar essas inferências.

## Capacidade: passa no tamanho não significa liberado para operar

Regras da leitura REAL de 23/11/2026 às 13:39:39 Belém, preços dos últimos candles fornecidos da sessão até 25/11 às 13:45 Belém, saldo planejado 17, sem posição/exposição anterior. São referências DATADAS, não cotação atual. Preservados risco 1%, exposição total 25%, por símbolo 15%, altcoins 10% e uma posição; teto de lote 10 continua sendo teto.

| Resultado condicional de quantidade | Pares / limite |
|---|---|
| Passa na compra e quantidade vendável após taxa | BTC, ETH, SOL, XRP, DOGE, SUI, AVAX, LINK, DOT, AAVE, LTC, UNI, ATOM, APT, ARB, OP, FIL, INJ — 18 pares |
| Não passa no teto de exposição | NEAR: mínimo de uma unidade custava 2,717 USDT naquela referência, acima de 1,70 USDT |
| Sem confirmação suficiente | TON: ausente da cobertura pública e sem regras/taxa confirmadas |
| Tetos estáticos | BTC 2,55 USDT; demais 1,70 USDT, antes de eventuais restrições adicionais de stop/caixa/liquidez |
| Elegíveis para operação real por este diagnóstico | **Zero** |

Taxa taker cotada de 0,40% por perna em 19 pares na leitura antiga. Maker não foi exportado naquela versão. Saldo utilizável/passivos/modo e mínimo de valor não estão confirmados. Não presumimos taxa maker menor, saldo de 17 depositado ou mínimo notional igual a zero. Os preços/regras atuais, tick, livro, risco do stop e as restrições da conta ainda precisam ser verificados antes de uma ordem; não aumentar risco para acomodar NEAR.

## Leitura atual da conta: impedimento e passo mínimo

Consulta ao conector Railway confirmou que as quatro `OKX_READ_*` existem no serviço Crypto-bot, mas a conexão OAuth retorna `valuesRedacted=true`, somente nomes. Não há execução de comandos no serviço de produção por esse conector e o CLI Railway não está autenticado/disponível neste ambiente. Não lemos/recriamos chaves nem usamos as chaves operacionais. Tentativa pública ao endpoint de tickers OKX retornou HTTP 403; nenhuma cotação substituta foi inventada.

O leitor dedicado existente no código atual já exporta maker/taker por par, regras e campos de saldo. Ele precisa ser executado no ambiente com a chave Read existente, sem trocar de conta nem usar Trade. **Não se recomenda implantar o PR inteiro apenas para refazer essa leitura.** A alternativa imediata é consultar, na interface autenticada da OKX, maker/taker dos pares candidatos, USDT disponível na conta de negociação e regras/mínimo aplicáveis. Compartilhar somente o relatório sanitizado ou prints desses campos, nunca chave, segredo ou passphrase.

Se o binário atual estiver disponível no ambiente com a chave Read, o comando existente é:

```sh
npm run account:inspect-readonly -- real /tmp/crypto-account-terms-new.json BTC/USDT ETH/USDT SOL/USDT
```

Usar caminho novo; não sobrescrever a evidência anterior. Esses três pares são exemplo para limitar consultas, não uma seleção de estratégia/liquidez. No painel, uma versão antiga pode continuar exportando somente taker: não interpretar ausência de maker como taxa zero. Variáveis configuradas não comprovam sucesso da consulta nem saldo utilizável.

## Reprodução e testes

```sh
npm run build
npm run strategy:opportunities -- /CAMINHO/15m-normalized-data.json /CAMINHO/1h-normalized-data.json /CAMINHO/checkpoint.json /CAMINHO/public-coverage.json /CAMINHO/account-terms.json /NOVO_DIRETORIO
node scripts/opportunity-reproduce.mjs /CAMINHO/15m-normalized-data.json /CAMINHO/1h-normalized-data.json
```

O CLI é offline, não importa o executor nem cliente de conta; rejeita fonte divergente e saída existente, verifica ledger/fees/quantidades/crono e reproduz o checkpoint antes de diagnosticar. Validação da conta é projeção com esquema; dados privados desconhecidos permanecem desconhecidos. Arquivos de origem ficam intactos. O CI reproduz exatamente os 42 diagnósticos históricos com as fontes congeladas; não afirma reproduzir o checkpoint pessoal ausente do repositório.

Dez testes novos cobrem decomposição base/quote, integridade de custos, exclusão da vela de saída, janelas incompletas/same-bar, cronologia e carteira compartilhada, relógios 15m/1h, dados inválidos, caixa/taxas desconhecidos, mínimos após taxa e snapshot duplicado/futuro. Tipagem/build passaram; suíte local 674 aprovados e 32 dependentes de CI (706 totais). Após ajuste apenas do resumo agrupado, 20 testes específicos passaram novamente e os 42 casos foram reproduzidos exatamente. Resultado do CI final registrado no PR.

## Decisão para a execução 2

O estudo atual justifica investigar uma hipótese com movimento líquido maior e custo executável comprovado. Não justifica promover o pullback/squeeze reprovados, baixar uma taxa por conveniência, selecionar os pares vencedores ou ajustar saídas usando o MFE já visto. Primeiro completar a evidência econômica da conta; depois congelar uma hipótese distinta e um orçamento limitado de testes. Se o movimento bruto da nova hipótese também não cobrir custos realistas, encerrá-la. Sem holdout, Demo nova ou dinheiro real nesta execução.
