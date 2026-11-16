# Painel financeiro e histórico administrativo

A conta administrativa acessa **Administração** na mesma aplicação. O botão
**Atualizar painel e histórico** consulta `GET /api/admin/finance` e
`GET /api/admin/audit`. Ambos exigem sessão de administrador; visitantes e
apostadores não recebem esses dados. A conta admin não possui carteira e não
pode apostar.

Todos os valores da API são centavos inteiros de dinheiro fictício. O painel
apresenta:

- `totalStakedCents`: soma de todas as apostas aceitas, inclusive as pendentes
  e as estornadas posteriormente;
- `paidReturnsCents`: soma dos créditos de retorno total das apostas ganhas;
- `refundsCents`: soma dos estornos efetivamente creditados;
- `pendingCents`: soma dos valores das apostas ainda pendentes;
- `houseResultCents`: valores apostados em partidas encerradas menos retornos
  pagos nessas partidas. Pode ser negativo. Depósitos, saques e saldo inicial
  não entram no cálculo;
- `fixtures`: contagem de partidas por status.

Cada alteração administrativa bem sucedida em time, jogador, escalação ou
partida grava uma entrada de auditoria na mesma transação da alteração. O
histórico mostra o autor, a ação, o objeto alterado, valores anteriores e novos
e a data. Rejeições não geram entradas. O seed e a simulação automática não são
ações administrativas e não aparecem no histórico.
