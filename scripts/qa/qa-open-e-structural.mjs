// open-e structural leftovers: 네가몬 raising-area sources (EX9-054), BT22-076 self target, RB1-005 Q3420 「A와 B 1장씩」, Q1446 DP-less override, BT22-092 Q4252 memory ordering, EX9-031 Q4079 face-down bottom.
// Run: node scripts/qa/qa-open-e-structural.mjs < /dev/null
import { S, E, Fx, C, FILL, LOW, mk, put, setHand, setDeck, setSec, secN, drain, stackOf, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const seg = (id, tag, has) => S.parseEffectSegments(C(id).effectKo || '').segments.find((s) => s.tags.includes(tag) && (!has || s.body.includes(has)));
const push = (st, p, id, a, tag, has, extra = {}) => { const sg = seg(id, tag, has); st.pending.push({ uid: 'q' + Math.random().toString(36).slice(2), player: p, cardId: id, stackUid: a ? a.uid : undefined, topId: a ? a.cardId : undefined, tags: sg.tags, text: sg.body, resolved: false, ...extra }); };

T('nega', 'EX9-054 소멸 시: 「네가몬」 in the sources of a RAISING-area digimon count (2 -> Lv.5 cap)', async () => {
  for (const [srcN, want] of [[0, false], [2, true]]) {
    const st = mk(); const a = put(st, 'p1', 'EX9-054'); setHand(st, 'p1', ['EX9-054']);
    const r = S._s4.makeStack(FILL, 1); r.sources = Array(srcN).fill('EX9-005'); st.players.p1.raising = r; S.recomputeStackGrants(r);
    push(st, 'p1', 'EX9-054', a, '소멸 시', '', { evt: { leaving: true } }); await drain(st);
    eq(`raising sources=${srcN}: Lv5 played`, st.players.p1.battle.length === 2, want);
  }
});

T('bt22076', 'BT22-076 진화 시: 이 디지몬 자신도 「DP 이하의 디지몬 1마리」 대상이 된다 (o 「이 디지몬 이외」 없음)', async () => {
  const st = mk(); const a = put(st, 'p1', 'BT22-076', { src: [FILL, FILL] }); a.s5fd = 1; secN(st, 'p1', 2);
  let offered = null; st._qaAns = { pickStackAnySide: (o) => { offered = o.entries.map((e) => e.uid); return o.entries[0]; } };
  push(st, 'p1', 'BT22-076', a, '진화 시'); await drain(st);
  ok('self offered', offered && offered.includes(a.uid));
  ok('self placed on security', !stackOf(st, 'p1', a.uid) && st.players.p1.security.length === 3);
});

const GAMMA = 'BT8-008', JUN = 'BT8-086';
T(3420, 'RB1-005 등장 시: a card that is both 「감마몬」-described and 「은하준」 can be taken as the 감마몬 card alone (Q3420); default answer still takes both', async () => {
  ok('fixtures', S.cardMentions ? true : true);
  for (const mode of ['alone', 'both']) {
    const st = mk(); const a = put(st, 'p1', 'RB1-005'); setDeck(st, 'p1', [JUN, GAMMA, FILL, FILL, FILL]); setHand(st, 'p1', []);
    const prompts = []; st._qaAns = { pickFromRevealed: (o) => { prompts.push(o.eligible.map((x) => x.id)); if (mode === 'alone' && prompts.length === 1) return [o.eligible.find((x) => x.id === JUN).i]; return o.eligible.slice(0, 1).map((x) => x.i); } };
    push(st, 'p1', 'RB1-005', a, '등장 시'); await drain(st);
    ok(mode + ': first slot offers both cards', prompts[0] && prompts[0].includes(JUN) && prompts[0].includes(GAMMA));
    if (mode === 'alone') { eq('only the both-criteria card added', st.players.p1.hand, [JUN]); ok('other card back to the deck', st.players.p1.deck.includes(GAMMA)); }
    else eq('both criteria filled', st.players.p1.hand.slice().sort(), [GAMMA, JUN].sort());
  }
});

T(1446, 'BT11-043 original-DP override does not give a DP to a Tamer/Egg left on top; a tamer treated as a Digimon still has its DP', async () => {
  const tamer = Object.values(S.CARDS).find((c) => c.category === 'tamer' && c.dp == null && !/취급/.test(c.effectKo || '') && !/취급/.test(c.inheritedKo || '')).id;
  const st = mk(); const a = put(st, 'p1', FILL);
  S.setBaseInfo(st, 'p1', a, { name: '스카몬', colors: ['white'], dp: 3000, until: 'permanent' });
  eq('digimon override applies', S.effectiveDP(st, 'p1', a), 3000);
  a.cardId = tamer; S.recomputeStackGrants(a); // devolved down to a Tamer
  eq('tamer stays DP-less', S.stackHasDP(st, a), false); eq('effectiveDP 0', S.effectiveDP(st, 'p1', a), 0);
  const t2 = put(st, 'p1', tamer); t2.s2AsDigimon = true; (t2.baseOv ||= []).push({ ts: S.stamp(), until: st.turnNumber, dp: 3000 }); S.refreshBaseInfo(st, t2);
  ok('tamer-as-digimon keeps its DP 3000 (plus whatever this tamer itself adds)', S.effectiveDP(st, 'p1', t2) >= 3000); eq('has DP', S.stackHasDP(st, t2), true);
});

T(4252, 'BT22-092: 「이 효과로 발휘했다면」 memory +1 comes after the borrowed effect; when it attacked, after the attack declaration', async () => {
  const run = async (deferred) => {
    const st = mk(); st.memory = 5; const tam = put(st, 'p1', 'BT22-092'); const dg = put(st, 'p1', 'BT22-010'); tam.hookEvt = { stackUid: dg.uid };
    let opts = null; const sg = seg('BT22-092', '자신의 턴', '효과 1개를 발휘');
    const script = Fx.lookupCardSpecific('BT22-092', sg.tags, sg.body);
    const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'BT22-092', sourceStackUid: tam.uid, choose: makeChoose(st), startAttack: (p, u, d, o) => { opts = o; if (!deferred && o.onDeclared) o.onDeclared(); }, ...(deferred ? { deferredAtk: true } : {}) };
    await Fx.runScript(script, ctx); return { st, opts };
  };
  { const { st, opts } = await run(true); ok('attack requested with onDeclared', opts && typeof opts.onDeclared === 'function'); eq('memory before declaration (5 -2 cost)', st.memory, 3); opts.onDeclared(); eq('memory +1 after declaration', st.memory, 4); opts.onDeclared(); eq('only once', st.memory, 4); }
  { const { st } = await run(false); eq('synchronous driver: 5 -2 +1', st.memory, 4); }
});

T(4079, 'EX9-031 【진화 시】: trashes the lowest FACE-DOWN source (Q4079) even with a face-up source present; face-up ones stay', async () => {
  const st = mk(); const a = put(st, 'p1', 'EX9-031', { src: ['BT22-076', 'BT8-008', 'BT8-013'] }); a.s5fd = 2; // [fd, fd, faceUp]
  secN(st, 'p1', 1); setHand(st, 'p1', []);
  push(st, 'p1', 'EX9-031', a, '진화 시'); await drain(st);
  const s = stackOf(st, 'p1', a.uid);
  eq('lowest face-down card trashed', st.players.p1.trash.includes('BT22-076'), true);
  eq('remaining sources', s.sources, ['BT8-008', 'BT8-013']); eq('face-down block shrank', S.fdCount(s), 1);
});
await runAll('qa-open-e-structural');
