/* ========================================================
   02_畫面.js — 畫面與操作（木樁設定面板、戰鬥畫面、回合流程）
   規則都在 01_戰鬥.js，這裡只負責畫出來、接玩家的點擊。
   ======================================================== */

const ui = { screen: 'setup', pending: null, cfg: null };
const CFG_KEY = 'yuan2_dummy_cfg_v2';  // 預設組合改過數值就換版本號，舊設定才不會蓋掉新預設
const $ = sel => document.querySelector(sel);
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ================= 木樁設定面板 =================
function defaultCfg() {
  return presetToCfg(DUMMY_PRESETS[3]);
}
function presetToCfg(p) {
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const d = p.dummies[i];
    slots.push(d ? { on: true, hp: d.hp, dmg: d.dmg, pattern: d.pattern.slice() }
                 : { on: false, hp: 150, dmg: 14, pattern: ['single', 'single', 'single', 'single'] });
  }
  return { slots, med: MED_START };
}
function loadCfg() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) { const c = JSON.parse(raw); if (c && c.slots && c.slots.length === 4) return c; }
  } catch (e) { /* 讀不到就用預設 */ }
  return defaultCfg();
}
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(ui.cfg)); } catch (e) { /* 存不了就算了 */ } }

function renderSetup() {
  const c = ui.cfg;
  const presetBtns = DUMMY_PRESETS.map((p, i) => `<button class="btn small" onclick="applyPreset(${i})">${esc(p.name)}</button>`).join('');
  const cards = c.slots.map((s, i) => {
    const sel = j => `<select onchange="setPattern(${i},${j},this.value)" ${s.on ? '' : 'disabled'}>` +
      Object.entries(DUMMY_ACTIONS).map(([k, v]) => `<option value="${k}" ${s.pattern[j] === k ? 'selected' : ''}>${v}</option>`).join('') + '</select>';
    return `<div class="dummy-card ${s.on ? '' : 'off'}">
      <label class="dummy-head"><input type="checkbox" ${s.on ? 'checked' : ''} onchange="toggleDummy(${i},this.checked)"> 木樁 ${i + 1}</label>
      <div class="slider-row"><span>血量</span><input type="range" min="50" max="600" step="10" value="${s.hp}" ${s.on ? '' : 'disabled'} oninput="setVal(${i},'hp',this.value)"><b id="hp${i}">${s.hp}</b></div>
      <div class="slider-row"><span>攻擊</span><input type="range" min="4" max="60" step="1" value="${s.dmg}" ${s.on ? '' : 'disabled'} oninput="setVal(${i},'dmg',this.value)"><b id="dmg${i}">${s.dmg}</b></div>
      <div class="pattern">${[0, 1, 2, 3].map(sel).join('<span class="arrow">→</span>')}</div>
    </div>`;
  }).join('');
  $('#app').innerHTML = `
    <div class="setup">
      <h1 class="title">潛淵</h1>
      <p class="subtitle">戰鬥原型 · 木樁測試</p>
      <div class="panel">
        <div class="panel-title">預設組合</div>
        <div class="preset-row">${presetBtns}</div>
      </div>
      <div class="panel">
        <div class="panel-title">木樁設定（一到四隻；四個招式照順序循環）</div>
        <div class="dummy-grid">${cards}</div>
        <div class="slider-row med-row"><span>醫療物</span><input type="range" min="0" max="8" step="1" value="${c.med}" oninput="setMed(this.value)"><b id="medv">${c.med}</b></div>
        <p class="hint">群攻每人吃「攻擊 ×0.7」，前排只剩一人時再 ×1.7。換位：隨機挑一人換到另一排（不會把最後一個前排推走）。推順序：隨機挑一人，下一次行動往後一格。</p>
      </div>
      <button class="btn primary big" onclick="beginBattle()" ${c.slots.some(s => s.on) ? '' : 'disabled'}>開戰</button>
      <p class="archive-link"><a href="封存/淵2戰鬥原型_v0.2.60/">舊版戰鬥原型（封存）</a></p>
    </div>`;
}
function applyPreset(i) { ui.cfg = presetToCfg(DUMMY_PRESETS[i]); ui.cfg.med = MED_START; saveCfg(); renderSetup(); }
function toggleDummy(i, on) { ui.cfg.slots[i].on = on; saveCfg(); renderSetup(); }
function setVal(i, key, v) { ui.cfg.slots[i][key] = +v; const el = $('#' + key + i); if (el) el.textContent = v; saveCfg(); }
function setPattern(i, j, v) { ui.cfg.slots[i].pattern[j] = v; saveCfg(); }
function setMed(v) { ui.cfg.med = +v; $('#medv').textContent = v; saveCfg(); }

