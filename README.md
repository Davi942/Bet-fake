# Bet-fake

Casa de apostas simulada para estudo e portfólio. **Dinheiro fictício, sem valor real.**

Pré-requisito: Docker com Docker Compose. Execute na raiz do repositório:

```sh
docker compose up --build --wait
```

Acesse [http://localhost:3000](http://localhost:3000). A aplicação usa Node.js 26 LTS,
NestJS, HTML/CSS/JavaScript puro e PostgreSQL 18. O primeiro início cria o banco e
os dados de demonstração automaticamente. Não é necessário instalar Node ou
copiar `.env.example`. O primeiro build baixa imagens e dependências; a execução
não precisa de serviços externos.

O cadastro público cria apostadores, e o login abre a área pessoal ou administrativa
conforme o perfil. A demonstração de partidas continua pública. Administradores
podem gerenciar times, jogadores e titulares atuais. Partidas e operações de
carteira/apostas chegam nos próximos tickets.

| Conta | E-mail | Senha inicial |
| --- | --- | --- |
| Administrador | admin@betfake.local | AdminDemo123! |
| Apostador | apostador@betfake.local | ApostadorDemo123! |

O administrador não possui carteira. O apostador começa com R$ 100,00 fictícios.
Há quatro times com 11 jogadores cada e duas partidas agendadas, com escalações
fixadas. As datas aparecem no fuso America/Sao_Paulo. O seed é transacional e
idempotente: reiniciar não duplica os dados nem repõe saldo ou altera senhas.

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

Para parar e depois retomar, preservando os dados:

```sh
docker compose down
docker compose up --build --wait
```

Contas, carteiras e partidas ficam no volume nomeado `postgres_data`. Use essa
mesma pasta/projeto Compose ao reiniciar; outro nome de projeto cria outro volume.
`docker compose restart` também preserva dados. O comando normal nunca remove o
volume, e o seed preserva dados existentes, inclusive das funcionalidades futuras.

**Reset local destrutivo — apaga permanentemente TODOS os dados deste projeto:**

```sh
docker compose down --volumes
docker compose up --build --wait
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

Com o Compose saudável, execute os testes de integração pela interface HTTP:

```sh
npm test
```

Os testes usam PostgreSQL real, verificam a demonstração e reiniciam a aplicação
para conferir a persistência. `TEST_BASE_URL` permite alterar a URL se necessário.
Não use a suíte em um ambiente compartilhado: ela interrompe brevemente o serviço.
O CI executa os mesmos testes com um projeto Compose isolado.

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
