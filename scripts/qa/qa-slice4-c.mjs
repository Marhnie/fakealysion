// Slice-4 official card Q&A scenarios, batch C (effect immunity, forced destruction, "if not destroyed" conditions). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-c.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runText, runDelay, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 4)[i];
const immune = (st, p, s) => S.grantShield(st, p, s.uid, { kinds: ['all'], until: 99 });
const lowDp = () => pool(dig(3, null, c => (c.dp || 0) <= 3000), 3);

// "효과를 받지 않는다" (BT20-019 / BT20-059 / ST20-11): can be selected, but no effect applies
add(4304, 'BT20-019', async (ck) => { // may be chosen by an effect ...
  const st = newState(); const me = put(st, 'p1', [pool(dig(4), 1)[0]]); const im = put(st, 'p2', [D3()]); immune(st, 'p2', im); let seen = null;
  await runText(st, '상대의 디지몬 1마리를 레스트시킨다.', { stackUid: me.uid, picks: { pickStack: (o) => { seen = o.uids; return o.uids?.[0]; } } });
  ck(seen && seen.includes(im.uid), 'immune digimon not selectable'); ck(!im.suspended, '... but it was rested');
});
add(4303, 'BT20-019', async (ck) => { // DP -3000 does not apply
  const st = newState(); const me = put(st, 'p1', [pool(dig(4), 1)[0]]); const im = put(st, 'p2', [D3()]); immune(st, 'p2', im);
  await runText(st, '턴 종료까지 상대의 디지몬 1마리를 DP -3000.', { stackUid: me.uid }); ck(S.effectiveDP(st, 'p2', im) === C[im.cardId].dp, 'DP changed to ' + S.effectiveDP(st, 'p2', im));
});
add(4457, 'ST20-11', async (ck) => { // 2 tamer colors -> 1 own digimon becomes immune to the opponent's effects until opp turn end
  const st = newState(); const me = put(st, 'p1', ['ST20-11']); put(st, 'p1', ['BT1-087']); put(st, 'p1', ['BT3-093']); const o = put(st, 'p2', [D3()]);
  await runEffect(st, 'ST20-11', '등장 시', { stackUid: me.uid });
  ck((me.shields || []).length > 0 || st.players.p1.battle.some(s => (s.shields || []).length), 'no digimon received the immunity');
});

// BT21-068: must select and destroy a DP<=4000 digimon; "if it did not get destroyed" side effect only when nothing was destroyed
add(4575, 'BT21-068', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT21-068']); const t = put(st, 'p2', [lowDp()[0]]); const dk = st.players.p1.deck.length;
  let req = null; await runEffect(st, 'BT21-068', '등장 시', { stackUid: me.uid, picks: { pickStack: (o) => { req = o.required; return o.uids?.[0]; } } });
  ck(req === true, 'selection not mandatory (required=' + req + ')'); ck(!st.players.p2.battle.some(s => s.uid === t.uid) && st.players.p1.deck.length === dk, `target alive=${st.players.p2.battle.some(s => s.uid === t.uid)} deck ${st.players.p1.deck.length - dk}`);
});
add(4576, 'BT21-068', async (ck) => { // an effect-immune target counts as "not destroyed": the deck-trash step runs
  const st = newState(); const me = put(st, 'p1', ['BT21-068']); const t = put(st, 'p2', [lowDp()[0]]); immune(st, 'p2', t); const dk = st.players.p1.deck.length;
  await runEffect(st, 'BT21-068', '등장 시', { stackUid: me.uid });
  ck(st.players.p2.battle.some(s => s.uid === t.uid) && st.players.p1.deck.length === dk - 2, `deck ${st.players.p1.deck.length - dk}`);
});
add(4629, 'P-186', async (ck) => { // DP13000+ digimon exists: it must be destroyed, so the recovery is not granted
  const big = pool(c => c.category === 'digimon' && (c.dp || 0) >= 13000, 1)[0]; const st = newState(); const me = put(st, 'p1', ['P-186']); const t = put(st, 'p2', [big]); const sc = st.players.p1.security.length;
  await runEffect(st, 'P-186', '등장 시', { stackUid: me.uid, picks: { pickStack: () => null } });
  ck(!st.players.p2.battle.some(s => s.uid === t.uid) && st.players.p1.security.length === sc, `alive=${st.players.p2.battle.some(s => s.uid === t.uid)} sec+${st.players.p1.security.length - sc}`);
});
add(4630, 'P-186', async (ck) => { // immune DP13000+ digimon is not destroyed -> recovery happens
  const big = pool(c => c.category === 'digimon' && (c.dp || 0) >= 13000, 1)[0]; const st = newState(); const me = put(st, 'p1', ['P-186']); const t = put(st, 'p2', [big]); immune(st, 'p2', t); const sc = st.players.p1.security.length;
  await runEffect(st, 'P-186', '등장 시', { stackUid: me.uid });
  ck(st.players.p2.battle.some(s => s.uid === t.uid) && st.players.p1.security.length === sc + 1, `sec+${st.players.p1.security.length - sc}`);
});
add(5016, 'EX10-009', async (ck) => { // no opp digimon at all: counts as "did not destroy" -> opp deck top 5 trashed
  const st = newState(); const me = put(st, 'p1', ['EX10-009']); const d0 = st.players.p2.deck.length;
  await runEffect(st, 'EX10-009', '진화 시', { stackUid: me.uid });
  ck(st.players.p2.deck.length === d0 - 5, 'opp deck ' + (st.players.p2.deck.length - d0));
});
add(5018, 'EX10-009', async (ck) => { // one immune + one normal digimon with the same lowest DP: the normal one dies, so the condition is NOT met
  const [a, b] = lowDp(); const st = newState(); const me = put(st, 'p1', ['EX10-009']); const im = put(st, 'p2', [a]); immune(st, 'p2', im); const nm = put(st, 'p2', [a]); const d0 = st.players.p2.deck.length;
  await runEffect(st, 'EX10-009', '진화 시', { stackUid: me.uid });
  ck(!st.players.p2.battle.some(s => s.uid === nm.uid) && st.players.p2.deck.length === d0, `normal alive=${st.players.p2.battle.some(s => s.uid === nm.uid)} deck ${st.players.p2.deck.length - d0}`);
});
add(4936, 'BT22-074', async (ck) => { // Lv5 or lower opp digimon exists: must be destroyed, so no attack/S-attack bonus
  const st = newState(); const me = put(st, 'p1', ['BT22-074']); put(st, 'p2', [D3()]); st.memory = 5;
  const seg = S.parseEffectSegments(C['BT22-074'].effectKo).segments.find(s => s.tags.includes('메인'));
  await runEffect(st, 'BT22-074', '메인', { stackUid: me.uid, text: seg.body });
  ck(st.players.p2.battle.length === 0 && !S.hasKeyword(me, 'S 어택') , 'target alive or bonus given; opp field ' + st.players.p2.battle.length);
});

