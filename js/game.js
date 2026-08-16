/* ============================================================
   潛淵 — 戰鬥磚塊制原型（第一版）
   實裝設計文件 設計文件/戰鬥磚塊制_設計.md §13。
   純前端、無框架。改完重新整理瀏覽器即可。

   規則摘要：
   - 池子 = 場上4角色 × 每人3磚 = 12。每回合補手牌到8。用掉洗回池子、沒用留手上。
   - 出招帶容量 15（限「數字總和」）。
   - 基礎傷害 = 序列中各磚的傷害值（1磚打1、5磚打5、吸取1）加總。
   - 順子(相鄰連號不重複) 加成 = 基數3 ×(長度-1)。
   - 對子(相鄰同號) → 爆擊率，每對+15%，爆擊=總傷害×2。
   - 條件卡每回合抽1。零頭一律無條件進位（送給玩家）。
   ============================================================ */

// ---------- 技能定義 ----------
// num=數字(容量/combo)，dmg=基礎傷害，heal=回血，eff=特殊效果
const SKILLS = {
  風刃: { name:'風刃', num:1, dmg:1, desc:'造成 1 點傷害' },
  風壓: { name:'風壓', num:2, desc:'本回合全體敵人造成傷害 -2', eff:{ enemyFlat:2 } },
  治癒: { name:'治癒', num:3, heal:3, desc:'回復 3 點血量' },
  隱忍: { name:'隱忍', num:3, desc:'本回合減傷 3', eff:{ mitigate:3 } },
  蓄力: { name:'蓄力', num:4, desc:'本回合若打出5，總傷害 +4', eff:{ buffIf5:4 } },
  刀舞: { name:'刀舞', num:5, dmg:5, desc:'造成 5 點傷害' },
  精準: { name:'精準', num:2, desc:'每張打出的2(含隊友)使敵傷 -2', eff:{ jingzhun:2 } },
  格擋: { name:'格擋', num:3, desc:'本回合減傷 3', eff:{ mitigate:3 } },
  振奮: { name:'振奮', num:4, desc:'出現最多次的數字每張使總傷 +1', eff:{ buffMost:1 } },
  重斬: { name:'重斬', num:5, dmg:5, desc:'造成 5 點傷害' },
  冰封: { name:'冰封', num:2, desc:'本回合敵人骰最低傷害', eff:{ enemyMin:true } },
  療藥: { name:'療藥', num:3, heal:3, desc:'回復 3 點血量' },
  洞察: { name:'洞察', num:4, desc:'預知下兩回合波動', eff:{ foresight:true } },
  霜爆: { name:'霜爆', num:5, dmg:5, desc:'造成 5 點傷害' },
  影鞭: { name:'影鞭', num:1, dmg:1, desc:'造成 1 點傷害' },
  威壓: { name:'威壓', num:2, desc:'本回合全體敵人命中 -30%', eff:{ enemyAcc:0.3 } },
  吸取: { name:'吸取', num:3, dmg:1, heal:2, desc:'造成1傷害，回復2血' },
  影幕: { name:'影幕', num:4, desc:'本回合我方閃避 +30%', eff:{ evade:0.3 } },
  火刃: { name:'火刃', num:1, dmg:1, desc:'造成 1 點傷害' },
  加溫: { name:'加溫', num:4, desc:'每打出一張1，總傷 +2', eff:{ buffPer1:2 } },
  爆焰: { name:'爆焰', num:5, dmg:5, desc:'造成 5 點傷害' },
};

// ---------- 開局四人（含二選一的預設選擇；之後可做成可調 loadout）----------
// 代表色沿用淵1（納可指定的精確色號）：主角土金、K棕、V深藍、L森林綠。
const HEROES = [
  { id:'主角', tiles:['精準','格擋','重斬'], color:'#E8A63C', dark:'#9c6a1e' }, // 2,3,5（橘黃，跟K深棕區隔）
  { id:'K',   tiles:['風刃','風壓','治癒'], color:'#9C6F27', dark:'#5f4318' }, // 1,2,3
  { id:'V',   tiles:['隱忍','蓄力','刀舞'], color:'#4067A2', dark:'#26406a' }, // 3,4,5（三張不同）
  { id:'L',   tiles:['療藥','洞察','霜爆'], color:'#9EBF7B', dark:'#5f7a4a' }, // 3,4,5
];
const HERO_COLOR = {}; HEROES.forEach(h => HERO_COLOR[h.id] = h);

