// ==UserScript==
// @name         Dentall 治療項目統計 線上瀏覽
// @namespace    htdayreportviewer
// @version      1.1.0
// @description  在 his.dentall.io 的「治療項目統計」按下「下載報表」時，直接在網頁上顯示統計與明細，不必開 Excel。
// @match        https://his.dentall.io/*
// @homepageURL  https://github.com/seanawa/htdayreportviewer
// @supportURL   https://github.com/seanawa/htdayreportviewer/issues
// @updateURL    https://raw.githubusercontent.com/seanawa/htdayreportviewer/main/dentall-treatment-report-viewer.user.js
// @downloadURL  https://raw.githubusercontent.com/seanawa/htdayreportviewer/main/dentall-treatment-report-viewer.user.js
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
  const TAG = '[htdayreportviewer]';

  function pageCode() {
    const TAG = '[htdayreportviewer]';
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
          showReport(u);
          return null;
        }
      } catch (e) { console.warn(TAG, e); }
      return originalOpen(url, ...rest);
    };
    console.log(TAG, 'v1.1.0 已啟動，window.open 已接管');

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
    async function showReport(url) {
      injectCss();
      const fileName = decodeURIComponent(url.split('/').pop().split('?')[0]);
      const mask = el('div', 'drv-mask');
      const box = el('div', 'drv-box');
      mask.appendChild(box);
      const head = el('div', 'drv-head');
      const title = el('h3'); title.textContent = fileName;
      const dlBtn = el('button', 'drv-btn'); dlBtn.textContent = '下載 Excel';
      dlBtn.onclick = () => originalOpen(url, '_blank');
      const closeBtn = el('button', 'drv-btn'); closeBtn.textContent = '關閉';
      closeBtn.onclick = close;
      head.append(title, dlBtn, closeBtn);
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
        const [XL, resp] = await Promise.all([loadXLSX(), fetch(url)]);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        const wb = XL.read(buf, { type: 'array' });
        const sheets = wb.SheetNames.map((n) => ({
          name: n,
          rows: XL.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }),
        }));
        renderWorkbook(content, sheets);
      } catch (e) {
        console.error(TAG, e);
        content.innerHTML = '<div class="drv-err">讀取報表失敗：' + escapeHtml(e.message) + '</div>';
      }
    }

    // ---------- 渲染 ----------
    function renderWorkbook(root, sheets) {
      root.innerHTML = '';
      const sheet = sheets[0];
      const header = sheet.rows[0] || [];
      const data = sheet.rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));

      const views = [];
      const itemIdx = header.findIndex((h) => /處置項目|項目/.test(String(h)));
      const docIdx = header.findIndex((h) => /醫師/.test(String(h)));
      if (itemIdx >= 0 && docIdx >= 0) {
        views.push({ name: '統計（項目 × 醫師）', render: (c) => renderPivot(c, data, itemIdx, docIdx) });
        views.push({ name: '統計（醫師 × 項目）', render: (c) => renderPivot(c, data, docIdx, itemIdx) });
      }
      views.push({ name: '明細（' + data.length + ' 筆）', render: (c) => renderDetail(c, header, data) });
      for (let i = 1; i < sheets.length; i++) {
        const s = sheets[i];
        views.push({ name: s.name, render: (c) => renderDetail(c, s.rows[0] || [], s.rows.slice(1)) });
      }

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

    function renderDetail(root, header, data) {
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
        let h = '<table class="drv-table"><thead><tr><th class="num">#</th>';
        header.forEach((c, i) => {
          const arrow = i === sortCol ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
          h += `<th data-i="${i}">${escapeHtml(String(c))}${arrow}</th>`;
        });
        h += '</tr></thead><tbody>';
        rows.forEach((r, n) => {
          h += `<tr><td class="num">${n + 1}</td>`;
          for (let i = 0; i < header.length; i++) h += `<td>${escapeHtml(String(r[i] ?? ''))}</td>`;
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

    function injectGenerateButton() {
      const dlg = findDialog();
      if (!dlg || dlg.querySelector('.drv-gen')) return;
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
          return;
        }
        setStatus('等太久了，請直接點右側的「下載報表」', true);
      } finally {
        btn.disabled = false;
      }
    }

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // 對話框是動態出現的，用 MutationObserver 監看並在出現時注入按鈕
    function watchDialog() {
      const obs = new MutationObserver(() => injectGenerateButton());
      const start = () => { obs.observe(document.body, { childList: true, subtree: true }); injectGenerateButton(); };
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
