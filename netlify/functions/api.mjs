import { createHmac, randomUUID } from 'node:crypto';

const COOKIE='__Host-copa_session';
const publicActions=new Set(['getData','login','session']);
const privateActions=new Set(['logout','addTeam','addPlayer','createMatch','saveMatch']);
const expectedArgs={getData:0,session:0,login:1,logout:0,addTeam:1,addPlayer:1,createMatch:1,saveMatch:1};
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
function json(body,status=200,extra={}) { return new Response(JSON.stringify(body),{status,headers:{...headers,...extra}}); }
function sessionToken(request) {
  const cookies=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));
  if(cookies.length!==1)return '';
  const value=cookies[0].slice(COOKIE.length+1);
  return /^[a-zA-Z0-9-]{16,100}$/.test(value)?value:'';
}
function cookie(token,expire=false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${expire?0:3600}`;
}
function endpoint() {
  const value=process.env.APPS_SCRIPT_URL||'';
  try { const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='script.google.com'&&/^\/macros\/s\/[-_a-zA-Z0-9]+\/exec$/.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password)return value; } catch {}
  throw new Error('Configura APPS_SCRIPT_URL en Netlify con el enlace /exec de Apps Script.');
}
export default async function handler(request) {
  if(request.method!=='POST')return json({ok:false,error:'Usa POST para consultar el sistema.'},405,{Allow:'POST'});
  // La cabecera personalizada obliga a preflight en solicitudes de otros sitios.
  // Esta API no habilita CORS y verifica también el origen enviado por el navegador.
  const origin=request.headers.get('origin'),requestOrigin=new URL(request.url).origin;
  if((origin&&origin!==requestOrigin)||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('x-copa-client')!=='web')return json({ok:false,error:'Origen no permitido.'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({ok:false,error:'Se requiere JSON.'},415);
  let text,body;
  try { text=await request.text();if(Buffer.byteLength(text)>100000)return json({ok:false,error:'Registro demasiado grande.'},413);body=JSON.parse(text); } catch {return json({ok:false,error:'Solicitud inválida.'},400);}
  const {action,args}=body||{};
  if((!publicActions.has(action)&&!privateActions.has(action))||!Array.isArray(args)||args.length!==expectedArgs[action])return json({ok:false,error:'Acción o argumentos inválidos.'},400);
  const token=sessionToken(request);
  if(privateActions.has(action)&&!token)return json({ok:false,error:'Inicia sesión como administrador.'},401);
  if(action==='session'&&!token)return json({ok:true,data:{authenticated:false}});
  let url;
  const secret=process.env.NETLIFY_SECRET||'';
  try {url=endpoint();if(secret.length<32)throw new Error('Configura NETLIFY_SECRET en Netlify con el mismo valor de Apps Script.');}
  catch(e){return json({ok:false,error:e.message},503);}
  const forwarded=privateActions.has(action)?[token,...args]:action==='session'?[token]:args;
  const payload=JSON.stringify({action,args:forwarded}),timestamp=Date.now(),nonce=randomUUID();
  const signature=createHmac('sha256',secret).update(`${timestamp}.${nonce}.${payload}`,'utf8').digest('hex');
  let result;
  try {
    const upstream=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,nonce,payload,signature}),redirect:'follow',signal:AbortSignal.timeout(24000)});
    if(!upstream.ok)throw new Error('upstream');
    result=await upstream.json();
    if(!result||typeof result.ok!=='boolean')throw new Error('invalid response');
  } catch {return json({ok:false,error:'No se pudo conectar con Google Sheets. Revisa el enlace /exec, los permisos de acceso público y la última implementación de Apps Script. Si estabas guardando, pulsa Actualizar para comprobar el registro antes de repetirlo.'},502);}
  if(!result.ok) {
    const message=typeof result.error==='string'?result.error:'No se pudo completar la operación.';
    const expired=/Sesión vencida|Inicia sesión/.test(message);
    if(action==='session'&&expired)return json({ok:true,data:{authenticated:false}},200,{'Set-Cookie':cookie('',true)});
    return json({ok:false,error:message},expired?401:400,expired?{'Set-Cookie':cookie('',true)}:{});
  }
  if(action==='login') {
    if(typeof result.data?.token!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(result.data.token))return json({ok:false,error:'Respuesta de sesión inválida.'},502);
    return json({ok:true,data:{authenticated:true}},200,{'Set-Cookie':cookie(result.data.token)});
  }
  if(action==='logout')return json({ok:true,data:true},200,{'Set-Cookie':cookie('',true)});
  return json({ok:true,data:result.data});
}
