# 公開資料契約

`data/processed/zhu-jiahua-app.json` 是唯一可同步到前端的資料檔。

必要頂層欄位：

- `schemaVersion`、`generatedAt`
- `source`：可公開書目與權利邊界，不含本機路徑
- `project`：標題、階段與研究焦點
- `materialCoverage`：頁數、文字層、OCR、目錄與公開全文狀態
- `materialSegments`：經原頁抽樣確認的 PDF 區段、頁數與處理方式
- `contentProgress`：已定位篇數、全文校訂數與目前核對範圍
- `legalEducation`：法律教育篇群的導讀、六篇篇目與讀者可見狀態
- `catalogPreview`：已由原頁核對的篇名、日期、文類與原書頁碼
- `verifiedTexts`：達人工逐字核對門檻、可完整公開的篇章原文
- `initialResults`：只由目前已核頁面支持的初步內容觀察
- `researchQuestions`：目前研究問題
- `methodPlan`：可追溯的處理步驟
- `riskRegister`：材料與推論限制
- `immediateNextWork`：近期工作

狀態必須使用讀者可理解的繁體中文。尚未由原頁核對的內容標示「待核」，不得以前端文案掩飾缺漏。
