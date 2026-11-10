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

Esta etapa entrega o ambiente e os dados iniciais. Login, administração e apostas
serão implementados nos próximos tickets; as contas abaixo já estão persistidas.

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
