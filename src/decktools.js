// Deck analysis tools (pure logic, no DOM) — unit-tested in scripts/test-decktools.mjs.
//   * deckStats      : counts / Lv / cost curve / colors / DP / keywords / traits / evolution coverage
//   * evoGraph       : which cards of the deck can evolve from which (via the game's own evolution-condition code)
//   * probability    : exact hypergeometric helpers + Monte-Carlo opening-hand batch (chunked, seedable)
//   * sample hand    : real opening procedure (5-card hand, one mulligan, 5 security from the top, digitama deck apart)
//   * deckCheckup    : list of warnings with plain-language reasons and the related card ids
//   * diffDecks / sortEntries / backup export+import helpers
// Everything game-specific is injected through `env` (see makeEnv) so the module runs in Node and in the browser.
import * as DBS from './dbsearch.js';

export const COLOR_KO = { red: '레드', blue: '블루', yellow: '옐로', green: '그린', black: '블랙', purple: '퍼플', white: '화이트' };
export const CAT_KO = { digimon: '디지몬', tamer: '테이머', option: '옵션', digitama: '디지타마' };

// env = { card(id), canEvolve(srcId,tgtId)->bool, legality(deck), parseJogress, parseDigiXros, parseAssembly, solveAssembly, altEvo(id)->string|null, maxCopies(id) }
export function makeEnv(S, E) {
  return {
    card: S.card,
    canEvolve: (s, t) => { try { return !!E.canEvolveAny(s, t, []).ok; } catch { return false; } },
    legality: S.deckLegality,
    parseJogress: S.parseJogress, parseDigiXros: S.parseDigiXros, parseAssembly: S.parseAssembly, solveAssembly: S.solveAssembly,
    maxCopies: S.maxCopiesFor,
    altEvo: (id) => {
      const t = `${S.card(id).effectKo || ''}`;
      if (S.parseBurstEvolution && S.parseBurstEvolution(id)) return '버스트 진화';
      if (S.parseAppFusion && S.parseAppFusion(id)) return '어플 합체';
      if (/취급하여\s*(?:진화\s*코스트\s*\d+(?:을|를|으로|로)\s*(?:지불하여\s*)?)?진화할\s*수\s*있다/.test(t)) return '테이머를 디지몬으로 취급해 진화';
      return null;
    },
  };
}

// ------------------------------------------------------------------ helpers
export const sumCounts = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
export function expand(zone) { const out = []; for (const [id, n] of Object.entries(zone || {})) for (let i = 0; i < n; i++) out.push(id); return out; }
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const isDigi = (c) => c.category === 'digimon';

// ------------------------------------------------------------------ evolution graph
const evoCache = new Map();
export function clearEvoCache() { evoCache.clear(); }
function canEvo(env, s, t) {
  const k = s + '>' + t;
  let v = evoCache.get(k);
  if (v === undefined) { v = !!env.canEvolve(s, t); evoCache.set(k, v); }
  return v;
}

// For every digimon (Lv.3+) in main and every card of the digitama deck: which deck cards can it evolve FROM (`sources`),
// which can it evolve INTO (`into`); reachability from the starters (digitama, Lv.2, Lv.3 may be played directly).
export function evoGraph(deck, env) {
  const mainIds = Object.keys(deck.main || {}), digIds = Object.keys(deck.digitama || {});
  const info = (id) => env.card(id);
  const digimon = mainIds.filter(id => isDigi(info(id)));
  const bases = [...new Set([...digIds, ...digimon])];         // possible evolution sources
  const sources = {}, into = {};
  for (const t of digimon) {
    const tc = info(t);
    if (!(tc.level >= 3)) continue;
    sources[t] = [];
    for (const s of bases) {
      if (s === t) continue;
      const sc = info(s);
      if ((sc.level || 0) >= (tc.level || 0)) continue;
      if (canEvo(env, s, t)) { sources[t].push(s); (into[s] = into[s] || []).push(t); }
    }
  }
  const starters = new Set([...digIds, ...digimon.filter(id => (info(id).level || 0) <= 3)]);
  const reach = new Set(starters);
  let grew = true;
  while (grew) { grew = false; for (const t of Object.keys(sources)) if (!reach.has(t) && sources[t].some(s => reach.has(s))) { reach.add(t); grew = true; } }
  const rootSet = new Set([...digIds, ...digimon.filter(id => (info(id).level || 0) <= 2)]);
  const orphans = [], altOnly = [], noRoot = [];
  for (const t of Object.keys(sources)) {
    const lv = info(t).level;
    if (lv >= 4 && !reach.has(t)) { const alt = env.altEvo ? env.altEvo(t) : null; (alt ? altOnly : orphans).push(t); }
    if (lv === 3 && !sources[t].some(s => rootSet.has(s))) noRoot.push(t);
  }
  const deadEnds = digIds.concat(digimon).filter(s => !(into[s] && into[s].length) && (info(s).level || 0) < 7 && (info(s).level || 0) >= 2 && !(info(s).level >= 6));
  return { sources, into, reach, orphans, altOnly, noRoot, deadEnds };
}

