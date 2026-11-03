//! Keyword relevance: topic groups, "always elevate" focus terms and the company watchlist,
//! all taken from docs/prompts/asia-critical-minerals-daily-scan.md (plus the 19 Tier 2
//! companies from docs/prompts/daily-scanner-methodology-handover.md).
//!
//! The lists below are mirrored in extension/keywords.js; extension/tests/keywords.test.js parses
//! this file and fails if they differ. Change both together and bump KW_VERSION so stored
//! events are re-scored.
//!
//! Matching rules (identical in the JS port):
//! - Hyphens are treated as spaces ("Rare-Earth" == "rare earth").
//! - ASCII terms match at word boundaries ("tin" does not match "testing"), case-insensitively,
//!   and may carry a plural "s" ("rare earths", "export controls").
//! - Short all-uppercase ASCII terms (up to 6 chars: CAM, GEM, BYD, LFP, NCM, M&A, L&F, VAC...)
//!   match case-sensitively as whole words, so "cam" or "gem" in ordinary prose never fires.
//! - Terms with any non-ASCII character (Chinese, Korean, Japanese) match as substrings.
//!
//! Terms deliberately left out of the brief's keyword universe because they fire constantly on
//! unrelated news: Silicon, Phosphorus, Sodium (alone), Electrolytes, Separators, Safety Incident,
//! Merger, Acquisition, Subsidy, Tax Credit, Earnings, Results, Industrial Production and the
//! Chinese word for inventory (库存). Silicon Carbide and Gallium Nitride are listed once, under
//! Semiconductors, and Strategic Reserve/Stockpile once, under Defence, so one phrase never counts
//! as two topics. Gallium, germanium, antimony, graphite and tungsten are "special focus" terms.
use crate::core::{Doc, Link};
use crate::store::Event;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// Bump when any list or rule above changes.
pub const KW_VERSION: u32 = 1;

