# Bet-fake — resumo da entrevista

Estado: resumo aprovado pelo usuário em 2026-11-10, com a correção de permissões registrada abaixo. Os 12 tickets foram publicados e a implementação está autorizada. Acompanhar o processo em `docs/implementation-progress.md`.

## Stack aprovada

- Backend: TypeScript com Node.js 26 LTS e NestJS.
- Frontend: HTML, CSS e JavaScript puro, sem framework.
- Banco de dados: PostgreSQL 18.
- Execução local: Docker Compose.
- Comunicação ao vivo: gateways WebSocket do NestJS para atualizações de partidas.

Stack aceita pelo usuário em 2026-11-10. Detalhes de bibliotecas internas e organização do código ficam para o desenho técnico/backlog.

## Objetivo e limites

Casa de apostas simulada para estudo e portfólio, com dinheiro inteiramente fictício, apresentado como reais (R$ e centavos). O produto deve funcionar localmente com `docker compose up`, sem serviços externos obrigatórios, e não exige hospedagem pública ou disponibilidade 24/7.

Meta para demonstrações pequenas: até 20 apostadores conectados e 5 partidas simultâneas. Interface web em português do Brasil, adaptada para computador e celular, com navegação por teclado, mensagens claras, datas e valores em formato brasileiro e fuso horário identificado. Aviso “dinheiro fictício — projeto de estudo” no cadastro e na carteira.

Compatibilidade com versões atuais de Chrome, Firefox, Edge e Safari, em computador e celular.

## Apostadores e administradores

- Cadastro público cria apenas apostadores com nome de exibição, e-mail único e senha. Autenticação por JWT. Sem CPF, endereço, dados bancários, verificação de e-mail ou recuperação de senha nesta versão.
- Senha com pelo menos 8 caracteres. Após 5 tentativas incorretas seguidas, login da conta bloqueado por 15 minutos.
- Sessão expira após 1 hora. Ações pendentes precisam ser revisadas e confirmadas novamente após novo login.
- Visitantes podem consultar partidas, times, escalações, overalls, placares e odds. Carteira, apostas e extrato exigem login.
- Cadastro não permite escolher papel administrativo. Conta admin inicial documentada para demonstração; sem criação de outros admins nesta versão.
- Conta admin administra times, jogadores e partidas, e consulta painel financeiro e histórico de suas ações. Admin não tem carteira nem pode apostar. A área admin fica na mesma aplicação, mas é acessada com a conta administrativa; para apostar, usa-se uma conta comum separada.
- Histórico administrativo, visível apenas a admins, registra autor, ação, alterações e data. Motivo de cancelamento é público.

## Times, jogadores e partidas

- Admin cadastra, edita e arquiva times e jogadores. Arquivamento impede uso futuro e preserva dados das partidas publicadas.
- Cada jogador pertence a um time, tem nome, posição e overall inteiro de 1 a 100. Posições: goleiro, defensor, meio-campista e atacante.
- Cada escalação exige exatamente 11 titulares: 1 goleiro e 10 jogadores de linha, sem repetição. Não há formação tática obrigatória.
- Overall do time é a média simples dos overalls dos 11 titulares.
- Partida exige dois times diferentes, 11 titulares válidos por time e data/hora prevista. Ao ser publicada fica agendada e abre apostas. Escalações e atributos ficam fixos; somente horário previsto pode mudar. Erros nos times ou escalação exigem cancelar e cadastrar outra partida.
- A data/hora é uma previsão. Somente o admin inicia manualmente. Um time não pode participar de duas partidas simultâneas; máximo de 5 partidas em andamento.
- Partida dura aproximadamente 5 minutos reais, com relógio simulado visível. Simulação automática até o fim do tempo regulamentar e acréscimos; sem prorrogação ou pênaltis. Eventos: início, gols e encerramento, com minuto e time marcador; sem goleadores, intervalo, cartões, lesões ou substituições.
- Resultado depende da força dos times e aleatoriedade, nunca do volume de apostas nem do resultado financeiro da casa. Odds vêm de estimativa coerente com a simulação e incluem margem teórica de 5% por mercado, anterior ao arredondamento e ao piso das cotações ao vivo. Admin não escolhe vencedor nem altera odds manualmente.
- Status: agendada, em andamento, encerrada e cancelada. Só partida agendada pode ser cancelada; exige motivo, fecha apostas e estorna integralmente todas as apostas. Partidas iniciadas seguem até encerramento. Partidas encerradas ou canceladas são definitivas; resultado e apostas liquidadas não podem ser alterados.
- Se os serviços pararem, partida em andamento pausa e retoma do último tempo e placar salvos, sem avançar durante a indisponibilidade. Dados persistem ao reiniciar serviços ou computador.

## Apostas e odds

