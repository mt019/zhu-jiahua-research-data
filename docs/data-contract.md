# 公開資料契約

`data/processed/zhu-jiahua-app.json` 是唯一可同步到前端的資料檔。

必要頂層欄位：

- `schemaVersion`、`generatedAt`
- `source`：可公開書目與權利邊界，不含本機路徑
- `project`：標題、階段與研究焦點
- `materialCoverage`：全書頁數與公開全文的門檻，只留讀者看得懂的兩項
- `tableOfContents`：**全書目次的公開投影**，198 篇的篇名、原文日期、原書起頁與部次／分節；已校訂全文者帶 `textPath`。來源是 `data/derived/toc_index.json`，不在此手改。頁碼一律是原書頁碼，不是 PDF 頁次（兩者差值在全書中不是定值，見 `data/derived/README.md`）。日期分三欄（2026-09-29 起，全站各產物同此）：`dateIso` 供排序與取年份；`dateLabel` 是印給讀者的標示，由 `engineering/scripts/lib/date-label.mjs` 產生，只有「1942 年 7 月 28 日」「1944 年 2 月」「1947 年」「原書未載日期」「原刊未署日期」五種形狀；`dateOriginal` 是目次照錄的紀年，前端只在篇頭經 `dateSources` 印一行。本站標注兩欄（2026-09-29 起，母本在 `toc_index.json`）：`siteOccasion` 以統一格式寫會議或場合（「教育部法律教育委員會第三次會議」），篇端原文仍照錄在 `occasion`；`firstPrinting` 記首刊的刊物、卷期、年、頁碼、原刊題名與副題，建置時組成 `label` 供前端照印。卷首三項另帶網址錨點 `anchor`（dedication、origins、plates）與舊網址的 `legacyAnchor`
- `legalEducation`：法律教育六篇的篇目列（`items`：篇名、日期、場合、原書頁碼、狀態、`shortTitle`），供六篇校訂全文頁的抬頭用。導讀與議題索引 2026-09-29 移進 `subjects.json` 的 `legal-education` 主題（考述與 `threads`），舊頁 `/zhujiahua/legal-education` 308 轉到主題頁
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

年目另有兩個選配欄位：`pieces`（《言論集》有日期的篇，按原文日期排）與 `external`（2026-09-29 起，書外文獻按 `related_index.json` 的 `dateIso` 年份掛上，每筆帶 `id`、`title`、`author`、`relation`、`dateIso`、`source`（《刊名》）與 `href`（補編裡該件的錨點，`/zhujiahua/part/supplement#<anchor>`））。原刊未署日期的書外文獻不掛，建置時對帳帶日期的件數與掛上的件數。`tree.hint` 兩者都寫。

年目的先後順序以 `page_index.csv` 的 71 列位置為準，不靠辨讀稿裡的民國紀年數字（那串數字在未校頁面可能就是機器誤讀）；建置時逐年比對「偵測到的年目抬頭數」與「索引列數」相等，不等就中止。

`unreviewedOcr` 欄位交代辨讀引擎、涵蓋頁碼與「未抽樣、不宣稱準確率」的限度；讀者要看到才算數，不得以前端文案掩飾這批材料未經校對。

## 書外文獻（`data/processed/related-documents.json` 與 `data/processed/external-drafts/`）

《朱家驊先生言論集》以外的文獻層。兩種 id：SRC-（來源，一件刊物一筆）、ZJR-（文獻，一件一筆的平表）。兩種 id 只在資料層使用，不印給讀者，也不進網址。母本在 `data/derived/` 的 `sources.json`、`related_index.json`、`subjects.json`、`supplement.json`、`retired-urls.json`。聚合（主題、刊物、作者、年份）都從平表組出來，不寫死在文獻本身。

`related-documents.json` 由 `build-related.mjs` 產生，不手改；來源只投影書目欄位，權利判定、取得途徑、掃描參數與收錄來歷留在 derived。讀稿一件一檔在 `external-drafts/ZJR-NNN.json`，由 `build-external-drafts.mjs` 從 GCV 原始回應在符號層重建直排閱讀序產生，欄位形狀照 `reading-drafts/`，另帶 `sourceId`、`pageBreaks[].sourcePage`（原刊頁碼）與哥德件的 `sideMarks[]`（`para`＋`from`／`to`＋`kind`＋`text`，kind 是專名號或書名號，`text` 與正文切片逐字驗）。人工判定收在 `data/materials/external/<SRC-id>/` 的 `segmentation.json`（界內窗、分層線、接段、分段、剔除、起收錨）、`corrections/pg-NN.tsv`（誤／正兩欄，全流命中剛好一次且落在記的那一頁）與 `side-marks.tsv`；三者進版控，頁圖與辨讀稿由原 PDF 再生，不進。

