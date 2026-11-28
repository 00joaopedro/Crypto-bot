# Chave OKX de leitura na Railway

## Serviço identificado por leitura

Projeto `fabulous-insight`, ambiente `production`, serviço `Crypto-bot`:
https://railway.com/project/5bd3c996-fba6-4192-b201-9b55b9ccad60/service/b9642769-25e8-49ee-bdf9-e397cf4c0d38?environmentId=345c2328-6286-44af-aac0-ff8728bee508

Na inspeção anterior a esta atualização, os nomes OKX_READ_API_KEY, OKX_READ_SECRET_KEY e OKX_READ_PASSPHRASE não estavam presentes nesse serviço. As credenciais operacionais OKX_API_KEY/OKX_SECRET_KEY/OKX_PASSPHRASE são separadas e não devem ser substituídas.

## O que cadastrar

Para verificar as condições da conta real pretendida para os 17 USDT, criar na OKX uma chave **da conta real**, com somente Read/Leitura. Manter desmarcadas permissões de negociação, saque, transferência, empréstimo ou Earn. Nome sugerido: `CryptoBot-leitura-real`. A passphrase é a senha definida para essa chave, não a senha de login da conta. Guardar os três valores privadamente; não enviar no chat, em prints, no Git ou em argumentos de terminal.

No serviço indicado, abrir **Variables → New Variable**, uma entrada por vez:

| Nome | Valor |
|---|---|
| `OKX_READ_API_KEY` | API Key da nova chave Read |
| `OKX_READ_SECRET_KEY` | Secret Key da mesma chave |
| `OKX_READ_PASSPHRASE` | Passphrase definida para a mesma chave |
| `OKX_READ_ENVIRONMENT` | `real` |

O ambiente é explícito e independente do ENVIRONMENT/EXECUTION_PROVIDER do bot. Não alterar essas variáveis operacionais para consultar a conta real. Para uma consulta Demo, usar um conjunto de credenciais Read criado na Demo e escolher `demo`; não misturar credenciais e rótulos. Isso não é token da Railway ou API paga de IA. Não é necessário depositar os 17 USDT para realizar o teste Paper ou para consultar as taxas; se o saldo real for zero, o relatório deve mostrar isso sem inventar disponibilidade.

A Railway mantém alterações de variáveis em staged changes; revisar e aplicar apenas as alterações pretendidas para que um novo processo receba os valores. Aplicar variáveis pode reiniciar o serviço e não faz merge de PR. Não mudar Start Command para rodar o coletor no lugar do bot. A versão do PR que contém o botão precisa estar implantada; o simples cadastro das variáveis não instala código novo.

## Consulta pelo celular

Depois da implantação desta versão e da aplicação das variáveis:

1. Entrar no painel do bot com a autenticação habitual.
2. Em **Diagnóstico**, tocar **Verificar conta (leitura)**.
3. Conferir o rótulo REAL/DEMO, saldo disponível e os termos apresentados.
4. Se necessário compartilhar o diagnóstico, usar **Baixar leitura da conta**. O arquivo contém saldo e termos privados, mas não chaves, assinatura, IDs ou payload bruto da conta. Compartilhar apenas de forma privada.

A consulta é manual; não ocorre ao iniciar o bot nem ao carregar/atualizar o painel. O painel consulta a watchlist fixa de até 20 pares, com espera de 500ms antes de cada taxa. Pares/regras indisponíveis permanecem desconhecidos; o CLI anterior continua limitado a três pares por execução. Faz apenas os GETs permitidos do coletor já existente. Chave com qualquer permissão adicional é recusada após ler a configuração e antes de consultar saldos/taxas. O endpoint exige sessão do painel e recusa leitura cross-site; as respostas são no-store.

Consultas simultâneas compartilham a mesma operação e há cache de 60s, inclusive para falhas. O transporte tem prazo global de 20s e erros genéricos sem segredos. Não lê nem usa as chaves operacionais como fallback, não permite trocar o ambiente por querystring e não grava a leitura no banco ou nos logs operacionais. O relatório permanece somente em memória e no download solicitado.

Taxas usam o grupo do instrumento quando feeGroup está presente. Grupo ambíguo fica desconhecido; não recebe taxa genérica de outro grupo. Tipo de moeda da taxa de compra (base/quote) é projetado quando observado. Mínimo de valor não informado continua null. Rebates ou falhas não viram taxa zero. As condições observadas não aprovam negociação, não alocam os 17 USDT e não promovem automaticamente a estratégia.

## Código e implantação

A chave/secret/passphrase só podem ser preenchidas pelo titular; não foram criadas nem copiadas por esta atualização. Conferir o resultado da implantação e a existência dos nomes das variáveis antes de afirmar que a consulta está disponível. Um endpoint com credenciais ausentes retorna not_configured e não chama a OKX.

A integração nativa do híbrido na Demo, a validação econômica e uma sessão operacional de 48h continuam separadas. Este recurso resolve o caminho para obter evidência da conta; não substitui essas etapas. O perfil de lotes menores foi adotado para os próximos testes por delegação do usuário, preservando os limites, sem aplicar alterações de lote/risco ao serviço ativo.

Fontes oficiais consultadas: https://www.okx.com/en-br/help/api-faq , https://www.okx.com/docs-v5/en/ , https://docs.railway.com/variables .
