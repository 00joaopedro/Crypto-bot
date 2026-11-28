# Hipótese 1 v2 — protocolo da rodada final

Escopo autorizado: somente pesquisa offline do Swing Pullback Maker 4h/1h em BTC, ETH e SOL. A hipótese 2 v2 será outra execução. Nenhum merge, deploy, mudança de Railway, conta privada, ordem Demo/real ou IA paga.

## Congelamento e regras objetivas

O arquivo `examples/swing-v2.plan.json` tem SHA256 `7d40f912f921353fd779e98d107506a313fccaa19db48b1647190a746279ad54`. Código, protocolo e testes sintéticos serão publicados antes de coletar/consultar a nova fonte de 180 dias. O manifesto subsequente identifica esse commit; nenhum scan econômico foi executado antes dele.

Preserva-se a proposta Gemini com definições necessárias para reproduzi-la: EMA20/50 em 4h, ambas com três incrementos positivos, preço conhecido acima da EMA50 e ATR14 simples 4h/preço >=1,2%. Só candles fechados. Em 1h, a vela cruza a zona EMA20–50 e fecha acima do seu limite inferior; um dos três fechamentos anteriores esteve acima da zona então conhecida. Os três fundos do recuo não podem perder o menor fundo das doze velas anteriores a eles. Nenhum filtro extra de RSI, volume ou pavio. Exige transição false→true.

Limite no meio da zona, arredondado para baixo; stop na menor mínima das três velas do recuo menos 0,5ATR1h, arredondado para baixo. Stop <0,90% é rejeitado, sem alargamento artificial. Ordem maker válida por 60 minutos, sem perseguir preço. Alvo bruto projetado >=2%; é piso de amplitude, não previsão de que o preço o atingirá. Projetar alvo distante não demonstra vantagem.

A banca segue 17USDT, teto10, uma posição e limites existentes: risco1%, exposição25%, símbolo15%, altcoins10%; prioridade BTC/ETH/SOL. Os 10USDT são teto, não lote garantido. Mantêm-se bloqueios de novas entradas em perda diária3%, drawdown10% e cooldown após três perdas.

## R líquido, taxas e preenchimento

Taxas transcritas pelo titular: maker0,10%, taker0,40%. Não são preenchimentos autenticados ou taxas históricas verificadas. Compra desconta fee em base, arredonda quantidade vendável e preserva poeira. R inicial é a perda líquida projetada no stop taker após atrito. Alvo maker arredondado para cima entrega >=1,60R líquido sobre o custo efetivo, incluindo fee e reserva modelada.

Uma venda limite maker preposicionada preenche no próprio limite, nunca em preço inferior fictício. A reserva conservadora de incerteza é debitada separadamente (notional de compra × atrito efetivo, proporcional à fração vendida); não é apresentada como taxa OKX. No stop, atrito piora o preço taker e não se debita novamente essa reserva maker. Cenário padrão: slippage0,10%, spread0,15%, participação0,10% do volume minuto e penetração além de um tick; adverso dobra custos/atrito, exige dois ticks e metade da participação. O catálogo público é conferido, sem reescrever regras congeladas; mínimo de valor e acesso privado seguem desconhecidos.

Após o fechamento do minuto do preenchimento, o TP é colocado apenas se não for negociável contra a proxy do bid; se cruzar, não se inventa venda maker e a mesma cotação pode ser reapresentada depois. O TP vale a partir do minuto seguinte. Toque não é fill; exige penetração e capacidade de volume. O minuto de nova compra não recebe lucro simultâneo no alvo. Stop tem prioridade se stop/alvo coexistirem na mesma vela. Gaps usam o pior preço entre abertura e stop, mais atrito.

Em fechamento de minuto com resultado líquido projetado de liquidação taker >=1R inicial, cancela-se o restante da compra e o stop sobe para projetar +0,15R líquido; o novo nível vale só no minuto seguinte. Nunca é retroativo. Gaps podem produzir perda apesar da proteção. Alvo1,60R líquido e ativação1R líquido são coerentes. Preenchimentos e débitos são idempotentes; parcial não protegível pelo mínimo bloqueia o replay, em vez de fabricar liquidação. Não se reutiliza a carteira na mesma hora da saída.

## Dados, independência e decisão

Desenvolvimento: 26mai2026–22nov2026 exclusivo, 180dias, três blocos de60dias, 1000horas anteriores para aquecimento. São 5320candles1h por par; agregação4h por intervalos UTC completos. Parte dos últimos90dias já foi consultada e esta janela NÃO é independente. Minutos confirmados para todas as horas de entrada e qualquer hora posterior que possa tocar stop/alvo/ativação; lacunas/duplicatas/divergência OHLCV bloqueiam. A coleta adaptativa escolhe apenas resolução de eventos, sem alterar parâmetros. Até1200janelas de minutos por fase.

Reserva independente declarada ANTES do replay: 01out2025–30dez2025 exclusivo,90dias e1000h de aquecimento. Só será coletada/aberta se OS DOIS cenários de desenvolvimento passarem. É holdout histórico anterior segundo o registro de consulta do repositório, não validação cronologicamente futura nem certificação de que nenhuma pessoa externa o consultou. Mesmas regras e critérios, sem nova seleção de parâmetros. Se desenvolvimento reprovar, reserva permanece intacta.

Cada cenário precisa de >=30fechamentos, três blocos completos e >=2blocos positivos tanto em resultado marcado como realizado. Padrão: PF>1,25, expectativa e PnL líquido/realizado positivos. Adverso: PF>=1 e expectativa/PnL não negativos, sem usar zero operações como sobrevivência. Ambos: DD<10% e realizado positivo retirando os três melhores trades (trava de concentração já existente). PF sem perdas e com ganhos é ilimitado; ausência de atividade é indefinida. Carteira única por cenário, não somatório de três bancas por par. Critério 2/3 substitui explicitamente a exigência anterior de3/3, conforme a nova rodada autorizada; não será alterado após resultados.

GO econômico exige desenvolvimento E reserva aprovados. Ainda não aprova execução nativa: fila maker, taxas efetivas, proteção/reconciliação e saldo precisam de validação própria. Esta é a hipótese1 de duas v2; reprovação isolada não arquiva o projeto. Se AMBAS reprovarem, não abrir v3 e registrar encerramento seguro, sem exclusão de código nem desligamento não autorizado da Railway.
