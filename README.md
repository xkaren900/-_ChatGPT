# 庫位｜倉庫管理原型

手機優先的倉庫位置管理介面原型，用於驗證房間、櫃子、箱子及一般物品的建立、查詢與移動流程。

## 目前功能

- 建立物品與容器
- 拍照預覽
- QR Code相機測試、模擬掃描與手動輸入
- 名稱、編號與路徑搜尋
- 階層位置樹
- 移動容器後自動更新下層物品路徑
- 防止容器移入自己的下層內容物
- 使用 Google Sheets 保存資料、Google Drive 保存私人照片
- 手動輸入存取金鑰連線、重新載入雲端資料

## 資料狀態

網站已提供 Google Apps Script 雲端連線。存取金鑰僅存於頁面記憶體，重新整理後需再次輸入。原有 localStorage 資料不會自動上傳或清除。這是共用金鑰驗證，尚未提供個人帳號與角色權限。

## 後端設定

將 `backend/Code.gs` 貼入 Apps Script，在指令碼屬性設定至少24字元的 `WAREHOUSE_TOKEN`，執行 `setupWarehouse`，再部署網頁應用程式（以擁有者執行、所有人可存取）。網站網址設定於 `cloud.js`，金鑰不可提交到 repository。

照片接受 JPEG、PNG、WebP 且上限約2MB，保留 Drive 權限，不自動公開。跨裝置修改後按「重新載入」。新增請求若未收到確認，先重新載入確認是否已建立，避免重複新增。

## GitHub Pages

Repository內含GitHub Actions工作流程；將Pages來源設定為GitHub Actions後，每次更新`main`分支會自動發布。

