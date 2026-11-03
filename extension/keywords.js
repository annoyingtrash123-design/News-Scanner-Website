// Keyword relevance, a port of app/src/keywords.rs. The lists below must stay identical to the
// Rust file (tests/keywords.test.js parses it and compares); see that file for how the terms were
// chosen from docs/prompts and which generic words were left out.
//
// Matching rules:
// - Hyphens are treated as spaces ("Rare-Earth" == "rare earth").
// - ASCII terms match at word boundaries ("tin" does not match "testing"), case-insensitively,
//   and may carry a plural "s".
// - Short all-uppercase ASCII terms (up to 6 chars: CAM, GEM, BYD, LFP, M&A ...) match
//   case-sensitively as whole words.
// - Terms with any non-ASCII character (Chinese, Korean, Japanese) match as substrings.

/** Bump when any list or rule changes (and in keywords.rs) so stored events are re-scored. */
export const KW_VERSION = 1;

export const TOPICS = [
  ["Battery minerals", ["Lithium", "Nickel", "Cobalt", "Manganese", "Graphite", "Natural Graphite", "Synthetic Graphite", "니켈", "石墨"]],
  ["Battery chemicals", ["Lithium Carbonate", "Lithium Hydroxide", "Lithium Metal", "LFP", "LMFP", "NCM", "NCMA", "CAM", "PCAM", "Battery Precursor", "Precursor Cathode Active Material", "Cathode Active Material", "LiPF6", "PVDF", "Conductive Additive", "배터리소재", "전구체"]],
  ["Anodes", ["Graphite Anode", "Natural Graphite Anode", "Synthetic Graphite Anode", "Silicon Anode", "Silicon-Graphite Anode", "Hard Carbon", "Anode Material", "Anode Powder", "음극재", "負極材"]],
  ["Cathodes", ["LFP Cathode", "LMFP Cathode", "NCM Cathode", "NCMA Cathode", "High-Nickel Cathode", "Cathode Powder", "Cathode Material", "양극재", "正極材"]],
  ["Rare earths", ["Rare Earth", "Rare Earth Oxide", "Rare Earth Metal", "Rare Earth Separation", "Rare Earth Refining", "Rare Earth Processing", "Lanthanum", "Cerium", "Praseodymium", "Neodymium", "Samarium", "Europium", "Gadolinium", "Terbium", "Dysprosium", "Holmium", "Erbium", "Thulium", "Ytterbium", "Lutetium", "Scandium", "Yttrium", "稀土", "희토류", "レアアース"]],
  ["Critical minerals", ["Critical Mineral", "Copper", "High Purity Alumina", "Gallium", "Germanium", "Indium", "Antimony", "Tellurium", "Fluorspar", "Vanadium", "Magnesium", "Titanium", "Platinum", "Palladium", "Rhodium", "Ruthenium", "Iridium", "Osmium", "Niobium", "Tantalum", "Hafnium", "Zirconium", "Beryllium", "Bismuth", "Rhenium", "Tungsten", "Tin", "Chromium", "Molybdenum", "Uranium", "Zircon", "镓", "锗", "锑", "钨", "战略矿产", "关键矿产", "重要鉱物"]],
  ["Batteries", ["EV Battery", "Electric Vehicle Battery", "ESS Battery", "Energy Storage Battery", "Battery Manufacturing", "Battery Gigafactory", "Sodium-Ion Battery", "Solid-State Battery", "新能源材料"]],
  ["Magnets", ["Permanent Magnet", "Rare-Earth Magnet", "NdFeB", "Neo Magnet", "Neodymium Magnet", "SmCo", "SmCo Magnet", "Samarium-Cobalt Magnet", "Sintered Magnet", "Bonded Magnet", "Magnet Alloy", "Magnet Powder", "Magnet Recycling", "Traction Motor", "Motor Magnet", "Magnetic Materials", "Permanent Magnet Materials", "Magnet Manufacturing", "EV Motor Magnet", "Wind Turbine Magnet", "Sintered NdFeB", "Bonded NdFeB", "永磁", "稀土永磁", "钕铁硼", "烧结钕铁硼", "钕铁硼磁体", "磁材", "磁性材料", "永磁材料", "영구자석", "희토류 자석", "네오디뮴 자석", "자성재료", "永久磁石", "ネオジム磁石", "焼結磁石", "磁性材料"]],
  ["Semiconductors", ["Semiconductor Material", "Semiconductor Supply Chain", "Advanced Packaging", "AI Chip", "HPC Chip", "Gallium Nitride", "Silicon Carbide", "Advanced Substrate", "Wafer", "Photonics", "Power Electronics"]],
  ["Defence", ["Defence Supply Chain", "Defense Supply Chain", "Military Supply Chain", "Strategic Mineral", "National Security Material", "Military Magnet", "Missile Material", "Aerospace Material", "Strategic Stockpile", "Strategic Reserve", "战略储备", "收储", "전략비축", "비축", "備蓄", "戦略備蓄"]],
  ["Export controls & trade", ["Export Control", "Export Restriction", "Export Ban", "Export Licence", "Export License", "Export Licensing", "Rare Earth Licence", "Rare Earth License", "Rare Earth Licensing", "Rare Earth Quota", "Magnet Export Permit", "Permanent Magnet Permit", "Dual-Use Goods", "Technology Export Control", "Technology Export Restriction", "Technology Transfer Restriction", "Foreign Investment Review", "National Security Review", "End User Certification", "Trade Restriction", "Trade License", "Gallium Exports", "Germanium Exports", "Antimony Exports", "Graphite Exports", "Tungsten Exports", "Rare Earth Exports", "Magnet Exports", "Strategic Materials Exports", "出口管制", "出口许可", "出口许可证", "贸易管制", "수출통제", "수출허가", "희토류 수출", "輸出規制", "輸出許可"]],
  ["Supply disruptions", ["Power Restriction", "Power Rationing", "Electricity Curtailment", "Grid Disruption", "Environmental Inspection", "Mine Accident", "Tailings Incident", "Port Closure", "Port Disruption", "Shipping Disruption", "Logistics Constraint", "Concentrate Shortage", "Feedstock Shortage", "Sulphur Shortage", "Sulphuric Acid Shortage", "Magnet Shortage", "Critical Equipment Shortage"]],
  ["Corporate events", ["Mine Commissioning", "Mine Closure", "Smelter Commissioning", "Smelter Closure", "Refinery Commissioning", "Refinery Closure", "Processing Plant", "Magnet Plant", "Battery Plant", "M&A", "Joint Venture", "Supply Agreement", "Offtake", "Offtake Agreement", "Project Financing", "Strategic Investment", "Government Funding", "Exploration Discovery", "Pilot Plant", "Production Guidance"]],
  ["Customs & trade data", ["Customs Data", "Export Volume", "Import Volume", "Export Statistics", "Import Statistics", "Trade Statistics", "Stockpile", "Inventory Build", "Inventory Release", "海关数据", "出口量", "进口量", "관세청", "수출통계", "輸出実績", "輸入実績", "関税"]],
  ["Macro & policy", ["Manufacturing PMI", "Caixin PMI", "China PMI", "Japan PMI", "Korea PMI", "India PMI", "Economic Security", "Supply Chain Resilience", "Critical Minerals Policy"]],
];

