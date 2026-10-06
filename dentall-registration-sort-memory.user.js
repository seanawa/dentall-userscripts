// ==UserScript==
// @name         Dentall 就診列表 記住排序
// @namespace    htdayreportviewer
// @version      1.0.0
// @description  his.dentall.io 的「就診列表」記住你上次點選的排序欄位與方向，每次回到此畫面自動套用（系統預設為掛號時間由新到舊）。
// @match        https://his.dentall.io/*
// @homepageURL  https://github.com/seanawa/dentall-userscripts
// @supportURL   https://github.com/seanawa/dentall-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-sort-memory.user.js
// @downloadURL  https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-sort-memory.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 原理：就診列表是 Ant Design 的表格，排序狀態只存在記憶體裡，離開畫面再回來就會重設為「掛號時間 ↓」。
 * 本腳本：
 *   1. 使用者點表頭排序後，把「欄位名稱 + 方向」存進 localStorage。
 *   2. 每次就診列表的表格重新出現時，若目前排序和記住的不同，就代替使用者點表頭，直到一致為止。
 * 不碰任何資料、不呼叫 API。
 */
(function () {
  'use strict';
  const TAG = '[dentall-userscripts/sort-memory]';
  const KEY = 'dentall-registration-sort';
  const ROUTE = '#/registration';
  const CHECK_COL = '掛號時間'; // 用來辨認「這是就診列表那張表」
  const CYCLE = [null, 'ascending', 'descending']; // antd 點擊順序：無 → 升冪 → 降冪 → 無
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* ignore */ }
  }

  function onRoute() { return location.hash.startsWith(ROUTE); }

  function headerText(th) {
    const t = th.querySelector('.ant-table-column-title');
    return (t ? t.textContent : th.textContent).trim();
  }

  function findThead() {
    for (const thead of document.querySelectorAll('.ant-table-thead')) {
      const ths = [...thead.querySelectorAll('th')];
      if (ths.some((th) => headerText(th) === CHECK_COL && th.classList.contains('ant-table-column-has-sorters'))) {
        return thead;
      }
    }
    return null;
  }

  function sortableThs(thead) {
    return [...thead.querySelectorAll('th.ant-table-column-has-sorters')];
  }

  function currentSort(thead) {
    for (const th of sortableThs(thead)) {
      const order = th.getAttribute('aria-sort');
      if (order) return { col: headerText(th), order };
    }
    return null;
  }

  function clickSorter(th) {
    const target = th.querySelector('.ant-table-column-sorters') || th;
    target.click();
  }

  // 把表格排序調整成 want；want 為 null 表示回到系統預設（什麼都不做）
  async function applySort(thead, want) {
    if (!want) return;
    const cur = currentSort(thead);
    if (cur && cur.col === want.col && cur.order === want.order) return;
    const th = sortableThs(thead).find((x) => headerText(x) === want.col);
    if (!th) { console.warn(TAG, '找不到欄位', want.col); return; }

    // 計算要點幾次：從目前這欄的狀態走到目標狀態
    const from = CYCLE.indexOf(th.getAttribute('aria-sort'));
    const to = CYCLE.indexOf(want.order);
    let clicks = (to - from + CYCLE.length) % CYCLE.length;
    if (clicks === 0) clicks = CYCLE.length;
    for (let i = 0; i < clicks; i++) {
      if (!thead.isConnected) return;
      clickSorter(th);
      await sleep(150);
      const now = th.getAttribute('aria-sort');
      if (now === want.order) break;
    }
    const after = currentSort(thead);
    console.log(TAG, '已套用排序', after);
  }

  // 使用者（真人）點了表頭 → 稍後讀取新狀態並記住
  document.addEventListener('click', (ev) => {
    if (!ev.isTrusted || !onRoute()) return;
    const th = ev.target.closest && ev.target.closest('th.ant-table-column-has-sorters');
    if (!th) return;
    const thead = th.closest('.ant-table-thead');
    if (!thead || thead !== findThead()) return;
    setTimeout(() => {
      const s = currentSort(thead);
      save(s);
      console.log(TAG, '記住排序', s);
    }, 200);
  }, true);

  // 表格出現 / 重建時套用
  let busy = false;
  async function maybeApply() {
    if (busy || !onRoute()) return;
    const thead = findThead();
    if (!thead || thead.dataset.sortMemoryDone) return;
    thead.dataset.sortMemoryDone = '1';
    busy = true;
    try {
      // 等資料載入、表頭穩定
      await sleep(100);
      await applySort(thead, load());
    } finally {
      busy = false;
    }
  }

  const mo = new MutationObserver(() => { maybeApply(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(maybeApply, 50));
  maybeApply();
  console.log(TAG, '已啟動，記住的排序：', load());
})();
