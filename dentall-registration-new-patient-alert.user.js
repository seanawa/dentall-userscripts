// ==UserScript==
// @name         Dentall 就診列表 新掛號提醒
// @namespace    htdayreportviewer
// @version      1.2.0
// @description  his.dentall.io 的「就診列表」出現新掛號病患時，畫面中間下方跳出醒目的提醒方塊並播放提示音（列出序位、姓名、醫師、時間），該列標成黃色；點哪一位就只關掉那一位。
// @match        https://his.dentall.io/*
// @homepageURL  https://github.com/seanawa/dentall-userscripts
// @supportURL   https://github.com/seanawa/dentall-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-new-patient-alert.user.js
// @downloadURL  https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-new-patient-alert.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 原理：就診列表是 Ant Design 表格，每一列都有 data-row-key（掛號編號）。Dentall 在畫面顯示中會自己定期重抓資料，
 * 本腳本只盯著表格 DOM 的變化：
 *   1. 以「日期選擇器的日期」為單位，記住這一天已經看過哪些掛號編號（localStorage，重新整理也記得）。
 *   2. 表格一有變化就比對，出現沒看過、而且門診處置不是「已完成」的列 → 顯示提醒方塊並把該列標黃。
 *   3. 第一次看到某一天的列表時只默默記下來，不提醒（避免一開畫面就跳一整排）。
 *      一次冒出超過 MAX_BURST 列也視為「整批載入」而不提醒（例如切換篩選）。
 *   4. 提醒方塊固定在畫面中間下方並播放提示音；點某一位只關掉那一位，右上角 ✕ 全部關掉；期間再有新病患會累加在同一個方塊裡。
 * 不碰任何資料、不呼叫 API。
 */
