# Testes de integração

Requisitos de desenvolvimento: Node.js 26, npm, Docker e Docker Compose disponíveis.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

`npm test` cria um projeto Compose com nome aleatório, uma porta local livre,
credenciais de teste e volume PostgreSQL próprio. Constrói e inicia a aplicação,
executa a suíte HTTP e remove somente os contêineres e volumes desse projeto ao
terminar, inclusive quando algum teste falha. A aplicação de demonstração e seu
volume não são usados por esse comando. Não é necessário copiar `.env.example`
nem iniciar a demonstração antes dos testes.

Os testes observam interfaces HTTP reais e usam PostgreSQL real. Alguns testes
param/reiniciam o banco ou a aplicação do projeto de teste para verificar saúde,
persistência e recuperação. O relógio é injetado apenas na construção de uma
aplicação independente de teste para observar expiração e desbloqueio, sem rotas
de teste na aplicação de produção.

A regressão de inicialização também executa o ponto de entrada real atrás de um
proxy TCP que deixa a primeira conexão ao PostgreSQL sem resposta. Ela observa
pela saúde HTTP a recuperação após esse timeout transitório, mantendo a demora
de conexão controlada fora do código de produção.

Para verificar concorrência no login, outra aplicação independente usa a
verificação real de senha com uma demora controlada na fronteira de criptografia.
O teste envia cinco tentativas incorretas simultâneas e observa as respostas HTTP
e o bloqueio posterior, sem consultar contadores privados para fazer as asserções.

## Executar contra um ambiente já existente

```sh
npm run test:http
```

Esse comando não cria nem limpa um projeto Compose. Usa `TEST_BASE_URL` (padrão
`http://localhost:3000`) e o projeto selecionado por `COMPOSE_PROJECT_NAME`, se
definido. As credenciais demonstrativas devem coincidir com as variáveis do
ambiente de teste. É uma opção para desenvolvimento/CI em um projeto
descartável já iniciado; não deve ser usada em uma demonstração compartilhada,
pois cria registros e interrompe brevemente seus serviços.

O CI usa esse segundo comando após iniciar seu projeto isolado `bet-fake-ci` e
remove seus volumes no encerramento do job. O resultado de cada suíte aparece
nos checks do Pull Request.

Os testes de carteira verificam centavos exatos, limites, extrato imutável,
reenvios simultâneos da mesma operação, saques concorrentes, isolamento entre
contas e recusa de acesso administrativo. O teste de persistência movimenta
uma conta nova por HTTP e compara saldo, histórico e repetição da chave depois
do seed e de um ciclo normal de parada/início, preservando a demonstração.
