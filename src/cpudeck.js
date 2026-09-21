// CPU deck-building AI (pure logic: no DOM, works in the browser and in node).
//   * legal-deck generator  : genGenome / compile  (colours -> evolution LINES (egg -> Lv3 -> Lv4 -> Lv5 [-> Lv6]) + tamers/options -> 50 main + 3..5 digitama)
//   * evolutionary operators: crossover (swap whole evolution lines / colour packages) + mutate  (used by scripts/evolve-decks.mjs, offline training)
//   * runtime API           : loadCpuDecks / pickCpuDeck (evolved decks shipped in data/cpu-decks.json) and buildDeckFromCollection
//                             (fast heuristic "CPU가 내 카드로 덱 추천": card-pool restriction -> legal strong deck)
// The engine (state.js / engine.js) supplies every rule: legality = S.deckLegality, evolution = E.canEvolveAny (the same code the game uses).
import * as S from './state.js';
import * as E from './engine.js';
import { makeEnv, deckCheckup, COLOR_KO } from './decktools.js';

export const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
export { COLOR_KO };

export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- cards the generator must not use: manual-fallback effects (docs/manual-effects.md; shipped as data/cpu-decks.json "avoid") ----
const AVOID = new Set();
export function setAvoid(ids) { AVOID.clear(); for (const i of ids || []) AVOID.add(i); ALL_CACHE = null; PRIOR.clear(); }
export function getAvoid() { return AVOID; }

// ---- static card prior (rough strength, only used to bias sampling / the heuristic builder; the evolutionary search decides the truth) ----
const LV_DP = { 3: 3000, 4: 5000, 5: 7000, 6: 10000 };
const LV_COST = { 3: 3, 4: 5, 5: 7, 6: 12 };
const KW = [[/블로커/, 1.0], [/재기동/, 0.8], [/리부트/, 1.6], [/관통/, 0.9], [/시큐리티\s*어택\s*\+/, 1.1], [/회피/, 0.7], [/급습/, 1.3], [/충돌/, 0.4], [/리커버리\s*\+/, 0.8], [/제트\s*진화|진격|디코드|드로우|카드를\s*\d장\s*뽑/, 0.3]];
const PRIOR = new Map();
export const LEARNED = new Map(); // id -> bonus learned from the evolved decks (loadCpuDecks fills it)
export function prior(id) {
  let v = PRIOR.get(id);
  if (v === undefined) {
    const c = S.card(id); const txt = `${c.effectKo || ''}\n${c.inheritedKo || ''}`; let p = 0;
    if (c.category === 'digimon') {
      const lv = c.level;
      p += ((c.dp || 0) - (LV_DP[lv] || 5000)) / 2500;
      p -= ((c.cost || 0) - (LV_COST[lv] || 5)) * 0.1;
      if (c.evoNormal) p -= ((c.evoNormal.cost || 0) - 3) * 0.2;
      for (const [re, w] of KW) if (re.test(txt)) p += w;
      if (/【등장 시】|【진화 시】|【어택 시】|【소멸 시】/.test(txt)) p += 0.35;
      if (c.inheritedKo) p += 0.25;
    } else if (c.category === 'tamer') {
      p = 0.4 + (/메모리/.test(txt) ? 0.8 : 0) + ((c.cost || 9) <= 2 ? 0.4 : 0) + (/드로우|카드를\s*\d장\s*뽑|오픈/.test(txt) ? 0.3 : 0);
    } else if (c.category === 'option') {
      p = 0.2 - (c.cost || 0) * 0.05 + (/【카운터】/.test(txt) ? 0.35 : 0) + (/【메인】/.test(txt) ? 0.15 : 0);
    }
    v = p; PRIOR.set(id, v);
  }
  return v + (LEARNED.get(id) || 0);
}

// ---- eligible cards ----
let ALL_CACHE = null;
function allCards() {
  if (ALL_CACHE) return ALL_CACHE;
  ALL_CACHE = Object.values(S.CARDS).filter((c) => !c.isParallel && !c.isToken && !AVOID.has(c.id) && (c.colors || []).length && (
    (c.category === 'digitama' && c.level === 2) ||
    (c.category === 'digimon' && c.level >= 3 && c.level <= 6 && c.dp != null && c.cost != null) ||
    (c.category === 'tamer' && c.cost != null) ||
    (c.category === 'option' && c.cost != null)));
  return ALL_CACHE;
}

