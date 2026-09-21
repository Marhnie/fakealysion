// Slice-5 official Q&A: "디지몬 1마리를 레스트시킨다" style effects may target EITHER player's digimon (Q5305, 5311, 5445, 5648-ish, 5816, 5840, 5857, 5948, 6322, 5632, 6248...).
// Expected (own words): the target picker offers the opponent's digimon as well as the player's own (both sides), unless the text names a side.
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn } from './lib5.mjs';
const lv3 = fillerLv(3), lv4 = fillerLv(4);
const cases = [
  ['BT23-044', 'play', '5305', 'rest-cost', 1], ['BT23-046', 'play', '5311', 'rest-cost', 1], ['BT24-044', 'play', '5632', 'rest', 1], ['EX11-026', 'play', '5816', 'rest', 1],
  ['EX11-035', 'digivolve', '5857', 'active/rest', 1], ['ST22-13', 'play', '5445', 'rest', 1], ['EX11-074', 'digivolve', '5948', 'rest', 1], ['BT25-050', 'play', '6322', 'rest', 1], ['BT25-055', 'play', '6322', 'rest', 1],
];
for (const [id, evt, q, what] of cases) {
  await scenario(q, `${id}: target picker for "${what}" offers own AND opponent digimon`, async (chk) => {
    const st = newBoard({ p1: { battle: [id, lv3[0]] }, p2: { battle: [lv4[0]] } });
    const seen = []; const oppU = st.players.p2.battle.map(s => s.uid), ownU = st.players.p1.battle.map(s => s.uid);
    await runOn(st, 'p1', id, evt, { answer: (k, o) => { if (/^pickStack/.test(k)) { const list = (o.uids || (o.entries || []).map(e => e.uid || e)) || []; seen.push({ k, list }); } return undefined; } });
    const flat = seen.flatMap(x => x.list.map(e => (typeof e === 'string' ? e : e.uid || e.stackUid)));
    chk(seen.length > 0, 'no target prompt at all');
    chk(flat.some(u => oppU.includes(u)) && flat.some(u => ownU.includes(u)), 'candidates: ' + JSON.stringify(seen).slice(0, 300));
  });
}
report();
