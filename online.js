(()=>{"use strict";
const noteHz=midi=>440*2**((midi-69)/12);

// A short attack and release keep both the score and the interface sounds click-free.
function synthNote(ctx,bus,time,duration,hz,wave,volume,endHz=hz,attack=.006){
 const osc=ctx.createOscillator(),env=ctx.createGain();
 if(typeof wave==="string")osc.type=wave;else osc.setPeriodicWave(wave);
 osc.frequency.setValueAtTime(hz,time);
 if(endHz!==hz)osc.frequency.exponentialRampToValueAtTime(endHz,time+duration*.8);
 env.gain.setValueAtTime(0,time);
 env.gain.linearRampToValueAtTime(volume,time+attack);
 env.gain.exponentialRampToValueAtTime(volume*.48,time+duration*.38);
 env.gain.exponentialRampToValueAtTime(.00008,time+duration);
 env.gain.linearRampToValueAtTime(0,time+duration+.004);
 osc.connect(env).connect(bus);
 osc.start(time);osc.stop(time+duration+.005);
}

async function renderSoundtrack(OfflineContext){
 // Sixteen bars in D major at 128 BPM. A high arpeggio answers the second chorus.
 const beat=60/128,step=beat/4,sampleRate=32000,loopLength=16*4*beat;
 const ctx=new OfflineContext(2,Math.ceil((loopLength+.8)*sampleRate),sampleRate);
 const mix=ctx.destination;
 function pan(position){
  if(!ctx.createStereoPanner)return mix;
  const channel=ctx.createStereoPanner();channel.pan.value=position;channel.connect(mix);return channel;
 }
 const keys=pan(-.28),sparkle=pan(.46),lead=pan(.12),echo=pan(-.45);
 const bell=ctx.createPeriodicWave(new Float32Array(8),Float32Array.from([0,1,.24,.18,.02,.09,0,.035]));
 const bass=ctx.createPeriodicWave(new Float32Array(5),Float32Array.from([0,1,.36,.16,.05]));
 const chords=[
  [38,54,57,61,64],[35,54,57,59,62],[43,54,57,59,62],[33,52,57,59,62],
  [42,54,57,61,64],[40,55,59,62,66],[43,54,59,62,64],[33,55,57,61,64]
 ];
 // [sixteenth, MIDI note, length in sixteenths]; space between phrases leaves room for game cues.
 const melody=[
  [[0,78,2],[3,81,1],[6,83,3],[11,81,1],[13,78,2]],
  [[2,74,2],[5,78,1],[8,81,3],[14,78,1]],
  [[0,79,2],[3,78,1],[6,74,2],[10,71,3]],
  [[2,76,2],[6,74,1],[8,73,4],[14,76,1]],
  [[0,78,2],[3,81,1],[6,85,3],[11,83,1],[13,81,2]],
  [[0,79,3],[5,78,1],[8,76,3],[13,74,2]],
  [[2,71,2],[5,74,1],[8,78,3],[12,76,2]],
  [[0,73,3],[6,76,2],[10,81,2],[14,73,1]]
 ];
 const noise=ctx.createBuffer(1,Math.ceil(sampleRate*.2),sampleRate);
 const samples=noise.getChannelData(0);
 let seed=419;
 for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=seed/2147483648-1}
 function noiseHit(time,length,frequency,volume){
  const hit=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),env=ctx.createGain();
  hit.buffer=noise;filter.type="highpass";filter.frequency.value=frequency;
  env.gain.setValueAtTime(0,time);env.gain.linearRampToValueAtTime(volume,time+.003);
  env.gain.exponentialRampToValueAtTime(.0001,time+length);
  hit.connect(filter).connect(env).connect(mix);hit.start(time);hit.stop(time+length);
 }
 for(let bar=0;bar<16;bar++){
  const phrase=bar%8,answer=bar>=8,start=bar*4*beat;
  const [root,...chord]=chords[phrase];
  for(const slot of [0,8, ...(phrase%2?[11]:[])]){
   synthNote(ctx,mix,start+slot*step,.20,155,"sine",slot===11 ? .16 : .28,44);
  }
  for(const slot of [4,12]){
   noiseHit(start+slot*step,.115,1250,.105);
   synthNote(ctx,mix,start+slot*step,.10,205,"sine",.095,125);
  }
  for(let slot=2;slot<16;slot+=4)noiseHit(start+slot*step,slot===14 ? .092 : .055,6700,.065);
  if(answer&&phrase%2)noiseHit(start+15*step,.038,7300,.04);
  for(const [slot,interval,length] of [[0,0,2.7],[3,12,1],[6,7,1.5],[8,0,2.8],[12,7,1.6],[15,12,.8]]){
   synthNote(ctx,mix,start+slot*step,length*step,noteHz(root+interval),bass,.17);
  }
  for(const slot of [2,10])for(const pitch of chord){
   synthNote(ctx,keys,start+slot*step,.30,noteHz(pitch),"triangle",.045);
  }
  for(const [slot,pitch,length] of melody[phrase]){
   const when=start+slot*step;
   synthNote(ctx,lead,when,length*step+.10,noteHz(pitch),bell,.16);
   synthNote(ctx,echo,when+3*step,.22,noteHz(pitch),"sine",.035);
  }
  if(answer){
   for(const [i,slot] of [1,7,11,15].entries()){
    synthNote(ctx,sparkle,start+slot*step,.18,noteHz(chord[i]+24),"sine",.042);
   }
  }
 }
 const buffer=await ctx.startRendering(),frames=Math.round(loopLength*sampleRate);
 // Fold the last delay taps into the downbeat so that the seam has a natural tail.
 for(let ch=0;ch<buffer.numberOfChannels;ch++){
  const data=buffer.getChannelData(ch);
  for(let i=frames;i<data.length;i++)data[i-frames]+=data[i];
 }
 return {buffer,loopLength};
}

