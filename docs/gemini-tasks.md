# Research tasks for Gemini

Paste ONE task at a time into Gemini (with Google Search turned on), then paste
Gemini's answer back to Claude. Claude tests every URL before anything goes
into the scanner, so wrong answers are caught, but please ask Gemini to say
"NOT FOUND" rather than guess.

Every task asks for the answer as a table inside a code block, so it can be
pasted back exactly.

---

## Task 1 — RSS/Atom feeds for sites the scanner can't read

```text
You are helping configure a website-change monitor. For each site below, use
Google Search and the site itself to find an official RSS or Atom feed for its
news / media releases / announcements (look for "RSS", "feed", "subscribe",
/feed, /rss, /rss.xml, <link rel="alternate" type="application/rss+xml">).
Only list feeds published by the site itself. Do not guess URLs: if you
cannot confirm a feed exists, write NOT FOUND.

Answer ONLY with a code block containing a tab-separated table with these
columns: site_name, feed_url, how_confirmed (e.g. "linked on news page",
"found via search result", "NOT FOUND").

Sites:
VIC Resources – News | https://resources.vic.gov.au/about-us/news
SA Energy & Mining – News | https://www.energymining.sa.gov.au/home/news
NT Mining & Energy – News | https://dme.nt.gov.au/news
TAS Mineral Resources – News | https://www.mrt.tas.gov.au/news
TAS Premier – Latest News | https://www.premier.tas.gov.au/latest-news
SA Premier – Media Releases | https://premier.sa.gov.au/media-releases
Scandium International Mining | https://scandiummining.com/investors/news-releases/
Azure Minerals | https://azureminerals.com.au/
Cobra Resources – Announcements | https://investors.cobraplc.com/announcements
The EV Report | https://theevreport.com/
Energy-Storage.News | https://www.energy-storage.news/
NS Energy | https://www.nsenergybusiness.com/
Mining.com.au | https://mining.com.au/
Mining Journal | https://www.mining-journal.com/
Mining Magazine | https://www.miningmagazine.com/
Mining Technology | https://www.mining-technology.com/news/
MiningMonthly.com | https://www.miningmonthly.com/
Mining Weekly | https://www.miningweekly.com/
Australian Resources & Investment | https://www.australianresources.com.au/
同花顺财经 (10jqka) | https://news.10jqka.com.cn/
The Australian | https://www.theaustralian.com.au/
Korea Ministry of Economy and Finance – press | https://mofe.go.kr/nw/nes/nesdta.do
POSCO Group – Newsroom | https://newsroom.posco.com/en/
Proterial – News | https://www.proterial.com/e/press/
USA Rare Earth – News | https://investors.usare.com/news-events/press-releases
Magnequench | https://mqitechnology.com/
Saskatchewan Research Council – News | https://www.src.sk.ca/news
Solvay – Press releases | https://www.solvay.com/en/newsroom/news-and-press-releases
TDK – News | https://www.tdk.com/en/news_center/press/index.html
GKN Powder Metallurgy | https://www.gknpm.com/
JOGMEC – News Releases | https://www.jogmec.go.jp/english/news/release/index.html
Lynas Rare Earths | https://lynasrareearths.com/
MP Materials – Investors | https://investors.mpmaterials.com/
Reuters – Commodities | https://www.reuters.com/markets/commodities/
S&P Global Commodity Insights | https://www.spglobal.com/commodity-insights/en/news-research/latest-news
Financial Times – Commodities | https://www.ft.com/commodities
Wall Street Journal – Commodities | https://www.wsj.com/finance/commodities-futures
China MOFCOM (English) | https://english.mofcom.gov.cn/
China Ministry of Natural Resources | https://www.mnr.gov.cn/dt/
Indonesia ESDM – News | https://www.esdm.go.id/en/media-center/news-archives
Philippines DENR – Press releases | https://denr.gov.ph/news-events/press-releases/
Philippines Mines and Geosciences Bureau | https://mgb.gov.ph/
Shenzhen Stock Exchange – Announcements | https://www.szse.cn/disclosure/listed/notice/index.html
IDX (Indonesia Stock Exchange) – News | https://www.idx.co.id/en/news/news
Bursa Malaysia – Company announcements | https://www.bursamalaysia.com/market_information/announcements/company_announcement
Magneti Ljubljana | https://www.magneti.si/en/
```

---

## Task 2 — Exact URLs for bookmarks Claude couldn't identify

```text
Find the official website URL — ideally the news / announcements page — for
each organisation below. Use Google Search. If several organisations share the
name, list the one most relevant to critical minerals, batteries, rare earths
or magnets, and say why. Do not guess: write NOT FOUND if unsure.

Answer ONLY with a code block containing a tab-separated table with columns:
name, best_url (news/announcements page if one exists), homepage_url,
confidence (high/medium/low), note.

1. M Battery Minerals (Australia; related to M Critical Minerals, mcriticalminerals.com.au)
2. EV Pulse (Australian electric-vehicle news site)
3. Fleet EV News (electric fleet news site)
4. Pilbara Ports – "Port statistics and reports" page (Western Australia)
5. 虔东集团 (Qiandong Group, Ganzhou, China — rare earths; NOT the casting company at qiandong.com)
6. "China economic database" (a bookmarked data website; likely CEIC or similar)
7. "数据统计" (a Chinese statistics page; candidates include National Bureau of Statistics data.stats.gov.cn or an industry association statistics page related to rare earths, nonferrous metals or batteries)
8. STAR GROUP IND.CO.,LTD (China; possibly the same company as China Star Group Industry, chinastargroup.com — confirm or deny)
9. JL MAG Rare-Earth Co., Ltd. (HKEX stock code 06680) — the HKEXnews page listing its announcements, and its investor relations page
```

