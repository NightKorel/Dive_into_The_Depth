/* ========================================================
   01_戰鬥.js — 戰鬥規則（不碰畫面，純邏輯）
   規格來源：設計文件/站位戰鬥_構想草稿.md

   重點：
   - 順序條＝一條一直循環的隊伍 B.cycle，B.ptr 指向正在行動的人。
     「輪」只拿來計數（ptr 繞回開頭就 +1）。
   - 往後推一格＝跟隊伍裡緊接在後面的人交換位置（永遠只影響「下一次」行動）。
   - 持續效果（嘲諷、順風、揚塵、不退）存在 B.glob，
     在「擁有者」的回合開始時倒數，歸零就消失。
   - 空過（脫力、被凍住）：那一回合視為不存在，木樁的招式循環也不往前推。
   ======================================================== */

const B = {
  units: [], cycle: [], ptr: -1, round: 1, cur: null,
  med: 0, log: [], events: [], glob: [], over: null, waiting: null, cfg: null,
  forceCrit: false,
};

// ---- 小工具 ----
function rnd() { return Math.random(); }
function randInt(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function uById(id) { return B.units.find(u => u.id === id); }
function players() { return B.units.filter(u => u.side === 'p'); }
function alivePlayers() { return players().filter(u => !u.ko); }
function enemies() { return B.units.filter(u => u.side === 'e'); }
function aliveEnemies() { return enemies().filter(u => !u.ko); }
function frontAlive() { return alivePlayers().filter(u => u.row === 'front'); }
function isND(u) { return !u.ko && u.hp < u.maxHp * DEATH_LINE; }   // 瀕死
function pctOf(u, p) { return Math.ceil(u.maxHp * p); }              // 回血無條件進位
function dmgMul() { return B.round >= ENRAGE_ROUND ? 1 + ENRAGE_STEP * (B.round - ENRAGE_ROUND + 1) : 1; }
function log(msg, cls) { B.log.push({ msg, cls: cls || '' }); if (B.log.length > 200) B.log.shift(); }
function fx(id, text, cls) { B.events.push({ id, text, cls: cls || '' }); }
function getGlob(key) { return B.glob.find(g => g.key === key); }
function addGlob(key, owner, count, data) {
  B.glob = B.glob.filter(g => g.key !== key);
  B.glob.push(Object.assign({ key, owner, count }, data || {}));
}

// ---- 開戰 ----
// cfg = { dummies: [{hp, dmg, pattern:[...]}], med }
function setupBattle(cfg) {
  B.cfg = JSON.parse(JSON.stringify(cfg));
  B.units = [];
  HERO_DATA.forEach(h => {
    B.units.push({
      id: h.id, side: 'p', name: h.name, color: h.color, data: h,
      maxHp: h.maxHp, hp: h.maxHp, spd: h.spd, critEvery: h.critEvery, critCount: 0, evade: false, prevRow: h.row, row: h.row,
      ko: false, skipNext: false, mustRetreat: false, exState: null, exFirst: false, bwUsed: false, exCount: 0, guard: false, charged: false,
      hots: [], movePt: true, startBack: false,   // movePt：移動點，每次輪到自己時刷新
    });
  });
  cfg.dummies.forEach((d, i) => {
    B.units.push({
      id: 'e' + i, side: 'e', name: '木樁 ' + (i + 1), maxHp: d.hp, hp: d.hp, dmg: d.dmg,
      spd: DUMMY_SPD, pattern: d.pattern.slice(), pi: 0, ko: false, skipNext: false,
    });
  });
  // 開場先攻：速度＋小骰子（0~3），之後固定；平手我方先
  const init = B.units.map(u => ({ id: u.id, v: u.spd + randInt(0, 3), p: u.side === 'p' ? 1 : 0 }));
  init.sort((a, b) => (b.v - a.v) || (b.p - a.p));
  B.cycle = init.map(x => x.id);
  B.ptr = -1; B.round = 1; B.cur = null;
  B.med = cfg.med; B.log = []; B.events = []; B.glob = [];
  B.over = null; B.waiting = null; B.forceCrit = false;
  log('— 戰鬥開始（第 1 輪）—', 'sys');
}

// ---- 順序條 ----
function removeFromCycle(id) {
  const i = B.cycle.indexOf(id);
  if (i < 0) return;
  B.cycle.splice(i, 1);
  if (i <= B.ptr) B.ptr--;
}
function advance() {
  if (B.ptr + 1 >= B.cycle.length) {
    B.ptr = 0; B.round++;
    log(`— 第 ${B.round} 輪 —${B.round >= ENRAGE_ROUND ? `（全場傷害 +${Math.round((dmgMul() - 1) * 100)}%）` : ''}`, 'sys');
  } else B.ptr++;
  B.cur = uById(B.cycle[B.ptr]);
}
// 接下來 n 個行動的人（含目前這位）
function upcoming(n) {
  const out = [], len = B.cycle.length;
  if (!len) return out;
  const start = B.ptr < 0 ? 0 : B.ptr;
  for (let i = 0; i < n; i++) out.push(uById(B.cycle[(start + i) % len]));
  return out;
}
// 把某人的下一次行動往後推一格
function pushBack(id) {
  const n = B.cycle.length, j = B.cycle.indexOf(id);
  if (j < 0 || n < 2) return;
  const k = (j + 1) % n;
  [B.cycle[j], B.cycle[k]] = [B.cycle[k], B.cycle[j]];
}

// ---- 回合開始 ----
// 回傳 'player' / 'enemy' / 'skip'
function startTurn(u) {
  B.glob = B.glob.filter(g => {
    if (g.owner !== u.id) return true;
    g.count--;
    if (g.count <= 0) { log(`${GLOB_NAMES[g.key] || g.key}結束了。`, 'dim'); return false; }
    return true;
  });
  if (u.side === 'p' && u.hots.length) {
    u.hots = u.hots.filter(h => { heal(u, pctOf(u, h.pct), '回春'); h.left--; return h.left > 0; });
  }
  if (u.side === 'p' && u.exState === 'recover') exhaustRecover(u);
  if (u.side === 'p' && u.exState === 'down') {
    u.exState = 'recover'; u.movePt = true;
    log(`${u.name} ${u.id === 'hero' ? (u.exFirst ? '振作中' : '硬撐中') : '脫力中'}，這回合空過。`, 'dim');
    fx(u.id, '空過', 'miss');
    return 'skip';
  }
  if (u.skipNext) {
    u.skipNext = false;
    log(`${u.name} 被凍住了，這回合空過。`, 'dim');
    fx(u.id, '空過', 'miss');
    return 'skip';
  }
  if (u.side === 'e') return 'enemy';
  u.movePt = true;
  u.evade = false;
  u.startBack = u.row === 'back';
  if (u.mustRetreat) {
    const o = forcedRetreatOptions(u);
    if (u.row !== 'front') u.mustRetreat = false;
    else if (!o.flip && !o.swaps.length) {
      u.mustRetreat = false;
      if (alivePlayers().some(p => p.row === 'back' && isExhausted(p))) collapseLine();
    }
  }
  return 'player';
}
const GLOB_NAMES = { taunt: '嘲諷', tailwind: '順風', dust: '揚塵' };

// ---- 血量變化 ----
function heal(u, amt, src) {
  if (u.ko || amt <= 0) return;
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amt);
  if (!isND(u)) u.bwUsed = false;
  fx(u.id, '+' + (u.hp - before), 'heal');
  log(`${u.name} ${src ? src + '，' : ''}回復 ${u.hp - before}。`, 'heal');
}
// 脫力（主角是振作／硬撐）。流程：觸發 → 脫力回合（空過）→ 下一次輪到他，回合開始才回血，然後照常行動。
// exState：'down'＝下次輪到要空過；'recover'＝下次輪到先回血。onOwnTurn＝自己回合換位觸發，這回合就算脫力回合。
// 脫力中（exState 有值）的人不能上前排。
function isExhausted(u) { return !!u.exState; }
function exhaust(u, onOwnTurn) {
  u.exCount++;
  u.exFirst = u.exCount === 1;
  u.exState = onOwnTurn ? 'recover' : 'down';
  const nm = u.id === 'hero' ? (u.exFirst ? '振作' : '硬撐') : '脫力';
  log(`${u.name} ${nm}：這回合喘口氣，下次輪到時才回血。`, 'heal');
  fx(u.id, nm, 'miss');
}
function exhaustRecover(u) {
  const before = u.hp;
  if (u.id === 'hero') {
    u.hp = Math.min(u.maxHp, u.hp + pctOf(u, u.exFirst ? EXHAUST_FIRST : EXHAUST_LATER));
    log(`主角${u.exFirst ? '振作' : '硬撐'}起來：血量 +${u.hp - before}。`, 'heal');
    fx(u.id, (u.exFirst ? '振作 +' : '硬撐 +') + (u.hp - before), 'heal');
  } else {
    const target = pctOf(u, u.exFirst ? EXHAUST_FIRST : EXHAUST_LATER);
    if (u.hp < target) u.hp = target;
    log(`${u.name} 撐起來了：血量回到 ${u.hp}。`, 'heal');
    fx(u.id, '+' + (u.hp - before), 'heal');
  }
  u.exState = null;
  if (!isND(u)) u.bwUsed = false;
}
function knockOut(p) {
  p.hp = 0; p.ko = true; p.row = 'back'; p.hots = []; p.guard = false; p.charged = false; p.skipNext = false; p.exState = null; p.mustRetreat = false; p.evade = false;
  removeFromCycle(p.id);
  B.glob = B.glob.filter(g => g.owner !== p.id);
  log(`${p.name} 昏迷了！`, 'bad');
  fx(p.id, '昏迷', 'bad');
}
function damagePlayer(p, d, src) {
  const wasND = isND(p);
  p.hp -= d;
  fx(p.id, '-' + d, 'dmg');
  if (p.hp <= 0) {
    const tg = getGlob('taunt');
    if (tg && tg.lock && tg.owner === p.id) {
      p.hp = 1; tg.lock = false;
      log(`不退：${p.name} 撐住，留下 1 血！`, 'good');
      fx(p.id, '撐住！', 'good');
    } else { knockOut(p); return; }
  }
  if (!wasND && isND(p)) {
    p.bwUsed = false;
    log(`${p.name} 瀕死！`, 'bad');
    if (p.row === 'back') exhaust(p, false);
  }
}

