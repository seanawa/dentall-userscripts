// ==UserScript==
// @name         Dentall 自動登入
// @namespace    htdayreportviewer
// @version      1.0.0
// @description  his.dentall.io 被登出、畫面出現登入表單時，用 Tampermonkey 選單設定的帳號密碼自動登入，登入後回到原本的頁面（例如就診列表）。每個分頁 5 分鐘最多試一次，失敗就停。
// @match        https://his.dentall.io/*
// @homepageURL  https://github.com/seanawa/dentall-userscripts
// @supportURL   https://github.com/seanawa/dentall-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-auto-login.user.js
// @downloadURL  https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-auto-login.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 用途：Windows 開機 → Chrome 還原「釘選的就診列表分頁＋一般分頁」→ Dentall 若已登出，自動登入，不用按。
 *
 * 原理：
 *   1. Dentall 登出後網址不變（例如還是 #/registration），畫面換成登入表單（form#basic、#basic_username、#basic_password、「登入」按鈕）。
 *      腳本每秒看一次有沒有這個表單。
 *   2. 有表單、自動登入開著、帳號密碼已設定、沒有因為失敗而暫停，且這個分頁 5 分鐘內沒試過，才登入：
 *      用 HTMLInputElement 原生的 value setter 填值，再送 input／change 事件（React／Ant Design 才收得到），然後按「登入」。
 *   3. 20 秒內表單消失就算成功；沒消失就算失敗 → 所有分頁一起暫停自動登入，直到從選單重新設定或重新開啟，避免帳號被鎖。
 *   4. 兩個分頁同時在登入頁：用 localStorage 的鎖讓一個分頁登入，另一個等它成功（localStorage 的 storage 事件）後重新整理。
 *   5. 登入中的時候，每個分頁用 sessionStorage 記住目前的路由（例如 #/registration）；登入成功後跳回那個路由。
 *      Chrome 還原分頁時 sessionStorage 也會還原，所以釘選的分頁會回到就診列表。
 *
 * 帳號密碼存在 Tampermonkey 的腳本儲存區（GM_setValue），只在這台電腦，不在 repo、不在網頁的 localStorage。
 * 紀錄只記時間、分頁路由與結果，不記帳號密碼。腳本不呼叫任何 Dentall API。
 */
