// Slice-4 official card Q&A scenarios, batch H (raising area movement). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-h.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, drain, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 6)[i];

// P-123: when an own digimon moves raising -> battle its 【자신의 턴】 effect fires even with nothing to hatch (memory +1) (Q4236) ...
add(4236, 'P-123', async (ck) => {
  const st = newState(); put(st, 'p1', ['P-123']); st.players.p1.raising = S._s4.makeStack(D3(), 1); st.players.p1.digitamaDeck = [];
  S.moveRaisingToBattle(st, 'p1'); await drain(st); ck(st.memory === 1, 'memory ' + st.memory);
});
// ... and also when P-123 itself is the digimon that moves (Q4239)
add(4239, 'P-123', async (ck) => {
  const st = newState(); st.players.p1.raising = S._s4.makeStack('P-123', 1); st.players.p1.digitamaDeck = [];
  S.moveRaisingToBattle(st, 'p1'); await drain(st); ck(st.memory === 1, 'memory ' + st.memory);
});
// P-143: moves to the empty raising area; evolution cards stay under it and overflow is NOT processed (Q4250 / Q4251); a rested digimon stays rested (Q4256)
add(4250, 'P-143', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-143', 'LM-021']); me.suspended = true; const m0 = st.memory;
  await runEffect(st, 'P-143', '자신의 턴 종료 시', { stackUid: me.uid });
  const r = st.players.p1.raising; ck(r && r.cardId === 'P-143', 'not moved to raising');
  ck(st.memory === m0, 'overflow processed: memory ' + st.memory); ck(r && r.sources.includes('LM-021'), 'evolution cards were discarded'); ck(r && r.suspended === true, 'state not kept');
});
const R = await runAll(SC, 'qa-slice4-h');
process.exit(R.fail ? 1 : 0);
