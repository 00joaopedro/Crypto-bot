# Crypto Bot

Bot experimental de negociação **Spot**, escrito em Node.js + TypeScript.

> Aviso: software experimental, não é recomendação financeira. Este marco aceita somente `LOG_ONLY`; nenhuma ordem é enviada.

## Arquitetura atual

1. Busca candles públicos de 15 minutos via CCXT.
2. Usa Kraken como fonte padrão de candles, evitando o bloqueio regional da Bybit na Railway.
3. Descarta o candle ainda aberto.
4. Calcula EMA 9, EMA 21 e RSI 14 em código determinístico.
5. Gera sinal somente em cruzamento novo da EMA 9 acima da EMA 21, com RSI entre 45 e 70.
6. Opcionalmente consulta o Gemini com saída JSON estruturada.
7. Registra a decisão e mantém a execução financeira desativada.

A fonte pública de candles não define onde uma futura ordem será executada. A execução Bybit permanece planejada, mas precisará rodar em infraestrutura localizada em uma jurisdição compatível.

A IA é apenas um filtro: ela nunca cria o sinal, define tamanho, stop-loss ou take-profit. Falhas da IA bloqueiam a aprovação.

## Requisitos

- Node.js 22+
- Uma chave Gemini somente se `GEMINI_ENABLED=true`
- Nenhuma chave de corretora é necessária no modo atual

## Uso local

```bash
npm install
cp .env.example .env
npm run dev
```

No Windows PowerShell, copie manualmente `.env.example` para `.env` caso `cp` não esteja disponível.

## Deploy na Railway

O `Dockerfile` multiestágio instala as dependências de desenvolvimento somente durante a compilação, executa `npm run build` e copia apenas o JavaScript compilado e as dependências de produção para a imagem final.

A Railway detecta o `Dockerfile` automaticamente. O processo do bot é um worker contínuo e não precisa de domínio público nem de porta HTTP.

Variáveis mínimas:

- `ENVIRONMENT=LOG_ONLY`
- `MARKET_DATA_PROVIDER=kraken`
- `GEMINI_ENABLED=false` para iniciar sem IA; ou `true` junto com `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-flash-latest` quando a IA estiver ativa

As chaves Bybit podem permanecer cadastradas, mas não são lidas nem usadas no modo atual.

Se o provedor de dados estiver temporariamente indisponível, o processo permanece ativo e tenta novamente com espera crescente, evitando reinicializações contínuas.

## Segurança deliberada

- `ENVIRONMENT` só aceita `LOG_ONLY`.
- Não há modo `LIVE`.
- Não há código de criação de ordem neste marco.
- A mesma vela fechada não é reprocessada enquanto o processo permanece ativo.
- Segredos e arquivos `.env` são ignorados pelo Git.

## Próximo marco

A execução Bybit será adicionada em PR separado e hospedada em região compatível, incluindo:

- chave idempotente por candle/símbolo;
- persistência para resistir a reinícios;
- consulta de saldo e limites do mercado;
- arredondamento explícito com `amountToPrecision` e `priceToPrecision`;
- compra Spot limit com TP/SL anexado conforme API V5;
- confirmação do preenchimento da ordem;
- kill switch, limite de perda e limite de exposição.

Ordens Spot market não serão tratadas como se oferecessem automaticamente o mesmo TP/SL anexado disponível para Spot limit.
