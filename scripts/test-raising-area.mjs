// Rule 3-4-7 harness: cards in the BREEDING (raising) area — the hatched card, an evolved Digimon and ALL its evolution sources —
// must not trigger / apply / count as sources of continuous, watcher or inheritance effects unless the effect text is marked [육성] / names the breeding area.
// For EVERY digimon/digitama card in S.CARDS: (A) placed alone as the raising top card, (B) placed as an evolution source under a vanilla Digimon in the raising area.
// Probes: triggers queued by every event kind, activeHooks yielded for a raising holder, effectiveDP of the raising stack and of bystanders, keyword lookups.
// Run: node scripts/test-raising-area.mjs [--verbose] < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const verbose = process.argv.includes('--verbose');
const cards = Object.values(S.CARDS);
const filler = cards.filter(c => c.category === 'digimon' && c.level === 3).slice(0, 20).map(c => c.id);
const vanilla = cards.find(c => c.category === 'digimon' && c.level === 3 && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim());
const OTHER = vanilla.id;
function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = [filler[0], filler[1], filler[2]]; pl.battle.length = 0; pl.deck = [...filler.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 10; return st;
}
function put(st, p, ids, raising) { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; if (raising) st.players[p].raising = s; else st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; }
const marked = (c) => ['effectKo', 'inheritedKo'].some(k => S.parseEffectSegments(c[k] || '').segments.some(sg => (sg.zoneMarker || '').includes('육성'))) || /육성\s*에어리어/.test((c.effectKo || '') + (c.inheritedKo || ''));
const KINDS = ['play', 'digivolve', 'delete', 'attack', 'mainPhaseStart', 'mainPhaseStartOpp', 'turnStart', 'turnStartOpp', 'turnEndOwn'];
const EVENTS = ['play', 'digivolve', 'attack', 'attackEnd', 'delete', 'battleWin', 'rest', 'active', 'unsuspend', 'securityDecrease', 'securityIncrease', 'sourcesAdded', 'sourcesTrashed', 'handIncrease', 'deckDiscard', 'discard', 'blocked', 'optionUsed', 'digiburst', 'move', 'hatch', 'underTamer', 'securityDiscard', 'attackTarget', 'attackOnDigimon', 'faceDownSource', 'playFromSources'];
const KW = ['블로커', '재밍', '리커버리', '관통', '속공', '충돌', '세이브', '회피', '리바이브', '패시브', '이빌리티', '디지크로스', '방어', '시큐리티 어택'];
const violations = [];
const bump = (id, mode, what) => violations.push({ id, mode, what });

function probe(cardId, mode) {
  const c = S.card(cardId);
  // ---- scenario: p1 raising = (top | vanilla+source), p1 bystander battle digimon, p2 bystander battle digimon ----
  const st = newState();
  const ids = mode === 'top' ? [cardId] : [OTHER, cardId];
  const bys1 = put(st, 'p1', [OTHER], false), bys2 = put(st, 'p2', [OTHER], false);
  const dp0 = { b1: S.effectiveDP(st, 'p1', bys1), b2: S.effectiveDP(st, 'p2', bys2) };
  const raising = put(st, 'p1', ids, true);
  const topC = S.card(raising.cardId);
  const printed = topC.dp || 0;
  const mk = mode === 'top' ? marked(c) : marked(c);
  if (mk) return; // [육성]-marked cards are audited by test-raising-marked below
  // (a) triggers queued straight for the raising stack (play / digivolve / attack / …)
  for (const k of KINDS) {
    st.pending.length = 0;
    try { S.queueTriggersForStack(st, 'p1', raising, k); } catch (e) { bump(cardId, mode, `queueTriggersForStack(${k}) threw ${e.message}`); }
    if (st.pending.length) bump(cardId, mode, `trigger ${k} queued ${st.pending.length} (${st.pending.map(t => t.tags.join('/')).join(',')})`);
  }
  // (b) game events with the raising stack as subject / as bystander of a battle digimon's event, own + opponent's
  for (const k of EVENTS) for (const [ow, sub] of [['p1', raising], ['p1', bys1], ['p2', bys2]]) {
    st.pending.length = 0;
    try { S.emitGameEvent(st, k, { owner: ow, stack: sub, cause: 'effect', player: ow, added: [OTHER], srcPlayer: ow, srcCategory: 'digimon' }); } catch (e) { /* engine events with missing info may throw; irrelevant */ }
    if (st.pending.some(t => t.stackUid === raising.uid)) bump(cardId, mode, `event ${k}(${sub === raising ? 'self' : ow === 'p1' ? 'ownOther' : 'opp'}) queued ${st.pending.filter(t => t.stackUid === raising.uid).map(t => t.tags.join('/')).join(',')}`);
  }
  // (c) hooks yielded for the raising holder
  const hk = []; for (const y of S.activeHooks ? S.activeHooks(st) : []) if (y.holder === raising) hk.push(`${y.id}:${y.d.tag || ''}`);
  if (hk.length) bump(cardId, mode, `activeHooks holder=raising ${hk.slice(0, 3).join(',')}`);
  // (d) continuous effects: DP of the raising stack and of bystanders must equal the vanilla numbers
  for (const ph of ['p1', 'p2']) for (const turn of ['p1', 'p2']) {
    st.activePlayer = turn;
    const dpR = S.effectiveDP(st, 'p1', raising);
    if (dpR !== printed) bump(cardId, mode, `effectiveDP raising ${dpR} != printed ${printed} (active ${turn})`);
    if (S.effectiveDP(st, 'p1', bys1) !== dp0.b1) bump(cardId, mode, `bystander p1 DP ${S.effectiveDP(st, 'p1', bys1)} != ${dp0.b1} (active ${turn})`);
    if (S.effectiveDP(st, 'p2', bys2) !== dp0.b2) bump(cardId, mode, `bystander p2 DP ${S.effectiveDP(st, 'p2', bys2)} != ${dp0.b2} (active ${turn})`);
  }
  st.activePlayer = 'p1';
  // (e) keywords: a raising-area stack carries none of the printed continuous ones from an effect that doesn't name the breeding area
  if (mode === 'source') for (const kw of KW) { try { if (S.hasKeyword(raising, kw)) bump(cardId, mode, `hasKeyword(${kw}) true via source`); } catch (e) { /* */ } }
  if (mode === 'top') for (const kw of KW) { try { if (S.hasKeyword(raising, kw) && (S.effectiveInfo ? true : true)) bump(cardId, mode, `hasKeyword(${kw}) true on raising top`); } catch (e) { /* */ } }
}

