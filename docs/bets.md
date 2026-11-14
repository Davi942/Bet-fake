# Apostas simples pré-jogo

Dinheiro inteiramente fictício. `GET /api/bets` e `POST /api/bets` exigem sessão de apostador; administradores não podem apostar. A identidade vem somente da sessão. As operações usam o mesmo cookie HttpOnly e a validação de origem das demais operações financeiras.

Envio de uma aposta:

```json
{"fixtureId":"demo-fixture-1","market":"result","selection":"home","stakeCents":150,"confirmedOdd":"2.61","operationKey":"identificador-unico"}
```

`market`: `result` (seleções `home`, `draw`, `away`) ou `exactScore` (`0-0` a `5-5` e `other`). As seleções e odds atuais vêm de `GET /api/fixtures/:id`. Valor em centavos inteiros de 100 a 10000, limitado ao saldo disponível. Cada usuário pode ter até dez apostas aceitas por partida; recusas não consomem esse limite. O horário previsto não fecha apostas: a partida permanece disponível enquanto seu status é `scheduled`.

A aceitação devolve identificação, partida e nomes fixados, mercado, seleção e rótulo, `stakeCents`, `acceptedOdd`, `potentialReturnCents`, `createdAt` e `status: pending`. O retorno inclui o principal e usa aritmética inteira: R$ 1,50 à odd 2,61 corresponde a R$ 3,92, arredondando meio centavo para cima. A futura liquidação deve creditar esse mesmo retorno para apostas ganhas.

Odd divergente retorna HTTP 409 com `code: ODD_CHANGED` e `currentOdd`; não há débito. A interface mostra a nova cotação e exige outro clique de confirmação. Ela conserva a chave em resposta perdida ou erro de servidor; repetir a mesma solicitação devolve a mesma aposta, inclusive após esgotar saldo ou fechar a partida. Reutilizar a chave com dados diferentes ou em outra operação financeira retorna 409.

`GET /api/bets?fixtureId=...&status=pending` filtra o histórico próprio; situações previstas: `pending`, `won`, `lost`, `refunded`. A interface oferece filtros por partida e situação e vínculos entre extrato, aposta e partida. Atualização da mesma sessão preserva o rascunho; saída ou troca de usuário limpa dados privados e invalida respostas antigas.

## Transação e persistência

A transação bloqueia primeiro a partida e depois a carteira do apostador. Operações futuras de início, cancelamento e liquidação devem respeitar essa ordem, bloqueando carteiras em ordem determinística quando houver mais de uma. Sob os bloqueios, a aceitação verifica repetição, status, mercado/resultado, cotação, limite e saldo. A aposta, o débito da carteira e a entrada imutável de extrato com `bet_id`/`fixture_id` são gravados na mesma transação. Depósitos/saques usam apenas o bloqueio da carteira e não adquirem o da partida.

Os mercados são calculados a partir dos titulares fixados na publicação, sem consultar atributos atuais de times ou jogadores. A migração é aditiva e o seed não altera apostas nem suas movimentações. A simulação de #7 fecha a aceitação pré-jogo ao iniciar, preservando cotações de apostas aceitas. Aceitação ao vivo, liquidação e estorno serão integrados nos tickets #8/#9/#10. Veja `docs/live.md` para o ciclo público da partida.