// ---- 我方打敵人 ----
// 爆擊：①計數：每出第 N 招攻擊必爆（一般 5、L 3；這招每一下都爆），爆了就重新計數（在 useSkill 裡算）；
//       ②這招自己的爆擊率（opt.crit，如飛刀、刀舞）＋順風，是額外的機率；③蓄力必爆。
function hit(u, e, base, opt) {
  if (!e || e.ko) return null;
  opt = opt || {};
  // base 可以是技能 id（查 SKILL_DMG 範圍、隨機取整數）或直接給數字
  let d = typeof base === 'string' ? randInt(SKILL_DMG[base][0], SKILL_DMG[base][1]) : base;
  d *= dmgMul();
  let rate = opt.crit || 0;
  if (getGlob('tailwind')) rate += TAILWIND_CRIT;
  const crit = B.forceCrit || B.counterCrit || (rate > 0 && rnd() < rate);
  if (crit) B.anyCrit = true;
  B.hitCount++;
  if (B.forceCrit) B.chargeUsed = true;
  if (crit) d *= CRIT_MUL;
  d = Math.floor(d);
  e.hp = Math.max(0, e.hp - d);
  fx(e.id, (crit ? '爆擊 ' : '') + '-' + d, crit ? 'crit' : 'dmg');
  log(`${u.name} → ${e.name}：${d}${crit ? '（爆擊）' : ''}`);
  if (e.hp <= 0) {
    e.ko = true; removeFromCycle(e.id);
    log(`${e.name} 倒下了。`, 'good');
  }
  return { d, crit, kill: e.ko };
}

