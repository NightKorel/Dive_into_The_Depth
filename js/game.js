/* ============================================================
   潛淵 · 淵2 — 戰鬥磚塊制原型
   VERSION：語意化版本，平常只加最後一位（修）；次/主號等納可開口（規則見 CLAUDE.md）。
   實裝設計文件 設計文件/戰鬥磚塊制_設計.md §13、系統與技能總覽.md。
   純前端、無框架。改完重新整理瀏覽器即可。

   規則摘要：
   - 池子 = 場上4角色 × 每人3磚 × 每張2份 = 24。每回合補手牌到8。用掉進棄牌堆、池空才洗回、沒用留手上。
   - 容量 15（每回合排列的數字總和上限，照舊每回合重置）。體力＝會累積的行動池（起0/回合+13/上限40），出擊實際扣體力＝排出去的數字總和。每回合能排的總和＝min(體力,容量)。ALL IN(滿40可按)＝把容量拿掉、只剩體力當上限，能一口氣梭到 40。
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
  洞察: { name:'洞察', num:4, desc:'預知下一回合波動', eff:{ foresight:true } },
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

// ---------- 設定（改名／改主角色／顯示卡牌詳細效果；存 localStorage） ----------
const SETTINGS_KEY = 'yuan2_settings';
// playerName＝全名（劇情/其他地方角色叫的名字）；battleNick＝戰鬥暱稱（≤2 字，戰鬥介面只顯示這個）
let settings = { playerName:'', battleNick:'', heroColor:'#E8A63C', showTileEff:true };
function loadSettings(){ try{ const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if(s && typeof s==='object') Object.assign(settings, s); }catch(e){} }
function saveSettings(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){} }
// 主角顯示名：內部識別仍用 '主角'（磚的 who、顏色查表都靠它）。
// 戰鬥介面只顯示「戰鬥暱稱」（≤2 字，才不會撐爆磚/角色方塊）；沒設暱稱就退而用全名前 2 字、再沒有就預設「主角」。
function displayName(id){
  if(id !== '主角') return id;
  const nick = String(settings.battleNick).trim();
  if(nick) return nick.slice(0,2);
  const full = String(settings.playerName).trim();
  return full ? full.slice(0,2) : '主角';
}
// 依主角選的色，自動算一個較深的底色（磚的漸層用）
function darken(hex, f=0.55){
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex); if(!m) return '#333';
  const n = parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  const d = v => Math.round(v*f).toString(16).padStart(2,'0');
  return '#'+d(r)+d(g)+d(b);
}
function applyHeroColor(){ const h = HEROES[0]; h.color = settings.heroColor; h.dark = darken(settings.heroColor); }
function applyTileEff(){ document.body.classList.toggle('eff-on', !!settings.showTileEff); }

// ---------- 回合條件卡（潛淵波動）10 張 ----------
const CARDS = [
  { name:'平靜', desc:'無加成' },
  { name:'平靜', desc:'無加成' },
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
const VERSION = 'v0.2.27'; // 語意化版本 主.次.修：次號留給大里程碑、日常小改用修號；粗胚維持 0.x（規則見 CLAUDE.md）
const CAP_BASE = 15, HAND_MAX = 8, TEAM_HP_MAX = 40; // 容量＝每回合排列上限（照舊、每回合重置）
// 體力（＝會累積的行動池）：起 0，每回合開始 +13，上限 40。出擊會實際扣體力＝排出去那串磚的數字總和。
// 每回合實際能排的數字總和＝min(體力, 容量)：正常被容量 15 卡著，攢體力是為了 ALL IN。
const STAMINA_MAX = 40, STAMINA_GAIN = 13;
let stamina = 0;
let allIn = false; // ALL IN！：體力滿 40 才能按，這回合把容量拿掉（無限）＝只剩體力當上限，能一口氣梭到 40
const DECK_COPIES = 2; // 每張磚在池子的份數（納可 playtest：×2 拉長循環、別兩回合就輪完一遍；之後可再調）
let pool = [], hand = [], seq = [], discard = [];
let teamHp = TEAM_HP_MAX;
// 負面波動（深淵共鳴污染下回合用）＝正面波動的鏡像：容量-2、順子÷2、爆擊÷2
const NEG_WAVES = [
  { name:'深淵擠壓', desc:'容量 -2', capBonus:-2, neg:true },
  { name:'順子失序', desc:'順子加成 ÷2', straightMult:0.5, neg:true },
  { name:'爆擊消解', desc:'爆擊率 ÷2', pairMult:0.5, neg:true },
];
function pickNegWave(){ return NEG_WAVES[Math.floor(Math.random()*NEG_WAVES.length)]; }

// 敵人：一場可以有多隻，全部同時在場、都會攻擊你；單體攻擊打「前排 focus」，前排死了自動換下一隻。
// 行動用一條會循環的 pattern（normal 普攻／heavy 預告重擊／resonance 深淵共鳴）。
// 兩隻一起打＝傷害會疊，所以每隻比單隻弱（不是一隻硬 ×2）。
function makeWorm(name, pattern){
  return {
    // 菁英戰的淵蟲：傷害比雜魚高一點（納可 2026-08-16）
    name, hpMax:40, hp:40, atkMin:5, atkMax:7, heavyMin:11, heavyMax:14, resMin:3, resMax:4,
    pattern, patIdx:-1, next:null, dead:false,
  };
}
let enemies = [
  makeWorm('淵蟲', ['normal','normal','heavy','normal','resonance','normal']),
  makeWorm('淵蟲', ['normal','resonance','normal','heavy','normal','normal']), // pattern 錯開，重擊不會同回合
];
let focusIdx = 0, corruptNext = null;
function focusEnemy(){ return enemies[focusIdx]; }
function aliveEnemies(){ return enemies.filter(e => !e.dead); }
// 前排死了 → focus 移到下一隻活的（無縫切換）
// 玩家點怪＝選目標（只在自己回合、目標活著才有效）。選定會記憶到戰鬥結束或再改。
function selectTarget(idx){
  if(animating || over) return;           // 只有自己回合(沒在跑動畫)能改
  if(!enemies[idx] || enemies[idx].dead) return;
  if(idx === focusIdx) return;
  focusIdx = idx; render();
}
function advanceFocus(){
  for(let n=1; n<=enemies.length; n++){
    const idx = (focusIdx+n) % enemies.length;
    if(!enemies[idx].dead){ focusIdx = idx; return; }
  }
}
// 決定某隻「下一次」要做什麼（照 pattern，提前預告）
function planEnemy(e){
  e.patIdx = (e.patIdx + 1) % e.pattern.length;
  const kind = e.pattern[e.patIdx];
  if(kind === 'heavy') e.next = { type:'heavy', min:e.heavyMin, max:e.heavyMax };
  else if(kind === 'resonance') e.next = { type:'resonance', min:e.resMin, max:e.resMax, wave:pickNegWave() };
  else e.next = { type:'normal', min:e.atkMin, max:e.atkMax };
}
let cardQueue = [], curCard = null, foreseeLeft = 0;
let uid = 0, over = false;
let watchdog = null; // 卡住自動恢復用的計時器

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

// 每回合容量＝15（＋波動臨時 ±）；ALL IN 時無限
function currentCap(){ return allIn ? Infinity : Math.max(0, CAP_BASE + (curCard.capBonus || 0)); }
// 這回合實際能排的數字總和上限＝體力和容量取低（ALL IN 時容量無限＝只剩體力當上限）
function placeLimit(){ return Math.min(stamina, currentCap()); }
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

// 找滿順（1-2-3-4-5 五連）的位置，找不到回 null
function fullStraightRun(nums){
  let i = 0;
  while(i < nums.length){
    let run=[i], j=i+1;
    while(j<nums.length && Math.abs(nums[j]-nums[j-1])===1 && !run.map(x=>nums[x]).includes(nums[j])){ run.push(j); j++; }
    if(run.length >= 5) return run;
    i = (j>i) ? j : i+1;
  }
  return null;
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
let firstTurn = true;
function startTurn(){
  if(over) return;
  stamina = Math.min(STAMINA_MAX, stamina + STAMINA_GAIN); // 每回合開始補體力（累積、封頂）
  allIn = false; // ALL IN 每回合重置
  refill();
  // 第一回合固定平靜（單純上手）；之後被共鳴污染→負面，否則正常抽
  if(firstTurn){ curCard = { name:'平靜', desc:'無加成' }; firstTurn = false; }
  else curCard = corruptNext ? corruptNext : drawCard();
  corruptNext = null;
  if(foreseeLeft > 0) foreseeLeft--;
  animating = false; dragSession = null; draggingUid = null; // 新回合就緒，解鎖並清掉殘留拖動狀態
  clearTimeout(watchdog); // 正常進到新回合＝沒卡住，取消看門狗
  render();
}

function toSeq(idx){
  if(animating) return;
  const t = hand[idx];
  if(seqSum() + t.skill.num > placeLimit()){ flash(stamina < currentCap() ? '體力不足' : '容量不足'); return; }
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
        if(sum + t.skill.num <= placeLimit()){ picked.push(t); sum+=t.skill.num; }
      }
    }
    if(picked.length > best.length) best = picked;
  }
  // 排成降冪（數字大的在前，跟一鍵對子一致）——順子升降都算分，純顯示一致性
  best.reverse().forEach(t=>{ const i=hand.indexOf(t); if(i>=0){ hand.splice(i,1); seq.push(t); } });
  render();
}
// 一鍵對子：笨笨地把同號的疊在一起（塞得下就放）
function autoPair(){
  if(animating) return;
  clearSeq();
  const byNum = {}; hand.forEach(t=>{ (byNum[t.skill.num]=byNum[t.skill.num]||[]).push(t); });
  // 同號疊在一起，多組時「數字大的排前面」＝降冪（例 55、22 → 5522 不是 2255）
  const order = Object.keys(byNum).sort((a,b)=> Number(b) - Number(a));
  let sum=0;
  order.forEach(n=>{
    byNum[n].forEach(t=>{ if(sum + t.skill.num <= placeLimit()){ const i=hand.indexOf(t); if(i>=0){ hand.splice(i,1); seq.push(t); sum+=t.skill.num; } } });
  });
  render();
}

// ---------- 出擊 ----------
let animating = false;
function attack(){
  if(over || animating || seq.length === 0) return;
  const spent = seqSum(); // 這次出擊要扣的體力＝排出去那串磚的數字總和
  const sc = score(seq, curCard);
  const crit = Math.random()*100 < sc.crit;
  const total = Math.ceil(sc.preCrit * (crit?2:1)); // 零頭送玩家
  let heal = 0; seq.forEach(t => heal += (t.skill.heal||0));
  const def = collectDef(seq);
  const isFull = !!fullStraightRun(seq.map(t=>t.skill.num)); // 滿順？

  // 出擊動畫：磚一塊塊亮
  animating = true;
  document.getElementById('btnAttack').disabled = true;
  // 看門狗：萬一流程哪裡沒解鎖，4 秒後自動恢復，不讓玩家卡死
  clearTimeout(watchdog);
  watchdog = setTimeout(()=>{
    if(animating && !over){
      log('⚠ 偵測到卡住，已自動恢復（若常發生請跟我說剛剛怎麼操作的）');
      animating = false; dragSession = null; draggingUid = null;
      if(hand.length < HAND_MAX) refill();
      render();
    }
  }, 4000);
  const els = [...document.getElementById('seqSlots').children];
  els.forEach((el,i)=> setTimeout(()=> el.classList.add('firing'), i*110));
  const wait = els.length*110 + 260;

  setTimeout(()=>{
   try {
    const tgt = focusEnemy();
    stamina = Math.max(0, stamina - spent); // 出擊扣體力＝排出去的數字總和（ALL IN 只是把容量拿掉、扣法一樣）
    allIn = false;
    // 單體攻擊打前排；打死還有剩的「溢出（overkill）」傷害接著打下一隻，不浪費
    let remain = total, overflow = 0;
    const hitOrder = [tgt, ...aliveEnemies().filter(e => e !== tgt)];
    for(const e of hitOrder){
      if(remain <= 0) break;
      const d = Math.min(remain, e.hp);
      e.hp = Math.max(0, e.hp - d); remain -= d;
      if(e !== tgt) overflow += d;
    }
    if(heal) teamHp = Math.min(TEAM_HP_MAX, teamHp + heal);
    // 洞察：只看下一回合波動、不疊加（波動牌庫小、看太多回會太強）
    if(seq.some(t=>t.skill.eff && t.skill.eff.foresight)) foreseeLeft = 2;
    flashEnemy(); // 打怪：只有敵人抖（flashEnemy 本身含位移），不震整個畫面
    if(isFull){ goldBurst(); floatNum('✨ 滿順 ✨', 'full'); }
    floatNum(total, crit?'crit':'');
    if(heal) setTimeout(()=> floatNum('+'+heal, 'heal', 'team'), 220);
    if(overflow > 0) setTimeout(()=> floatNum('溢出 '+overflow, 'spill'), 300); // 溢出傷害飄字（小小的、不強調）
    let killMsg = '';
    enemies.forEach(e => { if(e.hp <= 0 && !e.dead){ e.dead = true; killMsg += ' <b style="color:#ff9a9a">淵蟲倒下！</b>'; } });
    log(`出擊！造成 <b>${total}</b> 傷害${isFull?' <b style="color:#ffdf6b">✨滿順✨</b>':''}${crit?' <b style="color:#ff6b6b">爆擊！</b>':''}${overflow?` （溢出 <b>${overflow}</b> 打到下一隻）`:''}${heal?`，回復 ${heal} 血`:''}${killMsg}`);
    seq.forEach(t => discard.push(t)); seq = [];
    // 注意：animating 保持 true，鎖到「敵人反擊→新回合抽牌」全部跑完（在 startTurn 才解鎖），避免空檔重複出擊
    if(aliveEnemies().length === 0){ render(); finish(true); return; }
    if(tgt.dead){ advanceFocus(); log('另一隻淵蟲逼近……'); } // 無縫切換前排
    render();
    setTimeout(()=> enemyTurn(def), 720);
   } catch(err){
    log('⚠ 出擊結算出錯：' + (err && err.message) + '（已強制續行，請截圖給我）');
    seq = []; animating = false; render();
   }
  }, wait);
}

// 敵人回合：所有活著的敵人都出手（全體減傷/命中 debuff 對每一隻都作用＝全體效果有意義）
function enemyTurn(def){
  if(over) return;
  try {
    const alive = aliveEnemies();
    let taken = 0, anyHeavy = false;
    alive.forEach((e, i) => {
      const mv = e.next || { type:'normal', min:e.atkMin, max:e.atkMax }; // 保險：next 萬一為空也不炸
      const heavy = mv.type === 'heavy', reson = mv.type === 'resonance';
      if(reson){ corruptNext = mv.wave; log(`🌀 <b style="color:#c9a0ff">深淵共鳴</b>！下回合波動被污染（用洞察才看得到內容）`); }
      const hitChance = (1-(def.accDown||0)) * (1-(def.evade||0));
      if(Math.random() > hitChance){ setTimeout(()=> floatNum('MISS','miss','team'), i*260); log(`淵蟲${heavy?'的重擊':reson?'的共鳴一擊':''} <b>閃避</b>了！`); return; }
      let dmg = def.minRoll ? mv.min : mv.min + Math.floor(Math.random()*(mv.max-mv.min+1));
      const raw = dmg;
      dmg = Math.max(0, dmg - def.mitigate - def.flat); // 全體減傷/風壓/精準對每隻都減
      const blocked = raw - dmg;
      teamHp = Math.max(0, teamHp - dmg); taken += dmg; if(heavy) anyHeavy = true;
      if(blocked > 0) setTimeout(()=> floatNum('🛡 ' + (dmg===0?'完全擋下':blocked), 'block', 'team'), i*260);
      if(dmg > 0) setTimeout(()=> floatNum('-' + dmg, 'dmg', 'team'), i*260 + (blocked>0?180:0));
      const label = heavy ? '<b style="color:#ff6b6b">重擊</b>' : reson ? '<b style="color:#c9a0ff">共鳴一擊</b>' : '反擊';
      log(`淵蟲${label} ${raw}${blocked?`（減免 ${blocked}）`:''} → 受到 <b>${dmg}</b>`);
    });
    if(taken > 0) shakeEl('teamArea', anyHeavy); // 被打：只震我方血條區
    if(taken >= TEAM_HP_MAX * 0.25) redVignette();
    render();
    if(teamHp <= 0){ finish(false); return; }
    alive.forEach(e => planEnemy(e)); // 各自排下一步
    startTurn();
  } catch(err){
    log('⚠ 敵人回合出錯：' + (err && err.message) + '（已強制續行，請截圖給我）');
    corruptNext = null; animating = false; render(); // 解鎖、不卡死
  }
}

function finish(won){
  over = true;
  document.getElementById('btnAttack').disabled = true;
  log(won ? '<span class="win">淵蟲群被清光了！勝利！（重新整理再玩一場）</span>'
          : '<span class="lose">全隊倒下了……（重新整理再玩一場）</span>');
}

// ---------- 畫面 ----------
function tileEl(t, onClick){
  const d = document.createElement('div');
  d.className = 'tile';
  const c = HERO_COLOR[t.who] || { color:'#555', dark:'#333' };
  d.style.background = `linear-gradient(160deg, ${c.dark}, ${c.color})`;
  const circ = ['','❶','❷','❸','❹','❺'][t.skill.num] || t.skill.num; // 詳細效果模式用的圈圈數字
  const descHtml = t.skill.desc.replace(/([+-]?\d+%?)/g, '<b class="dnum">$1</b>'); // 描述裡的數字(3、-2、-30% 之類)加粗突出
  d.innerHTML = `<span class="num">${t.skill.num}</span><span class="cnum">${circ}</span><span class="nm">${t.skill.name}</span><span class="who">${displayName(t.who)}</span><span class="eff">${descHtml}</span>`;
  d.title = `${t.skill.name}（${displayName(t.who)}）：${t.skill.desc}`;
  d.onclick = onClick;
  return d;
}
function render(){
  // 敵人們：原地更新、不重建 DOM（重建會害 focus/dead 動畫每次 render 都重放＝奇怪彈跳）
  const row = document.getElementById('enemyRow');
  if(row.children.length !== enemies.length){
    row.innerHTML = '';
    enemies.forEach((_, idx)=>{
      const card = document.createElement('div');
      card.className = 'enemy-card';
      card.innerHTML = `<div class="enemy-name"><span class="focus-arrow">►</span><span class="ename-txt"></span></div>`
        + `<div class="hpbar enemy"><div class="hpfill"></div><span></span></div>`
        + `<div class="ecard-intent"></div>`;
      card.onclick = () => selectTarget(idx); // 玩家自己的回合可點怪換目標
      row.appendChild(card);
    });
  }
  enemies.forEach((e, idx) => {
    const card = row.children[idx];
    const cls = 'enemy-card ' + (e.dead ? 'dead' : (idx === focusIdx ? 'focus' : 'sub'));
    if(card.className !== cls) card.className = cls; // 只有狀態真的變才換 class ＝ 動畫只在切換/死亡放一次
    card.querySelector('.ename-txt').textContent = e.name; // 名字純置中；目標箭頭是獨立定位、不擠名字
    card.querySelector('.hpfill').style.width = Math.max(0, e.hp/e.hpMax*100) + '%';
    card.querySelector('.hpbar span').textContent = `${Math.max(0,e.hp)} / ${e.hpMax}`;
    let intent = '';
    if(!e.dead && e.next){
      if(e.next.type === 'heavy') intent = `<span class="i-heavy">⚡ 蓄力重擊 ${e.next.min}~${e.next.max}</span>`;
      else if(e.next.type === 'resonance') intent = `<span class="i-reson">🌀 深淵共鳴 ${e.next.min}~${e.next.max}<br>＋污染下回合波動</span>`;
      else intent = `<span class="i-normal">攻擊 ${e.next.min}~${e.next.max}</span>`;
    }
    card.querySelector('.ecard-intent').innerHTML = intent;
  });
  document.getElementById('enemyIntent').textContent = '';
  // 隊伍
  document.getElementById('teamHpFill').style.width = (teamHp/TEAM_HP_MAX*100)+'%';
  document.getElementById('teamHpText').textContent = `${teamHp} / ${TEAM_HP_MAX}`;
  document.getElementById('staminaFill').style.width = (stamina/STAMINA_MAX*100)+'%';
  document.getElementById('staminaText').textContent = `${stamina} / ${STAMINA_MAX}`;
  // 預計消耗：排好還沒出牌時，在體力條右端（會被抽乾的那截）顯示半透明脈動段
  const ghost = document.getElementById('staminaGhost');
  const willSpend = animating ? 0 : Math.min(seqSum(), stamina); // 出擊動畫中不顯示
  ghost.style.left  = ((stamina - willSpend) / STAMINA_MAX * 100) + '%';
  ghost.style.width = (willSpend / STAMINA_MAX * 100) + '%';
  ghost.classList.toggle('show', willSpend > 0);
  // ALL IN！按鈕：只在體力滿、輪到玩家時浮出
  const allInBtn = document.getElementById('btnAllIn');
  const canAllIn = (stamina >= STAMINA_MAX) && !over && !animating;
  allInBtn.classList.toggle('show', canAllIn);
  allInBtn.classList.toggle('active', allIn);
  document.getElementById('heroRow').innerHTML = HEROES.map(h=>`<div class="hero" style="--hc:${h.color}"><b>${displayName(h.id)}</b><span class="hnums">${h.tiles.map(t=>SKILLS[t].num).join(' ')}</span></div>`).join('');
  // 波動卡
  document.getElementById('cardArea').className = 'panel' + (curCard.neg ? ' negwave' : '');
  document.getElementById('cardName').textContent = curCard.name;
  document.getElementById('cardDesc').textContent = curCard.desc;
  const fs = document.getElementById('foresight');
  if(foreseeLeft > 0){
    // 洞察：看穿接下來 foreseeLeft 回合的波動（含把共鳴污染成什麼看穿）
    const list = [];
    if(corruptNext) list.push(corruptNext.desc + '(污染)');
    else {
      const r = aliveEnemies().find(e => e.next && e.next.type === 'resonance');
      list.push(r ? ('被污染成 ' + r.next.wave.desc) : (cardQueue[0] ? cardQueue[0].name : '平靜'));
    }
    for(let k=1; k<foreseeLeft && k<cardQueue.length; k++) list.push(cardQueue[k].name); // 後續順著波動牌庫peek
    fs.textContent = `🔮 洞察（可見 ${foreseeLeft} 回）：` + list.join(' → ');
  } else fs.textContent = '';
  // 手牌
  const hSlots = document.getElementById('handTiles'); hSlots.innerHTML='';
  hand.forEach((t,i)=> hSlots.appendChild(tileEl(t, ()=>toSeq(i))));
  // 出招帶（＋試算＋效果清單）另外抽成 renderSeqBar，拖動排序時只重畫這塊
  renderSeqBar();
}

// 只重畫「出招帶＋試算＋效果清單」——拖動排序時只呼叫這個，不整個畫面重畫＝不卡
function renderSeqBar(){
  const sSlots = document.getElementById('seqSlots'); sSlots.innerHTML=''; sSlots.classList.add('seqbar');
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
  const fullRun = fullStraightRun(snums); const fullSet = new Set(fullRun||[]);
  seq.forEach((t,i)=>{
    const el = tileEl(t, null); // 出招帶的磚：點擊/拖動都由 attachSeqDrag 處理
    if(fullSet.has(i)) el.classList.add('fullstraight');
    else if(inStraight.has(i) && inPair.has(i)) el.classList.add('inboth'); // 又順又對＝輪流閃爍
    else if(inPair.has(i)) el.classList.add('inpair');
    else if(inStraight.has(i)) el.classList.add('instraight');
    if(t.uid === draggingUid) el.classList.add('dragging');
    attachSeqDrag(el, t);
    sSlots.appendChild(el);
  });
  document.getElementById('capText').textContent = `花費 ${seqSum()} / 容量 ${allIn ? '∞ ⚡ALL IN' : currentCap()}　卡池 ${pool.length}　棄牌 ${discard.length}`;
  const sc = score(seq, curCard);
  document.getElementById('calc').innerHTML = seq.length
    ? `${fullRun?'<span class="fulltag">✨ 滿順 ✨</span>':''}預計傷害 <b class="big">${sc.preCrit}${sc.crit?`~${sc.preCrit*2}`:''}</b>`
      + `${sc.crit?`　爆擊率 <b>${sc.crit}%</b>`:''}`
      + `　<span class="detail">（基礎 ${sc.base}＋順子 ${sc.straight}${sc.buff?`＋增益 ${sc.buff}`:''}）</span>`
    : '把手牌點上來排序列……';
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
  document.getElementById('btnAttack').disabled = over || animating || seq.length===0;
}

// ---- 出招帶：長按拖放換順序（滑鼠/觸控通用；單點＝移除）----
// 全域只註冊一組 move/up/cancel 監聽（在 init 掛一次），避免每次拖動重複掛／漏移除造成累積卡頓。
let draggingUid = null;
let dragSession = null; // { uid, active, moved, startX, longTimer }
function fromSeqByUid(uid){ const i = seq.findIndex(t=>t.uid===uid); if(i>=0){ hand.push(seq[i]); seq.splice(i,1); render(); } }
function attachSeqDrag(el, tile){
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (ev) => {
    if(animating || dragSession) return; // 一次只允許一個拖動
    ev.preventDefault();
    dragSession = { uid: tile.uid, active:false, moved:false, startX: ev.clientX };
    dragSession.longTimer = setTimeout(() => {
      if(dragSession && !dragSession.active){ dragSession.active = true; draggingUid = dragSession.uid; renderSeqBar(); }
    }, 160);
  });
}
function onDragMove(mv){
  if(!dragSession) return;
  if(!dragSession.active && Math.abs(mv.clientX - dragSession.startX) > 8){
    dragSession.active = true; clearTimeout(dragSession.longTimer); draggingUid = dragSession.uid; renderSeqBar();
  }
  if(dragSession.active){ dragSession.moved = true; reorderSeq(dragSession.uid, mv.clientX); }
}
function onDragEnd(){
  if(!dragSession) return;
  clearTimeout(dragSession.longTimer);
  const s = dragSession; dragSession = null; draggingUid = null;
  if(s.active){ render(); }
  else if(!s.moved){ fromSeqByUid(s.uid); } // 純點擊＝把磚收回手牌
}
function reorderSeq(uid, clientX){
  const slots = [...document.getElementById('seqSlots').children];
  const from = seq.findIndex(t=>t.uid===uid);
  if(from < 0) return;
  let target = slots.length;
  for(let i=0;i<slots.length;i++){
    const r = slots[i].getBoundingClientRect();
    if(clientX < r.left + r.width/2){ target = i; break; }
  }
  if(target > from) target--;
  if(target !== from && target >= 0){
    const [t] = seq.splice(from, 1);
    seq.splice(target, 0, t);
    renderSeqBar();
  }
}
function floatNum(v, cls, target){
  const layer = document.getElementById(target === 'team' ? 'teamFloat' : 'floatLayer');
  const d = document.createElement('div'); d.className = 'floatnum ' + (cls||''); d.textContent = v;
  // 敵人傷害飄在「前排」那隻上；我方飄字置中
  const baseX = target === 'team' ? 50 : (enemies.length>1 ? 28 + focusIdx*44 : 50);
  d.style.left = (baseX - 8 + Math.random()*16) + '%';
  layer.appendChild(d); setTimeout(()=>d.remove(), 1150);
}
// 局部震動：只震指定那一區（不震整個畫面）
function shakeEl(id, big){
  const g = document.getElementById(id); if(!g) return; const cls = big ? 'shakeB' : 'shakeS';
  g.classList.remove('shakeS','shakeB'); void g.offsetWidth; g.classList.add(cls);
  setTimeout(()=> g.classList.remove(cls), 480);
}
function flashEnemy(){
  const e = document.getElementById('enemyArea');
  e.classList.remove('hit'); void e.offsetWidth; e.classList.add('hit');
  setTimeout(()=> e.classList.remove('hit'), 400);
}
// 單次掉血 ≥25% → 螢幕邊緣紅光一閃
function redVignette(){
  const v = document.getElementById('vignette');
  v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash');
  setTimeout(()=> v.classList.remove('flash'), 560);
}
// 滿順出擊：整片金色光爆
function goldBurst(){
  const b = document.getElementById('burst');
  b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
  setTimeout(()=> b.classList.remove('go'), 520);
}
let logLines = [];
function log(html){ logLines.unshift(html); logLines = logLines.slice(0,5); document.getElementById('log').innerHTML = logLines.map(l=>'· '+l).join('<br>'); }
function flash(msg){ log(msg); }

// ---------- 選單／設定介面 ----------
function toggleMenu(){ document.getElementById('menuPop').classList.toggle('show'); }
function openSettings(){
  document.getElementById('menuPop').classList.remove('show');
  renderSettings();
  document.getElementById('modalMask').classList.add('show');
}
function closeModal(){ document.getElementById('modalMask').classList.remove('show'); }
function renderSettings(){
  const nameEsc = String(settings.playerName).replace(/"/g,'&quot;');
  const nickEsc = String(settings.battleNick).replace(/"/g,'&quot;');
  const nickPh = (String(settings.playerName).trim().slice(0,2) || '主角'); // 暱稱空白時的預設＝全名前 2 字
  document.getElementById('settingsModal').innerHTML =
    `<h3>設定</h3>`
    + `<div class="set-row"><label>主角名字</label><input type="text" id="setName" maxlength="8" value="${nameEsc}" placeholder="主角"></div>`
    + `<div class="set-row"><label>戰鬥暱稱（2 字內）</label><input type="text" id="setNick" maxlength="2" value="${nickEsc}" placeholder="${nickPh}"></div>`
    + `<div class="set-hint">「主角名字」＝劇情裡和其他地方角色叫你的名字；「戰鬥暱稱」＝戰鬥介面顯示用（最多 2 字）。暱稱留空就自動取名字前 2 個字。</div>`
    + `<div class="set-row"><label>主角代表色</label><input type="color" id="setColor" value="${settings.heroColor}"></div>`
    + `<div class="set-row toggle" id="setEffRow"><label>顯示卡牌詳細效果</label><span class="switch ${settings.showTileEff?'on':''}">${settings.showTileEff?'開':'關'}</span></div>`
    + `<div class="set-hint">效果字很小、顯示在每張磚下方；新手建議開著（關掉版面更簡潔，滑鼠指上去仍看得到）。</div>`
    + `<button class="modal-close" id="setClose">關閉</button>`;
  document.getElementById('setName').oninput = e => { settings.playerName = e.target.value; document.getElementById('setNick').placeholder = (e.target.value.trim().slice(0,2) || '主角'); saveSettings(); render(); };
  document.getElementById('setNick').oninput = e => { settings.battleNick = e.target.value; saveSettings(); render(); };
  document.getElementById('setColor').oninput = e => { settings.heroColor = e.target.value; applyHeroColor(); saveSettings(); render(); };
  document.getElementById('setEffRow').onclick = () => { settings.showTileEff = !settings.showTileEff; applyTileEff(); saveSettings(); renderSettings(); };
  document.getElementById('setClose').onclick = closeModal;
}

// ---------- 啟動 ----------
function init(){
  loadSettings(); applyHeroColor(); applyTileEff();
  document.getElementById('btnMenu').onclick = toggleMenu;
  document.getElementById('menuSettings').onclick = openSettings;
  document.getElementById('modalMask').onclick = e => { if(e.target.id === 'modalMask') closeModal(); };
  document.getElementById('btnStraight').onclick = autoStraight;
  document.getElementById('btnPair').onclick = autoPair;
  document.getElementById('btnClear').onclick = clearSeq;
  document.getElementById('btnAttack').onclick = attack;
  document.getElementById('btnAllIn').onclick = () => { // 只在體力滿時可切換；開了容量無限
    if(animating || over || stamina < STAMINA_MAX) return;
    allIn = !allIn; render();
  };
  // 拖放的全域監聽只掛一次（含 pointercancel，觸控被打斷也能收乾淨）
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
  document.getElementById('version').textContent = VERSION;
  document.getElementById('battleTier').textContent = '⚔ 菁英戰';
  buildPool();
  enemies.forEach(e => planEnemy(e));
  startTurn();
  log('潛淵深處，兩隻淵蟲擋在前方。排出你的招式吧。');
}
init();
