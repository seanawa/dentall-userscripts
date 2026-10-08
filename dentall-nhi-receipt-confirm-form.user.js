// ==UserScript==
// @name         Dentall 健保收據 附印醫療確認單
// @namespace    htdayreportviewer
// @version      1.1.0
// @description  his.dentall.io 列印健保看診收據時，接著自動列印一張 A5 的「全民健保牙醫門診醫療服務北區 醫療確認單」，姓名、就醫日期、院所名稱/代號從收據自動帶入。Tampermonkey 選單可手動列印、開關自動附印、設定院所名稱/代號、張數與紙張方向。
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
 *   1. 把真正的程式碼以 <script> 注入頁面主世界，接管頁面上所有的 print()：
 *      主頁面的 window.print、iframe 的 contentWindow.print（react-to-print、print-js 等套件都走這條）、
 *      window.open 開出來的列印視窗的 print。
 *   2. Dentall 呼叫 print() 時，先看要印的那份文件的文字：同時有「收據」和健保相關字樣
 *      （健保／部分負擔／就醫序號…）就當作健保看診收據。
 *   3. 收據的列印對話框關閉（或自動列印完成）後，再用一個看不到的 iframe 印一張 A5 的醫療確認單。
 *      兩份是分開的列印工作，收據原本的紙張設定不受影響；確認單自己指定 A5。
 *      若 Chrome 以 --kiosk-printing 啟動（不跳對話框直接印），兩份都會直接送出。
 *   4. 姓名、就醫日期、院所名稱/代號從那張收據的文字自動帶入：找「姓名」「就醫日期／就診日期」
 *      「醫事機構名稱／代號」這類標籤旁邊（同一格、右邊一格或正下方一格）的值。
 *      收據上找不到院所名稱/代號時，改用選單裡設定的文字。處置內容與簽名仍留白手寫。
 *      姓名與日期只用在當次列印、只留在記憶體，不寫進 localStorage；
 *      手動補印（選單）時，30 分鐘內印過的最後一張收據的資料會再帶入一次。
 *   5. Tampermonkey 圖示的選單可以：手動列印確認單、開關自動附印、設定院所名稱/代號（收據上找不到時使用）、
 *      每次張數（一式二聯可設 2）、A5 橫式／直式、查看最近幾次的列印偵測紀錄（只記來源、命中的關鍵字與各欄是否帶入，不記病患資料）。
 * 設定存在這台電腦的瀏覽器（localStorage），每台電腦各自設定。
 * 不呼叫 API。
 */