pub const TOPICS: &[(&str, &[&str])] = &[
    ("Battery minerals", &["Lithium", "Nickel", "Cobalt", "Manganese", "Graphite", "Natural Graphite", "Synthetic Graphite", "니켈", "石墨"]),
    ("Battery chemicals", &["Lithium Carbonate", "Lithium Hydroxide", "Lithium Metal", "LFP", "LMFP", "NCM", "NCMA", "CAM", "PCAM", "Battery Precursor", "Precursor Cathode Active Material", "Cathode Active Material", "LiPF6", "PVDF", "Conductive Additive", "배터리소재", "전구체"]),
    ("Anodes", &["Graphite Anode", "Natural Graphite Anode", "Synthetic Graphite Anode", "Silicon Anode", "Silicon-Graphite Anode", "Hard Carbon", "Anode Material", "Anode Powder", "음극재", "負極材"]),
    ("Cathodes", &["LFP Cathode", "LMFP Cathode", "NCM Cathode", "NCMA Cathode", "High-Nickel Cathode", "Cathode Powder", "Cathode Material", "양극재", "正極材"]),
    ("Rare earths", &["Rare Earth", "Rare Earth Oxide", "Rare Earth Metal", "Rare Earth Separation", "Rare Earth Refining", "Rare Earth Processing", "Lanthanum", "Cerium", "Praseodymium", "Neodymium", "Samarium", "Europium", "Gadolinium", "Terbium", "Dysprosium", "Holmium", "Erbium", "Thulium", "Ytterbium", "Lutetium", "Scandium", "Yttrium", "稀土", "희토류", "レアアース"]),
    ("Critical minerals", &["Critical Mineral", "Copper", "High Purity Alumina", "Gallium", "Germanium", "Indium", "Antimony", "Tellurium", "Fluorspar", "Vanadium", "Magnesium", "Titanium", "Platinum", "Palladium", "Rhodium", "Ruthenium", "Iridium", "Osmium", "Niobium", "Tantalum", "Hafnium", "Zirconium", "Beryllium", "Bismuth", "Rhenium", "Tungsten", "Tin", "Chromium", "Molybdenum", "Uranium", "Zircon", "镓", "锗", "锑", "钨", "战略矿产", "关键矿产", "重要鉱物"]),
    ("Batteries", &["EV Battery", "Electric Vehicle Battery", "ESS Battery", "Energy Storage Battery", "Battery Manufacturing", "Battery Gigafactory", "Sodium-Ion Battery", "Solid-State Battery", "新能源材料"]),
    ("Magnets", &["Permanent Magnet", "Rare-Earth Magnet", "NdFeB", "Neo Magnet", "Neodymium Magnet", "SmCo", "SmCo Magnet", "Samarium-Cobalt Magnet", "Sintered Magnet", "Bonded Magnet", "Magnet Alloy", "Magnet Powder", "Magnet Recycling", "Traction Motor", "Motor Magnet", "Magnetic Materials", "Permanent Magnet Materials", "Magnet Manufacturing", "EV Motor Magnet", "Wind Turbine Magnet", "Sintered NdFeB", "Bonded NdFeB", "永磁", "稀土永磁", "钕铁硼", "烧结钕铁硼", "钕铁硼磁体", "磁材", "磁性材料", "永磁材料", "영구자석", "희토류 자석", "네오디뮴 자석", "자성재료", "永久磁石", "ネオジム磁石", "焼結磁石", "磁性材料"]),
    ("Semiconductors", &["Semiconductor Material", "Semiconductor Supply Chain", "Advanced Packaging", "AI Chip", "HPC Chip", "Gallium Nitride", "Silicon Carbide", "Advanced Substrate", "Wafer", "Photonics", "Power Electronics"]),
    ("Defence", &["Defence Supply Chain", "Defense Supply Chain", "Military Supply Chain", "Strategic Mineral", "National Security Material", "Military Magnet", "Missile Material", "Aerospace Material", "Strategic Stockpile", "Strategic Reserve", "战略储备", "收储", "전략비축", "비축", "備蓄", "戦略備蓄"]),
    ("Export controls & trade", &["Export Control", "Export Restriction", "Export Ban", "Export Licence", "Export License", "Export Licensing", "Rare Earth Licence", "Rare Earth License", "Rare Earth Licensing", "Rare Earth Quota", "Magnet Export Permit", "Permanent Magnet Permit", "Dual-Use Goods", "Technology Export Control", "Technology Export Restriction", "Technology Transfer Restriction", "Foreign Investment Review", "National Security Review", "End User Certification", "Trade Restriction", "Trade License", "Gallium Exports", "Germanium Exports", "Antimony Exports", "Graphite Exports", "Tungsten Exports", "Rare Earth Exports", "Magnet Exports", "Strategic Materials Exports", "出口管制", "出口许可", "出口许可证", "贸易管制", "수출통제", "수출허가", "희토류 수출", "輸出規制", "輸出許可"]),
    ("Supply disruptions", &["Power Restriction", "Power Rationing", "Electricity Curtailment", "Grid Disruption", "Environmental Inspection", "Mine Accident", "Tailings Incident", "Port Closure", "Port Disruption", "Shipping Disruption", "Logistics Constraint", "Concentrate Shortage", "Feedstock Shortage", "Sulphur Shortage", "Sulphuric Acid Shortage", "Magnet Shortage", "Critical Equipment Shortage"]),
    ("Corporate events", &["Mine Commissioning", "Mine Closure", "Smelter Commissioning", "Smelter Closure", "Refinery Commissioning", "Refinery Closure", "Processing Plant", "Magnet Plant", "Battery Plant", "M&A", "Joint Venture", "Supply Agreement", "Offtake", "Offtake Agreement", "Project Financing", "Strategic Investment", "Government Funding", "Exploration Discovery", "Pilot Plant", "Production Guidance"]),
    ("Customs & trade data", &["Customs Data", "Export Volume", "Import Volume", "Export Statistics", "Import Statistics", "Trade Statistics", "Stockpile", "Inventory Build", "Inventory Release", "海关数据", "出口量", "进口量", "관세청", "수출통계", "輸出実績", "輸入実績", "関税"]),
    ("Macro & policy", &["Manufacturing PMI", "Caixin PMI", "China PMI", "Japan PMI", "Korea PMI", "India PMI", "Economic Security", "Supply Chain Resilience", "Critical Minerals Policy"]),
];

