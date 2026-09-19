// Deck-builder search/filter logic (pure functions, no DOM) — unit-tested in scripts/test-dbsearch.mjs.
//
// Query syntax (case/space-insensitive substring match):
//   a b        both terms (AND)          "a b"   exact phrase (spaces kept out of the comparison too)
//   -a         exclude cards matching a  a|b     either a or b (OR)
// Scope selects which text fields are searched: all / name / traits / effect / inherited.

export const SCOPES = [
  ['all', '전체'], ['name', '이름'], ['traits', '특징'], ['effect', '효과 텍스트'], ['inherited', '진화원 효과'],
];
export const SORTS = [['id', '번호순'], ['name', '이름'], ['level', 'Lv'], ['cost', '코스트'], ['dp', 'DP']];
export const CATS = [['digimon', '디지몬'], ['tamer', '테이머'], ['option', '옵션'], ['digitama', '디지타마']];
export const COLORS = [
  ['red', '빨강', '레드'], ['blue', '파랑', '블루'], ['yellow', '노랑', '옐로'], ['green', '초록', '그린'],
  ['black', '검정', '블랙'], ['purple', '보라', '퍼플'], ['white', '흰색', '화이트'],
];
const COLOR_WORDS = Object.fromEntries(COLORS.map(([k, a, b]) => [k, `${k} ${a} ${b}`]));

export const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

export function parseKeyword(raw) { // "시큐리티 어택 +1" -> "시큐리티어택"
  let k = String(raw).split('《')[0].replace(/[+\-−]?\s*\d+.*$/, '');
  k = k.replace(/\s+/g, '');
  if (k === 'S어택') k = '시큐리티어택';
  return k;
}
export function extractKeywords(text) {
  const out = new Set();
  String(text || '').replace(/《([^》]+)》/g, (m, k) => { const p = parseKeyword(k); if (p && p.length <= 12) out.add(p); return m; });
  return [...out];
}
export function extractTags(text) {
  const out = new Set();
  String(text || '').replace(/【([^】]+)】/g, (m, k) => { const p = norm(k); if (p) out.add(p); return m; });
  return [...out];
}
export function parseId(id) {
  const m = /^([A-Za-z]+)(\d*)-/.exec(id || '');
  return m ? { prefix: m[1].toUpperCase(), setKey: m[1].toUpperCase() + m[2] } : { prefix: '?', setKey: '?' };
}

