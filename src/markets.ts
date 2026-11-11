// Shared football model: independent goals, with strength affecting both rates.
// Match simulation will use these same rates when it is introduced.
export function goalRates(homeOverall: number, awayOverall: number) {
 const factor = Math.exp((homeOverall-awayOverall)/100);
 return {home:1.35*factor,away:1.35/factor};
}
function poisson(rate:number) {
 const probabilities=[Math.exp(-rate)];
 // At the supported strengths rates are below 3.64; the omitted tail is <1e-30.
 for(let goals=1;goals<=50;goals++) probabilities.push(probabilities[goals-1]*rate/goals);
 return probabilities;
}
export function pregameMarkets(homeOverall:number,awayOverall:number) {
 const rates=goalRates(homeOverall,awayOverall), home=poisson(rates.home),away=poisson(rates.away);
 let win=0,draw=0,loss=0,covered=0;
 const selection=(key:string,label:string,probability:number)=>({key,label,probability,odd:(1/(1.05*probability)).toFixed(2)});
 const scores=[];
 for(let h=0;h<home.length;h++) for(let a=0;a<away.length;a++) {
  const probability=home[h]*away[a];
  if(h>a) win+=probability; else if(h===a) draw+=probability; else loss+=probability;
  if(h<=5&&a<=5) {covered+=probability;scores.push(selection(`${h}-${a}`,`${h} × ${a}`,probability));}
 }
 scores.push(selection('other','Outro placar (6 ou mais gols de um time)',1-covered));
 return {result:{open:true,selections:[selection('home','Vitória do mandante',win),selection('draw','Empate',draw),selection('away','Vitória do visitante',loss)]},exactScore:{open:true,selections:scores}};
}