讀稿的 `status` 有三種。GCV 那條路預設「未校辨讀稿」；`segmentation.json` 宣告 `review`（`status: 人工逐字校訂`、`verifiedAt`、`glyphPolicy`、`statusNote`）的來源，讀稿寫成「人工逐字校訂」並帶 `verifiedAt` 與 `glyphPolicy`，宣告的前提是全文逐欄對過原頁圖、辨讀錯字全數收進校訂表，另經一次未參與判讀者的逐字複核（2026-09-29 教師節兩件起）；轉錄檔那條路照填，另須 `transcriptSource`。`validate-related.mjs` 對「人工逐字校訂」要求 `verifiedAt` 與封閉集合內的 `glyphPolicy`，檢索語料把它記成 `review: verified`。同一處連改兩次的校訂（先補字再改字形）要併成一條，讀稿的 `corrections` 只比對得到最後一次改動的結果。

查證線索在 `data/derived/leads.json`，是工程紀錄，永不 sync 到前端；讀者該知道的未定事項，屬於一件的寫在 `related_index.json` 該件的 `openQuestions`，屬於一個主題的寫在 `subjects.json` 該題的 `openQuestions`。新收一件材料只動 JSON／TSV 與 external-drafts，程式與常數表一行不必改（第 3 件材料進來時以此為回歸判準）。

手寫件的讀稿改由轉錄檔供給：`segmentation.json` 宣告 `transcript`（status、statusNote、sourceUrl 與各件的檔名）時，`build-external-drafts.mjs` 讀 `data/materials/external/<SRC-id>/transcript/<ZJR-id>.txt`，不碰 GCV，也不套標點歸位。轉錄檔的體例是 `#` 開頭為註解、空行分段、`@pg N` 宣告以下各段起於第 N 頁。

第 3 件材料（JACAR C13050247000，2026-09-11）的回歸結果：資料層四份 JSON 與 holdings、轉錄檔照既有形狀填即可，`validate-related.mjs` 一行未改。程式與常數表動了三處：`build-external-drafts.mjs` 加轉錄檔這條路（原件是手寫行草，Google Cloud Vision 以 zh-Hant、ja 與不給提示各跑一次都只讀到表格的印刷欄名，字框重建沒有輸入可用）；前端 `src/pages/_zhu-jiahua/seo.js` 的 `CASE_PAGES` 是寫死的案清單，新增一案要補一筆，否則 `cases.js` 載入當下擲錯；前端 `CaseFlow.jsx` 右欄的正文狀態原本寫死「未校辨讀稿」，改讀讀稿自己的 `status`。

第 4 件材料（中央訓練團講演錄《黨的組織與領導》，2026-09-21）是七十四頁的整本書，回歸結果：資料層
四份 JSON、holdings、`segmentation.json` 與校訂表照既有形狀填，驗證器一行未改。程式動了三處，都是
整本書才有的事：`build-external-pages.mjs` 讀 `digitisation.ocrScale`，取圖後放大再辨讀（小字一位元
掃描在原尺寸整欄漏字）；`build-external-gcv.mjs` 讀 `segmentation.json` 的 `blankPages`，宣告過的
空白頁才准辨讀成空；新增 `propose-external-layout.mjs` 從辨讀稿量出每頁的 `bodyX` 印成草案，
七十四頁不逐頁手量。前端 `seo.js` 的 `CASE_PAGES` 照舊要補一筆。

### 主題、補編與網址（2026-09-29）

2026-09-29 站主裁示「沒有『本案』這種東西」「編進整體」「我還想要主題性編目，例如教師節主題」，同日另令工程語言與工程編號不上前端。原先的文獻案（ZJC-，`cases.json`）五案裡有三案只收一件，被稱為「案」只是為了有一個頁面放它；該層當日退役，改由兩處組織書外文獻。

補編是接在十四部之後的一部，網址 `/zhujiahua/part/supplement`，一條連續的正文流，排列記在 `supplement.json` 的 `order`（每件剛好一次，按原刊日期，同刊並列的各件照原刊先後）。每件的考述（`account`）與待核事項（`openQuestions`）接在該件正文之後；`role` 記它在原刊裡是哪一種文字（投書、覆信、按語、商榷、講演錄⋯）。`relation` 原有的「同案並列」改稱「同刊並列」。