// ---------- 回合條件卡（潛淵波動）10 張 ----------
const CARDS = [
  { name:'平靜', desc:'無加成' },
  { name:'平靜', desc:'無加成' },
  { name:'平靜', desc:'無加成' },
  { name:'平靜', desc:'無加成' },
  { name:'對子沸騰', desc:'爆擊率 ×2', pairMult:2 },
  { name:'順子奔流', desc:'順子加成 ×2', straightMult:2 },
  { name:'空間擴張', desc:'容量 +2', capBonus:2 },
  { name:'空間裂變', desc:'容量 +4', capBonus:4 },
];

// ---------- 遊戲狀態 ----------
const CAP_BASE = 15, HAND_MAX = 8, TEAM_HP_MAX = 40;
const DECK_COPIES = 2; // 每張磚在池子的份數（納可 playtest：×2 拉長循環、別兩回合就輪完一遍；之後可再調）
let pool = [], hand = [], seq = [], discard = [];
let teamHp = TEAM_HP_MAX;
let enemy = { name:'淵蟲', hpMax:55, hp:55, atkMin:4, atkMax:6, heavyMin:11, heavyMax:14, heavyEvery:3 };
let eCount = 0, eNext = null;
// 決定淵蟲「下一次」要做什麼（每第 heavyEvery 回合是預告重擊）
function planEnemy(){
  eCount++;
  const heavy = (eCount % enemy.heavyEvery === 0);
  eNext = heavy ? { type:'heavy', min:enemy.heavyMin, max:enemy.heavyMax }
                : { type:'normal', min:enemy.atkMin, max:enemy.atkMax };
}
let cardQueue = [], curCard = null, foreseeLeft = 0;
let uid = 0, over = false;

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

// 建池子
function buildPool(){
  pool = []; discard = [];
  HEROES.forEach(h => h.tiles.forEach(tn => {
    for(let k=0;k<DECK_COPIES;k++) pool.push({ uid: uid++, skill: SKILLS[tn], who: h.id });
  }));
  shuffle(pool);
}
// 抽一張波動卡（牌庫抽完洗回）
function drawCard(){
  if(cardQueue.length === 0) cardQueue = shuffle(CARDS.slice());
  return cardQueue.shift();
}

function currentCap(){ return CAP_BASE + (curCard.capBonus || 0); }
function seqSum(){ return seq.reduce((s,t)=> s + t.skill.num, 0); }

// ---------- 計分 ----------
function score(arr, card){
  const nums = arr.map(t => t.skill.num);
  let base = 0; arr.forEach(t => base += (t.skill.dmg || 0));

  // 順子：相鄰、連號(±1)、不重複，抓每一段長度>=2
  let straight = 0, i = 0;
  while(i < nums.length){
    let run = [nums[i]], j = i+1;
    while(j < nums.length && Math.abs(nums[j]-nums[j-1])===1 && !run.includes(nums[j])){ run.push(nums[j]); j++; }
    if(run.length >= 2) straight += 3*(run.length-1);
    i = (j > i) ? j : i+1;
  }
  straight *= (card.straightMult || 1);

  // 對子：相鄰同號
  let pairs = 0;
  for(let k=0;k<nums.length-1;k++) if(nums[k]===nums[k+1]) pairs++;
  let crit = Math.min(100, pairs*15*(card.pairMult || 1));

  // 增益磚（蓄力/振奮/加溫）
  let buff = 0;
  const has5 = nums.includes(5);
  const c1 = nums.filter(n=>n===1).length;
  let most = 0; if(nums.length){ const f={}; nums.forEach(n=>f[n]=(f[n]||0)+1); most = Math.max(...Object.values(f)); }
  arr.forEach(t => { const e = t.skill.eff||{};
    if(e.buffIf5 && has5) buff += e.buffIf5;
    if(e.buffPer1) buff += e.buffPer1 * c1;
    if(e.buffMost) buff += e.buffMost * most;
  });

  return { base, straight, buff, pairs, crit, preCrit: base+straight+buff };
}

