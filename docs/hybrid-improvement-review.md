# Revisão econômica dos modos A/B — protocolo proposto em 24/11/2026

## Evidência e objetivo

Sessão Paper preservada no commit 6faa6bf. O export de 24/11 termina às14h05 Belém: uma operação fechada, nenhuma aberta, P&L -0,0367267822USDT. Uma operação não estima vantagem; o histórico de30dias já é evidência negativa: híbrido -1,427934USDT/19fechamentos/PF0,255884 e B isolado -1,38411/17/PF0,1919 no custo arquivado. A isolado -0,04382/2/PF0,7874 é insuficiente e não aprovado.

Meta1–2USDT/dia representa5,88–11,76% dos17USDT/dia. Não é requisito mínimo de engenharia nem expectativa sustentada. Com teto inicial alt1,70USDT,1,4% líquido corresponde à ordem de0,0238USDT por ganho. Nenhum aumento de risco para atingir meta nominal.

Taxa real observada0,004 em19pares; referência existente já usa0,004, entrada em base. TON não confirmado, saldo e mínimo notional desconhecidos. Não presumir taxa0,001, maker barato ou zero mínimo para demonstrar lucro.

## Diagnóstico estático confirmado

- A exige macro1h, toque dentro de0,25ATR abaixo da média, RSI anterior40–50, volume<1,1 e recuperação imediata acima EMA21, RSI<=58 e ATR>=0,70%. A interseção é restritiva; qual filtro domina depende de contagem, não foi medido ainda.
- B exige ADX<22, exaustão RSI7<25, fechamento fora/retorno verde e o MESMO piso ATR0,70%. A hipótese de conflito lateralidade/volatilidade merece teste, não é causa demonstrada.
- B escolhe menor entre SMA20 congelada e alvo líquido1,4%. O código verifica apenas margem líquida positiva: isso não comprova relação ganho/perda ou probabilidade favoráveis.
- Replay já registra rejeições de admissão; logs da sessão não mostram esse detalhe nem funil dos sinais. Não inferir falta de oportunidades, risco ou mínimos pelos resumos.
- Coleta em24/11 falhou por candle não confirmado às08h15 Belém e retomou. Retentativa de rede não cobre essa ausência transitória. Não houve demonstração de interrupção longa; não certificar continuidade perfeita.

## Três entregas, sem alterar a sessão em andamento

### 1. Diagnóstico mensurável e correção de coleta (primeiro)
Extrair após conclusão checkpoint.json e public-coverage.json. Reconciliar P&L/caixa/fees e cada entrada/saída, duração, MFE/MAE causal, modo e causas. Funil por candle/par/modo com critérios independentes (podem sobrepor) e sequência declarada: contexto, ATR, setup, confirmação, sinais emitidos, ocupado, cooldown, margem, risco/tamanho, mínimo e entrada. Manter denominadores e desconhecidos. Comparar frequência de sinais com admissões; não tratar contagens sobrepostas como partição.

Em branch do PR preparar retentativa limitada e com espera para candle fechado ainda ausente, por par/período, sem imputar/aceitar candle aberto. Se continuar ausente, registrar falha explícita e preservar último checkpoint. Testar atraso seguido de confirmação, falta persistente, dados conflitantes, cancelamento e retomada sem duplicação. Não implantar nova versão durante sessão congelada.

### 2. Experimento offline pequeno e previamente fixado
Reutilizar dados de desenvolvimento identificados; nenhum período já consultado será teste cego. Custos0,40%/perna e estresse0,80%, spread/slippage comuns; mesma banca, sizing por risco, mínimos e uma posição. Registrar todas as alternativas negativas. Não usar resultados para lançar nova grade.

Comparações isoladas com cada modo original:
1. A1: remover APENAS filtro volumeRatio<1,1; manter toque, RSI, macro, ATR e saídas. Hipótese: volume limita sinais sem benefício líquido. Não é melhoria aprovada.
2. B1: exigir recompensa líquida potencial / perda líquida estimada no stop >=1,5, mantendo SMA congelada, ATR e time-stop originais. Calcular em quantidade líquida, taxas/spread/slippage, decisão e abertura. Hipótese: margem simplesmente positiva admite retornos insuficientes. Pode zerar operações, que é reprovação por falta de utilidade.
3. B2: remover APENAS piso ATR global do modoB, mantendo todos os demais filtros e trava econômica original. Hipótese: piso global elimina reversões laterais. A trava de custo não pode ser removida; aumento de frequência sem EV positiva reprova. Não combinar B1+B2 nesta execução.

Não combinar A1/B1/B2 antes de evidência separada. Usar valores vizinhos apenas como diagnóstico de estabilidade previamente declarado, não seleção posterior de novo vencedor; qualquer expansão exige novo protocolo. Comparar EV/PF após custos, DD, exposição, duração, capital imobilizado, por bloco e concentração, não só contagem ou P&L absoluto.

### 3. Decisão objetiva e validação posterior
Mínimo de30fechamentos por candidata como triagem, EV>0 e PF>1 nos dois custos; resultado líquido>0 nos3blocos de desenvolvimento, sem aumento de risco e com análise de concentração. Critérios são filtro conservador de pesquisa, não garantia estatística ou aprovação financeira. Candidata precisa validação temporal independente com código/universo/custos/critério congelados antes da coleta; período conhecido do Paper já consultado é desenvolvimento. Com falha ou amostra insuficiente, não promover.

Se B falhar, não mantê-lo para aumentar atividade. Se só A justificar, prosseguir apenas A. Se nenhuma passar, registrar inviabilidade das formulações avaliadas e parar integração Demo desta candidata, sem ciclo indefinido de ajustes. Alternativa de horizonte maior/menor giro requer nova hipótese; não prometer dinheiro ao terminar estas entregas.

## Estado desta entrega

Revisão estática e estrutura concluídas. Funil, correção de coleta, novos backtests e vantagem econômica NÃO foram implementados/executados por este documento. Dados normalizados e checkpoint da sessão não estão disponíveis localmente nesta revisão. Nenhuma mudança no worker, ordens, merge, aumento de lote ou promoção. Não há promessa de1USDT/dia. A prioridade seguinte é a entrega1; não iniciar integração nativa Demo antes de elegibilidade.
