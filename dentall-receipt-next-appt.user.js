// ==UserScript==
// @name         Dentall 健保批價單 加印下次預約
// @namespace    htdayreportviewer
// @version      1.0.0
// @description  在 dentall HiS 的健保批價單底部加印病患未來兩筆預約（民國日期＋星期＋時間）
// @match        https://his.dentall.io/*
// @run-at       document-start
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js
// @require      https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__dentallNextAppt) return;

  // mode: 'diag' 只在 Console 記錄、不改 PDF；'live' 真的加字
  const CFG = Object.assign({
    mode: 'live',
    fontUrl: 'https://storage.googleapis.com/dentall-web-static/TW-Sung-98_1-mix.ttf',
    fontkitUrl: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    maxItems: 2,
    align: 'center', // 'center' 置中；'left' 則用 x
    x: 28.4,         // pt，align 為 left 時的左緣
    yTop: 372,       // pt，自頁面頂端起算（註記 3 下方）
    fontSize: 13,
    bold: true,      // TW-Sung 沒有粗體字檔，用「填色＋描邊」模擬粗體
    boldWidth: 0.45, // 描邊寬度 pt，越大越粗
    label: '下次預約：',
    separator: '　／　',
    a5: { w: 595.28, h: 419.53 },
  }, window.__dentallNextApptConfig || {});

  const TAG = '[dentall-next-appt]';
  const log = (...a) => console.log(TAG, ...a);
  const S = { cfg: CFG, store: null, apiHeaders: null, blobs: new Map(), pending: new WeakMap(), fontBytes: null, lastOutput: null };
  window.__dentallNextAppt = S;

  // ---- 1. 抓 Redux store：app 用 window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose 組 store ----
  const compose = (...fns) => fns.length === 0 ? (x) => x : fns.length === 1 ? fns[0]
    : fns.reduce((a, b) => (...args) => a(b(...args)));
  let innerCompose = null;
  const wrapCompose = (c) => (...enhancers) => (createStore) => (...args) => {
    const store = c(...enhancers)(createStore)(...args);
    S.store = store;
    log('store captured');
    return store;
  };
  try {
    Object.defineProperty(window, '__REDUX_DEVTOOLS_EXTENSION_COMPOSE__', {
      configurable: true,
      get() { return wrapCompose(innerCompose || compose); },
      set(v) { innerCompose = typeof v === 'function' ? v : null; },
    });
  } catch (e) { log('devtools hook failed', e); }

  // ---- 2. 包 fetch：記下 app 自己送 API 時用的 header（Authorization、x-Version…） ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && url.indexOf('/api/') !== -1 && init && init.headers) {
        const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : Object.assign({}, init.headers);
        if (h.Authorization || h.authorization) {
          delete h['content-type']; delete h['Content-Type'];
          S.apiHeaders = h;
        }
      }
    } catch (e) { /* ignore */ }
    return origFetch.apply(this, arguments);
  };

  // ---- 3. 包 createObjectURL：記住 blob URL 對應的 Blob ----
  const origCOU = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const u = origCOU(obj);
    if (obj instanceof Blob) {
      S.blobs.set(u, obj);
      if (S.blobs.size > 20) S.blobs.delete(S.blobs.keys().next().value);
    }
    return u;
  };

  // ---- 4. 攔 <iframe title="pdf-print-view"> 的 src：改完 PDF 再交給 iframe，app 的 onload→print 不動 ----
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  const shouldHandle = (el, v) =>
    el.title === 'pdf-print-view' && typeof v === 'string' && v.indexOf('blob:') === 0 &&
    /#\/pd\//.test(location.hash) && S.blobs.has(v);
  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
    configurable: true,
    enumerable: srcDesc.enumerable,
    get() { return srcDesc.get.call(this); },
    set(v) {
      if (!shouldHandle(this, v)) { srcDesc.set.call(this, v); return; }
      const el = this;
      if (CFG.mode !== 'live') {
        srcDesc.set.call(el, v);                       // 診斷模式：照常列印，只記錄
        handle(v).catch((e) => log('diag error', e));
        return;
      }
      const blob = S.blobs.get(v);
      if (!S.pending.has(blob)) {
        S.pending.set(blob, handle(v).catch((e) => { log('error, fallback to original', e); return null; }));
      }
      S.pending.get(blob).then((newUrl) => srcDesc.set.call(el, newUrl || v));
    },
  });

  async function handle(url) {
    const blob = S.blobs.get(url);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.load(bytes);
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();
    log('pdf', pdfDoc.getPageCount(), 'page(s)', width.toFixed(2), 'x', height.toFixed(2), 'bytes', bytes.length);
    if (Math.abs(width - CFG.a5.w) > 2 || Math.abs(height - CFG.a5.h) > 2) { log('not A5 landscape, skip'); return null; }

    const { reg, patient } = getContext();
    const appt = reg && reg.appointment;
    const patientId = (patient && patient.id) || (appt && (appt.patientId || (appt.patient && appt.patient.id)));
    log('registration', reg && reg.id, 'patientId', patientId, 'current appt', appt && appt.id, appt && appt.expectedArrivalTime);
    if (!patientId) { log('no patientId, skip'); return null; }

    const list = await fetchAppointments(patientId);
    const next = pickNext(list, reg);
    log('next', next.map((a) => [a.id, a.expectedArrivalTime, a.status]), '->', next.map(fmt).join(CFG.separator));
    if (CFG.mode !== 'live' || next.length === 0) return null;

    const text = CFG.label + next.map(fmt).join(CFG.separator);
    pdfDoc.registerFontkit(await getFontkit());
    const font = await pdfDoc.embedFont(await getFontBytes(), { subset: true });
    const textWidth = font.widthOfTextAtSize(text, CFG.fontSize);
    const x = CFG.align === 'center' ? (width - textWidth) / 2 : CFG.x;
    const y = height - CFG.yTop - CFG.fontSize;
    if (CFG.bold) {
      page.pushOperators(PDFLib.pushGraphicsState(),
        PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.FillAndOutline), PDFLib.setLineWidth(CFG.boldWidth));
    }
    page.drawText(text, { x, y, size: CFG.fontSize, font, color: PDFLib.rgb(0, 0, 0) });
    if (CFG.bold) page.pushOperators(PDFLib.popGraphicsState());
    const out = await pdfDoc.save();
    const newBlob = new Blob([out], { type: 'application/pdf' });
    S.lastOutput = newBlob;
    log('modified pdf bytes', out.length);
    return origCOU(newBlob);
  }

  // 後備：腳本若比 app 晚跑而沒攔到 store，就從 React fiber 樹找 <Provider store>
  function findStoreFromFiber() {
    const root = document.getElementById('root');
    if (!root) return null;
    let fiber = root._reactRootContainer && root._reactRootContainer._internalRoot && root._reactRootContainer._internalRoot.current;
    if (!fiber) { const k = Object.keys(root).find((k) => k.indexOf('__reactContainer') === 0); fiber = k ? root[k] : null; }
    const stack = fiber ? [fiber] : [];
    for (let n = 0; stack.length && n < 5000; n++) {
      const f = stack.pop();
      const p = f.memoizedProps;
      if (p && p.store && typeof p.store.getState === 'function') return p.store;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }

  function getContext() {
    try {
      if (!S.store) { S.store = findStoreFromFiber(); log('store from fiber:', !!S.store); }
      const st = S.store && S.store.getState();
      const pd = (st && st.procedureDocumentPageReducer && st.procedureDocumentPageReducer.pd) || {};
      if (CFG.mode !== 'live') {
        log('patient keys', pd.patient && Object.keys(pd.patient),
          'appointment keys', pd.registration && pd.registration.appointment && Object.keys(pd.registration.appointment));
      }
      return { reg: pd.registration, patient: pd.patient };
    } catch (e) { log('getContext error', e); return {}; }
  }

  function apiBase() {
    return location.origin + '/' + location.pathname.split('/')[1] + '/api';
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function fetchAppointments(patientId) {
    const headers = Object.assign({}, S.apiHeaders || {});
    if (!headers.Authorization && !headers.authorization) {
      const t = cookie('token');
      if (t) headers.Authorization = 'Bearer ' + t;
    }
    const url = apiBase() + '/appointments?patientId.equals=' + encodeURIComponent(patientId) + '&size=1000';
    const res = await origFetch(url, { headers, credentials: 'same-origin' });
    log('appointments status', res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data && (data.content || data.data)) || [];
    if (CFG.mode !== 'live') log('appointments count', list.length, 'sample', list.slice(0, 3));
    return list;
  }

  function pickNext(list, reg) {
    const curId = reg && reg.appointment && reg.appointment.id;
    const curTime = reg && reg.appointment && reg.appointment.expectedArrivalTime
      ? new Date(reg.appointment.expectedArrivalTime).getTime() : 0;
    const floor = Math.max(Date.now(), curTime);
    return list
      .filter((a) => a && a.expectedArrivalTime && a.status !== 'CANCEL' && !a.isBlock && a.id !== curId
        && new Date(a.expectedArrivalTime).getTime() > floor)
      .sort((a, b) => new Date(a.expectedArrivalTime) - new Date(b.expectedArrivalTime))
      .slice(0, CFG.maxItems);
  }

  function fmt(a) {
    const d = new Date(a.expectedArrivalTime);
    const p = (n) => String(n).padStart(2, '0');
    const wd = '日一二三四五六'[d.getDay()];
    return (d.getFullYear() - 1911) + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) +
      '（' + wd + '）' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // Tampermonkey 的 @require 不一定把 UMD 全域掛到 window；先試裸識別字，再退回自行載入
  async function getFontkit() {
    if (S.fontkit) return S.fontkit;
    let fk = null;
    try { fk = (typeof fontkit !== 'undefined' && fontkit) || window.fontkit || null; } catch (e) { fk = null; }
    if (!fk) {
      log('fontkit global missing, loading from', CFG.fontkitUrl);
      const src = await (await origFetch(CFG.fontkitUrl)).text();
      const mod = { exports: {} };
      new Function('module', 'exports', 'define', src)(mod, mod.exports, undefined);
      fk = mod.exports;
    }
    if (!fk || typeof fk.create !== 'function') throw new Error('fontkit unavailable');
    S.fontkit = fk;
    return fk;
  }

  async function getFontBytes() {
    if (S.fontBytes) return S.fontBytes;
    if (!S.fontPromise) {
      S.fontPromise = origFetch(CFG.fontUrl, { credentials: 'omit' })
        .then((r) => { if (!r.ok) throw new Error('font http ' + r.status); return r.arrayBuffer(); })
        .then((b) => { S.fontBytes = new Uint8Array(b); log('font loaded', S.fontBytes.length); return S.fontBytes; })
        .catch((e) => { S.fontPromise = null; throw e; });
    }
    return S.fontPromise;
  }

  // 進到處置單頁面就先把字型抓進記憶體（瀏覽器已有快取，通常很快）
  const preload = () => { if (CFG.mode === 'live' && /#\/pd\//.test(location.hash)) getFontBytes().catch((e) => log('font preload failed', e)); };
  window.addEventListener('hashchange', preload);
  window.addEventListener('DOMContentLoaded', preload);

  log('installed, mode =', CFG.mode);
})();
