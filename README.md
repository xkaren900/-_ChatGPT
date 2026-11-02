# 庫位｜零件與多儲位管理（合併開發版）

以原本「庫位」GitHub 專案為主體，整合私人零件系統的專業欄位、分表、預留儲位與版本保護。本分支為 schema 4 的開發候選，**不是已切換的正式網站或已遷移的資料庫**。

## 已加入

- 原有手機介面、位置樹、QR／手動查詢、照片壓縮與共用金鑰連線。
- Parts（零件）、Locations（儲位）、Stock（分儲位數量）分開管理；同一零件可放在多處。
- 製造商、MPN、規格、單位、條碼、備註的編輯與搜尋。
- ACTIVE／RESERVED 儲位，預留可未命名，預留儲位不可作放置目標。
- 已知數量與未知分開；未知先盤點，不能當0增減。
- 按儲位增減／盤點；搬動容器不改數量；部分庫存轉移以單筆提交記錄兩端變化。
- 主檔、儲位、庫存各自的 Version；拒絕舊資料覆蓋。
- 每次寫入使用 RequestID 及完整內容指紋。重試回傳原結果，相同ID不同內容拒絕。
- 不確定結果先保留本頁的待確認請求，重新整理後可用原請求確認／重試。
- 提交日誌可重建主表與操作紀錄；文字保留原內容，不使用讀回時刪單引號的做法。

## 不連線也可預覽

使用 Node.js 20+，不需安裝套件：

    npm test
    node tools/check.cjs
    npm run preview

開啟 http://127.0.0.1:8765/?preview=1 。

只有明確加上 preview=1 才使用記憶體示範資料；不讀取舊資料、不傳照片、不上傳、不保存庫存，重新整理即重設。預覽有一筆M3螺絲分放兩個抽屜（100／50）及一筆未知數量。

本候選的 config.js 刻意不包含既有網站的雲端網址。它不能直接連到 schema 3 後端。GitHub Pages 目前只部署 main；本開發分支不自動替換既有網站。

## 獨立測試後端設定

正式資料切換前先用新的 Apps Script 測試專案、獨立空白試算表及私人照片資料夾。將 backend/Core.gs 與 backend/Code.gs 分別貼入同一專案。在指令碼屬性設定：

| 屬性 | 用途 |
| --- | --- |
| MERGED_SPREADSHEET_ID | 新的空白測試資料庫ID，不能填現用資料庫 |
| MERGED_PHOTO_FOLDER_ID | 私人測試照片資料夾ID |
| WAREHOUSE_TOKEN | 至少24字元的測試金鑰，不能提交GitHub |
| MERGED_WRITE_ENABLED | 明確設為 true 才允許初始化與寫入 |

執行 setupMergedWarehouse；若發現既有庫存表或欄位不符會停止，不清空資料。完成測試專案與部署的個別授權後，再依選定的「共用金鑰」架構設定其測試入口。不可擴大既有私人V6系統的權限來充當本後端。

將測試入口填入本機／測試分支 config.js 的 endpoint，前端仍須輸入金鑰。所有讀取都驗證金鑰；版本必須為 schema 4。此分支沒有執行任何 Apps Script 部署、授權或資料移轉。

## 提交與恢復

WarehouseJournal 每列是一筆JSON提交，包含RequestID、內容指紋、前後值、結果、時間及「共用金鑰」操作者標示；不存金鑰或照片base64。新增零件及初始庫存、兩端轉移的變化放在同一筆提交。

Parts、Locations、Stock、AuditLogs是可重建的顯示副本。讀取一律以提交日誌還原；副本寫失敗不回滾已確認提交。可在核准的測試專案手動執行 rebuildMergedProjections 重建。**不要直接改副本數量、刪日誌或降低編號計數器。**

若提交或flush沒有確認，伺服器回報結果未知；畫面保留原請求並禁止其他寫入。用「確認上次操作」重送完全相同的請求，避免再次扣庫。待確認內容只存在目前瀏覽器的sessionStorage（同分頁），可能含照片及備註；關閉分頁、清除網站資料前應先確認。共用金鑰不代表個人帳號，不能把紀錄當作個人身分證明。

此方案沒有宣稱Sheets具備跨服務交易。若底層單筆日誌也遭手動修改／毀損會停止；沒有自動修復被破壞的來源。未提交的驗證拒絕不會混入成功業務日誌，失敗監控另見測試報告限制。

## 文字安全

日誌使用JSON保存字串（以物件開頭，不是使用者公式）；顯示副本使用RichText文字寫入；API從原始JSON讀取，不猜測或移除單引號。此路徑的本機替身測試已通過，**仍需在隔離Google Sheets確認字面文字與getFormulas回讀**，不可把mock視為平台驗證。

官方介面：[Range.setRichTextValues](https://developers.google.com/apps-script/reference/spreadsheet/range#setRichTextValues(RichTextValue))、[RichTextValueBuilder.setText](https://developers.google.com/apps-script/reference/spreadsheet/rich-text-value-builder#setText(String))。

## 移轉預演

tools/migration.cjs 只讀取本機JSON匯出，不含Google API、不寫入目的地、不改QR、不自動合併同名零件：

    node tools/migration.cjs exports/source.json

格式示例見 docs/migration-input.example.json。需提供完整歷史，不可只匯出畫面最近50筆。回傳欄位對照、重號、同名、缺父節點、測試資料、未知數量、原歷史封存及來源雜湊。本分支沒有開放真正匯入工具，也沒有讀取使用者的正式資料。

## 驗證與剩餘工作

- 詳細測試及未驗項目見 docs/TEST_REPORT.md。
- 單元與故障注入涵蓋業務核心、Google服務替身、瀏覽器請求恢復及移轉預演。
- 真實Google讀寫、Drive照片、相機、手機畫面與大資料量仍須整合測試。
- 前端與後端須一起升級；不能只合併main就假定資料庫已遷移。
