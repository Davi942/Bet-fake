# Um modelo de gols compartilhado entre odds e simulação

As probabilidades pré-jogo usam gols independentes com distribuição de Poisson: times de mesma força têm expectativa de 1,35 gol por lado, ajustada por `exp((overallMandante - overallVisitante) / 100)` para o mandante e pelo inverso para o visitante, sem vantagem de mando adicional. Os mercados de resultado e placar exato derivam da mesma distribuição, e a simulação deverá usar essas mesmas expectativas dos titulares fixados na partida; assim evitamos cotações e resultados baseados em modelos incompatíveis. É uma calibração ilustrativa para estudo, sem pretensão de prever partidas reais.

No pré-jogo, cada odd é `1 / (probabilidade × 1,05)`, com margem teórica de 5% por mercado antes do arredondamento a duas casas decimais.

A simulação de #7 usa intervalos exponenciais com essas mesmas taxas para o período inteiro de 300.000 ms, que representa 90 minutos e quatro de acréscimos fixos. Os 1,35 gols esperados incluem esse período inteiro. As probabilidades ao vivo condicionam o resultado ao placar atual e aos gols futuros de Poisson, com taxas multiplicadas pela fração restante. Não usam os gols futuros já sorteados nem dados de apostas. A trajetória privada é persistida no início para retomar sem novo sorteio após interrupções. Veja `docs/live.md`.

## Piso das odds ao vivo

Decisão aprovada pelo usuário em 2026-11-12: para um resultado ainda possível, a odd ao vivo é `max(1.00, arredondar(1 / (probabilidade × 1.05), 2))`. O piso preserva um retorno total mínimo igual ao valor apostado em uma aposta vencedora. A margem de 5% é teórica, anterior ao piso e ao arredondamento; a margem efetiva pode ficar abaixo de 5% nesses casos. Não há desconto adicional sobre o retorno.

Quando um time atinge 6 gols, “outro placar” fica garantido e permanece disponível para novas apostas à odd 1,00 até o encerramento da partida. Placares individuais que se tornaram impossíveis continuam indisponíveis; resultados com probabilidade zero não recebem uma odd artificial pelo piso. Apostas já aceitas preservam a odd original e são resolvidas pelo resultado final.