// BT20-081: two different opp digimon each -10000; not the same digimon twice
add(4406, 'BT20-081', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT20-081']); const t = put(st, 'p2', [pool(dig(5), 1)[0]]); const d0 = C[t.cardId].dp;
  await runEffect(st, 'BT20-081', '등장 시', { stackUid: me.uid });
  ck(S.effectiveDP(st, 'p2', t) === d0 - 10000 || S.effectiveDP(st, 'p2', t) <= 0, 'DP ' + S.effectiveDP(st, 'p2', t) + ' vs ' + d0);
});
// DP reaching 0 mid-effect: the digimon is removed only after the whole effect resolves (ruleSweep)
add(4407, 'BT20-081', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT20-081']); const t = put(st, 'p2', [lowDp()[0]]);
  await runEffect(st, 'BT20-081', '등장 시', { stackUid: me.uid });
  ck(!st.players.p2.battle.some(s => s.uid === t.uid), 'DP0 digimon not removed after resolution');
});

// P-088: DP 12000+ -> destroys two DP<=6000 digimon instead of one (no choosing fewer)
add(4180, 'P-088', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-088']); me.tempDP = 1500; const a = put(st, 'p2', [lowDp()[0]]); const b = put(st, 'p2', [lowDp()[1]]);
  const reqs = []; await runEffect(st, 'P-088', '어택 시', { stackUid: me.uid, picks: { pickStack: (o) => { reqs.push(o.required); return o.uids?.[0]; } } });
  ck(reqs.length >= 1 && reqs.every(x => x === true), 'selections not mandatory: ' + JSON.stringify(reqs)); ck(st.players.p2.battle.length === 0, 'opp field left ' + st.players.p2.battle.length);
});
// P-102: sacrificing itself is allowed
add(4187, 'P-102', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-102']); put(st, 'p2', [lowDp()[0]]); put(st, 'p2', [lowDp()[1]]);
  await runEffect(st, 'P-102', '등장 시', { stackUid: me.uid, picks: { pickStack: (o) => o.uids?.includes(me.uid) ? me.uid : o.uids?.[0] } });
  ck(!st.players.p1.battle.some(s => s.uid === me.uid) && st.players.p2.battle.length === 0, `self alive=${st.players.p1.battle.some(s => s.uid === me.uid)} opp ${st.players.p2.battle.length}`);
});
// P-111: only ONE opp digimon is targeted, DP -3000 per own digimon
add(4215, 'P-111', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-111']); put(st, 'p1', [D3()]); const a = put(st, 'p2', [pool(dig(5), 1)[0]]); const b = put(st, 'p2', [pool(dig(5), 2)[1]]);
  await runEffect(st, 'P-111', '등장 시', { stackUid: me.uid });
  const ch = [a, b].filter(s => S.effectiveDP(st, 'p2', s) !== C[s.cardId].dp).length;
  ck(ch === 1, 'digimon with changed DP: ' + ch);
});

const R = await runAll(SC, 'qa-slice4-c');
process.exit(R.fail ? 1 : 0);