// ---- 技能 ----
// 傷害範圍寫在說明最後，例：（14~16）
function dr(key) { const r = SKILL_DMG[key]; return `（${r[0]}~${r[1]}）`; }
// target：'enemy'＝要點一隻敵人、'none'＝直接放
const SKILLS = {
  // 主角
  slash: { name: '劈斬', desc: '單傷' + dr('slash'), target: 'enemy', run(u, t) { hit(u, t, 'slash'); } },
  taunt: { name: '嘲諷', desc: '嘲諷全體敵人（單攻都打他），到他下個回合', target: 'none',
    run(u) { addGlob('taunt', u.id, 1); log('嘲諷：單攻都會打主角（到他下個回合）。', 'good'); } },
  charge_in: { name: '突襲', desc: '衝上前排單傷，打完留在前排；回合開始就在後排、這回合沒換位才能用' + dr('charge_in'),
    target: 'enemy', needsChargeMode: true,
    usable(u) { return u.startBack && u.movePt && u.row === 'back'; },
    run(u, t, extra) {
      if (extra && extra.swap) { const o = uById(extra.swap); if (o && !o.ko && o.row === 'front' && o.movePt) { o.row = 'back'; o.movePt = false; if (isND(o)) exhaust(o, false); } }
      u.row = 'front'; u.movePt = false;
      hit(u, t, 'charge_in');
    } },
  hero_b2: { name: '主角後排 2', desc: '（名字待定）全體超小傷害，並打斷蓄力中的敵人（跳過牠下一記群攻）（每隻 ' + SKILL_DMG.hero_b2.join('~') + '）', target: 'none',
    run(u) {
      aliveEnemies().forEach(e => {
        hit(u, e, 'hero_b2');
        if (!e.ko && e.pattern.length && e.pattern[e.pi % e.pattern.length] === 'group') {
          e.pi++;
          log(`${e.name} 的蓄力被打斷了！`, 'good'); fx(e.id, '打斷', 'miss');
        }
      });
    } },
  hold: { name: '不退', desc: '背水：到他下個回合，所有攻擊都衝著他來，每被打一次就反擊；第一擊致命傷留 1 血（反擊 ' + SKILL_DMG.hold_counter.join('~') + '）', target: 'none', bw: true,
    run(u) { addGlob('taunt', u.id, 1, { counter: true, lock: true }); log('主角：「想過去？先過我這關！」（佔位）', 'good'); } },
  // V
  guard: { name: '格擋', desc: '下一次受到的傷害減 50%', target: 'none',
    run(u) { u.guard = true; log('格擋：V 下一次受傷減半。'); } },
  rend: { name: '割裂', desc: '單傷' + dr('rend'), target: 'enemy', run(u, t) { hit(u, t, 'rend'); } },
  knives: { name: '飛刀', desc: '擲三把，隨機打敵人，爆擊率 30%（每把 ' + SKILL_DMG.knives.join('~') + '）', target: 'none',
    run(u) { for (let i = 0; i < 3; i++) { const es = aliveEnemies(); if (!es.length) break; hit(u, pick(es), 'knives', { crit: 0.3 }); } } },
  focus: { name: '蓄力', desc: '下一次攻擊必定爆擊（飛刀三把都算）', target: 'none',
    run(u) { u.charged = true; log('蓄力：V 下一招必定爆擊。'); } },
  bladedance: { name: '刀舞', desc: '背水：單傷、爆擊率 50%，擊殺就再攻擊一次（隨機目標），可以一直連下去' + dr('bladedance'), target: 'enemy', bw: true,
    run(u, t) {
      let target = t, n = 0;
      while (target && n < 12) {
        const r = hit(u, target, 'bladedance', { crit: 0.5 }); n++;
        if (!r || !r.kill) break;
        const es = aliveEnemies(); target = es.length ? pick(es) : null;
        if (target) log('刀舞擊殺，再攻擊一次！', 'good');
      }
    } },
  // K
  double: { name: '雙擊', desc: '單傷打兩下（每下 ' + SKILL_DMG.double.join('~') + '）', target: 'enemy', run(u, t) { hit(u, t, 'double'); hit(u, t, 'double'); } },
  dust: { name: '揚塵', desc: '全體敵人 20% 失手，持續兩回合（到 K 的第二個下回合）', target: 'none',
    run(u) { addGlob('dust', u.id, 2); log('揚塵：敵人 20% 失手（兩回合）。'); } },
  windblade: { name: '風刃', desc: '群傷（每隻 ' + SKILL_DMG.windblade.join('~') + '）', target: 'none',
    run(u) { aliveEnemies().forEach(e => hit(u, e, 'windblade')); } },
  tailwind: { name: '順風', desc: '全隊爆擊率 +20%，到 K 的下個回合', target: 'none',
    run(u) { addGlob('tailwind', u.id, 1); log('順風：全隊爆擊率 +20%（到 K 下個回合）。', 'good'); } },
  k_bw: { name: 'K 背水', desc: '背水（名字待定）：大群傷（每隻 ' + SKILL_DMG.k_bw.join('~') + '）', target: 'none', bw: true,
    run(u) { aliveEnemies().forEach(e => hit(u, e, 'k_bw')); } },
  // L
  frostburst: { name: '霜觸', desc: '近身單傷' + dr('frostburst'), target: 'enemy', run(u, t) { hit(u, t, 'frostburst'); } },
  hail: { name: '冰雹', desc: '擲 4d3 決定顆數（4~12 顆），每顆隨機打一隻敵人（每顆 ' + SKILL_DMG.hail.join('~') + '）', target: 'none',
    run(u) {
      const n = randInt(1, 3) + randInt(1, 3) + randInt(1, 3) + randInt(1, 3);
      log(`冰雹：${n} 顆！`, 'act');
      for (let i = 0; i < n; i++) { const es = aliveEnemies(); if (!es.length) break; hit(u, pick(es), 'hail'); }
    } },
  icespike: { name: '冰刺', desc: '單傷，全隊最高' + dr('icespike'), target: 'enemy', run(u, t) { hit(u, t, 'icespike'); } },
  freeze: { name: '凍結', desc: '一隻敵人的下一次行動往後推一格', target: 'enemy',
    run(u, t) { pushBack(t.id); log(`凍結：${t.name} 的下一次行動往後一格。`); fx(t.id, '往後一格', 'miss'); } },
  bloodfrost: { name: '血霜花', desc: '背水：群傷，每隻 50% 被凍住（跳過下一次行動）（每隻 ' + SKILL_DMG.bloodfrost.join('~') + '）', target: 'none', bw: true,
    run(u) {
      aliveEnemies().forEach(e => {
        const r = hit(u, e, 'bloodfrost');
        if (r && !r.kill && rnd() < 0.5) { e.skipNext = true; log(`${e.name} 被凍住（空過下一次行動）。`, 'good'); fx(e.id, '凍住', 'miss'); }
      });
    } },
};