// 收集防禦/敵傷相關效果（在敵人回合結算）
function collectDef(arr){
  let mitigate=0, flat=0, minRoll=false, accDown=0, evade=0;
  const count2 = arr.filter(t=>t.skill.num===2).length;
  const hasJing = arr.some(t=>t.skill.eff && t.skill.eff.jingzhun);
  arr.forEach(t => { const e=t.skill.eff||{};
    if(e.mitigate) mitigate += e.mitigate;
    if(e.enemyFlat) flat += e.enemyFlat;
    if(e.enemyMin) minRoll = true;
    if(e.enemyAcc) accDown = Math.max(accDown, e.enemyAcc);
    if(e.evade) evade = Math.max(evade, e.evade);
  });
  if(hasJing) flat += count2 * 2; // 精準：每張2(含隊友) -2
  return { mitigate, flat, minRoll, accDown, evade };
}

// ---------- 回合流程 ----------
// 補牌到手牌上限；池子抽光才把棄牌堆整疊洗回（＝製造稀缺，用掉的磚不會馬上回來）
function refill(){
  while(hand.length < HAND_MAX){
    if(pool.length === 0){
      if(discard.length === 0) break;
      pool = shuffle(discard); discard = [];
    }
    hand.push(pool.pop());
  }
}
function startTurn(){
  if(over) return;
  refill();
  curCard = drawCard();
  if(foreseeLeft > 0) foreseeLeft--;
  render();
}

function toSeq(idx){
  if(animating) return;
  const t = hand[idx];
  if(seqSum() + t.skill.num > currentCap()){ flash('容量不足'); return; }
  hand.splice(idx,1); seq.push(t); render();
}
function fromSeq(idx){ if(animating) return; hand.push(seq[idx]); seq.splice(idx,1); render(); }
function clearSeq(){ if(animating) return; while(seq.length) hand.push(seq.pop()); render(); }

// 一鍵順子：笨笨地把手牌排成一條盡量長的順子（不算最優）
function autoStraight(){
  if(animating) return;
  clearSeq();
  const byNum = {}; hand.forEach((t,i)=>{ (byNum[t.skill.num]=byNum[t.skill.num]||[]).push(t); });
  // 從各起點試 1..5 遞增，挑塞得進容量的一條
  let best = [];
  for(let start=1; start<=5; start++){
    let picked=[], sum=0;
    for(let n=start; n<=5; n++){
      if(byNum[n] && byNum[n].length){
        const t = byNum[n][0];
        if(sum + t.skill.num <= currentCap()){ picked.push(t); sum+=t.skill.num; }
      }
    }
    if(picked.length > best.length) best = picked;
  }
  best.forEach(t=>{ const i=hand.indexOf(t); if(i>=0){ hand.splice(i,1); seq.push(t); } });
  render();
}
// 一鍵對子：笨笨地把同號的疊在一起（塞得下就放）
function autoPair(){
  if(animating) return;
  clearSeq();
  const byNum = {}; hand.forEach(t=>{ (byNum[t.skill.num]=byNum[t.skill.num]||[]).push(t); });
  // 找數量最多的那個號碼優先疊
  const order = Object.keys(byNum).sort((a,b)=> byNum[b].length - byNum[a].length);
  let sum=0;
  order.forEach(n=>{
    byNum[n].forEach(t=>{ if(sum + t.skill.num <= currentCap()){ const i=hand.indexOf(t); if(i>=0){ hand.splice(i,1); seq.push(t); sum+=t.skill.num; } } });
  });
  render();
}

// ---------- 出擊 ----------
let animating = false;
function attack(){
  if(over || animating || seq.length === 0) return;
  const sc = score(seq, curCard);
  const crit = Math.random()*100 < sc.crit;
  const total = Math.ceil(sc.preCrit * (crit?2:1)); // 零頭送玩家
  let heal = 0; seq.forEach(t => heal += (t.skill.heal||0));
  const def = collectDef(seq);

  // 出擊動畫：磚一塊塊亮
  animating = true;
  document.getElementById('btnAttack').disabled = true;
  const els = [...document.getElementById('seqSlots').children];
  els.forEach((el,i)=> setTimeout(()=> el.classList.add('firing'), i*110));
  const wait = els.length*110 + 260;

  setTimeout(()=>{
    enemy.hp = Math.max(0, enemy.hp - total);
    if(heal) teamHp = Math.min(TEAM_HP_MAX, teamHp + heal);
    if(seq.some(t=>t.skill.eff && t.skill.eff.foresight)) foreseeLeft = 3;
    shake(crit); flashEnemy();
    floatNum(total, crit?'crit':'');
    if(heal) setTimeout(()=> floatNum('+'+heal,'heal'), 220);
    log(`出擊！造成 <b>${total}</b> 傷害${crit?' <b style="color:#ff6b6b">爆擊！</b>':''}${heal?`，回復 ${heal} 血`:''}`);
    seq.forEach(t => discard.push(t)); seq = [];
    animating = false;
    render();
    if(enemy.hp <= 0){ finish(true); return; }
    setTimeout(()=> enemyTurn(def), 720);
  }, wait);
}

