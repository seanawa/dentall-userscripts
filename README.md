# dentall-userscripts

給 [his.dentall.io](https://his.dentall.io)（Dentall HIS）用的 Tampermonkey 使用者腳本集合。每支腳本一個 `.user.js` 檔，各自獨立安裝、獨立自動更新。

| 腳本 | 說明 | 安裝 |
|---|---|---|
| `dentall-treatment-report-viewer.user.js` | 「分析報表 → 治療項目統計」直接在網頁上顯示，不必下載 Excel | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-treatment-report-viewer.user.js) |
| `dentall-registration-sort-memory.user.js` | 「就診列表」記住上次點選的排序欄位與方向，回到畫面自動套用 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-sort-memory.user.js) |
| `dentall-registration-new-patient-alert.user.js` | 「就診列表」出現新掛號病患時，畫面下方跳出醒目提醒方塊、語音播報「○○醫師，○點○分預約病患抵達」並把該列標黃，點哪一位就關掉那一位 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-new-patient-alert.user.js) |

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

> 檢查是否成功：在 Dentall 頁面點 Tampermonkey 圖示，應看到已安裝的腳本開關為綠色，且圖示上的數字等於已安裝的腳本數。
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

---

## Dentall 就診列表 記住排序

就診列表的表頭可以點「序位 / 掛號時間 / 預約時間 / 主治醫師 / 門診處置」排序，但 Dentall 每次離開再回到就診列表都會重設為「掛號時間 由新到舊」。
裝了這支腳本後，你點過的排序會被記住，之後每次回到就診列表（含重新整理、重開瀏覽器）都自動套用。

### 使用方式

照平常一樣點表頭排序即可，不用額外設定。點到「沒有箭頭」的狀態（第三次點同一欄）就等於回到系統預設。

- 記住的內容只存在這台電腦的瀏覽器（localStorage），每台電腦各自記。
- 不碰任何資料、不呼叫 API，只是代替你點表頭。

---

## Dentall 就診列表 新掛號提醒

就診列表出現新掛號的病患時，畫面中間下方會跳出橘色的提醒方塊，先一聲短「叮」、再語音播報「**○○醫師，○點○分預約病患抵達**」（沒有預約時間的現場掛號會唸「現場掛號病患抵達」），列出 **序位、姓名、主治醫師、預約時間、掛號時間**，同時把該列在表格裡標成黃色。
方塊不是新視窗、也不會自動消失：**點某一位病患只會關掉那一筆**（該列的黃色標示一起消失），右上角 ✕ 才是全部關閉。關閉前再有新病患會累加在同一個方塊裡，標題顯示人數。

### 使用方式

裝好就會自動運作，不用設定。注意事項：

- 語音用瀏覽器內建的語音合成（Web Speech API），不需要音檔或外部服務。聲音優先用 Chrome 自帶的「Google 國語（臺灣）」（每台 Chrome 都有、需要網路），找不到才用 Windows 的 Microsoft 雅婷／漢漢或 Mac 的美佳。但瀏覽器規定頁面要先被點過、按過鍵盤才允許出聲，所以剛打開頁面、完全沒碰過之前來的新病患不會立刻響，會等你下一次點畫面或按鍵時補響一次（方塊本身照常顯示）。之後就都即時。
- 必須讓 Dentall 的就診列表分頁留在前景，Dentall 才會自己更新列表（分頁被切到背景時 Dentall 會暫停更新，切回來後會補更新，那時再提醒）。
- 第一次打開某一天的就診列表只會默默記下目前已有的病患，不會整排跳出來；之後新增的才提醒。
- 已看過的病患記在這台電腦的瀏覽器（localStorage，依日期分開、保留最近 5 天），重新整理或切到別的頁面再回來都不會重複提醒。
- 門診處置已是「已完成」的列不提醒；一次冒出超過 10 列（例如切換篩選）視為整批載入，也不提醒。
- 不碰任何資料、不呼叫 API，只是觀察表格的變化。
