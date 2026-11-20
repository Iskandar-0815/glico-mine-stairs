// Shared by the Node server and the local computer opponent.
function createGlicoRules({randomUUID, token = () => null}) {
  class GameError extends Error {constructor(message,status=400){super(message);this.status=status}}
  const hands={rock:'拳',scissors:'剪刀',paper:'布'},beats={rock:'scissors',scissors:'paper',paper:'rock'};
  function player(name,index){
   return {id:randomUUID(),token:token(),name:String(name||'玩家'+(index+1)).trim().slice(0,16)||'玩家'+(index+1),position:0,arrival:0,advanced:false,mines:[],revealed:[],minesReady:false,hand:null,rematch:false,lastSeen:Date.now(),recentActions:[]};
  }
  function createRoom(code,name){return {code,revision:1,match:1,phase:'lobby',players:[player(name,0)],rounds:0,draws:0,clock:0,turn:1,setupTurn:1,choiceWinner:null,winner:null,lastRound:null,logs:[],updatedAt:Date.now()}}
  function joinRoom(room,name){if(room.players.length===2)throw new GameError('房间已满，请使用原设备重新连接，或创建新房间。',409);room.players.push(player(name,1));room.phase='setup';log(room,'双方已到齐。请各自秘密选择 3 颗地雷。');return room.players[1]}
  function log(room,text){room.logs.unshift({id:randomUUID(),text});room.logs=room.logs.slice(0,60)}
  function touch(room){room.revision++;room.updatedAt=Date.now()}
  function snapshot(room,viewer){
   return {code:room.code,revision:room.revision,match:room.match,phase:room.phase,rounds:room.rounds,draws:room.draws,turn:room.turn,setupTurn:room.setupTurn,choiceWinner:room.choiceWinner,winner:room.winner,lastRound:room.lastRound,logs:room.logs,
   selfId:viewer.id,players:room.players.map((p,index)=>{
    const visibleMines=p.id===viewer.id?[...p.mines]:p.mines.filter(level=>p.revealed.includes(level));
    return {id:p.id,index,name:p.name,position:p.position,arrival:p.arrival,advanced:p.advanced,connected:Date.now()-p.lastSeen<30000,minesReady:p.minesReady,mineCount:p.mines.length,submitted:!!p.hand,rematch:p.rematch,mines:visibleMines,revealed:[...p.revealed]};
   })};
  }
  function mineEffect(room,p){
   while(p.position>0){
    const level=p.position;
    const owner=room.players.find(q=>q.mines.includes(level));
    if(!owner)return;
    if(!owner.revealed.includes(level))owner.revealed.push(level);
    if(owner===p){
     log(room,p.name+'踩到自己在 '+level+' 级的地雷，留在原地。雷位已公开，地雷保留。');
     return;
    }
    owner.mines.splice(owner.mines.indexOf(level),1);
    p.position=Math.max(0,level-10);
    log(room,p.name+'踩中对手在 '+level+' 级的地雷，退到 '+p.position+' 级。该雷已消耗。');
   }
  }
  function advance(room,p,steps){p.advanced=true;room.clock++;p.position=Math.min(46,p.position+steps);p.arrival=room.clock;mineEffect(room,p);if(p.position===46){room.phase='finished';room.winner=p.id;log(room,p.name+'最先登顶，赢得整场对局！')}}
  function resolveHands(room){
   const [a,b]=room.players,ha=a.hand,hb=b.hand;room.rounds++;
   room.lastRound={round:room.rounds,hands:[ha,hb],winner:null,kind:'draw'};
   a.hand=null;b.hand=null;room.turn++;
   if(ha===hb){
    room.draws++;log(room,'第 '+room.rounds+' 回合：双方都出'+hands[ha]+'，连续平局 '+room.draws+' 次。');
    if(room.draws<5)return;
    if(room.players.every(p=>p.position===0&&!p.advanced)){log(room,'起点例外：双方均在起点且从未前进，继续猜拳直到本轮分出胜负。');return}
    let winner=a.position!==b.position?(a.position>b.position?a:b):a.arrival!==b.arrival?(a.arrival<b.arrival?a:b):null;
    if(!winner){room.phase='adjudication';log(room,'双方同级且同时到达，本轮暂无规则可判定。');return}
    room.choiceWinner=winner.id;room.phase='advanceChoice';room.lastRound.winner=winner.id;room.lastRound.kind='streak';
    log(room,(a.position===b.position?'同级时先到该位置的':'距离终点更近的')+winner.name+'赢得本轮，可选择前进 3 或 6 级。');return;
   }
   room.draws=0;const winner=beats[ha]===hb?a:b,hand=winner===a?ha:hb,steps=hand==='rock'?3:6;
   room.lastRound.winner=winner.id;room.lastRound.kind='win';log(room,'第 '+room.rounds+' 回合：'+a.name+'出'+hands[ha]+'，'+b.name+'出'+hands[hb]+'；'+winner.name+'获胜，前进 '+steps+' 级。');advance(room,winner,steps);
  }
  function resetMatch(room){room.match++;room.phase='setup';room.rounds=0;room.draws=0;room.clock=0;room.turn=1;room.setupTurn=1;room.choiceWinner=null;room.winner=null;room.lastRound=null;room.logs=[];for(const p of room.players)Object.assign(p,{position:0,arrival:0,advanced:false,mines:[],revealed:[],minesReady:false,hand:null,rematch:false});log(room,'双方同意再来一局，请重新秘密埋雷。')}
  function act(room,p,input){
   if(!input||typeof input!=='object'||typeof input.actionId!=='string'||input.actionId.length>80||input.actionId.length<8)throw new GameError('请求格式无效。');
   if(p.recentActions.includes(input.actionId))return false;
   if(input.match!==room.match)throw new GameError('对局已更新，请等待页面同步。',409);
   if(input.type==='mines'){
    if(room.phase!=='setup'||p.minesReady||input.setupTurn!==room.setupTurn)throw new GameError('埋雷阶段已更新，请等待同步。',409);
    const values=input.mines;
    if(!Array.isArray(values)||values.length!==3||new Set(values).size!==3||!values.every(n=>Number.isInteger(n)&&n>=1&&n<=45)||!p.mines.every(n=>values.includes(n)))throw new GameError('请选择 1–45 级的 3 个不同台阶，重选时保留未重合的位置。');
    p.mines=[...values];p.minesReady=true;
    if(room.players.every(q=>q.minesReady)){
     const collisions=room.players[0].mines.filter(n=>room.players[1].mines.includes(n));
     if(collisions.length){for(const q of room.players){q.mines=q.mines.filter(n=>!collisions.includes(n));q.minesReady=false}room.setupTurn++;log(room,'相同埋雷位置 '+collisions.join('、')+' 级已公布，请双方重新选择重合的 '+collisions.length+' 颗。')}
     else{room.phase='play';log(room,'六颗地雷已同时布置完毕，开始猜拳！')}
    }
   }else if(input.type==='hand'){
    if(room.phase!=='play'||input.turn!==room.turn||p.hand)throw new GameError('本次出拳已锁定或回合已更新，请等待同步。',409);
    if(!Object.hasOwn(hands,input.hand))throw new GameError('无效手势。');
    p.hand=input.hand;if(room.players.every(q=>q.hand))resolveHands(room);
   }else if(input.type==='advance'){
    if(room.phase!=='advanceChoice'||room.choiceWinner!==p.id||input.turn!==room.turn)throw new GameError('只有本轮胜者可以选择前进。',409);
    if(![3,6].includes(input.steps))throw new GameError('只能选择前进 3 或 6 级。');
    log(room,p.name+'选择前进 '+input.steps+' 级。');room.draws=0;room.choiceWinner=null;room.phase='play';room.turn++;advance(room,p,input.steps);
   }else if(input.type==='rematch'){
    if(room.phase!=='finished')throw new GameError('请先完成本局。',409);
    p.rematch=true;if(room.players.every(q=>q.rematch))resetMatch(room);
   }else throw new GameError('未知操作。');
   p.recentActions.push(input.actionId);p.recentActions=p.recentActions.slice(-120);touch(room);return true;
  }
  return {GameError, player, createRoom, joinRoom, touch, snapshot, act};
}

if (typeof module === "object" && module.exports) module.exports = createGlicoRules;
