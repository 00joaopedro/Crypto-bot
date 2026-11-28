# Pullback maker — execução 1, protocolo antes do replay

Hipótese única, exclusivamente pesquisa/Paper, no PR61. Sem merge, ordens, implantação ou alteração da estratégia ativa. A hipótese de compressão/rompimento será outra execução e não está implementada aqui.

Regras em `examples/maker-pullback.plan.json`, SHA256 `3ae37a9f920c1c42b1a1e30ab5aa39d8c2e29c3c20d00a57ae6d74aeb2839f62`. Implementação/protocolo/testes sintéticos publicados antes de escanear os novos sinais no histórico. O manifesto posterior vincula o commit real; CLI verifica hash fixo antes de ler dados. Não haverá grade, desconto de taxa ou alteração de regras após resultados.

## Entrada e saídas

- BTC/ETH/SOL predefinidos, mesma fonte90d conhecida do estudo1h: avaliação24/08–22/11/2026UTC exclusivo e1000h de warmup. Dataset `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`.
- Contexto: somente4h completas, EMA50>EMA200 e três incrementos sucessivos positivos daEMA50. Pelo menos250velas4h completas.
- Sinal1h fechado: fechamento anterior acima daEMA21anterior; mínima atual toca/furaEMA21atual; fechamento atual acima daEMA21, vela verde e pavio inferior>=corpo. Transição false→true para não repetir a mesma rejeição contínua. SemRSI/filtro de volume adicional.
- Ordem após a confirmação, na abertura da hora seguinte, limite=floorEMA21no tick. Stop=floor(menor mínima das3velas−0,25ATR14simples,tick). Alvo=floor(limite+2×distância atéstop,tick). Semparcial/trailing/breakeven/time-stop.
- Ordem válida cinco minutos, intervalo fechado na colocação/aberto na expiração; sem reprecificar ou converter emtaker. Ordem que cruzaria o preço de abertura acrescido de meio spread modelado é rejeitada pelo proxy post-only. Esse proxy não é um livro histórico.
- Gate no limite/quantidade quantizada: retorno/risco líquido>=1,5 e ganho líquido>=2×custo de ida/volta modelado, incluindo taxa em base, quantidade vendável, arredondamento e atrito de saída. Perda estimada no stop<=1%equity. O limite/stop/alvo não mudam no primeiro fill.
- Carteira17USDT, teto10, uma posição compartilhada; risco1%, exposição25%, porpar15%, altcoins10%. PrioridadeBTC→ETH→SOL. Caixa não é reutilizado na mesma hora de saída. Pausas anteriores de3%diário/10%drawdown e1h após3perdas preservadas como modelo, sem equivalência a kill switch nativo.

## Dados de minutos e preenchimento

O coletor busca somente60velas1m fechadas da hora de execução de cada sinal, dentro da janela de desenvolvimento já conhecida. Não coleta continuamente90dias de1m nem usa uma nova reserva independente. Confirmação1, relógio contíguo, deduplicação/conflito e agregação coerente com1h são obrigatórios. Fonte1h continua inalterada e não é gravada no banco.

Mesmo1m não mostra fila, agressor, spread exato, latência ou fills da nossa ordem. O modelo declara explicitamente:

1. Toque simples no limite não preenche. Mínima precisa ficar estritamente abaixo de limite−1tick no padrão e limite−2ticks no adverso.
2. Quantidade por minuto limitada ao menor entre restante e0,1%do volume base daquele minuto; no adverso0,05%. Arredondar para baixo no passo, sem promover quantidade por epsilon.
3. Reserva inicial inclui todo o pedido. Fill parcial debita só a quantidade efetivamente modelada; mantém reserva do restante. Expiração cancela somente restante, preservando inventário preenchido.
4. Taxa maker em base na compra; saída taker emquote. Quantidade líquida vendável é arredondada para baixo, com poeira informada e perda conservadora de seu valor no fechamento.
5. A quantidade preenchida recebe proteção simulada imediatamente. Parcial líquido abaixo do mínimo vendável cancela restante e BLOQUEIA o replay com inventário não resolvido; não inventa venda abaixo do mínimo.
6. Stop primeiro/gap ao preço disponível. Não creditar take-profit em um minuto em que houve novo fill, pela ordem intrabar desconhecida. Os demais minutos da hora de entrada e as horas posteriores usam os níveis fixos; horas posteriores mantêm o modelo1hstop-first. Não é limite inferior matemático do lucro da carteira.

Ausência de minutos completos bloqueia todo o resultado da carteira: a ordem/fill desconhecido mudaria caixa e admissões seguintes. Não se transforma ausência de dado em zero trades ou se exclui o par após resultados. O coletor registra indisponibilidades; não preenche lacunas com candles1h.

## Custos, mínimos e evidência

Padrão: maker0,10%compra/taker0,40%venda, slippage0,10% e spread0,15% modelados na saída. Adverso dobra taxas/slippage/spread e reduz a participação. As taxas vêm da transcrição de prints reais fornecida pelo usuário em28/11, não de fills históricos autenticados. A entrada maker não recebe slippage taker artificial, mas sua chance de execução e seleção adversa permanecem modeladas.

MinSz/lotSz/tick são as regras datadas já fornecidas; coletor público compara o catálogo atual com os valores congelados, sem reescrever protocolo. Correspondência pública não comprova mínimo notional, acesso da conta ou regras históricas. Mínimo de valor continua desconhecido. Conta real sem saldo;17é banca planejada da simulação, não depósito confirmado. Não se consulta conta privada nem pede aporte.

Critérios congelados em ambos os custos: >=30fechamentos, PF>1,25, EV/líquido positivos, três blocos de30dias positivos, DD<10%, realizado semtop3 positivo, cobertura completa e nenhuma parcial desprotegível. Qualquer positivo é apenas triagem condicional sob hipóteses de execução, nunca certificação maker, aprovação Demo/real ou teste independente.

## Execução/reprodução

```sh
npm run build
npm run strategy:maker-pullback -- --collect /CAMINHO/frozen1h.json /CAMINHO/minute-source.json /NOVO_DIRETORIO
npm run strategy:maker-pullback -- --replay /CAMINHO/frozen1h.json /CAMINHO/minute-source.json /OUTRO_DIRETORIO
```

Somente dois GETs públicos permitidos no coletor: instrumentosSpot e histórico1m. Sem chave/assinatura, redirecionamento, escrita de conta ou ordem. Há timeout, pausa e retentativa limitada para leitura transitória. Exportação/erros não contêm credenciais.

O ambiente local retornouHTTP403 na tentativa pública. O CI tentará coletar sem credenciais. Não afirmar disponibilidade ou resultados numéricos antes dessa coleta. Artefatos congelam minutos e hashes; se não houver acesso/cobertura, entregar bloqueio explícito, testes e relatório de sinais, sem fabricar90dias de negociação.

Referência oficial: [OKX APIv5](https://www.okx.com/docs-v5/en/), histórico1m/confirmação, volumesSpot embase, post_only e estados parciais/cancelados. A API documenta mecanismos, não autentica os fills dessa simulação.