// 這位角色現在能用的技能（null＝空格）
function skillsFor(u) {
  if (u.row === 'front' && isND(u) && !u.bwUsed) return [u.data.bw];
  return u.row === 'front' ? u.data.front : u.data.back;
}
function skillUsable(u, id) {
  const s = SKILLS[id];
  if (!s) return false;
  return s.usable ? s.usable(u) : true;
}

// ---- 我方行動 ----
function canFlip(u) { return u.row === 'back' || frontAlive().length > 1; }
// 移動點（像 DnD 的移動速度）：每人一點，輪到自己時刷新；只能在自己行動前用。
// 對調＝兩個人都花掉移動點，所以想等一下被隊友換走的人，自己這回合就不能先動。敵人造成的移位、昏迷補位不算。
function swapCandidates(u) { return alivePlayers().filter(o => o !== u && o.row !== u.row && o.movePt && !(o.row === 'back' && isExhausted(o))); }
// opt: {flip:true} 或 {swap:id}；回傳 true＝自己脫力，這回合結束
function doMove(u, opt) {
  if (!u.movePt) return false;
  const moved = [u];
  if (opt.swap) {
    const o = uById(opt.swap);
    if (!o || o.ko || o.row === u.row || !o.movePt) return false;
    if (o.row === 'back' && isExhausted(o)) return false;   // 脫力的人不能上前排
    const r = u.row; u.row = o.row; o.row = r; o.movePt = false; moved.push(o);
  } else {
    if (!canFlip(u)) return false;
    if (u.row === 'back' && isExhausted(u)) return false;
    u.row = u.row === 'front' ? 'back' : 'front';
  }
  u.movePt = false;
  log(`${u.name} 移到${u.row === 'front' ? '前排' : '後排'}。`, 'dim');
  let selfEx = false;
  moved.forEach(m => {
    if (m.row === 'back' && isND(m)) { exhaust(m, m === u); if (m === u) selfEx = true; }
  });
  return selfEx;
}
function useSkill(u, id, target, extra) {
  const s = SKILLS[id];
  if (!s || !skillUsable(u, id)) return false;
  // 蓄力：這一招裡的每一下都必定爆擊；有打到人才算用掉
  B.forceCrit = !!u.charged;
  B.chargeUsed = false;
  // 爆擊計數：這招算一次；湊滿就這招每一下都爆。沒打到人的招（格擋、嘲諷…）不算
  u.critCount++;
  B.counterCrit = u.critCount >= u.critEvery;
  B.hitCount = 0; B.anyCrit = false;
  log(`${u.name}：${s.name}`, s.bw ? 'bw' : 'act');
  s.run(u, target, extra);
  if (B.chargeUsed) u.charged = false;
  if (!B.hitCount) u.critCount--;
  else if (B.anyCrit) u.critCount = 0;
  B.forceCrit = false; B.counterCrit = false;
  if (s.bw) { u.bwUsed = true; u.mustRetreat = true; }   // 用過背水，下次輪到必須撤退
  return true;
}
function useMed(u, kind, t) {
  if (B.med <= 0 || !t || t.ko) return false;
  B.med--;
  const bonus = u.id === 'k' ? pctOf(t, K_HEAL_BONUS) : 0;
  if (kind === 'aid') {
    log(`${u.name} 替 ${t.name} 急救。`, 'act');
    heal(t, pctOf(t, FIRST_AID) + bonus, u.id === 'k' ? '急救＋治癒' : '急救');
  } else {
    log(`${u.name} 替 ${t.name} 用回春（之後 3 回合各回 15%）。`, 'act');
    if (bonus) heal(t, bonus, '治癒');
    t.hots.push({ pct: REGEN, left: REGEN_TICKS });
  }
  return true;
}

