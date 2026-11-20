# Execução 3 — experimentos limitados e cobertura operacional

`npm run strategy:experiments -- examples/universe-validation.study.json DIRETORIO`
reutiliza o source.json e os datasets do artifact congelado, conferindo manifesto,
nomes e hashes. Executa referência fixa, atraso de dois candles e trailing ATR
com os demais parâmetros iguais. Compara universos previamente fixados em 10 e
30, capital, exposição e cenários de custos idênticos. Atraso não é pullback.
Não escolhe um vencedor para produção nem altera a estratégia online. Os dados
já inspecionados servem para desenvolvimento, não um novo teste independente.

O relatório de 48h agora explicita `no_confirmed_fills` e não aceita uma janela
sem preenchimentos como validação operacional. Lista bloqueios observados sem
atribuir uma causa quando faltam evidências. Ausência de fills no export não
prova ausência de ordens na corretora. Proteções, cobertura e erros continuam
necessários; observação de fills tampouco comprova lucro.

A consulta Railway de 20/11 encontrou replay Paper, decisões HOLD, candles já
processados e reinícios em 19/11. Após 19:17:27 UTC não retornou registros na
consulta delimitada. Isso não comprova uptime ou uma causa única para as 48h.
É necessário exportar o JSON do painel cobrindo a janela exata e verificar
pausas, rejeições, sinais, permissões e reconciliação antes de alterar filtros.
A etapa operacional de 48h é a que valida integração; refinamento da estratégia
não resolve sozinho bloqueios técnicos. Não forçamos ordens, removemos stops ou
reduzimos filtros para fabricar trades. Nenhum deploy, merge ou variável alterada.
