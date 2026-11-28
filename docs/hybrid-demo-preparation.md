# Execução 3 — prontidão condicional para as 48h Demo

A preparação e a avaliação reproduzível desta etapa foram implementadas. **A integração operacional do híbrido e a janela de 48h não foram executadas.** Não há candidata econômica aprovada; a conclusão da etapa condicional não equivale a declarar o bot pronto para operar a nova estratégia.

## Sem API paga de IA

O runtime desta versão força `AI_MODE=quantitative` e `GEMINI_ENABLED=false`, inclusive quando existem configurações antigas `filter/true` ou uma chave antiga. Não exige chave de IA e não constrói o filtro Gemini no fluxo operacional. As interfaces e testes históricos do filtro permanecem no repositório; instalar uma biblioteca não é uma chamada de inferência nem uma cobrança de API.

Os cenários anteriores chamados Gemini eram hipóteses de taxa, spread e slippage, não serviços de IA usados pelo backtest. Não houve custo de IA nesses estudos. Agora `strategy:hybrid-research` executa por padrão apenas `account-conditioned` e `account-cost-stress`: quatro variantes × dois custos = oito replays. Os antigos dezesseis resultados e seus ledgers são preservados como histórico. `--include-cost-hypotheses` permite reproduzir a matriz antiga, sem fazer chamadas de IA; não é necessário para o novo fluxo. Os metadados novos identificam escopo de custos e ausência de chamadas pagas.

Isso não verifica as taxas atuais da conta: a referência arquivada continua com evidência parcial e fallback declarado. A configuração efetiva do serviço atualmente implantado não foi alterada; a política quantitativa forçada valerá quando esta versão for implantada.

## Entregas executadas

- Comando `demo:hybrid-readiness`, sem importação de executor, conta privada, agendador ou ferramenta de deploy.
- Protocolo `examples/hybrid-demo-readiness.plan.json` vincula bytes do relatório, dataset e plano da estratégia por hash. Matriz, blocos, contagens e expectativa são conferidos; flags editáveis de aprovação são ignoradas.
- Resultado reproduzível em `docs/hybrid-demo-readiness.json`: `blocked_no_eligible_candidate`. Apenas custos da referência arquivada e estresse participam da avaliação.
- O limiar de 30 fechamentos por caso e os blocos positivos são triagem conservadora para seleção futura. Não são apresentados retroativamente como critérios predefinidos de um teste independente já feito. Mesmo um caso sintético favorável não aprova deploy, início das 48h ou dinheiro real.
- Protocolo futuro de 48h define início após implantação identificada/reconciliada, registros por modo, proteção, ordens/taxas, risco e reinício. Exige interrupção por posição desprotegida, estado desconhecido/duplicado, ambiente inesperado, falta de evidência de saldo/termos ou violação de risco. Poucos trades deixam resultado inconclusivo; não se relaxam entradas para fabricar amostra.
- O workflow público gera e confere o relatório de prontidão, além dos oito replays; não recebe chave privada e não envia ordens.

Reprodução:

```sh
npm run build
npm run demo:hybrid-readiness -- docs/hybrid-research-results.json examples/hybrid-research.plan.json examples/hybrid-demo-readiness.plan.json NEW-output-directory
```

## O que falta antes de iniciar as 48h do híbrido

| Pendência | Evidência atual e ação necessária |
|---|---|
| Candidata econômica justificável | Híbrido/B continuam negativos nos dois custos relevantes; A só tem 1–2 fechamentos por caso e também é negativo no custo arquivado padrão. Não há candidata a integrar/aprovar agora. |
| Validação independente | Não executada. Código/candidata/custos/risco/critério precisam ser congelados antes de consultar novos dados. Todo o período de desenvolvimento e seu aquecimento já foram consultados. |
| Taxas, mínimos, saldo utilizável e acesso | Não confirmados na conta pretendida. Usar o coletor `account:inspect-readonly` já existente, com chave Read dedicada e ambiente explícito; nunca enviar segredo no chat. Regras públicas e saldo planejado de 17 USDT não comprovam as condições da conta. |
| Compatibilidade banca/lote/risco | Lote de 10 representa 58,82% de 17 USDT antes dos custos. O default de exposição no código é 25% (4,25 USDT nessa banca); o teto configurável atual é 30%. Esses valores do código não são leitura da configuração implantada. A pesquisa de lote fixo não aprova aumentar limites. É necessário definir alocação/lote compatível com risco, custos e mínimos observados. |
| Integração operacional dos modos | Ainda não implementada/validada: entradas com contexto 1h, identificação por modo, saída pela SMA congelada, time-stop B e trailing líquido A precisam de adaptação ao executor real da Demo. O replay offline não fornece isso automaticamente. |
| Proteção e estado durável | Validar precisão dos gatilhos, proteção nativa, avanço de stop, reinício no meio de uma posição, contador de candles, prevenção de duplicação e reconciliação específicos do híbrido. As proteções legadas existentes não certificam esses estados novos. |
| Versão/configuração e implantação | Congelar a candidata e confirmar a configuração efetiva após implantação. Nenhum merge, variável Railway, deploy ou ordem foi realizado aqui. Somente depois inicia o relógio de 48h. |

Não foi contornada nenhuma dessas pendências por flags ou por substituir uma candidata reprovada por outra sem evidência. Nesta etapa são possíveis as alterações de custo/IA, a avaliação reproduzível, os testes e o protocolo operacional. A integração financeira condicionada continua pendente.

## Sobre melhorar a assertividade

O objetivo econômico é expectativa líquida favorável com risco controlado. Acertar mais não basta: no cenário hipotético anterior, 53,6% de acertos ainda perderam dinheiro porque o ganho médio foi menor que a perda média. Trocar custos no relatório ou desabilitar IA não transforma essa relação em vantagem.

A pesquisa seguinte mais objetiva começa por condições verificadas da conta e separa os modos. A merece avaliação com uma amostra maior sob protocolo prévio, sem concluir vantagem a partir de dois trades. B exige uma nova hipótese explícita para a relação entre margem até a SMA, perdas e custos; não deve ser ativado só para aumentar frequência. Qualquer mudança de parâmetros precisa de novo experimento de desenvolvimento e validação posterior em dados independentes. Não há promessa de melhora nem ajuste novo de indicadores nesta execução.

Fontes oficiais para consulta de taxas/regras e ambiente Demo: https://www.okx.com/docs-v5/en/ . O coletor de leitura e seus limites estão em `docs/refinement-independent-readiness.md`.

## Entrega adicional posterior

Foi implementada uma sessão **Paper somente com dados públicos**, com dimensionamento opcional compatível com risco, retomada por checkpoint, identificação por modo, trailing/time-stop simulados e teste de aquecimento/retomada no CI. Perfil revisável e limites: `examples/hybrid-shadow.profile.json`; detalhes e pendências em `hybrid-shadow-session.md`. Isso não conclui o adaptador de ordens da OKX Demo nem altera a avaliação econômica negativa. A regra histórica de lote fixo 10 continua preservada; o lote variável é um perfil separado, sem ativação na Railway.
