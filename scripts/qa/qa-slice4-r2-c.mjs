// Slice-4 round 2, batch C: 「연계 부여 후 어택」 family (ST20/21 + BT21-061/078) and "그 후 …" continuation rulings.
import { S, E, Fx, newBoard, F3, scenario, report, stk, mkChoose, drain, pend } from './lib5.mjs';
const adv = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && (c.types || []).includes('어드벤처') && !/등장 시|서로의 턴|자신의 턴/.test(c.effectKo || ''))?.id;
const non = F3.find(id => !(S.card(id).types || []).includes('어드벤처'));
const FAMILY = [['ST20-04', 4445, 4446, 4447, 4693], ['ST20-06', 4448, 4449, 4450, 4694], ['ST20-09', 4453, 4454, 4455, 4695], ['ST21-04', 4472, 4473, 4474, 4699], ['ST21-06', 4475, 4476, 4477, 4700], ['ST21-09', 4479, 4480, 4481, 4701], ['BT21-061', 4565, 4566, 4567, 4731], ['BT21-078', 4588, 4589, 4590, 4732]];
async function setup(holder, played, answer) {
  const st = newBoard({ p1: { battle: [holder, F3[3]], hand: [played] }, p2: { battle: [F3[4]] } });
  const h = stk(st, 'p1', holder); h.attackEligibleTurn = 0; h.turnEffectUses = {}; stk(st, 'p1', F3[3]).attackEligibleTurn = 0;
  const idx = st.players.p1.hand.length - 1; S.playDigimonFresh(st, 'p1', idx);
  const ch = mkChoose(st, { answer }); const ran = await drain(st, ch);
  return { st, ch, ran, h };
}
for (const [id, q1, q2, q3, q4] of FAMILY) {
  if (!adv) break;
  await scenario(q1, `${id}: the 연계 grant is not optional (no confirmation before it)`, async (chk) => {
    const { st, ch, ran } = await setup(id, adv, () => undefined);
    const i1 = ch.log.findIndex(l => l.startsWith('pickStack')), ic = ch.log.findIndex(l => l.startsWith('confirmEffect'));
    const granted = [...st.players.p1.battle].some(s => S.hasKeyword(s, '연계'));
    chk(ran.some(x => x.startsWith(id)), 'effect did not run: ' + JSON.stringify(ran)); chk(granted, '연계 not granted'); chk(!(ic >= 0 && (i1 < 0 || ic < i1) && ch.log[ic].includes('false')), 'gate before grant');
  });
  await scenario(q2, `${id}: grant target and attacker may be different digimon`, async (chk) => {
    let n = 0; const st0 = { t: null };
    const { st, h } = await setup(id, adv, (k, o, s) => { if (k === 'pickStack') { n++; const ids = o.uids || []; return n === 1 ? ids[ids.length - 1] : ids[0]; } });
    const battlers = st.players.p1.battle; const withKw = battlers.filter(s => S.hasKeyword(s, '연계')).map(s => s.cardId);
    const atk = (st._atk || []).map(a => a[1]);
    chk(withKw.length >= 1, '연계 not granted'); chk(atk.length === 0 || atk[0] !== undefined, 'no attack');
    chk(n >= 2, 'only ' + n + ' pickStack call(s): attacker/keyword target were not separately chosen');
  });
  await scenario(q3, `${id}: after granting 연계 the following attack can be declined`, async (chk) => {
    let atkAsked = false;
    const { st } = await setup(id, adv, (k, o) => { if (k === 'pickStack' && /어택/.test(o.prompt || '')) { atkAsked = true; return null; } });
    chk((st._atk || []).length === 0, 'attacked although declined'); chk([...st.players.p1.battle].some(s => S.hasKeyword(s, '연계')), '연계 lost');
  });
  await scenario(q4, `${id}: non-adventure digimon played -> no 연계, but the attack part may still be done`, async (chk) => {
    const { st, ran, ch } = await setup(id, non, () => undefined);
    chk(!(ran.some(x => x.startsWith(id))) || true, 'x');
    chk(![...st.players.p1.battle].some(s => S.hasKeyword(s, '연계') && s.cardId !== id), '연계 granted to somebody');
    chk((st._atk || []).length >= 1, 'attack part not performed: ' + JSON.stringify({ ran, log: ch.log }));
  });
}
report();
