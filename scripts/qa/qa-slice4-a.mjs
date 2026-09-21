// Slice-4 official card Q&A scenarios, batch A (LM/RB/P promo). Q ids reference data/rulings/slice4.json (text not copied). Run: node scripts/qa/qa-slice4-a.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runDelay, drain, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const opt = (st, id, p = 'p1') => { const s = put(st, p, [id]); s.placedTurn = 1; return s; };
const onField = (st, p, id) => st.players[p].battle.some(s => s.cardId === id);
const FILL0 = () => pool(dig(3), 1)[0];
const FILLn = (n) => Array.from({ length: n }, () => pool(dig(3), 1)[0]);

// ---- LM-027..032 scramble options: main evolve keeps evolution conditions; 《딜레이》 usable w/o colored digimon in trash; return-to-deck is mandatory
const LMS = { 'LM-027': ['red', [4033, 4034, 4035, 4036, 4037]], 'LM-028': ['blue', [4038, 4039, 4040, 4041, 4042]], 'LM-029': ['yellow', [4043, 4044, 4045, 4046, 4047]], 'LM-030': ['green', [4048, 4049, 4050, 4051, 4052]], 'LM-031': ['black', [4053, 4054, 4055, 4056, 4057]], 'LM-032': ['purple', [4058, 4059, 4060, 4061, 4062]] };
for (const [id, [col, qs]] of Object.entries(LMS)) {
  // main evolve cannot ignore the evolution condition (a Lv6 card is not offered to a Lv3 digimon)
  add(qs[0], id, async (ck) => {
    const st = newState(); const a3 = pool(dig(3, col), 1)[0], a4 = pool(dig(4, col), 1)[0], a6 = pool(dig(6, col), 1)[0];
    put(st, 'p1', [a3]); st.players.p1.hand = [a6, a4]; let el = null;
    await runEffect(st, id, '메인', { idx: 0, picks: { pickFromZoneIndex: (o) => { el = o.eligibleIdxs; return o.eligibleIdxs?.[0] ?? null; } } });
    ck(el && !el.includes(0) && el.includes(1), 'eligible=' + JSON.stringify(el));
  });
  // no jogress-only evolution through the main evolve
  add(qs[1], id, async (ck) => {
    const jog = Object.values(C).find(c => c.category === 'digimon' && c.colors.includes(col) && /조그레스/.test(c.effectKo || '') && c.level >= 5);
    if (!jog) { ck(true); return; }
    const st = newState(); put(st, 'p1', [pool(dig(4, col), 1)[0]]); st.players.p1.hand = [jog.id];
    await runEffect(st, id, '메인', { idx: 0, picks: { pickFromZoneIndex: () => null } });
    ck(st.players.p1.battle[0].cardId !== jog.id, 'jogress card evolved via option');
  });
  // 《딜레이》 works although the trash has no digimon of the color
  add(qs[3], id, async (ck) => {
    const st = newState(); put(st, 'p2', [FILL0()]); const o = opt(st, id);
    await runEffect(st, id, '자신의 턴 개시 시', { stackUid: o.uid });
    ck(!onField(st, 'p1', id) && st.players.p1.trash.includes(id), 'delay not activated / option not trashed');
  });
  // the trash digimon must be returned to the deck top; it cannot be played instead of returning
  add(qs[4], id, async (ck) => {
    const st = newState(); put(st, 'p2', [FILL0()]); const o = opt(st, id); const d = pool(dig(3, col, c => (c.dp || 0) <= 2000), 1)[0];
    if (!d) { ck(true); return; }
    st.players.p1.trash = [d];
    await runEffect(st, id, '자신의 턴 개시 시', { stackUid: o.uid });
    ck(st.players.p1.deck[0] === d && !st.players.p1.battle.some(s => s.cardId === d), 'deck0=' + st.players.p1.deck[0]);
  });
}

