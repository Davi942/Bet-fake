# Bet-fake

Casa de apostas simulada para estudo e portfólio. **Dinheiro fictício, sem valor real.**

Pré-requisito: Docker com Docker Compose. Execute na raiz do repositório:

```sh
docker compose up
```

Acesse [http://localhost:3000](http://localhost:3000). A aplicação usa Node.js 26 LTS,
NestJS, HTML/CSS/JavaScript puro e PostgreSQL 18. O primeiro início cria o banco e
os dados de demonstração automaticamente. Não é necessário instalar Node ou
copiar `.env.example`. O primeiro build baixa imagens e dependências; a execução
não precisa de serviços externos.

O cadastro público cria apostadores, e o login abre a área pessoal ou administrativa
conforme o perfil. Partidas, times, escalações, placares e odds são públicos.
Administradores gerenciam times, jogadores e partidas, iniciam a simulação,
cancelam partidas ainda agendadas e consultam o painel financeiro e a auditoria.
Apostadores movimentam a carteira fictícia, apostam antes e durante partidas e
acompanham saldo, extrato e resultados automaticamente.
Veja [operações e extrato](docs/wallet.md) e [apostas, limites e repetição segura](docs/bets.md).

| Conta | E-mail | Senha inicial |
| --- | --- | --- |
| Administrador | admin@betfake.local | AdminDemo123! |
| Apostador | apostador@betfake.local | ApostadorDemo123! |

O administrador não possui carteira. O apostador começa com R$ 100,00 fictícios.
Há quatro times com 11 jogadores cada e duas partidas agendadas, com escalações
fixadas. As datas aparecem no fuso America/Sao_Paulo. O seed é transacional e
idempotente: reiniciar não duplica os dados nem repõe saldo ou altera senhas.

## Roteiro de demonstração

1. Abra a página sem login para ver times, escalações, mercados e partidas.
2. Entre como apostador, escolha uma partida agendada, um resultado e um valor
   de R$ 1,00 a R$ 100,00. Confirme a odd exibida. O saldo e “Minhas apostas”
   mostram a aposta aceita.
3. Saia e entre como administrador. Em **Administração**, cadastre times e
   jogadores, ajuste titulares, publique uma partida ou clique em **Iniciar
   partida agora** em uma partida agendada. O horário previsto não a inicia
   automaticamente. A simulação dura cerca de cinco minutos reais.
4. Volte à conta de apostador para acompanhar placar e odds ao vivo e apostar
   novamente. Ao fim, o histórico mostra aposta ganha ou perdida e o retorno
   vencedor aparece na carteira. Se a odd mudar antes de confirmar, revise-a
   e confirme novamente.
5. Para ver estornos, o admin pode cancelar **outra partida ainda agendada**,
   informando o motivo. Apostas nela são devolvidas. Partidas iniciadas não
   podem ser canceladas. O painel admin mostra totais, contagem de partidas e
   histórico das ações administrativas.

A conta administrativa não aposta; para demonstrar os dois papéis, use os dois
logins acima. Todos os valores são fictícios, mesmo quando aparecem como R$.

Para personalizar porta e credenciais iniciais, copie `.env.example` para `.env`
antes do primeiro início. `APP_PORT` altera a porta no computador. Alterar senhas
de contas no `.env` depois de criadas não modifica contas existentes. Alterar as
credenciais do PostgreSQL depois de criar o volume também não reconfigura o banco.

Para verificar a conexão real com PostgreSQL:

```sh
curl http://localhost:3000/api/health
```

Retorno saudável: `{"status":"ok","database":"up"}`. Banco indisponível resulta
em HTTP 503. Logs: `docker compose logs app db`.

Para parar, pressione Ctrl+C no terminal do `docker compose up` e execute
`docker compose down`. Para retomar sem perder dados:

```sh
docker compose up
```

Contas, carteiras e partidas ficam no volume nomeado `postgres_data`. Use essa
mesma pasta/projeto Compose ao reiniciar; outro nome de projeto cria outro volume.
`docker compose restart` também preserva dados. O comando normal nunca remove o
volume, e o seed preserva dados existentes.

**Reset local destrutivo — apaga permanentemente TODOS os dados deste projeto:**

```sh
docker compose down --volumes
docker compose up
```

Use esse procedimento separado apenas para recomeçar do zero. Na próxima subida,
o seed recria a demonstração com as credenciais configuradas. Não é uma etapa
necessária para iniciar ou parar normalmente.

Para desenvolver fora do contêiner, instale Node.js 26 e configure as variáveis
`PG*` e `PORT` descritas em `.env.example` no ambiente do processo. A execução
direta não carrega `.env` automaticamente:

```sh
npm ci
npm run typecheck
npm run build
npm start
```

Execute `npm test` para criar um ambiente Docker isolado, verificar a interface
HTTP com PostgreSQL real e remover apenas os dados temporários ao terminar.
A demonstração local permanece disponível e seus dados são preservados.
Veja [testes e execução no CI](docs/testing.md).

Cadastro exige nome de exibição, e-mail único (sem distinguir maiúsculas ou espaços
nas extremidades) e senha com pelo menos 8 caracteres. Somente apostadores podem
ser criados pelo cadastro público; cada um recebe R$ 100,00 fictícios uma única vez.
Após cinco senhas incorretas consecutivas, a conta fica bloqueada por 15 minutos.
Login bem-sucedido zera a contagem. A sessão dura uma hora e sair revoga a sessão
no servidor. Após expirar, entre novamente, revise e confirme a ação; a aplicação
nunca reenvia automaticamente operações pendentes.

Autenticação usa JWT HS256 assinado por chave aleatória persistida no PostgreSQL,
com sessão revogável e cookie `HttpOnly; SameSite=Strict` (sem token no localStorage).
O ambiente local usa HTTP. Requisições de alteração com origem de outro site são
recusadas, inclusive login e cadastro. Clientes sem navegador podem omitir `Origin`.
Migração aditiva cria tabelas de autenticação e campos de bloqueio sem recriar
contas, senhas ou carteiras existentes.

| Interface HTTP | Acesso |
| --- | --- |
| `POST /api/auth/signup` (`displayName`, `email`, `password`) | Público; cria apostador |
| `POST /api/auth/login` (`email`, `password`) | Público; inicia sessão |
| `GET /api/auth/me`, `POST /api/auth/logout` | Sessão válida |
| `GET /api/account` | Somente apostador; perfil e `balanceCents` |
| `GET /api/admin/overview` | Somente administrador; entrada da área administrativa |
| `GET /api/admin/finance`, `GET /api/admin/audit` | Somente administrador; painel e histórico |
| `GET /api/wallet`, `POST /api/wallet/operations` | Somente apostador; saldo, extrato, depósito e saque simulados |
| `GET /api/bets`, `POST /api/bets` | Somente apostador; histórico e aposta simples |
| `GET /api/demo` | Público; partidas com nomes e escalações fixados |
| `GET /api/teams`, `GET /api/teams/:id` | Público; cadastros e titulares atuais |
| `POST /api/teams`, `PATCH /api/teams/:id` (`name`) | Somente administrador |
| `POST /api/teams/:id/players`, `PATCH /api/teams/:id/players/:playerId` (`name`, `position`, `overall`) | Somente administrador |
| `PUT /api/teams/:id/lineup` (`playerIds`) | Somente administrador; 11 titulares únicos |
| `POST /api/teams/:id/archive`, `POST /api/teams/:id/players/:playerId/archive` | Somente administrador; arquivamento permanente |

Falhas retornam 400 (dados inválidos), 401 (autenticação), 403 (perfil/origem),
409 (e-mail existente) ou 429 (conta temporariamente bloqueada). Os testes HTTP
usam banco real e uma aplicação separada com relógio injetado para verificar os
limites exatos de expiração/bloqueio, sem rotas de teste no servidor de produção.

Times podem ser cadastrados sem elenco completo. Posições permitidas: `goleiro`,
`defensor`, `meio-campista` e `atacante`; overall de jogador é inteiro de 1 a 100.
Escalação válida exige 1 goleiro e 10 jogadores de linha ativos do mesmo time.
O campo público `overall` é a média exata dos 11 titulares, sem arredondamento na
API (a tela apresenta até duas casas); fica `null` quando `lineupValid` é falso.
Editar uma posição pode invalidar a escalação até nova escolha de titulares.
Arquivar retira de novas escalações, sem apagar o cadastro nem as escalações já
fixadas em partidas. Não há transferência entre times ou exclusão definitiva.

A migração aditiva preserva cadastros existentes e inicializa os titulares da
demonstração apenas uma vez. Reiniciar ou executar o seed não repõe jogadores
retirados da escalação. Nomes dos times e atributos dos jogadores das partidas
publicadas ficam fixados, independentemente de edições nos cadastros atuais.

Administradores podem publicar partidas na mesma área de administração e alterar
somente a data/hora prevista depois da publicação. A lista pública inclui todas
as partidas; abra "Ver escalações fixadas e mercados" para consultar os 22
jogadores, os overalls e as odds. As datas exibidas usam America/Sao_Paulo;
os formulários identificam o fuso local do navegador para a entrada de horários.

| Interface HTTP de partidas | Acesso |
| --- | --- |
| `GET /api/fixtures`, `GET /api/fixtures/:id` | Público; atributos fixados e mercados |
| `POST /api/fixtures` (`homeTeamId`, `awayTeamId`, `scheduledAt`) | Administrador; publica como agendada |
| `PATCH /api/fixtures/:id` (`scheduledAt`) | Administrador; somente horário de partida agendada |
| `POST /api/fixtures/:id/start` | Administrador; início manual |
| `POST /api/fixtures/:id/cancel` (`reason`) | Administrador; cancelamento e estorno de partida agendada |

A API exige data ISO 8601 com `Z` ou deslocamento explícito e devolve UTC.
Publicação recusa times iguais, inexistentes, arquivados ou sem 11 titulares
ativos válidos. O servidor fixa nomes e atributos em uma transação, coordenada
com as alterações do elenco. Editar ou arquivar cadastros nunca recalcula os
atributos nem as odds de uma partida já publicada.

O modelo inicial considera gols independentes com distribuição de Poisson.
Para a diferença `d = (overallMandante - overallVisitante) / 100`, as médias de
gols são `1,35 × exp(d)` e `1,35 / exp(d)`. Times de mesma força têm a mesma
chance de vitória, sem vantagem de mando; o modelo não consulta apostas nem
finanças. A simulação usa as mesmas médias. Os mercados são
1X2 (3 seleções) e placar exato (36 placares de 0–0 a 5–5 e "outro placar",
quando pelo menos um time marca 6+). Para probabilidade `p`, a odd publicada
é `1 / (1,05 × p)`, arredondada para duas casas decimais; a soma das
probabilidades implícitas antes desse arredondamento é 1,05 em cada mercado.
Apostas pré-jogo e ao vivo fixam a odd aceita e descontam o valor uma única vez.
As odds ao vivo têm piso de 1,00 para resultados ainda possíveis. A simulação
fecha os mercados ao terminar, liquida as apostas e credita retornos vencedores
uma única vez. Cancelar uma partida agendada devolve integralmente suas apostas.
