# 工程說明

`engineering/scripts/` 底下是建置與驗證的腳本，`LOG.md` 是操作紀錄。公開資料更新後，`npm test` 跑驗證，`npm run sync` 同步到
前端 `phenom-zhujiahua`（不是 my-canvas-lab）。改過母本要先 `npm run build:search-corpus`，
否則 validate 與 sync 都會擋。同步的流程見 `docs/sync-model.md`。
本倉沒有 CI：`validate-processed.mjs` 讀 `file:../phenom-ops/packages/prose-rules`，
GitHub Actions 的 checkout 裡沒有相鄰的 phenom-ops，接 CI 前要先給它一個能拉私有倉的 token。
