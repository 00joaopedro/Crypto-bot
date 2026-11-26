# Download pelo navegador da sessão encerrada

O painel Crypto-bot não tem o volume do worker. Criar tar/zip no seu console não baixa o arquivo para o celular. O exportador é um processo separado, executado no próprio Crypto-bot-Paper-48h, com o volume original preservado.

Start command: `node dist/session-export-cli.js /data/hybrid-shadow-48h`. Ele importa somente HTTP, filesystem, crypto e sessão; não carrega bot, cliente OKX, coletor ou banco. Não retoma o teste, muda checkpoint/fingerprint ou envia ordens. Somente checkpoint.json e public-coverage.json podem ser baixados, até16MiB, sem seguir symlinks. Falhas não revelam diretórios e os bytes originais são transmitidos sem transformação.

Reutiliza DASHBOARD_PASSWORD e DASHBOARD_SESSION_SECRET através de referências Railway para o serviço Crypto-bot. Nenhum valor de credencial é consultado/exportado pelo agente. Login de formulário, validação de origem e cookie HttpOnly/Secure/SameSiteLax com12h; arquivos só ficam acessíveis depois do login. Não abre listagem de diretório nem acesso a variáveis, API keys ou outros arquivos.

Configuração preparada apenas no worker: fonte pinada no commit validado do PR, start export-only, PORT8080, health/health e referências de autenticação. O volume de500MB em/data permanece no mesmo serviço. Serviço do painel e sua execução/configuração não são alterados. Aplicar essa configuração é um deploy do leitor, não um novo ciclo de48h. Nenhum merge é necessário.

Após aplicar as mudanças pendentes de production na Railway e o deploy ficar SUCCESS, abra o domínio gerado do Crypto-bot-Paper-48h, entre com a mesma senha do painel e clique nos dois links de baixar. Anexe os JSONs à conversa. A URL só passará a funcionar depois do deploy; o worker antigo não oferece servidor HTTP.

Não alterar o start de volta para o bot nem apagar arquivos para efetuar o download. Este leitor pode ser encerrado após os arquivos estarem guardados. O checkpoint recebido ainda precisa ser auditado; sucesso no download não é confirmação de resultado financeiro ou continuidade da sessão antiga.

Validação: autenticação/origem/cookie, bloqueio de senha ausente, download com bytes e nome exatos, fonte preservada, path traversal/symlinks, limites de corpo e health sem dados. Smoke Chrome móvel testa login e download dos dois arquivos sem Termux. Não é necessário subir outro serviço ou criar token.