let n = 0;
for (const c of cards) {
  if (!['digimon', 'digitama'].includes(c.category)) continue;
  n++;
  for (const mode of ['top', 'source']) { if (mode === 'source' && !(c.inheritedKo || '').trim()) continue; try { probe(c.id, mode); } catch (e) { bump(c.id, mode, 'probe crashed: ' + e.message); } }
}
// ---- (c) 3-4-7-6: any card as a BATTLE-area holder must not react to events whose subject is a raising-area stack (except hatch / move) ----
let nHold = 0;
for (const c of cards) {
  if (!['digimon', 'tamer', 'digitama'].includes(c.category)) continue;
  nHold++;
  try {
    const st = newState();
    const holder = put(st, 'p1', [c.id], false), raising = put(st, 'p1', [OTHER], true);
    for (const k of EVENTS) {
      if (k === 'hatch' || k === 'move') continue;
      for (const ow of ['p1', 'p2']) {
        st.pending.length = 0;
        try { S.emitGameEvent(st, k, { owner: ow, stack: raising, cause: 'effect', player: ow, added: [OTHER], srcPlayer: ow, srcCategory: 'digimon' }); } catch (e) { /* */ }
        const hit = st.pending.filter(t => t.stackUid === holder.uid);
        if (hit.length) bump(c.id, 'holder', 'battle holder reacted to raising-subject event ' + k + ' (' + hit.map(t => t.tags.join('/')).join(',') + ')');
      }
    }
  } catch (e) { bump(c.id, 'holder', 'holder probe crashed: ' + e.message); }
}
// ---- (a)/(f) flows: digivolve inside the breeding area fires no unmarked 【진화 시】; moving to the battle area applies effects but fires no 【등장 시】 ----
let nFlow = 0;
for (const c of cards.filter(x => x.category === 'digimon' && /【진화 시】/.test(x.effectKo || ''))) {
  nFlow++;
  const st = newState(); const lv2 = cards.find(x => x.category === 'digitama' || (x.category === 'digimon' && x.level === 2));
  const r = put(st, 'p1', [lv2.id], true); st.players.p1.hand = [c.id]; st.memory = 10;
  st.pending.length = 0;
  try { S.digivolve(st, 'p1', r.uid, c.id, 0, 'hand'); } catch (e) { bump(c.id, 'flow', 'digivolve threw ' + e.message); continue; }
  if (st.pending.some(t => t.stackUid === r.uid && t.tags.some(tg => /진화 시/.test(tg)) && !marked(c))) bump(c.id, 'flow', 'digivolve in the breeding area fired 【진화 시】');
  if (S.effectiveDP(st, 'p1', r) !== (S.card(r.cardId).dp || 0) && !marked(c)) bump(c.id, 'flow', 'evolved raising DP differs from printed');
  st.pending.length = 0; st.breedingActionTaken = false;
  const moved = S.moveRaisingToBattle(st, 'p1');
  if (moved && st.pending.some(t => t.stackUid === r.uid && t.tags.some(tg => /등장 시/.test(tg)) && !t.tags.some(tg => /이동 시/.test(tg)))) bump(c.id, 'flow', 'move to battle area fired 【등장 시】');
}
console.log('holder probes ' + nHold + ', flow probes ' + nFlow);
const byWhat = {};
for (const v of violations) { const k = v.what.replace(/\d+/g, 'N').replace(/\(.*$/, ''); (byWhat[k] ||= new Set()).add(v.id); }
console.log(`cards probed ${n}; violations ${violations.length} on ${new Set(violations.map(v => v.id)).size} cards`);
for (const [k, s] of Object.entries(byWhat).sort((a, b) => b[1].size - a[1].size)) console.log(`  ${s.size}\t${k}\t${[...s].slice(0, 6).join(' ')}`);
if (verbose) for (const v of violations.slice(0, 200)) console.log(v.id, v.mode, v.what);
process.exit(violations.length ? 1 : 0);
