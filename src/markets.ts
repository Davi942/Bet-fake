// Shared football model: independent goals, with strength affecting both rates.
export function goalRates(homeOverall: number, awayOverall: number) {
 const factor = Math.exp((homeOverall-awayOverall)/100);
 return {home:1.35*factor,away:1.35/factor};
}
function poisson(rate:number,limit=50) {
 const probabilities=[Math.exp(-rate)];
 // At the supported strengths rates are below 3.64; the omitted tail is <1e-30.
 for(let goals=1;goals<=limit;goals++) probabilities.push(probabilities[goals-1]*rate/goals);
 return probabilities;
}
export function pregameMarkets(homeOverall:number,awayOverall:number) {
 return markets(homeOverall,awayOverall,0,0,1,false);
}
// Number.toFixed switches to exponent notation at 1e21. Expand the significant
// decimal digits instead; quoting rare outcomes must never invent an odds cap.
function decimalOdd(value:number) {
 if(value<1e21)return value.toFixed(2);
 const [coefficient,exponent]=value.toExponential().split('e');
 const digits=coefficient.replace('.','');
 return digits.padEnd(Number(exponent)+1,'0')+'.00';
}
export function liveMarkets(homeOverall:number,awayOverall:number,homeScore:number,awayScore:number,remaining:number) {
 return markets(homeOverall,awayOverall,homeScore,awayScore,remaining,true);
}
function markets(homeOverall:number,awayOverall:number,homeScore:number,awayScore:number,remaining:number,live:boolean) {
 const rates=goalRates(homeOverall,awayOverall),limit=Math.max(50,Math.abs(homeScore-awayScore)+50);
 const home=poisson(rates.home*remaining,limit),away=poisson(rates.away*remaining,limit);
 let win=0,draw=0,loss=0;
 const selection=(key:string,label:string,probability:number)=>({key,label,probability,available:probability>0,odd:probability>0?decimalOdd(live?Math.max(1,1/(1.05*probability)):1/(1.05*probability)):null});
 const scores=[];
 for(let h=0;h<home.length;h++) for(let a=0;a<away.length;a++) {
  const probability=home[h]*away[a];
  if(h+homeScore>a+awayScore) win+=probability; else if(h+homeScore===a+awayScore) draw+=probability; else loss+=probability;
 }
 for(let h=0;h<=5;h++)for(let a=0;a<=5;a++)scores.push(selection(`${h}-${a}`,`${h} × ${a}`,h<homeScore||a<awayScore?0:home[h-homeScore]*away[a-awayScore]));
 // Sum the tails directly: 1-covered loses rare, still possible outcomes near the whistle.
 const homeTail=homeScore>=6?1:home.slice(6-homeScore).reduce((sum,p)=>sum+p,0);
 const awayTail=awayScore>=6?1:away.slice(6-awayScore).reduce((sum,p)=>sum+p,0);
 scores.push(selection('other','Outro placar (6 ou mais gols de um time)',homeTail+awayTail-homeTail*awayTail));
 return {result:{open:true,selections:[selection('home','Vitória do mandante',win),selection('draw','Empate',draw),selection('away','Vitória do visitante',loss)]},exactScore:{open:true,selections:scores}};
}
