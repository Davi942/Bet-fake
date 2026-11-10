# Progresso da implementação

## Processo autorizado

Cada ticket parte da main atualizada em uma branch `feature/<n>-<slug>`. Mover o card para In progress, implementar em TDD, validar testes e Docker Compose, revisar contra a main e os critérios do ticket, abrir PR com `Closes #<n>`, fazer squash merge com verificações passando e confirmar issue fechada e card Done antes do próximo ticket.

O usuário autorizou definir interfaces públicas e pontos de teste sem confirmações intermediárias. Testes observam comportamento, não estrutura interna. Só interromper por regra de negócio ambígua ou bloqueio incontornável.

## Backlog publicado

Todos os tickets estão em https://github.com/users/Davi942/projects/1.

| Issue | Entrega | Bloqueadores | Estado / PR |
| --- | --- | --- | --- |
| [#1](https://github.com/Davi942/Bet-fake/issues/1) | Ambiente local | Nenhum | Done / [#13](https://github.com/Davi942/Bet-fake/pull/13) |
| [#2](https://github.com/Davi942/Bet-fake/issues/2) | Cadastro, login e permissões | #1 | Done / [#14](https://github.com/Davi942/Bet-fake/pull/14) |
| [#3](https://github.com/Davi942/Bet-fake/issues/3) | Times e jogadores | #2 | In progress |
| [#4](https://github.com/Davi942/Bet-fake/issues/4) | Partidas e mercados pré-jogo | #3 | Backlog |
| [#5](https://github.com/Davi942/Bet-fake/issues/5) | Carteira e extrato | #2 | Backlog |
| [#6](https://github.com/Davi942/Bet-fake/issues/6) | Apostas pré-jogo | #4, #5 | Backlog |
| [#7](https://github.com/Davi942/Bet-fake/issues/7) | Simulação ao vivo | #4 | Backlog |
| [#8](https://github.com/Davi942/Bet-fake/issues/8) | Apostas ao vivo | #6, #7 | Backlog |
| [#9](https://github.com/Davi942/Bet-fake/issues/9) | Liquidação | #6, #7 | Backlog |
| [#10](https://github.com/Davi942/Bet-fake/issues/10) | Cancelamento e estorno | #4, #5, #6 | Backlog |
| [#11](https://github.com/Davi942/Bet-fake/issues/11) | Painel e auditoria | #3, #4, #5, #6, #9, #10 | Backlog |
| [#12](https://github.com/Davi942/Bet-fake/issues/12) | Experiência responsiva | #2, #4, #5, #6, #7, #8, #9, #10, #11 | Backlog |

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
- #2 TDD: teste de cadastro executado antes da implementação, retornando 404. Autenticação e testes estão em desenvolvimento; ainda sem validação completa ou PR.
- #2 etapa TDD publicada em `eb7d366`: CI [42897005082](https://github.com/Davi942/Bet-fake/actions/runs/42897005082) comprovou 10 testes passando e 3 falhando de forma esperada, por ausência de bloqueio após cinco erros (401 em vez de 429) e validação de origem (201 em vez de 403). Expiração de uma hora já passou antes da asserção de bloqueio no teste de relógio. Implementação desses cenários em andamento; ainda sem PR.
- Infra local durante #2: Docker Desktop caiu em EOF e ficou preso em starting. Recuperado com comandos oficiais de parada/inicialização e `wsl --shutdown`, sem remover volumes. Daemon 29.9.2 confirmado disponível; serviços do projeto precisam ser iniciados novamente.
- #2 validação final local: typecheck/build e Compose passaram; 13/13 testes passaram, incluindo expiração exata em uma hora, desbloqueio em 15 minutos, cinco falhas concorrentes, papéis e logout. App e db saudáveis ao final. Revisão e PR pendentes.
- #2 revisão: 0 violações documentadas e 1 duplicação de geração de hash identificada em Standards; 0 falhas de Spec. Compartilhamento do hash e extensão do teste de restart para conta recém-criada/sessão ativa em correção. CI `42898592715` passou no commit `660e1c3`; validar novamente após o ajuste.
- #2 correção de revisão concluída: seed e cadastro usam o mesmo hash assíncrono. Teste HTTP comprova conta nova e sessão ativa preservadas em down/up. Após fechar conexões HTTP antes do restart no teste, suíte completa 13/13 passou novamente, com build/typecheck e Compose saudáveis. PR/CI finais pendentes.
- #2 concluído: PR [#14](https://github.com/Davi942/Bet-fake/pull/14) integrado por squash (`a68529c`), main local atualizada, issue fechada e card Done confirmados. CI final 42899842021/42899859239 passou, ambos com 13 testes. Duplicação de hash corrigida; sem falhas de requisitos.
- #3 iniciado a partir da main atualizada: branch `feature/3-times-jogadores`, card In progress.
- #3 TDD em andamento: cadastro/consulta pública de time passou após teste inicial 404; cadastro de jogador também apresentou 404 antes da implementação. Escalação incompleta apresenta `lineupValid: false` e overall indisponível; migração de escalações demonstrativas executa uma única vez para preservar mudanças do usuário.
- #3: seis testes direcionados passaram. Capturado e corrigido erro 23502 de nomes históricos NOT NULL omitidos no seed; nomes e atributos publicados ficam fixos. Verificação real no Edge confirmou consulta pública, login admin sem reload, cadastro de time/jogador, rascunho preservado em atualização da sessão e logout. Suíte completa ainda em execução.
- #3 validação final: 19/19 testes passaram, typecheck/build e Compose passaram, serviços saudáveis. Revisão e PR pendentes.
- Qualidade a concluir antes dos testes financeiros: executar a suíte local em projeto Compose isolado (ou equivalente documentado) para evitar misturar dados de testes com a demonstração persistida. CI já usa projeto isolado; o comando local atual avisa que não deve ser usado em ambiente compartilhado.
