// ═══════════════════════════════════════════════════════════
// Team Aliases — Bidirectional dictionary for fuzzy matching
// Covers IT↔EN translations, club abbreviations, suffixes
// ═══════════════════════════════════════════════════════════

// ═══ STATIC ALIAS MAP ═══
// Key = canonical (lowercase), Values = known aliases (lowercase)

const STATIC_ALIASES: Record<string, string[]> = {
  // ── National Teams IT→EN ──
  giappone: ["japan"],
  germania: ["germany"],
  "stati uniti": ["usa", "united states"],
  inghilterra: ["england"],
  francia: ["france"],
  spagna: ["spain"],
  portogallo: ["portugal"],
  olanda: ["netherlands", "holland"],
  belgio: ["belgium"],
  svezia: ["sweden"],
  norvegia: ["norway"],
  danimarca: ["denmark"],
  finlandia: ["finland"],
  svizzera: ["switzerland"],
  austria: ["austria"],
  grecia: ["greece"],
  turchia: ["turkey", "turkiye"],
  russia: ["russia"],
  polonia: ["poland"],
  "repubblica ceca": ["czech republic", "czechia"],
  ungheria: ["hungary"],
  romania: ["romania"],
  croazia: ["croatia"],
  serbia: ["serbia"],
  slovenia: ["slovenia"],
  slovacchia: ["slovakia"],
  ucraina: ["ukraine"],
  galles: ["wales"],
  scozia: ["scotland"],
  irlanda: ["ireland", "republic of ireland"],
  "irlanda del nord": ["northern ireland"],
  islanda: ["iceland"],
  albania: ["albania"],
  "bosnia erzegovina": ["bosnia and herzegovina", "bosnia"],
  "macedonia del nord": ["north macedonia"],
  montenegro: ["montenegro"],
  lituania: ["lithuania"],
  lettonia: ["latvia"],
  estonia: ["estonia"],
  bielorussia: ["belarus"],
  georgia: ["georgia"],
  armenia: ["armenia"],
  azerbaigian: ["azerbaijan"],
  kazakistan: ["kazakhstan"],
  "arabia saudita": ["saudi arabia"],
  "corea del sud": ["south korea", "korea republic"],
  "corea del nord": ["north korea"],
  cina: ["china"],
  australia: ["australia"],
  "nuova zelanda": ["new zealand"],
  messico: ["mexico"],
  brasile: ["brazil"],
  argentina: ["argentina"],
  cile: ["chile"],
  colombia: ["colombia"],
  peru: ["peru"],
  uruguay: ["uruguay"],
  paraguay: ["paraguay"],
  venezuela: ["venezuela"],
  ecuador: ["ecuador"],
  bolivia: ["bolivia"],
  "costa rica": ["costa rica"],
  costarica: ["costa rica"],
  giamaica: ["jamaica"],
  "costa d'avorio": ["ivory coast", "cote d'ivoire"],
  camerun: ["cameroon"],
  nigeria: ["nigeria"],
  senegal: ["senegal"],
  ghana: ["ghana"],
  egitto: ["egypt"],
  marocco: ["morocco"],
  tunisia: ["tunisia"],
  algeria: ["algeria"],
  sudafrica: ["south africa"],
  "emirati arabi uniti": ["united arab emirates", "uae"],
  cipro: ["cyprus"],
  lussemburgo: ["luxembourg"],
  malta: ["malta"],
  "isole faroe": ["faroe islands"],
  gibilterra: ["gibraltar"],
  andorra: ["andorra"],
  "san marino": ["san marino"],
  liechtenstein: ["liechtenstein"],
  moldavia: ["moldova"],
  copenaghen: ["copenhagen", "kobenhavn"],

  // ── Italian Clubs ──
  inter: ["internazionale", "inter milano", "inter milan"],
  internazionale: ["inter", "inter milano", "inter milan"],
  milan: ["ac milan", "milan ac"],
  "ac milan": ["milan", "milan ac"],
  juventus: ["juve"],
  napoli: ["ssc napoli"],
  roma: ["as roma"],
  "as roma": ["roma"],
  lazio: ["ss lazio"],
  "ss lazio": ["lazio"],
  fiorentina: ["acf fiorentina"],
  atalanta: ["atalanta bergamo", "atalanta bc"],
  torino: ["torino fc"],
  sampdoria: ["uc sampdoria", "samp"],
  genoa: ["genoa cfc"],
  bologna: ["bologna fc"],
  udinese: ["udinese calcio"],
  cagliari: ["cagliari calcio"],
  sassuolo: ["us sassuolo"],
  verona: ["hellas verona"],
  "hellas verona": ["verona"],
  empoli: ["empoli fc"],
  lecce: ["us lecce"],
  monza: ["ac monza"],
  cremonese: ["us cremonese"],
  salernitana: ["us salernitana"],
  frosinone: ["frosinone calcio"],
  parma: ["parma calcio"],
  venezia: ["venezia fc"],
  como: ["como 1907"],
  brescia: ["brescia calcio"],
  palermo: ["palermo fc"],
  bari: ["ssc bari"],
  catanzaro: ["us catanzaro"],
  spezia: ["spezia calcio"],
  pisa: ["pisa sc"],
  reggiana: ["ac reggiana"],
  "spal": ["spal ferrara"],
  modena: ["modena fc"],
  cittadella: ["as cittadella"],
  cosenza: ["cosenza calcio"],
  sudtirol: ["fc sudtirol", "sud tirol"],

  // ── Major International Clubs ──
  "man utd": ["manchester united", "man united"],
  "manchester united": ["man utd", "man united"],
  "man city": ["manchester city"],
  "manchester city": ["man city"],
  arsenal: ["arsenal fc"],
  chelsea: ["chelsea fc"],
  liverpool: ["liverpool fc"],
  tottenham: ["tottenham hotspur", "spurs"],
  "tottenham hotspur": ["tottenham", "spurs"],
  "west ham": ["west ham united"],
  "newcastle": ["newcastle united"],
  "newcastle united": ["newcastle"],
  everton: ["everton fc"],
  "aston villa": ["aston villa fc"],
  wolves: ["wolverhampton", "wolverhampton wanderers"],
  wolverhampton: ["wolves", "wolverhampton wanderers"],
  "nottingham forest": ["nott forest", "nottm forest"],
  "crystal palace": ["c palace"],
  "sheffield utd": ["sheffield united"],
  "sheffield united": ["sheffield utd"],
  barcelona: ["fc barcelona", "barca"],
  "fc barcelona": ["barcelona", "barca"],
  "real madrid": ["real madrid cf"],
  "atletico madrid": ["atl madrid", "atletico", "atl. madrid"],
  "atl madrid": ["atletico madrid", "atletico", "atl. madrid"],
  "real sociedad": ["r sociedad"],
  "real betis": ["betis"],
  villarreal: ["villarreal cf"],
  sevilla: ["sevilla fc"],
  valencia: ["valencia cf"],
  "athletic bilbao": ["ath bilbao", "athletic club"],
  bayern: ["bayern munich", "bayern munchen", "fc bayern"],
  "bayern munich": ["bayern", "bayern munchen", "fc bayern"],
  "bayern munchen": ["bayern", "bayern munich", "fc bayern"],
  dortmund: ["borussia dortmund", "bvb"],
  "borussia dortmund": ["dortmund", "bvb"],
  leverkusen: ["bayer leverkusen"],
  "bayer leverkusen": ["leverkusen"],
  "rb leipzig": ["leipzig", "rasenball leipzig"],
  leipzig: ["rb leipzig", "rasenball leipzig"],
  "m'gladbach": ["monchengladbach", "borussia monchengladbach", "gladbach"],
  monchengladbach: ["m'gladbach", "borussia monchengladbach", "gladbach"],
  gladbach: ["m'gladbach", "monchengladbach", "borussia monchengladbach"],
  wolfsburg: ["vfl wolfsburg"],
  "eintracht frankfurt": ["e frankfurt", "frankfurt"],
  frankfurt: ["eintracht frankfurt", "e frankfurt"],
  psg: ["paris saint-germain", "paris sg", "paris saint germain"],
  "paris saint-germain": ["psg", "paris sg"],
  marsiglia: ["marseille", "olympique marseille", "om"],
  marseille: ["marsiglia", "olympique marseille", "om"],
  lione: ["lyon", "olympique lyon", "ol"],
  lyon: ["lione", "olympique lyon", "ol"],
  monaco: ["as monaco"],
  "as monaco": ["monaco"],
  ajax: ["ajax amsterdam"],
  "ajax amsterdam": ["ajax"],
  psv: ["psv eindhoven"],
  "psv eindhoven": ["psv"],
  feyenoord: ["feyenoord rotterdam"],
  benfica: ["sl benfica"],
  porto: ["fc porto"],
  sporting: ["sporting cp", "sporting lisbona", "sporting lisbon"],
  "sporting cp": ["sporting", "sporting lisbona", "sporting lisbon"],
  "sporting lisbona": ["sporting", "sporting cp", "sporting lisbon"],
  "galatasaray": ["galatasaray sk"],
  "fenerbahce": ["fenerbahce sk"],
  "besiktas": ["besiktas jk"],
  "cska mosca": ["cska moscow", "cska"],
  "cska moscow": ["cska mosca", "cska"],
  "spartak mosca": ["spartak moscow", "spartak"],
  "spartak moscow": ["spartak mosca", "spartak"],
  "zenit": ["zenit san pietroburgo", "zenit st petersburg"],
  "dinamo zagabria": ["dinamo zagreb"],
  "dinamo zagreb": ["dinamo zagabria"],
  "stella rossa": ["red star belgrade", "crvena zvezda"],
  "red star belgrade": ["stella rossa", "crvena zvezda"],
  "partizan": ["partizan belgrade", "partizan belgrado"],
  "slavia praga": ["slavia prague"],
  "slavia prague": ["slavia praga"],
  "sparta praga": ["sparta prague"],
  "sparta prague": ["sparta praga"],
  brugge: ["club brugge", "club bruges"],
  "club brugge": ["brugge", "club bruges"],

  // ── Misc abbreviations ──
  "atl": ["atletico"],
  "sp": ["sporting"],
};