export const FOCUS = ["Chinese Export Controls", "Rare-Earth Export Controls", "Export Controls", "Export Control", "Rare-Earth Licensing", "Rare-Earth Licence", "Rare-Earth License", "Rare-Earth Quota", "Permanent Magnet Trade", "Gallium", "Germanium", "Antimony", "Graphite", "Tungsten", "Semiconductor Materials", "Strategic Reserve", "Strategic Stockpile", "Strategic Stockpiling", "National Security Actions", "Foreign Investment Restrictions", "Indonesian Nickel Policy", "Philippine Nickel Policy", "Japanese Rare-Earth Procurement", "Korean Battery Supply Chains", "Indian Critical Minerals Policy", "Chinese Customs Data", "LS Group", "LS Cable & System", "LS MnM", "LS Eco Energy", "LS Electric", "JS Link", "LS전선", "JS링크", "出口管制", "镓", "锗", "锑", "钨", "石墨", "수출통제", "輸出規制"];

export const COMPANIES = [
  ["CATL", ["宁德时代"]],
  ["BYD", ["比亚迪"]],
  ["EVE Energy", ["亿纬锂能"]],
  ["Gotion", ["国轩高科"]],
  ["CNGR", ["中伟股份"]],
  ["Ronbay", ["容百科技"]],
  ["GEM", ["格林美"]],
  ["Huayou Cobalt", ["Huayou", "华友钴业"]],
  ["Tsingshan", ["青山控股"]],
  ["CMOC", ["洛阳钼业"]],
  ["Jinchuan", ["金川集团"]],
  ["China Rare Earth Group", ["中国稀土集团"]],
  ["Northern Rare Earth", ["北方稀土"]],
  ["JL MAG", ["JLMAG", "JL MAG Rare-Earth", "JLMAG Rare-Earth", "金力永磁"]],
  ["Beijing Zhong Ke San Huan", ["Zhong Ke San Huan", "中科三环"]],
  ["Yunsheng", ["宁波韵升"]],
  ["Xiamen Tungsten", ["厦门钨业"]],
  ["Minmetals Rare Earth", ["五矿稀土"]],
  ["China Southern Rare Earth Group", ["中国南方稀土"]],
  ["Innuovo Technology", ["英洛华"]],
  ["Zhenghai Magnetic Materials", ["正海磁材"]],
  ["Earth-Panda Advanced Magnetic Material", ["Earth-Panda", "大地熊"]],
  ["China Star Group Industry", []],
  ["LG Energy Solution", ["LGES", "LG에너지솔루션"]],
  ["Samsung SDI", ["삼성SDI"]],
  ["SK On", ["SK온"]],
  ["POSCO Future M", ["포스코퓨처엠"]],
  ["EcoPro BM", ["에코프로비엠"]],
  ["EcoPro Innovation", []],
  ["L&F", []],
  ["LG Chem", ["LG화학"]],
  ["Cosmo Advanced Materials", []],
  ["Korea Zinc", ["고려아연"]],
  ["Solus Advanced Materials", []],
  ["Iljin Materials", []],
  ["Doosan Enerbility", []],
  ["Hyosung Heavy Industries", []],
  ["LS Group", []],
  ["LS Cable & System", ["LS전선"]],
  ["LS MnM", []],
  ["LS Eco Energy", []],
  ["LS Electric", []],
  ["JS Link", ["JS링크"]],
  ["Sumitomo Metal Mining", ["住友金属鉱山"]],
  ["Sumitomo Electric", ["住友電気工業"]],
  ["JX Advanced Metals", ["JX金属"]],
  ["Mitsubishi Materials", ["三菱マテリアル"]],
  ["Sojitz", []],
  ["Marubeni", []],
  ["Itochu", []],
  ["Mitsui", []],
  ["JOGMEC", []],
  ["Proterial", []],
  ["TDK", []],
  ["Shin-Etsu Chemical", ["Shin-Etsu", "信越化学"]],
  ["Merdeka Battery Materials", []],
  ["Vale Indonesia", []],
  ["Aneka Tambang", ["Antam"]],
  ["Harita", []],
  ["IMIP", []],
  ["IWIP", []],
  ["Vedanta", []],
  ["Hindalco", []],
  ["National Aluminium", ["NALCO"]],
  ["Coal India", []],
  ["NMDC", []],
  ["Tata Group battery initiatives", ["Agratas"]],
  ["Ola Electric battery initiatives", ["Ola Electric"]],
  ["Noveon Magnetics", []],
  ["Neo Performance Materials", []],
  ["Magnequench", []],
  ["VAC", []],
  ["Vacuumschmelze", []],
  ["International Magnaproducts", []],
  ["Less Common Metals", []],
  ["Magneti", []],
  ["USA Rare Earth", []],
  ["Vulcan Elements", []],
  ["GKN Powder Metallurgy", []],
  ["Solvay", []],
  ["Lynas", ["Lynas Rare Earths"]],
  ["MP Materials", []],
  ["Covalent Lithium", []],
  ["RZ Resources", []],
  ["GRAPHINEX", []],
  ["HPQ Silicon", []],
  ["WIM Resource", []],
  ["Wyloo", []],
  ["Scandium International Mining Corporation", ["Scandium International"]],
  ["Gippsland Critical Minerals", []],
  ["Tronox", []],
  ["M Critical Minerals", []],
  ["M Battery Minerals", []],
  ["Azure Minerals", []],
  ["PowerPlus Energy", []],
  ["Sicona", []],
  ["Silica Resources Australia", []],
  ["Aspiring Materials", []],
  ["Li-S Energy", []],
  ["Cobra Resources", []],
  ["AE Fuels Corporation", ["AE Fuels"]],
];