const EDGE = new Map();
function evoCost(a, b) { // evolution cost a -> b or -1 (E.canEvolveAny = the game's own condition check: level / colour / name / trait conditions)
  const k = a + '>' + b; let v = EDGE.get(k);
  if (v === undefined) { try { const r = E.canEvolveAny(a, b, [], null); v = r && r.ok ? r.cost : -1; } catch (e) { v = -1; } EDGE.set(k, v); }
  return v;
}

// opts: { colors:[..]|null, allow(card)->bool, owned:{id:n}|null (collection: only these cards, at most n copies each) }
export function makePool(o = {}) {
  const cols = o.colors && o.colors.length ? o.colors.slice() : null;
  const owned = o.owned || null;
  const P = { colors: cols, byLv: { 3: [], 4: [], 5: [], 6: [] }, eggs: [], tamers: [], options: [], memo: new Map(), owned };
  P.cap = (id) => { const m = S.maxCopiesFor(id); return owned ? Math.min(m, owned[id] || 0) : m; };
  for (const c of allCards()) {
    if (cols && !c.colors.every((x) => cols.includes(x))) continue;
    if (o.allow && !o.allow(c)) continue;
    if (owned && !(owned[c.id] > 0)) continue;
    if (c.category === 'digitama') P.eggs.push(c);
    else if (c.category === 'digimon') P.byLv[c.level].push(c);
    else if (c.category === 'tamer') P.tamers.push(c);
    else P.options.push(c);
  }
  P.succ = (id) => { const k = 's' + id; let v = P.memo.get(k); if (!v) { const lv = S.card(id).level; v = (P.byLv[lv + 1] || []).filter((b) => evoCost(id, b.id) >= 0); P.memo.set(k, v); } return v; };
  P.eggsOk = P.eggs.filter((e) => P.succ(e.id).length);
  return P;
}
const POOLS = new Map();
export function defaultPool(colors) { const k = [...colors].sort().join('+'); let p = POOLS.get(k); if (!p) { p = makePool({ colors }); POOLS.set(k, p); } return p; }
export function clearPools() { POOLS.clear(); }

function wpick(arr, rng, wf, boost) {
  if (!arr.length) return null;
  const w = arr.map((x) => Math.exp(0.55 * (wf ? wf(x) : prior(x.id))) * (boost ? boost(x) : 1));
  let t = w.reduce((a, b) => a + b, 0) * rng();
  for (let i = 0; i < arr.length; i++) { t -= w[i]; if (t <= 0) return arr[i]; }
  return arr[arr.length - 1];
}
function wpickN(arr, n, rng, boost) { const a = arr.slice(), out = []; while (out.length < n && a.length) { const x = wpick(a, rng, null, boost); out.push(x); a.splice(a.indexOf(x), 1); } return out; }
const hintBoost = (hint) => (hint ? (c) => ((c.colors || []).includes(hint) ? 3 : 1) : null);

// ---- genome: { colors, lines:[{egg:{id,n}, nodes:[{id,n,lv}]}], support:[{id,n}] } ----
export function genLine(pool, rng, o = {}) {
  const boost = hintBoost(o.hint);
  let best = null;
  for (let t = 0; t < 25; t++) {
    let eggs = pool.eggsOk; if (o.hint) { const h = eggs.filter((e) => e.colors.includes(o.hint)); if (h.length) eggs = h; }
    const egg = o.egg ? S.card(o.egg) : wpick(eggs, rng, () => 0);
    if (!egg) return null;
    let cur = [egg]; const nodes = []; const used = new Set();
    for (const lv of [3, 4, 5, 6]) {
      let cand = []; const seen = new Set();
      for (const x of cur) for (const b of pool.succ(x.id)) if (!seen.has(b.id) && !used.has(b.id) && pool.cap(b.id) > 0) { seen.add(b.id); cand.push(b); }
      if (!cand.length) break;
      if (lv === 6 && rng() < 0.3) break;
      const k = lv === 6 ? 1 : (rng() < 0.35 ? 2 : 1);
      const chosen = wpickN(cand, k, rng, boost);
      const total = { 3: 4 + (rng() < 0.4 ? 1 : 0), 4: 3 + (rng() < 0.5 ? 1 : 0), 5: 2 + (rng() < 0.25 ? 1 : 0), 6: 1 + (rng() < 0.3 ? 1 : 0) }[lv];
      let left = total;
      chosen.forEach((c, i) => { const n = i === chosen.length - 1 ? left : Math.ceil(left / (chosen.length - i)); const nn = Math.max(1, Math.min(pool.cap(c.id), n)); left -= nn; nodes.push({ id: c.id, n: nn, lv }); used.add(c.id); });
      cur = chosen;
    }
    const line = { egg: { id: egg.id, n: 1 + (rng() < 0.4 ? 1 : 0) }, nodes };
    if (!best || nodes.length > best.nodes.length) best = line;
    if (nodes.some((x) => x.lv >= 5)) return line;
  }
  return best;
}