// ═══ SUFFIX NORMALIZATION ═══
// Map various suffixes to a standard form

const SUFFIX_MAP: [RegExp, string][] = [
  [/\b(?:women|femminile|donne|ladies|feminino)\b/i, "(w)"],
  [/\s*\(w\)\s*/i, "(w)"],
  [/\s*\(f\)\s*/i, "(w)"],
  [/\bw$/i, "(w)"],
  [/\b(?:under[\s-]?21|u[\s-]?21)\b/i, "u21"],
  [/\b(?:under[\s-]?23|u[\s-]?23)\b/i, "u23"],
  [/\b(?:under[\s-]?20|u[\s-]?20)\b/i, "u20"],
  [/\b(?:under[\s-]?19|u[\s-]?19)\b/i, "u19"],
  [/\b(?:under[\s-]?18|u[\s-]?18)\b/i, "u18"],
  [/\b(?:under[\s-]?17|u[\s-]?17)\b/i, "u17"],
  [/\b(?:riserve|reserves|ii|b team)\b/i, "res"],
  [/\b(?:primavera|youth)\b/i, "youth"],
];

// ═══ RUNTIME ALIASES (loaded from DB) ═══

let dbAliases: Map<string, string[]> = new Map();

export function setDbAliases(aliases: { canonical: string; alias: string }[]) {
  dbAliases = new Map();
  for (const { canonical, alias } of aliases) {
    const key = canonical.toLowerCase().trim();
    const val = alias.toLowerCase().trim();
    if (!dbAliases.has(key)) {
      dbAliases.set(key, []);
    }
    dbAliases.get(key)!.push(val);
  }
}

