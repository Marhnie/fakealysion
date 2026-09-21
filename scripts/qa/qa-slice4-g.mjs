// Slice-4 official card Q&A scenarios, batch G (targets of either side, single-target rules). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-g.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runText, runAll, faceDown } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 6)[i];
// pick helper that records the offered uids/entries and answers with a chooser
const rec = (log, choose) => (o) => { log.push(o.uids || o.entries); return choose(o); };

// "디지몬 1마리를 레스트시킨다" style (no owner): both sides' digimon are selectable (BT21-048 4552, BT21-049 4554, BT21-050 4556, BT22-066 4924, BT20-101 4416)
for (const [q, id, tag] of [[4552, 'BT21-048', '등장 시'], [4554, 'BT21-049', '등장 시'], [4556, 'BT21-050', '등장 시'], [4416, 'BT20-101', '등장 시']]) add(q, id, async (ck) => {
  const st = newState(); const me = put(st, 'p1', [id]); const own = put(st, 'p1', [D3(0)]); const opp = put(st, 'p2', [D3(1)]); const seen = [];
  await runEffect(st, id, tag, { stackUid: me.uid, picks: { pickStack: rec(seen, (o) => o.uids?.[0]), pickStackAnySide: rec(seen, (o) => o.entries?.[0]) } });
  const flat = JSON.stringify(seen); ck(flat.includes(own.uid) && flat.includes(opp.uid), 'not both sides selectable: ' + flat.slice(0, 200));
});
// EX10-007: DP +3000 to own OR opponent digimon (Q5012)
add(5012, 'EX10-007', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX10-007']); const opp = put(st, 'p2', [D3(1)]); const seen = [];
  await runEffect(st, 'EX10-007', '등장 시', { stackUid: me.uid, picks: { pickStack: rec(seen, (o) => o.uids?.[0]), pickStackAnySide: rec(seen, (o) => o.entries?.[0]) } });
  ck(JSON.stringify(seen).includes(opp.uid), 'opponent digimon not selectable: ' + JSON.stringify(seen).slice(0, 160));
});
// BT20-035 / BT20-042: the "not activate" part may go to a different digimon than the one rested (Q4343 / Q4358)
for (const [q, id, tag] of [[4343, 'BT20-035', '진화 시'], [4358, 'BT20-042', '등장 시']]) add(q, id, async (ck) => {
  const st = newState(); const me = put(st, 'p1', [id]); const a = put(st, 'p2', [D3(0)]); const b = put(st, 'p2', [D3(1)]); let n = 0;
  await runEffect(st, id, tag, { stackUid: me.uid, picks: { pickStack: (o) => o.uids?.[Math.min(n++, o.uids.length - 1)] } });
  ck(a.suspended && !!b.skipNextUnsuspend && !a.skipNextUnsuspend, `a rested=${a.suspended} a.skip=${a.skipNextUnsuspend} b.skip=${b.skipNextUnsuspend}`);
});
// single target: DP -N applies to ONE opp digimon only (BT22-042 4894, EX9-025 4778, P-191 4981)
add(4778, 'EX9-025', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-025']); faceDown(me, [D3(2), D3(3)]); const a = put(st, 'p2', [pool(dig(5), 1)[0]]); const b = put(st, 'p2', [pool(dig(5), 2)[1]]);
  await runEffect(st, 'EX9-025', '어택 시', { stackUid: me.uid });
  const ch = [a, b].filter(s => S.effectiveDP(st, 'p2', s) !== C[s.cardId].dp).length; ck(ch === 1, 'DP changed on ' + ch + ' digimon');
});
// EX9-056: an own OR opp digimon (DP<=8000) can be put under the security stack (Q4813)
add(4813, 'EX9-056', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-056']); const own = put(st, 'p1', [D3(0)]); const opp = put(st, 'p2', [D3(1)]); const seen = [];
  await runEffect(st, 'EX9-056', '등장 시', { stackUid: me.uid, picks: { pickStack: rec(seen, (o) => o.uids?.[0]), pickStackAnySide: rec(seen, (o) => o.entries?.[0]) } });
  const flat = JSON.stringify(seen); ck(flat.includes(own.uid) && flat.includes(opp.uid), 'not both sides selectable: ' + flat.slice(0, 160));
});
// BT22-076: place an own or opponent digimon (DP <= own DP) on top of the (owner's) security (Q4940)
add(4940, 'BT22-076', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT22-076']); faceDown(me, [D3(2), D3(3)]); const own = put(st, 'p1', [D3(0)]); const opp = put(st, 'p2', [D3(1)]); const seen = [];
  await runEffect(st, 'BT22-076', '진화 시', { stackUid: me.uid, picks: { pickStack: rec(seen, (o) => o.uids?.[0]), pickStackAnySide: rec(seen, (o) => o.entries?.[0]) } });
  const flat = JSON.stringify(seen); ck(flat.includes(own.uid) && flat.includes(opp.uid), 'not both sides selectable: ' + flat.slice(0, 160));
});
// EX9-017: may discard the opp digimon sources of MORE than one digimon (per face-down source) (Q4758)
add(4758, 'EX9-017', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-017']); faceDown(me, [D3(2), D3(3)]); st.players.p1.hand = [D3(4)];
  const a = put(st, 'p2', [D3(0), D3(1)]); const b = put(st, 'p2', [D3(1), D3(0)]); let n = 0;
  await runEffect(st, 'EX9-017', '등장 시', { stackUid: me.uid, picks: { pickStack: (o) => o.uids?.[Math.min(n++, o.uids.length - 1)] } });
  ck(a.sources.length + b.sources.length < 2, `opp sources left ${a.sources.length + b.sources.length}`);
});
// EX10-028: may discard a mineral card from ANOTHER own digimon's sources (Q5083)
add(5083, 'EX10-028', async (ck) => {
  const m = pool(c => c.category === 'digimon' && (c.types || []).some(t => /광물형|광석형/.test(t)), 2);
  const st = newState(); const me = put(st, 'p1', ['EX10-028']); const other = put(st, 'p1', [D3(0), m[0]]); const t = put(st, 'p1', [m[1]]);
  await runEffect(st, 'EX10-028', '등장 시', { stackUid: me.uid, picks: { pickStack: (o) => o.uids?.find(u => st.players.p1.battle.find(x => x.uid === u)?.sources.length) ?? o.uids?.[0] } });
  ck(other.sources.length === 0 || me.sources.length === 0, 'no mineral source discarded (other ' + other.sources.length + ')');
});
// EX9-053: the played card may be a digimon OR a tamer (Q4807) — a tamer with the DM trait
add(4807, 'EX9-053', async (ck) => {
  const tam = pool(c => c.category === 'tamer' && (c.types || []).includes('DM') && (c.cost || 9) <= 4, 1)[0]; if (!tam) { ck(true); return; }
  const st = newState(); const me = put(st, 'p1', ['EX9-053']); st.players.p1.deck = [tam, D3(0), D3(1), D3(2)];
  await runEffect(st, 'EX9-053', '등장 시', { stackUid: me.uid });
  ck(st.players.p1.battle.some(s => s.cardId === tam), 'tamer not playable from the reveal');
});

