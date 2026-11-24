# Nova estrutura — execução1: dados e viabilidade Spot

## Escopo entregue

Complemento WebSocket público de candles15m/1h, recuperação REST, classificação segura de erros, cache de regras atuais dos instrumentos, maker/taker separados na leitura protegida e pré-validação offline de proposta de entrada. Reutiliza o funil, checkpoints, carteira compartilhada, sizing e política de retentativas existentes. Não altera indicadores, ROI, regimes ou estratégia ativa; não implementa post-only/OCO operacional ou autoriza ordens reais. Nenhum SDK de IA/dependência foi adicionado.

O worker48h deve continuar no6faa6bf. Esta compilação altera fingerprint e não pode ser implantada no meio da sessão antiga. Não houve merge, parada/reinício ou configuração de Railway nesta entrega.

## Dados fechados, uma carteira e recuperação

Endpoint de mercado público atual documentado: wss://ws.okx.com/ws/v5/business, com TLS na porta padrão443. Canais candle15m/candle1H dos pares disponíveis da watchlist; nenhuma autenticação, ordem ou canal privado. Não acrescenta5m.

Ativação opt-in em NOVA sessão, após build:

```sh
npm run demo:hybrid-shadow -- /NOVO_DIRETORIO_PERSISTENTE --websocket
```

O comando sem a flag preserva o transporte REST. transport-profile.json0600 congela o modo; trocar flags no mesmo diretório é recusado. O fingerprint antigo também impede migração de checkpoint de outra compilação. Só o operador pode escolher uma nova sessão; nada a inicia automaticamente.

Heartbeat textual ping após20s sem mensagem; esperar pong por até20s. Timeout de conexão20s, reconexão com backoff1–30s e renovação das assinaturas. O backoff só é zerado após estabilidade, não imediatamente após ACK, evitando tempestade de reconexões. Encerramento cancela timer/socket; mensagens de sockets aposentados são ignoradas.

Aceita somente mercados solicitados e canais previstos, depois do ACK. Somente confirm=1 e candle já fechado pelo relógio local entram no cache. Valida alinhamento, OHLC, volumes e timestamps; ignora abertos/futuros. Deduplica dados confirmados iguais, ordena por horário e mantém até400barras por par/período. Confirmações conflitantes ou inválidas criam bloqueio de integridade, nunca sobrescrita silenciosa. Não promete ausência universal de queda: corrupção/permanência de falha ainda pode exigir intervenção.

REST continua no aquecimento250h e nas lacunas. Se o cache tem um prefixo contíguo, fornece esse prefixo ao coletor paginado; onde falta dado, consulta REST. REST e WS são comparados em sobreposição confirmada. Cache contém dados das duas origens, portanto cachePages não equivale a páginas originadas exclusivamente no WS. O schema do checkpoint e seus hashes validam as séries finais; nenhuma nova ordem é produzida por mensagem duplicada. A carteira só avança no horário completo de TODOS os pares congelados, como na execução anterior. Não remove um par para produzir decisões retrospectivas. Se aquecimento cruzar a janela de frescor, tenta novamente com horário atual, no máximo duas repetições, em vez de iniciar sessão com hora fictícia.

market_stream_status informa conexão, ACKs, último candle confirmado recebido via WS, duplicatas, abertos/futuros ignorados, cache e fallback. Conexão/ACK não provam recebimento de candles fechados nem48h contínuas. Dados que chegam depois e são reconstruídos continuam identificados como reconstrução, não fills reais.

## Erros e regras dos instrumentos

OkxReadError preserva somente code/sCode numéricos, categoria, presença de mensagem e mensagem fixa sanitizada. Nunca exporta msg/sMsg brutos, headers, assinaturas ou URLs de conta. Conhece rate-limit, temporário, quantidade mínima, precisão, saldo, autenticação e parâmetros. Analisa também erros de sub-resposta, HTTP sem JSON e códigos encapsulados em erros de leitura CCXT. Só falhas transitórias de LEITURA entram em retry; isso não autoriza reenviar ordens após timeout.

A descoberta pública gera um cache de regras atuais minSz/lotSz/tickSz, somente pares SpotUSDT live da watchlist, rejeitando duplicatas/ambiguidade. TTL1h; atualiza em retomada e periodicamente, com falhas explícitas e estado expirado não tratado como regra confirmada. current-instruments.json é fotografia pública, não comprovação de permissão da conta. O cache atual NÃO reescreve constraints históricos congelados do replay. Falha de refresh não fabrica regras nem muda o universo.

