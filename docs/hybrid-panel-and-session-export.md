# Painel híbrido e cópia da sessão48h

## Painel reaproveitado

O mesmo painel autenticado agora abre com a auditoria híbrida. O histórico e os controles anteriores ficam recolhidos e identificados como legados. O estado no cabeçalho também é rotulado Legado; importar checkpoint não retoma esse motor.

Selecione checkpoint.json e clique Importar e auditar. O servidor reproduz o checkpoint fora da thread HTTP, com limite16MiB/20pares/1192candles15m e298horas por par, prazo60s e um trabalho por vez. Exige sessão e mesma origem. Rejeita corrupção/arquivo incompleto; falha preserva relatório anterior. Não envia ordens, chama conta ou grava no volume/DB. Relatório fica em memória do serviço até reinício; download JSON permite guardá-lo.

Mostra período, estado, patrimônio17, P&L simulado, taxas, PF/EV, operações por par/modo, funil e rejeições. É importação manual reproduzida, não monitoramento ao vivo nem prova de continuidade ou fills. Código/fingerprint antigo é verificado como identidade declarada, não autenticado como binário. Logs resumidos ou JSON de P&L editável não substituem checkpoint selado.

O importador é exclusivo da sessão15m A/B já existente. A nova proposta1h/4h continua offline. Nenhum seletor/botão a ativa. Aplicar o novo painel exige deploy controlado somente do serviço do painel; o worker encerrado e seu volume permanecem preservados. Nenhum deploy é realizado por esta implementação.

## Como obter os dados completos sem reiniciar o bot

A Railway documenta download de arquivos/diretórios de volumes no CLI: https://docs.railway.com/cli/volume e https://docs.railway.com/volumes . Não há download de volume entre as ferramentas conectadas desta sessão; não foi solicitado novo token nem lido valor secreto.

No Termux Ubuntu ou computador com Node/npm:

```sh
npm install -g @railway/cli
railway login --browserless
railway link --project 5bd3c996-fba6-4192-b201-9b55b9ccad60 --environment 345c2328-6286-44af-aac0-ff8728bee508 --service 77a8de27-5479-4e5b-ae6d-fce18f7c31cd
railway volume files --volume paper-48h-checkpoints list /
railway volume files --volume paper-48h-checkpoints download /hybrid-shadow-48h ./crypto-bot-48h
```

Conclua o login no link que o CLI mostrar. Caminhos da operação volume files são relativos à raiz do volume: a pasta /data/hybrid-shadow-48h do container aparece como /hybrid-shadow-48h no volume. Confira com list antes do download. Não use delete/upload/rename, não apague locks nem inicie outro ciclo. Se a versão instalada não tiver files, atualize o CLI.

Envie checkpoint.json e public-coverage.json da pasta baixada; os demais arquivos, se existirem, complementam evidência de coleta. O download da pasta evita perder qualquer um. Não são necessárias chaves de negociação, DATABASE_URL ou credenciais no anexo. Não publique o checkpoint em repositório público.

O checkpoint permite reconstituir a operação e o funil, mesmo que a versão antiga não tenha emitido eventos de rejeição. Isso é reconstrução histórica, não registro de observação contínua. A auditoria efetiva da sessão real só será declarada depois de receber e reproduzir esse arquivo. Os logs finais conhecidos mostram1trade/-0,036726782USDT/semposição e encerramento; não fornecem par/modo/saída.

## Frequência e rentabilidade

Aumentar entradas é benéfico somente se as adicionais mantiverem expectativa líquida positiva e risco/liquidez aceitáveis. EV negativa multiplicada por mais operações aumenta perda esperada; retirar filtros para gerar atividade não corrige custos. A proposta usa90dias, não reinicia48h repetidamente para fabricar amostra. Pode produzir menos trades por operar1h; lucro por risco e robustez após custos são os critérios, não uma meta diária de quantidade.

Taxa maker, saldo utilizável e mínimos reais precisam de nova consulta Read após deploy controlado do leitor. A implementação usa os mesmos0,40%/perna e0,80%deestresse confirmados/modelados anteriormente; não afirma nova consulta privada. Nenhuma dessas lacunas é resolvida pela importação de candles públicos.