/// "Special focus (always elevate)": any match makes an event High relevance.
pub const FOCUS: &[&str] = &[
    "Chinese Export Controls", "Rare-Earth Export Controls", "Export Controls", "Export Control", "Rare-Earth Licensing", "Rare-Earth Licence", "Rare-Earth License",
    "Rare-Earth Quota", "Permanent Magnet Trade", "Gallium", "Germanium", "Antimony", "Graphite", "Tungsten", "Semiconductor Materials", "Strategic Reserve",
    "Strategic Stockpile", "Strategic Stockpiling", "National Security Actions", "Foreign Investment Restrictions", "Indonesian Nickel Policy", "Philippine Nickel Policy",
    "Japanese Rare-Earth Procurement", "Korean Battery Supply Chains", "Indian Critical Minerals Policy", "Chinese Customs Data",
    "LS Group", "LS Cable & System", "LS MnM", "LS Eco Energy", "LS Electric", "JS Link", "LS전선", "JS링크",
    "出口管制", "镓", "锗", "锑", "钨", "石墨", "수출통제", "輸出規制",
];

/// Company watchlist: (name shown, extra aliases). The name itself is matched too.
pub const COMPANIES: &[(&str, &[&str])] = &[
    // China
    ("CATL", &["宁德时代"]), ("BYD", &["比亚迪"]), ("EVE Energy", &["亿纬锂能"]), ("Gotion", &["国轩高科"]), ("CNGR", &["中伟股份"]),
    ("Ronbay", &["容百科技"]), ("GEM", &["格林美"]), ("Huayou Cobalt", &["Huayou", "华友钴业"]), ("Tsingshan", &["青山控股"]), ("CMOC", &["洛阳钼业"]),
    ("Jinchuan", &["金川集团"]), ("China Rare Earth Group", &["中国稀土集团"]), ("Northern Rare Earth", &["北方稀土"]),
    ("JL MAG", &["JLMAG", "JL MAG Rare-Earth", "JLMAG Rare-Earth", "金力永磁"]),
    ("Beijing Zhong Ke San Huan", &["Zhong Ke San Huan", "中科三环"]), ("Yunsheng", &["宁波韵升"]), ("Xiamen Tungsten", &["厦门钨业"]),
    ("Minmetals Rare Earth", &["五矿稀土"]), ("China Southern Rare Earth Group", &["中国南方稀土"]), ("Innuovo Technology", &["英洛华"]),
    ("Zhenghai Magnetic Materials", &["正海磁材"]), ("Earth-Panda Advanced Magnetic Material", &["Earth-Panda", "大地熊"]), ("China Star Group Industry", &[]),
    // South Korea
    ("LG Energy Solution", &["LGES", "LG에너지솔루션"]), ("Samsung SDI", &["삼성SDI"]), ("SK On", &["SK온"]), ("POSCO Future M", &["포스코퓨처엠"]),
    ("EcoPro BM", &["에코프로비엠"]), ("EcoPro Innovation", &[]), ("L&F", &[]), ("LG Chem", &["LG화학"]), ("Cosmo Advanced Materials", &[]),
    ("Korea Zinc", &["고려아연"]), ("Solus Advanced Materials", &[]), ("Iljin Materials", &[]), ("Doosan Enerbility", &[]), ("Hyosung Heavy Industries", &[]),
    ("LS Group", &[]), ("LS Cable & System", &["LS전선"]), ("LS MnM", &[]), ("LS Eco Energy", &[]), ("LS Electric", &[]), ("JS Link", &["JS링크"]),
    // Japan
    ("Sumitomo Metal Mining", &["住友金属鉱山"]), ("Sumitomo Electric", &["住友電気工業"]), ("JX Advanced Metals", &["JX金属"]),
    ("Mitsubishi Materials", &["三菱マテリアル"]), ("Sojitz", &[]), ("Marubeni", &[]), ("Itochu", &[]), ("Mitsui", &[]), ("JOGMEC", &[]),
    ("Proterial", &[]), ("TDK", &[]), ("Shin-Etsu Chemical", &["Shin-Etsu", "信越化学"]),
    // Indonesia
    ("Merdeka Battery Materials", &[]), ("Vale Indonesia", &[]), ("Aneka Tambang", &["Antam"]), ("Harita", &[]), ("IMIP", &[]), ("IWIP", &[]),
    // India
    ("Vedanta", &[]), ("Hindalco", &[]), ("National Aluminium", &["NALCO"]), ("Coal India", &[]), ("NMDC", &[]),
    ("Tata Group battery initiatives", &["Agratas"]), ("Ola Electric battery initiatives", &["Ola Electric"]),
    // Rare earths / magnets (global)
    ("Noveon Magnetics", &[]), ("Neo Performance Materials", &[]), ("Magnequench", &[]), ("VAC", &[]), ("Vacuumschmelze", &[]),
    ("International Magnaproducts", &[]), ("Less Common Metals", &[]), ("Magneti", &[]), ("USA Rare Earth", &[]), ("Vulcan Elements", &[]),
    ("GKN Powder Metallurgy", &[]), ("Solvay", &[]),
    // Global
    ("Lynas", &["Lynas Rare Earths"]), ("MP Materials", &[]),
    // Tier 2 (methodology handover): Australian and small-cap critical minerals developers
    ("Covalent Lithium", &[]), ("RZ Resources", &[]), ("GRAPHINEX", &[]), ("HPQ Silicon", &[]), ("WIM Resource", &[]), ("Wyloo", &[]),
    ("Scandium International Mining Corporation", &["Scandium International"]), ("Gippsland Critical Minerals", &[]), ("Tronox", &[]),
    ("M Critical Minerals", &[]), ("M Battery Minerals", &[]), ("Azure Minerals", &[]), ("PowerPlus Energy", &[]), ("Sicona", &[]),
    ("Silica Resources Australia", &[]), ("Aspiring Materials", &[]), ("Li-S Energy", &[]), ("Cobra Resources", &[]), ("AE Fuels Corporation", &["AE Fuels"]),
];