// ---------- matching ----------

const fold = (s, lower) => {
  const t = s.replace(/-/g, ' ');
  return lower ? t.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)) : t;
};
const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
const isAlnum = (c) => c !== undefined && /[A-Za-z0-9]/.test(c);
const isAcronym = (t) => isAscii(t) && t.length <= 6 && /[A-Z]/.test(t) && !/[a-z]/.test(t);

const COMPILED = (() => {
  const out = [];
  const add = (term, kind, idx) => {
    const ascii = isAscii(term);
    const cs = ascii && isAcronym(term);
    const needle = fold(term, !cs);
    if (!out.some((c) => c.kind === kind && c.idx === idx && c.needle === needle)) out.push({ needle, cs, ascii, kind, idx });
  };
  TOPICS.forEach(([, terms], i) => terms.forEach((t) => add(t, 'topic', i)));
  FOCUS.forEach((t, i) => add(t, 'focus', i));
  COMPANIES.forEach(([name, aliases], i) => { add(name, 'company', i); aliases.forEach((a) => add(a, 'company', i)); });
  return out;
})();

const pushUnique = (arr, v) => { if (!arr.includes(v)) arr.push(v); };

/**
 * Find every keyword in `text`. Returns { topics, focus, companies, spans } where spans are merged
 * [start, end) UTF-16 offsets into `text`.
 */
