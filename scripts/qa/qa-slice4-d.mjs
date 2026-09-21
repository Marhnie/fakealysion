// Slice-4 official card Q&A scenarios, batch D (BT20-BT22 / EX9-EX10 cards, raising-area rules). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-d.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runText, runDelay, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 5)[i];
const lv = (n, k = 3) => pool(dig(n), k);
const mineral = () => pool(c => c.category === 'digimon' && (c.types || []).some(t => /광물형|광석형/.test(t)), 4);

// A digimon in the RAISING area does not get its (non-[육성]) 【자신의 턴】 evolution-cost reduction when evolving (11 cards share this Q)
const RAISING_COST = { 4292: 'BT20-010', 4323: 'BT20-029', 4355: 'BT20-038', 4369: 'BT20-046', 4521: 'BT21-011', 4543: 'BT21-031', 4544: 'BT21-032', 4559: 'BT21-055', 4573: 'BT21-065', 4788: 'EX9-036', 4873: 'BT22-019' };
for (const [q, id] of Object.entries(RAISING_COST)) {
  add(+q, id, async (ck) => {
    const st = newState(); const b = put(st, 'p1', [id]); let tgt = null;
    for (const t of Object.values(C)) { if (t.category !== 'digimon' || t.level !== C[id].level + 1 || !E.canEvolveAny(id, t.id, [], null).ok) continue; if (S.previewEvoCostDelta(st, 'p1', b, t.id) < 0) { tgt = t.id; break; } }
    ck(!!tgt, 'no discounted evolve target found');
    const st2 = newState(); st2.players.p1.raising = S._s4.makeStack(id, 1);
    ck(tgt && S.previewEvoCostDelta(st2, 'p1', st2.players.p1.raising, tgt) === 0, 'raising-area digimon got the cost reduction');
  });
}

// RB1-009: 「감마몬」 whose sources contain a 감마몬-named card may evolve into it ignoring conditions at cost 3
add(4080, 'RB1-009', async (ck) => {
  const st = newState(); st.players.p1.hand = ['RB1-009']; const s = put(st, 'p1', ['P-059', 'BT8-013']); // 감마몬 + 베텔감마몬 as source
  const r = E.canEvolveAny('P-059', 'RB1-009', s.extraColors || [], S.evolveTargetRestriction(st, 'p1', s)); ck(r.ok && r.cost === 3, JSON.stringify(r));
  const s2 = put(st, 'p1', ['P-059']); const r2 = E.canEvolveAny('P-059', 'RB1-009', s2.extraColors || [], S.evolveTargetRestriction(st, 'p1', s2)); ck(!r2.ok, 'evolved without the named source ' + JSON.stringify(r2));
});

// EX9-055: 네가몬 counted over trash + digimon sources together (2+2 = 4)
add(4810, 'EX9-055', async (ck) => {
  const ng = pool(c => c.category === 'digimon' && c.nameKo === '네가몬', 4); if (ng.length < 4) { ck(true); return; }
  const st = newState(); const me = put(st, 'p1', ['EX9-055', ng[0], ng[1]]); st.players.p1.trash = [ng[2], ng[3]]; st.players.p1.hand = ['EX9-057'];
  await runEffect(st, 'EX9-055', '등장 시', { stackUid: me.uid }); ck(st.players.p1.raising?.cardId === 'EX9-057', 'core not played into raising: ' + st.players.p1.raising?.cardId);
  const st2 = newState(); const me2 = put(st2, 'p1', ['EX9-055', ng[0], ng[1]]); st2.players.p1.trash = [ng[2]]; st2.players.p1.hand = ['EX9-057'];
  await runEffect(st2, 'EX9-055', '등장 시', { stackUid: me2.uid }); ck(!st2.players.p1.raising, 'core played with only 3 네가몬');
});

