(() => {
 const root = document.querySelector('#teams');
 const adminRoot = document.querySelector('#team-management');
 const status = document.querySelector('#team-status');
 let admin = false, selected = null;
 const element = (tag, text) => { const node = document.createElement(tag); if(text !== undefined) node.textContent=text; return node; };
 async function request(path, body, method='POST') {
  const response=await fetch(path,{method:body===undefined?'GET':method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(response.status===401) { clearSession(); throw new Error(data.message); }
  if(!response.ok) throw new Error(data.message ?? 'Não foi possível concluir.');
  return data;
 }
 async function act(button, task) {
  button.disabled=true; status.textContent='Aguarde…';
  try {await task(); status.textContent='Alteração salva.'; await load();}
  catch(error) {status.textContent=error.message;}
  finally {button.disabled=false;}
 }
 function button(text, task) {const node=element('button',text);node.type='button';node.addEventListener('click',()=>act(node,task));return node;}
 function field(form, label, name, value='', type='text') {const wrapper=element('label',label);const input=element('input');input.name=name;input.type=type;input.value=value;input.required=true;if(type==='text') input.maxLength=100;wrapper.append(input);form.append(wrapper);return input;}
 function submit(form, text, task) {const node=element('button',text);form.append(node);form.addEventListener('submit',event=>{event.preventDefault();act(node,()=>task(Object.fromEntries(new FormData(form))));});}
 function playerForm(team, player) {
  const form=element('form');form.append(element('h4',player?'Editar jogador':'Cadastrar jogador'));
  field(form,'Nome','name',player?.name);
  const label=element('label','Posição');const select=element('select');select.name='position';
  for(const position of ['goleiro','defensor','meio-campista','atacante']) {const option=element('option',position);option.value=position;select.append(option);}
  select.value=player?.position ?? 'defensor';label.append(select);form.append(label);
  const overall=field(form,'Overall (1 a 100)','overall',player?.overall ?? 70,'number');overall.min=1;overall.max=100;overall.step=1;
  submit(form,player?'Salvar jogador':'Cadastrar jogador',async values=>{await request(`/api/teams/${team.id}/players${player?'/'+player.id:''}`,{...values,overall:Number(values.overall)},player?'PATCH':'POST');if(!player) form.reset();});return form;
 }
 function showEditor(team) {
  adminRoot.replaceChildren();
  const create=element('form');create.append(element('h3','Cadastrar time'));field(create,'Nome do time','name');submit(create,'Cadastrar time',async data=>{const created=await request('/api/teams',data);selected=created.id;});adminRoot.append(create);
  if(!team) return;
  const edit=element('form');edit.append(element('h3','Editar '+team.name));field(edit,'Nome do time','name',team.name);submit(edit,'Salvar nome',data=>request(`/api/teams/${team.id}`,data,'PATCH'));adminRoot.append(edit);
  if(team.archived) {adminRoot.append(element('p','Time arquivado. Histórico preservado.'));return;}
  adminRoot.append(button('Arquivar time',()=>request(`/api/teams/${team.id}/archive`,{})));
  adminRoot.append(playerForm(team));
  const lineup=element('form');lineup.append(element('h3','Titulares atuais'),element('p','Selecione exatamente 11: 1 goleiro e 10 jogadores de linha. O overall só aparece com escalação válida.'));
  for(const player of team.players.filter(p=>!p.archived)) {const label=element('label');const check=element('input');check.type='checkbox';check.name='playerIds';check.value=player.id;check.checked=player.starter;label.append(check,document.createTextNode(`${player.name} — ${player.position} — ${player.overall}`));lineup.append(label);}
  submit(lineup,'Salvar escalação',()=>request(`/api/teams/${team.id}/lineup`,{playerIds:new FormData(lineup).getAll('playerIds')},'PUT'));adminRoot.append(lineup);
  for(const player of team.players.filter(p=>!p.archived)) {const details=element('details');details.append(element('summary','Editar '+player.name),playerForm(team,player),button('Arquivar '+player.name,()=>request(`/api/teams/${team.id}/players/${player.id}/archive`,{})));adminRoot.append(details);}
 }
 async function load() {
  try {
   const teams=await request('/api/teams');root.replaceChildren();
   for(const team of teams) {
    const article=element('article');article.append(element('h3',team.name+(team.archived?' (arquivado)':'')),element('p',team.overall===null?'Escalação atual incompleta ou inválida — overall indisponível.':`Overall dos 11 titulares: ${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(team.overall)}`));
    const details=element('details');details.append(element('summary','Jogadores e titulares atuais'));const list=element('ul');
    for(const player of team.players) list.append(element('li',`${player.name} — ${player.position} — overall ${player.overall}${player.archived?' (arquivado)':player.starter?' — titular':''}`));
    if(!team.players.length) details.append(element('p','Nenhum jogador cadastrado.'));details.append(list);article.append(details);
    if(admin) article.append(button('Gerenciar '+team.name,async()=>{selected=team.id;}));root.append(article);
   }
   if(admin) showEditor(teams.find(team=>team.id===selected));
   document.dispatchEvent(new Event('teams-changed'));
  }catch(error) {status.textContent=error.message;}
 }
 document.addEventListener('session-changed',event=>{
  const next=event.detail?.role==='admin';if(next===admin)return;
  admin=next;selected=null;adminRoot.replaceChildren();load();
 });
 load();
})();