## Maker e taker observados separadamente

A mesma consulta Read-only por par agora extrai maker e taker do grupo correto do instrumento, sem aumentar chamadas. Ausência/ambiguidade/rebate continuam desconhecidos, não taxa zero. O painel e download mostram cada taxa separadamente; erros globais seguros distinguem limite de API e indisponibilidade temporária. As chaves dedicadas e seus quatro nomes permanecem, sem fallback para credenciais operacionais.

NÃO foi feita nova consulta privada à conta do usuário nesta implementação. A alíquota maker só será conhecida após implantação controlada do leitor e nova consulta manual. Nenhum custo maker menor foi usado no histórico para sugerir lucro. A antiga leitura fornecida prova cotação taker, não cobrança de fills ou taxa maker.

## Pré-validação econômica — preview, sem envio de ordem

```sh
npm run account:preflight-readonly -- /LEITURA_FRESCA.json /PROPOSTA.json /NOVO_DIRETORIO
```

Código novo exige campos explícitos; formato em spotEntryProposalSchema. A leitura deve ter no máximo60s, livro5s e ambiente coincidente. Confere caixa Spot/ausência de dívida; exige declaração de reconciliação e nenhuma posição/ordem pendente. Esses valores são observações fornecidas pelo chamador, não autenticados por arquivo: a integração operacional futura deverá obtê-los da fonte reconciliada.

Proposta contém bid/ask, instante do livro, stop/alvo, estilo taker/post_only, profundidade disponível, exposições, teto<=10, limites de risco, slippage, spread máximo, R:R líquido mínimo e margem de ganho/custo. Esses dois últimos limiares não recebem valores universais presumidamente rentáveis; devem ser congelados no experimento econômico seguinte. Não reaplica cegamente R:R1,5 à saída B incompatível.

Reutiliza positionSize com caixa limitado ao menor de17USDT e disponibilidades observadas, risco<=1% e caps de exposição informados. Quantiza quantidade para baixo com aritmética decimal; preços de stop/alvo para baixo pelo tick, recalculando perda. Considera entrada em base ou quote, taxa selecionada maker/taker e saída taker, spread observado e slippage modelado. Quantidade vendável é arredondada após taxa de entrada; resíduo não é declarado vendável. Confere mínimos de compra e venda, inclusive venda no stop. Não eleva lote para vencer mínimo.

O ganho líquido é receita líquida estimada na saída menos desembolso de entrada; a perda no stop usa o mesmo caixa/quantidade líquida. Spread/slippage já entram nos preços; não são debitados novamente no P&L. Estimativa de custo adicional aparece somente como comparação de margem, não segundo débito. Stop/gaps podem perder mais que o modelo.

verifiedMinimumNotionalUsdt=null fica limits_pending, nunca mínimo fixo zero. Um valor informado é apenas declaração do chamador, ainda sujeito a validação operacional. derivedQuantityMinimumNotionalUsdt é minSz×preço de entrada, não um mínimo fixo de valor inventado da corretora. Campos presentes e satisfeitos geram structural_preview_passed, NÃO autorização: ordersSent=0, orderSubmissionApproved=false e realMoneyApproved=false em qualquer caminho. Mercado/conta, liquidez/depth e risco precisam de verificação efetiva na integração futura. Post-only é cotação hipotética, não execução garantida; maker desconhecido bloqueia esse preview.

## Validação

Testes de confirmações, ordem/duplicatas/conflitos, fallback/overlapREST, ping/pong, backoff e sockets antigos, timeout/envio falho, retenção, dados malformados, códigos HTTP/API sanitizados, maker/rebate/grupo, expiração do cache, taxa em base/quantidade vendável, preços por tick, mínimos desconhecidos, saldo/reconciliação, risco, profundidade, margem e CLI sem sobrescrita.

O workflow reproduz os8resultados antigos, os12experimentos/ledgers e a decisão de prontidão, faz warmup/retomada com --websocket, recusa troca de transporte no mesmo diretório e testa ACK público BTC15m/1h com prazo12s. Este smoke não espera uma vela de15m fechar nem equivale às48h do usuário. As mensagens fechadas e falhas são exercitadas deterministicamente nos testes; só declarar a conectividade pública após ver o resultado real do CI.

Fontes consultadas em24/11/2026: https://www.okx.com/docs-v5/en/ (Business WebSocket, candles, heartbeat textual, instrumentos e códigos de erro). Não foi alterada a política econômica ou promovida candidata por esta entrega.