function enemyTurn(def){
  if(over) return;
  const mv = eNext, heavy = mv.type === 'heavy';
  const hitChance = (1-(def.accDown||0)) * (1-(def.evade||0));
  if(Math.random() > hitChance){ log(`敵人${heavy?'的重擊':''}攻擊 <b>落空</b>了！`); planEnemy(); startTurn(); return; }
  let dmg = def.minRoll ? mv.min
          : mv.min + Math.floor(Math.random()*(mv.max-mv.min+1));
  const raw = dmg;
  dmg = Math.max(0, dmg - def.mitigate - def.flat);
  teamHp = Math.max(0, teamHp - dmg);
  log(`淵蟲${heavy?'<b style="color:#ff6b6b">重擊</b>':'反擊'} ${raw}${(def.mitigate+def.flat)?`（減免 ${def.mitigate+def.flat}）`:''} → 受到 <b>${dmg}</b>`);
  render();
  if(teamHp <= 0){ finish(false); return; }
  planEnemy();
  startTurn();
}

function finish(won){
  over = true;
  document.getElementById('btnAttack').disabled = true;
  log(won ? '<span class="win">淵蟲被擊倒了！勝利！（重新整理再玩一場）</span>'
          : '<span class="lose">全隊倒下了……（重新整理再玩一場）</span>');
}