function genSupport(pool, rng, hintCols) {
  const out = [];
  const nT = 1 + (rng() < 0.5 ? 1 : 0);
  let tot = 0; const tt = 3 + Math.floor(rng() * 3);
  for (const c of wpickN(pool.tamers, nT, rng)) { const n = Math.min(pool.cap(c.id), Math.max(1, Math.min(4, Math.round(tt / nT)))); if (n > 0) { out.push({ id: c.id, n }); tot += n; } }
  const nO = 2 + Math.floor(rng() * 3), to = 4 + Math.floor(rng() * 5);
  for (const c of wpickN(pool.options, nO, rng)) { const n = Math.min(pool.cap(c.id), Math.max(1, Math.min(4, Math.round(to / nO)))); if (n > 0) out.push({ id: c.id, n }); }
  return out;
}

export function colorCombos(pool0) { // feasible 1- and 2-colour sets
  const res = [];
  for (const a of COLORS) res.push([a]);
  for (let i = 0; i < COLORS.length; i++) for (let j = i + 1; j < COLORS.length; j++) res.push([COLORS[i], COLORS[j]]);
  return res;
}

export function genGenome(rng, ctx = {}) {
  const poolFor = ctx.poolFor || defaultPool;
  let cols = ctx.colors;
  for (let t = 0; t < 40; t++) {
    if (!ctx.colors) { const combos = ctx.combos || colorCombos(); cols = combos[Math.floor(rng() * combos.length)]; }
    const pool = poolFor(cols);
    if (pool.eggsOk.length < 1 || pool.byLv[3].length < 4 || pool.byLv[4].length < 4) { if (ctx.colors) break; continue; }
    const nl = 3 + (rng() < 0.4 ? 1 : 0);
    const lines = [];
    for (let i = 0; i < nl; i++) {
      const hint = cols.length > 1 ? cols[i % cols.length] : null;
      const l = genLine(pool, rng, { hint });
      if (l && !lines.some((x) => x.egg.id === l.egg.id && x.nodes[0] && l.nodes[0] && x.nodes[0].id === l.nodes[0].id)) lines.push(l);
    }
    if (!lines.length) continue;
    return { colors: cols.slice(), lines, support: genSupport(pool, rng, cols) };
  }
  return null;
}

