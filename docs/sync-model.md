# 同步模型

資料流固定為單向，落點是 `phenom-zhujiahua`（studies.phenomcanvas.com/zhujiahua/），
`my-canvas-lab` 自 2026-08-20 起不再收這個站的資料，那裡的舊頁已拆除。

```text
zhu-jiahua-research-data/data/processed/
  zhu-jiahua-app.json、chronology.json、related-documents.json、
  reading-drafts/*.json、external-drafts/*.json、search-corpus.json
  → npm run sync（先跑 validate，再跑 sync-to-frontend.mjs）
  → phenom-zhujiahua/src/data/（zhuJiahua.json 等 213 個檔，每個檔的 sha256 記在 zhuJiahua.sync.json）
  → React 前端
```

前端不反向寫回資料倉，也不在建置或瀏覽器執行期間讀取資料倉。同步由人觸發，GitHub Actions 的 checkout 裡
沒有相鄰的資料倉可讀。前端的 `validate-synced-content.mjs` 拿 `zhuJiahua.sync.json` 對帳，
在前端手改任何一份同步過去的檔，那道閘會報「與資料倉送來的版本不一致」。

## 全文檢索的語料

`data/processed/search-corpus.json` 由 `npm run build:search-corpus` 產生，收讀稿、校訂全文、
卷首兩篇、年譜與書外文獻，2026-09-10 是 278 筆、603,641 字。收錄用目錄自動發現，新增一篇
讀稿或一件書外文獻不必改腳本。語料照母本的原書字形寫入，異體字對照表烤進 `variants` 欄，
折合在瀏覽器端做。

母本改了，語料就過期。`validate-processed.mjs` 重建一份與磁碟上的比對，`sync-to-frontend.mjs`
同步前再比一次，兩處都擋；沒有別的東西會提醒。改過校訂稿、讀稿、年譜、書外文獻或
`variants.tsv` 之後，先跑 `npm run build:search-corpus` 再 `npm run sync`。

前端把語料打成獨立的 chunk，檢索頁開啟時才載入，線上壓縮後約 0.8 MB。

## 上線

前端從 commit 開 detached worktree 建置，`wrangler versions upload` 上傳 Worker 版本，
再 `versions deploy` 晉升；細節與命令在 `my-canvas-lab/.claude/CHECKPOINT.zhu-jiahua.md`
的「全線共通」一節。phenom-ops 目前沒有這個站的上線 workflow。