// ---------- matching ----------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Topic,
    Focus,
    Company,
}

struct Compiled {
    needle: String,
    cs: bool,
    ascii: bool,
    kind: Kind,
    idx: usize,
}

/// Hyphens become spaces; optionally ASCII-lowercase. Only ASCII bytes change, so byte offsets
/// stay valid for the original text.
fn fold(s: &str, lower: bool) -> String {
    let bytes: Vec<u8> = s.bytes().map(|b| if b == b'-' { b' ' } else if lower { b.to_ascii_lowercase() } else { b }).collect();
    String::from_utf8(bytes).unwrap_or_else(|_| s.to_string())
}

/// Short all-uppercase ASCII terms are acronyms and match case-sensitively.
fn is_acronym(t: &str) -> bool {
    t.is_ascii() && t.len() <= 6 && t.bytes().any(|b| b.is_ascii_uppercase()) && !t.bytes().any(|b| b.is_ascii_lowercase())
}

static COMPILED: LazyLock<Vec<Compiled>> = LazyLock::new(|| {
    let mut out: Vec<Compiled> = Vec::new();
    let mut add = |term: &str, kind: Kind, idx: usize| {
        let ascii = term.is_ascii();
        let cs = ascii && is_acronym(term);
        let needle = fold(term, !cs);
        if !out.iter().any(|c| c.kind == kind && c.idx == idx && c.needle == needle) {
            out.push(Compiled { needle, cs, ascii, kind, idx });
        }
    };
    for (i, (_, terms)) in TOPICS.iter().enumerate() {
        for t in terms.iter() {
            add(t, Kind::Topic, i);
        }
    }
    for (i, t) in FOCUS.iter().enumerate() {
        add(t, Kind::Focus, i);
    }
    for (i, (name, aliases)) in COMPANIES.iter().enumerate() {
        add(name, Kind::Company, i);
        for a in aliases.iter() {
            add(a, Kind::Company, i);
        }
    }
    out
});

