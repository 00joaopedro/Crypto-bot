# Entrega adicional — sessão Paper de 48h e lote compatível com risco

## Resultado e limite desta entrega

O PR passa a ter um executor **Paper**, alimentado por dados públicos, para uma sessão de 48h do híbrido. Ele não envia ordens à OKX, não consulta conta privada, não exige chave de IA e não altera o serviço ativo. O adaptador operacional do híbrido para ordens virtuais na OKX Demo **continua não implementado/validado**. Paper não é apresentado como substituto equivalente da Demo nem como aprovação econômica.

Os testes simulam passagem de 48h para conferir a implementação; não são uma janela operacional de 48h concluída. O CI faz somente aquecimento público e duas inicializações curtas para verificar retomada, sem manter um job por 48h. Nenhuma janela de 48h foi iniciada no serviço do usuário.

## Perfil concreto para revisão

`examples/hybrid-shadow.profile.json` fixa banca 17 USDT, estratégia híbrida, 48h e referência arquivada de custos de 0,40% por perna com spread/slippage e mapa por par. A evidência continua parcial, sem tratar esses custos como taxas confirmadas da conta real.

**10 USDT vira um teto no perfil Paper**, com tamanho calculado pelo menor limite de caixa, exposição total, exposição por ativo, risco estimado no stop e liquidez. O replay original de lote fixo permanece inalterado por padrão e continua reproduzível. Esta é uma proposta separada de alocação, não uma substituição silenciosa da regra histórica ou da configuração ativa.

| Regra | Perfil Paper |
|---|---:|
| Banca | 17 USDT |
| Posições compartilhadas | 1 |
| Teto nominal do lote | 10 USDT |
| Exposição total | 25% |
| Exposição por ativo | 15% |
| Exposição em altcoins | 10% |
| Risco estimado por operação | Até 1% antes de gaps/erro do modelo |
| Teto inicial efetivo BTC | Até 2,55 USDT, antes de arredondamentos e outros limites |
| Teto inicial efetivo altcoin | Até 1,70 USDT, antes de arredondamentos e outros limites |

Se a quantidade arredondada não atende mínimos, a entrada é recusada; o lote não aumenta para passar no mínimo. Mínimos de valor em USDT não observados continuam identificados como desconhecidos e são uma limitação do modelo Paper, não confirmação de mínimo zero.

Bloqueia novas entradas após cruzar perda diária marcada de 3% ou drawdown de 10%; três perdas seguidas impõem pausa global de 60min. Cooldown por par da referência continua independente. Esses bloqueios são verificados por candle e não garantem perda máxima em gaps. Posições existentes seguem a política de saída simulada.

Reduzir lote reduz exposição e escala de P&L; não demonstra melhora da expectativa percentual nem torna uma estratégia negativa rentável.

## Implementação e retomada

`demo:hybrid-shadow` coleta o aquecimento 15m/1h, congela os pares Spot disponíveis, faz a primeira gravação e passa a consultar somente intervalos fechados novos. Mantém o contexto 1h apenas quando a hora fechou. Não exige uma hora inteira de espera para começar. Não substitui pares ausentes durante uma sessão e não infere disponibilidade por conta Demo a partir de lista pública.

O checkpoint contém os candles efetivamente consultados, hashes de dados/configuração/código, registro de entradas/fechamentos e posição Paper. Na retomada, a aplicação valida o checkpoint e reconstrói o resultado pelo mesmo replay causal antes de aceitar novos candles. Assim, SMA congelada, modo, trailing, contador do sexto candle, carteira e risco não dependem de memória perdida. Dados passados, universo e restrições não podem ser reescritos. Versão Node, lockfile e bundle compilado fazem parte da identificação do código.

A gravação é atômica, com sincronização em disco e arquivo 0600. Um lock exclusivo cerca processos concorrentes. Encerramento normal libera o lock. Um crash mantém o lock: só remover `session.lock` após confirmar que o processo anterior terminou, usando o mesmo host/volume e a mesma configuração. Não existe descarte automático de lock ou reset de carteira para continuar operando em estado incerto.

O processo aguarda 48h de relógio e 192 candles de avaliação, além do aquecimento, para marcar conclusão. Se houver interrupção, o trecho faltante é reconstrução de candles consultados depois; não prova observação contínua nem fills executáveis em tempo real. Uma posição ainda aberta fica marcada e explicitamente registrada no fim, sem fechamento lucrativo inventado. Poucos trades deixam o resultado inconclusivo.

## Comandos disponíveis — não executados por 48h nesta entrega

Em um host com processo contínuo e **diretório persistente**, após build:

```sh
npm run demo:hybrid-shadow -- /CAMINHO_PERSISTENTE/hybrid-shadow-session
```

Inicialização/retomada de um único ciclo, usada no CI:

```sh
npm run demo:hybrid-shadow -- .hybrid-shadow --once
```

O comando não aceita `--demo`, `--live`, chaves ou parâmetro para enviar ordens. O nome `demo:` identifica a preparação do projeto; os registros declaram `environment=paper_public_only` e `ordersSent=0`. Resultado e ledger completo ficam em `checkpoint.json`; o console mostra resumo por atualização. Este diretório precisa sobreviver a reinício/deploy; uma pasta efêmera de container não fornece essa garantia.

## O que ainda depende de decisão/evidência

1. **Dimensionamento adotado por delegação do usuário:** lote variável até 10 USDT, preservando os limites, para os próximos testes Paper. O perfil está concreto no PR, mas não foi aplicado ao serviço nem iniciou uma sessão de 48h. Manter lote fixo de 10 na banca de 17 continua incompatível com os limites atuais; eles não foram aumentados.
2. **Conta:** fornecer a configuração protegida de leitura ou um diagnóstico sanitizado da conta Demo/conta pretendida para verificar taxas, saldo e termos. Não existem credenciais dedicadas de leitura neste ambiente local; isso não é uma auditoria das variáveis da Railway. Nunca enviar chaves no chat. O coletor `account:inspect-readonly` já está disponível e não envia ordens.
3. **Demo com ordens virtuais:** exige adaptador por modo, precisão/proteção nativa, persistência de alterações/time-stop e reconciliação específicos do híbrido. As proteções legadas não certificam automaticamente esse comportamento novo. O relatório `hybrid-demo-readiness.json` continua bloqueado.
4. **Economia:** híbrido/B ainda negativos; A tem amostra insuficiente. Nenhuma aprovação de dinheiro real ou vantagem econômica foi produzida nesta entrega.
5. **Início efetivo:** depois da escolha, preparar implantação identificada no host persistente e confirmar a configuração antes de iniciar o relógio. Não houve merge, deploy ou alteração Railway.

## Verificação

Dez novos testes cobrem: aquecimento fresco e perfil Paper, indicadores reais e posição B com time-stop através de reinício, idempotência, corrupção/versão/dados retroativos, cobertura/horas fechadas, relógio completo de 48h, lock/gravação atômica e erro de argumento antes da rede; dimensionamento e mínimos sob risco; pausas por perdas e perda diária. O workflow compara os oito resultados históricos de lote fixo e executa o smoke público Paper. Nenhum resultado sintético é apresentado como performance de mercado.