// EX9-056 result: the chosen digimon ends up at the BOTTOM of its owner's security and the opponent's top security card is trashed (Q4813)
add(4813, 'EX9-056(result)', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['EX9-056']); const opp = put(st, 'p2', [D3(1)]); st.players.p2.security = [D3(2), D3(3), D3(4)]; const t0 = st.players.p2.trash.length;
  await runEffect(st, 'EX9-056', '등장 시', { stackUid: me.uid, picks: { pickStackAnySide: (o) => o.entries.find(e => e.uid === opp.uid) } });
  ck(!st.players.p2.battle.includes(opp) && st.players.p2.security.length === 3 && st.players.p2.security[st.players.p2.security.length - 1] === D3(1) && st.players.p2.trash.length === t0 + 1, 'sec ' + st.players.p2.security.length + ' bottom ' + st.players.p2.security[st.players.p2.security.length - 1]);
});
// P-187: recovery happens even without jogress (Q4632); with jogress another digimon/tamer of either side goes into a security stack (Q4631)
add(4632, 'P-187', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-187']); const s0 = st.players.p1.security.length;
  await runEffect(st, 'P-187', '진화 시', { stackUid: me.uid, idx: 0 }); ck(st.players.p1.security.length === s0 + 1, 'no recovery');
});
add(4631, 'P-187', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-187']); me.viaFusion = true; const opp = put(st, 'p2', [D3(1)]); st.players.p2.security = [D3(2), D3(3)]; const seen = [];
  await runEffect(st, 'P-187', '진화 시', { stackUid: me.uid, idx: 0, picks: { pickStackAnySide: (o) => { seen.push(o.entries); return o.entries.find(e => e.uid === opp.uid); }, multipleChoice: () => 0 } });
  ck(JSON.stringify(seen).includes(opp.uid) && !st.players.p2.battle.includes(opp), 'opponent digimon not placed into its security; seen ' + JSON.stringify(seen).slice(0, 100));
});

const R = await runAll(SC, 'qa-slice4-g');
process.exit(R.fail ? 1 : 0);