// One precomputed index entry per card (lowercased/space-stripped blobs, keyword/tag sets, set info).
export function buildBlob(c, order = 0) {
  const evoTxt = [c.evoNormal?.conditionText, ...(c.evoOther ? [JSON.stringify(c.evoOther)] : [])].filter(Boolean).join(' ');
  const name = norm([c.nameKo, c.nameDisplayKo, c.nameEn, c.id].join(' '));
  const traits = norm([...(c.types || []), c.attribute, c.form].join(' '));
  const effect = norm([c.effectKo, c.effectEn, evoTxt].join(' '));
  const inherited = norm([c.inheritedKo, c.inheritedEn].join(' '));
  const meta = norm([c.category, c.rarity, c.setName, c.level != null ? 'lv.' + c.level : '', ...(c.colors || []).map(k => COLOR_WORDS[k] || k)].join(' '));
  const pid = parseId(c.id);
  const evo = c.evoNormal?.cost;
  return {
    id: c.id, order, name, traits, effect, inherited,
    all: [name, traits, effect, inherited, meta].join(' '),
    kw: new Set(extractKeywords((c.effectKo || '') + '\n' + (c.inheritedKo || ''))),
    tags: new Set(extractTags((c.effectKo || '') + '\n' + (c.inheritedKo || ''))),
    prefix: pid.prefix, setKey: pid.setKey,
    evoCost: evo == null ? null : evo,
  };
}
// parallels (optional) = { cardNo: [{ rarity, ... }] }: blob.par = the variants' rarities (alternate arts of the same card).
export function buildIndex(cards, parallels) {
  const ix = new Map(); let i = 0;
  for (const id of Object.keys(cards)) {
    const b = buildBlob(cards[id], i++);
    b.par = (parallels?.[id] || []).map(v => v.rarity).filter(Boolean);
    b.parN = parallels?.[id]?.length || 0;
    ix.set(id, b);
  }
  return ix;
}
// Option lists (keywords / effect tags / traits / sets) derived from the data.
export function buildOptions(cards, ix) {
  const kw = {}, tg = {}, tr = {}, sets = new Set(), rar = new Set();
  for (const id of Object.keys(cards)) {
    const c = cards[id], b = ix.get(id);
    b.kw.forEach(k => kw[k] = (kw[k] || 0) + 1);
    b.tags.forEach(k => tg[k] = (tg[k] || 0) + 1);
    (c.types || []).forEach(t => tr[t] = (tr[t] || 0) + 1);
    if (c.attribute) tr[c.attribute] = (tr[c.attribute] || 0) + 1;
    if (c.form && /^[가-힣]/.test(c.form)) tr[c.form] = (tr[c.form] || 0) + 1;
    sets.add(b.setKey); if (c.rarity) rar.add(c.rarity); (b.par || []).forEach(r => rar.add(r));
  }
  const top = (o, min, n) => Object.entries(o).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  return {
    keywords: top(kw, 8, 30), tags: top(tg, 15, 24), traits: Object.keys(tr).sort((a, b) => a.localeCompare(b, 'ko')),
    sets: [...sets].sort(natural), rarities: ['C', 'U', 'R', 'SR', 'SEC', 'UR', 'P'].filter(r => rar.has(r)),
  };
}
export function tagLabel(k) {
  if (k.length > 2 && k.endsWith('시')) return k.slice(0, -1) + ' 시';
  return k.replace(/^(자신|상대|서로)의턴$/, '$1의 턴');
}

// ---- query ----
export function tokenize(q) {
  const toks = []; const re = /(-?)"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(String(q || '')))) {
    if (m[3] !== undefined) toks.push(m[3]); else toks.push((m[1] || '') + '"' + m[2] + '"');
  }
  return toks;
}
// -> { include: [[alt,...],...], exclude: [[alt,...],...] } (terms already normalised)
export function parseQuery(q) {
  const include = [], exclude = [];
  for (let t of tokenize(q)) {
    let neg = false;
    if (t.startsWith('-') && t.length > 1) { neg = true; t = t.slice(1); }
    let alts;
    if (t.startsWith('"')) alts = [norm(t.replace(/^"|"$/g, ''))];
    else alts = t.split('|').map(norm);
    alts = alts.filter(Boolean);
    if (!alts.length) continue;
    (neg ? exclude : include).push(alts);
  }
  return { include, exclude };
}
export function matchCard(pq, blob, scope = 'all') {
  const text = blob[scope] ?? blob.all;
  for (const alts of pq.include) if (!alts.some(a => text.includes(a))) return false;
  for (const alts of pq.exclude) if (alts.some(a => text.includes(a))) return false;
  return true;
}
export function highlightTerms(pq) { return pq.include.flat(); }
// Split original text into [{t, hit}] marking every (space-insensitive) occurrence of any term.
export function splitHighlight(text, terms) {
  text = String(text || '');
  if (!terms.length) return [{ t: text, hit: false }];
  const esc = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length)
    .map(t => [...t].map(esc).join('\\s*'));
  const re = new RegExp(pats.join('|'), 'gi');
  const out = []; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    if (m.index > last) out.push({ t: text.slice(last, m.index), hit: false });
    out.push({ t: m[0], hit: true }); last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), hit: false });
  return out;
}

