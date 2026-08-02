# 公開資料契約

`data/processed/zhu-jiahua-app.json` 是唯一可同步到前端的資料檔。

必要頂層欄位：

- `schemaVersion`、`generatedAt`
- `source`：可公開書目與權利邊界，不含本機路徑
- `project`：標題、階段與研究焦點
- `materialCoverage`：全書頁數與公開全文的門檻，只留讀者看得懂的兩項
- `tableOfContents`：**全書目次的公開投影**，198 篇的篇名、原文日期、原書起頁與部次／分節；已校訂全文者帶 `textPath`。來源是 `data/derived/toc_index.json`，不在此手改。頁碼一律是原書頁碼，不是 PDF 頁次（兩者差值在全書中不是定值，見 `data/derived/README.md`）
- `legalEducation`：法律教育篇群的導讀、六篇篇目與讀者可見狀態。三個欄位有硬要求：
  - `items[].shortTitle`：十字以內的短標，給前端窄欄（側欄目次、議題交叉）用。短標放這裡，不由前端臨時砍字串。
  - `themes[]`：議題索引，讓同一批言論可以按議題而非年代重排。每個 `appearances[].id` 必須對得上 `items[].id`。
  - `themes[].appearances[].note`：該議題在該篇怎麼談，必須出自該篇原文，不得跨篇推論
- `verifiedTexts`：達人工逐字核對門檻、可完整公開的篇章原文。每一篇都必須在 `tableOfContents` 有一筆帶 `textPath` 的對應篇目，兩邊筆數相等
- `initialResults`：只由目前已核頁面支持的初步內容觀察
- `researchQuestions`：目前研究問題

狀態必須使用讀者可理解的繁體中文。尚未由原頁核對的內容標示「待核」，不得以前端文案掩飾缺漏。

## 不得進入公開快照的欄位

研究流程紀錄留在本倉（`engineering/LOG.md`、`data/derived/`），不進 canvas——公開面連未渲染的 JSON 欄位都不放工程作業語言。`validate-processed.mjs` 會擋下這幾個鍵：

`methodPlan`、`riskRegister`、`immediateNextWork`、`contentProgress`、`materialSegments`

同理，`toc_index.json` 裡「待核」「待與正文核對」這類流程註記在投影時就要濾掉，只留讀者用得上的觀察（如「蔡孑民即蔡元培」「正文題名與目次不同」）。