// ---- compile a genome into a legal {name, main, digitama, colors} (or null) ----
export function deckColors(deck) {
  const set = new Set();
  for (const z of ['main', 'digitama']) for (const id of Object.keys(deck[z] || {})) { const c = S.card(id); if (c.category === 'option') continue; for (const x of c.colors || []) set.add(x); }
  return COLORS.filter((x) => set.has(x));
}
export function compile(G, rng, ctx = {}) {
  const poolFor = ctx.poolFor || defaultPool;
  const pool = poolFor(G.colors);
  const deck = { main: {}, digitama: {} };
  const room = (id) => Math.max(0, pool.cap(id) - S.copiesTowardLimit(deck, id));
  const put = (zone, id, n) => { const k = Math.min(n, room(id)); if (k > 0) deck[zone][id] = (deck[zone][id] || 0) + k; return Math.max(0, k); };
  const entries = []; // {id, group, lv}
  const reg = (id, group, lv) => { if (!entries.some((e) => e.id === id)) entries.push({ id, group, lv }); };
  for (const l of G.lines) {
    if (S.card(l.egg.id).category === 'digitama' && l.egg.n > 0) put('digitama', l.egg.id, l.egg.n);
    for (const nd of l.nodes) { if (S.card(nd.id).category !== 'digimon') continue; if (put('main', nd.id, nd.n) > 0) reg(nd.id, 'line', nd.lv); }
  }
  for (const s of G.support || []) { const c = S.card(s.id); if (c.category === 'option' || c.category === 'tamer') if (put('main', s.id, s.n) > 0) reg(s.id, 'support', 0); }
  for (const x of G.extra || []) { const c = S.card(x.id); if (c.category === 'digimon' && pool.cap(x.id) > 0 && put('main', x.id, x.n) > 0) reg(x.id, 'fill', c.level); }
  // option colour requirement (4-22): each option colour needs >=6 digimon/tamer cards of that colour, else drop the option
  const colorSupport = () => { const m = {}; for (const [id, n] of Object.entries({ ...deck.main, ...deck.digitama })) { const c = S.card(id); if (c.category === 'option') continue; for (const x of c.colors || []) m[x] = (m[x] || 0) + n; } return m; };
  const dropBadOptions = () => { const sp = colorSupport(); for (const id of Object.keys(deck.main)) { const c = S.card(id); if (c.category === 'option' && (c.colors || []).some((x) => (sp[x] || 0) < 6)) delete deck.main[id]; } };
  dropBadOptions();
  const total = () => sum(deck.main);
  const grpW = { fill: 10, support: 6, line: 0 };
  const grpOf = (id) => (entries.find((e) => e.id === id) || { group: 'fill' }).group;
  let guard = 0;
  while (total() > 50 && guard++ < 200) { // trim: filler first, then support, then the fattest line node
    const cand = Object.keys(deck.main).map((id) => ({ id, w: grpW[grpOf(id)] + deck.main[id] * 2 + rng() * 3 - (grpOf(id) === 'line' && deck.main[id] <= 1 ? 100 : 0) }));
    cand.sort((a, b) => b.w - a.w); const t = cand[0]; if (!t) break;
    deck.main[t.id]--; if (!deck.main[t.id]) delete deck.main[t.id];
  }
  guard = 0;
  while (total() < 50 && guard++ < 400) { // fill: thicken the line nodes (Lv3/4 first), else add successors of line cards, else support
    const cand = entries.filter((e) => e.group === 'line' && deck.main[e.id] && room(e.id) > 0);
    const r = rng();
    if (cand.length && r < 0.7) { const e = wpick(cand, rng, (x) => ({ 3: 1.2, 4: 1.2, 5: -0.2, 6: -1.5 }[x.lv] || 0)); put('main', e.id, 1); continue; }
    const lineIds = entries.filter((e) => e.group === 'line');
    if (lineIds.length && r < 0.9) {
      const e = lineIds[Math.floor(rng() * lineIds.length)]; const lv = S.card(e.id).level;
      const opts = [...(pool.byLv[lv + 1] || []).filter((b) => evoCost(e.id, b.id) >= 0), ...(pool.byLv[lv] || [])].filter((b) => room(b.id) > 0 && b.level <= 5 && b.level >= 3);
      const c = wpick(opts.filter((b) => b.level <= 5), rng); if (c) { if (put('main', c.id, 1) > 0) reg(c.id, 'fill', c.level); continue; }
    }
    const sup = [...pool.tamers, ...pool.options].filter((c) => room(c.id) > 0 && (deck.main[c.id] || 0) < 3);
    const c = wpick(sup, rng); if (c && put('main', c.id, 1) > 0) { reg(c.id, 'support', 0); dropBadOptions(); continue; }
    const any = [...pool.byLv[3], ...pool.byLv[4]].filter((b) => room(b.id) > 0); const d = wpick(any, rng); if (d && put('main', d.id, 1) > 0) reg(d.id, 'fill', d.level); else break;
  }
  // digitama deck: 3..5 (target 4-5), only eggs that lead somewhere in this deck
  const lv3 = Object.keys(deck.main).filter((id) => S.card(id).level === 3);
  const eggLeads = (id) => lv3.some((x) => evoCost(id, x) >= 0);
  for (const id of Object.keys(deck.digitama)) if (!eggLeads(id)) delete deck.digitama[id];
  while (sum(deck.digitama) > 5) { const k = Object.keys(deck.digitama).sort((a, b) => deck.digitama[b] - deck.digitama[a])[0]; deck.digitama[k]--; if (!deck.digitama[k]) delete deck.digitama[k]; }
  guard = 0;
  while (sum(deck.digitama) < 4 && guard++ < 30) {
    const have = Object.keys(deck.digitama).filter((id) => room(id) > 0);
    const eggs = have.length && rng() < 0.6 ? have.map((id) => S.card(id)) : pool.eggs.filter((e) => eggLeads(e.id) && room(e.id) > 0);
    const e = wpick(eggs, rng, () => 0); if (!e) break; put('digitama', e.id, 1);
  }
  if (sum(deck.digitama) < 3) return null;
  const lg = S.deckLegality(deck);
  if (!lg.ok) return null;
  deck.colors = deckColors(deck);
  deck.name = nameDeck(deck);
  return deck;
}
// make the genome describe exactly the compiled deck (counts as compiled + the random filler recorded in g.extra) so breeding is deterministic
export function syncGenome(G, deck) {
  const g = clone(G); const inLine = new Set();
  for (const l of g.lines) { l.egg.n = deck.digitama[l.egg.id] || 0; l.nodes = l.nodes.filter((x) => deck.main[x.id]); for (const x of l.nodes) { x.n = deck.main[x.id]; inLine.add(x.id); } }
  g.lines = g.lines.filter((l) => l.nodes.length);
  g.support = (g.support || []).filter((x) => deck.main[x.id]).map((x) => ({ id: x.id, n: deck.main[x.id] }));
  const sup = new Set(g.support.map((x) => x.id));
  g.extra = Object.keys(deck.main).filter((id) => !inLine.has(id) && !sup.has(id) && S.card(id).category === 'digimon').map((id) => ({ id, n: deck.main[id] }));
  const extraOpt = Object.keys(deck.main).filter((id) => !inLine.has(id) && !sup.has(id) && S.card(id).category !== 'digimon');
  for (const id of extraOpt) g.support.push({ id, n: deck.main[id] });
  g.colors = deck.colors ? deck.colors.slice() : g.colors;
  return g;
}
export function nameDeck(deck) {
  const ids = Object.keys(deck.main).map((id) => S.card(id)).filter((c) => c.category === 'digimon').sort((a, b) => (b.level - a.level) || (deck.main[b.id] - deck.main[a.id]));
  const top = ids[0]; const cols = (deck.colors || deckColors(deck)).map((x) => COLOR_KO[x] || x).join('/');
  return `${cols} ${top ? top.nameKo : '혼합'} 덱`;
}
export function deckHash(deck) {
  const f = (o) => Object.keys(o).sort().map((k) => k + ':' + o[k]).join(',');
  return f(deck.main) + '|' + f(deck.digitama);
}

