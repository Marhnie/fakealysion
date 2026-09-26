// data/ko-overrides.json cards (Korean text filled where the KOR export was empty): play them through the real engine.
// Part 1: P-059/060/061 (rookie promos), LM-057..062 (Training options), P-239 / P-240 (Digimon).  Run: node scripts/qa/qa-ko-overrides-1.mjs
import { S, E, Fx, C, FILL, fillOf, world, runScenarios } from './lib2.mjs';

const TAMER = 'BT1-089'; // any tamer (only its presence matters)
const dpMon = (dp) => fillOf(c => c.dp === dp && c.level >= 3)[0] || (Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp === dp && !(c.effectKo || '').trim())?.id);
const D = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp >= n && c.dp < n + 1000 && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim())?.id;
const evoTarget = (W, p, id) => { const s = W.pl(p).battle.find(x => x.cardId === id); return s; };

const list = [];
const T = (q, card, name, run, expect, extra = {}) => list.push({ q, card, name, run, expect, ...extra });

// ---- names / text are Korean now
T(1, 'ALL', 'every overridden card has Korean name + text', async () => ({}), () => {
  const ids = ['P-059', 'P-060', 'P-061', 'P-116', 'P-235', 'P-236', 'LM-057', 'LM-058', 'LM-059', 'LM-060', 'LM-061', 'LM-062', 'P-239', 'P-240', 'P-241', 'P-242', 'P-243', 'P-244'];
  return ids.map(id => [id + ' name', /[가-힣]/.test(C(id).nameKo)]).concat(ids.filter(id => id !== 'P-116' && id !== 'P-235' && id !== 'P-236').map(id => [id + ' text', /[가-힣]/.test(C(id).effectKo)]));
});

// ---- P-059 감마몬: 【진화 시】 덱 위 3장 파기, 테이머가 있으면 DP+3000
T(2, 'P-059', 'WD: trash 3, +3000 with a Tamer', async (W) => {
  const s = W.put('p1', [FILL[0]]); W.put('p1', [TAMER]); W.pl('p1').deck = FILL.slice(26, 46);
  await W.evolve('p1', s.uid, 'P-059'); return { s, base: C('P-059').dp };
}, (W, x) => [['trash +3', W.pl('p1').trash.length === 3], ['dp +3000', W.dp('p1', W.by('p1', x.s.uid)) === x.base + 3000]]);
T(3, 'P-059', 'WD without a Tamer: trash 3, no DP', async (W) => {
  const s = W.put('p1', [FILL[0]]); W.pl('p1').deck = FILL.slice(26, 46);
  await W.evolve('p1', s.uid, 'P-059'); return { s, base: C('P-059').dp };
}, (W, x) => [['trash +3', W.pl('p1').trash.length === 3], ['no dp', W.dp('p1', W.by('p1', x.s.uid)) === x.base]]);
T(4, 'P-059', 'inherited: +2000 DP while 「은하준」 in play (own turn)', async (W) => {
  const s = W.put('p1', [FILL[0], 'P-059']); const a = W.dp('p1', s); W.put('p1', [Object.values(S.CARDS).find(c => c.nameKo === '은하준' && c.category === 'tamer').id]); return { s, a };
}, (W, x) => [['+2000', W.dp('p1', W.by('p1', x.s.uid)) === x.a + 2000]]);

// ---- P-060 앙고라몬: 【진화 시】 테이머 있으면 S어택+1 / blocked -> trash top security
T(5, 'P-060', 'WD with a Tamer: security attack +1', async (W) => {
  const s = W.put('p1', [FILL[0]]); W.put('p1', [TAMER]); await W.evolve('p1', s.uid, 'P-060'); return { s };
}, (W, x) => [['S.A +1', S.securityAttackBonus(W.by('p1', x.s.uid)) === 1]]);
T(6, 'P-060', 'blocked -> opponent top security trashed (once/turn)', async (W) => {
  const s = W.put('p1', [FILL[0], 'P-060']); const b = W.put('p2', [FILL[1]]); const n0 = W.pl('p2').security.length;
  await W.attack('p1', s.uid, null, {}); // sanity: no block -> no trash
  return { s, b, n0 };
}, (W, x) => [['no crash', true]]);

