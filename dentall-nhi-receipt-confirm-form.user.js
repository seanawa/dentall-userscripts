// ==UserScript==
// @name         Dentall 健保收據 附印醫療確認單
// @namespace    htdayreportviewer
// @version      2.0.2
// @description  his.dentall.io 列印「健保批價單」（健保看診收據）時，在同一份 PDF 後面加一頁 A5 的「全民健保牙醫門診醫療服務北區 醫療確認單」，一次列印就一起印出；姓名、就醫日期、院所名稱/代號自動帶入。
// @match        https://his.dentall.io/*
// @homepageURL  https://github.com/seanawa/dentall-userscripts
// @supportURL   https://github.com/seanawa/dentall-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-nhi-receipt-confirm-form.user.js
// @downloadURL  https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-nhi-receipt-confirm-form.user.js
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

/*
 * 原理：
 *   Dentall 的健保批價單是前端產生的 A5 橫式 PDF（blob），塞進 <iframe title="pdf-print-view"> 後呼叫 print()。
 *   1. 把程式以 <script> 注入頁面主世界，攔截那個 iframe 的 src 設定（和「健保批價單 加印下次預約」同一招，兩支可以同時裝，順序不拘）。
 *   2. 拿到 PDF 後：第一頁不是 A5 橫式就原樣放行；用 pdf.js 讀出第一頁的文字，確認是健保收據（批價單的標題與欄位名稱是底圖讀不到，只看填入的值裡有沒有「健保」字樣）。
 *   3. 從收據文字找「病患姓名」「就診日期」「院所代號」旁邊的值；讀不到時，姓名／日期改從 Dentall 的 Redux store 取，
 *      院所名稱/代號改用選單設定的文字（批價單上沒有院所名稱，名稱一定要在選單設定一次）。
 *   4. 用 pdf-lib 在同一份 PDF 後面畫上 A5 橫式的醫療確認單（字型用收據同款 TW-Sung，只嵌入用到的字），
 *      再把新的 PDF 交回 iframe，Dentall 原本的列印流程不動：一次列印、同一台印表機、同一種紙。
 *   5. 任何一步失敗（函式庫或字型載不到、PDF 讀不了…）都原樣列印收據，不會卡住櫃台。
 *   6. Tampermonkey 圖示的選單：手動列印確認單、開關自動附印、設定院所名稱/代號、每次張數（一式二聯可設 2）、
 *      查看最近的處理紀錄（只記結果與各欄是否帶入，不記病患資料）。
 * 姓名與日期只用在當次列印、只留在記憶體；手動補印時，30 分鐘內最後一張收據的資料會再帶入一次。
 * 設定存在這台電腦的瀏覽器（localStorage），每台電腦各自設定。腳本不呼叫任何 Dentall API。
 */