// ═══ RESOLVE ALIASES ═══

/**
 * Given a team name, returns an array of all known variants (normalized, lowercase).
 * Includes: original, static aliases, DB aliases, suffix-normalized forms.
 */
export function resolveAliases(name: string): string[] {
  const norm = name.toLowerCase().trim();
  const variants = new Set<string>([norm]);

  // Apply suffix normalization
  let suffixNorm = norm;
  for (const [pattern, replacement] of SUFFIX_MAP) {
    suffixNorm = suffixNorm.replace(pattern, ` ${replacement} `).replace(/\s+/g, " ").trim();
  }
  variants.add(suffixNorm);

  // Strip year suffixes (e.g. "como 1907" → "como")
  const noYear = suffixNorm.replace(/\b(1[89]\d{2}|20[0-2]\d)\b/g, "").replace(/\s+/g, " ").trim();
  if (noYear && noYear !== suffixNorm) variants.add(noYear);

  // Lookup in static dictionary
  for (const variant of [norm, suffixNorm, noYear]) {
    if (!variant) continue;
    const staticList = STATIC_ALIASES[variant];
    if (staticList) {
      for (const alias of staticList) variants.add(alias);
    }
    // Also check if this name IS an alias of something
    for (const [canonical, aliasList] of Object.entries(STATIC_ALIASES)) {
      if (aliasList.includes(variant)) {
        variants.add(canonical);
        for (const alias of aliasList) variants.add(alias);
      }
    }
  }

  // Lookup in DB aliases
  for (const variant of [norm, suffixNorm, noYear]) {
    if (!variant) continue;
    const dbList = dbAliases.get(variant);
    if (dbList) {
      for (const alias of dbList) variants.add(alias);
    }
    // Reverse lookup
    for (const [canonical, aliasList] of dbAliases.entries()) {
      if (aliasList.includes(variant)) {
        variants.add(canonical);
        for (const alias of aliasList) variants.add(alias);
      }
    }
  }

  return Array.from(variants).filter(Boolean);
}

// ═══ LEVENSHTEIN DISTANCE ═══

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ═══ NORMALIZE WITH SUFFIXES ═══

/**
 * Enhanced normalization that also handles suffixes, years, parentheticals.
 */
export function normalizeSuffixes(name: string): string {
  let result = name;

  // Standardize suffixes
  for (const [pattern, replacement] of SUFFIX_MAP) {
    result = result.replace(pattern, ` ${replacement} `);
  }

  // Strip year suffixes
  result = result.replace(/\b(1[89]\d{2}|20[0-2]\d)\b/g, "");

  // Strip parentheticals like (Riserva), (Femminile), (Primavera) — but keep (w), u21 etc
  result = result.replace(/\((?!w\)|u\d)([^)]+)\)/gi, "");

  return result.replace(/\s+/g, " ").trim();
}
