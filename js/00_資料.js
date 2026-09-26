/* ========================================================
   00_資料.js — 戰鬥原型的資料（常數、角色、木樁預設）
   規格來源：設計文件/站位戰鬥_構想草稿.md
   這裡的數字大多是「暫定」，實際玩過再調；調數字只要改這個檔。
   ======================================================== */

// ---- 規則常數 ----
const DEATH_LINE = 0.2;        // 瀕死線：血量低於 20%（剛好 20% 不算）
const CRIT_MUL = 2;            // 爆擊倍率
const CRIT_EVERY = 5;          // 爆擊計數：每打第 5 下必定爆擊（L 精確是每 3 下；見 HERO_DATA.critEvery）
const GROUP_SOLO_MUL = 1.7;    // 前排只剩一人時，群攻 ×1.7
const GROUP_RATIO = 0.7;       // 木樁群攻：每人吃「攻擊傷害 ×0.7」（暫定）
const ENEMY_SWING = 0.1;       // 敵人傷害小幅波動 ±10%（暫定）
const ENRAGE_ROUND = 10;       // 第 10 輪起全場傷害每輪 +10%，疊加
const ENRAGE_STEP = 0.1;
const MED_START = 4;           // 開場醫療物數量（暫定）
const FIRST_AID = 0.3;         // 急救：當下回 30%
const REGEN = 0.15;            // 回春：每回合 15%
const REGEN_TICKS = 3;         //       共 3 次
const K_HEAL_BONUS = 0.1;      // K 特性「治癒」：用醫療物時目標當下多回 10%
const EXHAUST_FIRST = 0.4;     // 脫力第一次：拉到 40%（主角是「加上」40%）
const EXHAUST_LATER = 0.2;     // 脫力之後：拉到 20%（主角是「加上」20%）
const TAILWIND_CRIT = 0.2;     // 順風：全隊爆擊率 +20%（納可 2026-09-26）
const DUST_MISS = 0.2;         // 揚塵：敵人 20% 失手（改版討論中）
const DUMMY_SPD = 11;          // 木樁速度（暫定）

// ---- 技能傷害（我方小浮動：每次在範圍內隨機取整數；之後強化就是把範圍往上推） ----
const SKILL_DMG = {
  slash: [12, 14],       // 主角 劈斬
  charge_in: [18, 21],   // 主角 突襲
  hold_counter: [8, 9],  // 主角 不退的反擊
  rend: [14, 16],        // V 割裂
  knives: [5, 6],        // V 飛刀（每把）
  bladedance: [16, 19],  // V 刀舞
  double: [9, 10],       // K 雙擊（每下）：客場招要誘人，兩下打得贏風刃打一隻
  windblade: [7, 8],     // K 風刃（每隻）
  k_bw: [16, 19],        // K 背水（每隻）
  frostburst: [24, 28],  // L 霜爆：客場招要誘人，比冰刺強（近身用魔法危險但威力最大）
  icespike: [20, 23],    // L 冰刺
  bloodfrost: [8, 9],    // L 血霜花（每隻）
};

// ---- 角色（血量以 100 為基準、10 的倍數；速度暫定） ----
// front / back：前排兩招、後排兩招的技能 id；null＝這格還沒定
const HERO_DATA = [
  { id: 'hero', name: '主角', color: '#ebcb8b', maxHp: 120, spd: 10, critEvery: CRIT_EVERY, row: 'front',
    front: ['slash', 'taunt'], back: ['charge_in', null], emptyName: { back: '主角後排 2' }, bw: 'hold',
    trait: '振作／硬撐：脫力時血量「加上」40%／20%' },
  { id: 'v', name: 'V', color: '#b48ead', maxHp: 90, spd: 14, critEvery: CRIT_EVERY, row: 'front',
    front: ['guard', 'rend'], back: ['knives', 'focus'], bw: 'bladedance',
    trait: '靈巧：進前排後，到他下次輪到前，第一次被打一定閃掉' },
  { id: 'k', name: 'K', color: '#a3be8c', maxHp: 100, spd: 12, critEvery: CRIT_EVERY, row: 'back',
    front: ['double', 'dust'], back: ['windblade', 'tailwind'], bw: 'k_bw',
    trait: '治癒：用醫療物時，目標當下多回 10%' },
  { id: 'l', name: 'L', color: '#88c0d0', maxHp: 80, spd: 9, critEvery: 3, row: 'back',
    front: ['frostburst', null], back: ['icespike', 'freeze'], emptyName: { front: 'L 前排 2' }, bw: 'bloodfrost',
    trait: '精確：每打第 3 下必定爆擊（別人是第 5 下）' },
];

// ---- 木樁 ----
const DUMMY_ACTIONS = {
  single: '單攻',
  group: '群攻',
  swap: '換位',
  push: '推順序',
  idle: '發呆',
};

// 預設組合（木樁設定面板一鍵套用）
// 強度抓法（2026-09-26）：亂按的測試大約會輸一到四成、一般組合 5 到 7 輪（會想的人會更快），
// 前排大約挨 3 到 4 下就進瀕死，背水那一套才測得到。沙包不打人，專門測傷害。
const DUMMY_PRESETS = [
  { name: '沙包', dummies: [
    { hp: 400, dmg: 10, pattern: ['idle', 'idle', 'idle', 'idle'] },
  ] },
  { name: '單攻木樁', dummies: [
    { hp: 100, dmg: 30, pattern: ['single', 'single', 'single', 'single'] },
    { hp: 100, dmg: 30, pattern: ['single', 'single', 'single', 'single'] },
  ] },
  { name: '群攻木樁', dummies: [
    { hp: 200, dmg: 48, pattern: ['group', 'group', 'group', 'group'] },
  ] },
  { name: '打打群群', dummies: [
    { hp: 100, dmg: 30, pattern: ['single', 'single', 'group', 'group'] },
    { hp: 100, dmg: 30, pattern: ['group', 'group', 'single', 'single'] },
  ] },
  { name: '搗亂組', dummies: [
    { hp: 80, dmg: 26, pattern: ['single', 'swap', 'single', 'push'] },
    { hp: 80, dmg: 26, pattern: ['push', 'single', 'swap', 'group'] },
    { hp: 80, dmg: 26, pattern: ['single', 'group', 'push', 'swap'] },
  ] },
  { name: '大木樁', dummies: [
    { hp: 450, dmg: 46, pattern: ['single', 'single', 'group', 'swap'] },
  ] },
];
