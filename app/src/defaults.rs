//! Built-in list of watched pages, seeded into the data file on startup.
use crate::core::validate_url;
use crate::store::{Data, Watch};

pub const FEDERAL: &str = "Federal Government";
pub const RESOURCES: &str = "State & Territory \u{2013} Resources Departments";
pub const PREMIERS: &str = "State Premiers & Ministerial Releases";
pub const PLANNING: &str = "Planning & Industry Bodies";
pub const COMPANIES: &str = "Companies";
pub const EV_NEWS: &str = "EV & Battery News";
pub const ASIA_PRESS: &str = "Korea & Japan Press";
pub const MINING_MEDIA: &str = "Mining & Metals Media";
pub const AU_PRESS: &str = "Australian Press";
pub const TRADE_DATA: &str = "Trade Data & Foreign Governments";
pub const MAGNETS: &str = "Magnets & Rare Earths";
pub const OTHER: &str = "Other";
pub const CATEGORIES: [&str; 12] = [FEDERAL, RESOURCES, PREMIERS, PLANNING, COMPANIES, EV_NEWS, ASIA_PRESS, MINING_MEDIA, AU_PRESS, TRADE_DATA, MAGNETS, OTHER];

/// (stable_id, label, url, category). Never change an id once shipped; add new entries at the end.
pub const DEFAULTS: &[(&str, &str, &str, &str)] = &[
    ("nsw-resources-news", "NSW Resources \u{2013} News", "https://www.resources.nsw.gov.au/news-articles", RESOURCES),
    ("qld-statements-resources-minister", "QLD Statements \u{2013} Resources Minister", "https://statements.qld.gov.au/?Search=True&Text=&FromDate=&ToDate=&t=13&m=279", RESOURCES),
    ("wa-dmpe-announcements", "WA \u{2013} Dept of Mines, Petroleum & Exploration", "https://www.wa.gov.au/government/announcements?organisation=Department%20of%20Mines%2C%20Petroleum%20and%20Exploration", RESOURCES),
    ("vic-resources-news", "VIC Resources \u{2013} News", "https://resources.vic.gov.au/about-us/news", RESOURCES),
    ("sa-energy-mining-news", "SA Energy & Mining \u{2013} News", "https://www.energymining.sa.gov.au/home/news", RESOURCES),
    ("nt-mining-energy-news", "NT Mining & Energy \u{2013} News", "https://dme.nt.gov.au/news", RESOURCES),
    ("tas-mrt-news", "TAS Mineral Resources \u{2013} News", "https://www.mrt.tas.gov.au/news", RESOURCES),
    ("minerals-council-australia", "Minerals Council of Australia", "https://minerals.org.au/", PLANNING),
    ("epbc-public-notices", "EPBC Public Notices", "https://epbcpublicportal.environment.gov.au/all-notices/", FEDERAL),
    ("nsw-ministerial-releases", "NSW Ministerial Releases", "https://www.nsw.gov.au/ministerial-releases", PREMIERS),
    ("vic-premier-media", "VIC Premier \u{2013} Media Centre", "https://www.premier.vic.gov.au/media-centre/", PREMIERS),
    ("wa-media-statements", "WA Media Statements", "https://www.wa.gov.au/government/media-statements?administrations%5B0%5D=Cook%20Labor%20Government", PREMIERS),
    ("qld-ministerial-statements", "QLD Ministerial Statements", "https://statements.qld.gov.au/", PREMIERS),
    ("tas-premier-news", "TAS Premier \u{2013} Latest News", "https://www.premier.tas.gov.au/latest-news", PREMIERS),
    ("sa-premier-media-releases", "SA Premier \u{2013} Media Releases", "https://premier.sa.gov.au/media-releases", PREMIERS),
    ("industry-publications-9", "Industry.gov.au \u{2013} Publications (publisher 9)", "https://www.industry.gov.au/publications?pub-search=&pub-topic=All&pub-category=All&publisher=9&field_date_value=All&items_per_page=10", FEDERAL),
    ("industry-publications-14", "Industry.gov.au \u{2013} Publications (publisher 14)", "https://www.industry.gov.au/publications?pub-search=&pub-topic=All&pub-category=All&publisher=14&field_date_value=All&items_per_page=10", FEDERAL),
    ("industry-publications-3026", "Industry.gov.au \u{2013} Publications (publisher 3026)", "https://www.industry.gov.au/publications?pub-search=&pub-topic=All&pub-category=All&publisher=3026&field_date_value=All&items_per_page=10", FEDERAL),
    ("industry-news-filtered", "Industry.gov.au \u{2013} News (filtered)", "https://www.industry.gov.au/news?news-topic%5B2964%5D=2964&news-topic%5B2957%5D=2957&news-topic%5B2958%5D=2958&news-topic%5B2907%5D=2907&news-topic%5B3056%5D=3056&news-topic%5B4008%5D=4008&news-topic%5B2970%5D=2970&news-topic%5B3310%5D=3310&news-topic%5B3059%5D=3059&news-topic%5B2956%5D=2956&news-topic%5B3058%5D=3058&news-topic%5B3057%5D=3057&news-topic%5B2942%5D=2942&news-topic%5B2941%5D=2941&news-topic%5B3148%5D=3148&news-topic%5B3149%5D=3149&news-topic%5B2943%5D=2943&news-topic%5B2945%5D=2945&news-topic%5B2960%5D=2960&news-topic%5B3069%5D=3069&news-topic%5B2963%5D=2963&news-topic%5B2962%5D=2962&news-topic%5B2940%5D=2940&news-topic%5B3070%5D=3070&news-entity%5B3988%5D=3988&news-entity%5B3%5D=3&news-entity%5B7%5D=7&news-entity%5B9%5D=9&news-entity%5B11%5D=11&news-entity%5B4029%5D=4029&news-entity%5B3139%5D=3139&news-entity%5B3333%5D=3333&news-entity%5B3203%5D=3203&news-entity%5B14%5D=14&field_news_date_value=All", FEDERAL),
    ("nsw-ipc-cases", "NSW Independent Planning Commission \u{2013} Cases", "https://www.ipcn.nsw.gov.au/cases", PLANNING),
    ("export-finance-newsroom", "Export Finance Australia \u{2013} Newsroom", "https://www.exportfinance.gov.au/newsroom/", FEDERAL),
    ("covalent-lithium", "Covalent Lithium", "https://www.covalentlithium.com/news", COMPANIES),
    ("rz-resources", "RZ Resources", "https://rzresources.com/news/", COMPANIES),
    ("graphinex", "Graphinex", "https://graphinex.com.au/", COMPANIES),
    ("hpq-silicon", "HPQ Silicon", "https://hpqsilicon.com/news-and-insights/", COMPANIES),
    ("wim-resource-announcements", "WIM Resource \u{2013} Announcements", "https://wimresource.com.au/media/media-centre/announcements/", COMPANIES),
    ("wyloo", "Wyloo", "https://wyloo.com/news-media/", COMPANIES),
    ("scandium-mining", "Scandium Mining", "https://scandiummining.com/investors/news-releases/", COMPANIES),
    ("gippsland-critical-minerals", "Gippsland Critical Minerals", "https://www.gippslandcriticalminerals.com/news-resources/", COMPANIES),
    ("tronox", "Tronox", "https://www.tronox.com/news-media/", COMPANIES),
    ("m-critical-minerals", "M Critical Minerals", "https://mcriticalminerals.com.au/", COMPANIES),
    ("azure-minerals", "Azure Minerals", "https://azureminerals.com.au/", COMPANIES),
    ("silica-resources", "Silica Resources", "https://silicaresources.com.au/news-and-updates/", COMPANIES),
    ("ae-fuels", "AE Fuels", "https://aefuels.com/news/", COMPANIES),
    ("cobra-announcements", "Cobra \u{2013} Announcements", "https://investors.cobraplc.com/announcements", COMPANIES),
    ("lis-energy", "LIS Energy", "https://www.lis.energy/news-and-resources/", COMPANIES),
    ("aspiring-materials", "Aspiring Materials", "https://www.aspiringmaterials.com/", COMPANIES),
    ("powerplus-energy", "PowerPlus Energy", "https://www.powerplus-energy.com.au/", COMPANIES),
    ("sicona", "Sicona", "https://www.siconabattery.com/", COMPANIES),
    ("electrive", "electrive.com", "https://www.electrive.com/", EV_NEWS),
    ("the-driven", "The Driven", "https://thedriven.io/", EV_NEWS),
    ("electrek", "Electrek", "https://electrek.co/", EV_NEWS),
    ("insideevs", "InsideEVs", "https://insideevs.com/news/", EV_NEWS),
    ("the-ev-report", "The EV Report", "https://theevreport.com/", EV_NEWS),
    ("ev-infrastructure-news", "EV Infrastructure News", "https://www.evinfrastructurenews.com/", EV_NEWS),
    ("energy-storage-news", "Energy-Storage.News", "https://www.energy-storage.news/", EV_NEWS),
    ("benchmark-minerals", "Benchmark Mineral Intelligence", "https://source.benchmarkminerals.com/", EV_NEWS),
    ("abri", "ABRI \u{2013} Battery Recycling & Reuse Industry", "https://www.batteryrecycling.org.au/", EV_NEWS),
    ("ambc", "AMBC", "https://www.ambc.org.au/", EV_NEWS),
    ("ns-energy", "NS Energy", "https://www.nsenergybusiness.com/", EV_NEWS),
    ("korea-herald", "The Korea Herald", "https://www.koreaherald.com/", ASIA_PRESS),
    ("korea-joongang-daily", "Korea JoongAng Daily", "https://www.koreajoongangdaily.com/", ASIA_PRESS),
    ("nikkei-asia", "Nikkei Asia", "https://asia.nikkei.com/", ASIA_PRESS),
    ("maeil-business", "Maeil Business", "https://www.mk.co.kr/", ASIA_PRESS),
    ("pulse-mk", "Pulse (Maeil Business English)", "https://pulse.mk.co.kr/", ASIA_PRESS),
    ("ked-global", "KED Global", "https://www.kedglobal.com/", ASIA_PRESS),
    ("korea-times", "The Korea Times", "https://www.koreatimes.co.kr/", ASIA_PRESS),
    ("businesskorea", "Businesskorea", "https://www.businesskorea.co.kr/", ASIA_PRESS),
    ("the-elec", "THE ELEC", "https://www.thelec.net/", ASIA_PRESS),
    ("seoul-economic-daily", "Seoul Economic Daily", "https://en.sedaily.com/", ASIA_PRESS),
    ("sumitomo-electric", "Sumitomo Electric", "https://sumitomoelectric.com/", MAGNETS),
    ("stockhead", "Stockhead", "https://stockhead.com.au/", MINING_MEDIA),
    ("mining-com", "MINING.COM", "https://www.mining.com/", MINING_MEDIA),
    ("mining-com-au", "Mining.com.au", "https://mining.com.au/", MINING_MEDIA),
    ("australian-mining", "Australian Mining", "https://www.australianmining.com.au/", MINING_MEDIA),
    ("australian-mining-review", "The Australian Mining Review", "https://australianminingreview.com.au/", MINING_MEDIA),
    ("mining-journal", "Mining Journal", "https://www.mining-journal.com/", MINING_MEDIA),
    ("mining-magazine", "Mining Magazine", "https://www.miningmagazine.com/", MINING_MEDIA),
    ("mining-technology", "Mining Technology", "https://www.mining-technology.com/news/", MINING_MEDIA),
    ("mining-monthly", "MiningMonthly.com", "https://www.miningmonthly.com/", MINING_MEDIA),
    ("mining-weekly", "Mining Weekly", "https://www.miningweekly.com/page/international-home", MINING_MEDIA),
    ("northern-miner", "The Northern Miner", "https://www.northernminer.com/", MINING_MEDIA),
    ("global-mining-review", "Global Mining Review", "https://www.globalminingreview.com/", MINING_MEDIA),
    ("international-mining", "International Mining", "https://im-mining.com/", MINING_MEDIA),
    ("fastmarkets-battery", "Fastmarkets \u{2013} Battery Raw Materials", "https://www.fastmarkets.com/metals-and-mining/battery-raw-materials/", MINING_MEDIA),
    ("fastmarkets-metals", "Fastmarkets \u{2013} Metals & Mining", "https://www.fastmarkets.com/metals-and-mining/", MINING_MEDIA),
    ("australian-manufacturing", "Australian Manufacturing", "https://www.australianmanufacturing.com.au/", MINING_MEDIA),
    ("australian-resources-investment", "Australian Resources & Investment", "https://www.australianresources.com.au/", MINING_MEDIA),
    ("rare-earth-exchanges", "Rare Earth Exchanges", "https://rareearthexchanges.com/", MINING_MEDIA),
    ("10jqka", "同花顺财经 (10jqka)", "https://news.10jqka.com.cn/", MINING_MEDIA),
    ("smm-cn", "上海有色网 (SMM)", "https://news.smm.cn/", MINING_MEDIA),
    ("alcircle", "AlCircle \u{2013} A Virtual Aluminium Ecosystem", "https://www.alcircle.com/news", MINING_MEDIA),
    ("the-australian", "The Australian", "https://www.theaustralian.com.au/", AU_PRESS),
    ("the-west-australian", "The West Australian", "https://thewest.com.au/", AU_PRESS),
    ("abc-news", "ABC News", "https://www.abc.net.au/", AU_PRESS),
    ("afr", "The Australian Financial Review", "https://www.afr.com/", AU_PRESS),
    ("afr-markets-live", "AFR \u{2013} Markets", "https://www.afr.com/markets", AU_PRESS),
    ("global-trade-alert", "Global Trade Alert", "https://globaltradealert.org/", TRADE_DATA),
    ("manufacturing-pmi", "Manufacturing PMI \u{2013} Countries (Trading Economics)", "https://tradingeconomics.com/country-list/manufacturing-pmi", TRADE_DATA),
    ("imf-data", "IMF Data", "https://data.imf.org/", TRADE_DATA),
    ("china-customs-stats", "海关统计数据查询平台 (China Customs statistics)", "http://stats.customs.gov.cn/", TRADE_DATA),
    ("cnesa", "CNESA (中关村储能产业技术联盟)", "https://www.cnesa.org/", TRADE_DATA),
    ("china-single-window", "中国国际贸易单一窗口", "https://www.singlewindow.cn/", TRADE_DATA),
    ("modern-slavery-register", "Modern Slavery Statements Register", "https://modernslaveryregister.gov.au/", TRADE_DATA),
    ("cccmc-stats", "CCCMC (中国五矿化工进出口商会)", "https://www.cccmc.org.cn/", TRADE_DATA),
    ("customs-stats-news", "统计快讯 (China Customs)", "http://www.customs.gov.cn/customs/302249/zfxxgk/2799825/302274/302275/index.html", TRADE_DATA),
    ("customs-latest-docs", "最新文件 (China Customs)", "http://www.customs.gov.cn/customs/302249/302266/302267/index.html", TRADE_DATA),
    ("japangov-news", "JapanGov \u{2013} The Government of Japan", "https://www.japan.go.jp/", TRADE_DATA),
    ("jetro-biznews", "JETRO ビジネス短信 \u{2013} 過去記事一覧", "https://www.jetro.go.jp/biznewstop/", TRADE_DATA),
    ("meti-news-en", "METI \u{2013} News Releases", "https://www.meti.go.jp/english/press/index.html", TRADE_DATA),
    ("meti-news-ja", "METI \u{2013} ニュースリリース", "https://www.meti.go.jp/press/index.html", TRADE_DATA),
    ("moef-en", "SK Ministry of Finance and Economy", "https://english.mofe.go.kr/", TRADE_DATA),
    ("moef-ko", "재정경제부 \u{2013} 보도참고자료", "https://mofe.go.kr/nw/nes/nesdta.do", TRADE_DATA),
    ("msit-press", "과학기술정보통신부 \u{2013} Press Releases", "https://www.msit.go.kr/eng/bbs/list.do?sCode=eng&mId=4&mPid=2", TRADE_DATA),
    ("magnetics-magazine", "Magnetics Magazine", "https://magneticsmag.com/", MAGNETS),
    ("posco-group", "POSCO Group \u{2013} Newsroom", "https://newsroom.posco.com/en/", MAGNETS),
    ("proterial", "Proterial \u{2013} News", "https://www.proterial.com/e/press/", MAGNETS),
    ("noveon-magnetics", "Noveon Magnetics", "https://noveon.co/news", MAGNETS),
    ("js-link", "JS Link", "https://www.jslink.co.kr/", MAGNETS),
    ("vulcan-elements", "Vulcan Elements", "https://vulcanelements.com/", MAGNETS),
    ("usa-rare-earth", "USA Rare Earth \u{2013} News", "https://investors.usare.com/news-events/press-releases", MAGNETS),
    ("shin-etsu", "Shin-Etsu Chemical \u{2013} News", "https://www.shinetsu.co.jp/en/news/", MAGNETS),
    ("neo-performance", "Neo Performance Materials \u{2013} News", "https://www.neomaterials.com/news/", MAGNETS),
    ("magnequench", "Magnequench", "https://mqitechnology.com/", MAGNETS),
    ("sojitz", "Sojitz \u{2013} News", "https://www.sojitz.com/en/news/", MAGNETS),
    ("sumitomo-metal-mining", "Sumitomo Metal Mining \u{2013} News", "https://www.smm.co.jp/en/news/", MAGNETS),
    ("intl-magnaproducts", "International Magnaproducts", "https://www.intlmag.com/", MAGNETS),
    ("less-common-metals", "Less Common Metals", "https://lesscommonmetals.com/news/", MAGNETS),
    ("saskatchewan-research-council", "Saskatchewan Research Council \u{2013} News", "https://www.src.sk.ca/news", MAGNETS),
    ("solvay", "Solvay \u{2013} News & press releases", "https://www.solvay.com/en/newsroom/news-and-press-releases", MAGNETS),
    ("china-star-group", "China Star Group Industry", "https://www.chinastargroup.com/en", MAGNETS),
    ("tdk", "TDK \u{2013} News", "https://www.tdk.com/en/news_center/press/index.html", MAGNETS),
    ("vac", "VAC (Vacuumschmelze)", "https://vacuumschmelze.com/", MAGNETS),
    ("gkn-powder-metallurgy", "GKN Powder Metallurgy", "https://www.gknpm.com/", MAGNETS),
    ("jogmec-news", "JOGMEC \u{2013} News Releases", "https://www.jogmec.go.jp/english/news/release/index.html", MAGNETS),
    ("magneti-ljubljana", "Magneti Ljubljana", "https://www.magneti.si/en/", MAGNETS),
];

