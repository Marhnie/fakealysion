// Slice-5 official Q&A: "옵션 카드를 사용했을 때" triggers keyed on the printed use cost (Q5449-5518, 5516).
// Expected outcomes (own words): a use whose PAID cost was reduced (or free via an effect) still counts as the original printed cost; only a hand card whose
// own use cost is lowered by its own text (BT2-099 / BT8-097 style) counts with the lowered value; uses by effect (security/delay) are not "use".
import { S, E, newBoard, addStack, stk, mkChoose, drain, scenario, report, F3, pend } from './lib5.mjs';

const HOLD2 = ['BT10-032', 'BT17-031', 'BT17-032', 'BT19-030', 'BT19-034', 'EX2-021', 'EX8-031'];     // inherited, threshold 2 (Q5450-5515)
const HOLD2_TOP = ['BT17-038', 'EX2-003']; // BT17-038 has it as a main effect; EX2-003 digitama inherited
const HOLD1 = ['EX5-021'];                    // threshold 1 (Q5504-5506)
const opts = Object.values(S.CARDS).filter(c => c.category === 'option' && (c.colors || []).length === 1 && c.colors[0] === 'yellow' && (c.cost || 0) >= 3 && (c.cost || 0) <= 5 && !/시큐리티/.test(c.inheritedKo || '')).map(c => c.id);
const OPT = opts[0];
const redFill = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.colors?.length === 1 && c.colors[0] === 'red' && !c.effectKo && !c.inheritedKo).id;
const yelFill = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.colors?.length === 1 && c.colors[0] === 'yellow' && !c.effectKo && !c.inheritedKo).id;

function board(holder, inhSrc) {
  const isTop = S.card(holder).category === 'digimon' && !S.card(holder).inheritedKo?.includes('사용 코스트');
  const cfg = { p1: { battle: [], hand: [OPT] }, p2: { battle: [] }, memory: 5 };
  if (isTop) cfg.p1.battle.push({ id: holder }); else cfg.p1.battle.push({ id: yelFill, src: [holder] });
  cfg.p1.battle.push({ id: yelFill });
  return newBoard(cfg);
}
const trig = (st, holder) => st.pending.filter(t => !t.resolved && t.cardId === holder).length;

for (const h of [...HOLD2, ...HOLD2_TOP, ...HOLD1]) {
  const thr = HOLD1.includes(h) ? 1 : 2;
  // Q5449-5515 (paid cost reduced by some effect, still counts) : printed cost >= thr, paid via costDelta -10
  await scenario('5454/5455 etc', `${h}: option used with paid cost reduced to 0 still triggers (printed cost stays)`, async (chk) => {
    const st = board(h); st.players.p1.hand = [OPT];
    const r = S.useOptionCard(st, 'p1', 0, { costDelta: -10 });
    chk(!!r, 'option used'); chk(trig(st, h) === 1, `trigger count ${trig(st, h)} (want 1)`);
  });
  // Q5456 etc: used for free by an effect (cause:'effect', useCost:0): still triggers
  await scenario('5456 etc', `${h}: option used free by effect still triggers`, async (chk) => {
    const st = board(h); st.players.p1.trash.push(OPT);
    S.emitGameEvent(st, 'optionUsed', { owner: 'p1', stack: null, cardId: OPT, cause: 'effect', useCost: 0 });
    chk(trig(st, h) === 1, `trigger count ${trig(st, h)} (want 1)`);
  });
  // Q5454 etc: hand card whose OWN use cost is lowered below the threshold: not counted
  await scenario('5454 etc', `${h}: BT8-097 self-lowered to below threshold does not trigger`, async (chk) => {
    const cfg = { p1: { battle: [], hand: ['BT8-097'] }, p2: { battle: Array(6).fill(F3[0]) }, memory: 5 };
    const isTop = S.card(h).category === 'digimon' && !S.card(h).inheritedKo?.includes('사용 코스트');
    cfg.p1.battle.push(isTop ? { id: h } : { id: redFill, src: [h] }); cfg.p1.battle.push({ id: redFill });
    const st = newBoard(cfg);
    const r = S.useOptionCard(st, 'p1', 0);
    chk(!!r, 'BT8-097 used'); chk(trig(st, h) === 0, `trigger count ${trig(st, h)} (want 0 : cost lowered to ${thr - 1} or less)`);
  });
  // plain: a normal use of printed cost >= threshold triggers
  await scenario('5449 base', `${h}: normal use triggers`, async (chk) => {
    const st = board(h); const r = S.useOptionCard(st, 'p1', 0);
    chk(!!r, 'used'); chk(trig(st, h) === 1, `trigger count ${trig(st, h)} (want 1)`);
  });
}
report();