主題是受控詞表，一題一筆，在 `subjects.json`：`slug`（網址 `/zhujiahua/subject/<slug>` 的一段，上線後不改）、`name`、`scope`（收錄範圍一句）、`account`、`openQuestions`、`members`、`seo`（`title`、`description`、`keywords`）。成員可以是書內的篇（ZJH-），也可以是書外的件（ZJR-），順序就是主題頁的排列；一題至少兩件，一件成不了主題，其考述寫在該件自己。同一件可以屬於幾個主題。主題可另帶 `threads`（議題）：每條有 `id`、`label`、`summary` 與 `appearances`（本題成員的 `id` 加 `note`，寫該件怎麼談這個議題，取自該件原文，不跨件推論），主題頁在成員列之後按議題重排一次；首例是法律教育（2026-09-29，由原本手寫在 `zhu-jiahua-app.json` 的 `legalEducation.themes` 移入）。書內篇的成員列另帶 `textPath`，有校訂全文者主題頁直接連到全文頁。首批四題：教師節、中國工程師學會、哥德四行詩的譯法、中德關係。主題不追求窮盡，收錄範圍寫在 `scope`；書內 198 篇逐篇編主題是持續的工作，驗證器不以覆蓋率為失敗條件。

快照（`related-documents.json`，`schemaVersion` 2）帶 `documents`（各件另帶 `subjects`）、`supplement.order`、`subjects`（成員攤成列：`kind` 為 book 或 supplement、`anchor`、`title`、日期、`where`；另帶 `yearsLabel`）、`retiredUrls` 與 `view`（`subjectsByPiece` 供書內篇頁列出所屬主題）。書內篇的成員列取自 `zhu-jiahua-app.json` 的篇目索引，所以 `build-related.mjs` 要排在 `build-app-toc.mjs` 之後。

網址錨點改為讀者看得懂的形狀，編號不上網址。書內的篇取原書起頁 `p330`，同一頁起兩篇時第二篇起加序號（`p12-2`；目前是第 12、661、723 頁），由 `build-app-toc.mjs` 寫進篇目索引的 `anchor`，`validate-processed.mjs` 驗它與起頁相符且唯一。書外的件取「年份-短名」（`1942-lanzhou-telegram`），記在 `related_index.json` 的 `anchor`；讀稿的節標錨點跟著改成 `<該件錨點>-h<段>`。錨點上線後不改；舊網址裡的 `#ZJH-NNN`、`#ZJR-NNN` 由前端的對照表接住。

停用的網址登記在 `retired-urls.json`（`from`、`to`、`retiredAt`），worker 以 308 轉、前端路由同樣轉，兩處讀的是同步過去的同一份。首批是五條 `/zhujiahua/case/<slug>`。`validate-related.mjs` 驗落點是現行的主題頁或補編裡的錨點、停用網址不與現行主題頁相撞；停用的網址永不再用作新頁。

### 節標層（2026-09-21）

第 4 件材料第二輪加了節標層。`segmentation.json` 的 `inserts[]` 補回辨讀整條漏掉的節標（`text`、`before`、`page`；`before` 須落在段首，插在那一段之前），`headings[]` 逐條宣告節標的字串與層級（1 至 4）。`build-external-drafts.mjs` 在切件之後找與宣告整段相符的段落，剛好一段才收，寫進讀稿的 `headings[]`（`para`、`level`、`text`、`sourcePage`、`anchor`、`tree`；原刊頁由建置從頁界算好，`anchor` 是正文標題與左欄樹共用的元素 id，`tree` 是左欄樹的一列，前端只加 href），第一條須是 1 級、之後每條最多比前一條深一級。`validate-related.mjs` 驗 `para` 指得到、字串與那一段相同、層級在封閉集合內；宣告過的節標段不列「段末無句讀」待核，別的規則照列。前端 `DraftBody` 把這些段渲染成各級標題，補編左欄樹在該件底下列章節；錨點自 2026-09-29 起是 `<該件錨點>-h<段>`。

年表快照 `years[].groups` 的每一種分組自同日起是 `{ lead?, name }`：人生階段的 `lead` 是起訖年、`name` 是階段名，十年只有 `name`。左欄樹把 `lead` 與 `name` 排成兩行、各自不折。
