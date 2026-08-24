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

## `data/processed/chronology.json`

《朱家驊先生年譜簡編》1893–1963 共 71 個年目，由 `engineering/scripts/build-chronology.mjs` 產生，不手改。`schemaVersion: '2.0'` 起，71 個年目全部帶 `text`，材料分兩層，兩層在同一份正文裡逐段並存：

- 原書 377–393 頁（民國 27–37 年，1938–1948）：人工逐頁對照原頁圖校訂，`data/derived/chronology/transcriptions/p*.md`，最高優先，任何情況下不得被 OCR 覆蓋。
- 其餘原書 353–376、394–417 頁：Google Cloud Vision（DOCUMENT_TEXT_DETECTION，languageHints: zh-Hant）辨讀稿，`data/materials/chronology/gcv/txt/`，只做書眉、頁碼與版面雜訊的結構性剔除，未經逐頁人工校對，不套用任何字形或標點正規化。418 頁起是後記，不在年目正文範圍內。

每個年目必要欄位：

- `text.coverage`：`全年`｜`部分`。只有 1963 年（條目續至 417 頁以後的後記與附錄）是「部分」。
- `text.transcriptionStatus`：`verified`｜`gcv`｜`mixed`。`mixed` 專指條目橫跨兩種材料交界的年目（1937、1948），這種情況下 `text.pageBreaks[].source` 逐段標明各段落分別出自校訂稿還是辨讀稿。
- `text.transcriptionStatusLabel`：對應的繁體中文說明，前端直接印。
- `text.pageBreaks`：每筆帶 `bookPage`、`para`、`offset`、`source`。
- `text.coverageNote`：`coverage` 為「部分」，或 `transcriptionStatus` 為 `mixed` 時必填，寫明缺哪一段或交界在哪裡。

年目的先後順序以 `page_index.csv` 的 71 列位置為準，不靠辨讀稿裡的民國紀年數字（那串數字在未校頁面可能就是機器誤讀）；建置時逐年比對「偵測到的年目抬頭數」與「索引列數」相等，不等就中止。

`unreviewedOcr` 欄位交代辨讀引擎、涵蓋頁碼與「未抽樣、不宣稱準確率」的限度；讀者要看到才算數，不得以前端文案掩飾這批材料未經校對。