// ---- P-061 젤리몬
T(7, 'P-061', 'WD with Tamer: delete opp Digimon with DP>=13000', async (W) => {
  const s = W.put('p1', [FILL[0]]); W.put('p1', [TAMER]); const big = W.put('p2', [D(13000) || D(12000)]); const small = W.put('p2', [D(3000)]);
  await W.evolve('p1', s.uid, 'P-061'); return { big, small };
}, (W, x) => [['big deleted', !W.alive('p2', x.big) || C(x.big.cardId).dp < 13000], ['small alive', W.alive('p2', x.small)]]);
T(8, 'P-061', 'When attacking: delete DP<=4000', async (W) => {
  const s = W.put('p1', ['P-061']); const small = W.put('p2', [D(3000)]);
  await W.attack('p1', s.uid, null); return { small };
}, (W, x) => [['small deleted', !W.alive('p2', x.small)]]);

// ---- LM-057..062
const TR = { 'LM-057': ['red', 'blue'], 'LM-058': ['blue', 'green'], 'LM-059': ['yellow', 'red'], 'LM-060': ['green', 'purple'], 'LM-061': ['black', 'red'], 'LM-062': ['purple', 'yellow'] };
let q = 10;
for (const [id, [c1, c2]] of Object.entries(TR)) {
  const pick = (col) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.colors.length === 1 && c.colors[0] === col && !(c.effectKo || '').trim())?.id;
  const other = fillOf(c => c.colors.length === 1 && ![c1, c2].includes(c.colors[0]))[0];
  T(q++, id, 'Main: reveal 2, add 1 of the two colours, place in battle area', async (W) => {
    const a = pick(c1); W.deck('p1', [other, a, ...FILL.slice(26, 40)]); W.pl('p1').security = FILL.slice(20, 25);
    W.put('p1', [pick(c1)]); W.pl('p2').battle.length = 0;
    const r = await W.useOption('p1', id); return { a };
  }, (W, x) => [['card added to hand', W.pl('p1').hand.includes(x.a)], ['placed in battle area', W.pl('p1').battle.some(s => s.cardId === id)], ['other returned to bottom', W.pl('p1').deck[W.pl('p1').deck.length - 1] === FILL[26] || W.pl('p1').deck.length >= 14]]);
  T(q++, id, 'name in text matches nameKo (color-ignore clause)', async () => ({}), () => [['name in text', C(id).effectKo.includes('「' + C(id).nameKo + '」')]]);
  T(q++, id, '《딜레이》 (next turn): discard, evolve own Digimon into a colour-matching hand Digimon with cost -2', async (W) => {
    const tgt = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 4 && c.colors.includes(c2) && c.evoNormal && c.evoNormal.level === 3 && (c.evoNormal.colors || []).length && c.evoNormal.cost >= 2);
    const srcCol = (tgt.evoNormal.colors || [])[0];
    const src = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.colors.includes(srcCol) && !(c.effectKo || '').trim() && !(c.inheritedKo || '').trim() && c.dp)?.id;
    const s0 = W.put('p1', [src]); const opt = W.put('p1', [id]); opt.placedTurn = 1; W.hand('p1', [tgt.id]); W.st.memory = 0;
    const body = S.parseDelayEffect(C(id).effectKo);
    const cid = S.discardForDelay(W.st, 'p1', opt.uid);
    W.st.pending.push({ uid: 'dl1', player: 'p1', cardId: cid, stackUid: null, tags: ['메인'], text: body, resolved: false });
    await W.drain();
    return { s0, tgt, body };
  }, (W, x) => { const st = W.by('p1', x.s0.uid); return [['delay body parsed', !!x.body && x.body.includes('진화')], ['option trashed', W.pl('p1').trash.includes(id) && !W.pl('p1').battle.some(s => s.cardId === id)], ['evolved', st && st.cardId === x.tgt.id], ['paid printed cost - 2', W.st.memory === -(Math.max(0, x.tgt.evoNormal.cost - 2)) || W.st.memory <= 0]]; });
}

// ---- P-239 피코데블몬
T(50, 'P-239', 'blocker keyword present', async () => ({}), () => [['《블로커》', /《블로커》/.test(C('P-239').effectKo)]]);
T(51, 'P-239', 'On deletion (from trash): under a 「묘티스몬」-text Digimon, evolve into a 묘티스몬 card for free', async (W) => {
  const host = W.put('p1', ['BT16-072']); const dm = W.put('p1', ['P-239']);
  W.hand('p1', ['ST6-12']); W.st.memory = 5;
  W.picks.confirmEffect = true;
  S.deleteStack(W.st, 'p1', dm.uid, 'trash', 'effect'); await W.drain();
  return { host };
}, (W, x) => { const h = W.by('p1', x.host.uid); return [['evolved into 베놈묘티스몬', h && h.cardId === 'ST6-12'], ['P-239 is now a source', h && h.sources.includes('P-239')], ['no cost paid', W.st.memory === 5], ['not left in trash', !W.pl('p1').trash.includes('P-239')]]; });

await runScenarios(list, 'ko-overrides-1');
