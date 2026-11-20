import {spawn} from 'node:child_process';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),bin=join(root,'.tools','cloudflared.exe');
let game=null,tunnel=null,finished=false,publicUrl='';
function stop(){if(finished)return;finished=true;tunnel?.kill();game?.kill()}
process.on('SIGINT',()=>{stop();process.exit(0)});process.on('SIGTERM',()=>{stop();process.exit(0)});process.on('exit',stop);
async function health(){try{const r=await fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(1500)});const data=await r.json();return data.ok&&data.app==='glico-online'}catch{return false}}
try{
 await access(bin);
 if(!await health()){game=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,HOST:'127.0.0.1'},stdio:'inherit',windowsHide:true});for(let i=0;i<30&&!await health();i++)await new Promise(r=>setTimeout(r,200));if(!await health())throw new Error('游戏服务未能启动，请检查 8787 端口。')}
 tunnel=spawn(bin,['tunnel','--url','http://127.0.0.1:8787','--protocol','http2','--no-autoupdate'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let buffer='';
 const capture=async data=>{const chunk=data.toString();process.stdout.write(chunk);buffer=(buffer+chunk).slice(-24000);const match=buffer.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);if(match&&!publicUrl){publicUrl=match[0];await mkdir(join(root,'.runtime'),{recursive:true});await writeFile(join(root,'公网游戏地址.txt'),'地雷格力高 · 双人联机\n\n'+publicUrl+'\n\n双方打开此网址，由一方创建房间，再将房间邀请码发给朋友。\n本窗口与电脑需保持运行；关闭后网址失效，重新启动会生成新网址。\n','utf8');console.log('\n============================\n公网游戏网址：'+publicUrl+'\n已保存到“公网游戏地址.txt”\n保持此窗口和电脑运行。按 Ctrl+C 停止。\n============================\n')}};
 tunnel.stdout.on('data',capture);tunnel.stderr.on('data',capture);
 tunnel.on('error',error=>{console.error(error.message);stop();process.exitCode=1});tunnel.on('exit',code=>{if(!finished){console.error('公网隧道已关闭，退出码：'+code);stop();process.exitCode=code||0}});
}catch(error){console.error('\n启动失败：'+error.message+'\n若缺少隧道程序，请检查 .tools/cloudflared.exe 是否已下载。\n');stop();process.exitCode=1}