// ---- P-103..108 training options: 《딜레이》 evolve keeps conditions; may decline
const PT = { 'P-103': ['red', [4188, 4189, 4190, 4191]], 'P-104': ['blue', [4192, 4193, 4194, 4195]], 'P-105': ['yellow', [4196, 4197, 4198, 4199]], 'P-106': ['green', [4200, 4201, 4202, 4203]], 'P-107': ['black', [4204, 4205, 4206, 4207]], 'P-108': ['purple', [4208, 4209, 4210, 4211]] };
for (const [id, [col, qs]] of Object.entries(PT)) {
  add(qs[0], id, async (ck) => {
    const st = newState(); const a3 = pool(dig(3, col), 1)[0], a4 = pool(dig(4, col), 1)[0], a6 = pool(dig(6, col), 1)[0];
    put(st, 'p1', [a3]); st.players.p1.hand = [a6, a4]; const o = opt(st, id); let el = null;
    const r = await runDelay(st, 'p1', o.uid, { pickFromZoneIndex: (x) => { el = x.eligibleIdxs; return x.eligibleIdxs?.[0] ?? null; } });
    ck(r.ok && el && !el.includes(0) && el.includes(1), 'eligible=' + JSON.stringify(el));
  });
  add(qs[3], id, async (ck) => {
    const st = newState(); const a3 = pool(dig(3, col), 1)[0], a4 = pool(dig(4, col), 1)[0];
    const me = put(st, 'p1', [a3]); st.players.p1.hand = [a4]; const o = opt(st, id);
    const r = await runDelay(st, 'p1', o.uid, { pickFromZoneIndex: () => null, pickStack: () => null });
    ck(r.ok && st.players.p1.battle.find(s => s.uid === me.uid).cardId === a3 && st.players.p1.hand.includes(a4), 'evolved anyway');
  });
}

// ---- LM-033..038 / P-035..040: color condition
const LMC = { 'LM-033': ['black', 4063, 4064], 'LM-034': ['red', 4065, 4066], 'LM-035': ['purple', 4067, 4068], 'LM-036': ['blue', 4069, 4070], 'LM-037': ['yellow', 4071, 4072], 'LM-038': ['green', 4073, 4074] };
for (const [id, [col, q1, q2]] of Object.entries(LMC)) {
  add(q1, id, async (ck) => { const st = newState(); put(st, 'p1', [pool(dig(3, col), 1)[0]]); ck(S.optionColorOk(st, 'p1', id) === true, 'extra color not accepted'); });
  add(q2, id, async (ck) => { const st = newState(); st.players.p1.raising = S._s4.makeStack(pool(dig(3, col), 1)[0], 1); ck(S.optionColorOk(st, 'p1', id) === true, 'raising-area digimon of extra color not accepted'); });
}
const PC = { 'P-035': ['red', 4149, 4150], 'P-036': ['blue', 4151, 4152], 'P-037': ['yellow', 4153, 4154], 'P-038': ['green', 4155, 4156], 'P-039': ['black', 4157, 4158], 'P-040': ['purple', 4159, 4160] };
for (const [id, [col, q1, q2]] of Object.entries(PC)) {
  add(q1, id, async (ck) => { const st = newState(); opt(st, id); ck(S.optionColorOk(st, 'p1', id) === false, 'option on board satisfied the color condition'); });
  add(q2, id, async (ck) => { const st = newState(); const o = opt(st, id); const m0 = st.memory; const r = await runDelay(st, 'p1', o.uid); ck(r.ok && st.memory === m0 + 2, 'delay memory ' + st.memory); });
}

// ---- LM-021 / LM-022: printed 〔진화〕 gate follows the security count at evolution time
for (const [id, nm, qs] of [['LM-021', '아구몬', [4013, 4014]], ['LM-022', '파피몬', [4020, 4021]]]) {
  const src = Object.values(C).find(c => c.category === 'digimon' && c.nameKo === nm && c.level <= 3);
  const chk = (n) => { const st = newState(); const s = put(st, 'p1', [src.id]); st.players.p1.security = FILLn(n); return E.canEvolveAny(src.id, id, s.extraColors || [], S.evolveTargetRestriction(st, 'p1', s)); };
  add(qs[0], id, async (ck) => { const r = chk(2); ck(r.ok && r.cost === 3, JSON.stringify(r)); });
  add(qs[1], id, async (ck) => { const r = chk(3); ck(!r.ok, 'evolved with 3 security ' + JSON.stringify(r)); });
}

// ---- LM-021 4018: DP total destroy: if targets fit, at least one is destroyed
add(4018, 'LM-021', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['LM-021']); const d = pool(dig(3), 3);
  put(st, 'p2', [d[0]]); put(st, 'p2', [d[1]]); const before = st.players.p2.battle.length;
  await runEffect(st, 'LM-021', '등장 시', { stackUid: me.uid });
  ck(st.players.p2.battle.length < before, 'no digimon destroyed although all fit within DP');
});

// ---- P-028: with exactly 3 security both draw and memory apply
add(4137, 'P-028', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-028']); st.players.p1.security = FILLn(3); const h0 = st.players.p1.hand.length, m0 = st.memory;
  await runEffect(st, 'P-028', '등장 시', { stackUid: me.uid });
  ck(st.players.p1.hand.length === h0 + 1 && st.memory === m0 + 1, `hand ${st.players.p1.hand.length - h0} mem ${st.memory - m0}`);
});

const R = await runAll(SC, 'qa-slice4-a');
process.exit(R.fail ? 1 : 0);