// ------------------------------------------------------------------ stats
export const DP_BUCKETS = [['≤2000', 0, 2000], ['3000-4000', 3000, 4000], ['5000-6000', 5000, 6000], ['7000-8000', 7000, 8000], ['9000-10000', 9000, 10000], ['11000+', 11000, Infinity]];

export function deckStats(deck, env, opts = {}) {
  const main = deck.main || {}, dig = deck.digitama || {};
  const st = {
    mainN: sumCounts(main), digN: sumCounts(dig),
    cat: { digimon: 0, tamer: 0, option: 0, digitama: sumCounts(dig) },
    lv: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }, lvDigitama: 0,
    curve: { digimon: Array(16).fill(0), tamer: Array(16).fill(0), option: Array(16).fill(0) },
    colors: {}, multiColor: 0, dp: DP_BUCKETS.map(b => ({ label: b[0], n: 0 })),
    keywords: {}, tags: {}, traits: {}, four: [], parN: 0,
    costSum: 0, costN: 0, digiCostSum: 0, digiCostN: 0, security: 0, securityIds: [],
    ace: 0,
  };
  for (const [id, n] of Object.entries(main)) {
    const c = env.card(id);
    if (st.cat[c.category] != null) st.cat[c.category] += n;
    if (c.category === 'digimon' && c.level >= 2 && c.level <= 7) st.lv[c.level] += n;
    const cost = c.cost;
    if (cost != null && st.curve[c.category]) { st.curve[c.category][Math.min(15, cost)] += n; st.costSum += cost * n; st.costN += n; if (c.category === 'digimon') { st.digiCostSum += cost * n; st.digiCostN += n; } }
    for (const col of c.colors || []) inc(st.colors, col, n);
    if ((c.colors || []).length > 1) st.multiColor += n;
    if (c.category === 'digimon' && c.dp != null) { const b = st.dp.find((x, i) => c.dp >= DP_BUCKETS[i][1] && c.dp <= DP_BUCKETS[i][2]) || st.dp[st.dp.length - 1]; b.n += n; }
    const text = (c.effectKo || '') + '\n' + (c.inheritedKo || '') + '\n' + (c.optionKo || '');
    for (const k of DBS.extractKeywords(text)) inc(st.keywords, k, n);
    for (const k of DBS.extractTags(text)) inc(st.tags, k, n);
    if (/^\s*【시큐리티】/m.test(text)) { st.security += n; st.securityIds.push(id); }
    for (const t of c.types || []) inc(st.traits, t, n);
    if (n >= 4) st.four.push(id);
    if (typeof c.nameDisplayKo === 'string' && /ACE$/.test(c.nameDisplayKo)) st.ace += n;
  }
  for (const [id, n] of Object.entries(dig)) {
    const c = env.card(id);
    st.lvDigitama += n;
    for (const col of c.colors || []) inc(st.colors, col, n);
    if (n >= 4) st.four.push(id);
    for (const t of c.types || []) inc(st.traits, t, n);
  }
  st.avgCost = st.costN ? st.costSum / st.costN : 0;
  st.avgDigiCost = st.digiCostN ? st.digiCostSum / st.digiCostN : 0;
  st.securityDensity = st.mainN ? st.security / st.mainN : 0;
  st.topTraits = Object.entries(st.traits).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8);
  st.parN = opts.parallelsChosen != null ? opts.parallelsChosen : Object.keys(deck.art || {}).filter(id => main[id] || dig[id]).length;
  if (opts.evo !== false) st.evo = evoGraph(deck, env);
  return st;
}