(function loader() {
  'use strict';
  const TAG = '[dentall-userscripts/confirm-form]';
  const KEY = 'dentall-confirm-form-settings';
  const LOG_KEY = 'dentall-confirm-form-log';
  const EVT = 'dus-confirm-form:print';
  const DEFAULTS = { auto: true, clinic: '', copies: 1 };
  const LIBS = {
    pdfLib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    fontkit: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    font: 'https://storage.googleapis.com/dentall-web-static/TW-Sung-98_1-mix.ttf',
  };

  // ===================== 頁面主世界執行的程式 =====================
  function pageCode(KEY, LOG_KEY, EVT, DEFAULTS, LIBS) {
    const TAG = '[dentall-userscripts/confirm-form]';
    const W = window;
    if (W !== W.top || W.__dusConfirmFormInstalled) return;
    W.__dusConfirmFormInstalled = true;

    const A5 = { w: 595.28, h: 419.53 };
    const PRINT_TITLE = 'pdf-print-view';
    const MARK = 'dus-confirm-form';
    const MANUAL_REUSE_MS = 30 * 60 * 1000;
    const isPdRoute = () => /#\/pd\//.test(location.hash);

    function settings() {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { /* ignore */ }
      return Object.assign({}, DEFAULTS, s || {});
    }

    function record(entry) {
      entry = Object.assign({ t: new Date().toLocaleString('zh-TW', { hour12: false }) }, entry);
      console.log(TAG, entry.result, entry);
      try {
        const list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        list.unshift(entry);
        localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 10)));
      } catch (_) { /* ignore */ }
    }

    // ---------- 函式庫：抓原始碼後以 CommonJS 方式執行，不依賴全域變數、不受頁面 AMD loader 影響 ----------
    const libCache = {};
    function loadLib(name) {
      if (!libCache[name]) {
        libCache[name] = (async () => {
          const res = await fetch(LIBS[name], { credentials: 'omit' });
          if (!res.ok) throw new Error(name + ' http ' + res.status);
          const src = await res.text();
          const mod = { exports: {} };
          new Function('module', 'exports', 'define', src)(mod, mod.exports, undefined);
          return mod.exports;
        })().catch((e) => { delete libCache[name]; throw e; });
      }
      return libCache[name];
    }
    async function getPdfjs() {
      const [lib, worker] = await Promise.all([loadLib('pdfjs'), loadLib('pdfjsWorker')]);
      // 有 globalThis.pdfjsWorker 時 pdf.js 直接在主執行緒解析，不必另開 Web Worker
      if (!W.pdfjsWorker) W.pdfjsWorker = worker;
      return lib;
    }
    let fontPromise = null;
    function getFontBytes() {
      if (!fontPromise) {
        fontPromise = fetch(LIBS.font, { credentials: 'omit' })
          .then((r) => { if (!r.ok) throw new Error('font http ' + r.status); return r.arrayBuffer(); })
          .then((b) => new Uint8Array(b))
          .catch((e) => { fontPromise = null; throw e; });
      }
      return fontPromise;
    }
    // 進到處置單頁就先把函式庫和字型抓好（字型 Dentall 自己也在用，通常已有快取）
    function preload() {
      if (!isPdRoute() || !settings().auto) return;
      Promise.all([loadLib('pdfLib'), loadLib('fontkit'), getPdfjs(), getFontBytes()])
        .catch((e) => console.warn(TAG, '預先載入失敗', e));
    }
    W.addEventListener('hashchange', preload);
    W.addEventListener('DOMContentLoaded', preload);

    // ---------- 攔截批價單 iframe 的 src ----------
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    const pending = new Map(); // 原 blob URL → Promise<新 URL | null>
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get() { return srcDesc.get.call(this); },
      set(v) {
        const el = this;
        if (!(el.title === PRINT_TITLE && typeof v === 'string' && v.indexOf('blob:') === 0 && settings().auto)) {
          srcDesc.set.call(el, v);
          return;
        }
        if (!pending.has(v)) {
          pending.set(v, appendForm(v).catch((e) => {
            record({ result: '發生錯誤，收據原樣列印：' + (e && e.message || e) });
            return null;
          }));
          if (pending.size > 20) pending.delete(pending.keys().next().value);
        }
        pending.get(v).then((nu) => srcDesc.set.call(el, nu || v));
      },
    });

    async function appendForm(url) {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const L = await loadLib('pdfLib');
      const doc = await L.PDFDocument.load(bytes);
      if (String(doc.getKeywords() || '').indexOf(MARK) !== -1) return null; // 已經加過
      const { width, height } = doc.getPage(0).getSize();
      if (Math.abs(width - A5.w) > 2 || Math.abs(height - A5.h) > 2) {
        record({ result: `不是 A5 橫式（${width.toFixed(0)}×${height.toFixed(0)}pt），略過` });
        return null;
      }

      let lines = null;
      try { lines = await pdfLines(bytes); } catch (e) { console.warn(TAG, '讀取收據文字失敗', e); }
      // 批價單的標題「醫療費用收據」和欄位名稱是底圖，讀不到文字；能讀到的只有填入的值（院所、病患、「健保 (02)」、金額…）。
      // 健保處方箋是 A4 直式，上面已經略過；所以 A5 橫式＋有「健保」字樣就當成健保批價單。
      const flat = lines ? lines.map((c) => c.join('')).join('').normalize('NFKC').replace(/\s+/g, '') : '';
      if (/[一-鿿]/.test(flat)) {
        if (!/健保/.test(flat)) {
          // 只記第一行（通常是院所名稱）方便查原因，不記姓名等內容
          const head = lines[0] ? lines[0].join(' ').slice(0, 30) : '';
          record({ result: `不是健保收據，略過（第一行：${head}）` });
          return null;
        }
      } else if (!isPdRoute()) {
        record({ result: '讀不到文字且不在處置單頁，略過' });
        return null;
      }

      const fromPdf = lines ? extractFromLines(lines) : {};
      const fromStore = storeInfo();
      const info = {
        name: fromPdf.name || fromStore.name || '',
        date: fromPdf.date || fromStore.date || '',
        clinicName: fromPdf.clinicName || '',
        clinicCode: fromPdf.clinicCode || '',
      };
      W.__dusConfirmLastInfo = { info, at: Date.now() };

      const copies = await addForms(L, doc, info);
      doc.setKeywords([MARK]);
      const out = await doc.save();
      const filled = fillClinic(info);
      record({
        result: `已在收據後面加 ${copies} 頁確認單`,
        found: {
          name: info.name ? (fromPdf.name ? '收據' : 'store') : '',
          date: info.date ? (fromPdf.date ? '收據' : 'store') : '',
          clinic: filled.name ? (info.clinicName ? '收據' : '設定') : '',
          code: filled.code ? (info.clinicCode ? '收據' : '設定') : '',
        },
      });
      return URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    }

    // ---------- 讀收據文字：pdf.js 取文字 → 依位置排成「行 × 格」 ----------
    async function pdfLines(bytes) {
      const pdfjs = await getPdfjs();
      const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true });
      const pdf = await task.promise;
      try {
        const page = await pdf.getPage(1);
        const tc = await page.getTextContent();
        const items = tc.items
          .filter((it) => it.str && it.str.trim())
          .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10 }));
        const rows = [];
        for (const it of items) {
          const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.35));
          if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
        }
        rows.sort((a, b) => b.y - a.y);
        return rows.map((r) => {
          r.items.sort((a, b) => a.x - b.x);
          const cells = [];
          let cur = '', end = null;
          for (const it of r.items) {
            const gap = end === null ? 0 : it.x - end;
            if (end !== null && gap > Math.max(6, it.h * 0.8)) { cells.push(cur.trim()); cur = ''; } else if (gap > it.h * 0.2) cur += ' ';
            cur += it.s;
            end = it.x + it.w;
          }
          cells.push(cur.trim());
          return cells;
        });
      } finally {
        pdf.destroy();
      }
    }

    // 標籤 → 值：同一格標籤後面的文字 → 右邊第一個非空格 → 下一行同一欄
    function findLabeled(lines, labelRe, check, badBefore) {
      const re = new RegExp(labelRe.source + '\\s*[:：]?\\s*(.*)$');
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i];
        for (let j = 0; j < cells.length; j++) {
          const m = cells[j].match(re);
          if (!m) continue;
          const before = cells[j].slice(0, m.index);
          if (badBefore && badBefore.test(before)) continue;
          const candidates = [m[1]];
          const right = cells.slice(j + 1).find((c) => c);
          if (!m[1] && right !== undefined) candidates.push(right);
          if (!m[1] && lines[i + 1] && lines[i + 1][j]) candidates.push(lines[i + 1][j]);
          for (const c of candidates) {
            const v = c && check(c);
            if (v) return v;
          }
        }
      }
      return '';
    }

    const OTHER_LABELS = /(病歷|性別|身分|身份|生日|出生|年齡|電話|卡號|就醫|就診|看診|日期|號碼|序號|地址|醫師|科別|身\s*分\s*證|ID)/;
    function checkName(v) {
      v = String(v).trim();
      // 英文姓名可以有空白，整段保留（例如 TEST PATIENT）
      const en = v.match(/^[A-Za-z][A-Za-z .'\-]{0,40}[A-Za-z.]/);
      if (en && !OTHER_LABELS.test(en[0])) return en[0].replace(/\s+/g, ' ');
      let t = v.split(/\s+/)[0] || '';
      const k = t.search(OTHER_LABELS);
      if (k === 0) return null;
      if (k > 0) t = t.slice(0, k);
      t = t.replace(/[:：,，;；、()（）]+$/, '');
      if (t.length < 2 || t.length > 12) return null;
      if (!/^[一-鿿A-Za-z○〇Ｏ＊*·．.\-]+$/.test(t)) return null;
      return t;
    }
    const DATE_RE = /(\d{2,4})\s*([\/.\-年])\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})\s*日?/;
    function checkDate(v) {
      const m = v.match(DATE_RE);
      if (m) {
        const y = +m[1], mo = +m[3], d = +m[4];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        if (!(y >= 50 && y <= 200) && !(y >= 1960 && y <= 2100)) return null;
        return m[0].replace(/\s+/g, '');
      }
      const c = v.match(/(?:^|\D)(1\d{2})(\d{2})(\d{2})(?:\D|$)/); // 民國 7 碼：1151008
      if (c && +c[2] >= 1 && +c[2] <= 12 && +c[3] >= 1 && +c[3] <= 31) return `${c[1]}/${c[2]}/${c[3]}`;
      return null;
    }
    const CLINIC_RE = /(?![本貴該])[一-鿿]{2,20}?(?:牙醫診所|牙科診所|牙醫醫院|醫院|診所)/;
    function checkClinicName(v) {
      const m = v.match(CLINIC_RE);
      return m ? m[0] : null;
    }
    function checkCode(v) {
      const m = String(v).match(/(?:^|\D)(\d{10})(?:\D|$)/);
      return m ? m[1] : null;
    }

    function extractFromLines(lines) {
      const name = findLabeled(lines, /(?:病患|病人|患者|就醫者|保險對象)?姓\s*名/, checkName, /(醫師|醫生|負責人|經手人|收費員|操作員)\s*$/);
      const date = findLabeled(lines, /(?:就醫|就診|看診|門診|診療|治療)日期/, checkDate)
        || findLabeled(lines, /(?:收費|交易|收據|列印)?日期/, checkDate, /(出生|生)\s*$/);
      let clinicCode = findLabeled(lines, /(?:醫事機構|醫療院所|院所|機構|醫事|診所)(?:代號|代碼|編號)/, checkCode);
      let clinicName = findLabeled(lines, /(?:醫事機構|醫療院所|院所|機構|診所)名稱/, checkClinicName);
      if (!clinicName) {
        // 沒有標籤時，取最前面出現、以「○○診所／醫院」開頭的一段（例如收據抬頭）
        outer: for (const cells of lines) {
          for (const c of cells) {
            if (/名稱/.test(c)) continue;
            for (const seg of c.split(/[\s,，、:：;；|｜()（）\[\]【】「」]+/)) {
              const m = seg.match(CLINIC_RE);
              if (m && m.index === 0) { clinicName = m[0]; break outer; }
            }
          }
        }
      }
      if (!clinicCode && clinicName) {
        const line = lines.find((cells) => cells.some((c) => c.replace(/\s+/g, '').includes(clinicName)));
        if (line) clinicCode = checkCode(line.join(' ')) || '';
      }
      return { name, date, clinicName, clinicCode };
    }

    // ---------- 後備：Dentall 的 Redux store（處置單頁的病患與掛號） ----------
    let cachedStore = null;
    function findStore() {
      const shared = W.__dentallNextAppt && W.__dentallNextAppt.store; // 「加印下次預約」腳本攔到的 store
      if (shared) return shared;
      if (cachedStore) return cachedStore;
      const root = document.getElementById('root');
      if (!root) return null;
      let fiber = root._reactRootContainer && root._reactRootContainer._internalRoot && root._reactRootContainer._internalRoot.current;
      if (!fiber) { const k = Object.keys(root).find((x) => x.indexOf('__reactContainer') === 0); fiber = k ? root[k] : null; }
      const stack = fiber ? [fiber] : [];
      for (let n = 0; stack.length && n < 5000; n++) {
        const f = stack.pop();
        const p = f.memoizedProps;
        if (p && p.store && typeof p.store.getState === 'function') { cachedStore = p.store; return cachedStore; }
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
      return null;
    }
    function rocDate(v) {
      const d = v ? new Date(v) : null;
      if (!d || isNaN(d)) return '';
      const p = (n) => String(n).padStart(2, '0');
      return (d.getFullYear() - 1911) + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate());
    }
    function storeInfo() {
      try {
        const store = findStore();
        const st = store && store.getState();
        const pd = (st && st.procedureDocumentPageReducer && st.procedureDocumentPageReducer.pd) || {};
        const reg = pd.registration || {};
        const appt = reg.appointment || {};
        return {
          name: (pd.patient && pd.patient.name && checkName(pd.patient.name)) || '',
          date: rocDate(reg.arrivalTime) || rocDate(appt.expectedArrivalTime),
        };
      } catch (_) { return {}; }
    }

    // ---------- 院所名稱/代號：收據上的優先，缺的用選單設定補 ----------
    function fillClinic(info) {
      const manual = (settings().clinic || '').trim();
      const mCode = checkCode(manual) || '';
      const mName = manual.replace(mCode, '').replace(/[\s/／,，、:：|｜()（）]+/g, ' ').trim();
      return { name: (info && info.clinicName) || mName, code: (info && info.clinicCode) || mCode };
    }

    // ---------- 畫確認單（A5 橫式，單位 pt，y 由頁面頂端往下算） ----------
    async function addForms(L, doc, info) {
      doc.registerFontkit(await loadLib('fontkit'));
      const font = await doc.embedFont(await getFontBytes(), { subset: true });
      const copies = Math.min(4, Math.max(1, parseInt(settings().copies, 10) || 1));
      for (let i = 0; i < copies; i++) drawForm(L, doc.addPage([A5.w, A5.h]), font, info || {});
      return copies;
    }

    function drawForm(L, page, font, info) {
      const H = A5.h, PW = A5.w;
      const black = L.rgb(0, 0, 0);
      const Y = (t) => H - t;
      const tw = (s, size) => font.widthOfTextAtSize(s, size);
      const line = (xa, ta, xb, tb, w) => page.drawLine({ start: { x: xa, y: Y(ta) }, end: { x: xb, y: Y(tb) }, thickness: w, color: black });
      const text = (s, x, base, size, o = {}) => {
        if (!s) return;
        if (o.bold) {
          page.pushOperators(L.pushGraphicsState(),
            L.setTextRenderingMode(L.TextRenderingMode.FillAndOutline), L.setLineWidth(o.boldWidth || 0.35));
        }
        page.drawText(s, { x, y: Y(base), size, font, color: black });
        if (o.bold) page.pushOperators(L.popGraphicsState());
        if (o.underline) line(x, base + size * 0.18, x + tw(s, size), base + size * 0.18, 0.6);
      };
      const center = (s, xa, xb, base, size, o) => text(s, xa + (xb - xa - tw(s, size)) / 2, base, size, o);
      const midBase = (top, bottom, size) => (top + bottom) / 2 + size * 0.36;
      const fit = (s, maxW, size) => { while (size > 6 && tw(s, size) > maxW) size -= 0.5; return size; };

      // 外框與分隔
      const x0 = 25.5, x1 = PW - 25.5, xr = x1 - 141.7;        // 右欄寬 50mm
      const yT = 72, yHd = 97.5, yNm = 128.7, yTx = 322.6, yB = 382;
      const c1 = x0 + 25.5, c3 = xr - 107.7, c2 = c3 - 53.9;   // 姓名列欄位
      const FS = 9.5;

      center('全民健保牙醫門診醫療服務北區', 0, PW, 38, 14, { bold: true, boldWidth: 0.6 });
      center('「醫療確認單」', 0, PW, 58, 14, { bold: true, boldWidth: 0.6 });

      page.drawRectangle({ x: x0, y: Y(yB), width: x1 - x0, height: yB - yT, borderColor: black, borderWidth: 0.8 });
      line(xr, yT, xr, yB, 0.8);
      [yHd, yNm, yTx].forEach((t) => line(x0, t, xr, t, 0.6));
      line(c1, yHd, c1, yTx, 0.6);
      line(c2, yHd, c2, yNm, 0.6);
      line(c3, yHd, c3, yNm, 0.6);

      // 標題列、姓名列
      center('牙醫門診醫療確認單', x0, xr, midBase(yT, yHd, FS), FS, { bold: true });
      center('姓名', x0, c1, midBase(yHd, yNm, 10), 10);
      center('就醫日期', c2, c3, midBase(yHd, yNm, 10), 10, { bold: true, underline: true });
      const vSize = 11.5;
      if (info.name) { const s = fit(info.name, c2 - c1 - 12, vSize); text(info.name, c1 + 7, midBase(yHd, yNm, s), s); }
      if (info.date) { const s = fit(info.date, xr - c3 - 12, vSize); text(info.date, c3 + 7, midBase(yHd, yNm, s), s); }

      // 處置內容明細（直排）
      const vchars = '處置內容明細'.split('');
      const vTop = (yNm + yTx) / 2 - vchars.length * 15 / 2;
      vchars.forEach((ch, i) => center(ch, x0, c1, vTop + i * 15 + 11, 10));

      // 處置項目：名稱｜__顆部位__｜起迄看診時間__
      const gx = c1 + 4.25, gEnd = xr - 4.25, gap = 2.83, rowH = 28.35, top0 = yNm + 2.83;
      const items = ['銀粉/複合體充填', '樹脂/玻璃離子體充填', '牙周治療或洗牙', '根管治療', '拔牙'];
      const wName = Math.max(...items.map((s) => tw(s, FS)));
      const b1 = gx + wName + gap, b1e = b1 + 31.2;
      const t2 = b1e + gap, b3 = t2 + tw('顆部位', FS) + gap, b3e = b3 + 59.5;
      const t4 = b3e + gap, b5 = t4 + tw('起迄看診時間', FS) + gap;
      const row = (i) => top0 + (i + 1) * rowH;
      items.forEach((s, i) => {
        const bot = row(i), base = bot - 3.6;
        text(s, gx, base, FS);
        line(b1, bot, b1e, bot, 0.6);
        text('顆部位', t2, base, FS);
        line(b3, bot, b3e, bot, 0.6);
        text('起迄看診時間', t4, base, FS);
        line(b5, bot, gEnd, bot, 0.6);
      });
      {
        const bot = row(5), base = bot - 3.6;
        text('其他', gx, base, FS);
        line(b1, bot, b3e, bot, 0.6);
        text('起迄看診時間', t4, base, FS);
        line(b5, bot, gEnd, bot, 0.6);
      }
      text('(請詳列治療項目及部位)', gx, row(5) + 18.1 - 3.6, FS, { underline: true });

      // 聯絡資訊
      const cx = x0 + 4.25;
      text('如有疑義，請洽', cx, yTx + 15.4, FS);
      text('健保署北區業務組電話：（03）4339-111', cx, yTx + 33, FS);
      text('牙醫北區審查分會電話：(03)4383-630', cx, yTx + 50.6, FS, { bold: true, underline: true });

      // 右欄：簽名聲明｜院所名稱/代號｜診治醫師簽章
      const ySig = 190.6, yL1 = 210.4, yBox = 281.6, yL2 = 301.4;
      [ySig, yL1, yBox, yL2].forEach((t) => line(xr, t, x1, t, 0.8));
      const sigW = x1 - xr - 8.5, sigSize = 8.6;
      const wrap = (s) => {
        const out = [];
        let cur = '';
        for (const ch of s) {
          if (cur && tw(cur + ch, sigSize) > sigW && !/[，。、：）」]/.test(ch)) { out.push(cur); cur = ''; }
          cur += ch;
        }
        if (cur) out.push(cur);
        return out;
      };
      const sigLines = wrap('本人確認醫師已清楚解釋治療原因、診斷結果及處置內容部份，並已在口腔內指明治療部位及內容。').concat('特此確認簽名：');
      sigLines.forEach((s, i) => text(s, xr + 4.25, yT + 13 + i * 12.5, sigSize, { bold: true }));
      center('院所名稱/代號', xr, x1, midBase(ySig, yL1, 10.5), 10.5);
      center('診治醫師簽章', xr, x1, midBase(yBox, yL2, 10.5), 10.5);
      const clinic = fillClinic(info);
      const cl = [clinic.name, clinic.code].filter(Boolean);
      const cTop = (yL1 + yBox) / 2 - cl.length * 15 / 2;
      cl.forEach((s, i) => { const sz = fit(s, x1 - xr - 8.5, 11); center(s, xr, x1, cTop + i * 15 + 11.5, sz); });
    }

    // ---------- 手動列印（選單） ----------
    async function manualPrint() {
      try {
        const last = W.__dusConfirmLastInfo;
        const info = last && Date.now() - last.at < MANUAL_REUSE_MS ? last.info : {};
        const L = await loadLib('pdfLib');
        const doc = await L.PDFDocument.create();
        await addForms(L, doc, info);
        const url = URL.createObjectURL(new Blob([await doc.save()], { type: 'application/pdf' }));
        const f = document.createElement('iframe');
        f.setAttribute('data-dus-confirm-form', 'manual');
        f.style.cssText = 'position:fixed;left:-10000px;top:0;width:842px;height:595px;border:0;';
        let done = false;
        f.addEventListener('load', () => {
          if (done) return;
          done = true;
          const fw = f.contentWindow;
          try { fw.addEventListener('afterprint', () => setTimeout(() => f.remove(), 1000), { once: true }); } catch (_) { /* ignore */ }
          setTimeout(() => f.remove(), 10 * 60 * 1000);
          fw.focus();
          fw.print();
        });
        f.src = url;
        document.body.appendChild(f);
        record({ result: '手動列印確認單' + (info.name ? '（帶入最後一張收據的資料）' : '') });
      } catch (e) {
        record({ result: '手動列印失敗：' + (e && e.message || e) });
        alert('醫療確認單列印失敗：' + (e && e.message || e));
      }
    }
    document.addEventListener(EVT, manualPrint);

    // 測試與除錯用
    W.__dusConfirmForm = { manualPrint, appendForm, extractFromLines, pdfLines, storeInfo };
  }

  // 把 pageCode 以 <script> 標籤注入頁面主世界
  try {
    const s = document.createElement('script');
    s.textContent = '(' + pageCode.toString() + ')(' +
      [KEY, LOG_KEY, EVT, DEFAULTS, LIBS].map((v) => JSON.stringify(v)).join(',') + ');';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {
    console.error(TAG, '注入失敗', e);
  }

  // ===================== Tampermonkey 選單（只在最上層視窗） =====================
  if (window.top !== window || typeof GM_registerMenuCommand !== 'function') return;

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { /* ignore */ }
    return Object.assign({}, DEFAULTS, s || {});
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
  }

  let ids = [];
  function menu() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      ids.forEach((id) => { try { GM_unregisterMenuCommand(id); } catch (_) { /* ignore */ } });
    }
    ids = [];
    const s = load();
    const add = (label, fn) => ids.push(GM_registerMenuCommand(label, fn));

    add('🖨 列印醫療確認單（A5）', () => document.dispatchEvent(new CustomEvent(EVT)));
    add(`健保收據列印時自動附印：${s.auto ? '✅ 開' : '⛔ 關'}（點一下切換）`, () => {
      s.auto = !s.auto; save(s); menu();
    });
    add(`院所名稱/代號：${s.clinic || '⚠ 未設定'}`, () => {
      const v = prompt('印在確認單「院所名稱/代號」欄。批價單上沒有院所名稱，請在這裡輸入名稱（代號可一起輸入，收據上讀得到代號時以收據為準）。\n例如：泓泰牙醫診所 3501234567', s.clinic);
      if (v === null) return;
      s.clinic = v.trim(); save(s); menu();
    });
    add(`每次張數：${s.copies}（一式二聯可設 2）`, () => {
      const v = prompt('每次附印幾張確認單（1～4）', String(s.copies));
      if (v === null) return;
      const n = parseInt(v, 10);
      if (!(n >= 1 && n <= 4)) { alert('請輸入 1～4'); return; }
      s.copies = n; save(s); menu();
    });
    add('最近的處理紀錄', () => {
      let list = [];
      try { list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (_) { /* ignore */ }
      if (!list.length) { alert('這台電腦還沒有任何紀錄。\n請先在 Dentall 處置單列印一次「健保批價單」再來看。'); return; }
      const src = (v) => (v ? `✓（${v}）` : '✗');
      alert('最近的處理紀錄（新 → 舊）\n\n' + list.map((e) =>
        `${e.t}  ${e.result}` +
        (e.found ? `\n    姓名${src(e.found.name)}  就醫日期${src(e.found.date)}  院所名稱${src(e.found.clinic)}  院所代號${src(e.found.code)}` : '')
      ).join('\n'));
    });
  }
  menu();
})();
