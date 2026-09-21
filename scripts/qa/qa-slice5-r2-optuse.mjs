// Slice-5 round 2: "사용 코스트 N 이상의 옵션 카드를 사용했을 때" holders that round 1 did not iterate over
// (BT19-040/083, EX2-023/024, EX4-024/026/028/030, EX5-037, P-046, ST22-06).
// Q5450-family (free via effect still counts), Q5457-family (paid cost reduced still counts), Q5461/5504-family (hand card's own cost lowered below threshold does not count),
// Q5408-family (delay activation is not a "use").
import { S, E, newBoard, addStack, stk, mkChoose, drain, scenario, report, F3 } from './lib5.mjs';
const HOLD = { 'BT10-032': 2, 'BT17-031': 2, 'BT17-032': 2, 'BT17-038': 2, 'BT19-030': 2, 'BT19-034': 2, 'EX2-003': 2, 'EX2-021': 2, 'EX5-021': 1, 'EX8-031': 2, 'BT19-040': 2, 'BT19-083': 2, 'EX2-023': 2, 'EX2-024': 2, 'EX4-024': 2, 'EX4-026': 2, 'EX4-028': 2, 'EX4-030': 2, 'EX5-037': 1, 'P-046': 0, 'ST22-06': 0 };
const opt = Object.values(S.CARDS).find(c => c.category === 'option' && c.colors?.length === 1 && c.colors[0] === 'yellow' && (c.cost || 0) >= 3 && (c.cost || 0) <= 5 && !/시큐리티|딜레이/.test(c.effectKo + (c.inheritedKo || '')));
const OPT = opt.id;
const fill = (col) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.colors?.length === 1 && c.colors[0] === col && !c.effectKo && !c.inheritedKo).id;
const yel = fill('yellow'), red = fill('red');
function place(cfg, h, filler) {
  const c = S.card(h);
  if (c.category === 'tamer') cfg.p1.battle.push({ id: h });
  else if (/옵션(?: 카드를)? ?사용했을 때/.test(c.inheritedKo || '') && !/옵션(?: 카드를)? ?사용했을 때/.test(c.effectKo || '')) cfg.p1.battle.push({ id: filler, src: [h] });
  else cfg.p1.battle.push({ id: h });
  cfg.p1.battle.push({ id: filler });
  return cfg;
}
const trig = (st, h) => st.pending.filter(t => !t.resolved && t.cardId === h).length;
for (const [h, thr] of Object.entries(HOLD)) {
  await scenario('5450/5457 family', `${h}: normal / cost-reduced / free-by-effect option use triggers (printed cost counts)`, async (chk) => {
    let st = newBoard(place({ p1: { battle: [], hand: [OPT] }, p2: { battle: [] }, memory: 5 }, h, yel));
    chk(!!S.useOptionCard(st, 'p1', 0), 'used'); chk(trig(st, h) === 1, `normal use trigger ${trig(st, h)}`);
    st = newBoard(place({ p1: { battle: [], hand: [OPT] }, p2: { battle: [] }, memory: 5 }, h, yel));
    chk(!!S.useOptionCard(st, 'p1', 0, { costDelta: -10 }), 'used reduced'); chk(trig(st, h) === 1, `reduced-cost trigger ${trig(st, h)}`);
    st = newBoard(place({ p1: { battle: [], trash: [OPT] }, p2: { battle: [] }, memory: 5 }, h, yel));
    S.emitGameEvent(st, 'optionUsed', { owner: 'p1', stack: null, cardId: OPT, cause: 'effect', useCost: 0 }); chk(trig(st, h) === 1, `free-by-effect trigger ${trig(st, h)}`);
  });
  if (thr >= 1) await scenario('5461/5504 family', `${h}: hand card whose own use cost was lowered below ${thr} (BT8-097) does not trigger`, async (chk) => {
    const st = newBoard(place({ p1: { battle: [], hand: ['BT8-097'] }, p2: { battle: Array(6).fill(F3[0]) }, memory: 5 }, h, red));
    chk(!!S.useOptionCard(st, 'p1', 0), 'BT8-097 used'); chk(trig(st, h) === 0, `trigger ${trig(st, h)} want 0`);
  });
  await scenario('5408 family', `${h}: delay activation (discardForDelay) is not an option "use"`, async (chk) => {
    const st = newBoard(place({ p1: { battle: [], hand: [] }, p2: { battle: [] }, memory: 5 }, h, yel));
    const P = 'P-037'; const tk = S._s4.makeStack(P, st.turnNumber - 1); st.players.p1.battle.push(tk); st.pending.length = 0;
    chk(S.discardForDelay(st, 'p1', tk.uid) === P, 'delay discarded'); chk(trig(st, h) === 0, `trigger ${trig(st, h)} want 0`);
  });
}
report();
