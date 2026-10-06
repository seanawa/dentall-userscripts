# dentall-userscripts

給 [his.dentall.io](https://his.dentall.io)（Dentall HIS）用的 Tampermonkey 使用者腳本集合。每支腳本一個 `.user.js` 檔，各自獨立安裝、獨立自動更新。

| 腳本 | 說明 | 安裝 |
|---|---|---|
| `dentall-treatment-report-viewer.user.js` | 「分析報表 → 治療項目統計」直接在網頁上顯示，不必下載 Excel | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-treatment-report-viewer.user.js) |

---

## Dentall 治療項目統計 線上瀏覽

讓 [his.dentall.io](https://his.dentall.io) 的「分析報表 → 治療項目統計」直接在網頁上顯示，不必下載 Excel。

### 診所電腦安裝清單

逐步打勾的安裝清單（含所有連結）：**https://seanawa.github.io/dentall-userscripts/**

### 一鍵安裝

1. Chrome 安裝 [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) 擴充功能。
2. **開啟「允許使用者指令碼」**（新版 Chrome 必做，否則腳本不會執行）：
   - 網址列輸入 `chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo` 按 Enter
   - 找到「允許使用者指令碼」(Allow User Scripts) 那一列，把開關打開
   - 舊版 Chrome 沒有這個選項的話，改在 `chrome://extensions` 右上角開啟「開發人員模式」
3. 點這個連結：**[安裝腳本](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-treatment-report-viewer.user.js)**，在跳出的 Tampermonkey 畫面按「安裝」。
4. **完全關閉 Chrome 再重新打開**（Windows 請確認工作列隱藏圖示裡沒有殘留的 Chrome；Mac 按 Cmd+Q）。
5. 登入 Dentall，重新整理頁面。

> 檢查是否成功：在 Dentall 頁面點 Tampermonkey 圖示，應看到「Dentall 治療項目統計 線上瀏覽」開關為綠色，且圖示上有數字 1。
> 若圖示彈窗上方出現藍色橫幅「請啟用『允許使用者腳本』」，代表第 2 步還沒做。

之後腳本有更新，Tampermonkey 會自動抓取，不需要重裝。

### 使用方式

分析報表 → 治療項目統計 → 選日期 / 醫師 → 按 **「生成報表（直接瀏覽）」**。

處置項目會自動選好「全部代碼」（對話框打開時、以及每次匯出後都會自動補上）。要查特定代碼時，直接清掉改選即可。

這顆按鈕是腳本加上去的，在「匯出 EXCEL」正上方。它會自動按下匯出、等右側狀態從「製作中」變成「下載報表」，再直接開啟報表，不用自己盯著等。
右側歷史清單裡既有的「下載報表」也一樣會改成在頁面內開啟。

報表視窗提供兩個分頁：

| 分頁 | 內容 |
|---|---|
| 明細（預設） | 原始每一列，照 Excel 原始順序；可搜尋任意欄位、指定欄位篩選、點欄位標題排序 |
| 統計（醫師 × 項目） | 每位醫師各處置代碼的次數與合計，依合計由多到少排，底部有總計列 |

右上角保留「下載 Excel」按鈕，需要檔案時照舊可下載。按 Esc、點「關閉」或點視窗外即可關閉。

### 原理

按「匯出 EXCEL」後，Dentall 伺服器會產生 xlsx 放到 Google Cloud Storage，網頁再用 `window.open(檔案網址)` 觸發下載。
本腳本攔截該動作，改成在頁面內抓取 xlsx、以 [SheetJS](https://sheetjs.com/) 解析後直接顯示。

- 只攔截 `storage.googleapis.com` 上的 `.xlsx`，其他下載行為不受影響。
- 腳本內沒有任何帳號、密碼或病患資料。
- 若 Dentall 之後改成不透過 `window.open` 下載，腳本需要調整。
