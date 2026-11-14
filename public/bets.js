(() => {
 const section=document.querySelector('#betting'),form=document.querySelector('#bet-form'),fixtureField=document.querySelector('#bet-fixture'),marketField=document.querySelector('#bet-market'),selectionField=document.querySelector('#bet-selection'),amountField=document.querySelector('#bet-amount'),submit=document.querySelector('#bet-submit'),quoteText=document.querySelector('#bet-quote'),status=document.querySelector('#bet-status'),history=document.querySelector('#bets-list'),fixtureFilter=document.querySelector('#bets-fixture-filter'),statusFilter=document.querySelector('#bets-status-filter');
 let owner=null,session=0,loadGeneration=0,fixtures=[],bets=[],pending=null,busy=false,synced=false,newOdd=null,liveConnected=false,historySynced=false,fixtureRevision=0;
 const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'});
 const labels={pending:'Pendente',won:'Ganha',lost:'Perdida',refunded:'Estornada'};
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
 const option=(value,text)=>{const element=node('option',text);element.value=value;return element;};
 function quote() {
  const fixture=fixtures.find(f=>f.id===fixtureField.value),market=fixture?.markets[marketField.value];
  if(!['scheduled','in_progress'].includes(fixture?.status)||!market?.open)return null;
  const selection=market.selections.find(s=>s.key===selectionField.value&&s.probability>0);
  return selection?{...selection,odd:newOdd??selection.odd}:null;
 }
 function cents() {
  const text=amountField.value.trim();if(!/^\d+([,.]\d{1,2})?$/.test(text)||text.length>10)return null;
  const [whole,fraction='']=text.split(/[,.]/),amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  return amount>=100n&&amount<=10000n?Number(amount):null;
 }
 function update() {
  const selection=quote(),stake=cents();
  quoteText.textContent=selection?`Odd confirmada: ${selection.odd.replace('.',',')}${stake===null?'':` · Retorno potencial: ${formatMoneyCents((BigInt(stake)*BigInt(selection.odd.replace('.',''))+50n)/100n)} (inclui o valor apostado)`}`:'Selecione uma partida e um resultado disponíveis.';
  for(const input of form.querySelectorAll('input,select'))input.disabled=busy||Boolean(pending);
  submit.disabled=busy||!synced||(!pending&&!selection);
  submit.textContent=pending?'Repetir a mesma aposta':newOdd?'Confirmar nova odd':'Confirmar aposta simulada';
 }
 function selections() {
  const previous=selectionField.value,fixture=fixtures.find(f=>f.id===fixtureField.value),market=fixture?.markets[marketField.value];
  const available=market?.open?market.selections.filter(s=>s.available):[];
  if([...selectionField.options].slice(1).map(item=>item.value).join('|')!==available.map(item=>item.key).join('|')) {
   selectionField.replaceChildren(option('','Selecione um resultado'),...available.map(s=>option(s.key,s.label)));
   if(available.some(item=>item.key===previous))selectionField.value=previous;
  }
  update();
 }
 function renderHistory() {
  const previous=fixtureFilter.value,unique=new Map(bets.map(b=>[b.fixtureId,`${b.homeTeamName} × ${b.awayTeamName}`]));
  fixtureFilter.replaceChildren(option('','Todas'),...Array.from(unique,([id,name])=>option(id,name)));
  if(unique.has(previous))fixtureFilter.value=previous;
  const visible=bets.filter(b=>(!fixtureFilter.value||b.fixtureId===fixtureFilter.value)&&(!statusFilter.value||b.status===statusFilter.value));
  history.replaceChildren(...visible.map(b=>{
   const item=node('article');item.id=`bet-${b.id}`;
   const heading=node('h4'),link=node('a',`${b.homeTeamName} × ${b.awayTeamName}`);link.href=`#fixture-${b.fixtureId}`;heading.append(link);item.append(heading);
   item.append(node('p',`${b.market==='result'?'Resultado da partida':'Placar exato'} · ${b.selectionLabel}`),node('p',`Valor: ${formatMoneyCents(b.stakeCents)} · Odd aceita: ${b.acceptedOdd.replace('.',',')} · Retorno potencial: ${formatMoneyCents(b.potentialReturnCents)}`),node('p',`${date.format(new Date(b.createdAt))} · ${labels[b.status]??b.status}`));return item;
  }));
  if(!visible.length)history.append(node('p','Nenhuma aposta encontrada.'));
 }
 async function request(path,body) {
  const current=session;
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(response.status===401&&current===session)clearSession();
  if(!response.ok){const error=new Error(data.message??'Não foi possível concluir.');error.status=response.status;error.data=data;throw error;}
  return data;
 }
 async function load() {
  if(!owner)return;
  const current=session,generation=++loadGeneration,revision=fixtureRevision;
  try {
   const [published,own]=await Promise.all([request('/api/fixtures'),request('/api/bets')]);
   if(current!==session||generation!==loadGeneration)return;
   historySynced=true;synced=liveConnected;if(revision===fixtureRevision)fixtures=published;bets=own;
   if(!pending&&!busy) {
    const selected=fixtureField.value;
    fixtureField.replaceChildren(option('','Selecione uma partida'),...fixtures.filter(f=>['scheduled','in_progress'].includes(f.status)).map(f=>option(f.id,`${f.homeTeamName} × ${f.awayTeamName}`)));
    if(fixtures.some(f=>f.id===selected&&['scheduled','in_progress'].includes(f.status)))fixtureField.value=selected;
    selections();
   }
   renderHistory();update();
  }catch(error){if(current!==session||generation!==loadGeneration)return;synced=false;status.textContent=`Sem sincronização. ${error.message} Sincronize antes de fazer uma nova aposta.`;update();}
 }
 for(const field of [fixtureField,marketField])field.addEventListener('change',()=>{newOdd=null;selectionField.value='';selections();});
 selectionField.addEventListener('change',()=>{newOdd=null;update();});amountField.addEventListener('input',update);
 fixtureFilter.addEventListener('change',renderHistory);statusFilter.addEventListener('change',renderHistory);
 document.querySelector('#bets-refresh').addEventListener('click',async()=>{await load();if(synced)status.textContent='Partidas e apostas sincronizadas. Revise os dados antes de confirmar.';});
 window.addEventListener('offline',()=>{if(!owner)return;loadGeneration++;liveConnected=false;synced=false;status.textContent='Sem conexão. Sincronize antes de fazer uma nova aposta.';update();});
 window.addEventListener('online',load);
 document.addEventListener('live-connection',event=>{liveConnected=event.detail;synced=liveConnected&&historySynced;if(owner&&!synced)status.textContent='Sem sincronização ao vivo. Novas apostas bloqueadas até reconectar.';update();});
 document.addEventListener('fixtures-snapshot',event=>{
  const previous=fixtures.filter(f=>['scheduled','in_progress'].includes(f.status)).map(f=>f.id).join(',');
  fixtureRevision++;fixtures=event.detail;if(!owner)return;synced=liveConnected&&historySynced;
  if(newOdd){const fixture=fixtures.find(f=>f.id===fixtureField.value),selection=fixture?.markets[marketField.value]?.selections.find(item=>item.key===selectionField.value&&item.available);newOdd=selection?.odd??null;if(newOdd)status.textContent=`A odd mudou para ${newOdd.replace('.',',')}. Revise o retorno e clique em “Confirmar nova odd” para aceitar.`;}
  const next=fixtures.filter(f=>['scheduled','in_progress'].includes(f.status)).map(f=>f.id).join(',');
  if(previous!==next&&!pending&&!busy){const selected=fixtureField.value;fixtureField.replaceChildren(option('','Selecione uma partida'),...fixtures.filter(f=>['scheduled','in_progress'].includes(f.status)).map(f=>option(f.id,`${f.homeTeamName} × ${f.awayTeamName}`)));if(fixtures.some(f=>f.id===selected&&['scheduled','in_progress'].includes(f.status)))fixtureField.value=selected;}
  if(!pending&&!busy)selections();else update();
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!owner||busy||!synced)return;
  if(!pending) {
   const selection=quote(),stake=cents();
   if(!selection||stake===null){status.textContent='Escolha um resultado e informe de R$ 1,00 a R$ 100,00, com no máximo dois centavos.';return;}
   pending={fixtureId:fixtureField.value,market:marketField.value,selection:selection.key,stakeCents:stake,confirmedOdd:selection.odd,operationKey:crypto.randomUUID()};
  }
  const current=session;busy=true;loadGeneration++;update();status.textContent='Confirmando aposta simulada…';
  try {
   await request('/api/bets',pending);if(current!==session)return;
   pending=null;newOdd=null;amountField.value='';status.textContent='Aposta aceita. Odd fixada e valor descontado uma única vez.';
   document.dispatchEvent(new Event('bet-accepted'));
  }catch(error) {
   if(current!==session)return;
   if(error.status&&error.status<500) {
    pending=null;
    if(error.data?.code==='ODD_CHANGED'){newOdd=error.data.currentOdd;status.textContent=`A odd mudou para ${newOdd.replace('.',',')}. Revise o retorno e clique em “Confirmar nova odd” para aceitar.`;}
    else status.textContent=error.message;
   }else status.textContent='Não foi possível confirmar a resposta. Repita a mesma aposta para consultar o resultado sem duplicar o débito.';
  }finally {
   if(current===session){busy=false;update();if(!pending)await load();}
  }
 });
 document.addEventListener('session-changed',event=>{
  const next=event.detail?.role==='bettor'?event.detail.email:null;
  if(next===owner){if(owner)load();return;}
  owner=next;session++;loadGeneration++;pending=null;busy=false;synced=false;historySynced=false;newOdd=null;fixtures=[];bets=[];
  form.reset();fixtureField.replaceChildren();selectionField.replaceChildren();history.replaceChildren();fixtureFilter.replaceChildren(option('','Todas'));statusFilter.value='';status.textContent='';quoteText.textContent='';section.hidden=!owner;update();if(owner)load();
 });
 update();
})();
