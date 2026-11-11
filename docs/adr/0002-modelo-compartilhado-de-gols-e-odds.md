# Um modelo de gols compartilhado entre odds e simulação

As probabilidades pré-jogo usam gols independentes com distribuição de Poisson: times de mesma força têm expectativa de 1,35 gol por lado, ajustada por `exp((overallMandante - overallVisitante) / 100)` para o mandante e pelo inverso para o visitante, sem vantagem de mando adicional. Os mercados de resultado e placar exato derivam da mesma distribuição, e a simulação deverá usar essas mesmas expectativas dos titulares fixados na partida; assim evitamos cotações e resultados baseados em modelos incompatíveis. É uma calibração ilustrativa para estudo, sem pretensão de prever partidas reais.

No pré-jogo, cada odd é `1 / (probabilidade × 1,05)`, com margem teórica de 5% por mercado antes do arredondamento a duas casas decimais. Essa regra não define o tratamento de mercados já garantidos durante uma partida, cujo esclarecimento de negócio permanece pendente.
