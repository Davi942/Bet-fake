# Progresso da implementação

## Processo autorizado

Cada ticket parte da main atualizada em uma branch `feature/<n>-<slug>`. Mover o card para In progress, implementar em TDD, validar testes e Docker Compose, revisar contra a main e os critérios do ticket, abrir PR com `Closes #<n>`, fazer squash merge com verificações passando e confirmar issue fechada e card Done antes do próximo ticket.

O usuário autorizou definir interfaces públicas e pontos de teste sem confirmações intermediárias. Testes observam comportamento, não estrutura interna. Só interromper por regra de negócio ambígua ou bloqueio incontornável.

## Backlog publicado

Todos os tickets estão em https://github.com/users/Davi942/projects/1.

| Issue | Entrega | Bloqueadores |
| --- | --- | --- |
| [#1](https://github.com/Davi942/Bet-fake/issues/1) | Ambiente local | Nenhum |
| [#2](https://github.com/Davi942/Bet-fake/issues/2) | Cadastro, login e permissões | #1 |
| [#3](https://github.com/Davi942/Bet-fake/issues/3) | Times e jogadores | #2 |
| [#4](https://github.com/Davi942/Bet-fake/issues/4) | Partidas e mercados pré-jogo | #3 |
| [#5](https://github.com/Davi942/Bet-fake/issues/5) | Carteira e extrato | #2 |
| [#6](https://github.com/Davi942/Bet-fake/issues/6) | Apostas pré-jogo | #4, #5 |
| [#7](https://github.com/Davi942/Bet-fake/issues/7) | Simulação ao vivo | #4 |
| [#8](https://github.com/Davi942/Bet-fake/issues/8) | Apostas ao vivo | #6, #7 |
| [#9](https://github.com/Davi942/Bet-fake/issues/9) | Liquidação | #6, #7 |
| [#10](https://github.com/Davi942/Bet-fake/issues/10) | Cancelamento e estorno | #4, #5, #6 |
| [#11](https://github.com/Davi942/Bet-fake/issues/11) | Painel e auditoria | #3, #4, #5, #6, #9, #10 |
| [#12](https://github.com/Davi942/Bet-fake/issues/12) | Experiência responsiva | #2, #4, #5, #6, #7, #8, #9, #10, #11 |

## Pontos de teste

- #1: comando de inicialização Compose, endpoint HTTP de saúde com PostgreSQL real, persistência de dados demonstrativos e cobertura das variáveis de ambiente.
- #2: cadastro/login e acesso autorizado/recusado por HTTP; sessão expirada e bloqueio de tentativas.
- #3–4: manutenção administrativa e consulta pública de times, escalações e partidas; preservação dos dados publicados.
- #5–6: operações da carteira e apostas por HTTP, extrato e histórico; concorrência, limites e repetição da mesma operação.
- #7–9: eventos públicos de partida e apostas, controle de tempo/aleatoriedade apenas nas fronteiras para cenários determinísticos; retomada, fechamento de mercados e liquidação observáveis.
- #10–11: cancelamento, estorno e consultas administrativas por HTTP, incluindo restrições de papel e métricas financeiras.
- #12: jornadas no navegador em telas de computador e celular, navegação por teclado e reconexão; execução local completa.

## Estado atual

- #1 concluído: PR [#13](https://github.com/Davi942/Bet-fake/pull/13) integrado por squash na main (`06d8144`); issue fechada e card Done confirmados. Typecheck/build, Compose e 6/6 testes passaram localmente e no CI. Revisão: 0 achados de padrões e 0 de requisitos.
- #1 TDD: HTTP de saúde inicialmente falhou com conexão recusada; teste de indisponibilidade encontrou crash por conexão PostgreSQL ociosa e foi corrigido; teste de configuração encontrou NODE_ENV não documentado e foi corrigido.
- #1 publicação: OAuth não tinha scope workflow. SSH já autenticado como Davi942 permitiu publicar preservando CI, sem mudar o token. Para push, usar `git push ssh://git@github.com/Davi942/Bet-fake.git <branch>`.
- #1 revisão: persistência foi verificada com o saldo inicial. No #5, verificar por operações públicas que saldo já movimentado é preservado em reinício/reseed.
- #2 iniciado na main atualizada: branch `feature/2-cadastro-login-permissoes`, card In progress.
- #2 TDD: teste de cadastro executado antes da implementação, retornando 404. Autenticação e testes estão em desenvolvimento; ainda sem validação completa, commit ou PR.
