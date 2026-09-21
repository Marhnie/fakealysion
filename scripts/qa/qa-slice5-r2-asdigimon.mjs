// Slice-5 round 2: 「디지몬·DP N으로도 취급한다」 on a tamer (BT12-092, BT13-008/018/020/099, BT17-087, BT21-044/096, AD1-021: ~50 Q ids).
// Q5986-family: still a tamer (both). Q5981-family: its effects count as digimon effects AND tamer effects. Q5982: DP 0 -> deleted at rule check. Q5978: a later application overwrites cost/Lv/DP (other granted keywords add up).
// Q5979: it can still gain memory under the opponent's "tamer effects only" lock. Q5980: an opponent digimon immune to digimon effects is unaffected by its effects.
import { S, E, Fx, newBoard, stk, mkChoose, scenario, report, F3, runOn, fillerLv } from './lib5.mjs';
const tam = Object.values(S.CARDS).find(c => c.category === 'tamer' && c.nameKo === '최건우' && !/디지몬·DP/.test(c.effectKo || ''))?.id || 'BT17-087';
const gr = Object.values(S.CARDS).find(c => c.category === 'digimon' && /그레이몬|아구몬/.test(c.nameKo) && c.colors?.includes('yellow') && c.level === 3)?.id || F3[0];
const IDS = { both: [5986,5998,6007,6103], kinds: [5981,5987,5992,5999,6008,6104], dp0: [5982,5988,5993,6009,6105], over: [5978,5983,5989,5994,6001,6010,6019,6022,6106], mem: [5979,5984,5990,5995,6002,6011,6020,6023,6107], imm: [5980,5985,5991,5996,6003,6012,6021,6024,6108] };
// per-card: run the real effect that makes the 최건우 a digimon, then check tamer+digimon status
const cases = [['BT12-092', 'mainPhaseStart', tam, true], ['BT13-018', 'mainPhaseStart', tam, false], ['BT17-087', 'play', null, false], ['BT21-044', 'play', tam, false], ['BT13-008', null, tam, false], ['AD1-021', 'turnEndOwn', null, false]];
for (const [h, evt, other, needCost] of cases) {
  await scenario(IDS.both.concat(IDS.kinds).join(','), `${h}: the 최건우 it turns into a digimon is BOTH tamer and digimon`, async (chk) => {
    const isTamerHolder = S.card(h).category === 'tamer';
    const battle = h === tam ? [h, gr] : [h, tam, gr];
    const st = newBoard({ turn: 3, memory: 5, p1: { battle }, p2: { battle: [F3[1]] } });
    const T = st.players.p1.battle.filter(x => S.card(x.cardId).category === 'tamer' && S.card(x.cardId).nameKo === '최건우').find(x => true);
    if (!T) { chk(false, 'tamer fixture'); return; }
    if (h === 'BT13-008') { // 메인 (use via the runner)
      const s = stk(st, 'p1', h); S.queueTriggersForStack(st, 'p1', s, 'use'); }
    else await runOn(st, 'p1', h, evt, {});
    if (h === 'BT13-008') { const Fxm = Fx; const tr = { player: 'p1', cardId: h, stackUid: stk(st, 'p1', h).uid, tags: ['메인'], text: S.card(h).effectKo.split('\n').find(l => l.includes('메인')).replace(/^【메인】\s*(\[턴에 1회\]\s*)?/, ''), inherited: false };
      await Fx.runScript((await import('./lib5.mjs')).scriptFor(tr), (await import('./lib5.mjs')).ctxFor(st, tr, mkChoose(st))); }
    const T2 = st.players.p1.battle.find(x => S.card(x.cardId).category === 'tamer' && S.isAsDigimon(x)); chk(!!T2, 'a 최건우 tamer is treated as a digimon'); if (!T2) return;
    chk(S.card(T2.cardId).category === 'tamer', 'still a tamer card');
    chk(S.effectiveDP(st, 'p1', T2) > 0, 'has DP as a digimon: ' + S.effectiveDP(st, 'p1', T2));
  });
}
const mkT = (st) => { const s = S._s4.makeStack(tam, 1); s.attackEligibleTurn = 0; s.placedTurn = 0; st.players.p1.battle.push(s); return s; };
const asDig = (st, s, dp) => { s.s2AsDigimon = true; s.s2NoEvolve = true; (s.baseOv ||= []).push({ ts: S.stamp(), until: st.turnNumber, dp }); S.refreshBaseInfo(st, s); };
await scenario(IDS.dp0.join(','), 'a tamer treated as a digimon whose DP is brought to 0 is deleted at the rule check', async (chk) => {
  const st = newBoard({ turn: 3, memory: 5, p1: { battle: [gr] }, p2: { battle: [F3[1]] } }); const T = mkT(st); asDig(st, T, 3000);
  chk(S.effectiveDP(st, 'p1', T) === 3000, 'DP 3000');
  const prev = st._fxSrc; st._fxSrc = { player: 'p2', category: 'digimon', cardId: F3[1] };
  try { S.modifyDP(st, 'p1', T.uid, -3000, 'turn'); } finally { st._fxSrc = prev; }
  S.ruleSweepDP(st, T);
  chk(!st.players.p1.battle.includes(T), 'deleted at 0 DP (rule check)');
});
await scenario(IDS.over.join(','), 'a later "digimon·DP N" application overwrites the earlier DP', async (chk) => {
  const st = newBoard({ turn: 3, memory: 5, p1: { battle: [gr] }, p2: { battle: [F3[1]] } }); const T = mkT(st);
  asDig(st, T, 3000); asDig(st, T, 12000); chk(S.effectiveDP(st, 'p1', T) === 12000, 'later 12000 wins: ' + S.effectiveDP(st, 'p1', T));
  asDig(st, T, 6000); chk(S.effectiveDP(st, 'p1', T) === 6000, 'even later 6000 wins: ' + S.effectiveDP(st, 'p1', T));
  S.grantKeyword(st, 'p1', T.uid, '속공', undefined, 'turn'); chk(S.hasKeyword(T, '속공'), 'keywords still add');
});
await scenario(IDS.mem.join(','), 'under an opposing "tamer effects only" memory lock the tamer-as-digimon still gains memory', async (chk) => {
  const lockId = Object.values(S.CARDS).find(c => /상대는\s*테이머의?\s*효과\s*이외로\s*메모리를\s*플러스할\s*수\s*없다/.test((c.effectKo || '') + (c.inheritedKo || '')) && c.category === 'digimon')?.id;
  if (!lockId) { chk(false, 'no lock fixture'); return; }
  const st = newBoard({ turn: 3, memory: 0, p1: { battle: [gr] }, p2: { battle: [lockId] } }); const T = mkT(st); asDig(st, T, 3000);
  const m0 = st.memory; S.grantMemory(st, 'p1', 1, T.cardId); chk(st.memory === m0 + 1, 'memory gained (source is still a tamer)');
});
await scenario(IDS.imm.join(','), 'an opponent digimon immune to digimon effects is not affected by the tamer-as-digimon\'s effect (but is by a plain tamer effect)', async (chk) => {
  const st = newBoard({ turn: 3, memory: 5, p1: { battle: [gr] }, p2: { battle: [F3[1]] } }); const T = mkT(st); const b = stk(st, 'p2', F3[1]);
  S.grantShield(st, 'p2', b.uid, { kinds: ['all'], fromCategory: 'digimon' });
  const run = async () => Fx.runScript([{ op: 'modifyDP', target: 'opponent', amount: -2000, duration: 'turn' }], { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: tam, sourceStackUid: T.uid, choose: mkChoose(st), trigger: { text: 't', tags: ['등장 시'] }, startAttack() {} });
  const base = S.card(F3[1]).dp;
  await run(); chk(S.effectiveDP(st, 'p2', b) === base - 2000, 'control: a plain tamer effect passes the digimon-only shield, got ' + S.effectiveDP(st, 'p2', b));
  const st2 = newBoard({ turn: 3, memory: 5, p1: { battle: [gr] }, p2: { battle: [F3[1]] } }); const T2 = mkT(st2); const b2 = stk(st2, 'p2', F3[1]); asDig(st2, T2, 3000);
  S.grantShield(st2, 'p2', b2.uid, { kinds: ['all'], fromCategory: 'digimon' });
  await Fx.runScript([{ op: 'modifyDP', target: 'opponent', amount: -2000, duration: 'turn' }], { state: st2, S, E, self: 'p1', opp: 'p2', sourceCardId: tam, sourceStackUid: T2.uid, choose: mkChoose(st2), trigger: { text: 't', tags: ['등장 시'] }, startAttack() {} });
  chk(S.effectiveDP(st2, 'p2', b2) === base, 'tamer-as-digimon effect is blocked by the digimon-effect immunity, got ' + S.effectiveDP(st2, 'p2', b2));
});
report();