#[derive(Debug, Default, PartialEq)]
pub struct Matches {
    pub topics: Vec<&'static str>,
    pub focus: Vec<&'static str>,
    pub companies: Vec<&'static str>,
    /// Matched ranges as UTF-16 offsets into the text (what JavaScript string indexes use),
    /// sorted and merged.
    pub spans: Vec<[usize; 2]>,
}

fn push_unique(v: &mut Vec<&'static str>, s: &'static str) {
    if !v.contains(&s) {
        v.push(s);
    }
}

/// Find every keyword in `text`.
pub fn match_text(text: &str) -> Matches {
    let lower = fold(text, true);
    let exact = fold(text, false);
    let mut m = Matches::default();
    let mut byte_spans: Vec<(usize, usize)> = Vec::new();
    for t in COMPILED.iter() {
        let hay: &str = if t.cs { &exact } else { &lower };
        let b = hay.as_bytes();
        let mut from = 0;
        let mut hit = false;
        while from <= hay.len() {
            let Some(rel) = hay[from..].find(&t.needle) else { break };
            let start = from + rel;
            let mut end = start + t.needle.len();
            from = end;
            if t.ascii {
                if start > 0 && b[start - 1].is_ascii_alphanumeric() {
                    continue;
                }
                if end < b.len() && b[end].is_ascii_alphanumeric() {
                    let plural = !t.cs && b[end] == b's' && (end + 1 == b.len() || !b[end + 1].is_ascii_alphanumeric());
                    if !plural {
                        continue;
                    }
                    end += 1;
                    from = end;
                }
            }
            hit = true;
            byte_spans.push((start, end));
        }
        if hit {
            match t.kind {
                Kind::Topic => push_unique(&mut m.topics, TOPICS[t.idx].0),
                Kind::Focus => push_unique(&mut m.focus, FOCUS[t.idx]),
                Kind::Company => push_unique(&mut m.companies, COMPANIES[t.idx].0),
            }
        }
    }
    byte_spans.sort();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (s, e) in byte_spans {
        match merged.last_mut() {
            Some(last) if s <= last.1 => last.1 = last.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    m.spans = merged.into_iter().map(|(s, e)| [text[..s].encode_utf16().count(), text[..e].encode_utf16().count()]).collect();
    m
}

// ---------- scoring ----------

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ItemMatch {
    /// "doc" | "link" | "text"
    pub kind: String,
    /// Index into the event's newDocuments / newLinks / addedText.
    pub index: usize,
    /// Highlight ranges (UTF-16 offsets into that item's text).
    pub spans: Vec<[usize; 2]>,
}

#[derive(Debug, Default, PartialEq)]
pub struct Score {
    pub topics: Vec<String>,
    pub companies: Vec<String>,
    pub focus: Vec<String>,
    /// "high" | "medium" | "low"
    pub relevance: &'static str,
    pub items: Vec<ItemMatch>,
}

fn norm_name(s: &str) -> String {
    fold(s, true)
}

/// Drop a focus term when a longer matched focus term contains it ("Export Controls" inside
/// "Chinese Export Controls"), so the same phrase is not listed twice.
fn drop_contained(names: Vec<String>) -> Vec<String> {
    let normed: Vec<String> = names.iter().map(|n| norm_name(n)).collect();
    names
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !normed.iter().enumerate().any(|(j, o)| j != *i && o.len() > normed[*i].len() && o.contains(&normed[*i])))
        .map(|(_, n)| n)
        .collect()
}

/// "high": any special-focus or watchlist-company match, or 3+ distinct topics.
/// "medium": any topic. "low": nothing matched.
pub fn relevance_of(topics: usize, companies: usize, focus: usize) -> &'static str {
    if focus > 0 || companies > 0 || topics >= 3 {
        "high"
    } else if topics > 0 {
        "medium"
    } else {
        "low"
    }
}