// ---------- 畫面 ----------
function tileEl(t, onClick){
  const d = document.createElement('div');
  d.className = 'tile';
  const c = HERO_COLOR[t.who] || { color:'#555', dark:'#333' };
  d.style.background = `linear-gradient(160deg, ${c.dark}, ${c.color})`;
  d.innerHTML = `<span class="num">${t.skill.num}</span><span class="nm">${t.skill.name}</span><span class="who">${t.who}</span>`;
  d.title = `${t.skill.name}（${t.who}）：${t.skill.desc}`;
  d.onclick = onClick;
  return d;
}
function render(){
  // 敵人
  document.getElementById('enemyHpFill').style.width = (enemy.hp/enemy.hpMax*100)+'%';
  document.getElementById('enemyHpText').textContent = `${enemy.hp} / ${enemy.hpMax}`;
  const intentEl = document.getElementById('enemyIntent');
  if(eNext && eNext.type==='heavy'){ intentEl.className = 'intent heavy'; intentEl.innerHTML = `⚡ <b style="color:#ff6b6b">蓄力重擊！下回合造成 ${eNext.min}~${eNext.max} 點——快防禦/治療！</b>`; }
  else if(eNext){ intentEl.className = 'intent'; intentEl.textContent = `意圖：下回合攻擊 ${eNext.min}~${eNext.max} 點`; }
  // 隊伍
  document.getElementById('teamHpFill').style.width = (teamHp/TEAM_HP_MAX*100)+'%';
  document.getElementById('teamHpText').textContent = `${teamHp} / ${TEAM_HP_MAX}`;
  document.getElementById('heroRow').innerHTML = HEROES.map(h=>`<div class="hero" style="border-left:4px solid ${h.color}"><b style="color:${h.color}">${h.id}</b>${h.tiles.map(t=>SKILLS[t].num).join(' ')}</div>`).join('');
  // 波動卡
  document.getElementById('cardName').textContent = curCard.name;
  document.getElementById('cardDesc').textContent = curCard.desc;
  const fs = document.getElementById('foresight');
  if(foreseeLeft > 0){ const peek = cardQueue.slice(0,2).map(c=>c.name).join(' → '); fs.textContent = '洞察：接下來 ' + (peek||'（洗牌中）'); }
  else fs.textContent = '';
  // 出招帶
  const sSlots = document.getElementById('seqSlots'); sSlots.innerHTML=''; sSlots.classList.add('seqbar');
  // 算出哪些位置屬於順子/對子，即時高亮
  const snums = seq.map(t=>t.skill.num);
  const inStraight = new Set(), inPair = new Set();
  let si = 0;
  while(si < snums.length){
    let run=[si], j=si+1;
    while(j<snums.length && Math.abs(snums[j]-snums[j-1])===1 && !run.map(x=>snums[x]).includes(snums[j])){ run.push(j); j++; }
    if(run.length>=2) run.forEach(x=>inStraight.add(x));
    si = (j>si)?j:si+1;
  }
  for(let k=0;k<snums.length-1;k++) if(snums[k]===snums[k+1]){ inPair.add(k); inPair.add(k+1); }
  seq.forEach((t,i)=>{
    const el = tileEl(t, ()=>fromSeq(i));
    if(inPair.has(i)) el.classList.add('inpair');
    else if(inStraight.has(i)) el.classList.add('instraight');
    sSlots.appendChild(el);
  });
  document.getElementById('capText').textContent = `容量 ${seqSum()} / ${currentCap()}　·　池子 ${pool.length}／棄牌 ${discard.length}`;
  // 手牌
  const hSlots = document.getElementById('handTiles'); hSlots.innerHTML='';
  hand.forEach((t,i)=> hSlots.appendChild(tileEl(t, ()=>toSeq(i))));
  // 試算
  const sc = score(seq, curCard);
  document.getElementById('calc').innerHTML = seq.length
    ? `基礎 <b>${sc.base}</b> ＋ 順子 <b>${sc.straight}</b>${sc.buff?` ＋ 增益 <b>${sc.buff}</b>`:''}　｜　爆擊率 <b>${sc.crit}%</b>　｜　預計 <b>${sc.preCrit}</b>${sc.crit?` ~ ${sc.preCrit*2}`:''}`
    : '把手牌點上來排序列……';
  // 效果清單：把序列裡所有非傷害效果條列，讓玩家有感
  const def = collectDef(seq);
  let heal = 0; seq.forEach(t => heal += (t.skill.heal||0));
  const effs = [];
  if(heal) effs.push(`💚 治療 +${heal} 血`);
  if(def.mitigate) effs.push(`🛡️ 本回合減傷 ${def.mitigate}`);
  if(def.flat) effs.push(`🔻 敵方本回合傷害 -${def.flat}`);
  if(def.minRoll) effs.push(`❄️ 敵人本回合骰最低傷害`);
  if(def.accDown) effs.push(`🌫️ 敵命中 -${Math.round(def.accDown*100)}%`);
  if(def.evade) effs.push(`💨 我方閃避 +${Math.round(def.evade*100)}%`);
  if(seq.some(t=>t.skill.eff && t.skill.eff.foresight)) effs.push(`🔮 預知接下來的波動`);
  document.getElementById('seqEff').innerHTML = seq.length
    ? (effs.length ? '出擊會：' + effs.join('　') : '<span class="noeff">（這條沒有附帶效果，純輸出）</span>')
    : '';
  document.getElementById('btnAttack').disabled = over || seq.length===0;
}
function floatNum(v, cls){
  const layer = document.getElementById('floatLayer');
  const d = document.createElement('div'); d.className = 'floatnum ' + (cls||''); d.textContent = v;
  d.style.left = (45 + Math.random()*10) + '%';
  layer.appendChild(d); setTimeout(()=>d.remove(), 1150);
}
function shake(big){
  const g = document.getElementById('game'); const cls = big ? 'shakeB' : 'shakeS';
  g.classList.remove('shakeS','shakeB'); void g.offsetWidth; g.classList.add(cls);
  setTimeout(()=> g.classList.remove(cls), 520);
}
function flashEnemy(){
  const e = document.getElementById('enemyArea');
  e.classList.remove('hit'); void e.offsetWidth; e.classList.add('hit');
  setTimeout(()=> e.classList.remove('hit'), 400);
}
let logLines = [];
function log(html){ logLines.unshift(html); logLines = logLines.slice(0,5); document.getElementById('log').innerHTML = logLines.map(l=>'· '+l).join('<br>'); }
function flash(msg){ log(msg); }

// ---------- 啟動 ----------
function init(){
  document.getElementById('btnStraight').onclick = autoStraight;
  document.getElementById('btnPair').onclick = autoPair;
  document.getElementById('btnClear').onclick = clearSeq;
  document.getElementById('btnAttack').onclick = attack;
  buildPool();
  planEnemy();
  startTurn();
  log('潛淵深處，淵蟲擋在前方。排出你的招式吧。');
}
init();