(function () {
  'use strict';
  const TAG = '[dentall-userscripts/auto-login]';
  const G = { creds: 'creds', enabled: 'enabled', paused: 'paused', log: 'log' };
  const SS_ROUTE = 'dentall-auto-login-route';
  const SS_LAST_TRY = 'dentall-auto-login-last-try';
  const LS_LOCK = 'dentall-auto-login-lock';
  const LS_DONE = 'dentall-auto-login-done';
  const RETRY_MS = 5 * 60 * 1000;   // 每個分頁最多 5 分鐘試一次
  const LOCK_MS = 60 * 1000;        // 鎖超過 60 秒視為失效（持有的分頁當掉或被關掉）
  const SUBMIT_WAIT_MS = 20 * 1000; // 按登入後最多等 20 秒
  const LOG_MAX = 20;

  const me = Math.random().toString(36).slice(2);
  const st = { busy: false, waiting: false, noticed: '', holdRouteUntil: 0 };
  const log = (...a) => console.log(TAG, ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 儲存 ----------
  const getCreds = () => { const c = GM_getValue(G.creds, null); return c && c.u && c.p ? c : null; };
  const isEnabled = () => GM_getValue(G.enabled, true) !== false;
  const getPaused = () => GM_getValue(G.paused, null);
  function addLog(result, note) {
    const list = GM_getValue(G.log, []);
    list.unshift({ t: Date.now(), route: location.hash || '(無)', result, note: note || '' });
    GM_setValue(G.log, list.slice(0, LOG_MAX));
  }
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* ignore */ } },
  };
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  // ---------- 畫面 ----------
  const loginForm = () => {
    const f = document.querySelector('form#basic');
    return f && f.querySelector('input#basic_password') ? f : null;
  };
  const validRoute = (h) => !!h && h.startsWith('#/') && h.length > 2 && !/^#\/login\b/i.test(h);

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let banner = null;
  function notice(text) {
    if (st.noticed === text) return;
    st.noticed = text;
    if (!text) { if (banner) banner.remove(); banner = null; return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;'
        + 'max-width:calc(100vw - 32px);padding:8px 14px;border-radius:6px;background:#fff7e6;border:1px solid #ffa940;'
        + 'color:#873800;font:14px/1.5 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.15)';
      document.body.appendChild(banner);
    }
    banner.textContent = '自動登入：' + text;
  }

  // ---------- 跨分頁的鎖 ----------
  function lockHeldByOther() {
    const l = ls.get(LS_LOCK);
    return !!(l && l.owner !== me && Date.now() - l.at < LOCK_MS);
  }
  async function acquireLock() {
    if (lockHeldByOther()) return false;
    ls.set(LS_LOCK, { owner: me, at: Date.now() });
    await sleep(300 + Math.random() * 400); // 兩個分頁同時寫入時，最後寫的那個贏
    const l = ls.get(LS_LOCK);
    return !!(l && l.owner === me);
  }
  function releaseLock() {
    const l = ls.get(LS_LOCK);
    if (l && l.owner === me) ls.del(LS_LOCK);
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== LS_DONE || !st.waiting) return;
    log('另一個分頁已登入，重新整理');
    addLog('重新整理', '另一個分頁已登入');
    location.reload();
  });

  // ---------- 登入 ----------
  async function login(form) {
    const creds = getCreds();
    const target = validRoute(location.hash) ? location.hash : ss.get(SS_ROUTE);
    ss.set(SS_LAST_TRY, String(Date.now()));
    notice('登入中…');
    log('登入中，登入後回到', target || '(Dentall 預設頁)');

    setNativeValue(form.querySelector('input#basic_username'), creds.u);
    setNativeValue(form.querySelector('input#basic_password'), creds.p);
    await sleep(300);
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) throw new Error('找不到「登入」按鈕');
    btn.click();

    const t0 = Date.now();
    while (Date.now() - t0 < SUBMIT_WAIT_MS) {
      await sleep(500);
      if (!loginForm()) return target;
    }
    const err = document.querySelector('.ant-message-error, .ant-form-item-explain-error, .ant-alert-error');
    throw new Error(err ? err.textContent.trim().slice(0, 80) : '按登入後 20 秒仍停在登入頁');
  }

  async function tryLogin(form) {
    st.busy = true;
    try {
      if (!(await acquireLock())) { startWaiting(); return; }
      const target = await login(form);
      ls.set(LS_DONE, Date.now());
      releaseLock();
      addLog('成功', target ? '回到 ' + target : '');
      notice('');
      st.holdRouteUntil = Date.now() + 5000;
      for (const ms of [1500, 2500]) { // Dentall 登入後可能先跳到預設頁，等它跳完再拉回來
        await sleep(ms);
        if (target && location.hash !== target) location.hash = target;
      }
    } catch (e) {
      releaseLock();
      const reason = (e && e.message) || String(e);
      GM_setValue(G.paused, { at: Date.now(), reason });
      addLog('失敗，已暫停', reason);
      notice('失敗（' + reason + '），已暫停。請手動登入，並從 Tampermonkey 選單檢查帳號密碼後重新開啟。');
      log('失敗', reason);
      menu();
    } finally {
      st.busy = false;
    }
  }

  function startWaiting() {
    if (st.waiting) return;
    st.waiting = true;
    notice('另一個分頁正在登入，等它完成後自動重新整理…');
    addLog('等待', '另一個分頁正在登入');
    setTimeout(() => { st.waiting = false; }, LOCK_MS + 5000); // 對方沒成功：讓下一輪重新判斷
  }

  function tick() {
    const form = loginForm();
    if (!form) {
      st.waiting = false;
      if (st.noticed) notice('');
      if (Date.now() > st.holdRouteUntil && validRoute(location.hash)) ss.set(SS_ROUTE, location.hash);
      return;
    }
    if (st.busy || st.waiting) return;
    if (!isEnabled()) return notice('');
    if (!getCreds()) return notice('尚未設定帳號密碼（Tampermonkey 圖示 → Dentall 自動登入 → 設定帳號密碼）');
    const p = getPaused();
    if (p) return notice('上次失敗（' + p.reason + '），已暫停。請手動登入，並從 Tampermonkey 選單重新開啟。');
    const last = Number(ss.get(SS_LAST_TRY)) || 0;
    const wait = RETRY_MS - (Date.now() - last);
    if (wait > 0) return notice('這個分頁剛試過，' + Math.ceil(wait / 60000) + ' 分鐘後才會再試。');
    if (lockHeldByOther()) return startWaiting();
    tryLogin(form);
  }

  // ---------- 設定帳號密碼的小視窗（密碼欄位用 type=password，不用 prompt 明碼顯示） ----------
  function openCredsDialog() {
    const old = getCreds();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML = '<form style="background:#fff;color:#222;border-radius:8px;padding:20px;width:100%;max-width:340px;font:14px/1.6 system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.3)">'
      + '<div style="font-weight:600;font-size:16px;margin-bottom:8px">Dentall 自動登入：帳號密碼</div>'
      + '<div style="color:#666;font-size:13px;margin-bottom:12px">只存在這台電腦的 Tampermonkey，不會上傳。</div>'
      + '<label style="display:block;margin-bottom:8px">帳號<input name="u" autocomplete="off" style="display:block;width:100%;box-sizing:border-box;padding:6px 8px;margin-top:2px;border:1px solid #ccc;border-radius:4px"></label>'
      + '<label style="display:block;margin-bottom:14px">密碼<input name="p" type="password" autocomplete="new-password" style="display:block;width:100%;box-sizing:border-box;padding:6px 8px;margin-top:2px;border:1px solid #ccc;border-radius:4px"></label>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button type="button" data-x style="padding:6px 14px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer">取消</button>'
      + '<button type="submit" style="padding:6px 14px;border:0;border-radius:4px;background:#1677ff;color:#fff;cursor:pointer">儲存</button></div></form>';
    const f = wrap.querySelector('form');
    f.u.value = old ? old.u : '';
    f.p.placeholder = old ? '（留空＝沿用原本的密碼）' : '';
    const close = () => wrap.remove();
    wrap.querySelector('[data-x]').onclick = close;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    f.onsubmit = (e) => {
      e.preventDefault();
      const u = f.u.value.trim();
      const p = f.p.value || (old && old.u === u ? old.p : '');
      if (!u || !p) { alert('帳號和密碼都要填'); return; }
      GM_setValue(G.creds, { u, p });
      GM_setValue(G.enabled, true);
      GM_deleteValue(G.paused);
      ss.set(SS_LAST_TRY, '0');
      addLog('設定', '已更新帳號密碼');
      close();
      menu();
      notice('');
    };
    document.body.appendChild(wrap);
    f.u.focus();
  }

  // ---------- Tampermonkey 選單 ----------
  let ids = [];
  function menu() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      ids.forEach((id) => { try { GM_unregisterMenuCommand(id); } catch (_) { /* ignore */ } });
    }
    ids = [];
    const add = (label, fn) => ids.push(GM_registerMenuCommand(label, fn));
    const creds = getCreds();
    const paused = getPaused();

    add(creds ? '🔑 帳號密碼（已設定：' + creds.u + '）' : '🔑 設定帳號密碼', openCredsDialog);
    add('🗑 清除帳號密碼', () => {
      if (!confirm('清除這台電腦存的 Dentall 帳號密碼？')) return;
      GM_deleteValue(G.creds);
      addLog('設定', '已清除帳號密碼');
      menu();
    });
    if (paused) {
      add('⚠ 已暫停（上次失敗）→ 點此恢復', () => {
        GM_deleteValue(G.paused);
        GM_setValue(G.enabled, true);
        ss.set(SS_LAST_TRY, '0');
        addLog('設定', '恢復自動登入');
        menu();
      });
    } else {
      add('自動登入：' + (isEnabled() ? '開 ✅（點此關閉）' : '關（點此開啟）'), () => {
        const on = !isEnabled();
        GM_setValue(G.enabled, on);
        if (on) { GM_deleteValue(G.paused); ss.set(SS_LAST_TRY, '0'); }
        addLog('設定', on ? '自動登入：開' : '自動登入：關');
        menu();
      });
    }
    add('📋 最近紀錄', () => {
      const list = GM_getValue(G.log, []);
      const p = getPaused();
      const head = p ? '⚠ 目前已暫停：' + p.reason + '\n\n' : '';
      if (!list.length) { alert(head + '還沒有任何紀錄。'); return; }
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
      alert(head + '最近紀錄（新 → 舊，不記帳號密碼）\n\n'
        + list.map((e) => fmt(e.t) + '  ' + e.result + '  ' + e.route + (e.note ? '  ' + e.note : '')).join('\n'));
    });
  }

  menu();
  setInterval(tick, 1000);
  tick();
})();
