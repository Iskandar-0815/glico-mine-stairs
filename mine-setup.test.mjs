import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRoom,joinRoom,snapshot,act} from './game-core.mjs';
class Element{
 constructor(){this.children=[];this.style={};this.dataset={};this.attributes={};this.handlers={};this.hidden=false;this.disabled=false;this.value='';this.classList={add(){},remove(){}}}
 set innerHTML(value){this.html=value;this.children=[]}get innerHTML(){return this.html||''}
 appendChild(value){this.children.push(value)}setAttribute(name,value){this.attributes[name]=value}
 addEventListener(name,handler){this.handlers[name]=handler}
 querySelector(){return null}
}
async function fixture(){
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8'),original=await readFile(new URL('./online.js',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]),nodes=new Map(ids.map(id=>[id,new Element()]));
 const game=createRoom('ABC234','甲');joinRoom(game,'乙');const [a,b]=game.players,calls=[];
 const fetch=async(path,options)=>{const input=JSON.parse(options.body);calls.push(input);act(game,a,input);return {ok:true,json:async()=>({state:snapshot(game,a)})}};
 const cut=original.lastIndexOf('(async()=>');assert.ok(cut>0);
 const source=original.slice(0,cut)+'globalThis.client={chooseMine,cancelMine,confirmMines,getSelection:()=>[...selection],load:value=>{identity={code:value.code,token:"test-token"};accept(value)}};})();';
 const context={document:{getElementById:id=>nodes.get(id),createElement:()=>new Element()},location:{protocol:'http:',origin:'http://example.test',search:''},sessionStorage:{getItem(){return null},setItem(){}},requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout,AbortController,URLSearchParams,fetch,Math,crypto:{randomUUID}};
 vm.runInNewContext(await readFile(new URL('./rules.cjs',import.meta.url),'utf8'),context);
 vm.runInNewContext(source,context);const client=context.client;client.load(snapshot(game,a));
 return {client,nodes,game,a,b,calls};
}
const event=()=>({preventDefault(){}});
test('three draft mines do not submit; click preserves selection and double-click cancels',async()=>{
 const{client,nodes,a,calls}=await fixture();
 assert.equal(nodes.get('confirmMines').disabled,true);
 client.chooseMine(1);client.chooseMine(2);client.chooseMine(3);
 assert.equal(client.getSelection().length,3);assert.equal(calls.length,0);assert.equal(a.minesReady,false);assert.equal(nodes.get('confirmMines').disabled,false);
 client.chooseMine(4);assert.equal(client.getSelection().length,3);
 const row=nodes.get('ladder').children.find(node=>Number(node.dataset.level)===3);
 row.handlers.click();row.handlers.click();
 assert.equal(nodes.get('ladder').children.find(node=>Number(node.dataset.level)===3),row,'single clicks must not replace an already-selected row before dblclick');
 row.handlers.dblclick(event());
 assert.equal(client.getSelection().includes(3),false);assert.equal(nodes.get('confirmMines').disabled,true);assert.equal(calls.length,0);
 nodes.get('mineSlots').children[0].handlers.dblclick(event());assert.equal(client.getSelection().length,1);
});