export function matchText(text) {
  text = String(text || '');
  const lower = fold(text, true);
  const exact = fold(text, false);
  const m = { topics: [], focus: [], companies: [], spans: [] };
  const raw = [];
  for (const t of COMPILED) {
    const hay = t.cs ? exact : lower;
    let from = 0;
    let hit = false;
    while (from <= hay.length) {
      const start = hay.indexOf(t.needle, from);
      if (start < 0) break;
      let end = start + t.needle.length;
      from = end;
      if (t.ascii) {
        if (start > 0 && isAlnum(hay[start - 1])) continue;
        if (end < hay.length && isAlnum(hay[end])) {
          const plural = !t.cs && hay[end] === 's' && (end + 1 === hay.length || !isAlnum(hay[end + 1]));
          if (!plural) continue;
          end += 1;
          from = end;
        }
      }
      hit = true;
      raw.push([start, end]);
    }
    if (hit) {
      if (t.kind === 'topic') pushUnique(m.topics, TOPICS[t.idx][0]);
      else if (t.kind === 'focus') pushUnique(m.focus, FOCUS[t.idx]);
      else pushUnique(m.companies, COMPANIES[t.idx][0]);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [s, e] of raw) {
    const last = m.spans[m.spans.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else m.spans.push([s, e]);
  }
  return m;
}

// ---------- scoring ----------

/** Drop a focus term when a longer matched focus term contains it ("Export Controls" inside "Chinese Export Controls"). */
function dropContained(names) {
  const n = names.map((x) => fold(x, true));
  return names.filter((_, i) => !n.some((o, j) => j !== i && o.length > n[i].length && o.includes(n[i])));
}

/** "high": any special-focus or watchlist-company match, or 3+ distinct topics. "medium": any topic. "low": none. */
export function relevanceOf(topics, companies, focus) {
  if (focus > 0 || companies > 0 || topics >= 3) return 'high';
  return topics > 0 ? 'medium' : 'low';
}

/**
 * Score an event's new documents, new links and added text. Returns the fields stored on the event:
 * { matchedTopics, matchedCompanies, matchedFocus, relevance, itemMatches, kwVersion }.
 * itemMatches: [{ kind: 'doc'|'link'|'text', index, spans }] for items with at least one hit.
 */
export function scoreEvent(ev) {
  const topics = [], focus = [], companies = [], itemMatches = [];
  const run = (kind, index, text) => {
    const m = matchText(text);
    m.topics.forEach((x) => pushUnique(topics, x));
    m.focus.forEach((x) => pushUnique(focus, x));
    m.companies.forEach((x) => pushUnique(companies, x));
    if (m.spans.length) itemMatches.push({ kind, index, spans: m.spans });
  };
  (ev.newDocuments || []).forEach((d, i) => run('doc', i, d.text));
  (ev.newLinks || []).forEach((l, i) => run('link', i, l.text));
  (ev.addedText || []).forEach((t, i) => run('text', i, t));
  const matchedFocus = dropContained(focus);
  return {
    matchedTopics: topics, matchedCompanies: companies, matchedFocus,
    relevance: relevanceOf(topics.length, companies.length, matchedFocus.length),
    itemMatches, kwVersion: KW_VERSION,
  };
}

/** Return the event with score fields added (does not mutate the input). */
export function withScore(ev) {
  return { ...ev, ...scoreEvent(ev) };
}

export const needsScore = (ev) => ev.kwVersion !== KW_VERSION || !ev.relevance;