// ---- genetic operators ----
export function mutate(G, rng, ctx = {}) {
  const poolFor = ctx.poolFor || defaultPool;
  const g = clone(G); let pool = poolFor(g.colors);
  const nOps = 1 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
  for (let o = 0; o < nOps; o++) {
    const r = rng();
    if (r < 0.28 && g.lines.length) { // swap a card inside a line for a compatible one
      const l = g.lines[Math.floor(rng() * g.lines.length)];
      if (l.nodes.length) {
        const ni = Math.floor(rng() * l.nodes.length), nd = l.nodes[ni]; const lv = nd.lv;
        const prevIds = lv === 3 ? [l.egg.id] : l.nodes.filter((x) => x.lv === lv - 1).map((x) => x.id);
        const nextIds = l.nodes.filter((x) => x.lv === lv + 1).map((x) => x.id);
        const cand = (pool.byLv[lv] || []).filter((c) => c.id !== nd.id && !l.nodes.some((x) => x.id === c.id) && pool.cap(c.id) > 0 && prevIds.some((p) => evoCost(p, c.id) >= 0) && (!nextIds.length || nextIds.some((n) => evoCost(c.id, n) >= 0)));
        const c = wpick(cand, rng); if (c) { nd.id = c.id; nd.n = Math.min(nd.n, pool.cap(c.id)); }
      }
    } else if (r < 0.46 && g.lines.length) { // change a copy count
      const l = g.lines[Math.floor(rng() * g.lines.length)]; const all = [...l.nodes];
      if (all.length) { const nd = all[Math.floor(rng() * all.length)]; nd.n = Math.max(1, Math.min(pool.cap(nd.id) || 4, nd.n + (rng() < 0.5 ? 1 : -1))); }
    } else if (r < 0.58 && g.lines.length) { // regenerate a whole line
      const i = Math.floor(rng() * g.lines.length); const hint = g.colors.length > 1 ? g.colors[Math.floor(rng() * g.colors.length)] : null;
      const l = genLine(pool, rng, { hint }); if (l) g.lines[i] = l;
    } else if (r < 0.66) { // add / remove a line
      if (g.lines.length < 4 && rng() < 0.6) { const l = genLine(pool, rng, {}); if (l) g.lines.push(l); }
      else if (g.lines.length > 2) g.lines.splice(Math.floor(rng() * g.lines.length), 1);
    } else if (r < 0.74 && g.lines.length) { // extend / cut the top of a line (Lv6 / Lv5)
      const l = g.lines[Math.floor(rng() * g.lines.length)]; const top = Math.max(...l.nodes.map((x) => x.lv), 2);
      if (top < 6 && rng() < 0.6) { const prev = l.nodes.filter((x) => x.lv === top); const cand = []; for (const p of prev) for (const b of pool.succ(p.id)) if (!l.nodes.some((x) => x.id === b.id) && pool.cap(b.id) > 0) cand.push(b); const c = wpick(cand, rng); if (c) l.nodes.push({ id: c.id, n: 1 + (rng() < 0.3 ? 1 : 0), lv: top + 1 }); }
      else if (top >= 5) { const drop = l.nodes.filter((x) => x.lv === top); if (drop.length && l.nodes.length > 2) l.nodes = l.nodes.filter((x) => x.lv !== top); }
    } else if (r < 0.86) { // support: swap / re-count
      g.support = g.support || [];
      if (g.support.length && rng() < 0.5) g.support.splice(Math.floor(rng() * g.support.length), 1);
      const c = wpick(rng() < 0.4 ? pool.tamers : pool.options, rng);
      if (c && !g.support.some((x) => x.id === c.id)) g.support.push({ id: c.id, n: 1 + Math.floor(rng() * Math.min(4, pool.cap(c.id) || 1)) });
      else if (g.support.length) { const s = g.support[Math.floor(rng() * g.support.length)]; s.n = Math.max(1, Math.min(4, s.n + (rng() < 0.5 ? 1 : -1))); }
    } else if (r < 0.90 && (g.extra || []).length) { // re-roll some filler
      const k = 1 + Math.floor(rng() * 3); for (let i = 0; i < k && g.extra.length; i++) g.extra.splice(Math.floor(rng() * g.extra.length), 1);
    } else if (r < 0.95 && g.lines.length) { // egg swap
      const l = g.lines[Math.floor(rng() * g.lines.length)]; const first = l.nodes.find((x) => x.lv === 3);
      const cand = pool.eggs.filter((e) => e.id !== l.egg.id && (!first || evoCost(e.id, first.id) >= 0));
      const e = wpick(cand, rng, () => 0); if (e) l.egg = { id: e.id, n: l.egg.n };
    } else { // colour package change: keep the lines that survive, re-roll the rest in the new colour set
      const cur = g.colors.slice(); let nc;
      if (cur.length === 1) nc = rng() < 0.6 ? [cur[0], COLORS[Math.floor(rng() * 7)]] : [COLORS[Math.floor(rng() * 7)]];
      else nc = rng() < 0.3 ? [cur[Math.floor(rng() * 2)]] : [cur[Math.floor(rng() * 2)], COLORS[Math.floor(rng() * 7)]];
      nc = [...new Set(nc)];
      const np = poolFor(nc);
      if (np.eggsOk.length) {
        g.colors = nc; pool = np;
        const cc = (id) => S.card(id).colors.every((x) => nc.includes(x));
        g.lines = g.lines.filter((l) => cc(l.egg.id) && l.nodes.every((x) => cc(x.id)));
        while (g.lines.length < 3) { const l = genLine(np, rng, { hint: nc.length > 1 ? nc[g.lines.length % nc.length] : null }); if (!l) break; g.lines.push(l); }
        g.support = (g.support || []).filter((s) => cc(s.id));
        if (g.support.length < 2) g.support = g.support.concat(genSupport(np, rng, nc));
      }
    }
  }
  g.colors = [...new Set(g.colors)];
  return g;
}

