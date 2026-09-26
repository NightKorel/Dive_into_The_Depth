/* ========================================================
   冒煙測試.js — 戰鬥核心的常駐自動測試（改到戰鬥規則後跑一次）
   用法：在專案根目錄執行  node scripts/冒煙測試.js  [場數，預設 2000]
   做什麼：用每個木樁預設組合，讓程式亂按（亂移動、亂放技能、亂用醫療物）打很多場，
          途中一直檢查不該發生的事：血量超出範圍、昏迷的人還在順序條、活著的人不在順序條、
          順序條有重複、前排沒人卻沒要求頂上、戰鬥打不完。任何一條出錯就報錯並結束。
   注意：它只檢查「會不會壞」，不檢查「平不平衡」。
   ======================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const JS = path.join(__dirname, '..', 'js');
const ctx = { console, Math, JSON };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(JS, '00_資料.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(JS, '01_戰鬥.js'), 'utf8') +
  '\n;this.__ = { B, setupBattle, advance, startTurn, enemyAct, checkAfterAction, stepUp, alivePlayers, aliveEnemies, frontAlive, skillsFor, skillUsable, useSkill, doMove, canFlip, swapCandidates, useMed, SKILLS, DUMMY_PRESETS };',
  ctx);
const G = ctx.__, B = G.B;
const pick = a => a[Math.floor(Math.random() * a.length)];
const N = +process.argv[2] || 2000;
const stats = { win: 0, lose: 0, rounds: 0, backwater: 0 };

for (let n = 0; n < N; n++) {
  const preset = G.DUMMY_PRESETS[n % G.DUMMY_PRESETS.length];
  G.setupBattle({ dummies: preset.dummies, med: 4 });
  let steps = 0;
  while (!B.over) {
    if (++steps > 3000) throw new Error(`第 ${n} 場打不完（${preset.name}）`);
    if (B.waiting) { G.stepUp(pick(G.alivePlayers()).id); continue; }
    G.advance();
    const u = B.cur;
    if (!u || u.ko) throw new Error('輪到不存在或昏迷的人行動');
    const r = G.startTurn(u);
    if (r === 'enemy') G.enemyAct(u);
    else if (r === 'player') {
      let ended = false;
      if (Math.random() < 0.4) {
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
          if (s.needsChargeMode) { const f = G.frontAlive(); extra = Math.random() < 0.5 && f.length ? { swap: pick(f).id } : {}; }
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
    if (new Set(B.cycle).size !== B.cycle.length) throw new Error('順序條有重複');
    if (!B.over && !B.waiting && G.alivePlayers().length && !G.frontAlive().length) throw new Error('前排沒人卻沒要求頂上');
  }
  stats[B.over]++;
  stats.rounds += B.round;
}
console.log(`冒煙測試通過：${N} 場，勝 ${stats.win}／敗 ${stats.lose}，平均 ${(stats.rounds / N).toFixed(1)} 輪，背水 ${stats.backwater} 次（亂按的結果，不代表平衡）`);