// ------------------------------------------------------------------ probability
export function comb(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
// P(X = k) drawing n cards from N containing K "hits" (hypergeometric)
export function hyperPmf(N, K, n, k) { return comb(K, k) * comb(N - K, n - k) / comb(N, n); }
export function hyperAtLeast(N, K, n, k = 1) { let p = 0; for (let i = k; i <= Math.min(K, n); i++) p += hyperPmf(N, K, n, i); return Math.min(1, p); }

export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// per-card flags of the (expanded) main deck
export function buildSimModel(deck, env) {
  const ids = expand(deck.main);
  const digIds = Object.keys(deck.digitama || {});
  const G = evoGraph(deck, env);
  const digSet = new Set(digIds);
  const flags = ids.map(id => {
    const c = env.card(id);
    const text = (c.effectKo || '') + '\n' + (c.inheritedKo || '') + '\n' + (c.optionKo || '');
    return {
      id, lv2: isDigi(c) && c.level === 2, lv3: isDigi(c) && c.level === 3, digi: isDigi(c),
      lowDigi: isDigi(c) && c.cost != null && c.cost <= 3, tamer: c.category === 'tamer', option: c.category === 'option' || !!c.dual, // (a dual card is also an Option card)
      blocker: /《\s*블로커\s*》/.test(text), fromDigitama: isDigi(c) && (G.sources[id] || []).some(s => digSet.has(s)),
      srcSet: new Set(G.sources[id] || []),
    };
  });
  return { ids, flags, digN: sumCounts(deck.digitama), graph: G };
}

function drawIdx(rng, N, k, arr) { // partial Fisher-Yates: first k of a fresh shuffle of 0..N-1
  for (let i = 0; i < N; i++) arr[i] = i;
  for (let i = 0; i < k; i++) { const j = i + Math.floor(rng() * (N - i)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
}
export function judgeHand(model, idxs) {
  const f = idxs.map(i => model.flags[i]);
  const hasLv3 = f.some(x => x.lv3), hasLow = f.some(x => x.lowDigi);
  const line = f.some(x => x.digi && (x.fromDigitama || f.some(y => y !== x && x.srcSet.has(y.id))));
  return {
    lineEgg: f.some(x => x.digi && x.fromDigitama), lv3: hasLv3, lv2: f.some(x => x.lv2), noLow: !hasLow, blocker: f.some(x => x.blocker), line,
    tamers: f.filter(x => x.tamer).length, options: f.filter(x => x.option).length,
    good: hasLv3 || hasLow,
  };
}

// Incremental Monte-Carlo batch: call step(k) repeatedly (e.g. per animation frame) until done.
export function createBatch(deck, env, o = {}) {
  const model = o.model || buildSimModel(deck, env);
  const N = model.ids.length, total = o.n || 10000, rng = o.rng || Math.random, handN = o.handSize || 5, turns = o.turns == null ? 3 : o.turns;
  const targetIds = (o.targetIds && o.targetIds.length ? o.targetIds : (o.targetId ? [o.targetId] : [])).filter(Boolean).slice(0, 3); // 카드 지정 최대 3장
  const targetId = targetIds[0] || null;
  const tAcc = targetIds.map(() => ({ open: 0, turns: 0 })); let allOpen = 0, allTurns = 0, mullDone = 0;
  const arr = new Int32Array(Math.max(N, 1));
  const acc = { n: 0, lv3: 0, lv2: 0, noLow: 0, blocker: 0, line: 0, lineEgg: 0, tamers: 0, options: 0, good: 0, afterMull: 0, tgtOpen: 0, tgtTurns: 0 };
  const hasTarget = (idxs, id = targetId) => id != null && idxs.some(i => model.ids[i] === id);
  const step = (k) => {
    if (N < handN) { acc.n = total; return true; }
    const end = Math.min(total, acc.n + k);
    for (; acc.n < end; acc.n++) {
      drawIdx(rng, N, handN + turns, arr);
      let hand = Array.from(arr.subarray(0, handN)), seen = Array.from(arr.subarray(0, handN + turns));
      const r0 = judgeHand(model, hand); let r = r0;
      // o.mulligan: "1회 멀리건 가능" 전제 - 키핑 불가 핸드는 손패를 전부 되돌려 섞고 새로 뽑는다(5-2-1-5). 이후 모든 통계는 최종 핸드 기준
      if (o.mulligan && !r0.good) { drawIdx(rng, N, handN + turns, arr); hand = Array.from(arr.subarray(0, handN)); seen = Array.from(arr.subarray(0, handN + turns)); r = judgeHand(model, hand); mullDone++; }
      if (r.lv3) acc.lv3++; if (r.lv2) acc.lv2++; if (r.noLow) acc.noLow++; if (r.blocker) acc.blocker++; if (r.line) acc.line++; if (r.lineEgg) acc.lineEgg++;
      acc.tamers += r.tamers; acc.options += r.options;
      if (o.mulligan) { if (r0.good) acc.good++; if (r.good) acc.afterMull++; }
      else if (r.good) { acc.good++; acc.afterMull++; }
      else { drawIdx(rng, N, handN, arr); if (judgeHand(model, Array.from(arr.subarray(0, handN))).good) acc.afterMull++; } // mulligan the bad hand
      if (targetId) {
        if (hasTarget(hand)) acc.tgtOpen++; if (hasTarget(seen)) acc.tgtTurns++;
        let ao = true, at = true;
        targetIds.forEach((id, k) => { const o1 = hasTarget(hand, id), t1 = hasTarget(seen, id); if (o1) tAcc[k].open++; if (t1) tAcc[k].turns++; ao = ao && o1; at = at && t1; });
        if (ao) allOpen++; if (at) allTurns++;
      }
    }
    return acc.n >= total;
  };
  const result = () => {
    const n = Math.max(1, acc.n), p = (x) => x / n;
    return { n: acc.n, total, pLv3: p(acc.lv3), pLv2: p(acc.lv2), pNoLow: p(acc.noLow), pBlocker: p(acc.blocker), pLine: p(acc.line), pLineEgg: p(acc.lineEgg),
      avgTamers: acc.tamers / n, avgOptions: acc.options / n, pGood: p(acc.good), pGoodAfterMulligan: p(acc.afterMull), mulliganGain: p(acc.afterMull) - p(acc.good),
      pTargetOpen: p(acc.tgtOpen), pTargetTurns: p(acc.tgtTurns), hatchable: model.digN > 0,
      targets: targetIds.map((id, k) => ({ id, open: p(tAcc[k].open), turns: p(tAcc[k].turns) })), pAllOpen: p(allOpen), pAllTurns: p(allTurns), pMulliganned: p(mullDone), mulliganOn: !!o.mulligan };
  };
  return { step, result, model, done: () => acc.n >= total };
}
export function runBatchSync(deck, env, o = {}) { const b = createBatch(deck, env, o); b.step(o.n || 10000); return b.result(); }

// exact chance of seeing >=1 copy of a card (c copies in the 50-card main deck) within the first n cards
export function pSeeCard(copies, n, N = 50) { return hyperAtLeast(N, copies, n, 1); }

// ------------------------------------------------------------------ sample hand (real opening procedure)
function shuf(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function sampleNew(deck, rng = Math.random) {
  const deckArr = shuf(expand(deck.main), rng);
  const dig = shuf(expand(deck.digitama), rng);
  const s = { deck: deckArr, hand: deckArr.splice(0, 5), security: [], digitama: dig, raising: null, phase: 'opening', mulliganed: false, turn: 0, history: [], rng };
  s.history.push(`오프닝 핸드: ${s.hand.join(', ')}`);
  return s;
}
export function sampleMulligan(s) { // 5-2-1-5: the whole hand goes back, shuffle, draw 5 (once)
  if (s.phase !== 'opening' || s.mulliganed) return false;
  s.deck = shuf([...s.deck, ...s.hand], s.rng); s.hand = s.deck.splice(0, 5); s.mulliganed = true;
  s.history.push(`멀리건 → ${s.hand.join(', ')}`); return true;
}
export function sampleKeep(s) { // security = 5 from the top, the deck's top card ends up at the security's bottom (engine.setSecurityStacks)
  if (s.phase !== 'opening') return false;
  s.security = s.deck.splice(0, 5).reverse(); s.phase = 'playing'; s.history.push('핸드 확정 · 시큐리티 5장 세팅'); return true;
}
export function sampleDraw(s) {
  if (s.phase === 'opening') sampleKeep(s);
  if (!s.deck.length) return null;
  const id = s.deck.shift(); s.hand.push(id); s.turn++; s.history.push(`${s.turn}턴째 드로우: ${id}`); return id;
}
export function sampleHatch(s) {
  if (s.phase === 'opening') sampleKeep(s);
  if (s.raising || !s.digitama.length) return null;
  s.raising = s.digitama.shift(); s.history.push(`부화: ${s.raising}`); return s.raising;
}

// ------------------------------------------------------------------ checkup
const sev = { error: 0, warn: 1, info: 2 };
export function deckCheckup(deck, env, stats) {
  const st = stats || deckStats(deck, env);
  const G = st.evo || evoGraph(deck, env);
  const out = [];
  const add = (level, code, title, why, ids = []) => out.push({ level, code, title, why, ids: [...new Set(ids)] });
  const main = deck.main || {}, dig = deck.digitama || {};
  const nm = (id) => `${env.card(id).nameKo}(${id})`;
  const leg = env.legality(deck);
  for (const e of leg.errors) { const idm = e.match(/^([A-Za-z0-9]+-\d+)/); add('error', 'legal', e, '덱 구축 규칙 위반: 이 상태로는 저장/대전에 쓸 수 없습니다.', idm ? [idm[1]] : []); }
  if (st.digN === 0) add('warn', 'no-digitama', '디지타마가 없습니다', '디지타마덱이 비어 있으면 육성 구역을 쓸 수 없어 Lv.3 이상 디지몬을 손패에서만 등장시켜야 합니다.');
  else if (st.digN < 4 && st.mainN) add('info', 'few-digitama', `디지타마 ${st.digN}장 (보통 4~5장)`, '디지타마가 적으면 부화 가능한 색/진화 라인 선택지가 줄어듭니다.');
  const lv3Ids = Object.keys(main).filter(id => isDigi(env.card(id)) && env.card(id).level === 3);
  if (st.lv[3] < Math.max(6, st.digN * 2) && st.mainN >= 40) add('warn', 'few-lv3', `Lv.3 디지몬이 ${st.lv[3]}장뿐입니다`, `디지타마 ${st.digN}장 대비 Lv.3 진화 대상이 부족합니다. 육성 → Lv.3 진화가 끊기기 쉽습니다 (권장 8~16장).`, lv3Ids);
  const early = Object.keys(main).filter(id => { const c = env.card(id); return c.cost != null && c.cost <= 2 && c.category !== 'digitama'; });
  const earlyN = early.reduce((a, id) => a + main[id], 0);
  if (earlyN < 8 && st.mainN >= 40) add('warn', 'no-early', `코스트 0~2 카드가 ${earlyN}장뿐입니다`, '초반 메모리를 쓸 저코스트 플레이가 부족하면 오프닝에서 할 수 있는 일이 줄어듭니다.', early);
  if (!st.cat.tamer && st.mainN >= 40) add('info', 'no-tamer', '테이머가 없습니다', '테이머는 메모리 가속/서포트 역할을 합니다 (없어도 구축은 가능).');
  if (st.avgDigiCost > 6.5) add('warn', 'high-curve', `디지몬 평균 등장 코스트 ${st.avgDigiCost.toFixed(1)} — 고코스트 편중`, '무거운 카드가 많아 손패가 막히기 쉽습니다.', []);
  // colors (4-22: an option needs a Digimon/Tamer of its colour in play; multi-colour options need ALL their colours)
  const support = {};
  for (const [id, n] of Object.entries({ ...main, ...dig })) { const c = env.card(id); if (c.category === 'option') continue; for (const col of c.colors || []) inc(support, col, n); }
  for (const id of Object.keys(main)) {
    const c = env.card(id);
    if (c.category !== 'option') continue;
    const altCol = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' }[((c.effectKo || '').match(/이\s*카드는\s*(레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:으)?로도\s*색\s*조건을\s*만족시킬\s*수\s*있다/) || [])[1]]; // LM-033..038
    const miss = (c.colors || []).filter(col => !support[col] && !(altCol && support[altCol]));
    if (miss.length) add('error', 'option-color', `${nm(id)}: 색 조건을 만족할 수 없음`, `옵션 카드는 같은 색의 디지몬/테이머가 필드에 있어야 사용할 수 있습니다 (룰 4-22). 이 덱에는 ${miss.map(x => COLOR_KO[x] || x).join('/')} 디지몬·테이머가 없습니다.`, [id]);
    else { const thin = (c.colors || []).filter(col => support[col] < 4); if (thin.length) add('warn', 'option-color-thin', `${nm(id)}: ${thin.map(x => COLOR_KO[x] || x).join('/')} 지원이 약함`, `같은 색 디지몬/테이머가 ${thin.map(x => support[x]).join('/')}장뿐이라 필드에 없어서 못 쓰는 경우가 잦습니다 (룰 4-22).`, [id]); }
  }
  const nonOpt = Object.keys(main).filter(id => env.card(id).category !== 'option');
  const minor = nonOpt.filter(id => (env.card(id).colors || []).length && env.card(id).colors.every(col => (st.colors[col] || 0) <= 3));
  if (minor.length) add('info', 'splash', `소수 색 카드 ${minor.length}종 (스플래시)`, '해당 색 카드가 덱 전체에 3장 이하라 진화 재료/디지타마와 이어지기 어렵습니다.', minor);
  // evolution
  if (G.orphans.length) add('warn', 'orphan', `진화 조건이 이 덱에서 만족될 수 없음 — ${G.orphans.length}종`, '이 카드들은 덱 안의 어떤 디지몬/디지타마에서도 진화할 수 없어, 손패에서 직접 등장(코스트 전액)시키는 방법밖에 없습니다.', G.orphans);
  if (G.altOnly.length) add('info', 'alt-evo', `대체 진화(버스트 진화/어플 합체 등)에 의존하는 카드 ${G.altOnly.length}종`, `일반 진화 대상은 없지만 특수 진화 규칙이 있습니다: ${G.altOnly.map(id => `${env.card(id).nameKo}(${env.altEvo(id)})`).join(', ')}`, G.altOnly);
  if (G.noRoot.length) add('warn', 'lv3-noroot', `Lv.3 ${G.noRoot.length}종: 진화할 Lv.2/디지타마가 덱에 없음`, '육성으로 키울 수 없어 손패에서 직접 등장시켜야 합니다.', G.noRoot);
  const dead = [...Object.keys(dig)].filter(id => !(G.into[id] && G.into[id].length));
  if (dead.length) add('warn', 'dead-egg', `디지타마 ${dead.length}종: 진화할 수 있는 Lv.3가 덱에 없음`, `${dead.map(nm).join(', ')} 부화해도 이어질 라인이 없습니다.`, dead);
  // jogress / digixros / assembly materials
  const poolAll = expand(main);
  for (const id of Object.keys(main)) {
    const c = env.card(id);
    if (!isDigi(c)) continue;
    let j = null;
    try { j = env.parseJogress ? env.parseJogress(id) : null; } catch { j = null; }
    if (j) {
      const cands = Object.keys(main).filter(x => isDigi(env.card(x)));
      let ok = false;
      for (const a of cands) { for (const b of cands) { if (a === b && main[a] < 2) continue; try { if (j.test(env.card(a), env.card(b))) { ok = true; break; } } catch { /* ignore */ } } if (ok) break; }
      if (!ok) add('warn', 'jogress', `${nm(id)}: 조그레스 재료가 덱에 없음`, '〔조그레스〕 조건(두 디지몬 조합)을 만족하는 카드 쌍이 덱에 없어 조그레스 진화를 할 수 없습니다.', [id]);
    }
    let x = null;
    try { x = env.parseDigiXros ? env.parseDigiXros(id) : null; } catch { x = null; }
    if (x) {
      const need = (x.reqs || []).filter(r => r.name);
      const missing = need.filter(r => !poolAll.some(pid => { const pc = env.card(pid); return pc.nameKo === r.name; }));
      if (missing.length) add('warn', 'xros', `${nm(id)}: 디지크로스 재료 부족`, `덱에 없는 재료: ${missing.map(r => `「${r.name}」`).join(', ')}. 디지크로스는 진화원에 필요한 카드가 있어야 발동합니다.`, [id]);
    }
    let a = null;
    try { a = env.parseAssembly ? env.parseAssembly(id) : null; } catch { a = null; }
    if (a) {
      let ok = true;
      try { ok = !!env.solveAssembly(a, poolAll.filter((v, i) => !(v === id && i === poolAll.indexOf(id)))); } catch { ok = true; }
      if (!ok) add('warn', 'assembly', `${nm(id)}: 어셈블리 재료 부족`, '어셈블리는 트래시의 지정 카드를 아래에 놓아 코스트를 줄이는 효과입니다. 덱 전체에도 필요한 카드가 모자랍니다.', [id]);
    }
  }
  if (st.ace) add('info', 'ace', `ACE 카드 ${st.ace}장`, 'ACE 카드는 덱 매수 제한이 따로 없습니다 (룰북: 「ACE」는 명칭에 포함되지 않으며 《오버플로우》(4-19) 룰만 가짐). 오버플로우로 스스로 소멸하니 회수/리커버리와 함께 쓰는지 확인하세요.', Object.keys(main).filter(id => /ACE$/.test(env.card(id).nameDisplayKo || '')));
  out.sort((x, y) => sev[x.level] - sev[y.level]);
  return out;
}

// ------------------------------------------------------------------ diff / sort / backup
export function diffDecks(a, b) {
  const rows = [];
  const ids = new Set();
  const cnt = (d, id) => (d.main?.[id] || 0) + (d.digitama?.[id] || 0);
  for (const d of [a, b]) for (const z of ['main', 'digitama']) for (const id of Object.keys(d[z] || {})) ids.add(id);
  let added = 0, removed = 0, same = 0;
  for (const id of ids) {
    const x = cnt(a, id), y = cnt(b, id);
    rows.push({ id, a: x, b: y, delta: y - x });
    if (y > x) added += y - x; else if (x > y) removed += x - y; same += Math.min(x, y);
  }
  rows.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta) || (p.id < q.id ? -1 : 1));
  return { rows: rows.filter(r => r.delta !== 0), added, removed, same, changedKinds: rows.filter(r => r.delta !== 0).length };
}

export const SORT_MODES = [['none', '추가한 순서'], ['no', '카드 번호'], ['cat', '종류'], ['lv', 'Lv'], ['cost', '코스트'], ['color', '색'], ['name', '이름']];
export function sortEntries(entries, mode, cardFn) {
  if (!mode || mode === 'none') return entries.slice();
  if (mode === 'no') return entries.slice().sort((a, c) => DBS.cardNoCompare(a[0], c[0])); // 카드 번호순 (ST → BT → EX …, 세트·카드 번호는 숫자 비교)
  const catOrder = { digitama: 0, digimon: 1, tamer: 2, option: 3 };
  const colorOrder = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white'];
  const key = {
    cat: (c) => catOrder[c.category] ?? 9,
    lv: (c) => c.level ?? 99,
    cost: (c) => c.cost ?? 99,
    color: (c) => (c.colors || []).length > 1 ? 50 : (colorOrder.indexOf((c.colors || [])[0]) + 1 || 99),
    name: (c) => c.nameKo || '',
  }[mode] || (() => 0);
  return entries.slice().sort((a, b) => {
    const ca = cardFn(a[0]), cb = cardFn(b[0]);
    const ka = key(ca), kb = key(cb);
    if (ka < kb) return -1; if (ka > kb) return 1;
    const la = ca.level ?? 99, lb = cb.level ?? 99; if (la !== lb) return la - lb;
    const oa = ca.cost ?? 99, ob = cb.cost ?? 99; if (oa !== ob) return oa - ob;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
}

// rename a saved deck keeping its position; returns a NEW object (or null if not possible)
export function renameDeck(decks, oldName, newName) {
  newName = String(newName || '').trim();
  if (!newName || !decks[oldName] || (newName !== oldName && decks[newName])) return null;
  const out = {};
  for (const [k, v] of Object.entries(decks)) out[k === oldName ? newName : k] = k === oldName ? { ...v, name: newName } : v;
  return out;
}
export function uniqueName(decks, base) { let n = `${base} (복사)`, i = 2; while (decks[n]) n = `${base} (복사 ${i++})`; return n; }
export function duplicateDeck(decks, name) {
  if (!decks[name]) return null;
  const nn = uniqueName(decks, name), src = decks[name], out = {};
  for (const [k, v] of Object.entries(decks)) { out[k] = v; if (k === name) out[nn] = { ...JSON.parse(JSON.stringify(src)), name: nn }; }
  return { decks: out, name: nn };
}
export function moveDeck(decks, name, dir) {
  const keys = Object.keys(decks), i = keys.indexOf(name), j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return null;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  const out = {}; for (const k of keys) out[k] = decks[k]; return out;
}
export function setCount(draft, id, n, env) { // set an exact copy count (clamped to the copy limit / zone size); returns the applied count
  const c = env.card(id), zone = c.category === 'digitama' ? 'digitama' : 'main';
  const limit = zone === 'digitama' ? 5 : 50;
  n = Math.max(0, Math.floor(n));
  const others = sumCounts(draft[zone]) - (draft[zone][id] || 0);
  n = Math.min(n, limit - others, env.maxCopies(id));
  if (n <= 0) delete draft[zone][id]; else draft[zone][id] = n;
  return Math.max(0, n);
}

export const BACKUP_VERSION = 1;
export function exportBackup(decks) { return JSON.stringify({ app: 'digimon-sim', kind: 'deck-backup', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), decks }, null, 1); }
// -> { decks: {name:{name,main,digitama,art?}}, errors:[...] }  (accepts a full backup or a bare {name: deck} map)
export function parseBackup(text, env) {
  const errors = [], decks = {};
  let j;
  try { j = JSON.parse(text); } catch (e) { return { decks, errors: ['JSON 형식이 아닙니다: ' + e.message] }; }
  const src = j && j.decks && typeof j.decks === 'object' ? j.decks : j;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { decks, errors: ['덱 목록을 찾을 수 없습니다'] };
  for (const [name, d] of Object.entries(src)) {
    if (!d || typeof d !== 'object' || typeof d.main !== 'object') { errors.push(`${name}: 덱 형식이 올바르지 않음`); continue; }
    const clean = (z) => { const o = {}; for (const [id, n] of Object.entries(z || {})) { if (Number.isInteger(n) && n > 0 && env.card(id).category !== 'unknown') o[id] = n; else errors.push(`${name}: 알 수 없는 카드/수량 ${id}`); } return o; };
    const rec = { name, main: clean(d.main), digitama: clean(d.digitama) };
    if (d.art && typeof d.art === 'object') rec.art = { ...d.art };
    decks[name] = rec;
  }
  return { decks, errors };
}