export function crossover(A, B, rng, ctx = {}) {
  const poolFor = ctx.poolFor || defaultPool;
  const cols = A.colors.join() === B.colors.join() ? A.colors.slice() : (() => { const u = [...new Set([...A.colors, ...B.colors])]; return u.length <= 2 ? u : (rng() < 0.5 ? A.colors.slice() : B.colors.slice()); })();
  const pool = poolFor(cols);
  const ok = (l) => S.card(l.egg.id).colors.every((x) => cols.includes(x)) && l.nodes.every((x) => S.card(x.id).colors.every((y) => cols.includes(y)) && pool.cap(x.id) > 0);
  const cand = [...A.lines.filter(ok).map((l) => ({ l: clone(l), from: 'A' })), ...B.lines.filter(ok).map((l) => ({ l: clone(l), from: 'B' }))];
  // package crossover: take each parent's lines with prob 0.5, at least 2 lines, at most 4, no duplicate eggs
  const child = { colors: cols, lines: [], support: [] };
  const order = cand.sort(() => rng() - 0.5);
  for (const c of order) { if (child.lines.length >= 4) break; if (child.lines.some((x) => x.egg.id === c.l.egg.id)) continue; if (rng() < 0.6 || child.lines.length < 2) child.lines.push(c.l); }
  while (child.lines.length < 3) { const l = genLine(pool, rng, { hint: cols.length > 1 ? cols[child.lines.length % cols.length] : null }); if (!l) break; child.lines.push(l); }
  const supA = A.support || [], supB = B.support || [];
  const src = rng() < 0.5 ? supA : supB;
  child.support = clone(src).filter((s) => S.card(s.id).colors.every((x) => cols.includes(x)) && pool.cap(s.id) > 0);
  if (rng() < 0.35) for (const s of clone(rng() < 0.5 ? supB : supA)) if (!child.support.some((x) => x.id === s.id) && S.card(s.id).colors.every((x) => cols.includes(x)) && pool.cap(s.id) > 0 && child.support.length < 6) child.support.push(s);
  if (!child.support.length) child.support = genSupport(pool, rng, cols);
  return child;
}