// ================= 回合流程 =================
function beginBattle() {
  const dummies = ui.cfg.slots.filter(s => s.on).map(s => ({ hp: s.hp, dmg: s.dmg, pattern: s.pattern.slice() }));
  if (!dummies.length) return;
  setupBattle({ dummies, med: ui.cfg.med });
  stepSeq++;
  ui.screen = 'battle'; ui.pending = null;
  guard(nextTurn);
}
let busy = false;
// 回合流程一次只准有「一個」排隊中的下一步：每排一次就拿新號碼，舊號碼的計時器醒來發現不是最新就自己作廢。
// （v0.0.3 的 bug：玩家想很久才出手，看門狗誤以為卡住又多啟動一條流程，兩條流程搶著走，敵人回合拿到我方角色而出錯。）
let stepSeq = 0;
let lastProgress = Date.now();
function later(fn, ms) {
  const my = ++stepSeq;
  setTimeout(() => {
    if (my !== stepSeq || ui.screen !== 'battle') return;
    lastProgress = Date.now();
    guard(fn);
  }, ms);
}
// 包一層防護：出錯時把錯誤顯示在畫面上，並嘗試繼續，不讓整個遊戲停住
function guard(fn) {
  try { fn(); } catch (err) { showError(err); busy = false; later(nextTurn, 600); }
}
function showError(err) {
  console.error(err);
  const box = $('#errBox');
  if (box) { box.textContent = '出錯了（請截圖給 Claude）：' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ／ ') : err); box.style.display = 'block'; }
}
function nextTurn() {
  if (ui.screen !== 'battle') return;
  lastProgress = Date.now();
  if (B.over || B.waiting) { busy = true; render(); return; }
  advance();
  const r = startTurn(B.cur);
  ui.pending = null;
  busy = r !== 'player';
  render();
  if (r === 'player') return;
  if (r === 'skip') { checkAfterAction(); later(nextTurn, 500); return; }
  const e = B.cur;
  later(() => {
    if (B.cur === e && !e.ko) enemyAct(e);
    checkAfterAction();
    render();
    later(nextTurn, 450);
  }, 550);
}
function endPlayerTurn() {
  busy = true;
  lastProgress = Date.now();
  ui.pending = null;
  checkAfterAction();
  render();
  later(nextTurn, 300);
}
// 看門狗：電腦在跑流程（不是等玩家、不是結束、不是等人頂上）卻超過 4 秒沒動靜，就作廢排隊中的步驟、重新往下走
setInterval(() => {
  if (ui.screen !== 'battle' || !busy || B.over || B.waiting) return;
  if (Date.now() - lastProgress > 4000) {
    log('（看門狗：流程卡住，自動恢復）', 'dim');
    stepSeq++;
    busy = false;
    guard(nextTurn);
  }
}, 1000);
window.addEventListener('error', e => showError(e.error || e.message));
function myTurn() { return ui.screen === 'battle' && !busy && !B.over && !B.waiting && B.cur && B.cur.side === 'p'; }

// ---- 玩家點擊 ----
function clickMoveMenu() { if (!myTurn() || !B.cur.movePt) return; ui.pending = { type: 'move' }; render(); }
function clickMove(opt) {
  if (!myTurn()) return;
  ui.pending = null;
  const selfEx = doMove(B.cur, opt);
  if (selfEx) { endPlayerTurn(); return; }
  render();
}
function clickSkill(id) {
  if (!myTurn()) return;
  const u = B.cur, s = SKILLS[id];
  if (!s || !skillUsable(u, id)) return;
  if (s.needsChargeMode) {
    const fronts = frontAlive();
    if (!fronts.length) { ui.pending = { type: 'target', id, extra: {} }; render(); return; }
    ui.pending = { type: 'charge', id }; render(); return;
  }
  if (s.target === 'enemy') { ui.pending = { type: 'target', id, extra: null }; render(); return; }
  useSkill(u, id, null, null);
  endPlayerTurn();
}
function chooseCharge(swapId) {
  if (!ui.pending || ui.pending.type !== 'charge') return;
  ui.pending = { type: 'target', id: ui.pending.id, extra: swapId ? { swap: swapId } : {} };
  render();
}
function clickEnemy(id) {
  if (!myTurn() || !ui.pending || ui.pending.type !== 'target') return;
  const e = uById(id);
  if (!e || e.ko) return;
  useSkill(B.cur, ui.pending.id, e, ui.pending.extra);
  endPlayerTurn();
}
function clickMed(kind) {
  if (!myTurn() || B.med <= 0) return;
  ui.pending = { type: 'med', kind }; render();
}
function clickAlly(id) {
  if (B.waiting && B.waiting.type === 'stepup') { chooseStepUp(id); return; }
  if (!myTurn() || !ui.pending || ui.pending.type !== 'med') return;
  const t = uById(id);
  if (!t || t.ko) return;
  useMed(B.cur, ui.pending.kind, t);
  endPlayerTurn();
}
// 沒有任何能用的招（例：主角移動後在後排，突襲不能用、另一格待定）時才出現的「結束回合」
function clickEndTurn() { if (!myTurn()) return; log(`${B.cur.name} 沒有能用的招，結束回合。`, 'dim'); endPlayerTurn(); }
function cancelPending() { ui.pending = null; render(); }
function chooseStepUp(id) {
  if (!B.waiting) return;
  if (!stepUp(id)) return;
  render();
  later(nextTurn, 300);
}
function retryBattle() { setupBattle(B.cfg); stepSeq++; ui.screen = 'battle'; ui.pending = null; guard(nextTurn); }
function backToSetup() { stepSeq++; ui.screen = 'setup'; busy = false; renderSetup(); }

// ================= 戰鬥畫面（手機一畫面看完：精簡版面） =================
function shortName(u) { return u.side === 'e' ? '樁' + u.name.replace(/\D/g, '') : u.name; }
function hpBar(u) {
  const w = Math.max(0, Math.round(u.hp / u.maxHp * 100));
  const nd = u.side === 'p' && isND(u);
  return `<div class="hpbar ${nd ? 'nd' : ''} ${u.side === 'e' ? 'enemy' : ''}"><div class="fill" style="width:${w}%"></div><div class="line"></div></div>`;
}
function badges(u) {
  const b = [];
  if (u.ko) return '<span class="badge ko">昏迷</span>';
  if (isND(u)) b.push(`<span class="badge nd">瀕死${u.bwUsed ? '·背水已用' : ''}</span>`);
  if (u.exState) b.push(`<span class="badge ex">${u.id === 'hero' ? (u.exFirst ? '振作中' : '硬撐中') : '脫力'}</span>`);
  if (u.guard) b.push('<span class="badge">格擋</span>');
  if (u.charged) b.push('<span class="badge">蓄力</span>');
  if (u.hots.length) b.push(`<span class="badge heal">回春${u.hots.reduce((a, h) => a + h.left, 0)}</span>`);
  const tg = getGlob('taunt');
  if (tg && tg.owner === u.id) b.push(`<span class="badge bw">${tg.counter ? '不退' : '嘲諷'}</span>`);
  return b.join('');
}
// 順序條：目前行動的人放大在最前面，後面一排小圓點
function renderOrder() {
  const list = upcoming(Math.min(9, Math.max(B.cycle.length + 3, 6)));
  return list.map((u, i) => {
    if (!u) return '';
    const col = u.side === 'p' ? u.color : '#bf616a';
    const cls = i === 0 ? 'now' : '';
    return `${i === 1 ? '<span class="ord-sep">›</span>' : ''}<span class="ord ${cls} ${u.skipNext || u.exState === 'down' ? 'skip' : ''} ${u.side}" style="--c:${col}">${esc(shortName(u))}</span>`;
  }).join('');
}
function renderEnemies() {
  const targeting = myTurn() && ui.pending && ui.pending.type === 'target';
  return enemies().map(e => {
    const next = e.pattern.length ? e.pattern[e.pi % e.pattern.length] : 'idle';
    const charging = !e.ko && next === 'group';
    const tags = (e.skipNext ? '<span class="badge ex">凍住</span>' : '') + (charging ? '<span class="badge warn">蓄力中……</span>' : '');
    return `<div class="card enemy ${e.ko ? 'dead' : ''} ${charging ? 'charging' : ''} ${targeting && !e.ko ? 'targetable' : ''} ${B.cur === e ? 'acting' : ''}"
      data-id="${e.id}" onclick="clickEnemy('${e.id}')">
      <div class="crow"><span class="cname">${esc(e.name)}</span><span class="hpnum">${e.ko ? '倒下' : e.hp}</span></div>
      ${hpBar(e)}${tags ? `<div class="badges">${tags}</div>` : ''}
    </div>`;
  }).join('');
}
function renderPartyRow(row) {
  const medPick = myTurn() && ui.pending && ui.pending.type === 'med';
  const stepPick = B.waiting && B.waiting.type === 'stepup';
  const list = players().filter(p => p.row === row);
  if (!list.length) return '<div class="empty-row">（空）</div>';
  return list.map(p => {
    const pickable = (medPick && !p.ko) || (stepPick && stepUpCandidates().includes(p));
    const bd = badges(p);
    return `<div class="card ally ${p.ko ? 'dead' : ''} ${B.cur === p ? 'acting' : ''} ${pickable ? 'targetable' : ''}"
      data-id="${p.id}" style="--c:${p.color}" onclick="clickAlly('${p.id}')">
      <div class="crow"><span class="cname" style="color:${p.color}">${esc(p.name)}${p.ko ? '' : `<span class="mv ${p.movePt ? '' : 'used'}" title="${p.movePt ? '還有移動點' : '移動點用掉了'}">🔁</span>`}</span><span class="hpnum">${p.hp}/${p.maxHp}</span></div>
      ${hpBar(p)}${bd ? `<div class="badges">${bd}</div>` : ''}
    </div>`;
  }).join('');
}
function skillBtn(u, id, side) {
  if (!id) {
    const nm = (u.data.emptyName && u.data.emptyName[side]) || '待定';
    return `<button class="btn skill" disabled><b>${esc(nm)}</b><small>還沒定</small></button>`;
  }
  const s = SKILLS[id];
  const ok = skillUsable(u, id);
  return `<button class="btn skill ${s.bw ? 'bw' : ''}" ${ok ? '' : 'disabled'} onclick="clickSkill('${id}')">
    <b>${esc(s.name)}</b><small>${esc(s.desc)}</small></button>`;
}
function renderActions() {
  if (B.over) return '';
  if (B.waiting && B.waiting.type === 'stepup') return '<div class="prompt">前排沒人了！點一名後排角色頂上前排。</div>';
  const u = B.cur;
  if (!u || u.side !== 'p' || busy) return `<div class="prompt dim">${u ? esc(u.name) + ' 行動中……' : ''}</div>`;
  const side = u.row;
  let html = `<div class="act-head"><b style="color:${u.color}">${esc(u.name)}</b><span class="dim">・${side === 'front' ? '前排' : '後排'}</span><span class="trait">${esc(u.data.trait)}</span></div>`;
  if (ui.pending) {
    const p = ui.pending;
    if (p.type === 'target') html += `<div class="prompt">點一隻敵人（${esc(SKILLS[p.id].name)}）</div>`;
    if (p.type === 'med') html += `<div class="prompt">點一名隊友（${p.kind === 'aid' ? '急救' : '回春'}）</div>`;
    if (p.type === 'charge') {
      html += '<div class="prompt">突襲：衝進空位，還是跟前排的人對調？</div><div class="btn-row">';
      html += `<button class="btn" onclick="chooseCharge(null)">衝進空位</button>`;
      frontAlive().forEach(f => { html += `<button class="btn" ${f.movePt ? '' : 'disabled'} onclick="chooseCharge('${f.id}')">跟 ${esc(f.name)} 對調${f.movePt ? '' : '（沒移動點）'}</button>`; });
      html += '</div>';
    }
    if (p.type === 'move') {
      const to = side === 'front' ? '後排' : '前排';
      html += `<div class="prompt">換位：移到${to}空位，還是跟${to}的人對調？（對調會用掉兩人的移動點）</div><div class="btn-row">`;
      html += `<button class="btn" ${canFlip(u) ? '' : 'disabled'} onclick="clickMove({flip:true})">移到${to}空位</button>`;
      alivePlayers().filter(o => o !== u && o.row !== side).forEach(o => { const ok = swapCandidates(u).includes(o); const why = !o.movePt ? '（沒移動點）' : (!ok ? '（脫力中，不能上前排）' : ''); html += `<button class="btn" ${ok ? '' : 'disabled'} onclick="clickMove({swap:'${o.id}'})">跟 ${esc(o.name)} 對調${why}</button>`; });
      html += '</div>';
    }
    html += `<button class="btn small ghost" onclick="cancelPending()">取消</button>`;
    return html;
  }
  const ids = skillsFor(u);
  const anyUsable = ids.some(id => id && skillUsable(u, id)) || B.med > 0;
  html += `<div class="skill-row ${ids.length === 1 ? 'bw-only' : ''}">${ids.map(id => skillBtn(u, id, side)).join('')}</div>`;
  html += `<div class="btn-row tools">
    ${u.movePt ? '<button class="btn small" onclick="clickMoveMenu()">換位</button>' : '<span class="dim small">🔁 已用</span>'}
    <button class="btn small" ${B.med > 0 ? '' : 'disabled'} onclick="clickMed('aid')">急救</button>
    <button class="btn small" ${B.med > 0 ? '' : 'disabled'} onclick="clickMed('regen')">回春</button>
    <span class="dim small">醫療物 ${B.med}</span>
    ${anyUsable ? '' : '<button class="btn small" onclick="clickEndTurn()">結束回合</button>'}</div>`;
  return html;
}
function renderResult() {
  if (!B.over) return '';
  if (B.over === 'win') return `<div class="modal"><div class="modal-box"><h2>勝利！</h2><p>打了 ${B.round} 輪。</p>
    <button class="btn primary" onclick="retryBattle()">再打一次</button><button class="btn" onclick="backToSetup()">回木樁設定</button></div></div>`;
  return `<div class="modal"><div class="modal-box"><h2>全滅</h2><p>怪物對吃人沒興趣，牠們走了。（佔位）</p>
    <button class="btn primary" onclick="retryBattle()">重打</button><button class="btn" onclick="backToSetup()">撤離</button></div></div>`;
}
function render() {
  if (ui.screen !== 'battle') return;
  const enr = B.round >= ENRAGE_ROUND ? ` <span class="enrage">傷害+${Math.round((dmgMul() - 1) * 100)}%</span>` : '';
  const glob = B.glob.filter(g => g.key !== 'taunt').map(g => `<span class="badge">${GLOB_NAMES[g.key]}</span>`).join('');
  const logs = B.log.slice(-30).reverse().map(l => `<div class="log-line ${l.cls}">${esc(l.msg)}</div>`).join('');
  $('#app').innerHTML = `
    <div class="battle">
      <div class="topbar"><span class="round">第 ${B.round} 輪${enr}</span><span class="globs">${glob}</span>
        <button class="btn small ghost" onclick="backToSetup()">設定</button></div>
      <div class="order">${renderOrder()}</div>
      <div class="enemy-row n${enemies().length}">${renderEnemies()}</div>
      <div class="party">
        <div class="prow"><div class="plabel">前排</div>${renderPartyRow('front')}</div>
        <div class="prow"><div class="plabel">後排</div>${renderPartyRow('back')}</div>
      </div>
      <div class="actions">${renderActions()}</div>
      <div class="log">${logs}</div>
      <details class="cheat" ${ui.cheatOpen ? 'open' : ''} ontoggle="ui.cheatOpen=this.open">
        <summary>測試用按鈕</summary>
        <div class="btn-row"><span class="lbl">打到瀕死</span>${players().filter(p => !p.ko).map(p => `<button class="btn small" onclick="cheatND('${p.id}')">${esc(p.name)}</button>`).join('')}</div>
        <div class="btn-row">
          <button class="btn small" onclick="cheatFull()">我方回滿</button>
          <button class="btn small" onclick="cheatEnemyLow()">敵人剩 1 血</button>
          <button class="btn small" onclick="cheatRound()">輪數 +5</button>
          <button class="btn small" onclick="cheatMed()">醫療物 +3</button>
        </div>
      </details>
    </div>${renderResult()}`;
  flushFloats();
}
function flushFloats() {
  const layer = $('#floatLayer');
  const evs = B.events.splice(0);
  const perId = {};
  evs.forEach(ev => {
    const el = document.querySelector(`.card[data-id="${ev.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const n = perId[ev.id] = (perId[ev.id] || 0) + 1;
    const f = document.createElement('div');
    f.className = 'floatnum ' + ev.cls;
    f.textContent = ev.text;
    f.style.left = (r.left + r.width / 2) + 'px';
    f.style.top = (r.top + r.height * 0.3 - (n - 1) * 18) + 'px';
    layer.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  });
}

// ================= 測試用按鈕（給測試員；規則：作弊選單要保留） =================
function cheatND(id) {
  const p = uById(id);
  if (!p || p.ko) return;
  const target = Math.max(1, Math.floor(p.maxHp * 0.1));
  log(`（測試）把 ${p.name} 打到瀕死。`, 'dim');
  if (p.hp > target) damagePlayer(p, p.hp - target, null);
  render();
}
function cheatFull() {
  alivePlayers().forEach(p => { p.hp = p.maxHp; p.bwUsed = false; });
  log('（測試）我方全員回滿。', 'dim'); render();
}
function cheatEnemyLow() { aliveEnemies().forEach(e => { e.hp = 1; }); log('（測試）敵人全剩 1 血。', 'dim'); render(); }
function cheatRound() { B.round += 5; log(`（測試）跳到第 ${B.round} 輪。`, 'dim'); render(); }
function cheatMed() { B.med += 3; log('（測試）醫療物 +3。', 'dim'); render(); }
