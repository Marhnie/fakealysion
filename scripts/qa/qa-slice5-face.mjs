// Slice-5 official Q&A: face-up security (Q5231-5234 BT23-015 family) and BT23-083 face-up trigger cost (Q5356).
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const jack = Object.values(S.CARDS).find(c => (c.types || []).includes('잭슨') && c.category === 'digimon')?.id;
await scenario(5234, 'shuffling the security stack turns every face-up card face-down again and they stay down', async (chk) => {
  const st = newBoard({ p1: { battle: [F3[0]], security: F3.slice(1, 5) } });
  S.secAddFaceUp(st, 'p1', F3[8], 'top'); chk(S.secFaceUpCount(st.players.p1) === 1, 'face-up set up');
  const ch = mkChoose(st); const Fx = (await import('./lib5.mjs')).Fx;
  await Fx.runScript([{ op: 'shuffleSecurity', who: 'self' }], { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: F3[0], sourceStackUid: st.players.p1.battle[0].uid, choose: ch, trigger: {}, startAttack() {} });
  chk(S.secFaceUpCount(st.players.p1) === 0, 'all face-down after shuffle');
});
await scenario(5233, 'checking a face-up security card whose 【시큐리티】 effect exists still triggers it (face-up flag does not suppress)', async (chk) => {
  const sec = Object.values(S.CARDS).find(c => c.category === 'option' && /【시큐리티】/.test(c.effectKo + (c.inheritedKo || '')) && /드로우/.test(c.effectKo + (c.inheritedKo || '')))?.id;
  if (!sec) { chk(true, 'no fixture'); return; }
  const st = newBoard({ p1: { battle: [F3[0]] }, p2: { battle: [], security: [F3[1], F3[2]] } });
  st.players.p2.security.unshift(sec); (st.players.p2.secUp ||= {})[sec] = 1;
  const a = stk(st, 'p1', F3[0]); a.attackEligibleTurn = 0;
  const dec = S.declareAttack(st, 'p1', a.uid); chk(dec.ok, 'declare');
  const res = S.resolveSecurityCheck(st, 'p1', a.uid, 'p2');
  const q = st.pending.filter(t => !t.resolved && t.cardId === sec);
  chk(q.length >= 1 || (st.log || []).some(l => /시큐리티/.test(l.msg) && l.msg.includes(S.card(sec).nameKo)), 'security effect of the face-up card was not triggered');
});
await scenario(5356, 'BT23-083: face-up 잭슨 card added -> rest cost paid: +1 memory and draw; declined: neither', async (chk) => {
  for (const yes of [true, false]) {
    const st = newBoard({ p1: { battle: ['BT23-083'], hand: [F3[0]], deck: F3.slice(1, 6) }, memory: 0 });
    S.secAddFaceUp(st, 'p1', jack, 'top');
    const ch = mkChoose(st, { answer: (k) => (k === 'confirmEffect' ? yes : undefined) }); await drain(st, ch);
    const m = st.memory, h = st.players.p1.hand.length, r = stk(st, 'p1', 'BT23-083').suspended;
    if (yes) chk(m === 1 && h === 2 && r, `paid: mem ${m} hand ${h} rested ${r}`); else chk(m === 0 && h === 1 && !r, `declined: mem ${m} hand ${h} rested ${r}`);
  }
});
const trigFor = (st, id) => st.pending.filter(t => !t.resolved && t.cardId === id).length;
const rb = Object.values(S.CARDS).find(c => (c.types || []).includes('로얄 베이스') && c.category === 'digimon')?.id;
await scenario('5789', 'EX11-004: an opponent face-DOWN security card turned face-up counts as their face-up security increasing', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: F3[0], src: ['EX11-004'] }] }, p2: { security: F3.slice(1, 5) } });
  S.secFlipTopFaceUp(st, 'p2'); chk(trigFor(st, 'EX11-004') === 1, 'trigger count ' + trigFor(st, 'EX11-004'));
});
await scenario('5790', 'EX11-004: a face-up card put into the opponent security triggers it', async (chk) => {
  const st = newBoard({ p1: { battle: [{ id: F3[0], src: ['EX11-004'] }] }, p2: { security: F3.slice(1, 5) } });
  S.secAddFaceUp(st, 'p2', F3[6], 'top'); chk(trigFor(st, 'EX11-004') === 1, 'trigger count ' + trigFor(st, 'EX11-004'));
});
await scenario('5788', 'EX11-003: own face-down card turned face-up does NOT trigger it (needs a face-up card PLACED); placing one does', async (chk) => {
  let st = newBoard({ p1: { battle: [{ id: F3[0], src: ['EX11-003'] }], security: [rb, ...F3.slice(1, 4)] } });
  S.secFlipTopFaceUp(st, 'p1'); chk(trigFor(st, 'EX11-003') === 0, 'flip must not trigger: ' + trigFor(st, 'EX11-003'));
  st = newBoard({ p1: { battle: [{ id: F3[0], src: ['EX11-003'] }], security: F3.slice(1, 4) } });
  S.secAddFaceUp(st, 'p1', rb, 'top'); chk(trigFor(st, 'EX11-003') === 1, 'placing a face-up Royal Base card triggers: ' + trigFor(st, 'EX11-003'));
});
report();
