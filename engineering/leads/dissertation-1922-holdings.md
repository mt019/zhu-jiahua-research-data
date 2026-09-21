# 朱家驊 1922 年柏林博士論文的現存印本（線索，2026-09-21 站主交辦，未查）

站主 2026-09-21 貼來另一個模型的查核回覆，要求查核其中的說法。原文照錄如下，未動一字；
其中的書目、頁碼、館藏推測都尚未經本倉核對。

> 我重新往「實體館藏」方向查了一輪，目前能確定的是：我還不能負責任地指出「現存原本就在某某館、索書號為某某」。上一則如果讓你感覺我已經定位到 Humboldt 大學館藏，那說得太快了。
>
> 現在能確定的原始書目是：
>
> Chu, Chia-Hua（朱家驊）
> Untersuchungen im Kimmeridge des Langenbergs bei Oker am Harz.
> Berlin, 1922. 94 S., Taf.
> Dissertation, Berlin, Philosophische Fakultät.
>
> 專門收錄中國留歐博士論文的歷史書目明確著錄這一筆，而且記載其摘要收入 Jahrbuch der Dissertationen der Philosophischen Fakultät Berlin 1922–1923, pp. 37–41。中研院資料也獨立確認朱家驊於 1922 年取得柏林大學哲學博士。
>
> 但這裡有一個很重要的歷史館藏問題。1922 年德國博士論文通常不是今天意義上的「唯一一本原稿」：取得博士學位時往往需要提交並印製一定數量的 Dissertationsexemplare / Pflichtexemplare，因此當年很可能存在多份正式印刷本，分送大學、圖書館或交換機構。現在問「紙本原本在哪」，實際上要分成兩個問題：一是柏林大學當年接收的學位論文存檔本今天流到哪裡；二是全球現在哪些圖書館還保存 1922 年印刷本。
>
> 我目前公開網頁檢索沒有找到這本論文的現代 OPAC 館藏記錄；Google 類搜尋反覆只回到那份歷史博士論文書目。這表示不能直接推定它現在就在 Humboldt-Universität 圖書館。當年的 Friedrich-Wilhelms-Universität 確實是今天 Humboldt-Universität 的前身，但二戰、柏林館藏遷移與戰後機構重組都可能影響 1922 年 dissertation 的保存位置。
>
> 有一條很值得你注意的臺灣線索：1977 年中央研究院近代史研究所出版的《朱家驊先生言論集》，日本 CiNii 的書目竟然把它的其他題名著錄為 "Dissertations of Dr. Chu Chia-Hua"。這未必表示書中收錄了他的德文博士論文，但值得直接檢查《言論集》的目錄與朱家驊檔案。因為朱家驊本人後來長期主持中央研究院，他的私人文件、著作留存與德國學位資料在臺灣可能另有一條傳承鏈。
>
> 所以如果你的問題是：「我想親眼看到朱家驊 1922 年博士論文的那一本實體紙本，現在究竟放在哪個書庫？」那還需要再做一層真正的德國聯合目錄／歷史館藏追蹤。我會特別查 K10plus、StaBi Berlin、HU Universitätsbibliothek 的 Altbestand，以及 Karlsruhe Virtueller Katalog (KVK)；必要時還要用德文舊拼法和作者異名查。這比一般 Google 搜尋可靠得多。
>
> 我可以接著把這條線查到底，找出具體館名、館藏號（Signatur）、是否可閱覽／複印。這樣你如果之後去德國，甚至可以直接調原件。

## 要核的項目

1. 書目本身：題名、頁數、圖版數、學院、年份。查 DNB（德國國家圖書館）目錄、K10plus／GVK、KVK 聯合查詢、
   HU Berlin 的 Primus 與 Universitätsarchiv；作者異名試 Chu Chia-hua、Tschu Kia-hua、Chu Chia Hua。
   「Jahrbuch der Dissertationen der Philosophischen Fakultät Berlin 1922–1923, pp. 37–41」這一筆要找到那份
   Jahrbuch 的數位版或館藏頁核對頁碼。
2. 該筆「專門收錄中國留歐博士論文的歷史書目」是哪一種：對方沒有給書名。候選是袁同禮
   《A Guide to Doctoral Dissertations by Chinese Students in Continental Europe, 1907–1962》（1964），本機
   先 `find ~/Documents -iname "*Yuan*Doctoral*"`，再查 HathiTrust。
3. 現存印本：DNB 法蘭克福與萊比錫兩館、StaBi Berlin、HU 圖書館 Altbestand、Universitätsarchiv der HU 的
   Promotionsakte（學位檔案，含審查意見，與印本是兩件事）、哥廷根與克勞斯塔爾（Harz 地質題材的地方館藏）。
4. 臺灣一側：CiNii 對《朱家驊先生言論集》著錄「Dissertations of Dr. Chu Chia-Hua」這一筆先開 CiNii 頁面核原文；
   本倉的《言論集》前置目次 40 頁（`data/materials/toc/`）查有沒有收德文論文；中研院近史所檔案館朱家驊檔案的目錄。
5. 年表 1922 年的年目正文寫了什麼，與查得的書目對照；查得之後在 `data/derived/leads.json` 開一條 LEAD，
   來源登記走 `sources.json`，原件或影像照 `archive-raw-sources` 落 `sources/raw/`。

對方文中「中研院資料也獨立確認」「歷史書目明確著錄」都沒有給出處，查核時一律回原件，不引用這段話本身。