- Apostas simples, independentes, cada uma em um resultado de uma partida. Sem bilhetes múltiplos. Até 10 apostas aceitas por apostador por partida; recusadas não contam. O apostador não edita, cancela nem faz cash out de aposta aceita.
- Mercados: vitória do mandante, empate, vitória do visitante e placar exato. Placar exato individual de 0–0 a 5–5, mais “outro placar”, quando ao menos um time termina com 6 ou mais gols.
- Empate é qualquer placar com gols iguais. Apostas resolvidas pelo placar ao fim do tempo regulamentar com acréscimos.
- Apostas pré-jogo e ao vivo. Novas apostas podem ser feitas durante a partida até o apito final. Odd fica fixada na aceitação; apostas anteriores não mudam e o apostador pode fazer outras na mesma partida.
- Se a odd mudar entre seleção e confirmação, exigir nova confirmação da cotação. Se o mercado fechar, recusar sem descontar saldo. Revalidar na aceitação saldo, odd confirmada, status da partida e possibilidade do resultado; recusa sem débito se qualquer condição falhar. Placares que já não podem ocorrer ficam indisponíveis para novas apostas; apostas já aceitas são resolvidas normalmente.
- Mudanças de odds automáticas, considerando força, placar e tempo restante, após gols e em intervalos regulares. Sem ajuste baseado no volume apostado.
- Odd com duas casas decimais. Para resultados ainda possíveis ao vivo, aplicar `max(1.00, arredondar(1 / (probabilidade × 1.05), 2))`; a margem efetiva pode ficar abaixo de 5% devido ao piso. “Outro placar” garantido quando um time atinge 6 gols continua disponível à odd 1,00 até o apito final; placares impossíveis continuam indisponíveis. Retorno total de aposta vencedora = valor apostado × odd aceita, incluindo o valor apostado; arredondar ao centavo mais próximo, meio centavo para cima. Lucro é retorno menos valor apostado. Aposta perdedora não recebe crédito adicional.
- Ao fim da partida, fechar mercados e liquidar automaticamente: identificar ganhos e perdas e creditar cada retorno uma única vez. Estorno de cancelamento também é único. Operações financeiras não podem duplicar por duplo clique ou reenvio após falha.
- “Minhas apostas” mostra partida, seleção, valor, odd aceita, retorno potencial, data e estado pendente, ganha, perdida ou estornada; filtros por partida e situação.
- Atualizar automaticamente relógio, placar, odds, saldo e situação, com até 2 segundos de atraso em funcionamento normal. Em desconexão, indicar estado e bloquear novas apostas até sincronizar. A aceitação usa os dados atuais.

## Carteira e painel financeiro

- Saldo inicial de cada novo apostador: R$ 100,00.
- Depósitos simulados: R$ 1,00 a R$ 1.000,00 por operação. Saques simulados: mínimo R$ 1,00, limitados ao saldo disponível. Apostas: R$ 1,00 a R$ 100,00, limitadas ao saldo disponível. Valores podem ter centavos; sem limite máximo de saldo definido.
- Depósito e saque são imediatos e fictícios, sem banco ou pagamento real. Saldo apostado é descontado quando aposta é aceita. Saque não pode usar valores já apostados.
- Extrato imutável registra cada movimentação, data, tipo, valor e saldo resultante; operações de aposta apontam para aposta e partida. Inclui saldo inicial, depósitos, saques, apostas, retornos e estornos. Aposta perdida não gera segundo débito.
- Casa tem recursos fictícios ilimitados para pagar retornos; resultado da casa pode ser negativo. Depósitos, saques e saldo inicial não contam como receita/despesa no resultado.
- Painel admin: total apostado (inclui pendentes e depois estornadas), retornos pagos, estornos, valor pendente, resultado da casa (apostas nas partidas encerradas menos retornos pagos nelas) e contagem de partidas por status.

## Fora do escopo inicial

Campeonatos, classificações, ranking, chat, bônus promocionais, transferências entre carteiras, app móvel separado, outros idiomas, serviços externos de pagamento e múltiplos admins.

## Questões pendentes e próximas etapas

1. **Q56 resolvida:** documentar procedimento separado e explicitamente destrutivo para apagar dados locais e recomeçar; execução normal preserva dados.
2. **Stack:** resolvida e aprovada pelo usuário.
3. **Resumo final:** aprovado pelo usuário, com a correção de que admin não pode apostar e o cadastro público cria apenas apostadores comuns.
4. **Backlog:** divisão aprovada; issues #1 a #12 publicadas com dependências nativas.
5. **GitHub:** todos os tickets adicionados ao Project 1 de Davi942.

## Retomada

Q56, stack, resumo final e backlog estão resolvidos. Implementar todos os tickets com TDD, revisão, PR e squash merge na main, um ticket por vez.

## Esclarecimento resolvido para apostas ao vivo

Em 2026-11-12, o usuário aprovou a odd mínima de 1,00 nas cotações ao vivo, incluindo “outro placar” garantido com 6 ou mais gols. A fórmula e a exceção à margem efetiva de 5% estão registradas no ADR 0002. A decisão resolve a pergunta pendente dos tickets #7/#8; o objetivo foi retomado e o critério do ticket #7 foi sincronizado antes da implementação.