pub fn score(docs: &[Doc], links: &[Link], texts: &[String]) -> Score {
    let mut sc = Score::default();
    let mut topics: Vec<&'static str> = Vec::new();
    let mut focus: Vec<&'static str> = Vec::new();
    let mut companies: Vec<&'static str> = Vec::new();
    let mut run = |kind: &str, index: usize, text: &str, sc: &mut Score| {
        let m = match_text(text);
        for t in &m.topics {
            push_unique(&mut topics, t);
        }
        for t in &m.focus {
            push_unique(&mut focus, t);
        }
        for t in &m.companies {
            push_unique(&mut companies, t);
        }
        if !m.spans.is_empty() {
            sc.items.push(ItemMatch { kind: kind.to_string(), index, spans: m.spans });
        }
    };
    for (i, d) in docs.iter().enumerate() {
        run("doc", i, &d.text, &mut sc);
    }
    for (i, l) in links.iter().enumerate() {
        run("link", i, &l.text, &mut sc);
    }
    for (i, t) in texts.iter().enumerate() {
        run("text", i, t, &mut sc);
    }
    sc.topics = topics.iter().map(|s| s.to_string()).collect();
    sc.companies = companies.iter().map(|s| s.to_string()).collect();
    sc.focus = drop_contained(focus.iter().map(|s| s.to_string()).collect());
    sc.relevance = relevance_of(sc.topics.len(), sc.companies.len(), sc.focus.len());
    sc
}

/// Score an event in place (used when it is created and to re-score stored events).
pub fn apply(ev: &mut Event) {
    let sc = score(&ev.new_documents, &ev.new_links, &ev.added_text);
    ev.matched_topics = sc.topics;
    ev.matched_companies = sc.companies;
    ev.matched_focus = sc.focus;
    ev.relevance = sc.relevance.to_string();
    ev.item_matches = sc.items;
    ev.kw_version = KW_VERSION;
}