// ---- filters ----
export function defaultFilter() {
  return {
    q: '', scope: 'all', cats: [], colors: [], mono: false, levels: [],
    cost: { min: '', max: '' }, dp: { min: '', max: '' }, evo: { min: '', max: '' },
    traits: [], keywords: [], tags: [], packs: [], setKey: '', rarities: [],
    inDeck: false, hideMax: false, hasPar: false, sort: 'id', pageSize: 60,
  };
}
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
function inRange(val, r) {
  const lo = num(r?.min), hi = num(r?.max);
  if (lo == null && hi == null) return true;
  if (val == null) return false;
  return (lo == null || val >= lo) && (hi == null || val <= hi);
}
export function activeFilterCount(f) {
  let n = 0;
  for (const k of ['cats', 'colors', 'levels', 'traits', 'keywords', 'tags', 'packs', 'rarities']) if (f[k]?.length) n++;
  for (const k of ['cost', 'dp', 'evo']) if (num(f[k]?.min) != null || num(f[k]?.max) != null) n++;
  if (f.mono) n++; if (f.hasPar) n++; if (f.setKey) n++; if (f.inDeck) n++; if (f.hideMax) n++;
  return n;
}
// ctx = { copies(id) -> copies in deck, max(id) -> limit }
export function matchFilters(f, c, b, ctx) {
  if (f.cats.length && !f.cats.includes(c.category)) return false;
  if (f.colors.length && !f.colors.some(col => (c.colors || []).includes(col))) return false;
  if (f.mono && (c.colors || []).length !== 1) return false;
  if (f.levels.length && !f.levels.includes(c.level)) return false;
  if (!inRange(c.cost, f.cost) || !inRange(c.dp, f.dp) || !inRange(b.evoCost, f.evo)) return false;
  if (f.traits.length) {
    const have = [...(c.types || []), c.attribute, c.form];
    if (!f.traits.every(t => have.includes(t))) return false;
  }
  if (f.keywords.length && !f.keywords.every(k => b.kw.has(k))) return false;
  if (f.tags.length && !f.tags.every(k => b.tags.has(k))) return false;
  if (f.packs.length && !f.packs.includes(b.prefix)) return false;
  if (f.setKey && b.setKey !== f.setKey) return false;
  // rarity: the base OR any parallel variant of the same card number matches
  if (f.rarities.length && !f.rarities.includes(c.rarity) && !(b.par || []).some(r => f.rarities.includes(r))) return false;
  if (f.hasPar && !(b.parN > 0)) return false;
  if (ctx) {
    if (f.inDeck && !(ctx.copies(c.id) > 0)) return false;
    if (f.hideMax && ctx.copies(c.id) >= ctx.max(c.id)) return false;
  }
  return true;
}
export function sortIds(ids, f, cards, ix) {
  const key = f.sort;
  const nul = (v, dir = 1) => (v == null ? Infinity : v * dir);
  const cmp = {
    id: (a, b) => ix.get(a).order - ix.get(b).order,
    name: (a, b) => (cards[a].nameKo || '').localeCompare(cards[b].nameKo || '', 'ko') || ix.get(a).order - ix.get(b).order,
    level: (a, b) => nul(cards[a].level) - nul(cards[b].level) || ix.get(a).order - ix.get(b).order,
    cost: (a, b) => nul(cards[a].cost) - nul(cards[b].cost) || ix.get(a).order - ix.get(b).order,
    dp: (a, b) => nul(cards[a].dp) - nul(cards[b].dp) || ix.get(a).order - ix.get(b).order,
  }[key] || null;
  return cmp ? ids.slice().sort(cmp) : ids;
}
export function runSearch(f, cards, ix, ctx) {
  const pq = parseQuery(f.q);
  const ids = [];
  for (const id of Object.keys(cards)) {
    const b = ix.get(id), c = cards[id];
    if (!matchCard(pq, b, f.scope)) continue;
    if (!matchFilters(f, c, b, ctx)) continue;
    ids.push(id);
  }
  return { ids: sortIds(ids, f, cards, ix), terms: highlightTerms(pq) };
}