test('local computer match uses the lobby, survives refresh, settles draws and supports rematch',async()=>{
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 const scripts=[];
 for(const tag of html.matchAll(/<script src="([^"]+)"/g)){
  scripts.push(await readFile(new URL(tag[1],import.meta.url),'utf8'));
 }
 const saved=new Map(),requests=[];
 function openPage(href='file:///game/index.html'){
  const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const context={
   location:new URL(href),history:{replaceState(){}},URL,URLSearchParams,
   document:{getElementById:id=>nodes.get(id),createElement:()=>new Element()},
   sessionStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},
   crypto:{randomUUID},Math:Object.assign(Object.create(Math),{random:()=>0}),
   fetch:async path=>{requests.push(path);return {ok:true,json:async()=>({})}},
   requestAnimationFrame:fn=>fn(),AbortController,setTimeout,clearTimeout
  };
  for(const script of scripts)vm.runInNewContext(script,context);
  return id=>nodes.get(id);
 }
 let node=openPage();
 const click=id=>node(id).handlers.click();
 const select=(...levels)=>{for(const level of levels)node('ladder').children.find(row=>row.dataset.level===level).handlers.click()};
 const game=()=>JSON.parse(saved.get('glico.computer'));
 const hand=index=>node('handRow').children[index].handlers.click();
 assert.ok(node('createRoom').disabled);
 click('startComputer');assert.equal(node('otherTag').textContent,'CPU');
 assert.equal(node('inviteBlock').hidden,true);assert.deepEqual(game().players[1].mines,[1,2,3]);
 select(1,5,7);assert.equal(game().players[0].minesReady,false);
 await click('confirmMines');assert.equal(game().setupTurn,2);
 select(4);await click('confirmMines');assert.equal(game().phase,'play');
 assert.equal(game().players[1].hand,'rock');
 for(let i=0;i<6;i++)await hand(0);
 assert.equal(game().phase,'play');assert.equal(game().draws,6);
 await hand(2);assert.equal(game().players[0].position,6);
 node=openPage();assert.equal(node('userPosition').textContent,6);
 for(let i=0;i<5;i++)await hand(0);
 assert.equal(game().phase,'advanceChoice');await node('handRow').children[0].handlers.click();
 assert.equal(game().players[0].position,9);
 for(let i=0;i<7;i++)await hand(2);
 assert.equal(game().phase,'finished');assert.equal(game().players[0].position,46);
 await click('rematchButton');assert.equal(game().match,2);assert.equal(game().players[1].minesReady,true);
 select(11,12,13);await click('confirmMines');await hand(1);
 const mineMarker=level=>node('ladder').children.find(row=>row.dataset.level===level).children.find(el=>el.className==='rung-mark');
 assert.equal(node('aiPosition').textContent,3);
 assert.equal(node('aiMineNote').textContent,'对手的地雷：剩余 3 颗');
 assert.equal(mineMarker(3)?.title,'对手已公开的地雷');
 assert.equal(mineMarker(2),undefined);
 node=openPage();assert.equal(mineMarker(3)?.title,'对手已公开的地雷');
 for(let i=0;i<5;i++)await hand(0);
 assert.equal(game().players[1].position,9);assert.equal(game().phase,'play');
 click('backToLobby');assert.equal(node('lobby').hidden,false);
 click('startComputer');assert.equal(node('aiPosition').textContent,9);
 assert.deepEqual(requests,[]);
 node=openPage('https://example.test/?room=ABC234');
 assert.equal(node('roomCode').value,'ABC234');assert.equal(node('lobby').hidden,false);
 assert.equal(node('createRoom').disabled,false);assert.deepEqual(requests,['/api/config']);
});
test('confirmation submits once and locks only this player until the other confirms',async()=>{
 const{client,nodes,game,a,b,calls}=await fixture();client.chooseMine(2);client.chooseMine(4);client.chooseMine(5);
 const submit=nodes.get('confirmMines').handlers.click();await submit;
 assert.equal(calls.length,1);assert.equal(calls[0].type,'mines');assert.deepEqual(a.mines,[2,4,5]);assert.equal(a.minesReady,true);assert.equal(game.phase,'setup');assert.equal(nodes.get('confirmMines').hidden,true);
 client.cancelMine(4);assert.equal(client.getSelection().length,3);await client.confirmMines();assert.equal(calls.length,1);
 act(game,b,{type:'mines',mines:[11,21,31],match:game.match,setupTurn:game.setupTurn,actionId:randomUUID()});client.load(snapshot(game,a));
 assert.equal(game.phase,'play');assert.equal(nodes.get('handRow').hidden,false);assert.equal(nodes.get('handRow').children.length,3);
});
test('collision replacement still needs explicit confirmation and keeps unaffected positions',async()=>{
 const{client,nodes,game,a,b,calls}=await fixture();
 client.chooseMine(4);client.chooseMine(5);client.chooseMine(7);await client.confirmMines();
 act(game,b,{type:'mines',mines:[4,8,9],match:game.match,setupTurn:game.setupTurn,actionId:randomUUID()});client.load(snapshot(game,a));
 assert.equal(game.phase,'setup');assert.equal(client.getSelection().length,2);assert.equal(nodes.get('confirmMines').disabled,true);
 client.cancelMine(5);assert.equal(client.getSelection().includes(5),true);
 client.chooseMine(10);assert.equal(calls.length,1);assert.equal(a.minesReady,false);
 await client.confirmMines();assert.equal(calls.length,2);assert.deepEqual(a.mines,[5,7,10]);assert.equal(a.minesReady,true);
});