(function () {
  'use strict';
  const TAG = '[dentall-userscripts/new-patient-alert]';
  const KEY = 'dentall-registration-seen';
  const ROUTE = '#/registration';
  const CHECK_COL = '掛號時間';
  const MAX_BURST = 10;   // 一次新增超過這個數量就當作整批載入，不提醒
  const KEEP_DAYS = 5;    // localStorage 只保留最近幾天的紀錄
  const BOX_ID = 'dus-new-patient-box';
  const STYLE_ID = 'dus-new-patient-style';
  const HL_STYLE_ID = 'dus-new-patient-hl';

  // ---------- 狀態儲存 ----------
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveAll(all) {
    const dates = Object.keys(all);
    if (dates.length > KEEP_DAYS) {
      dates.sort().slice(0, dates.length - KEEP_DAYS).forEach((d) => { delete all[d]; });
    }
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (_) { /* ignore */ }
  }

  function onRoute() { return location.hash.startsWith(ROUTE); }

  function headerText(th) {
    const t = th.querySelector('.ant-table-column-title');
    return (t ? t.textContent : th.textContent).trim();
  }

  function findTable() {
    for (const tbl of document.querySelectorAll('.ant-table')) {
      const ths = [...tbl.querySelectorAll('.ant-table-thead th')];
      if (ths.some((th) => headerText(th) === CHECK_COL)) return { tbl, ths };
    }
    return null;
  }

  function currentDateKey() {
    const inp = document.querySelector('.ant-picker input');
    const v = inp && inp.value && inp.value.trim();
    if (v) return v;
    const d = new Date();
    return `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseRow(tr, colIndex) {
    const cell = (name) => {
      const i = colIndex[name];
      return i == null ? '' : (tr.children[i] ? tr.children[i].textContent.trim() : '');
    };
    const nameTd = tr.children[colIndex['姓名']];
    const h4 = nameTd && nameTd.querySelector('h4');
    const name = h4 ? h4.textContent.trim() : cell('姓名').replace(/^\d+\([^)]*\)/, '');
    const timeOf = (s) => { const m = s.match(/\d{1,2}:\d{2}/); return m ? m[0] : s; };
    return {
      key: tr.getAttribute('data-row-key'),
      seq: cell('序位'),
      name,
      regTime: timeOf(cell('掛號時間')),
      apptTime: timeOf(cell('預約時間')),
      doctor: cell('主治醫師'),
      status: cell('門診處置'),
    };
  }

  // ---------- 提醒方塊 ----------
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      #${BOX_ID} {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 2147483000; min-width: 420px; max-width: 80vw;
        background: #fff7e6; border: 3px solid #fa541c; border-radius: 12px;
        box-shadow: 0 8px 30px rgba(250,84,28,.45);
        font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
        color: #262626; user-select: none;
        animation: dus-np-pulse 1.2s ease-in-out infinite;
      }
      @keyframes dus-np-pulse {
        0%, 100% { box-shadow: 0 8px 30px rgba(250,84,28,.45); }
        50%      { box-shadow: 0 8px 40px rgba(250,84,28,.9); border-color: #ff7a45; }
      }
      #${BOX_ID} .dus-np-head {
        display: flex; align-items: center; justify-content: space-between;
        background: #fa541c; color: #fff; font-size: 20px; font-weight: 700;
        padding: 10px 16px; border-radius: 8px 8px 0 0;
      }
      #${BOX_ID} .dus-np-close {
        font-size: 18px; font-weight: 400; opacity: .9; margin-left: 24px; cursor: pointer;
        padding: 0 6px; border-radius: 6px;
      }
      #${BOX_ID} .dus-np-close:hover { background: rgba(255,255,255,.25); }
      #${BOX_ID} ul { list-style: none; margin: 0; padding: 8px 16px 10px; }
      #${BOX_ID} li {
        font-size: 18px; line-height: 1.5; padding: 6px 0; border-top: 1px dashed #ffbb96;
        display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap;
        cursor: pointer; border-radius: 6px; margin: 0 -8px; padding-left: 8px; padding-right: 8px;
      }
      #${BOX_ID} li:hover { background: #ffe7ba; }
      #${BOX_ID} li:first-child { border-top: 0; }
      #${BOX_ID} .dus-np-ok { margin-left: auto; color: #8c8c8c; font-size: 14px; }
      #${BOX_ID} .dus-np-seq {
        background: #fa541c; color: #fff; border-radius: 6px; padding: 0 8px;
        font-weight: 700; min-width: 2.2em; text-align: center;
      }
      #${BOX_ID} .dus-np-name { font-size: 22px; font-weight: 700; }
      #${BOX_ID} .dus-np-meta { color: #595959; font-size: 16px; }
      #${BOX_ID} .dus-np-foot {
        font-size: 13px; color: #8c8c8c; text-align: center; padding: 0 0 8px;
      }
    `;
    document.head.appendChild(st);
  }

  const highlighted = new Set();
  function applyHighlight() {
    let st = document.getElementById(HL_STYLE_ID);
    if (!highlighted.size) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement('style'); st.id = HL_STYLE_ID; document.head.appendChild(st); }
    const sel = [...highlighted].map((k) => `tr.ant-table-row[data-row-key="${k}"] > td`).join(',');
    st.textContent = `${sel} { background: #fff566 !important; }`;
  }

  function dismissAll() {
    const box = document.getElementById(BOX_ID);
    if (box) box.remove();
    highlighted.clear();
    applyHighlight();
  }

  function dismissOne(li) {
    const box = document.getElementById(BOX_ID);
    const key = li.dataset.key;
    li.remove();
    if (key) highlighted.delete(key);
    applyHighlight();
    const ul = box && box.querySelector('ul');
    if (!ul || !ul.children.length) { dismissAll(); return; }
    updateCount(box);
  }

  function updateCount(box) {
    const n = box.querySelector('ul').children.length;
    box.querySelector('.dus-np-head > span').textContent = `🔔 新掛號病患（${n}）`;
  }

  // ---------- 提示音（WebAudio，不需要音檔）----------
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    return audioCtx;
  }
  function beep() {
    const ctx = getAudio();
    if (!ctx) return;
    // 三聲上行「叮咚咚」，連響兩次；VOLUME 0~1
    const VOLUME = 0.9;
    const play = () => {
      const t0 = ctx.currentTime;
      [0, 1.0].forEach((rep) => {
        [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, dt]) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          const t = t0 + rep + dt;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(VOLUME, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
          osc.connect(g).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.6);
        });
      });
    };
    if (ctx.state === 'suspended') {
      // 瀏覽器要等使用者在頁面上有過任何互動才允許出聲
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  }
  // 使用者一有互動就先把音訊喚醒，之後的提示音才能即時播放
  ['pointerdown', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => { const c = getAudio(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }, { capture: true, passive: true }));

  function notify(rows) {
    ensureStyle();
    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = BOX_ID;
      box.innerHTML =
        `<div class="dus-np-head"><span>🔔 新掛號病患</span><span class="dus-np-close" title="全部關閉">✕</span></div>` +
        `<ul></ul><div class="dus-np-foot">點病患關閉該筆，點 ✕ 全部關閉</div>`;
      box.addEventListener('click', (ev) => {
        if (ev.target.closest('.dus-np-close')) { dismissAll(); return; }
        const li = ev.target.closest('li');
        if (li) dismissOne(li);
      });
      document.body.appendChild(box);
    }
    const ul = box.querySelector('ul');
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.key) li.dataset.key = r.key;
      const meta = [];
      if (r.doctor) meta.push(`醫師 ${r.doctor}`);
      if (r.apptTime) meta.push(`預約 ${r.apptTime}`);
      if (r.regTime) meta.push(`掛號 ${r.regTime}`);
      li.innerHTML =
        `<span class="dus-np-seq">${esc(r.seq || '—')}</span>` +
        `<span class="dus-np-name">${esc(r.name)}</span>` +
        `<span class="dus-np-meta">${esc(meta.join('　'))}</span>` +
        `<span class="dus-np-ok">✓</span>`;
      ul.appendChild(li);
      if (r.key) highlighted.add(r.key);
    }
    updateCount(box);
    applyHighlight();
    beep();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 掃描 ----------
  function scan() {
    if (!onRoute()) return;
    const found = findTable();
    if (!found) return;
    const { tbl, ths } = found;
    const colIndex = {};
    ths.forEach((th, i) => { colIndex[headerText(th)] = i; });
    if (colIndex['姓名'] == null) return;

    const trs = [...tbl.querySelectorAll('.ant-table-tbody > tr.ant-table-row[data-row-key]')];
    const dateKey = currentDateKey();
    const all = loadAll();
    const firstTimeToday = !Array.isArray(all[dateKey]);
    const seen = new Set(all[dateKey] || []);

    const fresh = [];
    for (const tr of trs) {
      const k = tr.getAttribute('data-row-key');
      if (seen.has(k)) continue;
      seen.add(k);
      fresh.push(parseRow(tr, colIndex));
    }
    if (!fresh.length) return;

    all[dateKey] = [...seen];
    saveAll(all);

    if (firstTimeToday) { console.log(TAG, `初次載入 ${dateKey}，記下 ${trs.length} 列`); return; }
    const toAlert = fresh.filter((r) => !/已完成/.test(r.status));
    if (!toAlert.length) return;
    if (fresh.length > MAX_BURST) { console.log(TAG, `一次出現 ${fresh.length} 列，視為整批載入，不提醒`); return; }
    console.log(TAG, '新掛號', toAlert);
    notify(toAlert);
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; try { scan(); } catch (e) { console.warn(TAG, e); } }, 300);
  }

  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('hashchange', schedule);
  schedule();
  console.log(TAG, '已啟動');
})();