// BT22-015: one opp digimon returned per PAIR of same-Lv cards among evolution cards (3xLv4 + 3xLv5 -> 2)
add(4871, 'BT22-015', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT22-015', ...lv(4, 3), ...lv(5, 3)]); put(st, 'p2', [D3(0)]); put(st, 'p2', [D3(1)]); put(st, 'p2', [D3(2)]);
  await runEffect(st, 'BT22-015', '진화 시', { stackUid: me.uid, picks: { pickStack: (o) => o.uids?.[0] } });
  ck(st.players.p2.battle.length === 1, 'opp field ' + st.players.p2.battle.length);
});
// BT20-037: rest + memory +1 per Lv6 evolution card
add(4347, 'BT20-037', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT20-037', ...lv(6, 2)]); const a = put(st, 'p2', [D3(0)]); const b = put(st, 'p2', [D3(1)]); const m0 = st.memory;
  await runEffect(st, 'BT20-037', '진화 시', { stackUid: me.uid });
  ck(a.suspended && b.suspended && st.memory === m0 + 2, `rested ${a.suspended}/${b.suspended} mem ${st.memory - m0}`);
});
// BT18-018: per evolution-card COLOR (red/blue/green = 3): discard one opp source + rest one opp digimon each
add(4289, 'BT18-018', async (ck) => {
  const r = pool(dig(3, 'red'), 1)[0], b = pool(dig(3, 'blue'), 1)[0], g = pool(dig(3, 'green'), 1)[0];
  const st = newState(); const me = put(st, 'p1', ['BT18-018', r, b, g]); const o = [0, 1, 2].map(i => put(st, 'p2', [D3(i), D3(i + 1)]));
  await runEffect(st, 'BT18-018', '진화 시', { stackUid: me.uid, picks: { pickStack: (o) => { const withSrc = o.uids.find(u => st.players.p2.battle.find(x => x.uid === u).sources.length > 0); return /파기/.test(o.prompt) ? (withSrc ?? o.uids[0]) : o.uids[0]; } } });
  ck(o.every(s => s.suspended) && o.every(s => s.sources.length === 0), `rested ${o.map(s => s.suspended)} sources ${o.map(s => s.sources.length)}`);
});
// EX10-025: with 2 minerals in trash both go under (as many as possible); with only 1 that one may be placed
add(5078, 'EX10-025', async (ck) => {
  const m = mineral(); const st = newState(); const me = put(st, 'p1', ['EX10-025']); st.players.p1.trash = [m[0], m[1]]; const s0 = me.sources.length;
  await runEffect(st, 'EX10-025', '등장 시', { stackUid: me.uid });
  ck(me.sources.length === s0 + 2 && st.players.p1.trash.length === 0, `placed ${me.sources.length - s0}`);
});
add(5079, 'EX10-025', async (ck) => {
  const m = mineral(); const st = newState(); const me = put(st, 'p1', ['EX10-025']); st.players.p1.trash = [m[0]]; const s0 = me.sources.length;
  await runEffect(st, 'EX10-025', '등장 시', { stackUid: me.uid });
  ck(me.sources.length === s0 + 1, `placed ${me.sources.length - s0}`);
});
// EX9-021: after the attack, BOTH sources (a 그레이몬-type and a 가루몬-type) are played, not just one; with only one type present that one is played
add(4766, 'EX9-021', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-021', 'BT1-015', 'BT1-036']);
  await runEffect(st, 'EX9-021', '어택 종료 시', { stackUid: me.uid });
  const on = (id) => st.players.p1.battle.some(s => s.cardId === id); ck(on('BT1-015') && on('BT1-036'), `played 그레이몬=${on('BT1-015')} 가루몬=${on('BT1-036')}`);
});
add(4767, 'EX9-021', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-021', 'BT1-015']);
  await runEffect(st, 'EX9-021', '어택 종료 시', { stackUid: me.uid });
  ck(st.players.p1.battle.some(s => s.cardId === 'BT1-015'), 'single-type play not possible');
});
// BT22-007 (raising): plays as many 마더 이터 as exist (2 -> 2, 3 -> 3, never fewer than all)
for (const [q, n] of [[4859, 2], [4860, 3]]) add(q, 'BT22-007', async (ck) => {
  const st = newState(); const ra = S._s4.makeStack('BT22-007', 1); ra.sources = [...Array(n).fill('BT22-007'), ...Array(10 - n).fill(D3())]; st.players.p1.raising = ra; st.players.p1.deck = [D3(), D3(), D3()];
  await runEffect(st, 'BT22-007', '자신의 메인 페이즈 개시 시', { stackUid: ra.uid });
  const played = st.players.p1.battle.filter(s => s.cardId === 'BT22-007').length; ck(played === n, `played ${played} of ${n}`);
});

const R = await runAll(SC, 'qa-slice4-d');
process.exit(R.fail ? 1 : 0);
