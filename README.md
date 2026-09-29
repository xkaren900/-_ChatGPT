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
- 使用瀏覽器localStorage保存原型資料

## 資料狀態

目前只使用示範資料和瀏覽器本機儲存，尚未連接Google Sheets、Google Drive或登入驗證。

## GitHub Pages

Repository內含GitHub Actions工作流程；將Pages來源設定為GitHub Actions後，每次更新`main`分支會自動發布。

