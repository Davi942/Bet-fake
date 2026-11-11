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
| [#3](https://github.com/Davi942/Bet-fake/issues/3) | Times e jogadores | #2 | Done / [#15](https://github.com/Davi942/Bet-fake/pull/15) |
| [#4](https://github.com/Davi942/Bet-fake/issues/4) | Partidas e mercados pré-jogo | #3 | In progress |
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
- #3 concluído: PR [#15](https://github.com/Davi942/Bet-fake/pull/15) integrado por squash (`4c12b44`), issue fechada e card Done confirmados. CI 42904122551/42904355304 passou, com 19 testes; revisão sem achados acionáveis.
- #4 iniciado: branch `feature/4-partidas-mercados` na main atualizada, card In progress. Esclarecimento sobre mercado ao vivo já garantido está pendente em `docs/requirements.md` e não bloqueia pré-jogo.
- #4 retomado após pausa: base `4c12b44` reconfirmada igual à main remota; Docker disponível. Teste inicial POST de publicação demonstrou 404. Primeira etapa API/modelo passou; teste seguinte demonstrou aceitação indevida de horário 24:00 e validação foi corrigida. Referência de empate para Poisson 1,35 foi corrigida para 0,2581801236492902, verificada por série e integral independentes.
- #4 infraestrutura de testes: `npm test` passou a usar `scripts/test-isolated.mjs`, com namespace Compose aleatório, porta livre e banco próprio; `npm run test:http` mantém a execução direta usada pelo CI isolado. Código e sintaxe conferidos; validação funcional completa desse runner ainda pendente da conclusão do #4.
- #4 suíte isolada executada: 22/22 testes passaram em banco novo; namespace `bet-fake-test-07dd400de821428baf543a3c332689f3` removido com 0 contêineres/volumes restantes. Saúde, times e partidas da demonstração mantiveram os mesmos hashes antes/depois. Primeira tentativa de startup falhou e também teve seus recursos removidos; falha intermitente em conexão inicial segue em diagnóstico com teste de atraso TCP controlado.
- #4 UI: consulta pública no Edge passou. Gravação na demonstração persistida foi recusada pela revisão automática; alternativa com projeto descartável está sendo usada. Teste administrativo de publicação/remarcação no navegador ainda não aprovado: tentativas tiveram falhas de harness/startup e todos os recursos próprios foram limpos. Não declarar esse fluxo testado até passar.
- #4 diagnóstico de startup: proxy TCP bloqueando apenas a primeira conexão reproduziu exatamente timeout/exit 1 antes de BEGIN. Corrigido com repetição limitada de aquisição inicial (30s, somente falhas transitórias). Teste direcionado passou após build real; senha inválida falhou em 2,83s e queda contínua encerrou em 29,36s. Probe HTTP em execução normal mantém timeout original. Nova regressão durável em `test/startup.test.mjs`; suíte completa após essa mudança ainda pendente.
- #4 UI regressão: Edge no projeto descartável confirmou que atualização de sessão com o mesmo papel apagava o rascunho da partida (valor vazio em vez de 2027-05-20T12:00). Listener corrigido para não reconstruir o formulário em atualização do mesmo papel; verificação verde de rascunho/publicação/remarcação/logout em andamento.
- #4 UI verde confirmada: Edge verificou rascunho preservado em atualização do mesmo papel, publicação, 40 seleções, remarcação e logout no namespace descartável `bet-fake-ui-56451d25a15a4a76b9fc99a40facee59`; todos os recursos próprios foram removidos. Imagem final e suíte de 23 testes (com startup) pendentes.
- #12 qualidade de interface a verificar: atualizações de times (`teams-changed`) ainda reconstroem o formulário de publicação; preservar o rascunho durante carregamentos/alterações de elenco, atualizando apenas seleções ainda válidas. O teste de atualização de sessão acima usa a carga inicial estabilizada e não cobre esse evento separado.
- #4 última suíte completa após correções: 22/23 passaram. A nova regressão de startup passou; o teste de cinco logins incorretos concorrentes retornou um 500 em vez de 429 por `Query read timeout` no SELECT FOR UPDATE de autenticação. Correção em andamento com teste HTTP de latência controlada na verificação real de senha, preservando a contagem atômica e os timeouts normais. Não abrir/mergear PR enquanto a suíte completa não passar.
- #4 concorrência: reprodução determinística em 13s retornou exatamente quatro 401 e um 500. Verificação de senha foi movida para antes da transação; a transação revalida bloqueio/hash atuais e atualiza a contagem atomicamente. Typecheck passou; teste verde direcionado e suíte completa com a nova regressão ainda pendentes.
- #4 retomada em 2026-11-11: ambiente interrompido `b6c299...` removido explicitamente. Imagem confirmou verificação fora do bloqueio e adapter de teste; regressão passou isolada. Acrescentada pré-condição para comprovar que a demora de criptografia foi exercida.
- #4 validação completa atual: 24/24 testes passaram em projeto descartável (`38a28848a4c141acac194fafbbb7d41a`), com limpeza concluída. Revisão e PR pendentes; nenhuma falha ativa de teste conhecida.