(function loader() {
  'use strict';
  const TAG = '[dentall-userscripts/confirm-form]';
  const KEY = 'dentall-confirm-form-settings';
  const LOG_KEY = 'dentall-confirm-form-log';
  const EVT = 'dus-confirm-form:print';
  const DEFAULTS = { auto: true, clinic: '', copies: 1, orientation: 'landscape' };

  // ===================== 頁面主世界執行的程式 =====================
  function pageCode(KEY, LOG_KEY, EVT, DEFAULTS) {
    const TAG = '[dentall-userscripts/confirm-form]';
    const W = window;
    if (W.__dusConfirmFormInstalled) return;
    W.__dusConfirmFormInstalled = true;

    // 收據判斷：同時符合兩組字樣才算健保看診收據
    const RECEIPT_RE = /收據/;
    const NHI_RE = /健保|部分負擔|部份負擔|就醫序號|健保卡/;
    // 偵測紀錄只記這些字有沒有出現，不記任何病患資料
    const VOCAB = ['收據', '健保', '部分負擔', '部份負擔', '就醫序號', '掛號費', '自費', '處方', '藥袋', '明細', '醫療確認單',
      '姓名', '就醫日期', '就診日期', '看診日期', '日期', '醫事機構', '院所', '代號', '代碼', '診所'];
    const MANUAL_REUSE_MS = 30 * 60 * 1000; // 手動補印時，帶入多久以內的上一張收據資料
    const SELF_TITLE = '牙醫門診醫療確認單';
    const DEDUPE_MS = 5000;    // 同一次收據列印被多個掛勾同時抓到時只附印一次
    const WAIT_MAX_MS = 120000; // 非阻塞列印時，最多等這麼久的 afterprint
    const OUR_ATTR = 'data-dus-confirm-form';

    function settings() {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { /* ignore */ }
      return Object.assign({}, DEFAULTS, s || {});
    }

    function record(entry) {
      console.log(TAG, '偵測到列印', entry);
      try {
        const list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        list.unshift(entry);
        localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 10)));
      } catch (_) { /* ignore */ }
    }

    function topWin() {
      try { if (W.top && W.top.document) return W.top; } catch (_) { /* 跨網域 */ }
      return W;
    }

    function docText(win) {
      try {
        const b = win.document && win.document.body;
        if (!b) return '';
        return (b.innerText || b.textContent || '').replace(/\s+/g, '');
      } catch (_) { return ''; }
    }

    function isReceipt(text) {
      if (!text || text.includes(SELF_TITLE)) return false;
      return RECEIPT_RE.test(text) && NHI_RE.test(text);
    }

    // ---------- 接管 print() ----------
    const IFRAME_CW = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    const patched = new WeakSet();

    function wrapPrint(win, source) {
      try {
        if (!win || patched.has(win)) return;
        const orig = win.print;
        if (typeof orig !== 'function') return;
        patched.add(win);
        win.print = function () {
          const text = docText(win);
          const hit = isReceipt(text);
          const s = settings();
          let info = null;
          if (hit) { try { info = extractInfo(win.document); } catch (e) { console.warn(TAG, '讀取收據資料失敗', e); } }
          record({
            t: new Date().toLocaleString('zh-TW', { hour12: false }),
            source,
            receipt: hit,
            auto: s.auto,
            words: VOCAB.filter((w) => text.includes(w)),
            found: info ? { name: !!info.name, date: !!info.date, clinic: !!info.clinicName, code: !!info.clinicCode } : null,
          });
          const want = hit && s.auto;
          let after = false;
          if (want) { try { win.addEventListener('afterprint', () => { after = true; }, { once: true }); } catch (_) { /* ignore */ } }
          const t0 = Date.now();
          try {
            return orig.apply(win, arguments);
          } finally {
            // Chrome 的 print() 通常會等對話框關閉才返回；返回得很慢就代表對話框已經關了
            const blocked = Date.now() - t0 > 300;
            if (want) afterReceipt(win, () => after || blocked, info);
          }
        };
      } catch (_) { /* 跨網域視窗，不處理 */ }
    }

    function afterReceipt(win, isDone, info) {
      const T = topWin();
      const now = Date.now();
      if (now - (T.__dusConfirmLast || 0) < DEDUPE_MS) return;
      T.__dusConfirmLast = now;
      const start = Date.now();
      (function wait() {
        let gone = false;
        try { gone = win.closed; } catch (_) { gone = true; }
        if (isDone() || gone || Date.now() - start > WAIT_MAX_MS) {
          setTimeout(() => printForm('auto', info), 500);
          return;
        }
        setTimeout(wait, 300);
      })();
    }

    // 1) 主頁面自己的 print()
    wrapPrint(W, W === topWin() ? 'page' : 'frame-page');

    // 2) iframe：攔 contentWindow 的取用，拿到的視窗一律先包好 print()
    if (IFRAME_CW && IFRAME_CW.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        configurable: true,
        enumerable: IFRAME_CW.enumerable,
        get() {
          const w = IFRAME_CW.get.call(this);
          if (w && !this.hasAttribute(OUR_ATTR)) wrapPrint(w, 'iframe');
          return w;
        },
      });
    }
    // 透過 window.frames[] 或 contentDocument.defaultView 取用的情況：iframe 一出現、每次載入都補包一次
    function watchFrame(f) {
      if (f.hasAttribute(OUR_ATTR) || f.__dusWatched) return;
      f.__dusWatched = true;
      const wrap = () => { try { wrapPrint(IFRAME_CW.get.call(f), 'iframe'); } catch (_) { /* ignore */ } };
      wrap();
      f.addEventListener('load', wrap);
    }
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME') watchFrame(n);
          else if (n.querySelectorAll) n.querySelectorAll('iframe').forEach(watchFrame);
        }
      }
    }).observe(document, { childList: true, subtree: true });

    // 3) window.open 開出的列印視窗
    const origOpen = W.open;
    W.open = function () {
      const w = origOpen.apply(W, arguments);
      if (w) wrapPrint(w, 'popup');
      return w;
    };

    // ---------- 列印醫療確認單 ----------
    function printForm(reason, info) {
      const T = topWin();
      const d = T.document;
      if (!d.body) return;
      if (info) {
        T.__dusConfirmLastInfo = { info, at: Date.now() };
      } else if (reason === 'manual') {
        const last = T.__dusConfirmLastInfo;
        if (last && Date.now() - last.at < MANUAL_REUSE_MS) info = last.info;
      }
      const f = d.createElement('iframe');
      f.setAttribute(OUR_ATTR, reason);
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:148mm;border:0;';
      let started = false;
      f.addEventListener('load', async () => {
        if (started) return;
        started = true;
        const fw = IFRAME_CW.get.call(f);
        try { await fw.document.fonts.ready; } catch (_) { /* ignore */ }
        const cleanup = () => setTimeout(() => f.remove(), 1000);
        fw.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(() => f.remove(), 10 * 60 * 1000);
        console.log(TAG, '列印醫療確認單', reason);
        fw.focus();
        fw.print();
      });
      f.srcdoc = buildHtml(settings(), info);
      d.body.appendChild(f);
    }

    if (W === topWin()) {
      document.addEventListener(EVT, () => printForm('manual'));
      W.__dusConfirmForm = {
        print: () => printForm('manual'),
        html: (info) => buildHtml(settings(), info),
        extract: (doc) => extractInfo(doc || document),
      };
    }

    // ---------- 從收據讀出姓名、就醫日期、院所名稱/代號 ----------
    // 把文件轉成「行 × 格」：區塊元素換行、表格儲存格以 \t 分隔。不依賴畫面是否有渲染。
    const BLOCK_TAGS = new Set(['DIV', 'P', 'TR', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'CAPTION',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'BR', 'HR', 'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'LEGEND']);
    const CELL_TAGS = new Set(['TD', 'TH']);
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

    function docLines(doc) {
      let out = '';
      (function walk(n) {
        if (n.nodeType === 3) { out += n.nodeValue; return; }
        if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
        const tag = n.tagName;
        if (tag && SKIP_TAGS.has(tag)) return;
        if (tag && (tag === 'INPUT' || tag === 'TEXTAREA')) { out += n.value || ''; return; }
        if (tag && BLOCK_TAGS.has(tag)) out += '\n';
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
        if (tag && CELL_TAGS.has(tag)) out += '\t';
        if (tag && BLOCK_TAGS.has(tag)) out += '\n';
      })(doc.body || doc);
      return out.replace(/\u00a0|\u3000/g, ' ').split('\n')
        .map((l) => l.split('\t').map((c) => c.replace(/[ \r\f\v]+/g, ' ').trim()))
        .map((cells) => { while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop(); return cells; })
        .filter((cells) => cells.some((c) => c));
    }

    // 標籤 → 值：同一格標籤後面的文字 → 右邊第一個非空格 → 下一行同一欄
    // 標籤正規式不可含捕捉群組。check(value) 回傳整理好的值或 null。
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
      let t = v.split(/\s+/)[0] || '';
      const k = t.search(OTHER_LABELS);
      if (k === 0) return null;
      if (k > 0) t = t.slice(0, k);
      t = t.replace(/[:：,，;；、()（）]+$/, '');
      if (t.length < 2 || t.length > 12) return null;
      if (!/^[\u4e00-\u9fffA-Za-z○〇Ｏ＊*·．.\-]+$/.test(t)) return null;
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
    const CLINIC_RE = /(?![本貴該])[\u4e00-\u9fff]{2,20}?(?:牙醫診所|牙科診所|牙醫醫院|醫院|診所)/;
    function checkClinicName(v) {
      const m = v.match(CLINIC_RE);
      return m ? m[0] : null;
    }
    function checkCode(v) {
      const m = v.match(/(?:^|\D)(\d{10})(?:\D|$)/);
      return m ? m[1] : null;
    }

    function extractInfo(doc) {
      const lines = docLines(doc);
      const name = findLabeled(lines, /(?:病患|病人|患者|就醫者|保險對象)?姓\s*名/, checkName, /(醫師|醫生|負責人|經手人|收費員|操作員)\s*$/);
      const date = findLabeled(lines, /(?:就醫|就診|看診|門診|診療|治療)日期/, checkDate)
        || findLabeled(lines, /(?:收費|交易|收據|列印)?日期/, checkDate, /(出生|生)\s*$/);
      const clinicCode = findLabeled(lines, /(?:醫事機構|醫療院所|院所|機構|醫事|診所)(?:代號|代碼|編號)/, checkCode);
      let clinicName = findLabeled(lines, /(?:醫事機構|醫療院所|院所|機構|診所)名稱/, checkClinicName);
      if (!clinicName) {
        // 沒有標籤時，取最前面出現的「○○診所／醫院」（通常是收據抬頭）
        for (const cells of lines) {
          for (const c of cells) {
            if (/名稱/.test(c)) continue;
            // 以空白、標點切開，只認「從一段開頭起算」的名稱，避免把前面的句子一起抓進來
            for (const seg of c.split(/[\s,，、:：;；|｜()（）\[\]【】「」]+/)) {
              const m = seg.match(CLINIC_RE);
              if (m && m.index === 0) { clinicName = m[0]; break; }
            }
            if (clinicName) break;
          }
          if (clinicName) break;
        }
      }
      // 代號沒有標籤時，找和院所名稱同一行的 10 碼數字，例如「○○牙醫診所（3501234567）」
      let code = clinicCode;
      if (!code && clinicName) {
        const line = lines.find((cells) => cells.some((c) => c.replace(/\s+/g, '').includes(clinicName)));
        if (line) code = checkCode(line.join(' ')) || '';
      }
      return { name, date, clinicName, clinicCode: code };
    }

    // ---------- 確認單版面（依原 A4 表格等比縮成 A5） ----------
    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function buildHtml(s, info) {
      info = info || {};
      const portrait = s.orientation === 'portrait';
      const copies = Math.min(4, Math.max(1, parseInt(s.copies, 10) || 1));
      // 院所名稱/代號：收據上名稱與代號都有就用收據的；缺一樣時，有手動設定就用設定；都沒有就印找到的那部分
      const found = [info.clinicName, info.clinicCode].filter(Boolean);
      const manual = (s.clinic || '').trim();
      const clinic = found.length === 2 || !manual ? found.map(esc).join('<br>') : esc(manual);
      const name = esc(info.name || '');
      const date = esc(info.date || '');
      const items = ['銀粉/複合體充填', '樹脂/玻璃離子體充填', '牙周治療或洗牙', '根管治療', '拔牙'];
      const rows = items.map((n) =>
        `<span>${n}</span><i></i><span>顆部位</span><i></i><span>起迄看診時間</span><i></i>`).join('') +
        '<span>其他</span><i class="span3"></i><span>起迄看診時間</span><i></i>' +
        '<span class="hint">(請詳列治療項目及部位)</span>';
      const sheet = `
<section class="sheet">
  <div class="title">全民健保牙醫門診醫療服務北區<br>「醫療確認單」</div>
  <div class="frame">
    <table class="left">
      <colgroup><col style="width:9mm"><col><col style="width:19mm"><col style="width:38mm"></colgroup>
      <tr class="hd"><td colspan="4">牙醫門診醫療確認單</td></tr>
      <tr class="nm"><td class="lab">姓名</td><td class="val">${name}</td><td class="lab b u">就醫日期</td><td class="val">${date}</td></tr>
      <tr class="tx">
        <td class="vert">處<br>置<br>內<br>容<br>明<br>細</td>
        <td colspan="3"><div class="grid">${rows}</div></td>
      </tr>
      <tr class="ct"><td colspan="4">如有疑義，請洽<br>健保署北區業務組電話：（03）4339-111<br><b class="u">牙醫北區審查分會電話：(03)4383-630</b></td></tr>
    </table>
    <div class="right">
      <div class="sig">本人確認醫師已清楚解釋治療原因、診斷結果及處置內容部份，並已在口腔內指明治療部位及內容。<br>特此確認簽名：</div>
      <div class="lbl">院所名稱/代號</div>
      <div class="box">${clinic}</div>
      <div class="lbl">診治醫師簽章</div>
      <div class="box doc"></div>
    </div>
  </div>
</section>`;
      return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>醫療確認單</title><style>
@page { size: A5 ${portrait ? 'portrait' : 'landscape'}; margin: ${portrait ? '8mm 7mm' : '7mm 9mm'}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: "PMingLiU", "新細明體", "MingLiU", "細明體", "Noto Serif CJK TC", "Noto Serif TC", "Songti TC", serif;
  font-size: 9.5pt; line-height: 1.3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 192mm; break-inside: avoid; ${portrait ? 'zoom: 0.698;' : ''} }
.sheet + .sheet { break-before: page; }
.title { text-align: center; font-weight: bold; font-size: 14pt; line-height: 1.45; margin: 1mm 0 4mm; letter-spacing: .05em; }
.frame { display: grid; grid-template-columns: 1fr 50mm; border: .8pt solid #000; }
.left { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
.left td { border: .6pt solid #000; padding: 1mm 1.5mm; vertical-align: middle; }
.left tr:first-child td { border-top: 0; }
.left tr:last-child td { border-bottom: 0; }
.left td:first-child { border-left: 0; }
.left td:last-child { border-right: 0; }
.hd td { text-align: center; font-weight: bold; height: 9mm; letter-spacing: .1em; }
.nm td { height: 11mm; }
.lab { text-align: center; font-size: 10pt; white-space: nowrap; }
.val { font-size: 11.5pt; padding-left: 2.5mm !important; white-space: nowrap; overflow: hidden; }
.b { font-weight: bold; }
.u { text-decoration: underline; }
.vert { text-align: center; font-size: 10pt; line-height: 1.5; padding: 1mm 0 !important; }
.grid { display: grid; grid-template-columns: max-content 11mm max-content 21mm max-content 1fr; column-gap: 1mm; }
.grid > * { height: 10mm; display: flex; align-items: flex-end; padding-bottom: .9mm; white-space: nowrap; }
.grid > i { padding: 0; border-bottom: .6pt solid #000; }
.grid > .span3 { grid-column: span 3; }
.grid > .hint { grid-column: 1 / -1; text-decoration: underline; height: 6.4mm; }
.ct td { line-height: 1.85; padding: 1.2mm 1.5mm; }
.right { border-left: .8pt solid #000; display: flex; flex-direction: column; }
.sig { flex: 5 1 0; padding: 1.2mm 1.5mm; font-weight: bold; font-size: 8.6pt; line-height: 1.45; text-align: justify; }
.lbl { flex: none; height: 7mm; border-top: .8pt solid #000; border-bottom: .8pt solid #000; display: flex; align-items: center; justify-content: center;
  font-size: 10.5pt; font-family: "Microsoft JhengHei", "微軟正黑體", "Noto Sans CJK TC", "PingFang TC", sans-serif; }
.box { flex: 3 1 0; padding: 1.5mm; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 10pt; }
.box.doc { flex: 3.4 1 0; }
</style></head><body>${Array(copies).fill(sheet).join('')}</body></html>`;
    }
  }

  // 把 pageCode 以 <script> 標籤注入頁面主世界
  try {
    const s = document.createElement('script');
    s.textContent = '(' + pageCode.toString() + ')(' +
      [KEY, LOG_KEY, EVT, DEFAULTS].map((v) => JSON.stringify(v)).join(',') + ');';
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
    add(`院所名稱/代號（收據上找不到時使用）：${s.clinic || '未設定'}`, () => {
      const v = prompt('收據上找不到院所名稱/代號時，改印這段文字（例如：泓泰牙醫診所 3501234567）。留空 = 找不到就空白', s.clinic);
      if (v === null) return;
      s.clinic = v.trim(); save(s); menu();
    });
    add(`每次張數：${s.copies}（一式二聯可設 2）`, () => {
      const v = prompt('每次列印幾張確認單（1～4）', String(s.copies));
      if (v === null) return;
      const n = parseInt(v, 10);
      if (!(n >= 1 && n <= 4)) { alert('請輸入 1～4'); return; }
      s.copies = n; save(s); menu();
    });
    add(`紙張：A5 ${s.orientation === 'portrait' ? '直式' : '橫式'}（點一下切換）`, () => {
      s.orientation = s.orientation === 'portrait' ? 'landscape' : 'portrait'; save(s); menu();
    });
    add('最近的列印偵測紀錄', () => {
      let list = [];
      try { list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (_) { /* ignore */ }
      if (!list.length) { alert('這台電腦還沒有偵測到任何列印。\n請先在 Dentall 列印一次收據再來看。'); return; }
      alert('最近的列印（新 → 舊）\n\n' + list.map((e) =>
        `${e.t}  來源：${e.source}  ${e.receipt ? '✅ 判定為健保收據' : '— 不是健保收據'}${e.receipt && !e.auto ? '（自動附印已關）' : ''}\n    出現字樣：${(e.words || []).join('、') || '（無）'}` +
        (e.found ? `\n    自動帶入：姓名${e.found.name ? '✓' : '✗'} 就醫日期${e.found.date ? '✓' : '✗'} 院所名稱${e.found.clinic ? '✓' : '✗'} 院所代號${e.found.code ? '✓' : '✗'}` : '')
      ).join('\n'));
    });
  }
  menu();
})();
