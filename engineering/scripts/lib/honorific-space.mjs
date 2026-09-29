// 原書在敬稱之前空一格（挪抬）：「六十年來中國教育與　蔣主席」「簽呈　總裁報告⋯」「尤其是　中山先生」。
// 站主 2026-09-29：「我這站就不要頂格了」。母本（toc_index.json、transcriptions/*.md、辨讀底稿）照原書留著，
// 產生站上用的產物時由這支拿掉；validate-processed.mjs 驗產物裡沒有殘留，凡例「原書的排字」一節寫明。
//
// 只拿敬稱前的全形空格。全形空格在本書另有用途：目次的空月（民國二十年　月）、年表的「1912　民國元年」、
// 章節編號「二　何謂組織」，都不動。

export const HONORIFIC_SPACE = /[　 ]+(?=蔣|總裁|主席|國父|總理|委員長|中山先生|先總統|元首)/g

export const dropHonorificSpace = (s) => (typeof s === 'string' ? s.replace(HONORIFIC_SPACE, '') : s)
