// 조사: 텍스트에 "테이머"가 없는데(디지몬만 대상) 대상 선택지에 테이머가 포함되는 효과 찾기. Run: node scripts/census-tamer-targets.mjs [--cat option|all] < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const cats = process.argv.includes('--all') ? ['option', 'digimon', 'tamer'] : ['option'];
const cards = Object.values(S.CARDS);
const digi = cards.filter(c => c.category === 'digimon' && c.level === 3).slice(0, 30).map(c => c.id);
const tamerIds = cards.filter(c => c.category === 'tamer' && !(c.effectKo || '').trim()).slice(0, 3).map(c => c.id);
function board(cardId) {
  const deck = () => { const main = {}; for (let i = 0; i < 20; i++) main[digi[i]] = 1; return { name: 'x', main, digitama: {} }; };
  const st = S.newGame(deck(), deck());
  for (const p of ['p1', 'p2']) { st.players[p].hand = digi.slice(0, 6); }
  st.turnNumber = 5; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 5;
  const mk = (p, ids) => { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; st.players[p].battle.push(s); return s; };
  const ent = {};
  ent.d1 = mk('p1', [digi[6], digi[7]]); ent.d2 = mk('p1', [digi[8]]); ent.t1 = mk('p1', [tamerIds[0]]); ent.t1b = mk('p1', [tamerIds[1]]);
  ent.e1 = mk('p2', [digi[9], digi[10]]); ent.e2 = mk('p2', [digi[11]]); ent.et = mk('p2', [tamerIds[2]]);
  S.recomputeStates && S.recomputeStates(st);
  return { st, ent };
}
const hits = [];
let scanned = 0;
for (const c of cards) {
  if (!cats.includes(c.category)) continue;
  for (const [srcName, text] of [['effectKo', c.effectKo]]) {
    if (!text) continue;
    for (const seg of S.parseEffectSegments(text).segments) {
      const body = seg.body;
      if (!/디지몬/.test(body) || /테이머|디지몬\s*\/\s*테이머/.test(body)) continue;
      const script = Fx.lookupCardSpecific(c.id, seg.tags, seg.body, false) || Fx.compileToScript(seg.body);
      if (!Array.isArray(script) || !script.length) continue;
      const { st, ent } = board(c.id);
      const tamerUids = new Set([ent.t1.uid, ent.t1b.uid, ent.et.uid]);
      const offers = [];
      const trig = { text: body, tags: seg.tags, cardId: c.id, stackUid: ent.d1.uid, player: 'p1', evtStackUid: ent.d1.uid };
      const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: c.id, sourceStackUid: ent.d1.uid, trigger: trig, startAttack() {}, attack: () => null, endAttack() {},
        choose: async (k, o) => {
          if (k === 'confirmEffect') return true;
          if (k === 'pickStack') { const t = (o.uids || []).filter(u => tamerUids.has(u)); if (t.length) offers.push({ k, prompt: o.prompt, n: t.length }); return o.uids?.find(u => !tamerUids.has(u)) ?? o.uids?.[0] ?? null; }
          if (k === 'pickStackAnySide') { const t = (o.entries || []).filter(e => tamerUids.has(e.uid)); if (t.length) offers.push({ k, prompt: o.prompt, n: t.length }); const e = (o.entries || []).find(e => !tamerUids.has(e.uid)) || o.entries?.[0]; return e ? { player: e.player, uid: e.uid } : null; }
          if (k === 'pickFromZoneIndex') return o.eligibleIdxs?.[0] ?? null;
          if (k === 'pickFromHandIndexes') return (o.eligibleIdxs || []).slice(0, o.n || 1);
          if (k === 'pickFromRevealed') return (o.eligible || []).slice(0, o.max ?? 1).map(x => x.i);
          if (k === 'multipleChoice') return 0;
          return null;
        } };
      scanned++;
      try { await Promise.race([Fx.runScript(script, ctx), new Promise((_, r) => setTimeout(() => r(new Error('to')), 2000))]); } catch (e) { continue; }
      if (offers.length) hits.push({ id: c.id, cat: c.category, tags: seg.tags.join(','), body: body.slice(0, 90), ops: script.map(o => o.op).join('>'), offers });
    }
  }
}
console.log('scanned', scanned, 'hits', hits.length);
for (const h of hits) console.log(h.id, h.cat, h.ops, '|', h.body.replace(/\n/g, ' '), '|', h.offers[0].prompt);
fs.writeFileSync('C:/Users/MRHN/AppData/Local/Temp/claude/D------/77a657a5-ae37-40c8-89fa-f1b3f895e918/scratchpad/tamer-hits.json', JSON.stringify(hits, null, 1));
if (hits.some(h => h.id !== 'BT26-050')) process.exitCode = 1; // BT26-050: 여러 태그 텍스트가 같은 스크립트로 조회돼 생기는 오탐 (실제 텍스트는 디지몬/테이머 대상)
