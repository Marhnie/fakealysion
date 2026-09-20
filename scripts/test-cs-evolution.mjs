// CS (「CS」 trait) special evolutions: printed 〔진화〕 lines through the REAL main.js path (evolutionMethods + cost modifiers + digivolve),
// raising-area Lv.2 stacks, color-blind special lines, top-card-only trait rule, chained conditions.
// Run from repo root: node scripts/test-cs-evolution.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as E from '../src/engine.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const cards = Object.values(S.CARDS);
const filler = cards.filter(c => c.category === 'digimon' && c.level === 3).slice(0, 20).map(c => c.id);
function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = [...filler.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 10; return st;
}
function put(st, p, ids, raising = false) { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; if (raising) st.players[p].raising = s; else st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; }
let fail = 0, pass = 0; const eq = (m, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; if (fail < 60) console.log('FAIL', m, '| got', JSON.stringify(a), 'want', JSON.stringify(b)); } else pass++; };
// exactly what main.js handleStackDrop does (chooser -> method -> cost = base + modifiers -> digivolve)
function uiEvolve(st, p, stack, targetId, pickCost = null) {
  const restr = S.evolveTargetRestriction(st, p, stack), x = S.evoExtraArg(st, p, stack);
  const methods = E.evolutionMethods(stack.cardId, targetId, x, restr, { state: st, p, stack });
  if (!methods.length) return { ok: false, methods, why: E.canEvolveAny(stack.cardId, targetId, x, restr).reason };
  let m = methods[0];
  if (pickCost != null) m = methods.find(k => k.baseCost === pickCost) || m;
  const delta = S.previewEvoCostDelta(st, p, stack, targetId);
  const mem0 = st.memory;
  const evoDelta = S.consumeEvoCostMod(st, p, targetId) + S.continuousEvoCostDiscount(st, p, stack, targetId) + S.hookEvoCostDiscount(st, p, stack, targetId) + S.s1EvoAuto(st, p, stack, targetId);
  const cost = Math.max(0, m.baseCost + evoDelta);
  const before = stack.cardId;
  const r = S.digivolve(st, p, stack.uid, targetId, cost, 'hand');
  return { ok: !!r, methods, cost, delta, mem: st.memory - mem0, before };
}
// ---------- 1. every printed CS 〔진화〕 line ----------
const csHolders = cards.filter(c => (c.types || []).includes('CS') && ['digimon', 'digitama'].includes(c.category));
const byLevel = {}; for (const c of csHolders) (byLevel[c.level] ||= []).push(c);
const nonCS = (lv) => cards.find(c => c.category === 'digimon' && c.level === lv && !(c.types || []).includes('CS') && !(c.types || []).some(t => ['화염형', '나이트 클로', '라이트 팽', '로얄 베이스', '윗체르니', '언데드형', '타천사형'].includes(t)));
const targets = cards.filter(c => c.category === 'digimon' && /〔진화〕[^\n]*특징[^\n]*「CS」/.test(c.effectKo || ''));
eq('CS-line target count', targets.length >= 90, true);
let nLines = 0;
for (const t of targets) {
  const conds = [...(t.effectKo.split('\n').filter(l => l.includes('〔진화〕')).join('\n')).matchAll(/특징\s*((?:「[^」]+」\/?)+)\s*를\s*가진\s*Lv\.(\d+)\s*:\s*코스트\s*(\d+)/g)];
  for (const m of conds) {
    const traits = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]), lv = Number(m[2]), cost = Number(m[3]);
    if (!traits.includes('CS')) continue;
    nLines++;
    const srcs = (byLevel[lv] || []);
    eq(t.id + ' has CS Lv.' + lv + ' holder', srcs.length > 0, true);
    // (a) every CS holder of that level (any color) -> a method with the printed cost
    let okAll = true, wrong = null;
    for (const s of srcs) {
      const st = newState(); st.players.p1.hand.push(t.id);
      const stk = put(st, 'p1', [s.id], s.category === 'digitama' || s.level === 2);
      const ms = E.evolutionMethods(s.id, t.id, S.evoExtraArg(st, 'p1', stk), S.evolveTargetRestriction(st, 'p1', stk), { state: st, p: 'p1', stack: stk });
      if (!ms.some(x => x.baseCost === cost)) { okAll = false; wrong = s.id + ' ' + JSON.stringify(ms.map(x => x.baseCost)); break; }
    }
    eq(t.id + ' CS Lv.' + lv + ' -> cost ' + cost, okAll ? 'ok' : wrong, 'ok');
    // (b) one full UI evolve from the raising area (Lv.2) or battle area
    const s0 = srcs.find(x => !x.colors.some(c => (t.colors || []).includes(c))) || srcs[0]; // prefer an off-color source
    const st = newState(); st.players.p1.hand.push(t.id);
    const stk = put(st, 'p1', [s0.id], s0.level === 2);
    const before = st.memory;
    const r = uiEvolve(st, 'p1', stk, t.id, cost);
    eq(t.id + ' ui evolve ' + s0.id, [r.ok, stk.cardId, stk.sources[stk.sources.length - 1]], [true, t.id, s0.id]);
    eq(t.id + ' memory (>= printed cost - discount)', before - st.memory <= cost && before - st.memory >= 0, true);
    // (c) a non-CS same-level card must not use the CS line (unless another printed condition names it)
    const n = nonCS(lv);
    if (n) {
      const st2 = newState(); const stk2 = put(st2, 'p1', [n.id], n.level === 2);
      const ms2 = E.evolutionMethods(n.id, t.id, S.evoExtraArg(st2, 'p1', stk2), S.evolveTargetRestriction(st2, 'p1', stk2), { state: st2, p: 'p1', stack: stk2 });
      const hasLine = ms2.some(x => x.kind === 'special-line' && /CS/.test(x.conditionText) && !/「CS」/.test(n.types.join()));
      eq(t.id + ' non-CS ' + n.id + ' must not satisfy CS line', hasLine, false);
    }
    // (d) top lacks the trait but a SOURCE has it -> condition refers to the top card only
    if (n) {
      const st3 = newState(); const stk3 = put(st3, 'p1', [n.id, srcs[0].id]);
      const ms3 = E.evolutionMethods(n.id, t.id, S.evoExtraArg(st3, 'p1', stk3), S.evolveTargetRestriction(st3, 'p1', stk3), { state: st3, p: 'p1', stack: stk3 });
      eq(t.id + ' top non-CS + CS source -> no CS line', ms3.some(x => x.kind === 'special-line' && x.baseCost === cost && /특징 「CS」|「CS」/.test(x.conditionText) && !/(코로몬)/.test(x.conditionText)), false);
    }
  }
}
console.log('CS lines checked:', nLines);
console.log(fail ? 'FAILED ' + fail + ' (pass ' + pass + ')' : 'ALL PASS ' + pass);
process.exit(fail ? 1 : 0);
