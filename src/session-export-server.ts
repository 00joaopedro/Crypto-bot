import { createServer,type Server,type IncomingMessage } from 'node:http';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash,timingSafeEqual } from 'node:crypto';
import { createSessionCookie,sessionExpires } from './dashboard-session.js';
const files=['checkpoint.json','public-coverage.json'] as const;
const shell=(content:string)=>`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arquivos da sessão48h</title><style>body{font:16px system-ui;background:#10151e;color:#ecf0f5;max-width:520px;margin:40px auto;padding:20px}input,button,a{font:inherit;padding:12px;margin:10px 0;display:block}a{color:#8abaff}input{max-width:90%}small{color:#aab6c5}</style><h1>Arquivos da sessão48h</h1>${content}</html>`;
/** Read-only exporter, independent of bot/runtime/account clients. Never starts or resumes a session. */
export async function startSessionExport(options:{directory:string;password:string;sessionSecret:string;port:number;host?:string}):Promise<Server>{
 if(options.password.length<8||options.sessionSecret.length<32)throw new Error('Dedicated dashboard authentication must be configured');
 const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');res.setHeader('referrer-policy','no-referrer');res.setHeader('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  const reply=(status:number,content:string)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8'});res.end(content);};
  try{
   const url=new URL(req.url??'/','http://localhost');
   if(req.method==='GET'&&url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end('{"status":"read_only_export","ordersSent":0}');return;}
   if(req.method==='POST'&&url.pathname==='/login'){
    let validOrigin=false;try{validOrigin=req.headers['sec-fetch-site']!=='cross-site'&&new URL(req.headers.origin??'').host===req.headers.host;}catch{}
    if(!validOrigin){reply(403,'Origem inválida.');return;}
    const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>req.destroy(),15000);
    try{for await(const c of req){const b=Buffer.from(c);size+=b.length;if(size>4096){reply(413,'Formulário muito grande.');return;}chunks.push(b);}}finally{clearTimeout(timer);}
    const password=new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password')??'',digest=(s:string)=>createHash('sha256').update(s).digest();
    if(!timingSafeEqual(digest(password),digest(options.password))){await new Promise(r=>setTimeout(r,250));reply(401,shell('<p>Senha inválida. Volte e tente novamente.</p>'));return;}
    res.setHeader('set-cookie',createSessionCookie(options.sessionSecret));res.writeHead(303,{location:'/'});res.end();return;
   }
   const authenticated=sessionExpires(req.headers.cookie,options.sessionSecret)!==null;
   if(req.method==='GET'&&url.pathname==='/'){
    reply(200,shell(authenticated?'<p>Use os dois links para salvar os arquivos no celular e anexá-los à conversa.</p><a href="/files/checkpoint.json">Baixar checkpoint.json</a><a href="/files/public-coverage.json">Baixar public-coverage.json</a><small>Somente leitura. Este serviço não executa o bot nem inicia outro teste.</small>':'<p>Entre com a mesma senha do painel Crypto Bot.</p><form method="post" action="/login"><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="512"></label><button>Entrar</button></form>'));return;
   }
   if(!authenticated){reply(401,'Entre na página inicial para baixar.');return;}
   const filename=url.pathname.startsWith('/files/')?url.pathname.slice(7):'';
   if(req.method!=='GET'||!files.includes(filename as typeof files[number])){reply(404,'Arquivo indisponível.');return;}
   let handle;try{handle=await open(join(options.directory,filename),constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>16*1024*1024){await handle.close();reply(404,'Arquivo indisponível.');return;}res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="${filename}"`,'content-length':stat.size});const stream=handle.createReadStream();stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}catch{await handle?.close().catch(()=>undefined);if(!res.headersSent)reply(404,'Arquivo indisponível.');else res.destroy();}
  }catch{if(!res.headersSent)reply(400,'Não foi possível processar a solicitação.');else res.destroy();}
 });
 server.requestTimeout=20000;server.headersTimeout=15000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host??'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});return server;
}
