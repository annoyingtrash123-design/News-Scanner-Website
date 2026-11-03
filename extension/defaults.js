// Built-in list of watched pages. Ported from app/src/defaults.rs (tests/defaults.test.js keeps them in sync).
// Never change an id once shipped; add new entries at the end.
export const FEDERAL = "Federal Government";
export const RESOURCES = "State & Territory – Resources Departments";
export const PREMIERS = "State Premiers & Ministerial Releases";
export const PLANNING = "Planning & Industry Bodies";
export const COMPANIES = "Companies";
export const OTHER = "Other";
export const CATEGORIES = [FEDERAL, RESOURCES, PREMIERS, PLANNING, COMPANIES, OTHER];

export const DEFAULTS = [
  { id: "nsw-resources-news", label: "NSW Resources – News", url: "https://www.resources.nsw.gov.au/news-articles", category: RESOURCES },
  { id: "qld-statements-resources-minister", label: "QLD Statements – Resources Minister", url: "https://statements.qld.gov.au/?Search=True&Text=&FromDate=&ToDate=&t=13&m=279", category: RESOURCES },
  { id: "wa-dmpe-announcements", label: "WA – Dept of Mines, Petroleum & Exploration", url: "https://www.wa.gov.au/government/announcements?organisation=Department%20of%20Mines%2C%20Petroleum%20and%20Exploration", category: RESOURCES },
  { id: "vic-resources-news", label: "VIC Resources – News", url: "https://resources.vic.gov.au/about-us/news", category: RESOURCES },
  { id: "sa-energy-mining-news", label: "SA Energy & Mining – News", url: "https://www.energymining.sa.gov.au/home/news", category: RESOURCES },
  { id: "nt-mining-energy-news", label: "NT Mining & Energy – News", url: "https://dme.nt.gov.au/news", category: RESOURCES },
  { id: "tas-mrt-news", label: "TAS Mineral Resources – News", url: "https://www.mrt.tas.gov.au/news", category: RESOURCES },
  { id: "minerals-council-australia", label: "Minerals Council of Australia", url: "https://minerals.org.au/", category: PLANNING },
  { id: "epbc-public-notices", label: "EPBC Public Notices", url: "https://epbcpublicportal.environment.gov.au/all-notices/", category: FEDERAL },
  { id: "nsw-ministerial-releases", label: "NSW Ministerial Releases", url: "https://www.nsw.gov.au/ministerial-releases", category: PREMIERS },
  { id: "vic-premier-media", label: "VIC Premier – Media Centre", url: "https://www.premier.vic.gov.au/media-centre/", category: PREMIERS },
  { id: "wa-media-statements", label: "WA Media Statements", url: "https://www.wa.gov.au/government/media-statements?administrations%5B0%5D=Cook%20Labor%20Government", category: PREMIERS },
  { id: "qld-ministerial-statements", label: "QLD Ministerial Statements", url: "https://statements.qld.gov.au/", category: PREMIERS },
  { id: "tas-premier-news", label: "TAS Premier – Latest News", url: "https://www.premier.tas.gov.au/latest-news", category: PREMIERS },
  { id: "sa-premier-media-releases", label: "SA Premier – Media Releases", url: "https://premier.sa.gov.au/media-releases", category: PREMIERS },
  { id: "industry-publications-9", label: "Industry.gov.au – Publications (publisher 9)", url: "https://www.industry.gov.au/publications?pub-search=&pub-topic=All&pub-category=All&publisher=9&field_date_value=All&items_per_page=10", category: FEDERAL },
  { id: "industry-publications-14", label: "Industry.gov.au – Publications (publisher 14)", url: "https://www.industry.gov.au/publications?pub-search=&pub-topic=All&pub-category=All&publisher=14&field_date_value=All&items_per_page=10", category: FEDERAL },
  { id: "industry-publications-3026", label: "Industry.gov.au – Publications (publisher 3026)", url: "https://www.industry.gov.au/publications?pub-search=&pub-topic=All&pub-category=All&publisher=3026&field_date_value=All&items_per_page=10", category: FEDERAL },
  { id: "industry-news-filtered", label: "Industry.gov.au – News (filtered)", url: "https://www.industry.gov.au/news?news-topic%5B2964%5D=2964&news-topic%5B2957%5D=2957&news-topic%5B2958%5D=2958&news-topic%5B2907%5D=2907&news-topic%5B3056%5D=3056&news-topic%5B4008%5D=4008&news-topic%5B2970%5D=2970&news-topic%5B3310%5D=3310&news-topic%5B3059%5D=3059&news-topic%5B2956%5D=2956&news-topic%5B3058%5D=3058&news-topic%5B3057%5D=3057&news-topic%5B2942%5D=2942&news-topic%5B2941%5D=2941&news-topic%5B3148%5D=3148&news-topic%5B3149%5D=3149&news-topic%5B2943%5D=2943&news-topic%5B2945%5D=2945&news-topic%5B2960%5D=2960&news-topic%5B3069%5D=3069&news-topic%5B2963%5D=2963&news-topic%5B2962%5D=2962&news-topic%5B2940%5D=2940&news-topic%5B3070%5D=3070&news-entity%5B3988%5D=3988&news-entity%5B3%5D=3&news-entity%5B7%5D=7&news-entity%5B9%5D=9&news-entity%5B11%5D=11&news-entity%5B4029%5D=4029&news-entity%5B3139%5D=3139&news-entity%5B3333%5D=3333&news-entity%5B3203%5D=3203&news-entity%5B14%5D=14&field_news_date_value=All", category: FEDERAL },
  { id: "nsw-ipc-cases", label: "NSW Independent Planning Commission – Cases", url: "https://www.ipcn.nsw.gov.au/cases", category: PLANNING },
  { id: "export-finance-newsroom", label: "Export Finance Australia – Newsroom", url: "https://www.exportfinance.gov.au/newsroom/", category: FEDERAL },
  { id: "covalent-lithium", label: "Covalent Lithium", url: "https://www.covalentlithium.com/news", category: COMPANIES },
  { id: "rz-resources", label: "RZ Resources", url: "https://rzresources.com/news/", category: COMPANIES },
  { id: "graphinex", label: "Graphinex", url: "https://graphinex.com.au/", category: COMPANIES },
  { id: "hpq-silicon", label: "HPQ Silicon", url: "https://hpqsilicon.com/news-and-insights/", category: COMPANIES },
  { id: "wim-resource-announcements", label: "WIM Resource – Announcements", url: "https://wimresource.com.au/media/media-centre/announcements/", category: COMPANIES },
  { id: "wyloo", label: "Wyloo", url: "https://wyloo.com/news-media/", category: COMPANIES },
  { id: "scandium-mining", label: "Scandium Mining", url: "https://scandiummining.com/investors/news-releases/", category: COMPANIES },
  { id: "gippsland-critical-minerals", label: "Gippsland Critical Minerals", url: "https://www.gippslandcriticalminerals.com/news-resources/", category: COMPANIES },
  { id: "tronox", label: "Tronox", url: "https://www.tronox.com/news-media/", category: COMPANIES },
  { id: "m-critical-minerals", label: "M Critical Minerals", url: "https://mcriticalminerals.com.au/", category: COMPANIES },
  { id: "azure-minerals", label: "Azure Minerals", url: "https://azureminerals.com.au/", category: COMPANIES },
  { id: "silica-resources", label: "Silica Resources", url: "https://silicaresources.com.au/news-and-updates/", category: COMPANIES },
  { id: "ae-fuels", label: "AE Fuels", url: "https://aefuels.com/news/", category: COMPANIES },
  { id: "cobra-announcements", label: "Cobra – Announcements", url: "https://investors.cobraplc.com/announcements", category: COMPANIES },
  { id: "lis-energy", label: "LIS Energy", url: "https://www.lis.energy/news-and-resources/", category: COMPANIES },
  { id: "aspiring-materials", label: "Aspiring Materials", url: "https://www.aspiringmaterials.com/", category: COMPANIES },
];
