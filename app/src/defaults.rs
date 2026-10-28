//! Built-in list of watched pages, seeded into the data file on startup.
use crate::core::validate_url;
use crate::store::{Data, Watch};

pub const FEDERAL: &str = "Federal Government";
pub const RESOURCES: &str = "State & Territory \u{2013} Resources Departments";
pub const PREMIERS: &str = "State Premiers & Ministerial Releases";
pub const PLANNING: &str = "Planning & Industry Bodies";
pub const COMPANIES: &str = "Companies";
pub const OTHER: &str = "Other";
pub const CATEGORIES: [&str; 6] = [FEDERAL, RESOURCES, PREMIERS, PLANNING, COMPANIES, OTHER];

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
        assert_eq!((n(FEDERAL), n(RESOURCES), n(PREMIERS), n(PLANNING), n(COMPANIES)), (6, 7, 6, 2, 16));
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
