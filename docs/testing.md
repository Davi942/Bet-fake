# Testes de integração

Os testes de apostas verificam respostas HTTP, carteira, extrato e histórico próprio. O início usa a operação pública desde #7. Para preparar somente os estados encerrado/cancelado ainda sem operação pública de finalização/cancelamento nos tickets #9/#10, o teste altera o status de sua partida publicada no PostgreSQL descartável; todas as asserções permanecem HTTP. Não há rotas de teste no produto nem asserções privadas de banco.

Os testes ao vivo observam HTTP, WebSocket nativo e o comando real `node dist/main.js`. A fábrica aceita fontes de tempo monotônico, aleatoriedade e agendamento somente como dependências de construção; não existem endpoints ou variáveis de ambiente para controlar gols. Cada cenário determinístico provisiona um banco com nome aleatório no PostgreSQL descartável e o remove ao terminar, evitando concorrência com o relógio do servidor principal. SQL só provisiona o namespace; não verifica estado privado. O relógio controlado percorre cinco minutos sem esperar cinco minutos reais. Os cenários cobrem gols, acréscimos, odds condicionais e raras, resultado garantido, capacidade concorrente, exclusão de times, reconexão, liderança única, pausa sem avanço durante indisponibilidade e retomada pelo ponto de entrada de produção.

Uma regressão de cadência mantém cinco partidas reais e vinte leitores WebSocket por dez segundos. Um proxy na fronteira PostgreSQL atrasa cada resposta `ReadyForQuery` em 250 ms após a preparação, simulando respostas lentas do banco durante a execução. O teste também exige que os vinte leitores recebam o retrato inicial em até dois segundos. As asserções observam somente comportamento público: saúde HTTP disponível, retratos com placar/eventos coerentes, recepção repetida e nenhum intervalo acima de dois segundos (incluindo silêncio no fim da medição). Não há asserção de número de consultas.

Outra regressão consulta a listagem pública de cinco partidas por vinte leitores HTTP concorrentes, com 125 ms de latência PostgreSQL controlada após a preparação. Cada resposta precisa chegar em até dois segundos e preservar todas as partidas. Isso protege a cadência do feed contra amplificação de consultas sob acesso simultâneo.

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

Outra regressão passa a autenticação PostgreSQL normalmente e atrasa em seis
segundos a resposta à primeira mensagem SQL pelo proxy, sem examinar o texto
da consulta. O ponto de entrada de produção precisa concluir a inicialização
e responder 200. Um segundo atraso de seis segundos na saúde precisa retornar
503 e depois recuperar: inicialização usa um pool temporário com orçamento
de 30 segundos por consulta, enquanto as consultas interativas mantêm cinco
segundos. A conexão inicial mantém timeout de três segundos e repetição limitada
a 30 segundos; transações e comandos SQL nunca são repetidos automaticamente.

Para verificar concorrência no login, outra aplicação independente usa a
verificação real de senha com uma demora controlada na fronteira de criptografia.
O teste envia cinco tentativas incorretas simultâneas e observa as respostas HTTP
e o bloqueio posterior, sem consultar contadores privados para fazer as asserções.

Uma segunda regressão de login passa por um proxy TCP com 650ms de atraso nas
respostas SQL, habilitado somente após inicializar e cadastrar a conta. Cinco
erros simultâneos precisam produzir quatro 401 e um 429, sem respostas 500 nem
aumentar os prazos das consultas. A contagem usa uma atualização condicional
atômica em autocommit, evitando manter o bloqueio da conta entre respostas de
rede separadas; as asserções continuam restritas às respostas HTTP.

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
