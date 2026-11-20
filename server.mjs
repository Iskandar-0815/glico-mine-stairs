import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {randomBytes} from 'node:crypto';
import {GameError,createRoom,joinRoom,authenticate,snapshot,touch,act} from './game-core.mjs';
const root=dirname(fileURLToPath(import.meta.url)),dataPath=join(process.env.GLICO_DATA_DIR||join(root,'.runtime'),'rooms.json');
const rooms=new Map(),watchers=new Map();
let persistQueue=Promise.resolve();
try{const saved=JSON.parse(await readFile(dataPath,'utf8'));for(const room of saved){if(Date.now()-room.updatedAt<86400000){for(const p of room.players)p.lastSeen=0;rooms.set(room.code,room)}}}catch(e){if(e.code!=='ENOENT')console.error('房间存档未载入：',e.message)}
function persist(){const data=JSON.stringify([...rooms.values()]);persistQueue=persistQueue.catch(()=>{}).then(async()=>{await mkdir(dirname(dataPath),{recursive:true});await writeFile(dataPath+'.tmp',data,{mode:0o600});await rename(dataPath+'.tmp',dataPath)});return persistQueue}
function json(res,status,data){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function notify(room){const pending=watchers.get(room.code);if(pending)for(const done of [...pending])done()}
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let value='';do{value=Array.from(randomBytes(6),n=>chars[n%chars.length]).join('')}while(rooms.has(value));return value}
async function body(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw new GameError('请求过大。',413);parts.push(chunk)}try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw new GameError('请求不是有效的 JSON。')}}
function checkOrigin(req){if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin)}catch{throw new GameError('来源无效。',403)}if(origin.host!==req.headers.host&&origin.origin!==process.env.PUBLIC_ORIGIN)throw new GameError('请从游戏网址内进行操作。',403)}}
const limits=new Map();
function rateLimit(req,path){const now=Date.now(),key=req.socket.remoteAddress+':'+path,old=limits.get(key);if(!old||now-old.start>60000){limits.set(key,{start:now,n:1});return}if(++old.n>90)throw new GameError('操作过于频繁，请稍后重试。',429)}
export const server=http.createServer(async(req,res)=>{
 res.setHeader('Referrer-Policy','no-referrer');
 try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path.startsWith('/api/')){
   checkOrigin(req);
   if(req.method==='POST')rateLimit(req,path.endsWith('/actions')?'actions':path);
   if(path==='/api/config'){const host=req.headers.host||'127.0.0.1:8787';let joinOrigin=(req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'https':'http')+'://'+host;if(/^(localhost|127\.0\.0\.1)(:|$)/.test(host)){const adapters=Object.entries(networkInterfaces()).filter(([name])=>!/virtual|vethernet|wsl|docker|loopback|vpn/i.test(name));const address=adapters.flatMap(([,entries])=>entries||[]).find(n=>n.family==='IPv4'&&!n.internal);if(address)joinOrigin='http://'+address.address+':'+(req.socket.localPort||8787)}json(res,200,{joinOrigin:process.env.PUBLIC_ORIGIN||joinOrigin});return}
   if(path==='/api/health'){json(res,200,{ok:true,app:'glico-online'});return}
   if(path==='/api/rooms'&&req.method==='POST'){
    if(rooms.size>=1000)throw new GameError('房间数量已满，请稍后重试。',503);
    const input=await body(req),room=createRoom(code(),input.name);rooms.set(room.code,room);await persist();
    json(res,201,{token:room.players[0].token,state:snapshot(room,room.players[0])});return;
   }
   const match=path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|state|actions)$/);
   if(!match)throw new GameError('接口不存在。',404);
   const room=rooms.get(match[1]);if(!room)throw new GameError('房间不存在或已过期，请重新创建。',404);
   if(match[2]==='join'&&req.method==='POST'){const input=await body(req),p=joinRoom(room,input.name);touch(room);await persist();notify(room);json(res,200,{token:p.token,state:snapshot(room,p)});return}
   const p=authenticate(room,String(req.headers.authorization||'').replace(/^Bearer /,''));
   if(match[2]==='state'&&req.method==='GET'){
    const since=Number(url.searchParams.get('since'));
    if(since===room.revision){
     await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);watchers.get(room.code)?.delete(done);res.off('close',done);resolve()};if(!watchers.has(room.code))watchers.set(room.code,new Set());watchers.get(room.code).add(done);timer=setTimeout(done,10000);res.on('close',done)});
    }
    if(!res.destroyed)json(res,200,{state:snapshot(room,p)});return;
   }
   if(match[2]==='actions'&&req.method==='POST'){const input=await body(req);if(act(room,p,input)){await persist();notify(room)}json(res,200,{state:snapshot(room,p)});return}
   throw new GameError('请求方法无效。',405);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')throw new GameError('请求方法无效。',405);
  const file=path==='/'||path==='/index.html'?'index.html':(['/online.js','/rules.cjs'].includes(path)?path.slice(1):null);
  if(!file){res.writeHead(404);res.end();return}
  const content=await readFile(join(root,file));
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});
  res.end(req.method==='HEAD'?undefined:content);
 }catch(e){json(res,e.status||500,{error:e instanceof GameError?e.message:'服务器暂时出错，请稍后重试。'});if(!(e instanceof GameError))console.error(e)}
});
setInterval(()=>{const cutoff=Date.now()-86400000;for(const [key,room] of rooms)if(room.updatedAt<cutoff){rooms.delete(key);notify(room)}for(const[key,value]of limits)if(Date.now()-value.start>60000)limits.delete(key)},60000).unref();
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||8787),host=process.env.HOST||'0.0.0.0';
 server.listen(port,host,()=>{console.log('\n地雷格力高 · 双人联机服务器\n本机：http://127.0.0.1:'+port);for(const entries of Object.values(networkInterfaces()))for(const net of entries||[])if(net.family==='IPv4'&&!net.internal)console.log('同一网络：http://'+net.address+':'+port);console.log('\n双方打开同一个网址，由一方创建房间，另一方输入邀请码加入。\n关闭此窗口会停止联机服务。按 Ctrl+C 停止。\n')});
}
