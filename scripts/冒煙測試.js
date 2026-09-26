/* ========================================================
   冒煙測試.js — 戰鬥核心的常駐自動測試（改到戰鬥規則後跑一次）
   用法：在專案根目錄執行  node scripts/冒煙測試.js  [場數，預設 2000]
   做什麼：用每個木樁預設組合，讓程式亂按（亂移動、亂放技能、亂用醫療物）打很多場，
          途中一直檢查不該發生的事：血量超出範圍、昏迷的人還在順序條、活著的人不在順序條、
          順序條有重複、前排沒人卻沒要求頂上、戰鬥打不完。任何一條出錯就報錯並結束。
   另外會印出「各組合的戰後血量分布」：每場打完，每個角色剩下的血量落在
   昏迷／30% 以下／30~70%／70% 以上 哪一格（贏的場才算，輸了本來就全昏迷）。
   注意：出招是亂按的，比真人笨很多，數字只能當相對參考（例如改數值前後比較）。
   ======================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const JS = path.join(__dirname, '..', 'js');
const ctx = { console, Math, JSON };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(JS, '00_資料.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(JS, '01_戰鬥.js'), 'utf8') +
  '\n;this.__ = { B, setupBattle, advance, startTurn, enemyAct, checkAfterAction, stepUp, stepUpCandidates, isExhausted, forcedRetreatOptions, doForcedRetreat, alivePlayers, aliveEnemies, frontAlive, skillsFor, skillUsable, useSkill, doMove, canFlip, swapCandidates, useMed, SKILLS, DUMMY_PRESETS };',
  ctx);
const G = ctx.__, B = G.B;
const pick = a => a[Math.floor(Math.random() * a.length)];
const N = +process.argv[2] || 2000;
const stats = { win: 0, lose: 0, rounds: 0, backwater: 0 };
// 戰後血量分布：per[組合名][角色名] = [昏迷, <30%, 30~70%, >70%]（只算贏的場）
const per = {};
const bucket = p => p.ko ? 0 : (p.hp / p.maxHp < 0.3 ? 1 : (p.hp / p.maxHp <= 0.7 ? 2 : 3));

for (let n = 0; n < N; n++) {
  const preset = G.DUMMY_PRESETS[n % G.DUMMY_PRESETS.length];
  G.setupBattle({ dummies: preset.dummies, med: 4 });
  let steps = 0;
  while (!B.over) {
    if (++steps > 3000) throw new Error(`第 ${n} 場打不完（${preset.name}）`);
    if (B.waiting) { if (!G.stepUp(pick(G.stepUpCandidates()).id)) throw new Error('頂上失敗'); continue; }
    G.advance();
    const u = B.cur;
    if (!u || u.ko) throw new Error('輪到不存在或昏迷的人行動');
    const r = G.startTurn(u);
    if (r === 'enemy') G.enemyAct(u);
    else if (r === 'player') {
      let ended = false;
      if (u.mustRetreat) {
        const o = G.forcedRetreatOptions(u);
        const opts = (o.flip ? [{}] : []).concat(o.swaps.map(id => ({ swap: id })));
        if (!opts.length) throw new Error('必須後撤卻沒有選項');
        ended = G.doForcedRetreat(u, pick(opts));
        if (u.mustRetreat) throw new Error('後撤失敗');
      }
      if (!ended && Math.random() < 0.4) {
        const opts = [];
        if (G.canFlip(u)) opts.push({ flip: true });
        G.swapCandidates(u).forEach(o => opts.push({ swap: o.id }));
        if (opts.length && G.doMove(u, pick(opts))) ended = true;
      }
      if (!ended) {
        const ids = G.skillsFor(u).filter(id => id && G.skillUsable(u, id));
        if (Math.random() < 0.1 && B.med > 0) G.useMed(u, pick(['aid', 'regen']), pick(G.alivePlayers()));
        else if (ids.length) {
          const id = pick(ids), s = G.SKILLS[id];
          if (s.bw) stats.backwater++;
          let extra = null;
          G.useSkill(u, id, s.target === 'enemy' ? pick(G.aliveEnemies()) : null, extra);
        }
      }
    }
    G.checkAfterAction();
    for (const x of B.units) {
      if (x.hp > x.maxHp || x.hp < 0) throw new Error(`${x.name} 血量異常：${x.hp}`);
      if (x.ko && B.cycle.includes(x.id)) throw new Error(`${x.name} 昏迷了卻還在順序條`);
      if (!x.ko && !B.cycle.includes(x.id)) throw new Error(`${x.name} 活著卻不在順序條`);
    }
    if (!B.over && !B.waiting && G.frontAlive().some(p => G.isExhausted(p))) throw new Error('脫力的人在前排');
    if (new Set(B.cycle).size !== B.cycle.length) throw new Error('順序條有重複');
    if (!B.over && !B.waiting && G.alivePlayers().length && !G.frontAlive().length) throw new Error('前排沒人卻沒要求頂上');
  }
  stats[B.over]++;
  stats.rounds += B.round;
  const pr = per[preset.name] = per[preset.name] || { n: 0, win: 0, rounds: 0, heroes: {} };
  pr.n++; pr.rounds += B.round;
  if (B.over === 'win') {
    pr.win++;
    B.units.filter(u => u.side === 'p').forEach(p => {
      const h = pr.heroes[p.name] = pr.heroes[p.name] || [0, 0, 0, 0];
      h[bucket(p)]++;
    });
  }
}
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0) + '%';
console.log('\n戰後血量分布（贏的場；昏迷／30% 以下／30~70%／70% 以上）');
for (const [name, pr] of Object.entries(per)) {
  console.log(`\n【${name}】勝率 ${pct(pr.win, pr.n)}，平均 ${(pr.rounds / pr.n).toFixed(1)} 輪`);
  for (const [hero, h] of Object.entries(pr.heroes)) {
    console.log(`  ${hero.padEnd(3, '　')} ${h.map(x => pct(x, pr.win).padStart(4)).join('  ')}`);
  }
}
console.log('');
console.log(`冒煙測試通過：${N} 場，勝 ${stats.win}／敗 ${stats.lose}，平均 ${(stats.rounds / N).toFixed(1)} 輪，背水 ${stats.backwater} 次（亂按的結果，不代表平衡）`);
