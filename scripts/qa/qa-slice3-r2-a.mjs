// Slice3 round 2 part A: DigiXros / Jogress / material-save Q&A (official rulings referenced by Q id only, paraphrased).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const byName = (n, pred = () => true) => cards.find(c => c.nameKo === n && c.category === 'digimon' && pred(c))?.id;
const tam = (n) => cards.find(c => c.category === 'tamer')?.id;

// ---- Q3068/3089/3094/3105/3119: a card that is only *treated as* X during DigiXros (BT19-012/035/038/051/061) is not a legal 머티리얼 세이브 pick
const aliasCards = [['Q3068', 'BT19-012', 'BT10-013'], ['Q3089', 'BT19-035', 'BT10-013'], ['Q3094', 'BT19-038', 'BT10-013'], ['Q3105', 'BT19-051', 'BT10-013'], ['Q3119', 'BT19-061', 'BT10-013']];
for (const [q, alias, xr] of aliasCards) await sc(q, `${alias} (xros-only alias) cannot be moved under a tamer by ${xr} material save`, async () => {
  const st = newState(); const tm = put(st, 'p1', [tamerAny()]); const me = put(st, 'p1', [xr, alias, 'BT10-012']);
  const before = tm.sources.length; S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st);
  return all(eq('alias not placed under tamer', tm.sources.includes(alias), false));
});
function tamerAny() { return cards.find(c => c.category === 'tamer' && !/테이머 아래/.test(c.effectKo || '')).id; }
// control: the genuinely named material IS movable
await sc('Q3068c', 'control: BT10-013 material save moves a really-named material under the tamer', async () => {
  const st = newState(); const tm = put(st, 'p1', [tamerAny()]); const shout = byName('샤우트몬'); const me = put(st, 'p1', ['BT10-013', shout]);
  S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st);
  return eq('moved', tm.sources.includes(shout), true);
});
const N = (n) => byName(n);
const planKinds = (st, p, id) => { st.players[p].hand.push(id); const pl = S.planDigiXros(st, p, st.players[p].hand.length - 1); return pl ? pl.materials.map(m => m.kind) : []; };
// alias in hand: BT19-012 acts as 샤우트몬 when DigiXros-ing into BT10-013
await sc('Q3068x', 'BT19-012 in hand counts as 샤우트몬 for DigiXros into BT10-013', async () => {
  const st = newState(); st.players.p1.hand = ['BT19-012']; const k = planKinds(st, 'p1', 'BT10-013');
  return eq('hand material used', k.join(), 'hand');
});
const tamerWith = (st, p, under) => { const t = put(st, p, [tamerAny()]); t.sources = under.slice(); return t; };
// Q3139/3143/3154: BT19-079/081/087 may pull material from ANY own tamer's under-cards (not just the holder's)
for (const [q, tid, xr] of [['Q3139', 'BT19-079', 'BT10-013'], ['Q3154', 'BT19-087', 'BT10-013']]) await sc(q, `${tid}: under-cards of another own tamer may be xros'd`, async () => {
  const st = newState(); put(st, 'p1', [tid]); tamerWith(st, 'p1', [N('샤우트몬')]);
  const k = planKinds(st, 'p1', xr); return eq('uses tamer material', k.includes('tamer'), true);
});
await sc('Q3143', 'BT19-081: under-cards of another own tamer may be xros\'d', async () => {
  const bt = cards.find(c => c.category === 'digimon' && (c.types || []).includes('블루 플레어') && S.parseDigiXros(c.id));
  const r = S.parseDigiXros(bt.id).reqs[0]; const m = cards.find(c => c.category === 'digimon' && r.name && S.cardNameIs(c, r.name))?.id;
  const st = newState(); put(st, 'p1', ['BT19-081']); tamerWith(st, 'p1', [m]);
  return eq('uses tamer material', planKinds(st, 'p1', bt.id).includes('tamer'), true);
});
// Q3156/Q3157: two BT19-087: 1 under + 1 trash EACH -> total 2 under-cards and 2 trash cards
await sc('Q3156', 'two BT19-087: 2 from tamer under + 2 from trash allowed', async () => {
  const st = newState(); put(st, 'p1', ['BT19-087']); put(st, 'p1', ['BT19-087']); tamerWith(st, 'p1', [N('샤우트몬'), N('바리스타몬')]);
  st.players.p1.trash = [N('도루루몬'), N('스타몬즈')];
  const k = planKinds(st, 'p1', 'BT10-013'); return all(eq('tamer x2', k.filter(x => x === 'tamer').length, 2), eq('trash x2', k.filter(x => x === 'trash').length, 2));
});
await sc('Q3156b', 'single BT19-087: only 1 under + 1 trash (control)', async () => {
  const st = newState(); const t0 = put(st, 'p1', ['BT19-087']); t0.sources = [N('샤우트몬'), N('바리스타몬')]; st.players.p1.trash = [N('도루루몬'), N('스타몬즈')];
  const k = planKinds(st, 'p1', 'BT10-013'); return all(eq('tamer x1', k.filter(x => x === 'tamer').length, 1), eq('trash x1', k.filter(x => x === 'trash').length, 1));
});
// Q3503: EX4-062: several tamers with under-cards -> still just 1 under + 1 trash total
await sc('Q3503', 'EX4-062: many tamers with under-cards -> only one card from tamer under', async () => {
  const bt = cards.find(c => c.category === 'digimon' && (c.types || []).some(t => /블루 플레어|트와일라잇/.test(t)) && S.parseDigiXros(c.id) && S.parseDigiXros(c.id).reqs.length >= 3);
  if (!bt) return 'no suitable card'; const rq = S.parseDigiXros(bt.id).reqs; const idFor = (r) => cards.find(c => c.category === 'digimon' && r.name && S.cardNameIs(c, r.name))?.id;
  const st = newState(); const a = put(st, 'p1', ['EX4-062']); a.sources = [idFor(rq[0])]; tamerWith(st, 'p1', [idFor(rq[1])]); tamerWith(st, 'p1', [idFor(rq[2])]);
  const k = planKinds(st, 'p1', bt.id); return eq('tamer materials', k.filter(x => x === 'tamer').length, 1);
});
// ---- EX6-023/024/025/026 (손오공몬 / 사고몬 / 삼장몬 / 초핫카이몬) group: Q3720-3743
const ex6 = [['EX6-023', ['삼장몬', '사고몬', '초핫카이몬'], ['Q3720', 'Q3721', 'Q3724', 'Q3725']], ['EX6-024', ['삼장몬', '손오공몬', '초핫카이몬'], ['Q3726', 'Q3727', 'Q3730', 'Q3731']], ['EX6-025', ['손오공몬', '사고몬', '초핫카이몬'], ['Q3732', 'Q3733', 'Q3736', 'Q3737']], ['EX6-026', ['삼장몬', '손오공몬', '사고몬'], ['Q3738', 'Q3739', 'Q3742', 'Q3743']]];
for (const [id, mats, [qa, qb, qc, qd]] of ex6) {
  const ids = mats.map(n => cards.find(c => c.category === 'digimon' && c.nameKo === n && /^EX6/.test(c.id))?.id || byName(n));
  await sc(qa, `${id}: DigiXros list is a single-card OR (one of ${mats.join('/')}), never all three`, async () => {
    const st = newState(); st.players.p1.hand = [...ids]; st.players.p1.hand.push(id); const pl = S.planDigiXros(st, 'p1', 3);
    return all(eq('planned', !!pl, true), eq('one card only', pl?.materials.length, 1));
  });
  await sc(qb, `${id}: "디지크로스하고 있었다면" part only fires on play, not on attack (attack result equals the non-xros attack)`, async () => {
    const run = async (x) => { const st = newState(); const me = put(st, 'p1', [id, ids[0]]); me.xrosCount = x; put(st, 'p2', [FILL[1]]); put(st, 'p2', [FILL[2]]); st.players.p1.deck = [...FILL.slice(0, 8)]; await trig(st, 'p1', me, 'attack');
      return JSON.stringify([st.players.p2.battle.map(s => [s.tempDP, s.suspended, (s.keywords || []).length, JSON.stringify(s.grants || null)]), me.tempDP, JSON.stringify(me.keywords || []), JSON.stringify(me.grants || null), st.players.p1.deck.length, st.players.p1.hand.length, st.players.p2.battle.length]); };
    return eq('xros attack == plain attack', await run(1), await run(0));
  });
  await sc(qc, `${id}: as an xros material, its leave-area trigger fires`, async () => {
    const st = newState(); const y = cards.find(c => c.category === 'digimon' && c.colors.includes('yellow') && c.level === 3).id;
    const mat = put(st, 'p1', [id, y]); st.players.p1.hand.push('BT10-013'); const tgt = cards.find(c => c.category === 'digimon' && S.parseDigiXros(c.id) && S.parseDigiXros(c.id).reqs.some(r => r.name && S.cardNameIs(id, r.name)));
    if (!tgt) return 'no xros target naming ' + id; st.players.p1.hand = [tgt.id]; const pl = S.planDigiXros(st, 'p1', 0);
    if (!pl) return 'no plan'; const m = pl.materials.filter(x => x.kind === 'stack');
    const hand0 = st.players.p1.hand.length; const s2 = S.playDigimonFresh(st, 'p1', 0, { materials: m }); await drain(st);
    const total = [...s2.sources, ...st.players.p1.hand, ...st.players.p1.trash].filter(x => x === y).length;
    return all(eq('y card returned to hand', st.players.p1.hand.includes(y), true), eq('no card duplication', total, 1));
  });
}
finish('slice3-r2-a');