---

## Task 3 — News pages for sites currently watched at their homepage

```text
For each company or organisation below, find the URL of its official news /
press releases / announcements LIST page (the page that lists new releases,
newest first). Use Google Search and the site's own navigation. Do not guess:
write NOT FOUND if you cannot confirm the page exists.

Answer ONLY with a code block containing a tab-separated table with columns:
name, news_page_url, how_confirmed.

Adamas Intelligence | https://www.adamasintel.com/
Wood Mackenzie | https://www.woodmac.com/
Lynas Rare Earths (ASX announcements list) | https://lynasrareearths.com/
MP Materials (press releases list) | https://investors.mpmaterials.com/
Sumitomo Electric (news releases) | https://sumitomoelectric.com/
JapanGov – The Government of Japan (news) | https://www.japan.go.jp/
CCCMC 中国五矿化工进出口商会 (statistics / 统计分析 section) | https://www.cccmc.org.cn/
Vulcan Elements | https://vulcanelements.com/
VAC Vacuumschmelze | https://vacuumschmelze.com/
GKN Powder Metallurgy | https://www.gknpm.com/
TWSE Taiwan Stock Exchange (English news) | https://www.twse.com.tw/en/
Azure Minerals (acquired 2024 — is the site still updated? where are its announcements now?) | https://azureminerals.com.au/
M Critical Minerals | https://mcriticalminerals.com.au/
Graphinex | https://graphinex.com.au/
Magnequench / Neo Performance Materials magnetics | https://mqitechnology.com/
Korea Ministry of Economy and Finance (English press releases) | https://english.mofe.go.kr/
India Ministry of Mines (press releases) | https://mines.gov.in/
National Critical Minerals Mission (India) | (find official site)
Pilbara Ports | https://www.pilbaraports.com.au/
```

---

## Task 4 — Check Chinese, Korean and Japanese company names

```text
These are the local-language names a news scanner uses to recognise
companies in Chinese, Korean and Japanese headlines. For each, confirm whether
the local name is correct and commonly used in news, give a better or
additional commonly used name if there is one (e.g. short form used in
headlines), and fill in names that are missing (marked "—").

Answer ONLY with a code block containing a tab-separated table with columns:
english_name, current_local_name, correct (yes/no/partly), suggested_names
(separated by " | "), note.

CATL | 宁德时代
BYD | 比亚迪
EVE Energy | 亿纬锂能
Gotion | 国轩高科
CNGR | 中伟股份
Ronbay | 容百科技
GEM | 格林美
Huayou Cobalt | 华友钴业
Tsingshan | 青山控股
CMOC | 洛阳钼业
Jinchuan | 金川集团
China Rare Earth Group | 中国稀土集团
Northern Rare Earth | 北方稀土
JL MAG Rare-Earth | 金力永磁
Beijing Zhong Ke San Huan | 中科三环
Ningbo Yunsheng | 宁波韵升
Xiamen Tungsten | 厦门钨业
Minmetals Rare Earth | 五矿稀土
China Southern Rare Earth Group | 中国南方稀土
Innuovo Technology | 英洛华
Zhenghai Magnetic Materials | 正海磁材
Earth-Panda Advanced Magnetic Material | 大地熊
China Star Group Industry | —
LG Energy Solution | LG에너지솔루션
Samsung SDI | 삼성SDI
SK On | SK온
POSCO Future M | 포스코퓨처엠
EcoPro BM | 에코프로비엠
EcoPro Innovation | —
L&F | —
LG Chem | LG화학
Cosmo Advanced Materials | —
Korea Zinc | 고려아연
Solus Advanced Materials | —
Iljin Materials | —
Doosan Enerbility | —
Hyosung Heavy Industries | —
LS Cable & System | LS전선
LS MnM | —
LS Eco Energy | —
LS Electric | —
JS Link | JS링크
Sumitomo Metal Mining | 住友金属鉱山
Sumitomo Electric | 住友電気工業
JX Advanced Metals | JX金属
Mitsubishi Materials | 三菱マテリアル
Sojitz | —
Marubeni | —
Itochu | —
Mitsui | —
Proterial | —
Shin-Etsu Chemical | 信越化学
```

---

## Task 5 — Keywords in more Asian languages

```text
A news scanner flags headlines about critical minerals using keywords. It
already has English, Chinese, Korean and Japanese terms. Translate the terms
below into the words actually used in news headlines in: Indonesian,
Vietnamese, Thai, Malay and Hindi. Give the most common headline form, plus
one common variant if there is one. Do not add explanations.

Answer ONLY with a code block containing a tab-separated table with columns:
english, indonesian, vietnamese, thai, malay, hindi (use " | " between a term
and its variant).

rare earths
permanent magnet
nickel
nickel ore
nickel smelter
lithium
cobalt
graphite
bauxite
tin
copper
battery
electric vehicle battery
critical minerals
export ban
export controls
export licence
mining licence
smelter
downstreaming / mineral processing
strategic reserve
mining permit quota (e.g. Indonesia RKAB)
```
