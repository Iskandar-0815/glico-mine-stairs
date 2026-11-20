import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRoom,joinRoom,act,snapshot} from './game-core.mjs';
function setup(){const r=createRoom('ABC234','樱');joinRoom(r,'凛');return r}
function action(r,p,type,extra={}){return act(r,p,{actionId:randomUUID(),type,match:r.match,turn:r.turn,setupTurn:r.setupTurn,...extra})}
function ready(r){action(r,r.players[0],'mines',{mines:[10,20,30]});action(r,r.players[1],'mines',{mines:[11,21,31]})}
function hands(r,a,b){action(r,r.players[0],'hand',{hand:a});action(r,r.players[1],'hand',{hand:b})}
test('mine choices stay private; collision removes only matching positions',()=>{
 const r=setup(),[a,b]=r.players;action(r,a,'mines',{mines:[4,5,7]});
 assert.deepEqual(snapshot(r,b).players[0].mines,[]);assert.equal(snapshot(r,b).players[0].minesReady,true);
 action(r,b,'mines',{mines:[4,8,9]});assert.equal(r.phase,'setup');assert.deepEqual(a.mines,[5,7]);assert.deepEqual(b.mines,[8,9]);assert.equal(r.setupTurn,2);
 assert.throws(()=>action(r,a,'mines',{mines:[2,3,6]}));
 action(r,a,'mines',{mines:[5,7,10]});action(r,b,'mines',{mines:[8,9,11]});assert.equal(r.phase,'play');assert.equal(new Set([...a.mines,...b.mines]).size,6);
 assert.throws(()=>action(r,a,'mines',{mines:[1,2,3]}));
});
test('hands are locked, not revealed early; only winner moves',()=>{
 const r=setup();ready(r);const[a,b]=r.players;
 action(r,a,'hand',{hand:'rock'});const hidden=JSON.stringify(snapshot(r,b));assert.equal(hidden.includes(a.token),false);assert.equal(hidden.includes('"hand":"rock"'),false);assert.equal(snapshot(r,b).lastRound,null);assert.equal(snapshot(r,b).players[0].submitted,true);
 assert.throws(()=>action(r,a,'hand',{hand:'paper'}));action(r,b,'hand',{hand:'scissors'});assert.equal(a.position,3);assert.equal(b.position,0);assert.deepEqual(r.lastRound.hands,['rock','scissors']);assert.equal(r.turn,2);
 hands(r,'scissors','paper');assert.equal(a.position,9);hands(r,'paper','rock');assert.equal(a.position,15);
});
test('five consecutive draws award a round; later play continues; non-draw resets streak',()=>{
 const r=setup();ready(r);const[a,b]=r.players;hands(r,'paper','rock');
 for(let i=0;i<4;i++)hands(r,'rock','rock');assert.equal(r.draws,4);
 hands(r,'paper','rock');assert.equal(r.draws,0);assert.equal(a.position,12);
 for(let i=0;i<5;i++)hands(r,'rock','rock');assert.equal(r.phase,'advanceChoice');assert.equal(r.choiceWinner,a.id);assert.equal(a.position,12);assert.equal(b.position,0);
 assert.throws(()=>action(r,b,'advance',{steps:6}));assert.throws(()=>action(r,a,'advance',{steps:4}));
 action(r,a,'advance',{steps:3});assert.equal(a.position,15);assert.equal(b.position,0);assert.equal(r.phase,'play');assert.equal(r.draws,0);
});
test('untouched starting-square exception continues beyond five; returned start does not qualify',()=>{
 const r=setup();ready(r);for(let i=0;i<8;i++)hands(r,'rock','rock');assert.equal(r.phase,'play');assert.equal(r.draws,8);
 hands(r,'paper','rock');assert.equal(r.players[0].position,6);assert.equal(r.draws,0);
 const q=setup();ready(q);q.players[1].mines=[6,16,26];hands(q,'paper','rock');assert.equal(q.players[0].position,0);assert.equal(q.players[0].advanced,true);
 for(let i=0;i<5;i++)hands(q,'rock','rock');assert.equal(q.phase,'advanceChoice');assert.equal(q.choiceWinner,q.players[1].id);
});
test('same position uses arrival time',()=>{
 const r=setup();ready(r);const[a,b]=r.players;a.position=b.position=12;a.advanced=b.advanced=true;a.arrival=5;b.arrival=2;r.clock=5;
 for(let i=0;i<5;i++)hands(r,'rock','rock');assert.equal(r.choiceWinner,b.id);action(r,b,'advance',{steps:6});assert.equal(b.position,18);assert.equal(a.position,12);
});
test('one landing chains through three enemy mines and none can trigger on a revisit',()=>{
 const r=setup(),[a,b]=r.players;
 action(r,a,'mines',{mines:[5,7,9]});action(r,b,'mines',{mines:[13,23,33]});
 a.position=27;hands(r,'paper','rock');
 assert.equal(a.position,3);assert.deepEqual(b.revealed,[33,23,13]);
 for(const viewer of [a,b]){
  const info=snapshot(r,viewer).players[1];
  assert.equal(info.mineCount,0);assert.deepEqual(info.mines,[]);
 }
 a.position=27;hands(r,'paper','rock');
 assert.equal(a.position,33);assert.deepEqual(b.revealed,[33,23,13]);
});
test('a chain stops on an own mine which stays public until the opponent lands there',()=>{
 const r=setup(),[a,b]=r.players;
 action(r,a,'mines',{mines:[3,5,8]});action(r,b,'mines',{mines:[13,23,33]});
 a.position=17;hands(r,'scissors','paper');
 assert.equal(a.position,3);assert.deepEqual(b.revealed,[23,13]);assert.deepEqual(a.revealed,[3]);
 assert.deepEqual(snapshot(r,a).players[0].mines,[3,5,8]);
 assert.deepEqual(snapshot(r,a).players[1].mines,[]);
 assert.deepEqual(snapshot(r,b).players[1].mines,[33]);
 assert.deepEqual(snapshot(r,b).players[0].mines,[3]);
 assert.equal(snapshot(r,b).players[0].mineCount,3);
 const saved=JSON.parse(JSON.stringify(r));
 const [owner,opponent]=saved.players;
 owner.position=0;hands(saved,'rock','scissors');
 assert.equal(owner.position,3);assert.deepEqual(owner.revealed,[3]);
 assert.equal(snapshot(saved,opponent).players[0].mineCount,3);
 hands(saved,'scissors','rock');
 assert.equal(opponent.position,0);assert.deepEqual(owner.mines,[5,8]);
 assert.deepEqual(snapshot(saved,opponent).players[0].mines,[]);
 hands(saved,'scissors','rock');assert.equal(opponent.position,3);
 const restored=JSON.parse(JSON.stringify(saved));
 restored.players[0].position=17;hands(restored,'scissors','paper');
 assert.equal(restored.players[0].position,23);
 assert.deepEqual(restored.players[1].revealed,[23,13]);
});
test('a five-draw advance can trigger a chain to the start, while passed mines remain active',()=>{
 const r=setup(),[a,b]=r.players;
 action(r,a,'mines',{mines:[9,10,11]});action(r,b,'mines',{mines:[5,15,14]});
 a.position=9;a.arrival=1;a.advanced=true;r.clock=1;
 for(let i=0;i<5;i++)hands(r,'rock','rock');
 action(r,a,'advance',{steps:6});assert.equal(a.position,0);
 assert.deepEqual(b.revealed,[15,5]);assert.deepEqual(snapshot(r,b).players[1].mines,[14]);
 assert.deepEqual(a.revealed,[]);
 a.position=9;hands(r,'paper','rock');assert.equal(a.position,15);
});
test('goal is the only final victory; idempotency, stale rounds and mutual rematch',()=>{
 const r=setup();ready(r);const[a,b]=r.players;
 const input={actionId:randomUUID(),match:r.match,turn:r.turn,type:'hand',hand:'paper'};act(r,a,input);assert.equal(act(r,a,input),false);action(r,b,'hand',{hand:'rock'});assert.throws(()=>act(r,a,{...input,actionId:randomUUID()}));
 a.position=43;hands(r,'rock','scissors');assert.equal(r.phase,'finished');assert.equal(r.winner,a.id);
 action(r,a,'rematch');assert.equal(r.phase,'finished');action(r,b,'rematch');assert.equal(r.phase,'setup');assert.equal(r.match,2);assert.equal(a.position,0);assert.equal(a.advanced,false);assert.equal(a.token.length>30,true);
});
test('two independent HTTP clients, privacy, authentication, long polling and disk recovery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glico-test-'));process.env.GLICO_DATA_DIR=directory;
 let server;try{
 ({server}=await import('./server.mjs?test='+Date.now()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base='http://127.0.0.1:'+server.address().port;
 const request=async(path,token,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:response.headers.get('content-type')?.includes('json')?await response.json():await response.text()}};
 const host=await request('/api/rooms',null,{name:'甲'});assert.equal(host.status,201);const code=host.data.state.code,aToken=host.data.token;
 const guest=await request('/api/rooms/'+code+'/join',null,{name:'乙'});assert.equal(guest.status,200);const bToken=guest.data.token;
 assert.equal((await request('/api/rooms/'+code+'/join',null,{name:'第三人'})).status,409);
 assert.equal((await request('/api/rooms/'+code+'/state','invalid')).status,401);
 assert.equal((await request('/.runtime/rooms.json')).status,404);
 const send=async(token,type,extra={})=>{const view=(await request('/api/rooms/'+code+'/state',token)).data.state;return request('/api/rooms/'+code+'/actions',token,{type,actionId:randomUUID(),match:view.match,turn:view.turn,setupTurn:view.setupTurn,...extra})};
 await send(aToken,'mines',{mines:[10,20,30]});let other=(await request('/api/rooms/'+code+'/state',bToken)).data.state;assert.deepEqual(other.players[0].mines,[]);
 await send(bToken,'mines',{mines:[11,21,31]});await send(aToken,'hand',{hand:'rock'});other=(await request('/api/rooms/'+code+'/state',bToken)).data.state;assert.equal(other.lastRound,null);assert.equal(JSON.stringify(other).includes(aToken),false);
 const waiting=request('/api/rooms/'+code+'/state?since='+other.revision,bToken);await send(bToken,'hand',{hand:'scissors'});const resolved=(await waiting).data.state;assert.equal(resolved.rounds,1);assert.equal(resolved.players[0].position,3);
 assert.ok((await request('/')).data.includes('创建双人房间'));assert.ok((await request('/online.js')).data.includes('function chooseMine'));
 await new Promise(resolve=>server.close(resolve));({server}=await import('./server.mjs?recovery='+Date.now()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const restored=(await request('/api/rooms/'+code+'/state',aToken));assert.equal(restored.status,200);assert.equal(restored.data.state.rounds,1);assert.equal(restored.data.state.players[0].position,3);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
});
