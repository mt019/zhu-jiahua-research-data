# 外部網頁留痕

一件一節，記檔名、完整網址、抓取時間、這是什麼。原始 HTML 與純文字不進版控
（`.gitignore` 擋 `data/raw/web/*`），本檔進版控。

`leads/` 底下是線索用的頁面：內容作查證的起點，不作出處。用它的線索編號、以及下一步要回
哪裡取一手材料，記在 `data/derived/leads.json`。

## `leads/wechat-xu-zhimo-yishi-wenti.html`

微信公眾號「學術與社會」〈問學 | 徐志摩：一個譯詩問題〉。
https://mp.weixin.qq.com/s/bEtnBULRitswdfZXW3r-IA ，2026-08-31 抓取，HTTP 200，
純文字 6,378 字（`.txt` 同名）。

轉錄哥德四行詩論爭的三篇：徐志摩〈一個譯詩問題〉、朱家驊〈關於一個譯詩問題的批評〉、
李競何〈關於哥德四行詩問題的商榷〉，各篇文末記出刊日為《現代評論》第二卷第三十八期
（民國十四年八月二十九日）、第四十三期（十月三日）、第五十期（十一月二十一日）。
三個日期都出自這份轉錄，未經原刊核。對應 LEAD-001 與 LEAD-002。

## `leads/wechat-shen-wenwei-tietong.html`

微信公眾號〈燈籠·玻璃杯（第一季 十一）〉。
https://mp.weixin.qq.com/s/nvWmN0RF0jmEewp_QYfvJA ，2026-08-31 抓取，HTTP 200，
純文字 13,017 字。

記沙文威事蹟，稱塞克特「鐵桶計劃」的德文原件由蔣介石交朱家驊譯成中文、沙孟海潤色。
一手材料未取，這一項不進任何公開面。對應 LEAD-003。

## `leads/wechat-zhu-jiahua-muzhiming.html`

微信公眾號〈識文斷字丨朱家驊墓誌銘并序〉，書寫者陸翰芹。
https://mp.weixin.qq.com/s/LvfIQBt4ydvAV3uvJmDr4g ，2026-08-31 抓取，HTTP 200，
純文字 6,428 字。

頁內的生平紀事可與年表逐條對核；墓誌銘原石或拓片的所在與撰者未查。對應 LEAD-006。

## `leads/wechat-chen-bulei-xu-foguan.html`

微信公眾號〈陳布雷日記中的「徐佛觀」：軍人能有如此之政治識解，我輩真應愧煞〉。
https://mp.weixin.qq.com/s/AxQG_tdfSHtZv8WOxbZNQg ，2026-08-31 抓取，HTTP 200，
純文字 21,089 字（`.txt` 同名）。

全文檢索「朱家驊」「朱家骅」皆為零。與本倉的關聯待站主說明，見 LEAD-008。

## `leads/jacar-C13050247000-目錄詳細-截圖.jpg`

日本亞洲歷史資料中心（JACAR）C13050247000 的目錄詳細頁截圖，2538×1239，站主 2026-08-31 提供。
件名、請求番號、所屬卷冊、資料作成年月日與內容摘要都在這一頁，原件 PDF 收在
`data/raw/articles/工程學會祝電_日本陸軍放送記錄_JACAR-C13050247000_1942.pdf`。

## `leads/jacar-C13050247000-目錄詳細-2026.html`

日本亞洲歷史資料中心（JACAR）C13050247000 的目錄詳細頁。
https://www.jacar.archives.go.jp/das/meta/C13050247000 ，2026-09-11 抓取，HTTP 200，
純文字 107 行（`.txt` 同名）。

件名標題、請求番號、所屬卷冊、資料作成年月日與作成者在這一頁，「內容」欄是 JACAR 對這兩頁的
翻刻全文，用新字體。原件 PDF 收在
`data/raw/articles/工程學會祝電_日本陸軍放送記錄_JACAR-C13050247000_1942.pdf`，本文是手寫行草，
辨讀引擎讀不出來；ZJR-008 的讀稿以這一欄為底，逐句對過原頁圖。

## `leads/dissertation-1922-holdings/`

2026-09-21 查朱家驊 1922 年柏林大學博士論文的書目與現存印本，十二份頁面連同純文字收在這個子目錄，
子目錄的 `index.md` 一件一列記檔名、網址、抓取時間、狀態碼。兩份目錄記錄核出論文本身未印行：
德國國家圖書館 https://d-nb.info/363911103 著錄「Ausz. in: Jahrbuch d. Diss. d. Phil. Fak. Berlin.
1922-23. I.- Dass. [Maschinenschrift] 94 S. m. Taf. 4」，K10plus PPN 617626693 著錄「Auszug aus
nichtgedruckter Dissertation」，並記作者「geboren 15.5.1893 zu Huchowfu, Chekiang」。印出來的只有
年鑑 1922/23 卷（1925 年出版）第 37 至 41 頁的摘要；年鑑的紙本館藏見 ZDB idn 013079654，線上版
由德國國家圖書館 2021 年數位化而只在萊比錫閱覽室的電腦上開放。HathiTrust 五次都回 403 的驗證頁，
Google Books API 當日額度已盡，DigiZeitschriften 2025 年底停止服務，三處未取到結果。CiNii
BA52896374 的其他題名「Dissertations of Dr. Chu Chia-Hua」抄自《言論集》PDF 第 786 頁的英文書名頁。
線索編號 LEAD-010。

## `teachers-day-dates/`

2026-09-29，教師節兩篇（ZJH-080、ZJH-083）的日期查核。`gazette/` 是政府公報資訊網的七件逐則 PDF 與 `transcriptions.md` 逐字抄錄；`bksy/` 是全國報刊索引的六篇 PDF、辨讀稿與 `bksy-records.json`（網址、位元組數、SHA256）；`archives/` 是國史館與近史所檔案館的檢索頁與詳目頁，`index.md` 一件一列記網址、抓取時間、狀態與 SHA256。結論在 `data/derived/date-checks.json`。
