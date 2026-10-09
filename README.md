# dentall-userscripts

給 [his.dentall.io](https://his.dentall.io)（Dentall HIS）用的 Tampermonkey 使用者腳本集合。每支腳本一個 `.user.js` 檔，各自獨立安裝、獨立自動更新。

| 腳本 | 說明 | 安裝 |
|---|---|---|
| `dentall-treatment-report-viewer.user.js` | 「分析報表 → 治療項目統計」直接在網頁上顯示，不必下載 Excel；「列印預約表」多一顆「檢視」按鈕，預約表直接在視窗裡看 || [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-treatment-report-viewer.user.js) |
| `dentall-registration-sort-memory.user.js` | 「就診列表」記住上次點選的排序欄位與方向，回到畫面自動套用 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-sort-memory.user.js) |
| `dentall-registration-new-patient-alert.user.js` | 「就診列表」出現新掛號病患時，畫面下方跳出醒目提醒方塊、語音播報「○○醫師，○點○分預約病患抵達」並把該列標黃，點哪一位就關掉那一位；就診列表分頁在背景時另外送 Chrome 桌面通知 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-registration-new-patient-alert.user.js) |
| `dentall-receipt-next-appt.user.js` | 列印「健保批價單」時，在收據底部置中加印病患未來最多兩筆預約（民國日期＋星期＋時間）；沒有未來預約則收據維持原樣 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-receipt-next-appt.user.js) |
| `dentall-nhi-receipt-confirm-form.user.js` | 列印「健保批價單」時，在同一份 PDF 後面加一頁 A5 的「全民健保牙醫門診醫療服務北區 醫療確認單」，一次列印一起印出；姓名、就醫日期、院所名稱/代號自動帶入 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-nhi-receipt-confirm-form.user.js) |
| `dentall-auto-login.user.js` | 被登出、畫面出現登入表單時自動登入，登入後回到原本的頁面（例如就診列表）；帳號密碼用 Tampermonkey 選單設定，只存在那台電腦 | [安裝](https://raw.githubusercontent.com/seanawa/dentall-userscripts/main/dentall-auto-login.user.js) |

## 安裝

### 診所電腦安裝清單（逐步打勾）

逐步打勾的安裝清單（含所有連結）：**https://seanawa.github.io/dentall-userscripts/**

### 步驟

1. Chrome 安裝 [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) 擴充功能。
2. **開啟「允許使用者指令碼」**（新版 Chrome 必做，否則腳本不會執行）：
   - 網址列輸入 `chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo` 按 Enter
   - 找到「允許使用者指令碼」(Allow User Scripts) 那一列，把開關打開
   - 舊版 Chrome 沒有這個選項的話，改在 `chrome://extensions` 右上角開啟「開發人員模式」
3. 點上表「安裝」欄的連結（要裝幾支就點幾個），在跳出的 Tampermonkey 畫面按「安裝」。
4. **完全關閉 Chrome 再重新打開**（Windows 請確認工作列隱藏圖示裡沒有殘留的 Chrome；Mac 按 Cmd+Q）。
5. 登入 Dentall，重新整理頁面。

> 檢查是否成功：在 Dentall 頁面點 Tampermonkey 圖示，應看到已安裝的腳本開關為綠色，且圖示上的數字等於已安裝的腳本數。
> 若圖示彈窗上方出現藍色橫幅「請啟用『允許使用者腳本』」，代表第 2 步還沒做。

之後腳本有更新，Tampermonkey 會自動抓取，不需要重裝。

---

## Dentall 治療項目統計 線上瀏覽

讓 [his.dentall.io](https://his.dentall.io) 的「分析報表 → 治療項目統計」直接在網頁上顯示，不必下載 Excel。

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

### 列印預約表：檢視

預約排程 → 工具列的列印圖示 →「列印預約表」對話框，「匯出Excel」左邊多一顆 **「檢視」**。
選好日期與醫師後按「檢視」，不下載檔案，直接在視窗裡看預約表：「全院所醫生」和每位醫師各一個分頁，可搜尋、篩選欄位、點標題排序。需要檔案時按右上角「下載 Excel」。

- 時間只顯示月/日與時刻（不顯示年份），「治療長度」改稱「需時」，病患名稱是「★保留」的時段不顯示。
- 右上角「全部列印」：每位醫師一份、各自換頁，不印「全院所醫生」；沒有預約的醫師略過。
- 右上角「單獨列印」：印目前這個分頁，照畫面上的搜尋與排序。
- 列印都**不印電話**（A4 直式）。各醫師的分頁另不印主治醫師；「全院所醫生」分頁單獨列印時保留主治醫師，改不印需時、性別。

原本的「匯出Excel」照舊下載。Dentall 的預約表是瀏覽器自己產生 xlsx 再觸發下載，腳本只在按了「檢視」後 30 秒內攔截那一次下載，改成顯示。

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

就診列表出現新掛號的病患時，畫面中間下方會跳出橘色的提醒方塊，先一聲短「叮」、再語音播報「**○○醫師，○點○分預約病患抵達**」，列出 **序位、姓名、主治醫師、預約時間、掛號時間**，同時把該列在表格裡標成黃色。
方塊不是新視窗：**點某一位病患只會關掉那一筆**（該列的黃色標示一起消失），右上角 ✕ 才是全部關閉。
**掛號已超過 5 分鐘、且已超過預約時間 5 分鐘**的病患會自動從方塊消失（例如預約 14:30、14:23 掛號，14:35 自動關；預約 15:00、14:42 掛號，15:05 才關）。臨時指定的病患沒有預約時間，不會自動關，要點掉。每 30 秒檢查一次。關閉前再有新病患會累加在同一個方塊裡，標題顯示人數。

### 使用方式

裝好就會自動運作，不用設定。建議：**把就診列表分頁釘選起來**（分頁按右鍵 → 釘選）。釘選的分頁 Chrome 的「記憶體節省模式」不會卸載，也不會被誤關，就診列表就能一直留在那個分頁盯著。

注意事項：

- **聲音設定**：就診列表左下角有「🔔 掛號提醒聲音」按鈕，可以各自開關「叮」聲與語音播報、選聲音、調語速和音量，有「試聽」。設定只存在那台電腦，每台可以不一樣（例如診間電腦靜音、櫃台開播報）。
- 語音用瀏覽器內建的語音合成（Web Speech API），不需要音檔或外部服務。聲音設「自動」時優先用 Chrome 自帶的「Google 國語（臺灣）」（每台 Chrome 都有、需要網路），找不到才用 Windows 的 Microsoft 雅婷／漢漢或 Mac 的美佳。但瀏覽器規定頁面要先被點過、按過鍵盤才允許出聲，所以剛打開頁面、完全沒碰過之前來的新病患不會立刻響，會等你下一次點畫面或按鍵時補響一次（方塊本身照常顯示）。之後就都即時。
- **背景分頁也會提醒**：Dentall 原本在分頁切到背景時會暫停更新就診列表，列表不變、腳本就偵測不到新掛號。1.8.0 起腳本會讓 Dentall 以為就診列表分頁一直在前景（接管 `document.visibilityState`），Dentall 就會照常更新，新掛號時一樣會叮一聲、語音播報，並另外送 Chrome 桌面通知（分頁在前景時不送通知）。
  - 第一次在就診列表點擊畫面時 Chrome 會問一次「允許通知」，要按允許；若之前按過封鎖，點網址列左邊的鎖頭圖示把通知改成允許。
  - Chrome 對背景分頁有節流：隱藏超過 5 分鐘後，Dentall 的定時更新最多一分鐘跑一次，所以背景時提醒可能晚最多一分鐘。
  - Chrome 的「記憶體節省模式」可能把久未使用的背景分頁整個卸載，腳本就停了。把就診列表分頁**釘選**就不會被卸載；不想釘選的話，到 `chrome://settings/performance` 把 `his.dentall.io` 加進「一律讓這些網站保持啟用」。
  - 只適用於「就診列表固定開在一個分頁、其他操作在別的分頁」的用法；在同一個分頁裡切到別的頁面，腳本就看不到列表、什麼都不會送。
- 第一次打開某一天的就診列表只會默默記下目前已有的病患，不會整排跳出來；之後新增的才提醒。
- 已看過的病患記在這台電腦的瀏覽器（localStorage，依日期分開、保留最近 5 天），重新整理或切到別的頁面再回來都不會重複提醒。
- **預約時間空白**的新列：若同一位病患（病歷號相同）今天已經有另一筆掛號，整筆忽略，不顯示也不唸；若是今天第一筆，提醒方塊標「臨時指定」，語音唸「**○○醫師，有臨時指定病患**」。
- 門診處置已是「已完成」的列不提醒；一次冒出超過 10 列（例如切換篩選）視為整批載入，也不提醒。
- 不碰任何資料、不呼叫 API，只是觀察表格的變化。

---

## Dentall 健保批價單 加印下次預約

列印「健保批價單」時，在收據底部（註記 3 下方）置中、粗體加印病患未來最多兩筆預約：

```
下次預約：115/10/15（四）14:30　／　115/10/29（四）10:00
```

- 民國年 / 星期 / 時間，不印醫師
- 排除已取消 (`CANCEL`)、過去的、以及本次看診那一筆預約
- 沒有未來預約時收據維持原樣
- 任何一步失敗（找不到病患、API 錯誤、字型載入失敗…）都退回原樣列印，不會卡住櫃台
- 只在處置單頁（`#/pd/…`）且 PDF 為 A5 橫向時作用，不影響處方箋、診斷書等其他列印

### 使用方式

**先排好下次預約，再列印批價單**。列印預覽底部就會看到那行字；第一次列印會多花一兩秒下載字型，之後有快取。

### 調整外觀

都在檔案開頭的 `CFG`（改完記得把 `@version` 加一號，裝了的電腦才會自動更新）：

| 參數 | 預設 | 說明 |
|---|---|---|
| `fontSize` | 13 | 字體大小 (pt) |
| `bold` / `boldWidth` | true / 0.45 | 模擬粗體（TW-Sung 沒有粗體字檔，用填色＋描邊）；描邊越寬越粗 |
| `yTop` | 372 | 距頁面頂端 (pt)，越大越往下 |
| `align` / `x` | center / 28.4 | 置中；改 `left` 則從 `x` 開始 |
| `maxItems` | 2 | 最多印幾筆 |
| `mode` | live | 改成 `diag` 只記錄不改 PDF，用來除錯 |

### 除錯

F12 → Console 篩選 `dentall-next-appt`。正常一次列印會看到 `pdf … registration … appointments status 200 … next … modified pdf bytes`。
若出現 `error, fallback to original`，代表那次是原樣列印，訊息後面是原因。

### 原理

Dentall 的批價單是前端用 `@react-pdf/renderer` 產生 PDF blob，塞進 `<iframe title="pdf-print-view">` 後呼叫 `print()`。
腳本攔截該 iframe 的 `src` 設定，用 [pdf-lib](https://pdf-lib.js.org/) 在 PDF 上加字（嵌入收據同款 TW-Sung 字型的 subset，PDF 只多約 5 KB），再把改好的 PDF 交回給 iframe，Dentall 原本的列印流程不動。

- 病患 id 取自 Dentall 的 Redux store（`procedureDocumentPageReducer.pd.patient.id`）；腳本若比 Dentall 晚載入沒攔到 store，會改從 React 元件樹找。
- 預約透過 Dentall 自己的 API `GET /htdc/api/appointments?patientId.equals=<id>&size=1000` 取得，auth header 直接複製 Dentall 自己的請求，腳本內沒有任何帳號、token 或病患資料。
- Dentall 改版若動到列印流程或 API，腳本會退回原樣列印，需再對照新版調整。

`docs/receipt-layout-mock.png` 是版面示意，`docs/receipt-test-output.png` 是最終渲染結果。

---

## Dentall 健保收據 附印醫療確認單

列印「健保批價單」（健保看診收據）時，在同一份 PDF 後面加一頁 **A5 橫式**的「全民健保牙醫門診醫療服務北區『醫療確認單』」。
收據和確認單是**同一個列印工作**：只跳一次列印對話框，同一台印表機、同一種 A5 紙，按一次「列印」兩張都出來。
版面照健保署北區業務組的原表縮成 A5 橫式（原表註明可縮小使用），表格下方的「註」不印。
從列印選單點「健保批價單(補發)」時**不附印**確認單，只印收據。

**自動帶入**：處置內容與簽名仍留白手寫，其他欄位如下。

| 欄位 | 來源 |
|---|---|
| 姓名 | 批價單上的「病患姓名」；讀不到時改用 Dentall 處置單頁的病患資料 |
| 就醫日期 | 批價單上的「就診日期」；讀不到時改用掛號／預約日期 |
| 院所名稱 | 批價單抬頭的院所名稱；讀不到時改用選單設定 |
| 院所代號 | 批價單最下面那行（代號／電話／地址）的 10 碼代號；讀不到時改用 Dentall 診所設定，再不行用選單設定 |

### 使用方式

1. 照平常在處置單按列印 →「健保批價單」，列印預覽就會看到第 2 頁的確認單。第一次列印會多花一兩秒下載函式庫，之後有快取。

Tampermonkey 選單：

| 選單 | 作用 |
|---|---|
| 🖨 列印醫療確認單（A5） | 單獨印一張確認單；30 分鐘內印過批價單的話會帶入那張的姓名與日期 |
| 健保收據列印時自動附印：開／關 | 不想附印的電腦可以關掉 |
| 院所名稱/代號 | 備用：批價單和 Dentall 設定都讀不到時才用，平常不必設定 |
| 每次張數 | 預設 1；原表為一式二聯，可設 2 |
| 最近的處理紀錄 | 最近 10 次的處理結果，以及四個欄位各從哪裡帶入 |

設定存在那台電腦的瀏覽器（localStorage），每台電腦各自設定。

### 原理

和「加印下次預約」一樣攔截 `<iframe title="pdf-print-view">` 的 `src`，兩支可以同時裝，載入順序不拘：批價單第一頁加下次預約，後面加確認單。

- 第一頁不是 A5 橫式，或文字裡沒有「健保」和「收據」，就原樣列印，不影響處方箋、診斷書等其他列印。
- 用 [pdf.js](https://mozilla.github.io/pdf.js/) 讀批價單第一頁的文字找欄位，用 [pdf-lib](https://pdf-lib.js.org/) 畫確認單。字型是收據同款 TW-Sung，只嵌入用到的字。函式庫第一次使用時從 cdnjs／jsdelivr 載入。
- 任何一步失敗（函式庫或字型載不到、PDF 讀不了…）都原樣列印收據，不會卡住櫃台。原因會記在「最近的處理紀錄」，F12 → Console 篩選 `confirm-form` 也看得到。
- 讀到的姓名與日期只用在當次列印，只留在頁面記憶體，不寫進 localStorage。處理紀錄不記病患資料。腳本不呼叫 Dentall API。

---

## Dentall 自動登入

目標：**Windows 開機 → Chrome 自動還原「釘選的就診列表分頁＋一個一般分頁」→ Dentall 若已登出，自動登入回到原頁面，完全不用按。**

Dentall 登出後網址不變（例如還停在 `#/registration`），畫面換成登入表單。腳本看到登入表單，就用設定好的帳號密碼填入並按「登入」，成功後回到登出前的頁面。

### 使用方式

1. 安裝腳本後，在 Dentall 任一頁點 Tampermonkey 圖示 → 「Dentall 自動登入」→ **🔑 設定帳號密碼**，在跳出的小視窗填帳號、密碼，按儲存。
2. 就診列表開在一個分頁（`https://his.dentall.io/htdc/#/registration`）並**釘選**，其他操作開另一個分頁。
3. Chrome 設定 → 起始畫面 → 選「**繼續瀏覽上次開啟的頁面**」（`chrome://settings/onStartup`）。下面的 .reg 也會設這一項，但多數診所電腦不吃，見「Windows 政策檔」。

Tampermonkey 選單：

| 選單 | 作用 |
|---|---|
| 🔑 設定帳號密碼 | 小視窗輸入帳號、密碼（密碼欄位是遮罩的）；儲存同時會解除「已暫停」 |
| 🗑 清除帳號密碼 | 刪掉這台電腦存的帳號密碼 |
| 自動登入：開／關 | 關掉後看到登入表單也不動作 |
| ⚠ 已暫停（上次失敗）→ 點此恢復 | 登入失敗後才出現，確認帳號密碼沒問題再點 |
| 📋 最近紀錄 | 最近 20 筆：時間、分頁路由、結果（成功／失敗原因／等待／重新整理），不記帳號密碼 |

登入頁下方會有一條橘色提示，說明這次為什麼沒有自動登入（尚未設定、已暫停、5 分鐘內剛試過、等另一個分頁…）。

### 安全設計

- **帳號密碼存在 Tampermonkey 的腳本儲存區**（`GM_setValue`），只在那台電腦，不在這個公開 repo、不在網頁的 localStorage，Dentall 的網頁也讀不到。但它是明碼存在電腦裡，能操作這台電腦 Chrome 的人都能從 Tampermonkey 看到，請只裝在診所內部、有開機密碼的電腦。
- **每個分頁 5 分鐘最多試一次**（記在 sessionStorage）。
- **失敗就停**：按「登入」後 20 秒仍停在登入頁，就算失敗，所有分頁一起暫停自動登入，直到從選單「恢復」或重新設定帳號密碼，避免密碼改了之後一直試把帳號鎖住。失敗原因（Dentall 顯示的錯誤訊息）記在「最近紀錄」。
- **兩個分頁同時在登入頁**：用 localStorage 的鎖，只讓一個分頁登入；另一個分頁等它成功後自動重新整理。持鎖的分頁 60 秒沒完成，鎖就失效，交給下一輪判斷。

### 回到原本的頁面

登入狀態下，每個分頁把目前路由（例如 `#/registration`）記在 sessionStorage。登入成功後若 Dentall 跳到別的頁面，腳本會跳回那個路由。
Chrome 還原分頁時 sessionStorage 也會一起還原，所以釘選的分頁會回到就診列表，另一個分頁回到它自己原本的頁面。

### Windows 政策檔（第 4 個保險）

[`windows/chrome-policy-dentall.reg`](windows/chrome-policy-dentall.reg) 設定兩條 Chrome 企業政策（寫在 `HKLM\SOFTWARE\Policies\Google\Chrome`）：

| 政策 | 值 | 作用 |
|---|---|---|
| [`TabDiscardingExceptions`](https://chromeenterprise.google/policies/#TabDiscardingExceptions) | `1` = `his.dentall.io` | Dentall 的分頁永遠不會被「記憶體節省模式」或記憶體不足時卸載（Chrome 108 起） |
| [`RestoreOnStartup`](https://chromeenterprise.google/policies/#RestoreOnStartup) | `dword:1` | 強制開啟 Chrome 時還原上次的分頁（1 = RestoreOnStartupIsLastSession） |

**套用**：在 GitHub 打開檔案 → 右上角「Download raw file」下載 → 雙擊 → 系統管理員權限（UAC）按「是」→ 匯入確認按「是」→ 完全關閉 Chrome 再打開 → 網址列輸入 `chrome://policy`，按「重新載入政策」，確認兩條都在、狀態為「正常」。

**移除**：同樣方式匯入 [`windows/chrome-policy-dentall-remove.reg`](windows/chrome-policy-dentall-remove.reg)，只刪這兩個值，不動其他 Chrome 政策。

> ⚠ **`RestoreOnStartup` 在多數診所電腦不會生效。** Chrome 把它列為「敏感政策」：Windows 電腦**沒有加入 AD 網域／Azure AD，也沒有註冊 Chrome 企業雲端管理**時，從登錄檔設定的敏感政策會被忽略，`chrome://policy` 會顯示該政策被封鎖／忽略。這種電腦請改用上面「使用方式」第 3 步，在 Chrome 設定裡手動選「繼續瀏覽上次開啟的頁面」。
> `TabDiscardingExceptions` 不是敏感政策，一般電腦都會生效。
> 套用任何政策後，Chrome 設定頁會顯示「你的瀏覽器由貴機構管理」，這是正常的。
