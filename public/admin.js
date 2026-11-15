(() => {
 const summary=document.querySelector('#admin-finance');
 const history=document.querySelector('#admin-audit');
 const status=document.querySelector('#admin-finance-status');
 const refresh=document.querySelector('#admin-refresh');
 const labels={
  'team.created':'Time cadastrado','team.updated':'Time editado','team.archived':'Time arquivado',
  'player.created':'Jogador cadastrado','player.updated':'Jogador editado','player.archived':'Jogador arquivado',
  'lineup.updated':'Escalação alterada','fixture.published':'Partida publicada',
  'fixture.rescheduled':'Horário alterado','fixture.started':'Partida iniciada','fixture.cancelled':'Partida cancelada',
 };
 const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'});
 let admin=false,generation=0;
 const element=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
 async function request(path) {
  const response=await fetch(path,{credentials:'same-origin'}),data=await response.json();
  if(response.status===401){clearSession();throw new Error(data.message);}
  if(!response.ok)throw new Error(data.message??'Não foi possível atualizar o painel.');
  return data;
 }
 function renderFinance(data) {
  const values=[
   ['Total apostado',data.totalStakedCents],['Retornos pagos',data.paidReturnsCents],
   ['Estornos',data.refundsCents],['Valor pendente',data.pendingCents],
   ['Resultado da casa',data.houseResultCents],
  ];
  const list=element('dl','');
  for(const [label,cents] of values)list.append(element('dt',label),element('dd',formatMoneyCents(cents)));
  const counts=element('p',`Partidas: ${data.fixtures.scheduled} agendadas, ${data.fixtures.inProgress} em andamento, ${data.fixtures.finished} encerradas e ${data.fixtures.cancelled} canceladas.`);
  summary.replaceChildren(list,counts);
 }
 function renderAudit(entries) {
  history.replaceChildren();
  for(const entry of entries){
   const row=element('tr','');
   row.append(element('td',date.format(new Date(entry.createdAt))),
    element('td',`${entry.actor.displayName} (${entry.actor.email})`),
    element('td',labels[entry.action]??entry.action),
    element('td',`${entry.target.type} ${entry.target.id}: ${JSON.stringify(entry.changes.before)} → ${JSON.stringify(entry.changes.after)}`));
   history.append(row);
  }
  if(!entries.length){const row=element('tr','');const cell=element('td','Nenhuma ação administrativa registrada.');cell.colSpan=4;row.append(cell);history.append(row);}
 }
 async function load() {
  if(!admin)return;
  const current=++generation;refresh.disabled=true;status.textContent='Atualizando painel…';
  try {
   const [finance,audit]=await Promise.all([request('/api/admin/finance'),request('/api/admin/audit')]);
   if(current!==generation||!admin)return;
   renderFinance(finance);renderAudit(audit);status.textContent='Painel e histórico atualizados.';
  }catch(error){if(current===generation&&admin)status.textContent=error.message;}
  finally{if(current===generation)refresh.disabled=false;}
 }
 document.addEventListener('session-changed',event=>{
  generation++;admin=event.detail?.role==='admin';
  if(admin)load();else{summary.replaceChildren();history.replaceChildren();status.textContent='';refresh.disabled=false;}
 });
 refresh.addEventListener('click',load);
})();
