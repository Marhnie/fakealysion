// Slice-5 round 2: 《마인드 링크》 vs 〈링크〉 (Q5832 family: EX11-029/033/036/040/042; Q5894 EX11-045; Q5824/5946 EX11-027/073; Q5940 EX11-070; Q5945 EX11-073).
// Expected (own words): "링크했을 때" does not trigger on a mind link (the tamer goes under the sources, not sideways); a mind-linked card is a source, not a link card;
// "진화원이 효과로 늘어났을 때" does not react to an ordinary link; mind link may be done alone (without the jogress before it); a jogress material's link cards are trashed before stacking.
import { S, E, Fx, newBoard, stk, mkChoose, scenario, report, F3, fillerLv, ctxFor } from './lib5.mjs';
const mk = (id, cfg = {}) => { const own = /링크했을 때/.test(S.card(id).effectKo || '') || !/링크했을 때/.test(S.card(id).inheritedKo || ''); return newBoard({ turn: 3, memory: 6, p1: { battle: [own ? id : { id: 'EX11-027', src: [id] }, 'EX11-070', ...(cfg.extra || [])], ...(cfg.p1 || {}) }, p2: { battle: [F3[1]] } }); };
const mind = async (st, tamUid) => Fx.runScript([{ op: 'mindLink', desc: '' }], { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX11-070', sourceStackUid: tamUid, choose: mkChoose(st), trigger: { text: 't', tags: ['자신의 턴 종료 시'] }, startAttack() {} });
const anyLinkable = (st, H) => Object.values(S.CARDS).find(c => c.category === 'digimon' && /링크s*:/.test(c.inheritedKo || '') && S.linkCheck(st, 'p1', H, c.id).ok)?.id;
const trigs = (st, h) => st.pending.filter(t => !t.resolved && t.cardId === h).length;
for (const h of ['EX11-029', 'EX11-033', 'EX11-036', 'EX11-040', 'EX11-042']) {
  await scenario('5832 family', `${h}: a 《마인드 링크》 does not trigger "링크했을 때" (control: an ordinary link does)`, async (chk) => {
    const st = mk(h); const T = stk(st, 'p1', 'EX11-070'); const H = st.players.p1.battle[0]; st.pending.length = 0;
    await mind(st, T.uid);
    chk(H.sources.includes('EX11-070'), 'tamer went under the sources'); chk((H.linkCards || []).length === 0, 'not a link card'); chk(trigs(st, h) === 0, `mind link trigger ${trigs(st, h)} want 0`);
    const st2 = mk(h); const H2 = st2.players.p1.battle[0]; const lk = anyLinkable(st2, H2); st2.pending.length = 0;
    if (lk) { st2.players.p1.hand.push(lk); S.linkCardTo(st2, 'p1', H2.uid, lk, lk, 0, 'hand'); chk(trigs(st2, h) >= 1, `control: an ordinary link triggers it: ${trigs(st2, h)}`); } else chk(false, 'no linkable fixture for the control');
  });
}
await scenario('5894', 'EX11-045: "진화원이 효과로 늘어났을 때" does not react to an ordinary link (link cards are not sources)', async (chk) => {
  const st = newBoard({ turn: 3, memory: 6, p1: { battle: [{ id: 'EX11-027', src: ['EX11-045'] }] }, p2: { battle: [F3[1]] } });
  const H = st.players.p1.battle[0]; const lk = anyLinkable(st, H);
  st.pending.length = 0;
  if (lk) { st.players.p1.hand.push(lk); chk(!!S.linkCardTo(st, 'p1', H.uid, lk, lk, 0, 'hand'), 'link performed'); } else chk(false, 'no linkable fixture');
  chk(trigs(st, 'EX11-045') === 0, 'no source-increase trigger for a link: ' + trigs(st, 'EX11-045'));
});
await scenario('5824/5946', 'a mind-linked card sits among the sources; it is not a link card', async (chk) => {
  const st = mk('EX11-027'); const T = stk(st, 'p1', 'EX11-070'); const H = stk(st, 'p1', 'EX11-027'); await mind(st, T.uid);
  chk(H.sources.includes('EX11-070'), 'in sources'); chk((H.linkCards || []).length === 0, 'link cards empty');
});
await scenario('5940', 'EX11-070: a mind link may be performed without the jogress before it', async (chk) => {
  const st = mk('EX11-027'); const T = stk(st, 'p1', 'EX11-070');
  S.queueTriggersForStack(st, 'p1', T, 'turnEndOwn'); const t = st.pending.find(x => !x.resolved && x.cardId === 'EX11-070' && x.tags.some(g => g.includes('종료 시')));
  chk(!!t, 'trigger queued'); if (!t) return;
  const { scriptFor } = await import('./lib5.mjs');
  const ch = mkChoose(st, { answer: (k, o) => (k === 'pickFromZoneIndex' ? null : k === 'confirmEffect' ? (st._c = (st._c || 0) + 1, st._c > 1) : undefined) });
  await Fx.runScript(scriptFor(t), ctxFor(st, t, ch));
  chk(stk(st, 'p1', 'EX11-027').sources.includes('EX11-070'), 'mind link happened without jogress: ' + ch.log.join(' / '));
});
await scenario('5945', 'jogress: the material\'s link cards are trashed before stacking and never become sources', async (chk) => {
  const a = 'EX11-027', b = F3[3];
  const st = newBoard({ turn: 3, memory: 10, p1: { battle: [a, b], hand: ['EX11-073'] }, p2: {} });
  const A = stk(st, 'p1', a); A.linkCards = [{ cardId: F3[6] }];
  const fused = S.fuseStacks(st, 'p1', A.uid, stk(st, 'p1', b).uid, 'EX11-073', 0, 'hand');
  if (!fused) { chk(false, 'fusion not legal for these fixtures'); return; }
  chk(!fused.sources.includes(F3[6]), 'link card must not be a source'); chk(st.players.p1.trash.includes(F3[6]), 'link card trashed'); chk((fused.linkCards || []).length === 0, 'no link cards on the new card');
});
report();
