# Execução 2 — uma hipótese de continuação, congelada antes do replay

Hipótese única, offline. Nenhuma alteração de produção, Demo/Railway, banco ou dinheiro real. O protocolo, implementação e testes sintéticos são publicados antes de executar os novos sinais nos candles históricos. Depois da publicação, `examples/channel-continuation.freeze.json` vincula o commit real e SHA256 do protocolo. O CLI exige esse manifesto; não aceita parâmetros de otimização.

Protocolo `examples/channel-continuation.plan.json`, SHA256 dos bytes `a27d84b0518336e85e0f141bae019b066dbee0d25c0ca8cc250ccee0e13b44c6`.

## Pergunta econômica

Um rompimento de canal confirmado em 4h, com stop/alvo amplos e payoff líquido mínimo, consegue superar os custos de referência sem depender de maker presumido? É diferente da reversão curta, do toque na EMA/RSI de A e da compressão Bollinger/Keltner de C. Não é uma promessa de vantagem: stop/target maiores e menos pares podem diminuir a amostra e também perder.

Uma candidata, uma referência e dois cenários: quatro casos. Sem grade, nova variante, remoção de filtro ou redução de taxa depois do resultado. O universo fixo BTC/ETH/SOL não foi escolhido pelos trades vencedores. Ele restringe o escopo e passou na checagem datada de quantidade; não certifica ranking de liquidez/livro atual ou acesso nativo da conta.

## Regras congeladas

- Sinal somente no fechamento de cada vela UTC4h, agregada de quatro velas 1h contíguas; pelo menos 250 velas 4h concluídas.
- Fechamento acima da maior **máxima das 20 velas 4h anteriores**, vela verde, EMA50 > EMA200 e EMA50 maior que na vela 4h anterior.
- Exigir transição false→true na cadência 4h. Qualidade técnica existente >=3 nas últimas 100 velas 1h fechadas; não é prova de spread/livro.
- ATR14 simples calculado nas velas 4h fechadas do sinal; congelado para o trade. Não há RSI, toque em média, Bollinger, requisito de squeeze ou volume relativo novo.
- Compra no open da próxima vela 1h, com custos taker simulados. Stop = fill − 2 ATR; alvo = fill + 6 ATR. Sem saída parcial, trailing, breakeven ou time-stop.
- Saídas verificadas em 1h pelo kernel existente: stop primeiro se stop e alvo aparecem na mesma vela, gap do stop ao preço disponível modelado. Isso é aproximação OHLC, não fill garantido.
- Antes da entrada, tanto na cotação do fechamento conhecido quanto na abertura quantizada: ganho líquido/perda líquida no stop >=1,5 e ganho líquido >=2× custo total modelado. Payoff projetado não é expectativa estatística.
- Carteira 17 USDT, teto de lote 10, uma posição; risco 1%, exposição total 25%, por símbolo 15%, altcoins 10%; prioridade BTC→ETH→SOL, sem reutilizar recursos na mesma vela. Regras existentes de pausa diária/drawdown/cooldown preservadas, sem alegar que são kill switch nativo validado.

Referência: mesma formulação HORIZON_ATR anterior, reaplicada somente aos mesmos três pares, período, custos e carteira. Não comparar causalmente sua soma com a antiga carteira de 18 pares. A nova candidata muda entrada, timeframe do sinal e saídas; a diferença não é efeito isolado de um indicador.

## Dados, custos e critérios

Reutiliza a fonte congelada de 90 dias: avaliação de 24/08/2026 até 22/11/2026 exclusivo UTC, mais 1000h de warmup; 18 pares disponíveis na origem, três selecionados previamente. Dataset SHA256 `c86e45083ffbee12859819abe1e9584a5a72b397fe10863c5df458b755ec6dde`. São dados já consultados, portanto desenvolvimento. Nenhuma coleta ou gravação no banco.

Custos vêm dos bytes exatos de `examples/trend-horizon.plan.json`: taker 0,40%/perna, slippage 0,10%, spread 0,15%; estresse dobra os três. Preservada taxa de compra em base e venda em quote modeladas. São referências condicionadas à leitura antiga, não confirmação da taxa atual nem fills. Maker desconhecido não vira desconto. Mínimos históricos usam regras públicas datadas; mínimo de valor/livro/fila não certificados.

Para passar o desenvolvimento, a candidata precisa satisfazer **nos dois cenários**: >=30 fechamentos, PF >1,25, EV/retorno líquido positivos, três blocos sequenciais de 30 dias positivos, DD <10% e resultado realizado positivo excluindo os três melhores trades. Sem amostra não há aprovação. Cenários podem selecionar carteiras diferentes por causa do gate, duração e risco; positivo em estresse não significa que aumentar taxas melhora os mesmos trades.

Reserva independente definida antes do replay: 01/10/2025–30/12/2025 exclusivo UTC, com 1000h de warmup. **Não coletada nem certificada como cega**: ainda exige inventário completo de períodos já consultados, inclusive warmup, protocolo separado, candidata elegível e custos/condições atuais resolvidos. Não coletar/inspecionar a reserva se o desenvolvimento reprovar. Datas reservadas não são evidência de validação fora da amostra.

## Prints da conta sem enviar ordens

Sim, o titular pode completar a evidência atual pela interface autenticada da conta REAL, separada da Demo:

1. Trade → Spot → BTC/USDT → Mais/Regras de taxas. Mostrar maker/taker e o par; repetir para ETH/USDT e SOL/USDT, ou mostrar tabela autenticada que identifique os três.
2. Ativos → Negociação → USDT. Mostrar saldo disponível, eventual valor reservado/passivo e indicação da conta. Patrimônio total e saldo de financiamento não substituem caixa utilizável.
3. Nas informações/regras dos pares, se disponíveis, mostrar mínimo e incremento de quantidade, tick de preço e mínimo de valor aplicável. Não é preciso clicar em Comprar/Vender para testar um mínimo. Ausência de um campo permanece pendente; não presumir zero.

Não depositar apenas para isso, não criar chave nova, não enviar senha, API key, secret, passphrase ou códigos de autenticação. Se o USDT disponível for zero, esse é o dado correto; banca planejada de 17 não significa saldo já depositado. Pode ocultar nome, e-mail, UID e ativos não relacionados, preservando os campos necessários e contexto real/Spot.

Referências oficiais consultadas em 26/11/2026: [OKX Trading Fee Rules FAQ](https://www.okx.com/help/trading-fee-rules-faq), seções 3–5, e [saldo disponível Spot — OKX Brasil](https://www.okx.com/en-br/help/how-do-i-buy-and-sell-on-spot-and-why-does-my-available-balance-show-0). Menus/traduções podem variar. O teste offline pode usar os custos antigos conservadores enquanto a leitura atual está pendente; prints não aprovam a estratégia nem autorizam ordens.

## Reprodução

```sh
npm run build
npm run strategy:channel-continuation -- /CAMINHO/frozen1h-normalized-data.json /NOVO_DIRETORIO
```

O comando rejeita protocolo/custos/fonte divergentes, falta do manifesto de congelamento e diretório existente. Gera resumo, admissões e ledgers; não consulta APIs. O vínculo ao commit é evidência de publicação revisada no GitHub, não autenticação automática de histórico Git por esse comando offline.