/// Score events that have no score yet or were scored with an older keyword list.
pub fn rescore_stale(events: &mut [Event]) -> usize {
    let mut n = 0;
    for ev in events.iter_mut().filter(|e| e.kw_version != KW_VERSION || e.relevance.is_empty()) {
        apply(ev);
        n += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn topics(s: &str) -> Vec<&'static str> {
        match_text(s).topics
    }

    #[test]
    fn word_boundaries() {
        assert!(topics("Testing the new pipeline").is_empty(), "tin inside testing");
        assert_eq!(topics("Tin prices rise"), vec!["Critical minerals"]);
        assert_eq!(topics("tin"), vec!["Critical minerals"]);
        assert!(topics("Lithiumville").is_empty());
        assert_eq!(topics("Rare Earths rally"), vec!["Rare earths"]);
        assert_eq!(topics("rare-earth supply"), vec!["Rare earths"]);
        assert_eq!(topics("Export controls tighten"), vec!["Export controls & trade"]);
    }

    #[test]
    fn acronyms_are_case_sensitive_whole_words() {
        assert!(topics("The camera and cam shaft").is_empty());
        assert!(topics("Camp opens").is_empty());
        assert_eq!(topics("CAM supply deal"), vec!["Battery chemicals"]);
        assert_eq!(topics("new LFP plant"), vec!["Battery chemicals"]);
        assert!(topics("lfp").is_empty());
        assert!(match_text("a gem of a result").companies.is_empty());
        assert_eq!(match_text("GEM expands").companies, vec!["GEM"]);
        assert!(match_text("BYDs").companies.is_empty());
        assert_eq!(match_text("BYD sales").companies, vec!["BYD"]);
        assert_eq!(topics("M&A activity picks up"), vec!["Corporate events"]);
    }

    #[test]
    fn cjk_substrings() {
        assert_eq!(topics("中国收紧稀土出口管制"), vec!["Rare earths", "Export controls & trade"]);
        assert_eq!(match_text("中国收紧稀土出口管制").focus, vec!["出口管制"]);
        assert_eq!(topics("희토류 자석 공급"), vec!["Rare earths", "Magnets"]);
        assert_eq!(topics("ネオジム磁石の輸出規制"), vec!["Magnets", "Export controls & trade"]);
        let m = match_text("宁德时代CATL签约");
        assert_eq!(m.companies, vec!["CATL"]);
    }

    #[test]
    fn companies_and_aliases() {
        assert_eq!(match_text("JLMAG wins order").companies, vec!["JL MAG"]);
        assert_eq!(match_text("金力永磁 announces").companies, vec!["JL MAG"]);
        assert_eq!(match_text("LGES and SK On").companies, vec!["LG Energy Solution", "SK On"]);
        assert_eq!(match_text("Lynas Rare Earths and MP Materials").companies, vec!["Lynas", "MP Materials"]);
        assert_eq!(match_text("Covalent Lithium update").companies, vec!["Covalent Lithium"]);
        assert!(match_text("We ask on Monday").companies.is_empty());
    }

    #[test]
    fn spans_are_utf16_and_merged() {
        let m = match_text("稀土 and Rare Earths");
        assert_eq!(m.spans, vec![[0, 2], [7, 18]]);
        // astral char before the match shifts UTF-16 offsets by two
        let m = match_text("\u{1F600} gallium");
        assert_eq!(m.spans, vec![[3, 10]]);
    }

    fn l(t: &str) -> Link {
        Link { href: "https://x.org/a".into(), text: t.into() }
    }

    #[test]
    fn scoring_tiers() {
        let s = score(&[], &[l("Local council approves bike lane")], &[]);
        assert_eq!(s.relevance, "low");
        assert!(s.items.is_empty());
        let s = score(&[], &[l("New copper mine approved")], &[]);
        assert_eq!(s.relevance, "medium");
        assert_eq!(s.topics, vec!["Critical minerals"]);
        // three distinct topics -> high without any focus or company
        let s = score(&[], &[l("Lithium carbonate and sintered magnet outlook")], &[]);
        assert_eq!(s.topics.len(), 3);
        assert_eq!(s.relevance, "high");
        // focus
        let s = score(&[], &[l("China tightens rare earth export controls")], &[]);
        assert_eq!(s.relevance, "high");
        assert_eq!(s.focus, vec!["Rare-Earth Export Controls"]);
        assert_eq!(s.items[0].kind, "link");
        // company only
        let s = score(&[], &[], &["JS Link signs magnet supply deal".to_string()]);
        assert_eq!(s.relevance, "high");
        assert!(s.companies.contains(&"JS Link".to_string()));
        assert!(s.focus.contains(&"JS Link".to_string()));
        // doc text counts; per-item index is kept
        let d = Doc { href: "https://x.org/a.pdf".into(), text: "Quarterly graphite report".into(), ext: "pdf".into() };
        let s = score(&[d], &[l("nothing"), l("Cobalt update")], &[]);
        assert_eq!(s.relevance, "high"); // graphite is special focus
        assert_eq!(s.items.iter().map(|i| (i.kind.as_str(), i.index)).collect::<Vec<_>>(), vec![("doc", 0), ("link", 1)]);
    }

    #[test]
    fn contained_focus_terms_collapse() {
        let s = score(&[], &[l("Chinese export controls on gallium")], &[]);
        assert_eq!(s.focus, vec!["Chinese Export Controls", "Gallium"]);
    }

    #[test]
    fn no_empty_or_duplicate_terms() {
        for (_, ts) in TOPICS {
            assert!(ts.iter().all(|t| !t.trim().is_empty() && !t.contains('"')));
        }
        let names: Vec<&str> = COMPANIES.iter().map(|c| c.0).collect();
        for n in ["Covalent Lithium", "AE Fuels Corporation", "Lynas", "JS Link", "Solvay"] {
            assert!(names.contains(&n), "{n}");
        }
        assert_eq!(names.len(), 101);
        assert!(COMPILED.iter().all(|c| !c.needle.trim().is_empty()));
    }
}
