/* ========================================================
   潛淵 · 新版（淵2 重開）— 入口
   目前是戰鬥原型：木樁設定面板 → 開戰。
   規則：js/01_戰鬥.js；資料：js/00_資料.js；畫面：js/02_畫面.js

   VERSION：語意化版本 主.次.修，平常只加最後一位（修）；
            次號、主號等納可開口（規則見 CLAUDE.md）。
   ======================================================== */

const VERSION = 'v0.0.17';

document.getElementById('version').textContent = VERSION;
ui.cfg = loadCfg();
renderSetup();