// ---- validation (legality + sample-hand checkup errors) ----
let ENV = null;
export function checkDeck(deck) {
  const lg = S.deckLegality(deck);
  const errors = lg.errors.slice();
  try { ENV = ENV || makeEnv(S, E); for (const f of deckCheckup(deck, ENV)) if (f.level === 'error' && f.code !== 'legal') errors.push(`${f.code}: ${f.title}`); } catch (e) { errors.push('checkup exception: ' + e.message); }
  return { ok: errors.length === 0, errors };
}

// ---- deck style (for pickCpuDeck) ----
export function deckStyle(deck) {
  let d = 0, lvSum = 0, low = 0, tamerOpt = 0;
  for (const [id, n] of Object.entries(deck.main)) { const c = S.card(id); if (c.category === 'digimon') { d += n; lvSum += n * c.level; if (c.level <= 4) low += n; } else tamerOpt += n; }
  const avg = d ? lvSum / d : 4;
  if (avg <= 3.95 && tamerOpt <= 12) return 'aggro';
  if (tamerOpt >= 15) return 'control';
  return avg >= 4.25 ? 'ramp' : 'midrange';
}

// ================================================================= runtime API =================================================================
let CPU_DECKS = null;
export function getLoadedDecks() { return CPU_DECKS; }
function ingest(j) {
  const arr = Array.isArray(j) ? j : (j && j.decks) || [];
  const avoid = (j && j.avoid) || [];
  if (avoid.length) setAvoid(avoid);
  CPU_DECKS = arr.filter((d) => d && d.main && d.digitama);
  // learned card prior: cards that show up in strong evolved decks get a small bonus (helps buildDeckFromCollection)
  LEARNED.clear();
  const cnt = {}; let tw = 0;
  for (const d of CPU_DECKS) { const w = Math.max(0, (d.winrate || 0.5) - 0.45) * 10; tw += w; for (const id of Object.keys(d.main)) cnt[id] = (cnt[id] || 0) + w; }
  for (const [id, w] of Object.entries(cnt)) LEARNED.set(id, Math.min(1.5, (w / Math.max(1, tw)) * 12));
  return CPU_DECKS;
}
export async function loadCpuDecks(url = './data/cpu-decks.json') {
  if (CPU_DECKS) return CPU_DECKS;
  try { const r = await fetch(url); return ingest(await r.json()); } catch (e) { CPU_DECKS = []; return CPU_DECKS; }
}
export function setCpuDecks(json) { return ingest(json); }

// pickCpuDeck({colors?, style?, rng?, decks?, level?}) -> {name, main, digitama, colors, winrate, ...} | null
//   colors: allowed colours (deck colours must be a subset; falls back to "shares a colour")   style: 'strong'|'random'|'aggro'|'midrange'|'ramp'|'control'
export function pickCpuDeck(o = {}) {
  const rng = o.rng || Math.random; const decks = o.decks || CPU_DECKS || [];
  if (!decks.length) return null;
  let cand = decks.slice();
  if (o.colors && o.colors.length) {
    const sub = cand.filter((d) => (d.colors || []).every((c) => o.colors.includes(c)));
    cand = sub.length ? sub : cand.filter((d) => (d.colors || []).some((c) => o.colors.includes(c)));
    if (!cand.length) cand = decks.slice();
  }
  const st = o.style || 'strong';
  if (['aggro', 'midrange', 'ramp', 'control'].includes(st)) { const sc = cand.filter((d) => deckStyle(d) === st); if (sc.length) cand = sc; }
  let d;
  if (st === 'random') d = cand[Math.floor(rng() * cand.length)];
  else { const w = cand.map((x) => Math.exp(((x.winrate || 0.5) - 0.5) * 14)); let t = w.reduce((a, b) => a + b, 0) * rng(); d = cand[cand.length - 1]; for (let i = 0; i < cand.length; i++) { t -= w[i]; if (t <= 0) { d = cand[i]; break; } } }
  return { ...clone(d), name: d.name };
}

