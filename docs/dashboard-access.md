# Acesso e controle do painel

## Causas corrigidas

- A regra `.login-shell { display: grid }` sobrepunha a apresentação nativa de `hidden`. A tela de login podia continuar visível após a autenticação. A regra global `[hidden] { display: none !important }` corrige também controles condicionais com flex/grid.
- O login aguardava o carregamento completo de `/api/dashboard`, incluindo consultas à OKX, antes de trocar a tela. Agora `/api/session` confirma apenas a assinatura/validade do cookie; o painel abre antes dos dados.
- O carregamento periódico aguardava várias consultas externas. Leituras atrasadas e erros não autenticados não tinham o mesmo descarte por sequência. Agora requisições antigas são canceladas/ignoradas, inclusive erros, e falhas de rede não encerram a sessão.
- O comando de retomada aguardava o ciclo ativo e as verificações Demo; os botões aguardavam ainda uma atualização completa do painel. Agora a interface recebe um protocolo de acompanhamento, sem antecipar o resultado das verificações.

## Sessão

A validade permanece fixa em 12 horas desde o login. Sair da aba, retornar ou recarregar não encerra uma sessão válida. O cookie continua assinado, `HttpOnly`, `Secure`, sem guardar senha/token em localStorage. `SameSite=Lax` permite a navegação normal de volta ao painel; comandos continuam protegidos por validação de origem.

`DASHBOARD_SESSION_SECRET` deve permanecer estável entre reinícios/réplicas. Alterá-lo invalida as sessões existentes deliberadamente. Nenhuma variável nova é necessária. Uma sessão realmente expirada exige novo login. A confirmação por `/api/session` independe de PostgreSQL e OKX.

## Consultas e comandos

A interface usa `/api/dashboard?fast=1`. Diagnósticos da OKX são atualizados em segundo plano e compartilhados entre requisições; posições/contabilidade têm cache de até 60 segundos, saldo até 30 segundos. A resposta expõe horário da última leitura, falha e atualização pendente. Uma falha preserva a leitura anterior e permite nova tentativa após 5 segundos. Esse cache é exclusivo da apresentação: admissão de ordens, risco, proteção e retomada continuam usando suas consultas de segurança.

`POST /api/control?async=1` retorna 202 na retomada, com trabalho pendente consultável em `/api/control-status`. O estado Online depende da persistência após todas as verificações. Atualizações da página reencontram o trabalho pendente. Um reinício perde o protocolo em memória, mas o estado efetivo permanece no banco e é lido novamente.

A pausa é persistida sem esperar o trabalho de retomada. Ela cancela a retomada pendente e muda a revisão do controle mesmo quando o bot já está pausado. A retomada usa essa revisão em atualização condicional: uma conferência antiga não pode desfazer uma pausa posterior. A pausa não cancela/liquida ordens já enviadas.

O contrato síncrono de `/api/control` permanece para clientes existentes. A interface limita esperas HTTP a 15 segundos e consulta o estado após resultado ambíguo de um comando.

## Conferência após o deploy

1. Atualizar o painel uma vez para carregar os arquivos novos e entrar com a senha atual.
2. Sair da aba, voltar e recarregar: não deve exigir senha antes das 12 horas.
3. Pausar: conferir estado persistido. Retomar: conferir andamento e resultado de segurança, sem presumir sucesso pelo aceite do comando.
4. Se a retomada for bloqueada, resolver o motivo indicado; esta atualização não contorna a segurança Demo nem exige novo ciclo.

Os testes automatizados cobrem autenticação, expiração, segredo estável, assinaturas inválidas, OKX lenta, erros/respostas antigas, comandos concorrentes e a revisão PostgreSQL. A confirmação no navegador móvel real depende do deploy e não foi presumida pelos testes.
