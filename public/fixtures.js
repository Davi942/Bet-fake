(() => {
 const root=document.querySelector('#fixtures'),adminRoot=document.querySelector('#fixture-management'),status=document.querySelector('#status');
 const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const displayDate=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
 const number=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
 let admin=false,generation=0,snapshotGeneration=0,socket,reconnect,lastSnapshot=0,connected=false;
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
 const connection=node('p');connection.id='live-connection';connection.setAttribute('role','status');root.before(connection);
 async function request(path,body,method='POST') {
  const response=await fetch(path,{method:body===undefined?'GET':method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(response.status===401)clearSession();
  if(!response.ok)throw new Error(data.message??'Não foi possível concluir.');
  return data;
 }
 function dateField(form,value) {
  const label=node('label',`Data e hora previstas (${timezone})`),input=node('input');input.name='scheduledAt';input.type='datetime-local';input.required=true;
  if(value){const date=new Date(value);input.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  label.append(input);form.append(label);return input;
 }
 function submit(form,text,task) {
  const button=node('button',text);form.append(button);
  form.addEventListener('submit',async event=>{
   event.preventDefault();button.disabled=true;status.textContent='Aguarde…';
   try {await task();await load();status.textContent='Partida salva. Escalações publicadas permanecem fixadas.';}
   catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
 }
 function scheduledAt(form) {const value=new FormData(form).get('scheduledAt');const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('Informe uma data e hora válidas.');return date.toISOString();}
 function article(fixture) {
  const item=node('article');item.id=`fixture-${fixture.id}`;
  const heading=node('h3'),link=node('a',`${fixture.homeTeamName} × ${fixture.awayTeamName}`);link.href=`#fixture-${fixture.id}`;heading.append(link);item.append(heading);
  item.dataset.admin=String(admin);
  const state=node('p');state.className='fixture-state';item.append(state);
  const scoreboard=node('p'),score=node('strong'),clock=node('span');score.className='fixture-score';score.setAttribute('aria-live','polite');clock.className='fixture-clock';scoreboard.append(score,document.createTextNode(' · '),clock);item.append(scoreboard);
  const events=node('ol');events.className='fixture-events';events.setAttribute('aria-label','Eventos da partida');events.setAttribute('role','log');item.append(events);
  item.append(node('p',`Overall fixado: ${fixture.homeTeamName} ${number.format(fixture.homeOverall)} · ${fixture.awayTeamName} ${number.format(fixture.awayOverall)}`));
  const detail=node('details');detail.append(node('summary','Ver escalações fixadas e mercados'));
  for(const team of [{id:fixture.homeTeamId,name:fixture.homeTeamName},{id:fixture.awayTeamId,name:fixture.awayTeamName}]) {
   detail.append(node('h4',team.name));const list=node('ul');
   for(const player of fixture.lineups.filter(player=>player.teamId===team.id))list.append(node('li',`${player.name} · ${player.position} · overall ${player.overall}`));
   detail.append(list);
  }
  for(const [key,market] of Object.entries(fixture.markets)) {
   detail.append(node('h4',`${key==='result'?'Resultado da partida (1X2)':'Placar exato'} — ${market.open?'aberto':'fechado'}`));
   const table=node('table'),head=node('tr');head.append(node('th','Seleção'),node('th','Odd'));table.append(head);
   table.dataset.market=key;
   for(const selection of market.selections){const row=node('tr');row.dataset.selection=selection.key;row.append(node('td',selection.label),node('td'));table.append(row);}detail.append(table);
  }
  item.append(detail);
  if(admin&&fixture.status==='scheduled') {
   const start=node('button','Iniciar partida agora');start.type='button';start.className='fixture-start';
   start.addEventListener('click',async()=>{start.disabled=true;try{await request(`/api/fixtures/${fixture.id}/start`,{});await load();}catch(error){status.textContent=error.message;}finally{start.disabled=!connected;}});item.append(start);
   const form=node('form');form.append(node('h4','Alterar horário previsto'));dateField(form,fixture.scheduledAt);
   form.className='fixture-reschedule';
   submit(form,'Salvar horário',()=>request(`/api/fixtures/${fixture.id}`,{scheduledAt:scheduledAt(form)},'PATCH'));item.append(form);
  }
  patch(item,fixture);return item;
 }
 function patch(item,fixture) {
  const labels={scheduled:'Agendada',in_progress:'Em andamento',finished:'Encerrada',cancelled:'Cancelada'};
  item.querySelector('.fixture-state').textContent=`${displayDate.format(new Date(fixture.scheduledAt))} — America/Sao_Paulo · ${labels[fixture.status]}`;
  item.querySelector('.fixture-score').textContent=`Placar: ${fixture.score.home} × ${fixture.score.away}`;
  const seconds=Math.floor(fixture.elapsedMs/300000*94*60),minutes=Math.floor(seconds/60);
  item.querySelector('.fixture-clock').textContent=`Relógio: ${minutes>=90?'90+'+(minutes-90):String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} · 90 min + 4 de acréscimos`;
  const events=item.querySelector('.fixture-events');
  for(const event of fixture.events.slice(events.children.length))events.append(node('li',`${event.minute}' — ${event.type==='kickoff'?'Início':event.type==='end'?'Encerramento':`Gol de ${event.teamId===fixture.homeTeamId?fixture.homeTeamName:fixture.awayTeamName}`}`));
  for(const [key,market] of Object.entries(fixture.markets)) {
   const table=item.querySelector(`table[data-market="${key}"]`);
   table.previousElementSibling.textContent=`${key==='result'?'Resultado da partida (1X2)':'Placar exato'} — ${market.open?'aberto':'fechado'}`;
   for(const selection of market.selections){const row=table.querySelector(`tr[data-selection="${selection.key}"]`);row.lastElementChild.textContent=market.open&&selection.available?selection.odd.replace('.',','):'Indisponível';row.dataset.available=String(market.open&&selection.available);}
  }
  if(fixture.status!=='scheduled'){item.querySelector('.fixture-start')?.remove();item.querySelector('.fixture-reschedule')?.remove();}
  const start=item.querySelector('.fixture-start');if(start)start.disabled=!connected;
 }
 function apply(fixtures) {
  const present=new Set();
  for(const fixture of fixtures){present.add(`fixture-${fixture.id}`);let item=document.getElementById(`fixture-${fixture.id}`);if(!item||item.dataset.admin!==String(admin)){const replacement=article(fixture);if(item)item.replaceWith(replacement);else root.append(replacement);}else patch(item,fixture);}
  for(const item of root.children)if(!present.has(item.id))item.remove();
  document.dispatchEvent(new CustomEvent('fixtures-snapshot',{detail:fixtures}));
 }
 async function management(current) {
  if(!admin){adminRoot.replaceChildren();return;}
  const draft=adminRoot.querySelector('form')?Object.fromEntries(new FormData(adminRoot.querySelector('form'))):null;
  const teams=await request('/api/teams');if(current!==generation||!admin)return;
  const form=node('form');form.append(node('h3','Publicar partida'),node('p','Dois times diferentes com 11 titulares ativos: 1 goleiro e 10 jogadores de linha. A publicação fixa nomes, atributos e escalações e abre os mercados.'));
  for(const [name,text] of [['homeTeamId','Mandante'],['awayTeamId','Visitante']]) {
   const label=node('label',text),select=node('select');select.name=name;select.required=true;const placeholder=node('option','Selecione um time');placeholder.value='';select.append(placeholder);
   for(const team of teams.filter(team=>team.lineupValid&&!team.archived)){const option=node('option',`${team.name} — overall ${number.format(team.overall)}`);option.value=team.id;select.append(option);}label.append(select);form.append(label);
  }
  dateField(form);submit(form,'Publicar e abrir mercados',()=>{const data=Object.fromEntries(new FormData(form));return request('/api/fixtures',{...data,scheduledAt:scheduledAt(form)});});
  if(draft)for(const input of form.querySelectorAll('input,select'))if(draft[input.name]!==undefined)input.value=draft[input.name];
  adminRoot.replaceChildren(form);
 }
 async function load() {
  const current=++generation,snapshot=snapshotGeneration;
  try {
   const fixtures=await request('/api/fixtures');if(current!==generation)return;
   if(snapshot===snapshotGeneration)apply(fixtures);status.textContent=`${fixtures.length} partidas publicadas.`;
   if(!adminRoot.children.length)await management(current);
  }catch(error){status.textContent=error.message;}
 }
 document.addEventListener('session-changed',event=>{const next=event.detail?.role==='admin';if(next===admin)return;admin=next;adminRoot.replaceChildren();load();});
 document.addEventListener('teams-changed',()=>{management(generation).catch(error=>{status.textContent=error.message;});});
 document.querySelector('#refresh-fixtures').addEventListener('click',load);
 function connectivity(value) {
  connected=value;document.dispatchEvent(new CustomEvent('live-connection',{detail:connected}));
  connection.textContent=connected?'Ao vivo: partidas e odds sincronizadas.':'Sem sincronização ao vivo. Reconectando… Novas apostas bloqueadas.';
  for(const button of root.querySelectorAll('.fixture-start'))button.disabled=!connected;
 }
 function connect() {
  clearTimeout(reconnect);socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/fixtures`);
  socket.addEventListener('message',event=>{try{const data=JSON.parse(event.data);if(data.type!=='fixtures'){connectivity(false);return;}lastSnapshot=Date.now();snapshotGeneration++;connectivity(true);apply(data.fixtures);}catch{connectivity(false);}});
  socket.addEventListener('close',()=>{connectivity(false);reconnect=setTimeout(connect,1000);});
  socket.addEventListener('error',()=>socket.close());
 }
 setInterval(()=>{if(connected&&Date.now()-lastSnapshot>2000)connectivity(false);},500);
 window.addEventListener('offline',()=>{connectivity(false);socket?.close();});
 window.addEventListener('online',()=>{if(!socket||socket.readyState===WebSocket.CLOSED)connect();});
 connect();
 load();
})();