// ---- 敵人行動 ----
function enemyAct(e) {
  const act = e.pattern.length ? e.pattern[e.pi % e.pattern.length] : 'idle';
  e.pi++;
  if (act === 'idle') { log(`${e.name} 發呆。`, 'dim'); return; }
  if (act === 'single') {
    let t = null;
    const tg = getGlob('taunt');
    if (tg) { const h = uById(tg.owner); if (h && !h.ko) t = h; }
    if (!t) { const f = frontAlive(); if (f.length) t = f.reduce((a, b) => (b.hp < a.hp ? b : a)); }   // 沒嘲諷就打前排血最少的
    if (!t) return;
    log(`${e.name} 攻擊 ${t.name}。`, 'enemy');
    attackPlayer(e, t, e.dmg, 1);
  } else if (act === 'group') {
    const f = frontAlive();
    const mul = f.length === 1 ? GROUP_SOLO_MUL : 1;
    log(`${e.name} 群攻前排！${mul > 1 ? '（前排只有一人，×1.7）' : ''}`, 'enemy');
    for (const p of f) { if (e.ko) break; attackPlayer(e, p, e.dmg * GROUP_RATIO, mul); }
  } else if (act === 'swap') {
    const onlyFront = frontAlive().length === 1 ? frontAlive()[0] : null;
    const cands = alivePlayers().filter(p => p !== onlyFront && !isExhausted(p));   // 前排還有人時，脫力的人不可選中
    if (!cands.length) { log(`${e.name} 換位失敗（沒有能換的人）。`, 'dim'); return; }
    const t = pick(cands);
    t.row = t.row === 'front' ? 'back' : 'front';
    log(`${e.name} 把 ${t.name} 換到${t.row === 'front' ? '前排' : '後排'}！`, 'enemy');
    fx(t.id, t.row === 'front' ? '被拖上前' : '被推回去', 'miss');
    if (t.row === 'back' && isND(t)) exhaust(t, false);
  } else if (act === 'push') {
    const t = pick(alivePlayers().filter(p => !isExhausted(p)));
    if (!t) return;
    pushBack(t.id);
    log(`${e.name} 把 ${t.name} 的下一次行動往後一格。`, 'enemy');
    fx(t.id, '往後一格', 'miss');
  }
}
function attackPlayer(e, p, base, mul) {
  if (p.ko) return;
  if (getGlob('dust') && rnd() < DUST_MISS) { log(`${e.name} 失手（揚塵）。`, 'good'); fx(p.id, 'MISS', 'miss'); return; }
  if (p.evade) { p.evade = false; log(`${p.name} 閃開了（靈巧）。`, 'good'); fx(p.id, '閃避', 'miss'); return; }
  let d = base * mul * (1 - ENEMY_SWING + rnd() * ENEMY_SWING * 2) * dmgMul();
  d = Math.max(1, Math.floor(d));
  if (p.guard) { d = Math.floor(d * 0.5); p.guard = false; log(`${p.name} 格擋，傷害減半。`, 'good'); }
  damagePlayer(p, d, e);
  const tg = getGlob('taunt');
  if (tg && tg.counter && tg.owner === p.id && !p.ko && !e.ko) {
    log('不退：主角反擊！', 'good');
    hit(p, e, 'hold_counter');
  }
}

