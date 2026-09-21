// Slice-4 official card Q&A scenarios, batch E (mandatory/optional parts of effects, "그 후" independence). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-e.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runText, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 6)[i];
const ghost = (l) => pool(c => c.category === 'digimon' && c.level === l && (c.types || []).includes('고스트형'), 3);

// P-142: the digimon that gets the placed card may attack only when it is not rested (Q4249)
for (const [rested, expectAtk] of [[false, true], [true, false]]) add(4249, 'P-142' + (rested ? '(rested)' : '(active)'), async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-142']); const rv = put(st, 'p1', ['EX4-058']); rv.suspended = rested; put(st, 'p2', [D3()]); let atk = 0;
  await runEffect(st, 'P-142', '등장 시', { stackUid: me.uid, startAttack: () => { atk++; } });
  ck((atk > 0) === expectAtk, `attack started=${atk > 0}`); ck(!st.players.p1.battle.some(s => s.uid === me.uid), 'P-142 not placed under the 레이브몬');
});
// BT21-024: the 2nd sentence runs even if the "5 or fewer security" condition of the 1st is not met (Q4534)
add(4534, 'BT21-024', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT21-024']); st.players.p2.security = [D3(0), D3(1), D3(2), D3(3), D3(4), D3(5)]; const h0 = st.players.p2.hand.length;
  await runEffect(st, 'BT21-024', '등장 시', { stackUid: me.uid });
  ck(st.players.p2.security.length === 5 && st.players.p2.hand.length === h0, `opp security ${st.players.p2.security.length}`);
});
// BT21-021: the 【어택 종료 시】 self-destroy only happens after a card was actually played (Q4529)
add(4529, 'BT21-021', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT21-021']); st.players.p1.hand = [];
  await runEffect(st, 'BT21-021', '어택 종료 시', { stackUid: me.uid });
  ck(st.players.p1.battle.some(s => s.uid === me.uid), 'BT21-021 destroyed itself without playing a card');
});
// EX10-015: without a 《세이브》 card in hand nothing (no draw, no rest) happens (Q5045)
add(5045, 'EX10-015', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX10-015']); const t = put(st, 'p2', [D3()]); st.players.p1.hand = [D3()]; const h0 = st.players.p1.hand.length;
  await runEffect(st, 'EX10-015', '자신의 메인 페이즈 개시 시', { stackUid: me.uid });
  ck(!t.suspended && st.players.p1.hand.length === h0, `rested=${t.suspended} hand ${st.players.p1.hand.length}`);
});
// EX10-027: after discarding 1 hand card the trash card may be left there (optional return) (Q5082)
add(5082, 'EX10-027', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX10-027']); const vg = pool(c => c.category === 'digimon' && (c.types || []).includes('바그라군'), 1)[0]; st.players.p1.hand = [D3(0)]; st.players.p1.trash = [vg];
  await runEffect(st, 'EX10-027', '등장 시', { stackUid: me.uid, picks: { pickFromZoneIndex: () => null } });
  ck(st.players.p1.hand.length === 0 && st.players.p1.trash.includes(vg), 'hand ' + st.players.p1.hand.length + ' trash ' + st.players.p1.trash.length);
});
// EX10-040: opp trash 8 -> discard 2 each first, THEN check >=10 -> memory +1 (Q5120); opp trash 11 -> no discard but the memory still applies (Q5121)
add(5120, 'EX10-040', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX10-040']); st.players.p2.trash = Array(8).fill(D3()); const d1 = st.players.p1.deck.length, d2 = st.players.p2.deck.length, m0 = st.memory;
  await runEffect(st, 'EX10-040', '자신의 메인 페이즈 개시 시', { stackUid: me.uid });
  ck(st.players.p1.deck.length === d1 - 2 && st.players.p2.deck.length === d2 - 2 && st.memory === m0 + 1, `decks ${st.players.p1.deck.length - d1}/${st.players.p2.deck.length - d2} mem ${st.memory - m0}`);
});
add(5121, 'EX10-040', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX10-040']); st.players.p2.trash = Array(11).fill(D3()); const d1 = st.players.p1.deck.length, m0 = st.memory;
  await runEffect(st, 'EX10-040', '자신의 메인 페이즈 개시 시', { stackUid: me.uid });
  ck(st.players.p1.deck.length === d1 && st.memory === m0 + 1, `deck ${st.players.p1.deck.length - d1} mem ${st.memory - m0}`);
});
// BT20-098: returning opp trash digimon with Lv total exactly 9 (partial not allowed), then one same-Lv 고스트형 per returned card (Q4440/4441)
add(4441, 'BT20-098', async (ck) => {
  const g3 = ghost(3); const st = newState(); const o3 = pool(dig(3), 3); st.players.p2.trash = [...o3]; st.players.p1.trash = [...g3.slice(0, 3)]; if (g3.length < 3) { ck(true); return; }
  put(st, 'p1', [D3()]);
  await runEffect(st, 'BT20-098', '메인', { idx: 0 });
  const on = st.players.p1.battle.filter(s => g3.includes(s.cardId)).length; ck(on === 3 && st.players.p2.trash.length === 0, `ghosts played ${on}, opp trash ${st.players.p2.trash.length}`);
});
add(4439, 'BT20-098', async (ck) => { // only Lv6 (< 9 reachable with Lv3+Lv6 only if both present): total 8 available cannot reach 9 -> nothing returned
  const st = newState(); st.players.p2.trash = pool(dig(4), 2); st.players.p1.trash = ghost(3);
  await runEffect(st, 'BT20-098', '메인', { idx: 0 });
  ck(st.players.p2.trash.length === 2, 'partial return happened: opp trash ' + st.players.p2.trash.length);
});
// EX9-018: without placing a trash digimon face-down the follow-up (discard opp sources / bounce) is NOT processed (Q4761)
add(4761, 'EX9-018', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-018']); const a = put(st, 'p2', [D3(0), D3(1)]); const b = put(st, 'p2', [D3(2)]); st.players.p1.trash = [];
  await runEffect(st, 'EX9-018', '등장 시', { stackUid: me.uid });
  ck(a.sources.length === 1 && st.players.p2.battle.includes(b), `sources ${a.sources.length}, sourceless digimon alive=${st.players.p2.battle.includes(b)}`);
});

const R = await runAll(SC, 'qa-slice4-e');
process.exit(R.fail ? 1 : 0);
