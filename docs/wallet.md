# Carteira fictícia

A área Minha conta mostra saldo disponível e extrato, em reais e centavos.
Depósitos de R$ 1,00 a R$ 1.000,00 e saques a partir de R$ 1,00 são imediatos,
sem pagamento ou transferência real. Saques podem usar todo o saldo disponível.
Administradores e visitantes não acessam carteiras.

| Interface HTTP | Comportamento |
| --- | --- |
| `GET /api/wallet` | Saldo e extrato da conta autenticada, em uma mesma leitura consistente. |
| `POST /api/wallet/operations` | Recebe `kind` (`deposit` ou `withdrawal`), `amountCents` e `operationKey`. |

Valores HTTP são números inteiros de centavos: R$ 1,23 corresponde a `123`.
A representação suporta até `Number.MAX_SAFE_INTEGER` centavos; não há limite
de negócio para saldo ou saque. Cálculos usam inteiros exatos e a interface
formata reais/centavos sem arredondar valores por ponto flutuante.

Uma operação retorna a movimentação com `id`, `kind`, `amountCents`,
`balanceAfterCents` e `createdAt`. Débitos têm valor negativo. O extrato traz
as movimentações mais recentes primeiro, preservando a ordem de aplicação,
com saldo inicial e todas as operações confirmadas. Campos `betId` e `fixtureId`
são nulos para saldo inicial, depósito e saque; ficam reservados para ligar
movimentações de apostas nos próximos tickets. Não existem rotas de edição ou
remoção do extrato, e o banco também impede alterar ou apagar movimentações.

`operationKey` é um identificador de 1 a 128 letras, números, `_` ou `-`, criado
pelo cliente antes do envio. Repetir a chave para a mesma conta, tipo e valor
retorna a movimentação original, inclusive em envios concorrentes e depois de
reiniciar. Reutilizar a chave com outro tipo ou valor retorna 409. Uma falha de
validação não aplica nem reserva a operação. As carteiras de contas diferentes
possuem chaves independentes. A conta é sempre obtida da sessão; parâmetros de
usuário no pedido não selecionam outra carteira.

No navegador, duplo clique é bloqueado durante o envio. Se a resposta falhar,
o formulário preserva os dados e a chave para repetir a mesma operação com
segurança. Depois de sair ou expirar a sessão, os dados pendentes são limpos:
é necessário entrar, revisar o saldo/extrato e confirmar novamente. Atualizar
a sessão da mesma conta preserva o rascunho e a identidade da operação pendente.

Migrações são aditivas e o seed mantém saldos já movimentados, extrato e chaves
de operação. Os testes usam apenas HTTP e o comando de seed em PostgreSQL real,
no projeto Compose descartável descrito em [testing.md](testing.md).
