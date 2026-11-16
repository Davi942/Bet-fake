(() => {
 let bettor=false,states=new Map();
 function pulse(){if(bettor)document.dispatchEvent(new Event('financial-refresh'));}
 document.addEventListener('session-changed',event=>{
  bettor=event.detail?.role==='bettor';
  if(!bettor)states.clear();
 });
 document.addEventListener('fixtures-snapshot',event=>{
  const next=new Map((event.detail??[]).map(fixture=>[fixture.id,fixture.status]));
  const settled=[...next].some(([id,status])=>states.has(id)&&states.get(id)!==status&&['finished','cancelled'].includes(status));
  states=next;
  if(settled)pulse();
 });
 setInterval(()=>{if(!document.hidden)pulse();},900);
})();
