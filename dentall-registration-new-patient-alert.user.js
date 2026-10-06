// ==UserScript==
// @name         Dentall 就診列表 新掛號提醒
// @namespace    htdayreportviewer
// @version      1.7.0
// @description  his.dentall.io 的「就診列表」出現新掛號病患時，畫面中間下方跳出醒目的提醒方塊，並語音播報「○○醫師，○點○分預約病患抵達」（列出序位、姓名、醫師、時間），該列標成黃色；點哪一位就只關掉那一位。就診列表分頁在背景（正在看別的分頁或視窗）時，另外送出 Chrome 桌面通知。
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
 *   4. 提醒方塊固定在畫面中間下方，先一聲短「叮」再語音播報「○○醫師，○點○分預約病患抵達」（左下角「🔔 掛號提醒聲音」可關閉、選聲音、調語速音量，設定存在這台電腦）；點某一位只關掉那一位，右上角 ✕ 全部關掉；期間再有新病患會累加在同一個方塊裡。
 *   5. 就診列表這個分頁不在前景（使用者正在看約診排程等其他分頁或視窗）時，提醒方塊看不到，所以另外送 Chrome 桌面通知；
 *      分頁在前景時只有方塊和聲音，不送桌面通知。第一次在就診列表點擊頁面時會詢問一次通知權限。
 *      注意：只在「就診列表固定開在一個分頁、其他操作在別的分頁」的用法下有效；在同一個分頁裡切到別的頁面，腳本就看不到列表、什麼都不會送。
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
    const timeOf = (s) => { const m = s.match(/\d{1,2}:\d{2}/); return m ? m[0] : ''; }; // 空白或「-」視為沒有預約
    const pid = (cell('姓名').match(/^\d{4,}/) || [''])[0]; // 病歷號
    return {
      key: tr.getAttribute('data-row-key'),
      seq: cell('序位'),
      pid,
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
      #${BOX_ID} .dus-np-doc  { font-size: 22px; font-weight: 700; color: #ad2102; }
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
    closeNotifs();
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

  // ---------- 聲音設定（每台電腦各自存在 localStorage，右下角「🔔 提醒設定」可調）----------
  const SET_KEY = 'dentall-registration-alert-settings';
  const DEFAULTS = { chime: true, speak: true, voice: '', rate: 1.0, volume: 1.0 };
  let settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem(SET_KEY) || '{}'); } catch (_) { return {}; } })());
  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ } }

  // ---------- 提示音 + 語音播報 ----------
  // 瀏覽器規定頁面要先被點過／按過鍵才允許出聲；還沒點過時先排隊，等使用者一有動作就補播。
  const SPEECH_LANG = 'zh-TW';
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    return audioCtx;
  }
  function activated() {
    if (navigator.userActivation) return navigator.userActivation.hasBeenActive;
    const c = getAudio();
    return !!c && c.state === 'running';
  }
  function chime() {
    const ctx = getAudio();
    if (!ctx) return 0;
    const t0 = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, settings.volume)) * 0.9;
    [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, dt]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = t0 + dt;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
    return 900; // 毫秒，之後再開始唸
  }
  function zhVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter((v) => /^zh[-_]TW/i.test(v.lang));
  }
  // 自動選擇的優先順序：Google 國語（臺灣）每台 Chrome 都有、聲音一致；其次 Windows 的 Microsoft 雅婷／漢漢；再來 Mac 的美佳
  const VOICE_PREFS = [/Google/i, /Yating|雅婷/i, /Hanhan|漢漢/i, /Zhiwei|志威/i, /Mei-Jia|美佳/i];
  function pickVoice() {
    const voices = zhVoices();
    if (settings.voice) {
      const v = voices.find((x) => x.name === settings.voice);
      if (v) return v;
    }
    for (const re of VOICE_PREFS) {
      const v = voices.find((x) => re.test(x.name));
      if (v) return v;
    }
    return voices[0] || speechSynthesis.getVoices().find((v) => /^zh/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.addEventListener('voiceschanged', () => {}); }
  function speechText(r) {
    const doc = r.doctor ? `${r.doctor}醫師，` : '';
    const m = r.apptTime && r.apptTime.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const h = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      return `${doc}${h}點${mm ? mm + '分' : ''}預約病患抵達`;
    }
    return `${doc}有臨時指定病患`;
  }
  function speak(rows) {
    if (!('speechSynthesis' in window)) return;
    const voice = pickVoice();
    for (const r of rows) {
      const u = new SpeechSynthesisUtterance(speechText(r));
      u.lang = SPEECH_LANG;
      u.rate = settings.rate;
      u.volume = settings.volume;
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    }
  }
  function playNow(rows) {
    const ctx = getAudio();
    const go = () => {
      const delay = settings.chime ? chime() : 0;
      if (settings.speak) setTimeout(() => speak(rows), delay);
    };
    if (ctx && ctx.state === 'suspended') ctx.resume().then(go).catch(go); else go();
  }
  let pending = [];
  function announce(rows) {
    if (!settings.chime && !settings.speak) return;
    if (activated()) { playNow(rows); return; }
    pending.push(...rows);
    console.log(TAG, '頁面尚未互動，提示音排隊等待', pending.length);
  }
  ['pointerdown', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => {
      if (!pending.length) return;
      const rows = pending; pending = [];
      if (document.getElementById(BOX_ID)) playNow(rows);
    }, { capture: true, passive: true }));

  // ---------- 桌面通知（就診列表分頁在背景時才送）----------
  // Chrome 規定要在使用者點過頁面後才能詢問通知權限，所以在就診列表上第一次點擊／按鍵時問一次。
  function notifSupported() { return 'Notification' in window; }
  function tabHidden() { return document.visibilityState !== 'visible'; }
  function askNotifPermission() {
    if (!notifSupported() || Notification.permission !== 'default') return;
    try { Notification.requestPermission().then((p) => console.log(TAG, '桌面通知權限：', p)); } catch (_) { /* ignore */ }
  }
  ['pointerdown', 'keydown'].forEach((ev) =>
    document.addEventListener(ev, () => { if (onRoute()) askNotifPermission(); }, { capture: true, passive: true }));
  const openNotifs = new Set();
  function closeNotifs() {
    for (const n of openNotifs) { try { n.close(); } catch (_) { /* ignore */ } }
    openNotifs.clear();
  }
  function desktopNotify(rows) {
    if (!notifSupported() || Notification.permission !== 'granted') return;
    if (!tabHidden()) return; // 分頁在前景：畫面上已有方塊和聲音，不重複
    const title = rows.length === 1 ? `🔔 新掛號：${rows[0].name}` : `🔔 新掛號病患（${rows.length}）`;
    const body = rows.map((r) => [r.seq || '—', r.name, r.doctor, r.apptTime ? `預約 ${r.apptTime}` : '臨時指定'].filter(Boolean).join('　')).join('\n');
    try {
      // 通知幾秒後自動消失（已有叮聲＋語音提醒，使用者會自己回來看就診列表）；系統音關掉，避免和叮聲重疊
      const n = new Notification(title, { body, tag: 'dus-new-patient-' + Date.now(), requireInteraction: false, silent: true });
      n.onclick = () => { try { window.focus(); } catch (_) { /* ignore */ } n.close(); };
      n.onclose = () => openNotifs.delete(n);
      openNotifs.add(n);
      console.log(TAG, '分頁在背景，已送桌面通知', title);
    } catch (e) { console.warn(TAG, '桌面通知失敗', e); }
  }
  // 切回就診列表分頁時，畫面上已有方塊，把桌面通知收掉
  document.addEventListener('visibilitychange', () => { if (!tabHidden()) closeNotifs(); });

  // ---------- 設定面板 ----------
  const SET_BTN_ID = 'dus-np-settings-btn';
  const SET_PANEL_ID = 'dus-np-settings-panel';
  function ensureSettingsStyle() {
    if (document.getElementById(STYLE_ID + '-set')) return;
    const st = document.createElement('style');
    st.id = STYLE_ID + '-set';
    st.textContent = `
      #${SET_BTN_ID} {
        position: fixed; left: 16px; bottom: 16px; z-index: 2147482000;
        background: #fff; border: 1px solid #d9d9d9; border-radius: 999px; padding: 6px 12px;
        font-size: 13px; color: #595959; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.12);
        font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      }
      #${SET_BTN_ID}:hover { color: #fa541c; border-color: #fa541c; }
      #${SET_BTN_ID}.dus-muted { color: #bfbfbf; }
      #${SET_PANEL_ID} {
        position: fixed; left: 16px; bottom: 56px; z-index: 2147482001; width: 320px;
        background: #fff; border: 1px solid #d9d9d9; border-radius: 10px; padding: 14px 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,.18); font-size: 14px; color: #262626;
        font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      }
      #${SET_PANEL_ID} h4 { margin: 0 0 10px; font-size: 15px; }
      #${SET_PANEL_ID} label { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
      #${SET_PANEL_ID} select, #${SET_PANEL_ID} input[type=range] { flex: 1; min-width: 0; }
      #${SET_PANEL_ID} .dus-row { display: flex; gap: 8px; margin-top: 12px; }
      #${SET_PANEL_ID} button {
        flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid #d9d9d9; background: #fafafa; cursor: pointer;
      }
      #${SET_PANEL_ID} button.dus-primary { background: #fa541c; border-color: #fa541c; color: #fff; }
      #${SET_PANEL_ID} .dus-hint { color: #8c8c8c; font-size: 12px; margin-top: 8px; }
    `;
    document.head.appendChild(st);
  }
  function ensureSettingsButton() {
    let btn = document.getElementById(SET_BTN_ID);
    if (!onRoute()) { if (btn) btn.style.display = 'none'; return; }
    ensureSettingsStyle();
    if (!btn) {
      btn = document.createElement('div');
      btn.id = SET_BTN_ID;
      btn.title = '新掛號提醒：聲音設定';
      btn.addEventListener('click', toggleSettingsPanel);
      document.body.appendChild(btn);
    }
    btn.style.display = '';
    const muted = !settings.chime && !settings.speak;
    btn.textContent = muted ? '🔕 掛號提醒聲音（已靜音）' : '🔔 掛號提醒聲音';
    btn.classList.toggle('dus-muted', muted);
  }
  function toggleSettingsPanel() {
    const old = document.getElementById(SET_PANEL_ID);
    if (old) { old.remove(); return; }
    const p = document.createElement('div');
    p.id = SET_PANEL_ID;
    const voices = zhVoices();
    const auto = pickVoice();
    const opts = [`<option value="">自動（${auto ? esc(auto.name) : '無'}）</option>`]
      .concat(voices.map((v) => `<option value="${esc(v.name)}"${v.name === settings.voice ? ' selected' : ''}>${esc(v.name)}</option>`)).join('');
    p.innerHTML = `
      <h4>🔔 新掛號提醒 聲音設定</h4>
      <label><input type="checkbox" data-k="chime"${settings.chime ? ' checked' : ''}> 先播一聲「叮」</label>
      <label><input type="checkbox" data-k="speak"${settings.speak ? ' checked' : ''}> 語音播報「○○醫師，○點○分預約病患抵達」</label>
      <label>聲音 <select data-k="voice">${opts}</select></label>
      <label>語速 <input type="range" data-k="rate" min="0.6" max="1.6" step="0.1" value="${settings.rate}"> <span data-v="rate">${settings.rate}</span></label>
      <label>音量 <input type="range" data-k="volume" min="0.2" max="1" step="0.1" value="${settings.volume}"> <span data-v="volume">${settings.volume}</span></label>
      <div class="dus-row"><button data-act="test">試聽</button><button data-act="close" class="dus-primary">完成</button></div>
      <div class="dus-hint">設定只存在這台電腦。聲音清單是這台電腦的 Chrome 有的台灣國語聲音；Windows 想要更多聲音，到「設定 → 時間與語言 → 語言 → 中文(台灣) → 語音」安裝。</div>
    `;
    p.addEventListener('change', (ev) => {
      const el = ev.target;
      const k = el.dataset.k;
      if (!k) return;
      if (el.type === 'checkbox') settings[k] = el.checked;
      else if (el.type === 'range') settings[k] = parseFloat(el.value);
      else settings[k] = el.value;
      saveSettings();
      ensureSettingsButton();
    });
    p.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.type === 'range') { const sp = p.querySelector(`[data-v="${el.dataset.k}"]`); if (sp) sp.textContent = el.value; }
    });
    p.addEventListener('click', (ev) => {
      const act = ev.target.dataset && ev.target.dataset.act;
      if (act === 'close') { p.remove(); return; }
      if (act === 'test') {
        if (!settings.chime && !settings.speak) return;
        playNow([{ doctor: '王大明', apptTime: '14:30' }]);
      }
    });
    document.body.appendChild(p);
  }

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
      if (r.apptTime) meta.push(`預約 ${r.apptTime}`); else meta.push('臨時指定');
      if (r.regTime) meta.push(`掛號 ${r.regTime}`);
      li.innerHTML =
        `<span class="dus-np-seq">${esc(r.seq || '—')}</span>` +
        `<span class="dus-np-name">${esc(r.name)}</span>` +
        (r.doctor ? `<span class="dus-np-doc">${esc(r.doctor)}</span>` : '') +
        `<span class="dus-np-meta">${esc(meta.join('　'))}</span>` +
        `<span class="dus-np-ok">✓</span>`;
      ul.appendChild(li);
      if (r.key) highlighted.add(r.key);
    }
    updateCount(box);
    applyHighlight();
    announce(rows);
    desktopNotify(rows);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 掃描 ----------
  function scan() {
    ensureSettingsButton();
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
    // 預約時間空白的列：若同一位病患（病歷號）今天已有另一筆掛號 → 整筆忽略；否則當作「臨時指定病患」提醒
    const allRows = trs.map((tr) => parseRow(tr, colIndex));
    const toAlert = fresh.filter((r) => {
      if (/已完成/.test(r.status)) return false;
      if (!r.apptTime && r.pid && allRows.some((o) => o.pid === r.pid && o.key !== r.key)) {
        console.log(TAG, '病患今天已有掛號，忽略', r.name);
        return false;
      }
      return true;
    });
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
