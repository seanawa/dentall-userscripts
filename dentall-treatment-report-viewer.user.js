// ==UserScript==
// @name         Dentall 治療項目統計 線上瀏覽
// @namespace    htdayreportviewer
// （@namespace 請勿更改：Tampermonkey 以 name+namespace 辨識腳本，改了會被當成另一支新腳本）
// @version      1.5.1
// @description  在 his.dentall.io 的「治療項目統計」按下「下載報表」時，直接在網頁上顯示統計與明細，不必開 Excel；「列印預約表」的「匯出Excel」左邊多一顆「檢視」，預約表直接在視窗裡看。
// @match        https://his.dentall.io/*
// @homepageURL  https://github.com/seanawa/dentall-userscripts
// @supportURL   https://github.com/seanawa/dentall-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-treatment-report-viewer.user.js
// @downloadURL  https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-treatment-report-viewer.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
 * 這支腳本不管 Tampermonkey 把它放在哪個執行環境（主世界或隔離世界），
 * 都會把真正的程式碼以 <script> 標籤注入頁面本身，確保能攔截頁面呼叫的 window.open。
 * SheetJS 也改成在第一次需要時才從 cdnjs 載入到頁面裡。
 */
(function loader() {
  'use strict';
  const TAG = '[dentall-userscripts]';

  function pageCode() {
    const TAG = '[dentall-userscripts]';
    const W = window;
    if (W.__dentallReportViewerInstalled) { console.log(TAG, '已安裝過，略過'); return; }
    W.__dentallReportViewerInstalled = true;

    // ---------- 攔截 window.open：只處理 GCS 上的 xlsx 報表 ----------
    const originalOpen = W.open.bind(W);
    W.open = function (url, ...rest) {
      try {
        const u = String(url || '');
        if (/storage\.googleapis\.com/.test(u) && /\.xlsx(\?|$)/i.test(u)) {
          console.log(TAG, '攔截到報表下載，改為頁面內顯示');
          const fileName = decodeURIComponent(u.split('/').pop().split('?')[0]);
          showReport({
            title: fileName,
            load: () => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }),
            download: () => originalOpen(u, '_blank'),
          });
          return null;
        }
      } catch (e) { console.warn(TAG, e); }
      return originalOpen(url, ...rest);
    };
    console.log(TAG, 'v1.5.1 已啟動，window.open 已接管');

    // ---------- 攔截前端產生的 xlsx 下載（列印預約表「匯出Excel」） ----------
    // Dentall 在瀏覽器裡產生 xlsx Blob → URL.createObjectURL → 對一個不在畫面上的 <a download> 送 click。
    // 只在按了腳本的「檢視」後短時間內攔截，平常按「匯出Excel」照舊下載。
    let captureUntil = 0;
    const captured = new Map(); // blob URL → Blob
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const url = originalCreateObjectURL.apply(this, arguments);
      if (Date.now() < captureUntil && obj instanceof Blob) {
        captured.set(url, obj);
        // 萬一不是透過 <a> 下載，2 秒後仍直接開啟
        setTimeout(() => { if (captured.has(url)) openCaptured(url, ''); }, 2000);
      }
      return url;
    };
    function swallowAnchor(a) {
      if (!(a instanceof HTMLAnchorElement) || !captured.has(a.href)) return false;
      openCaptured(a.href, a.download || '');
      return true;
    }
    function openCaptured(url, name) {
      const blob = captured.get(url);
      if (!blob) return;
      captured.delete(url);
      captureUntil = 0;
      const fileName = name || '預約表.xlsx';
      console.log(TAG, '攔截到預約表匯出，改為頁面內顯示');
      showReport({
        title: fileName.replace(/\.xlsx$/i, ''),
        load: () => blob.arrayBuffer(),
        download: () => {
          const a = document.createElement('a');
          a.href = originalCreateObjectURL.call(URL, blob);
          a.download = fileName;
          originalAnchorClick.call(a);
          setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        },
        sheetTabs: true,
        printable: true,
      });
    }
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (swallowAnchor(this)) return;
      return originalAnchorClick.apply(this, arguments);
    };
    const originalDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (ev) {
      if (ev && ev.type === 'click' && swallowAnchor(this)) return true;
      return originalDispatch.apply(this, arguments);
    };

    // ---------- SheetJS 延遲載入 ----------
    let xlsxPromise = null;
    function loadXLSX() {
      if (W.XLSX) return Promise.resolve(W.XLSX);
      if (xlsxPromise) return xlsxPromise;
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => (W.XLSX ? resolve(W.XLSX) : reject(new Error('SheetJS 載入後找不到 XLSX')));
        s.onerror = () => reject(new Error('無法載入 SheetJS（cdnjs）'));
        (document.head || document.documentElement).appendChild(s);
      });
      return xlsxPromise;
    }

    // ---------- 樣式 ----------
    const CSS = `
    .drv-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;}
    .drv-box{background:#fff;width:min(1200px,96vw);height:min(860px,92vh);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;color:#222;}
    .drv-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #eee;}
    .drv-head h3{margin:0;font-size:16px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .drv-btn{border:1px solid #d9d9d9;background:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:13px;}
    .drv-btn:hover{border-color:#1677ff;color:#1677ff;}
    .drv-tabs{display:flex;gap:4px;padding:8px 16px 0;border-bottom:1px solid #eee;}
    .drv-tab{padding:8px 14px;cursor:pointer;border-bottom:2px solid transparent;font-size:14px;}
    .drv-tab.active{border-bottom-color:#1677ff;color:#1677ff;font-weight:600;}
    .drv-tools{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #f0f0f0;flex-wrap:wrap;}
    .drv-tools input,.drv-tools select{border:1px solid #d9d9d9;border-radius:6px;padding:5px 10px;font-size:13px;}
    .drv-tools .drv-count{margin-left:auto;color:#666;font-size:13px;}
    .drv-body{flex:1;overflow:auto;padding:0 16px 16px;}
    .drv-table{border-collapse:separate;border-spacing:0;width:100%;font-size:13px;}
    .drv-table th{position:sticky;top:0;background:#fafafa;border-bottom:1px solid #e5e5e5;padding:8px 10px;text-align:left;white-space:nowrap;z-index:1;cursor:pointer;user-select:none;}
    .drv-table th.num,.drv-table td.num{text-align:right;font-variant-numeric:tabular-nums;}
    .drv-table td{border-bottom:1px solid #f0f0f0;padding:6px 10px;white-space:nowrap;}
    .drv-table tr:hover td{background:#f5f9ff;}
    .drv-table tr.total td{font-weight:600;background:#fffbe6;position:sticky;bottom:0;}
    .drv-table td.first,.drv-table th.first{position:sticky;left:0;background:#fff;z-index:2;}
    .drv-table th.first{background:#fafafa;z-index:3;}
    .drv-table tr.total td.first{background:#fffbe6;}
    .drv-loading{padding:40px;text-align:center;color:#666;}
    .drv-err{padding:20px;color:#c00;white-space:pre-wrap;}
    .drv-gen{margin:0 0 10px;}
    .drv-gen button{width:100%;height:40px;border-radius:32px;border:1px solid #3266ff;background:#fff;color:#3266ff;font-size:14px;font-weight:600;cursor:pointer;}
    .drv-gen button:hover{background:#f0f6ff;}
    .drv-gen button:disabled{opacity:.6;cursor:default;}
    .drv-gen .drv-gen-status{margin:6px 0 0;font-size:13px;color:#666;text-align:center;min-height:18px;}
    .drv-gen .drv-gen-status.err{color:#c00;}
    `;

    function injectCss() {
      if (document.getElementById('drv-style')) return;
      const s = document.createElement('style');
      s.id = 'drv-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    // ---------- 主流程 ----------
    // src: { title, load: () => Promise<ArrayBuffer>, download: () => void, sheetTabs?: 每個工作表一個分頁（預約表）, printable?: 顯示列印按鈕 }
    async function showReport(src) {
      injectCss();
      const mask = el('div', 'drv-mask');
      const box = el('div', 'drv-box');
      mask.appendChild(box);
      const head = el('div', 'drv-head');
      const title = el('h3'); title.textContent = src.title;
      const dlBtn = el('button', 'drv-btn'); dlBtn.textContent = '下載 Excel';
      dlBtn.onclick = src.download;
      const closeBtn = el('button', 'drv-btn'); closeBtn.textContent = '關閉';
      closeBtn.onclick = close;
      // 給列印用：current = 目前分頁畫面上的內容 { name, header, rows }；all = 每個工作表
      const shown = { current: null, all: [] };
      if (src.printable) {
        const allBtn = el('button', 'drv-btn'); allBtn.textContent = '全部列印';
        allBtn.title = '每位醫師一份、各自換頁（不印全院所、電話、主治醫師）';
        allBtn.onclick = () => {
          const list = shown.all.filter((x) => !/全院所/.test(x.name) && x.rows.length);
          if (list.length) printTables(src.title, list);
        };
        const oneBtn = el('button', 'drv-btn'); oneBtn.textContent = '單獨列印';
        oneBtn.title = '列印目前分頁（照目前的搜尋與排序；不印電話，全院所另不印需時、性別，各醫師另不印主治醫師）';
        oneBtn.onclick = () => { if (shown.current) printTables(src.title, [shown.current]); };
        head.append(title, allBtn, oneBtn, dlBtn, closeBtn);
      } else {
        head.append(title, dlBtn, closeBtn);
      }
      box.appendChild(head);
      const content = el('div'); content.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
      content.innerHTML = '<div class="drv-loading">報表讀取中…</div>';
      box.appendChild(content);
      document.body.appendChild(mask);

      function close() { mask.remove(); document.removeEventListener('keydown', onKey); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', onKey);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });

      try {
        const [XL, buf] = await Promise.all([loadXLSX(), src.load()]);
        const wb = XL.read(buf, { type: 'array' });
        const sheets = wb.SheetNames.map((n) => ({
          name: n,
          rows: XL.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }),
        }));
        renderWorkbook(content, sheets, !!src.sheetTabs, shown);
      } catch (e) {
        console.error(TAG, e);
        content.innerHTML = '<div class="drv-err">讀取報表失敗：' + escapeHtml(e.message) + '</div>';
      }
    }

    // ---------- 渲染 ----------
    const nonEmpty = (rows) => rows.filter((r) => r.some((c) => String(c).trim() !== ''));

    function renderWorkbook(root, sheets, sheetTabs, shown) {
      root.innerHTML = '';
      const views = [];
      if (sheetTabs) {
        // 列印預約表：全院所＋各醫師，每個工作表一個分頁
        for (const s of sheets) {
          const header = (s.rows[0] || []).map((h) => (String(h).trim() === '治療長度' ? '需時' : h));
          const data = apptRows(header, nonEmpty(s.rows.slice(1)));
          shown.all.push({ name: s.name, header, rows: data });
          views.push({
            name: s.name + '（' + data.length + '）',
            render: (c) => renderDetail(c, header, data, {
              noIndex: true,
              onDraw: (rows) => { shown.current = { name: s.name, header, rows }; },
            }),
          });
        }
        mountViews(root, views);
        return;
      }
      const sheet = sheets[0];
      const header = sheet.rows[0] || [];
      const data = nonEmpty(sheet.rows.slice(1));

      // 分頁順序：明細（預設）→ 統計（醫師 × 項目）
      views.push({ name: '明細（' + data.length + ' 筆）', render: (c) => renderDetail(c, header, data) });
      const itemIdx = header.findIndex((h) => /處置項目|項目/.test(String(h)));
      const docIdx = header.findIndex((h) => /醫師/.test(String(h)));
      if (itemIdx >= 0 && docIdx >= 0) {
        views.push({ name: '統計（醫師 × 項目）', render: (c) => renderPivot(c, data, docIdx, itemIdx) });
      }
      for (let i = 1; i < sheets.length; i++) {
        const s = sheets[i];
        views.push({ name: s.name, render: (c) => renderDetail(c, s.rows[0] || [], s.rows.slice(1)) });
      }
      mountViews(root, views);
    }

    // 預約表：拿掉「★保留」的時段，時間去掉年份（2026/10/12 09:30 → 10/12 09:30）
    function apptRows(header, data) {
      const nameIdx = header.findIndex((h) => /病患名稱|姓名/.test(String(h)));
      const timeIdx = header.findIndex((h) => String(h).trim() === '時間');
      return data
        .filter((r) => nameIdx < 0 || String(r[nameIdx] ?? '').trim() !== '★保留')
        .map((r) => {
          if (timeIdx < 0) return r;
          const out = r.slice();
          out[timeIdx] = String(r[timeIdx] ?? '').trim().replace(/^\d{4}[\/-]/, '');
          return out;
        });
    }

    // 用隱藏 iframe 列印；sections = [{ name, header, rows }]，每段各自換頁。
    // 不印的欄：各醫師 → 電話、主治醫師；全院所 → 電話、需時、性別（保留主治醫師）
    function printTables(title, sections) {
      const body = sections.map((sec) => {
        const skip = /全院所/.test(sec.name) ? /電話|手機|需時|性別/ : /電話|手機|主治醫師/;
        const cols = sec.header.map((h, i) => i).filter((i) => !skip.test(String(sec.header[i])));
        const wrapCol = sec.header.findIndex((x) => /備註/.test(String(x))); // 只有備註可換行，其他欄不折行
        let h = '<section><h1>' + escapeHtml(title + '　' + sec.name + '（' + sec.rows.length + ' 筆）') + '</h1>';
        h += '<table><thead><tr>' + cols.map((i) => `<th>${escapeHtml(String(sec.header[i]))}</th>`).join('') + '</tr></thead><tbody>';
        for (const r of sec.rows) h += '<tr>' + cols.map((i) => `<td${i === wrapCol ? ' class="wrap"' : ''}>${escapeHtml(String(r[i] ?? '').trim())}</td>`).join('') + '</tr>';
        return h + '</tbody></table></section>';
      }).join('');
      const docTitle = escapeHtml(sections.length === 1 ? title + '　' + sections[0].name : title);
      const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>
        @page{size:A4 portrait;margin:10mm;}
        body{font-family:"PingFang TC","Microsoft JhengHei",sans-serif;font-size:11px;color:#000;margin:0;}
        h1{font-size:14px;margin:0 0 6px;}
        table{border-collapse:collapse;width:100%;}
        th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top;white-space:nowrap;}
        td.wrap{white-space:normal;width:100%;}
        th{background:#eee;white-space:nowrap;}
        thead{display:table-header-group;}
        tr{page-break-inside:avoid;}
        section+section{page-break-before:always;}
        </style></head><body>${body}</body></html>`;
      const frame = el('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(frame);
      const fd = frame.contentDocument;
      fd.open(); fd.write(doc); fd.close();
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 1000);
      }, 100);
    }

    function mountViews(root, views) {
      const tabs = el('div', 'drv-tabs');
      const body = el('div'); body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
      views.forEach((v, i) => {
        const t = el('div', 'drv-tab' + (i === 0 ? ' active' : ''));
        t.textContent = v.name;
        t.onclick = () => {
          tabs.querySelectorAll('.drv-tab').forEach((x) => x.classList.remove('active'));
          t.classList.add('active');
          body.innerHTML = '';
          v.render(body);
        };
        tabs.appendChild(t);
      });
      root.append(tabs, body);
      views[0].render(body);
    }

    function renderPivot(root, data, rowIdx, colIdx) {
      const rowKeys = new Map();
      const colSet = new Set();
      for (const r of data) {
        const rk = String(r[rowIdx] ?? '').trim() || '(空白)';
        const ck = String(r[colIdx] ?? '').trim() || '(空白)';
        colSet.add(ck);
        if (!rowKeys.has(rk)) rowKeys.set(rk, new Map());
        const m = rowKeys.get(rk);
        m.set(ck, (m.get(ck) || 0) + 1);
      }
      const cols = [...colSet].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      const rows = [...rowKeys.entries()]
        .map(([k, m]) => ({ key: k, counts: cols.map((c) => m.get(c) || 0), total: [...m.values()].reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
      const colTotals = cols.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0));
      const grand = colTotals.reduce((a, b) => a + b, 0);

      const tools = el('div', 'drv-tools');
      const search = el('input'); search.placeholder = '篩選…';
      const count = el('span', 'drv-count'); count.textContent = `${rows.length} 個項目，共 ${grand} 筆`;
      tools.append(search, count);
      const wrap = el('div', 'drv-body');
      root.append(tools, wrap);

      function draw(filter) {
        const f = filter.trim().toLowerCase();
        const shown = f ? rows.filter((r) => r.key.toLowerCase().includes(f)) : rows;
        let h = '<table class="drv-table"><thead><tr><th class="first">項目</th>';
        for (const c of cols) h += `<th class="num">${escapeHtml(c)}</th>`;
        h += '<th class="num">合計</th></tr></thead><tbody>';
        for (const r of shown) {
          h += `<tr><td class="first">${escapeHtml(r.key)}</td>`;
          for (const n of r.counts) h += `<td class="num">${n || ''}</td>`;
          h += `<td class="num"><b>${r.total}</b></td></tr>`;
        }
        h += '<tr class="total"><td class="first">合計</td>';
        for (const n of colTotals) h += `<td class="num">${n}</td>`;
        h += `<td class="num">${grand}</td></tr></tbody></table>`;
        wrap.innerHTML = h;
      }
      search.oninput = () => draw(search.value);
      draw('');
    }

    // opts: { noIndex?: 不顯示 # 欄, onDraw?: (目前顯示的列) => void }
    function renderDetail(root, header, data, opts = {}) {
      const tools = el('div', 'drv-tools');
      const search = el('input'); search.placeholder = '搜尋任意欄位…'; search.style.minWidth = '240px';
      const colSel = el('select');
      colSel.innerHTML = '<option value="-1">所有欄位</option>' + header.map((h, i) => `<option value="${i}">${escapeHtml(String(h))}</option>`).join('');
      const count = el('span', 'drv-count');
      tools.append(search, colSel, count);
      const wrap = el('div', 'drv-body');
      root.append(tools, wrap);

      let sortCol = -1, sortDir = 1;
      function draw() {
        const f = search.value.trim().toLowerCase();
        const ci = Number(colSel.value);
        let rows = data.filter((r) => {
          if (!f) return true;
          if (ci >= 0) return String(r[ci] ?? '').toLowerCase().includes(f);
          return r.some((c) => String(c ?? '').toLowerCase().includes(f));
        });
        if (sortCol >= 0) {
          rows = rows.slice().sort((a, b) => {
            const x = String(a[sortCol] ?? ''), y = String(b[sortCol] ?? '');
            return sortDir * x.localeCompare(y, 'zh-Hant', { numeric: true });
          });
        }
        count.textContent = `${rows.length} / ${data.length} 筆`;
        if (opts.onDraw) opts.onDraw(rows);
        let h = '<table class="drv-table"><thead><tr>' + (opts.noIndex ? '' : '<th class="num">#</th>');
        header.forEach((c, i) => {
          const arrow = i === sortCol ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
          h += `<th data-i="${i}">${escapeHtml(String(c))}${arrow}</th>`;
        });
        h += '</tr></thead><tbody>';
        rows.forEach((r, n) => {
          h += '<tr>' + (opts.noIndex ? '' : `<td class="num">${n + 1}</td>`);
          for (let i = 0; i < header.length; i++) h += `<td>${escapeHtml(String(r[i] ?? '').trim())}</td>`;
          h += '</tr>';
        });
        h += '</tbody></table>';
        wrap.innerHTML = h;
        wrap.querySelectorAll('th[data-i]').forEach((th) => {
          th.onclick = () => {
            const i = Number(th.dataset.i);
            if (sortCol === i) sortDir = -sortDir; else { sortCol = i; sortDir = 1; }
            draw();
          };
        });
      }
      search.oninput = draw;
      colSel.onchange = draw;
      draw();
    }

    // ---------- 「生成報表」按鈕：匯出 → 等製作完成 → 自動開啟瀏覽 ----------
    const EXPORT_RE = /匯出\s*EXCEL/i;
    function findDialog() {
      return [...document.querySelectorAll('.ant-modal')].find((m) => {
        const t = m.querySelector('.ant-modal-title');
        return t && /治療項目統計/.test(t.textContent || '');
      }) || null;
    }
    function findExportButton(dlg) {
      return [...dlg.querySelectorAll('button')].find((b) => EXPORT_RE.test(b.textContent || '')) || null;
    }
    // 右側每一張報表卡片：{ time: 匯出時間, ready: 是否可下載, btn: 下載按鈕 }
    function readCards(dlg) {
      const out = [];
      for (const b of dlg.querySelectorAll('button')) {
        const txt = (b.textContent || '').trim();
        if (!/下載報表|製作中/.test(txt)) continue;
        let c = b;
        while (c && c !== dlg && !/匯出時間/.test(c.textContent || '')) c = c.parentElement;
        const m = c && (c.textContent || '').match(/匯出時間\s*([\d\/]+\s+[\d:]+)/);
        out.push({ time: m ? m[1] : '', ready: /下載報表/.test(txt), btn: b });
      }
      return out;
    }

    // ---------- 處置項目自動選取「全部代碼」 ----------
    // 時機：對話框打開時、以及匯出後 App 把欄位清空時。欄位有內容或正在輸入時不動它。
    let autoSelBusy = false, autoSelFails = 0, autoSelDlg = null;
    async function autoSelectAllCodes(dlg) {
      if (dlg !== autoSelDlg) { autoSelDlg = dlg; autoSelFails = 0; }
      if (autoSelBusy || autoSelFails >= 3) return;
      const sel = dlg.querySelector('.ant-select-auto-complete');
      const input = sel && sel.querySelector('input');
      if (!input || input.value.trim() !== '') return;
      if (document.activeElement === input) return;
      if (sel.classList.contains('ant-select-open')) return; // 使用者正在操作這個欄位
      autoSelBusy = true;
      try {
        await sleep(500); // 等對話框開啟動畫結束
        if (!dlg.isConnected || input.value.trim() !== '' || document.activeElement === input) return;
        const selector = sel.querySelector('.ant-select-selector') || sel;
        input.focus();
        selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        let opt = null;
        for (let i = 0; i < 20 && !opt; i++) {
          await sleep(100);
          opt = [...document.querySelectorAll('.ant-select-dropdown .ant-select-item-option')]
            .find((o) => (o.textContent || '').trim() === '全部代碼');
        }
        if (opt) {
          opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await sleep(200);
          console.log(TAG, '處置項目已自動選取「全部代碼」');
        } else {
          autoSelFails++;
        }
        input.blur();
        // 若下拉仍開著，模擬點擊外部把它收起
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } catch (e) {
        autoSelFails++;
        console.warn(TAG, '自動選取失敗', e);
      } finally {
        autoSelBusy = false;
      }
    }

    function injectGenerateButton() {
      const dlg = findDialog();
      if (!dlg) return;
      autoSelectAllCodes(dlg);
      if (dlg.querySelector('.drv-gen')) return;
      const exportBtn = findExportButton(dlg);
      if (!exportBtn || !exportBtn.parentElement) return;
      injectCss();
      const wrap = el('div', 'drv-gen');
      const btn = el('button'); btn.type = 'button'; btn.textContent = '生成報表（直接瀏覽）';
      btn.title = '自動按「匯出 EXCEL」，等報表製作完成後直接在頁面上開啟';
      const status = el('div', 'drv-gen-status');
      wrap.append(btn, status);
      wrap.style.marginTop = 'auto';
      exportBtn.style.marginTop = '10px';
      exportBtn.parentElement.insertBefore(wrap, exportBtn);
      btn.onclick = () => generateAndView(btn, status);
    }

    async function generateAndView(btn, status) {
      const setStatus = (t, isErr) => { status.textContent = t; status.classList.toggle('err', !!isErr); };
      let dlg = findDialog();
      if (!dlg) return;
      const exportBtn = findExportButton(dlg);
      if (!exportBtn) { setStatus('找不到「匯出 EXCEL」按鈕', true); return; }

      const before = readCards(dlg);
      const beforeCount = before.length;
      const beforeTopTime = before[0] ? before[0].time : '';

      btn.disabled = true;
      setStatus('送出匯出請求…');
      exportBtn.click();

      const started = Date.now();
      const TIMEOUT = 120000;
      try {
        while (Date.now() - started < TIMEOUT) {
          await sleep(1000);
          dlg = findDialog();
          if (!dlg) { setStatus(''); return; } // 使用者關掉對話框
          const cards = readCards(dlg);
          const top = cards[0];
          const isNew = cards.length > beforeCount || (top && top.time !== beforeTopTime);
          if (!isNew) {
            if (Date.now() - started > 8000) { setStatus('沒有產生新報表，請確認處置項目等欄位已選好後再按一次', true); return; }
            setStatus('等待報表建立…');
            continue;
          }
          if (!top.ready) { setStatus('報表製作中… ' + Math.round((Date.now() - started) / 1000) + ' 秒'); continue; }
          setStatus('完成，開啟報表');
          top.btn.click(); // 觸發 window.open → 被攔截 → 頁面內顯示
          await sleep(800);
          setStatus('');
          autoSelectAllCodes(dlg); // 匯出後 App 會清空處置項目，補回「全部代碼」
          return;
        }
        setStatus('等太久了，請直接點右側的「下載報表」', true);
      } finally {
        btn.disabled = false;
      }
    }

    // ---------- 列印預約表：「匯出Excel」左邊加「檢視」 ----------
    function injectApptViewButton() {
      const dlg = [...document.querySelectorAll('.ant-modal')].find((m) => {
        const t = m.querySelector('.ant-modal-title');
        return t && /列印預約表/.test(t.textContent || '');
      });
      if (!dlg || dlg.querySelector('.drv-appt-view')) return;
      const exportBtn = [...dlg.querySelectorAll('button')].find((b) => /匯出\s*Excel/i.test(b.textContent || ''));
      const item = exportBtn && exportBtn.parentElement;
      if (!item || !item.parentElement) return;
      // 複製 Dentall 自己的按鈕外觀（不會帶到 React 的事件）
      const wrap = item.classList.contains('ant-space-item') ? item.cloneNode(false) : document.createElement('span');
      const btn = exportBtn.cloneNode(true);
      btn.classList.remove('excel');
      btn.classList.add('drv-appt-view');
      btn.type = 'button';
      const label = btn.querySelector('span') || btn;
      label.textContent = '檢視';
      btn.title = '不下載檔案，直接在視窗裡看預約表';
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        captureUntil = Date.now() + 30000;
        exportBtn.click();
      };
      wrap.appendChild(btn);
      if (!item.classList.contains('ant-space-item')) wrap.style.marginRight = '8px';
      item.parentElement.insertBefore(wrap, item);
    }

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // 對話框是動態出現的，用 MutationObserver 監看並在出現時注入按鈕
    function watchDialog() {
      const obs = new MutationObserver(() => { injectGenerateButton(); injectApptViewButton(); });
      const start = () => { obs.observe(document.body, { childList: true, subtree: true }); injectGenerateButton(); injectApptViewButton(); };
      if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    }
    watchDialog();

    // ---------- 小工具 ----------
    function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
    function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  }

  // 把 pageCode 以 <script> 標籤注入頁面主世界
  try {
    const s = document.createElement('script');
    s.textContent = '(' + pageCode.toString() + ')();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    console.log(TAG, 'loader 完成注入');
  } catch (e) {
    console.error(TAG, '注入失敗', e);
  }
})();