/// Add every default whose id has not been seeded before. Returns the ids of watches added.
/// Ids are recorded even when skipped for a duplicate URL, so removed defaults never come back.
pub fn seed(data: &mut Data, now: &str) -> Vec<String> {
    seed_from(DEFAULTS, data, now)
}

/// Forget what was seeded, then seed again (the "Reset to built-in list" button).
pub fn reset(data: &mut Data, now: &str) -> Vec<String> {
    data.seeded_defaults.clear();
    seed(data, now)
}

pub fn seed_from(list: &[(&str, &str, &str, &str)], data: &mut Data, now: &str) -> Vec<String> {
    let mut added = Vec::new();
    for (id, label, url, category) in list {
        if let Some(w) = data.watches.iter_mut().find(|w| w.id == *id && w.category.is_empty()) {
            w.category = (*category).to_string(); // backfill for data saved before categories existed
        }
        if data.seeded_defaults.iter().any(|s| s == id) {
            continue;
        }
        data.seeded_defaults.push((*id).to_string());
        let Ok(u) = validate_url(url) else { continue };
        let url = u.to_string();
        if data.watches.iter().any(|w| w.id == *id || w.url == url) {
            continue;
        }
        data.watches.push(Watch {
            id: (*id).to_string(),
            url,
            label: (*label).to_string(),
            selector: String::new(),
            documents_only: false,
            category: (*category).to_string(),
            created_at: now.to_string(),
        });
        added.push((*id).to_string());
    }
    added
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn defaults_are_valid_and_unique() {
        let mut ids = HashSet::new();
        let mut urls = HashSet::new();
        for (id, label, url, category) in DEFAULTS {
            assert!(ids.insert(*id), "dup id {id}");
            assert!(!label.is_empty() && CATEGORIES.contains(category));
            let u = validate_url(url).unwrap_or_else(|e| panic!("{url}: {e}"));
            assert!(urls.insert(u.to_string()), "dup url {url}");
            assert!(u.fragment().is_none() && !url.contains("_gl=") && !url.contains("__cf_chl"));
        }
        assert!(DEFAULTS.iter().any(|d| d.2.contains("publisher=3026&field_date")));
    }

    #[test]
    fn category_counts_and_backfill() {
        let n = |c: &str| DEFAULTS.iter().filter(|d| d.3 == c).count();
        assert_eq!((n(FEDERAL), n(RESOURCES), n(PREMIERS), n(PLANNING), n(COMPANIES)), (6, 7, 6, 2, 18));
        let mut d = Data::default();
        seed(&mut d, "t");
        d.watches[0].category.clear();
        seed(&mut d, "t");
        assert_eq!(d.watches[0].category, RESOURCES);
    }

    #[test]
    fn seeds_once_and_removed_defaults_stay_removed() {
        let mut d = Data::default();
        let added = seed(&mut d, "t");
        assert_eq!(added.len(), DEFAULTS.len());
        assert_eq!(d.watches.len(), DEFAULTS.len());
        assert_eq!(d.seeded_defaults.len(), DEFAULTS.len());
        // user removes one, app restarts
        let gone = d.watches.remove(3).id;
        assert!(seed(&mut d, "t2").is_empty());
        assert!(!d.watches.iter().any(|w| w.id == gone));
        // reset brings it back
        assert_eq!(reset(&mut d, "t3"), vec![gone]);
        assert_eq!(d.watches.len(), DEFAULTS.len());
    }

    #[test]
    fn new_defaults_reach_existing_users_and_urls_are_deduped() {
        let list = [("a", "A", "https://a.org/x", OTHER), ("b", "B", "https://b.org/y", OTHER)];
        let mut d = Data::default();
        // user already watches a.org/x under their own id
        d.watches.push(Watch { id: "mine".into(), url: "https://a.org/x".into(), label: "mine".into(), selector: String::new(), documents_only: false, category: String::new(), created_at: "t".into() });
        d.seeded_defaults = vec![];
        assert_eq!(seed_from(&list[..1], &mut d, "t"), Vec::<String>::new());
        assert_eq!(d.watches.len(), 1);
        assert_eq!(d.seeded_defaults, vec!["a"]);
        // a later release adds "b": appears; "a" is not retried
        assert_eq!(seed_from(&list, &mut d, "t"), vec!["b"]);
        assert_eq!(d.watches.len(), 2);
        assert_eq!(d.watches[1].id, "b");
    }
}