// static (simulation-free) quality estimate: prior mass + curve fit + structure penalties
const IDEAL = { 3: 14, 4: 11, 5: 7, 6: 3 };
export function staticScore(deck) {
  let s = 0; const lv = { 3: 0, 4: 0, 5: 0, 6: 0 }; let tam = 0, opt = 0;
  for (const [id, n] of Object.entries(deck.main)) { const c = S.card(id); s += n * prior(id) * 0.25; if (c.category === 'digimon') lv[c.level] = (lv[c.level] || 0) + n; else if (c.category === 'tamer') tam += n; else opt += n; }
  for (const k of [3, 4, 5, 6]) s -= Math.abs((lv[k] || 0) - IDEAL[k]) * 0.4;
  s -= Math.abs(tam - 4) * 0.3 + Math.abs(opt - 6) * 0.15;
  const dn = sum(deck.digitama); if (dn < 4) s -= (4 - dn) * 0.8;
  const cols = deckColors(deck); if (cols.length > 2) s -= 4;
  return s;
}

// buildDeckFromCollection({owned?, sets?, allow?, colors?, rng?, tries?, name?}) -> {ok, deck?, reason?}
//   owned : {cardId: copies}  (a collection)       sets : ['BT1','ST3',...] card-number prefixes  (a card pool = the chosen sets)      allow : (card)=>bool
//   colors: restrict to these colours (1-2 used)    The result is legal (S.deckLegality) and passes the checkup errors; deterministic for a given rng.
export function buildDeckFromCollection(o = {}) {
  const rng = o.rng || Math.random;
  const setSet = o.sets && o.sets.length ? new Set(o.sets.map((x) => String(x).toUpperCase())) : null;
  const allow = (c) => { if (setSet && !setSet.has(String(c.id).split('-')[0].toUpperCase())) return false; return o.allow ? !!o.allow(c) : true; };
  const owned = o.owned || null;
  const mk = (cols) => makePool({ colors: cols, allow, owned });
  const cache = new Map(); const poolFor = (cols) => { const k = [...cols].sort().join('+'); let p = cache.get(k); if (!p) { p = mk(cols); cache.set(k, p); } return p; };
  const ctx = { poolFor };
  // 1) a shipped evolved deck fully inside the pool wins outright (best win rate first)
  const inPool = (d) => Object.entries({ ...d.main, ...d.digitama }).every(([id, n]) => { const c = S.card(id); return allow(c) && (!owned || (owned[id] || 0) >= n); }) && (!o.colors || (d.colors || []).every((x) => o.colors.includes(x)));
  if (CPU_DECKS && CPU_DECKS.length && !o.forceGenerate) { const fit = CPU_DECKS.filter(inPool).sort((a, b) => (b.winrate || 0) - (a.winrate || 0)); if (fit.length) { const d = fit[Math.min(fit.length - 1, Math.floor(rng() * Math.min(3, fit.length)))]; const dk = { main: { ...d.main }, digitama: { ...d.digitama }, name: d.name, colors: d.colors }; if (S.deckLegality(dk).ok) return { ok: true, deck: dk, source: 'evolved', score: staticScore(dk) }; } }
  // 2) generate + hill-climb on the static score
  let combos = colorCombos();
  if (o.colors && o.colors.length) { const oc = o.colors.filter((x) => COLORS.includes(x)); combos = oc.length <= 2 ? [oc] : combos.filter((c) => c.every((x) => oc.includes(x))); }
  combos = combos.filter((c) => { const p = poolFor(c); return p.eggsOk.length && p.byLv[3].length >= 3 && p.byLv[4].length >= 3; });
  if (!combos.length) return { ok: false, reason: '이 카드 풀로는 디지타마 → 진화 라인을 만들 수 없습니다.' };
  const tries = o.tries || 60; let best = null;
  for (let t = 0; t < tries; t++) {
    let g = genGenome(rng, { ...ctx, combos }); if (!g) continue;
    let d = compile(g, rng, ctx); if (!d) continue;
    let sc = staticScore(d);
    for (let k = 0; k < 6; k++) { const g2 = mutate(g, rng, ctx); const d2 = compile(g2, rng, ctx); if (!d2) continue; const s2 = staticScore(d2); if (s2 > sc) { g = g2; d = d2; sc = s2; } }
    if (!best || sc > best.sc) best = { d, sc };
  }
  if (!best) return { ok: false, reason: '합법 덱을 만들 수 없습니다 (카드 부족).' };
  const chk = checkDeck(best.d);
  if (o.name) best.d.name = o.name;
  return { ok: chk.ok, deck: best.d, source: 'generated', score: best.sc, errors: chk.errors };
}
