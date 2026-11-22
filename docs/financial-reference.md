# Referência financeira antes de novos experimentos

Execução 1, 22/11/2026. Estado: **referência de desenvolvimento, sem vantagem
validada e sem autorização de dinheiro real**. Nenhuma configuração ativa,
variável Railway ou estratégia de produção foi alterada.

## Evidência e hipóteses

Os dois diagnósticos exportados de 22/11 identificam taxa taker de 0,40% por
perna para BTC (cotação da conta), ADA, DOGE, ETH, NEAR e UNI (taxa e moeda do
fill confirmado, além de cotação registrada). O preenchimento de compra desses
cinco últimos pares desconta taxa na moeda base. Há 120 pares no conjunto
histórico: **6 com evidência de taxa, 114 com fallback declarado de 0,40%**.
Isso não confirma as taxas históricas de agosto nem as taxas futuras/da conta
real. A coleta futura de taxas é por par, limitada e somente sob demanda.

Não há amostras antigas de bid/ask pré-compra identificadas: spread cheio de
0,15% e slippage adicional de 0,10% por perna são hipóteses, não medições. A nova
instrumentação preserva bid/ask e horário do mesmo livro já consultado para a
compra Demo, sem requisição extra. Mudança entre ask e fill inclui latência e
movimento de mercado; não é interpretada como impacto puro.

A referência offline cobra a entrada em moeda base (hipótese nos pares sem
fill), vende a quantidade líquida e cobra a saída em USDT, sem cobrar a entrada
duas vezes. Verifica mínimos após taxa. Os defaults Paper atuais e as posições
legadas continuam com seu comportamento anterior. O relatório Paper ativo
continua distinto do Demo; não foi silenciosamente convertido em equivalência.

Saídas da referência: ATR 14, multiplicadores 1,5/3, piso 0,5%, teto 3%, sem
trailing legado e sem saída por sinal contrário. ATR usa a janela anterior de
100 candles; entrada posterior, stops/alvos ancorados no proxy do ask. Quando
ambos são tocados no mesmo candle, prevalece a execução conservadora já definida
no simulador. A política fixa explícita capturada é preservada quando disponível.
Políticas gerenciadas com trailing/breakeven e dimensionamento por risco não
suportados são rejeitados, em vez de aproximados silenciosamente.

Reconstrução dos ajustes capturados: orçamento Demo 5.000 USDT, lote teto
10 USDT, até 30 posições, exposição total 10%, score mínimo 4, teto RSI 70,
filtro BTC desativado e cooldown por par de 6h. **Não é uma simulação da banca
pretendida de R$ 100.** Não há EMA 200 de 1h nem teto RSI 63 no código atual.
A identidade do snapshot usado é `3764953`; o hash e os datasets estão no JSON.
O patch contábil posterior não é retroativamente atribuído aos fills anteriores.

## Replay executado e resultado

Mesmos dados congelados do estudo anterior: 30 dias até 31/08/2026 exclusivo,
15 minutos, 672 candles adicionais de aquecimento por ativo. Fonte: artifact
`14557315647`, workflow `44574679437`, ZIP SHA-256
`ecacf7320da8a0d7fe0e09842028869479f306a6f42539270dc0c986836ed75d`.
Os hashes dos 120 datasets e do estudo estão no
[resumo reproduzível](financial-reference-current.json). O comparador mantém as
duas janelas de avaliação do estudo, sem renomeá-las como novos testes cegos.

| Universo dinâmico solicitado | Cenário | P&L marcado líquido USDT | PF dos fechamentos | Fechamentos |
|---|---|---:|---:|---:|
| 10 + pares fixos | Conta/hipóteses | -38,18 | 0,398 | 447 |
| 10 + pares fixos | Custos adversos | -82,71 | 0,131 | 405 |
| 30 + pares fixos | Conta/hipóteses | -97,50 | 0,408 | 1.078 |
| 30 + pares fixos | Custos adversos | -195,23 | 0,153 | 947 |

P&L marcado inclui posições restantes; PF considera apenas trades fechados.
Os dois blocos de avaliação são negativos em todos os cenários. O universo é
formado por ranking histórico com seeds fixos; o número configurado não significa
exatamente esse número de ativos nem de posições abertas. A liquidez pode reduzir
a lista; disponibilidade/região e composição histórica têm limitações.

O cenário adverso dobra taxa para 0,80% por perna, slippage para 0,20% e spread
para 0,30%, com liquidez menor. É sensibilidade de custos: spread acima da trava
atual causaria rejeição na execução, mas esse cenário não replica essa admissão.
**Não é previsão de perdas reais nem isolamento do efeito das taxas**: capital,
score, exposição, filtro BTC e seeds também diferem da referência antiga.

## Reproduzir sem operar

```sh
npm run build
npm run execution:calibrate -- examples/execution-costs.plan.json examples/universe-validation.study.json DIRETORIO_CONGELADO NOVO_DIRETORIO diagnostico1.json diagnostico2.json
```

Requer o manifesto `source.json` original e seus datasets. O comando confere
hashes, recusa inconsistências e gera `cost-profile.json`, `study.json`,
`report.json` e `summary.json`. Não baixa candles, envia ordens, modifica o banco
ou altera os arquivos históricos. Diagnósticos completos não são publicados no
repositório; saídas usam projeção permitida e hashes sem credenciais.

## Limitações e decisão

Reutilizamos dados de desenvolvimento já consultados; não é novo holdout. OHLC
não fornece sequência intrabar, livro histórico, preenchimento parcial nem todas
as regras de admissão, agendamento, risco global e troca de universo. Poeira,
arredondamento de saída e precisão dos triggers ainda são aproximações.
A evidência de taxas exportada não é autenticada independentemente.

A próxima execução deve testar poucas hipóteses previamente definidas, com os
mesmos custos e risco, e medir se a entrada oferece margem após custos. Somente
uma configuração justificável segue para dados novos; ajustar até obter lucro
nestes mesmos candles não valida a estratégia. A próxima janela Demo de 48h
pode ocorrer depois das três execuções e da implantação confirmada, com versão e
parâmetros congelados. Serve para execução e reconciliação; não aprova uso real.
