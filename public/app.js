'use strict';
const $=id=>document.getElementById(id);
let state={teams:[],matches:[],players:[]},token='',busy=false,dirty=false,selectedRevision='',selectedMatchId='',newRequestId='',draft=[];
let teamEditor=null,playerEditor=null;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const teamName=id=>state.teams.find(t=>t.id===id)?.name||'Equipo';
function badge(id){const t=state.teams.find(t=>t.id===id),color=/^#[0-9a-f]{6}$/i.test(t?.color||'')?t.color:'#66758a';return `<span class="dot" style="background:${color};border:1px solid #9996"></span>${esc(t?.name||'Equipo')}`;}
function notify(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function api(name,...args){
  if(location.protocol==='file:')throw new Error('Abre el enlace de tu sitio en Netlify. Esta aplicación necesita sus funciones de servidor.');
  const privateActions=['logout','addTeam','addPlayer','createMatch','saveMatch','updateTeam','deleteTeam','updatePlayer','deletePlayer','deleteMatch'];
  const payload={action:name,args:privateActions.includes(name)?args.slice(1):args};
  let response,result;
  try{response=await fetch('/.netlify/functions/api',{method:'POST',headers:{'Content-Type':'application/json','X-Copa-Client':'web'},credentials:'same-origin',body:JSON.stringify(payload),signal:AbortSignal.timeout(35000)});}
  catch{throw new Error('No se pudo conectar. Si estabas guardando, pulsa Actualizar para comprobar el registro antes de repetirlo.');}
  if(response.status===404)throw new Error('No se encontró la función del servidor. Publica el proyecto completo con Netlify CLI o un repositorio, incluyendo netlify/functions.');
  try{result=await response.json();}catch{throw new Error('Respuesta inválida del servidor. Revisa la publicación de Netlify Functions.');}
  if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo completar la operación.');
  return result.data;
}
function standings(data){
  const rows=data.teams.map(t=>({id:t.id,name:t.name,pj:0,pg:0,pe:0,pp:0,gf:0,gc:0,pts:0}));
  data.matches.filter(m=>m.x!==null&&m.y!==null).forEach(m=>{const a=rows.find(t=>t.id===m.a),b=rows.find(t=>t.id===m.b);if(!a||!b)return;a.pj++;b.pj++;a.gf+=m.x;a.gc+=m.y;b.gf+=m.y;b.gc+=m.x;if(m.x>m.y){a.pg++;b.pp++;a.pts+=3;}else if(m.x<m.y){b.pg++;a.pp++;b.pts+=3;}else{a.pe++;b.pe++;a.pts++;b.pts++;}});
  return rows.map(t=>({...t,dg:t.gf-t.gc})).sort((a,b)=>b.pts-a.pts||b.dg-a.dg||b.gf-a.gf||a.name.localeCompare(b.name));
}
function playerTotals(data){const rows=data.players.map(p=>({...p,goals:0,yellow:0,red:0}));data.matches.filter(m=>m.x!==null&&m.y!==null).forEach(m=>m.details.forEach(d=>{const p=rows.find(p=>p.id===d.playerId);if(p){p.goals+=d.goals;p.yellow+=d.yellow;p.red+=d.red;}}));return rows;}
function showTab(id){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==id);}
const empty=(cols,text)=>`<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;
function matchDetails(m){
  if(!m.details.length)return '<p class="hint">Sin novedades por jugador registradas.</p>';
  return `<div class="scroll"><table><thead><tr><th>Jugador</th><th>Equipo</th><th>Goles</th><th>🟨</th><th>🟥</th></tr></thead><tbody>${m.details.map(d=>{const p=state.players.find(p=>p.id===d.playerId);return `<tr><td>${esc(p?.name||'Jugador')}</td><td>${badge(p?.team)}</td><td>${d.goals}</td><td>${d.yellow}</td><td>${d.red}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function renderPublic(){
  const played=state.matches.filter(m=>m.x!==null&&m.y!==null);$('played').textContent=played.length;$('pending').textContent=state.matches.length-played.length;$('teamCount').textContent=state.teams.length;
  $('standings').innerHTML=standings(state).map((t,i)=>`<tr><td>${i+1}</td><td><strong>${badge(t.id)}</strong></td>${['pj','pg','pe','pp','gf','gc','dg','pts'].map(k=>`<td class="${k==='pts'?'points':''}">${t[k]}</td>`).join('')}</tr>`).join('')||empty(10,'Aún no hay equipos inscritos.');
  const rounds=[...new Set(state.matches.map(m=>m.j))].sort((a,b)=>a-b);
  $('fixtureList').innerHTML=rounds.map(j=>`<div class="round">Jornada ${j}</div>`+state.matches.filter(m=>m.j===j).map(m=>`<article class="match-card"><div class="match"><div class="teams">${badge(m.a)} <span class="score">${m.x===null?'VS':`${m.x} – ${m.y}`}</span> ${badge(m.b)}</div><span class="status">${m.x===null?'Pendiente':'Finalizado'}${m.date?' · '+esc(m.date):''}</span>${token?`<div class="row-actions"><button data-edit="${esc(m.id)}">Editar</button><button class="danger" data-delete-match="${esc(m.id)}">Eliminar</button></div>`:''}</div><details><summary>Detalle del partido</summary>${matchDetails(m)}</details></article>`).join('')).join('')||'<p class="empty">Aún no hay partidos registrados.</p>';
  const totals=playerTotals(state),scorers=totals.filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name));
  $('scorers').innerHTML=scorers.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${badge(p.team)}</td><td class="points">${p.goals}</td></tr>`).join('')||empty(4,'Aún no hay goleadores registrados.');
  const missing=played.reduce((n,m)=>n+m.x+m.y-m.details.reduce((s,d)=>s+d.goals,0),0);$('missingGoals').textContent=missing?`${missing} gol(es) del marcador sin autor asignado (incluye posibles autogoles).`:'';
  const cards=totals.filter(p=>p.yellow||p.red).sort((a,b)=>b.red-a.red||b.yellow-a.yellow||a.name.localeCompare(b.name));
  $('cards').innerHTML=cards.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${badge(p.team)}</td><td>${p.yellow}</td><td>${p.red}</td></tr>`).join('')||empty(5,'Aún no hay tarjetas registradas.');
}
function updateTeamOptions(id,placeholder){const select=$(id),old=select.value;select.innerHTML=`<option value="">${placeholder}</option>`+state.teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');if(state.teams.some(t=>t.id===old))select.value=old;}
function renderAdmin(){
  $('loginPanel').hidden=!!token;$('adminPanel').hidden=!token;if(!token)return;
  $('teamList').innerHTML=state.teams.map(t=>`<div class="admin-row"><strong>${badge(t.id)}</strong><div class="row-actions"><button data-edit-team="${esc(t.id)}">Editar</button><button class="danger" data-delete-team="${esc(t.id)}">Eliminar</button></div></div>`).join('');
  $('roster').innerHTML=state.teams.map(t=>`<div class="roster-team"><strong>${badge(t.id)}</strong>${state.players.filter(p=>p.team===t.id).map(p=>`<div class="admin-row"><span>${esc(p.name)}</span><div class="row-actions"><button data-edit-player="${esc(p.id)}">Editar</button><button class="danger" data-delete-player="${esc(p.id)}">Eliminar</button></div></div>`).join('')||'<p>Sin jugadores</p>'}</div>`).join('')||'<p class="hint">Inscribe un equipo para comenzar.</p>';
  updateTeamOptions('playerTeam','Selecciona un equipo');
  updateTeamOptions('homeTeam','Selecciona el local');updateTeamOptions('awayTeam','Selecciona el visitante');
  // No tocar el formulario de partido mientras tiene cambios pendientes.
  if(dirty)return;
  $('matchSelect').innerHTML='<option value="">＋ Nuevo partido</option>'+state.matches.map(m=>`<option value="${esc(m.id)}">J${m.j} · ${esc(teamName(m.a))} vs. ${esc(teamName(m.b))}${m.x===null?' · Pendiente':` (${m.x}-${m.y})`}</option>`).join('');
  $('matchSelect').value=state.matches.some(m=>m.id===selectedMatchId)?selectedMatchId:'';
  loadMatch();
}
function generateId(){return window.crypto?.randomUUID?crypto.randomUUID():`partido-${Date.now()}-${Math.random().toString(36).slice(2,14)}`;}
function selectedTeams(){const m=state.matches.find(m=>m.id===selectedMatchId);return m?[m.a,m.b]:[$('homeTeam').value,$('awayTeam').value];}
function loadMatch(){
  selectedMatchId=$('matchSelect').value;const m=state.matches.find(m=>m.id===selectedMatchId);dirty=false;selectedRevision=m?.revision||'';
  $('newMatchFields').hidden=false;$('newMatchFields').disabled=false;$('existingMatchInfo').hidden=!m;$('deleteMatch').hidden=!m;
  $('homeTeam').disabled=!!m;$('awayTeam').disabled=!!m;
  if(m){$('existingMatchInfo').textContent='Puedes corregir jornada y fecha. Para cambiar los equipos, elimina este partido y registra uno nuevo.';$('homeTeam').value=m.a;$('awayTeam').value=m.b;$('round').value=m.j;$('matchDate').value=m.date;draft=structuredClone(m.details);}
  else{draft=[];newRequestId=generateId();$('homeTeam').value='';$('awayTeam').value='';$('homeTeam').dataset.previous='';$('awayTeam').dataset.previous='';$('round').value=1;$('matchDate').value='';}
  $('homeScore').value=m?.x??0;$('awayScore').value=m?.y??0;renderDraft();
}
function renderDraft(){
  const teams=selectedTeams();$('homeLabel').textContent=teams[0]?teamName(teams[0]):'Local';$('awayLabel').textContent=teams[1]?teamName(teams[1]):'Visitante';
  const available=state.players.filter(p=>teams.includes(p.team)&&!draft.some(d=>d.playerId===p.id)).sort((a,b)=>teamName(a.team).localeCompare(teamName(b.team))||a.name.localeCompare(b.name));
  const old=$('detailPlayer').value;$('detailPlayer').innerHTML='<option value="">Selecciona un jugador</option>'+available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(teamName(p.team))}</option>`).join('');if(available.some(p=>p.id===old))$('detailPlayer').value=old;
  $('playerDetails').innerHTML=draft.map(d=>{const p=state.players.find(p=>p.id===d.playerId);return `<tr data-player="${esc(d.playerId)}"><td>${esc(p?.name||'Jugador')}</td><td>${esc(teamName(p?.team))}</td>${['goals','yellow','red'].map(k=>`<td><input aria-label="${esc(p?.name)}: ${k==='goals'?'goles':k==='yellow'?'amarillas':'rojas'}" data-field="${k}" type="number" required min="0" max="${k==='goals'?99:k==='yellow'?2:1}" step="1" value="${d[k]}" inputmode="numeric"></td>`).join('')}<td><button type="button" data-remove="${esc(d.playerId)}" aria-label="Quitar a ${esc(p?.name)}">Quitar</button></td></tr>`;}).join('')||empty(6,'Añade aquí a los goleadores y amonestados del partido.');
}
function syncDraft(){draft=[...$('playerDetails').querySelectorAll('[data-player]')].map(row=>{const d={playerId:row.dataset.player};row.querySelectorAll('[data-field]').forEach(i=>d[i.dataset.field]=Number(i.value));return d;});}
async function run(action){if(busy)return;busy=true;document.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);try{await action();}catch(e){notify(e.message,true);if(/Sesión vencida|Inicia sesión/.test(e.message)){token='';dirty=false;resetTeamEditor();resetPlayerEditor();renderAdmin();renderPublic();}}finally{busy=false;document.querySelectorAll('button,input,select').forEach(b=>b.disabled=false);$('homeTeam').disabled=!!selectedMatchId;$('awayTeam').disabled=!!selectedMatchId;}}
async function refresh(manual=false){if(busy)return;if(manual&&dirty&&!confirm('¿Descartar los cambios sin guardar y actualizar?'))return;await run(async()=>{state=await api('getData');if(manual)dirty=false;renderPublic();renderAdmin();$('connection').textContent=`Actualizado: ${new Date().toLocaleTimeString('es-EC')}`;});}
function save(pending=false){
  if(!pending&&!$('matchForm').reportValidity())return;
  if(!$('homeTeam').value||!$('awayTeam').value||!$('round').reportValidity()){notify('Selecciona los dos equipos y la jornada.',true);return;}
  if(pending&&selectedMatchId&&!confirm('¿Marcar pendiente? Se retirarán el resultado y todas las novedades de este partido.'))return;
  syncDraft();const base={x:pending?null:Number($('homeScore').value),y:pending?null:Number($('awayScore').value),details:pending?[]:draft};
  const metadata={j:Number($('round').value),date:$('matchDate').value};
  const input=selectedMatchId?{...base,...metadata,id:selectedMatchId,revision:selectedRevision}:{...base,...metadata,requestId:newRequestId,a:$('homeTeam').value,b:$('awayTeam').value};
  run(async()=>{state=await api(selectedMatchId?'saveMatch':'createMatch',token,input);selectedMatchId=state.savedMatchId;dirty=false;renderPublic();renderAdmin();notify(pending?'Partido guardado como pendiente.':'Resultado guardado. Posiciones, goles y tarjetas actualizados.');});
}
function resetTeamEditor(){teamEditor=null;$('teamName').value='';$('teamColor').value='#2878d0';$('teamTitle').textContent='1. Inscribir equipo';$('teamSubmit').textContent='Inscribir equipo';$('teamCancel').hidden=true;}
function resetPlayerEditor(){playerEditor=null;$('playerName').value='';$('playerTitle').textContent='2. Inscribir jugadores';$('playerSubmit').textContent='Inscribir jugador';$('playerCancel').hidden=true;}
function editTeam(id){const t=state.teams.find(t=>t.id===id);if(!t)return;if(teamEditor&&!confirm('¿Descartar la edición del equipo anterior?'))return;teamEditor={id:t.id,revision:t.revision};$('teamName').value=t.name;$('teamColor').value=t.color;$('teamTitle').textContent='Editar equipo';$('teamSubmit').textContent='Guardar equipo';$('teamCancel').hidden=false;$('teamForm').scrollIntoView({behavior:'smooth'});$('teamName').focus();}
function editPlayer(id){const p=state.players.find(p=>p.id===id);if(!p)return;if(playerEditor&&!confirm('¿Descartar la edición del jugador anterior?'))return;playerEditor={id:p.id,revision:p.revision};$('playerName').value=p.name;$('playerTeam').value=p.team;$('playerTitle').textContent='Editar jugador';$('playerSubmit').textContent='Guardar jugador';$('playerCancel').hidden=false;$('playerForm').scrollIntoView({behavior:'smooth'});$('playerName').focus();}
function removeEntity(kind,id){
  const list=kind==='Team'?state.teams:kind==='Player'?state.players:state.matches,entity=list.find(x=>x.id===id);if(!entity)return;
  const label=kind==='Match'?`${teamName(entity.a)} vs. ${teamName(entity.b)} · Jornada ${entity.j}`:entity.name;
  const consequence=kind==='Match'?' Se eliminarán también todos sus goles y tarjetas y se recalcularán los acumulados.':kind==='Team'?' Solo se permite si no tiene jugadores ni partidos.':' Solo se permite si no tiene goles ni tarjetas vigentes.';
  if(!confirm(`¿Eliminar ${label}?${consequence} Esta acción no se puede deshacer.`))return;
  if(dirty&&!confirm('Hay cambios de partido sin guardar. ¿Descartarlos para eliminar este registro?'))return;
  run(async()=>{state=await api('delete'+kind,token,{id,revision:entity.revision});dirty=false;if(kind==='Match'&&selectedMatchId===id)selectedMatchId='';if(kind==='Team'&&teamEditor?.id===id)resetTeamEditor();if(kind==='Player'&&playerEditor?.id===id)resetPlayerEditor();renderPublic();renderAdmin();notify(state.warning||'Registro eliminado. Los acumulados se actualizaron.',!!state.warning);});
}
if(typeof document!=='undefined'){
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));$('refresh').onclick=()=>refresh(true);
  $('loginForm').onsubmit=e=>{e.preventDefault();run(async()=>{await api('login',$('password').value);$('password').value='';token='session';state=await api('getData');renderPublic();renderAdmin();notify('Sesión de administrador iniciada.');});};
  $('logout').onclick=()=>{if((dirty||teamEditor||playerEditor)&&!confirm('¿Cerrar sesión y descartar los cambios sin guardar?'))return;run(async()=>{await api('logout',token);token='';dirty=false;resetTeamEditor();resetPlayerEditor();renderAdmin();renderPublic();notify('Sesión cerrada.');});};
  $('teamForm').onsubmit=e=>{e.preventDefault();const editing=!!teamEditor;run(async()=>{state=await api(editing?'updateTeam':'addTeam',token,{...teamEditor,name:$('teamName').value,color:$('teamColor').value});resetTeamEditor();renderPublic();renderAdmin();if(dirty){syncDraft();renderDraft();}notify(editing?'Equipo actualizado.':'Equipo inscrito.');});};
  $('playerForm').onsubmit=e=>{e.preventDefault();const editing=!!playerEditor;run(async()=>{state=await api(editing?'updatePlayer':'addPlayer',token,{...playerEditor,name:$('playerName').value,team:$('playerTeam').value});resetPlayerEditor();renderPublic();renderAdmin();if(dirty){syncDraft();draft=draft.filter(d=>state.players.some(p=>p.id===d.playerId&&selectedTeams().includes(p.team)));renderDraft();}notify(editing?'Jugador actualizado.':'Jugador inscrito. Ya puedes seleccionarlo en sus partidos.');});};
  $('teamCancel').onclick=resetTeamEditor;$('playerCancel').onclick=resetPlayerEditor;
  $('teamList').onclick=e=>{const edit=e.target.closest('[data-edit-team]'),del=e.target.closest('[data-delete-team]');if(edit)editTeam(edit.dataset.editTeam);else if(del)removeEntity('Team',del.dataset.deleteTeam);};
  $('roster').onclick=e=>{const edit=e.target.closest('[data-edit-player]'),del=e.target.closest('[data-delete-player]');if(edit)editPlayer(edit.dataset.editPlayer);else if(del)removeEntity('Player',del.dataset.deletePlayer);};
  $('deleteMatch').onclick=()=>removeEntity('Match',selectedMatchId);
  $('matchSelect').onchange=()=>{if(dirty&&!confirm('¿Descartar los cambios del partido?')){$('matchSelect').value=selectedMatchId;return;}loadMatch();};
  ['homeTeam','awayTeam'].forEach(id=>$(id).onchange=()=>{const previous=$(id).dataset.previous||'';if(draft.length&&!confirm('Cambiar los equipos quitará el detalle de jugadores sin guardar. ¿Continuar?')){$(id).value=previous;return;}$(id).dataset.previous=$(id).value;draft=[];dirty=true;renderDraft();});
  $('matchForm').addEventListener('input',()=>dirty=true);
  $('addDetail').onclick=()=>{const id=$('detailPlayer').value;if(!id){notify('Selecciona un jugador de los equipos del partido.',true);return;}syncDraft();draft.push({playerId:id,goals:0,yellow:0,red:0});dirty=true;renderDraft();};
  $('playerDetails').onclick=e=>{const b=e.target.closest('[data-remove]');if(!b)return;syncDraft();draft=draft.filter(d=>d.playerId!==b.dataset.remove);dirty=true;renderDraft();};
  $('matchForm').onsubmit=e=>{e.preventDefault();save();};$('clear').onclick=()=>save(true);
  $('fixtureList').onclick=e=>{if(!token)return;const del=e.target.closest('[data-delete-match]');if(del){removeEntity('Match',del.dataset.deleteMatch);return;}const b=e.target.closest('[data-edit]');if(!b)return;if(dirty&&!confirm('¿Descartar los cambios sin guardar?'))return;showTab('admin');$('matchSelect').value=b.dataset.edit;loadMatch();$('matchForm').scrollIntoView({behavior:'smooth'});};
  window.addEventListener('beforeunload',e=>{if(dirty||teamEditor||playerEditor){e.preventDefault();e.returnValue='';}});
  run(async()=>{const [data,session]=await Promise.all([api('getData'),api('session')]);state=data;token=session.authenticated?'session':'';renderPublic();renderAdmin();$('connection').textContent=`Actualizado: ${new Date().toLocaleTimeString('es-EC')}`;});
  setInterval(()=>{if(!document.hidden&&!dirty)refresh();},30000);
}
if(typeof module!=='undefined')module.exports={standings,playerTotals};