// ---- 狀態檢查 ----
// 前排空了（還有人活著）→ 等玩家選誰頂上
// 位置變動後同步：V 從後排進前排 → 靈巧待命（到他下次輪到前，第一次被打閃掉）；回後排就取消
function syncRows() {
  players().forEach(p => {
    if (p.id === 'v') {
      if (p.prevRow === 'back' && p.row === 'front' && !p.ko) p.evade = true;
      if (p.row !== 'front') p.evade = false;
    }
    p.prevRow = p.row;
  });
}
function checkAfterAction() {
  syncRows();
  if (!aliveEnemies().length) { B.over = 'win'; log('— 勝利！—', 'good'); return; }
  if (!alivePlayers().length) { B.over = 'lose'; log('— 全滅 —', 'bad'); return; }
  if (!frontAlive().length) {
    if (stepUpCandidates().length) B.waiting = { type: 'stepup' };
    else collapseLine();
  }
}
// 戰線崩潰：前排空了、後排又全是脫力的人 → 所有人一起被逼上前排；
// 脫力被打斷（不回血、維持瀕死），而且背水刷新可以再用。
function collapseLine() {
  log('沒有戰線了！所有人一起被逼上前排。', 'bad');
  alivePlayers().forEach(p => {
    p.row = 'front';
    p.mustRetreat = false;
    if (p.exState) { p.exState = null; p.bwUsed = false; log(`${p.name} 的脫力被打斷，背水可以再用。`, 'bw'); fx(p.id, '被打斷', 'bad'); }
  });
  syncRows();
}
// 背水後必須撤退：移到後排空位（前排還有別人時），或跟後排一個沒在脫力的人對調（強制，不看對方移動點，但會用掉）
function forcedRetreatOptions(u) {
  return {
    flip: frontAlive().length > 1,
    swaps: alivePlayers().filter(o => o.row === 'back' && !isExhausted(o)).map(o => o.id),
  };
}
function doForcedRetreat(u, opt) {
  if (!u.mustRetreat || u.row !== 'front') return false;
  const o = forcedRetreatOptions(u);
  if (opt.swap) {
    if (!o.swaps.includes(opt.swap)) return false;
    const p = uById(opt.swap); p.row = 'front'; p.movePt = false;
    log(`${u.name} 撤退，${p.name} 頂上。`, 'act');
  } else {
    if (!o.flip) return false;
    log(`${u.name} 撤到後排。`, 'act');
  }
  u.row = 'back'; u.movePt = false; u.mustRetreat = false;
  if (isND(u)) { exhaust(u, true); return true; }
  return false;
}
// 可以頂上的人：脫力中的不能上前排（全都在脫力＝戰線崩潰，見 collapseLine）
function stepUpCandidates() { return alivePlayers().filter(p => !isExhausted(p)); }
function stepUp(id) {
  const p = uById(id);
  if (!p || p.ko || !stepUpCandidates().includes(p)) return false;
  p.row = 'front';
  B.waiting = null;
  syncRows();
  log(`${p.name} 頂上前排！`, 'act');
  return true;
}
