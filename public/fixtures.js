(() => {
 const root=document.querySelector('#fixtures'),adminRoot=document.querySelector('#fixture-management'),status=document.querySelector('#status');
 const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const displayDate=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
 const number=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
 let admin=false,generation=0;
 const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
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
  item.append(node('p',`${displayDate.format(new Date(fixture.scheduledAt))} — America/Sao_Paulo · ${fixture.status==='scheduled'?'Agendada':fixture.status}`));
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
   for(const selection of market.selections){const row=node('tr');row.append(node('td',selection.label),node('td',selection.odd.replace('.',',')));table.append(row);}detail.append(table);
  }
  item.append(detail);
  if(admin&&fixture.status==='scheduled') {
   const form=node('form');form.append(node('h4','Alterar horário previsto'));dateField(form,fixture.scheduledAt);
   submit(form,'Salvar horário',()=>request(`/api/fixtures/${fixture.id}`,{scheduledAt:scheduledAt(form)},'PATCH'));item.append(form);
  }
  return item;
 }
 async function management(current) {
  if(!admin){adminRoot.replaceChildren();return;}
  const teams=await request('/api/teams');if(current!==generation||!admin)return;
  const form=node('form');form.append(node('h3','Publicar partida'),node('p','Dois times diferentes com 11 titulares ativos: 1 goleiro e 10 jogadores de linha. A publicação fixa nomes, atributos e escalações e abre os mercados.'));
  for(const [name,text] of [['homeTeamId','Mandante'],['awayTeamId','Visitante']]) {
   const label=node('label',text),select=node('select');select.name=name;select.required=true;const placeholder=node('option','Selecione um time');placeholder.value='';select.append(placeholder);
   for(const team of teams.filter(team=>team.lineupValid&&!team.archived)){const option=node('option',`${team.name} — overall ${number.format(team.overall)}`);option.value=team.id;select.append(option);}label.append(select);form.append(label);
  }
  dateField(form);submit(form,'Publicar e abrir mercados',()=>{const data=Object.fromEntries(new FormData(form));return request('/api/fixtures',{...data,scheduledAt:scheduledAt(form)});});
  adminRoot.replaceChildren(form);
 }
 async function load() {
  const current=++generation;
  try {
   const fixtures=await request('/api/fixtures');if(current!==generation)return;
   root.replaceChildren(...fixtures.map(article));status.textContent=`${fixtures.length} partidas publicadas.`;
   await management(current);
  }catch(error){status.textContent=error.message;}
 }
 document.addEventListener('session-changed',event=>{const next=event.detail?.role==='admin';if(next===admin)return;admin=next;adminRoot.replaceChildren();load();});
 document.addEventListener('teams-changed',()=>{management(generation).catch(error=>{status.textContent=error.message;});});
 document.querySelector('#refresh-fixtures').addEventListener('click',load);
 load();
})();