function createGameAudio(){
 const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
 const OfflineContext=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
 let ctx,musicBus,fxBus,score;
 let preferences={music:true,effects:true};
 try{
  const saved=JSON.parse(localStorage.getItem("glico.audio"));
  if(saved)preferences={music:saved.music!==false,effects:saved.effects!==false};
 }catch{}
 function updateButtons(){
  for(const [key,id,label,supported] of [["music","musicToggle","♫ 音乐",Context&&OfflineContext],["effects","soundToggle","♪ 音效",Context]]){
   const button=document.getElementById(id);
   const on=!!supported&&preferences[key];
   button.disabled=!supported;
   button.textContent=label+"："+(supported?(on?"开":"关"):"不可用");
   button.setAttribute("aria-pressed",String(on));
  }
 }
 function sync(){
  if(!ctx)return;
  const now=ctx.currentTime;
  musicBus.gain.setTargetAtTime(preferences.music ? .46 : 0,now,.024);
  fxBus.gain.setTargetAtTime(preferences.effects ? .83 : 0,now,.012);
  if(document.hidden||(!preferences.music&&!preferences.effects)){
   ctx.suspend().catch(()=>{});
   return;
  }
  ctx.resume().catch(()=>{});
  if(preferences.music&&OfflineContext&&!score){
   score=renderSoundtrack(OfflineContext).then(({buffer,loopLength})=>{
    const loopSource=ctx.createBufferSource();loopSource.buffer=buffer;
    loopSource.loop=true;loopSource.loopEnd=loopLength;
    loopSource.connect(musicBus);loopSource.start();
   }).catch(()=>{score=null;preferences.music=false;updateButtons()});
  }
 }
 function activate(){
  if(!Context||document.hidden||(!preferences.music&&!preferences.effects))return;
  if(ctx&&ctx.state==="running")return;
  if(!ctx){
   try{
    ctx=new Context();musicBus=ctx.createGain();fxBus=ctx.createGain();
    musicBus.gain.value=0;fxBus.gain.value=0;
    musicBus.connect(ctx.destination);fxBus.connect(ctx.destination);
   }catch{return}
  }
  sync();
 }
 // Each cue is a small phrase: [offset in seconds, MIDI pitch, duration, optional glide target].
 const cues={
  place:[[0,83,.09],[.042,90,.10]],cancel:[[0,83,.075,72]],
  confirm:[[0,71,.09],[.05,78,.10],[.10,83,.13]],
  hand:[[0,62,.075,81]],ready:[[0,74,.13],[.09,81,.14],[.18,86,.24]],
  redraw:[[0,78,.12,73],[.14,78,.12,73]],draw:[[0,74,.11],[.12,74,.12]],
  win:[[0,78,.14],[.075,81,.14],[.15,86,.22]],lose:[[0,74,.14],[.09,69,.21]],
  mine:[[0,49,.26,30],[.031,68,.16,45],[.16,42,.21,31]],
  reveal:[[0,81,.12],[.09,85,.18]],advance:[[0,71,.12],[.09,78,.18]],
  summit:[[0,74,.19],[.09,78,.17],[.18,81,.20],[.30,86,.27],[.53,90,.42]],
  defeat:[[0,78,.18],[.14,76,.20],[.29,74,.35]]
 };
 function play(name,delay=0){
  if(!ctx||!preferences.effects||document.hidden)return;
  const when=ctx.currentTime+.008+delay;
  for(const [offset,note,length,end=note] of cues[name]){
   synthNote(ctx,fxBus,when+offset,length,noteHz(note),name==="mine"?"triangle":"sine",.20,noteHz(end));
   if(["win","summit","ready"].includes(name)){
    synthNote(ctx,fxBus,when+offset+.018,length*.8,noteHz(note+12),"triangle",.045);
   }
  }
 }
 function toggle(key){
  preferences[key]=!preferences[key];
  try{localStorage.setItem("glico.audio",JSON.stringify(preferences))}catch{}
  updateButtons();
  if(ctx)sync();else activate();
  if(key==="effects"&&preferences.effects)play("place");
 }
 updateButtons();
 document.getElementById("musicToggle").addEventListener("click",()=>toggle("music"));
 document.getElementById("soundToggle").addEventListener("click",()=>toggle("effects"));
 if(Context)document.addEventListener("visibilitychange",sync);
 return {activate,play};
}
const $=id=>document.getElementById(id);
const handNames={rock:"拳",scissors:"剪刀",paper:"布"};
const handIcons={"rock":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M9 10H13V8H18V9H23V11H26V15H28V24H25V28H11V25H8V21H5V16H9Z\" fill=\"#f8fbff\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M11 13V18M16 11V18M21 12V18M10 19H22V23H15\" fill=\"none\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M12 25H24V28H12Z\" fill=\"#a9bfe7\"/></svg>","scissors":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M11 16L8 6H12L16 16H18L21 4H25L22 17H25L28 20V24L24 28H13L8 23V19H11Z\" fill=\"#f8fbff\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M12 18H21V22H16L13 25M21 17V22\" fill=\"none\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M14 25H24V28H14Z\" fill=\"#a9bfe7\"/></svg>","paper":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M8 16V7H12V15H14V3H18V14H20V5H24V16H26V10H30V23L25 29H13L5 21V16Z\" fill=\"#f8fbff\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M11 17L15 21M17 18V24M23 18V24\" fill=\"none\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M14 26H25V29H14Z\" fill=\"#a9bfe7\"/></svg>"},uiIcons={"mine":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M10 10H23V13H26V25H23V28H10V25H7V13H10Z\" fill=\"#344a86\"/><path d=\"M12 12H18V15H12ZM10 15H13V20H10Z\" fill=\"#a9bfe7\"/><path d=\"M17 10V6H23V3H27\" fill=\"none\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M25 2H29V6H25Z\" fill=\"#ed65b5\"/></svg>","flag":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M8 4V29M9 5H25V17H9\" fill=\"#f8fbff\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M10 6H15V11H10ZM20 6H24V11H20ZM15 11H20V16H15Z\" fill=\"#a9bfe7\"/><path d=\"M4 29H14\" stroke=\"#344a86\" stroke-width=\"2\"/></svg>","award":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M9 4H24V15L20 21H13L9 15ZM9 7H4V15H10M24 7H29V15H23M16 21V27M10 29H23\" fill=\"#f8fbff\" stroke=\"#344a86\" stroke-width=\"2\"/><path d=\"M14 7H20V15H14Z\" fill=\"#a9bfe7\"/></svg>","balance":"<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" focusable=\"false\" shape-rendering=\"crispEdges\"><path d=\"M16 4V28M5 11H27M7 12L3 21H11ZM25 12L21 21H29ZM10 29H22\" fill=\"#f8fbff\" stroke=\"#344a86\" stroke-width=\"2\"/></svg>"};
const storage={read(key,fallback){try{return JSON.parse(sessionStorage.getItem(key))??fallback}catch{return fallback}},write(key,value){try{sessionStorage.setItem(key,JSON.stringify(value))}catch{}}};
let saved=storage.read("glico.rooms",{}),identity=null,room=null,selection=[],selectionKey="",busy=false,requesting=false,loopId=0,connected=false,joinOrigin=location.origin,boardKey="",boardDrawn=false,shownEnd="";
const gameAudio=createGameAudio();
const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function message(text){$("networkMessage").textContent=text||""}
async function api(path,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);try{const res=await fetch(path,{...options,signal:controller.signal,cache:"no-store",headers:{"Content-Type":"application/json",...(identity?{Authorization:"Bearer "+identity.token}:{}),...options.headers}});const value=await res.json();if(!res.ok)throw Object.assign(new Error(value.error||"请求失败"),{status:res.status});return value}finally{clearTimeout(timer)}}
function me(){return room?.players.find(p=>p.id===room.selfId)}
function opponent(){return room?.players.find(p=>p.id!==room.selfId)}
function keepIdentity(code,token){identity={code,token};saved[code]=identity;storage.write("glico.rooms",saved);storage.write("glico.active",code)}
let computerGame=null;
const computerCode="CPU";
const localRules=createGlicoRules({randomUUID:actionId});

function prepareComputerTurn(game){
 const [human,computer]=game.players;
 const commit=(type,extra)=>localRules.act(game,computer,{
  type,actionId:actionId(),match:game.match,turn:game.turn,setupTurn:game.setupTurn,...extra
 });
 if(game.phase==="advanceChoice"&&game.choiceWinner===computer.id){
  const knownMines=human.mines.filter(level=>human.revealed.includes(level));
  const avoidSix=knownMines.includes(computer.position+6)&&!knownMines.includes(computer.position+3);
  commit("advance",{steps:avoidSix?3:6});
 }
 if(game.phase==="setup"&&!computer.minesReady){
  const mines=[...computer.mines];
  const available=Array.from({length:45},(_,i)=>i+1).filter(n=>!mines.includes(n));
  while(mines.length<3)mines.push(available.splice(Math.floor(Math.random()*available.length),1)[0]);
  commit("mines",{mines});
 }else if(game.phase==="play"&&!computer.hand){
  const hands=["rock","scissors","paper"];
  commit("hand",{hand:hands[Math.floor(Math.random()*hands.length)]});
 }else if(game.phase==="finished"&&!computer.rematch){
  commit("rematch",{});
 }
}
function startComputer(){
 if(busy)return;
 identity=null;
 const savedGame=storage.read("glico.computer",null);
 if(savedGame?.code===computerCode&&savedGame.players?.length===2){
  computerGame=savedGame;
 }else{
  const name=$("playerName").value.trim()||"樱";
  storage.write("glico.name",name);
  computerGame=localRules.createRoom(computerCode,name);
  localRules.joinRoom(computerGame,"凛");
 }
 prepareComputerTurn(computerGame);
 storage.write("glico.computer",computerGame);
 storage.write("glico.active",computerCode);
 message("");
 showGame(localRules.snapshot(computerGame,computerGame.players[0]));
}
function soundForTransition(before,after){
 if(!before||before.match!==after.match)return;
 if(after.phase==="finished"&&before.phase!=="finished"){
  gameAudio.play(after.winner===after.selfId?"summit":"defeat",.10);
  return;
 }
 if(after.setupTurn>before.setupTurn){gameAudio.play("redraw",.12);return}
 if(before.phase==="setup"&&after.phase==="play"){gameAudio.play("ready",.16);return}
 const result=after.lastRound;
 const freshRound=result&&after.rounds>before.rounds;
 if(freshRound)gameAudio.play(result.kind==="draw"?"draw":result.winner===after.selfId?"win":"lose",.085);
 for(const player of after.players){
  const previous=before.players.find(p=>p.id===player.id);
  if(!previous||player.arrival===previous.arrival)continue;
  const enemy=after.players.find(p=>p.id!==player.id);
  const previousEnemy=before.players.find(p=>p.id===enemy.id);
  const hits=previousEnemy.mineCount-enemy.mineCount;
  let delay=freshRound ? .34 : .04;
  for(let i=0;i<hits;i++){gameAudio.play("mine",delay);delay+=.20}
  if(player.mines.includes(player.position))gameAudio.play("reveal",delay);
  else if(!hits&&!freshRound)gameAudio.play("advance",delay);
 }
}
function accept(value){if(value.code!==(computerGame?.code??identity?.code))return;if(room&&value.revision<room.revision)return;const changed=!room||room.revision!==value.revision;if(changed&&connected)soundForTransition(room,value);room=value;const self=me(),key=room.match+":"+room.setupTurn;if(key!==selectionKey||self.minesReady){selection=[...self.mines];selectionKey=key}if(!connected)message("");connected=true;if(changed)render();else renderConnection()}
async function poll(id){while(identity&&id===loopId){try{const result=await api("/api/rooms/"+identity.code+"/state?since="+(room?.revision??-1));if(id!==loopId)return;accept(result.state)}catch(error){if(id!==loopId)return;connected=false;$("connectionStatus").textContent="正在重连";message(error.status===401||error.status===404?error.message:"连接暂时中断，正在自动重连。你的已提交操作和身份会保留。");if(error.status===401||error.status===404){toLobby();return}await new Promise(resolve=>setTimeout(resolve,1500))}}}
function setRoomLink(code){
 if(location.protocol==="file:")return;
 const url=new URL(location.href);
 if(code)url.searchParams.set("room",code);else url.searchParams.delete("room");
 history.replaceState(null,"",url);
}
function showGame(state){
 ++loopId;
 room=null;selectionKey="";boardKey="";boardDrawn=false;shownEnd="";
 $("lobby").hidden=true;$("gameArea").hidden=false;$("roomSession").hidden=false;
 $("connectionStatus").hidden=false;
 for(const id of ["roomCodeBlock","copyCode","copyInvite","inviteBlock"])$(id).hidden=!!computerGame;
 $("copyStatus").textContent="";
 $("modeTitle").textContent=computerGame?"人机对战":"双人联机房间";
 $("arenaTitle").textContent=computerGame?"人机对战 · 登顶挑战":"双人联机 · 好友对战";
 $("otherTag").textContent=computerGame?"CPU":"PLAYER";
 setRoomLink(computerGame?null:state.code);
 accept(state);
}
function begin(data){
 computerGame=null;
 keepIdentity(data.state.code,data.token||identity.token);
 $("roomCode").value=data.state.code;
 showGame(data.state);
 poll(loopId);
}
function entryBusy(value){
 busy=value;
 $("createRoom").disabled=$("joinRoom").disabled=busy||location.protocol==="file:";
 $("startComputer").disabled=busy;
}
async function enter(kind){if(busy)return;entryBusy(true);message("");try{const name=$("playerName").value.trim().slice(0,16)||"玩家";storage.write("glico.name",name);const code=$("roomCode").value.trim().toUpperCase();if(kind==="join"&&!/^[A-Z2-9]{6}$/.test(code))throw new Error("请输入 6 位房间邀请码。");if(kind==="join"&&saved[code]){identity=saved[code];const result=await api("/api/rooms/"+code+"/state");begin({token:identity.token,state:result.state})}else{identity=null;const result=await api(kind==="create"?"/api/rooms":"/api/rooms/"+code+"/join",{method:"POST",body:JSON.stringify({name})});begin(result)}}catch(error){identity=null;message(error.message)}finally{entryBusy(false)}}
function toLobby(){
 loopId++;identity=null;room=null;computerGame=null;requesting=false;connected=false;
 storage.write("glico.active",null);setRoomLink(null);
 $("lobby").hidden=false;$("gameArea").hidden=true;$("roomSession").hidden=true;
 $("modeTitle").textContent="选择对战模式";$("connectionStatus").hidden=true;
 $("startComputer").textContent=storage.read("glico.computer",null)?"继续人机对战":"开始人机对战";
 $("modalBackdrop").classList.remove("show");
}
function actionId(){return globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)+"-"+Math.random().toString(36).slice(2)}
async function send(type,extra={}){
 if(requesting||!room)return;
 gameAudio.activate();
 if(type==="hand")gameAudio.play("hand");
 if(type==="mines")gameAudio.play("confirm");
 const payload={type,actionId:actionId(),match:room.match,turn:room.turn,setupTurn:room.setupTurn,...extra};
 if(computerGame){
  const human=computerGame.players[0];
  localRules.act(computerGame,human,payload);
  prepareComputerTurn(computerGame);
  storage.write("glico.computer",computerGame);
  accept(localRules.snapshot(computerGame,human));
  return;
 }
 const session=loopId,path="/api/rooms/"+identity.code;
 requesting=true;message("");render();
 try{
  const result=await api(path+"/actions",{method:"POST",body:JSON.stringify(payload)});
  if(session===loopId)accept(result.state);
 }catch(error){
  if(session!==loopId)return;
  message(error.message);
  try{const result=await api(path+"/state");if(session===loopId)accept(result.state)}catch{}
 }finally{if(session===loopId){requesting=false;render()}}
}
function editableMines(){const self=me();return !!room&&room.phase==="setup"&&!self.minesReady&&!requesting}
function chooseMine(level){if(!editableMines()||!Number.isInteger(level)||level<1||level>45||selection.includes(level)||selection.length>=3)return;selection.push(level);gameAudio.activate();gameAudio.play("place");render()}
function cancelMine(level){if(!editableMines()||me().mines.includes(level)||!selection.includes(level))return;selection=selection.filter(n=>n!==level);gameAudio.activate();gameAudio.play("cancel");render()}
function confirmMines(){if(!editableMines()||selection.length!==3)return;return send("mines",{mines:[...selection]})}
function renderConnection(){const other=opponent();$("connectionStatus").textContent=computerGame?"本机对局":connected?"已连接":"正在重连";$("opponentPresence").textContent=computerGame?"电脑对手 · 凛":!other?"等待加入":other.connected?"对手在线":"对手暂离 · 等待重连"}
function renderBoard(){const self=me(),other=opponent(),ladder=$("ladder"),scroll=ladder.scrollTop,key=room.match+":"+self.position+":"+(other?.position??0),posChanged=boardKey!==key;ladder.innerHTML="";
for(let level=46;level>=0;level--){const row=document.createElement("div");row.className="rung";row.dataset.level=level;row.setAttribute("aria-label",level+" 级");const allowed=room.phase==="setup"&&!self.minesReady&&!requesting&&level>0&&level<46&&!self.mines.includes(level);if(allowed){row.classList.add("rung-selectable");row.setAttribute("role","button");row.tabIndex=0;row.setAttribute("aria-label",level+" 级，"+(selection.includes(level)?"已选择":"选择")+"埋雷");row.addEventListener("click",()=>chooseMine(level));row.addEventListener("dblclick",event=>{event.preventDefault();cancelMine(level)});row.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();selection.includes(level)?cancelMine(level):chooseMine(level)}else if(["Delete","Backspace"].includes(event.key)){event.preventDefault();cancelMine(level)}});row.setAttribute("aria-pressed",String(selection.includes(level)));if(selection.includes(level))row.title="双击取消此处埋雷；键盘可按 Enter 或 Delete 取消"}
row.innerHTML='<span class="rung-num">'+(level===46?"顶":level===0?"起":level)+'</span><span class="rung-center"></span><span class="rung-num">'+(level===46?"46":level===0?"点":"")+'</span>';
const ownMarker=(room.phase==="setup"&&selection.includes(level))||self.mines.includes(level);
if(ownMarker||other?.mines.includes(level)){const mark=document.createElement("span");mark.className="rung-mark";mark.title=ownMarker?"你的地雷":"对手已公开的地雷";row.appendChild(mark)}
for(const[p,cls]of [[self,"user-token"],[other,"ai-token"]])if(p?.position===level){const token=document.createElement("span");token.className="token "+cls;token.title=p.name+"在 "+level+" 级";row.appendChild(token)}ladder.appendChild(row)}
$("minimap").innerHTML=Array.from({length:47},(_,i)=>'<span class="mini-cell'+(self.position===i?" user":"")+(other?.position===i?" ai":"")+'"></span>').join("");
const session=loopId;
requestAnimationFrame(()=>{if(session!==loopId)return;if(!boardDrawn||(posChanged&&room.phase!=="setup")){const target=ladder.querySelector('[data-level="'+Math.round((self.position+(other?.position??0))/2)+'"]');if(target)ladder.scrollTop=Math.max(0,target.offsetTop-ladder.clientHeight/2+15)}else ladder.scrollTop=scroll;boardDrawn=true;boardKey=key});
}
function render(){if(!room)return;const self=me(),other=opponent(),setup=room.phase==="setup",lobby=room.phase==="lobby",untouched=room.players.length===2&&room.players.every(p=>p.position===0&&!p.advanced);renderConnection();
$("sessionCode").textContent=room.code;$("inviteLink").value=joinOrigin+"/?room="+room.code;
$("selfName").textContent=String(self.index+1).padStart(2,"0")+" / 你 · "+self.name;$("otherName").textContent=other?String(other.index+1).padStart(2,"0")+" / "+other.name:"02 / 等待朋友";
$("selfLegend").textContent="你 · "+self.name;$("otherLegend").textContent=other?other.name:"等待加入";
$("userPosition").textContent=self.position;$("aiPosition").textContent=other?.position??0;$("userMeter").style.width=self.position/46*100+"%";$("aiMeter").style.width=(other?.position??0)/46*100+"%";$("roundCount").textContent=room.rounds;$("drawCount").textContent=room.draws>=5&&untouched?room.draws+" 次":room.draws+" / 5";
$("userMineNote").textContent=setup?"你的雷位：已选 "+selection.length+" / 3":"你的地雷：剩余 "+self.mineCount+" 颗";
$("aiMineNote").textContent=!other?"邀请朋友加入后开始":setup?(other.minesReady?"对手已确认雷位":"对手正在秘密选择地雷"):"对手的地雷：剩余 "+other.mineCount+" 颗";
$("flowSetup").className="flow-step "+(setup||lobby?"is-active":"is-complete");$("flowPlay").className="flow-step "+(setup||lobby?"is-upcoming":room.phase==="finished"?"is-complete":"is-active");
$("flowSetupProgress").textContent=lobby?"等待两人到齐":setup?self.minesReady?"已锁定 3 / 3":"已选 "+selection.length+" / 3":"地雷已布置";$("flowPlayProgress").textContent=setup||lobby?"双方布雷后开启":room.phase==="finished"?"本局结束":"双方同步出拳";
$("boardSetupGuide").hidden=!setup||self.minesReady;$("mineSetup").hidden=!setup;$("setupProgress").textContent=self.minesReady?"已确认提交":"已选 "+selection.length+" / 3";$("confirmMines").hidden=self.minesReady;$("confirmMines").disabled=!setup||self.minesReady||requesting||selection.length!==3;$("confirmMines").textContent=requesting?"正在提交…":"确认提交地雷";
$("mineSlots").innerHTML="";
for(let i=0;i<3;i++){
 const level=selection[i],filled=level!==undefined,fixed=filled&&self.mines.includes(level),editable=filled&&setup&&!self.minesReady&&!requesting&&!fixed;
 const slot=document.createElement("span");slot.className="mine-slot"+(filled?" is-filled":"")+(editable?" is-editable":"");
 slot.innerHTML=uiIcons.mine+"<strong>"+(filled?level+" 级":"第 "+(i+1)+" 颗")+"</strong><small>"+(self.minesReady?"已锁定":fixed?"保留雷位":filled?"双击取消":"等待点选")+"</small>";
 if(editable){slot.setAttribute("role","button");slot.tabIndex=0;slot.setAttribute("aria-label",level+" 级地雷，双击取消");slot.title="双击取消此处埋雷";slot.addEventListener("dblclick",event=>{event.preventDefault();cancelMine(level)});slot.addEventListener("keydown",event=>{if(["Enter"," ","Delete","Backspace"].includes(event.key)){event.preventDefault();cancelMine(level)}})}
 $("mineSlots").appendChild(slot);
}
const row=$("handRow");row.innerHTML="";row.hidden=true;$("roundToast").textContent="";$("roundAction").hidden=true;
if(lobby){status(uiIcons.flag,"房间已创建，等朋友加入","把上方邀请码或邀请链接发给朋友。两人到齐后，才能开始秘密埋雷。");$("actionCaption").textContent="等待第二位玩家"}
else if(setup){status(uiIcons.mine,self.minesReady?"已锁定你的 3 颗地雷":"第 1 步：秘密埋下 3 颗雷",self.minesReady?"你的选择已提交，对手看不到雷位。等待对方完成；重合位置会公布并重选。":"点选 3 个不同台阶；双击已选台阶或雷位卡片可取消。调整好后点击「确认提交地雷」，双方都确认后开始猜拳。");$("actionCaption").textContent=requesting?"正在提交地雷…":self.minesReady?"已确认提交，等待对手完成":selection.length===3?"已选满 3 颗，调整好后请确认提交":"还需选择 "+(3-selection.length)+" 颗地雷"}
else if(room.phase==="play"){row.hidden=false;status(handIcons.rock,self.submitted?"已出拳，等待对手":room.draws>=5&&untouched?"起点加赛：继续猜拳":"第 2 步：双方同步出拳",self.submitted?"你的手势已锁定。对手提交后，服务器才会同时公布双方手势并结算。":"选择一个手势并锁定。只有双方都提交后才会揭晓，先出拳的一方不会暴露手势。");$("actionCaption").textContent=other?.submitted?"对手已锁定手势":"双方手势会在出齐后一起揭晓";for(const hand of ["rock","scissors","paper"]){const b=document.createElement("button");b.type="button";b.className="hand-btn";b.disabled=self.submitted||requesting;b.innerHTML='<span class="hand-emoji">'+handIcons[hand]+'</span><strong>'+handNames[hand]+'</strong><small>胜者前进 '+(hand==="rock"?3:6)+' 级</small>';b.addEventListener("click",()=>send("hand",{hand}));row.appendChild(b)}}
else if(room.phase==="advanceChoice"){const won=room.choiceWinner===self.id;status(uiIcons.award,won?"你赢得本轮胜利":"等待本轮胜者选择",won?"连续平局 5 次，按距离和到达先后判定你赢得本轮。请选择前进 3 或 6 级。":"连续平局 5 次，对手赢得本轮，正在选择前进 3 或 6 级；之后继续猜拳。");$("actionCaption").textContent="仅本轮胜者前进，登顶才是最终胜利";if(won){row.hidden=false;for(const steps of [3,6]){const b=document.createElement("button");b.type="button";b.className="advance-btn";b.disabled=requesting;b.textContent="前进 "+steps+" 级";b.addEventListener("click",()=>send("advance",{steps}));row.appendChild(b)}}}
else if(room.phase==="finished"){
 const title=room.winner===self.id?"你登顶获胜啦！":"对手最先登顶";
 const next=computerGame?"点击「再来一局」，和凛重新埋雷。":self.rematch?"你已同意再来一局，等待对方同意。":"双方都同意后，可在同一个房间重新开始。";
 status(uiIcons.flag,title,next);$("actionCaption").textContent="本局已结束";
 $("roundAction").hidden=false;$("rematchButton").disabled=self.rematch||requesting;
 $("rematchButton").textContent=computerGame?"再来一局":self.rematch?"等待对手同意":"同意再来一局";
 const endKey=room.match+":"+room.winner;
 if(shownEnd!==endKey){
  shownEnd=endKey;$("modalStamp").innerHTML=uiIcons.award;$("modalTitle").textContent=title;
  $("modalText").textContent=next;$("modalActions").innerHTML="";
  const b=document.createElement("button");b.type="button";b.className="primary-btn";b.textContent="查看对局";
  b.addEventListener("click",()=>$("modalBackdrop").classList.remove("show"));
  $("modalActions").appendChild(b);$("modalBackdrop").classList.add("show");
 }
}
else status(uiIcons.balance,"本轮等待裁定","双方同级且同时到达，现有规则无法判定本轮胜者。");
$("ladderHint").textContent=setup?"点选埋雷，双击已选位置可取消；选满 3 颗后点击确认提交。":"踩到自己的雷会公开雷位，雷仍保留。踩到对手的雷会消耗该雷并后退 10 级，落点可继续触雷。";
$("logList").innerHTML="";for(const entry of room.logs){const li=document.createElement("li");li.textContent=entry.text;$("logList").appendChild(li)}$("logCount").textContent=room.logs.length+" 条";
const last=room.lastRound;$("roundReveal").hidden=!last;if(last){const ownHand=last.hands[self.index],otherHand=last.hands[other.index];$("lastHands").innerHTML='<span>'+handIcons[ownHand]+'<small>你 · '+esc(handNames[ownHand])+'</small></span><b>VS</b><span>'+handIcons[otherHand]+'<small>对手 · '+esc(handNames[otherHand])+'</small></span>';$("lastResult").textContent="第 "+last.round+" 回合 · "+(last.kind==="draw"?"平局":last.winner===self.id?"你赢得本轮":"对手赢得本轮")}
renderBoard();
}
function status(icon,title,text){$("statusIcon").innerHTML=icon;$("statusTitle").textContent=title;$("statusText").textContent=text}
$("startComputer").addEventListener("click",()=>{gameAudio.activate();startComputer()});
$("createRoom").addEventListener("click",()=>{gameAudio.activate();return enter("create")});$("joinRoom").addEventListener("click",()=>{gameAudio.activate();return enter("join")});$("roomCode").addEventListener("input",()=>$("roomCode").value=$("roomCode").value.toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,6));
$("confirmMines").addEventListener("click",confirmMines);$("rematchButton").addEventListener("click",()=>send("rematch"));$("backToLobby").addEventListener("click",toLobby);
$("copyInvite").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("inviteLink").value);$("copyStatus").textContent="邀请链接已复制"}catch{$("inviteLink").focus();$("inviteLink").select();$("copyStatus").textContent="请复制已选中的邀请链接"}});
$("copyCode").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(room.code);$("copyStatus").textContent="邀请码已复制"}catch{$("copyStatus").textContent="房间邀请码："+room.code}});
$("playerName").value=storage.read("glico.name","");$("roomCode").value=new URLSearchParams(location.search).get("room")?.toUpperCase().slice(0,6)||"";
$("startComputer").textContent=storage.read("glico.computer",null)?"继续人机对战":"开始人机对战";
$("fileNotice").hidden=location.protocol!=="file:";
entryBusy(false);
(async()=>{
 const invited=$("roomCode").value,active=storage.read("glico.active",null);
 if(location.protocol!=="file:")api("/api/config").then(config=>{
  joinOrigin=config.joinOrigin||location.origin;
  if(room&&!computerGame)$("inviteLink").value=joinOrigin+"/?room="+room.code;
 }).catch(()=>{});
 if(!invited&&active===computerCode){startComputer();return}
 const code=invited||active;
 if(location.protocol!=="file:"&&code&&saved[code]){
  entryBusy(true);
  identity=saved[code];
  try{const result=await api("/api/rooms/"+code+"/state");begin({token:identity.token,state:result.state})}
  catch(error){identity=null;message(error.message)}
  finally{entryBusy(false)}
 }
})();
})();
