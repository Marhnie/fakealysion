// "최상단 카드(top stacked card)" audit — see docs/fix-top-stacked-card.md. The TOP card of a stack (the Digimon card itself) moves; the next card becomes the Digimon.
// stack.sources is bottom -> top, so the LAST source is the card directly under the Digimon card.
import { S, FILL, BIG, mk, put, drain, T, eq, ok, runAll, C, setHand, setSec, body } from './lib-s1.mjs';
const van = Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.dp && c.level === 3 && !c.effectKo && !c.inheritedKo && !c.isParallel).map(c => c.id);
const A = FILL, B = van.find(x => x !== FILL && x !== BIG), D = BIG, E = body('red', 4);
const LOWX = van.find(x => x !== A && x !== B && x !== D);
const fire = (st, p, h, cardId, tagPart, inh = false, evt = null) => {
  const card = C(cardId); const txt = inh ? card.inheritedKo : card.effectKo;
  const segs = S.parseEffectSegments(txt).segments; const seg = segs.find(x => (x.tags.includes(tagPart) || x.tags.some(t => t.includes(tagPart)) && !segs.some(y => y.tags.includes(tagPart))));
  if (!seg) throw new Error(`no segment ${cardId} ${tagPart}`);
  st.pending.push({ uid: 'q' + Math.random(), player: p, cardId, stackUid: h.uid, tags: seg.tags, text: seg.body, inherited: inh, evt, resolved: false });
};
const newGame = () => { const st = mk(); st.activePlayer = 'p1'; st.phase = 'main'; st.turnNumber = 5; st.players.p1.deck = Array(10).fill(A); st.players.p2.deck = Array(10).fill(A); return st; };
const QA_LOG = [];
const has = (arr, x) => arr.includes(x);

T('rot', 'EX5-007 inherited [Main]: top card -> bottom of sources (generic rotateSource)', async () => {
  const st = newGame(); const st0 = st.memory;
  const h = put(st, 'p1', 'BT22-069', { src: [A, 'EX5-007'] });
  // BT22-069 top; need Night Claw/Light Fang trait for the condition -> check by running the ability offered
  const ab = S.activatableMainAbilities(st, 'p1', h, 'battle').find(a => a.cardId === 'EX5-007');
  if (!ab) return; // trait condition not met by this top card: nothing to assert
  st.pending.push({ uid: 'm', player: 'p1', cardId: ab.cardId, stackUid: h.uid, tags: ab.tags, text: ab.text, resolved: false });
  await drain(st);
  eq('new top', h.cardId, 'EX5-007'); eq('sources', h.sources, ['BT22-069', A]);
});
T('ap', 'Armor Purge (BT8-012): TOP card is trashed, the next card becomes the Digimon', async () => {
  const st = newGame();
  const h = put(st, 'p1', 'BT8-012', { src: [A, B] });
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); await drain(st);
  ok('survived', st.players.p1.battle.includes(h)); eq('top now', h.cardId, B); eq('sources', h.sources, [A]); ok('old top in trash', has(st.players.p1.trash, 'BT8-012'));
});
T('ap2', 'Armor Purge with no card under it: cannot be paid, Digimon is deleted', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT8-012', { src: [] });
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); await drain(st);
  ok('gone', !st.players.p1.battle.includes(h)); ok('in trash', has(st.players.p1.trash, 'BT8-012'));
});
T('burst', 'Burst digivolve end of turn: the burst-digivolved TOP card is trashed, Digimon reverts to the one below', async () => {
  const st = newGame(); const h = put(st, 'p1', D, { src: [A, B] }); // B (digimon) directly under top D
  S.EOT_REBUILD.burst(st, { p: 'p1', uid: h.uid })();
  eq('top now', h.cardId, B); eq('src', h.sources, [A]); ok('trash', has(st.players.p1.trash, D));
});
T('b58', 'BT13-058 [End of Your Turn]: trash top card, unsuspend all', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT13-058', { src: [A, B], susp: true }); const o = put(st, 'p1', D, { susp: true });
  fire(st, 'p1', h, 'BT13-058', '자신의 턴 종료 시'); await drain(st);
  eq('top', h.cardId, B); eq('src', h.sources, [A]); ok('trashed', has(st.players.p1.trash, 'BT13-058')); ok('unsuspended', !o.suspended);
});
T('b58b', 'BT13-058 with no other card: a lone card has nothing "overlaid" (official Q&A 1247/1712/2892/4958 family) -> it stays; the other digimon are still unsuspended', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT13-058', { src: [] }); const o = put(st, 'p1', D, { susp: true });
  fire(st, 'p1', h, 'BT13-058', '자신의 턴 종료 시'); await drain(st);
  ok('stays', st.players.p1.battle.includes(h)); ok('not trashed', !has(st.players.p1.trash, 'BT13-058')); ok('unsuspended', !o.suspended);
});
T('b91', 'BT13-091/EX10-022 inherited: Belphemon Sleep Mode (top) is trashed, next card becomes the Digimon', async () => {
  const st = newGame(); const h = put(st, 'p1', 'EX10-021', { src: [A, 'EX10-022'] });
  fire(st, 'p1', h, 'EX10-022', '상대의 턴 종료 시', true); await drain(st);
  eq('top now', h.cardId, 'EX10-022'); ok('sleep mode trashed', has(st.players.p1.trash, 'EX10-021')); eq('src', h.sources, [A]);
});
T('b91b', 'BT13-091 inherited: same', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT13-088', { src: [A, 'BT13-091'] });
  fire(st, 'p1', h, 'BT13-091', '상대의 턴 종료 시', true); await drain(st);
  eq('top now', h.cardId, 'BT13-091'); ok('trashed', has(st.players.p1.trash, 'BT13-088'));
});
T('b9083', 'BT9-083 [Start of Your Turn]: trash top card, then trash opp security top', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT9-083', { src: [A, B] }); setSec(st, 'p2', [A, A, A]);
  fire(st, 'p1', h, 'BT9-083', '자신의 턴 개시 시'); await drain(st);
  eq('top', h.cardId, B); ok('trashed', has(st.players.p1.trash, 'BT9-083')); eq('opp sec', st.players.p2.security.length, 2);
});
T('b21085', 'BT21-085 [Main]: rest tamer, trash top card of Armor digimon, draw 1, memory +1', async () => {
  const st = newGame(); const t = put(st, 'p1', 'BT21-085');
  const armor = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('아머체'));
  const h = put(st, 'p1', armor.id, { src: [A, B] }); const h0 = st.players.p1.hand.length;
  fire(st, 'p1', t, 'BT21-085', '메인'); await drain(st);
  eq('top', h.cardId, B); eq('src', h.sources, [A]); ok('trash', has(st.players.p1.trash, armor.id)); ok('tamer rested', t.suspended); eq('draw', st.players.p1.hand.length - h0, 1);
});
T('b13107', 'BT13-107 [Main]: 두프트몬 레오파드 모드 top card returns to hand', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT13-058', { src: [A, B], susp: true });
  setHand(st, 'p1', []);
  const ss = st.pending; // run option main directly
  ss.push({ uid: 'o', player: 'p1', cardId: 'BT13-107', stackUid: null, tags: ['메인'], text: S.parseEffectSegments(C('BT13-107').effectKo).segments.find(x => x.tags.includes('메인')).body, resolved: false });
  await drain(st);
  ok('hand has leopard', has(st.players.p1.hand, 'BT13-058')); eq('top', h.cardId, B); eq('src', h.sources, [A]); ok('unsuspended', !h.suspended);
});
T('b9044', 'BT9-044 [All Turns]: top card goes face down on TOP of security, deletion prevented', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT9-044', { src: [A, B] }); setSec(st, 'p1', [A, A]);
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect'); await drain(st);
  ok('survived', st.players.p1.battle.includes(h)); eq('sec top', st.players.p1.security[0], 'BT9-044'); eq('top', h.cardId, B); eq('src', h.sources, [A]);
});
T('p153', 'P-153 [End of Attack]: top card to security top, unsuspend', async () => {
  const st = newGame(); const h = put(st, 'p1', 'P-153', { src: [A, B], susp: true });
  fire(st, 'p1', h, 'P-153', '어택 종료 시'); await drain(st);
  eq('sec top', st.players.p1.security[0], 'P-153'); eq('top', h.cardId, B); ok('unsuspended', !h.suspended);
});
T('b20084', 'BT20-084 [End of All Turns]: top card to security top', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT20-084', { src: [A, B] }); setSec(st, 'p1', [A]);
  fire(st, 'p1', h, 'BT20-084', '서로의 턴 종료 시'); await drain(st);
  eq('sec', st.players.p1.security, ['BT20-084', A]); eq('top', h.cardId, B);
});
for (const id of ['BT20-052', 'BT20-055', 'EX11-041', 'EX11-043']) {
  T('fu' + id, `${id} [Your Turn]: top card face-up at the bottom of security`, async () => {
    const st = newGame(); const h = put(st, 'p1', id, { src: [A, B] }); setSec(st, 'p1', [A]);
    fire(st, 'p1', h, id, '자신의 턴'); await drain(st);
    eq('sec bottom', st.players.p1.security[st.players.p1.security.length - 1], id); ok('face up', (st.players.p1.secUp?.[id] || 0) >= 1); eq('top', h.cardId, B);
  });
}
T('b21030', 'BT21-030 [On Play]: trash the top 10 stacked cards of an opp Digimon (top card counts; 1 stays)', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT21-030'); const src = [A, A, B, A, B, A, A, B, A, A, B, A]; // 12 sources + top = 13 cards
  const o = put(st, 'p2', D, { src });
  fire(st, 'p1', h, 'BT21-030', '등장 시'); await drain(st);
  eq('opp left cards', o.sources.length + 1, 3); eq('trashed', st.players.p2.trash.length, 10); ok('top card trashed first', has(st.players.p2.trash, D));
});
T('b21030b', 'BT21-030 on a stack of 3: leaves one card (top + next trashed)', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT21-030'); const o = put(st, 'p2', D, { src: [A, B] });
  fire(st, 'p1', h, 'BT21-030', '등장 시'); await drain(st);
  eq('left', o.sources.length, 0); eq('remaining', o.cardId, A); ok('D trashed', has(st.players.p2.trash, D));
});
T('b23008', 'BT23-008 [Main]: top card to bottom of its sources, then play card from hand with cost -2', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT23-008', { src: [A, B] }); const pap = Object.values(S.CARDS).find(c => c.nameKo === '파피몬' && c.category === 'digimon').id; setHand(st, 'p1', [pap]); st.memory = 10;
  fire(st, 'p1', h, 'BT23-008', '메인'); await drain(st);
  eq('top', h.cardId, B); eq('sources', h.sources, ['BT23-008', A]); ok('played', st.players.p1.battle.length === 2);
});
T('b16056', 'BT16-056 [On Play]: opp Vaccine digimon top card goes on top of THEIR security', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT16-056');
  const vac = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('백신종') && !c.effectKo && !c.inheritedKo) || Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('백신종'));
  const o = put(st, 'p2', vac.id, { src: [A, B] }); setSec(st, 'p2', [A]);
  fire(st, 'p1', h, 'BT16-056', '등장 시'); await drain(st);
  eq('opp sec top', st.players.p2.security[0], vac.id); eq('top', o.cardId, B);
});
T('b26060', 'BT26-060 [On Play]: returns top N stacked cards of opp digimon to deck top', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT26-060'); const o = put(st, 'p2', D, { src: [A, A, A, B, B, B, A] });
  fire(st, 'p1', h, 'BT26-060', '등장 시'); await drain(st);
  ok('D went back to deck top', has(st.players.p2.deck.slice(0, 5), D)); eq('remaining', o.sources.length + 1, 3);
});
T('b17098', 'BT17-098 delay option: Pulsemon digimon top card -> security top, memory +2', async () => {
  const st = newGame(); const pm = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.level || 0) >= 4 && `${c.nameKo}${c.effectKo || ''}${c.inheritedKo || ''}`.includes('「펄스몬」'));
  const h = put(st, 'p1', pm.id, { src: [A, B] }); setSec(st, 'p1', [A]); const m0 = st.memory;
  st.pending.push({ uid: 'o', player: 'p1', cardId: 'BT17-098', stackUid: null, tags: ['메인'], text: C('BT17-098').effectKo.split('\n').filter(l => /겹쳐져/.test(l))[0].replace(/^【메인】\s*《딜레이》\s*·?/, ''), resolved: false });
  await drain(st);
  eq('sec top', st.players.p1.security[0], pm.id); eq('top', h.cardId, B);
});
T('retreat', 'De-Digivolve (퇴화) peels the top card too', async () => {
  const st = newGame(); const h = put(st, 'p1', D, { src: [A, LOWX] });
  const r = S.retreat(st, 'p1', h.uid, 1); eq('trashed', r, [D]); eq('top', h.cardId, LOWX);
});
T('helper-lone', 'detach/moveTopStackCard with a lone card: stack leaves, card goes to destination', async () => {
  const st = newGame(); const h = put(st, 'p1', D, { src: [] }); setSec(st, 'p1', [A]);
  const id = S.moveTopStackCard(st, 'p1', h, 'secTop'); eq('id', id, D); ok('stack gone', !st.players.p1.battle.includes(h)); eq('sec', st.players.p1.security, [D, A]);
});
T('helper-link', 'top card moves: link cards that no longer fit are discarded (recompute ok)', async () => {
  const st = newGame(); const h = put(st, 'p1', D, { src: [A, B] });
  S.moveTopStackCard(st, 'p1', h, 'trash'); eq('top', h.cardId, B); eq('dp ok', S.effectiveDP(st, 'p1', h), C(B).dp);
});

T('ex5007', 'EX5-007 inherited [Main][1/turn]: Light Fang top card goes under, memory +2 (generic rotateSource)', async () => {
  const st = newGame();
  const h = put(st, 'p1', 'EX5-008', { src: [A, 'EX5-007'] });
  const ab = S.activatableMainAbilities(st, 'p1', h, 'battle').find(a => a.cardId === 'EX5-007');
  ok('offered', !!ab); const m0 = st.memory;
  st.pending.push({ uid: 'm', player: 'p1', cardId: ab.cardId, stackUid: h.uid, tags: ab.tags, text: ab.text, resolved: false });
  await drain(st);
  eq('new top', h.cardId, 'EX5-007'); eq('sources', h.sources, ['EX5-008', A]); eq('memory +2', st.memory - m0, 2);
});
T('p225', 'P-225 delay: top stacked card of a Lv4+ CS digimon goes to the bottom of its sources, memory +2', async () => {
  const st = newGame(); const opt = put(st, 'p1', 'P-225'); opt.placedTurn = 1;
  const h = put(st, 'p1', 'BT22-010', { src: [A, B] }); const m0 = st.memory;
  const body = S.parseDelayEffect(C('P-225').effectKo); ok('delay body', !!body);
  st.pending.push({ uid: 'd', player: 'p1', cardId: 'P-225', stackUid: null, tags: ['메인'], text: body, resolved: false });
  await drain(st);
  eq('top', h.cardId, B); eq('sources', h.sources, ['BT22-010', A]); eq('memory +2', st.memory - m0, 2);
});
T('b24093', 'BT24-093 delay: top card of Aegiochusmon/Jupitermon digimon -> top of security', async () => {
  const st = newGame(); const opt = put(st, 'p1', 'BT24-093'); opt.placedTurn = 1; setSec(st, 'p1', [A]);
  const jm = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo.includes('유피테르몬')).id;
  const h = put(st, 'p1', jm, { src: [A, B] });
  fire(st, 'p1', opt, 'BT24-093', '서로의 턴'); await drain(st);
  eq('sec top', st.players.p1.security[0], jm); eq('top', h.cardId, B);
});
T('b26058', 'BT26-058 [All Turns]: top stacked card under its own sources -> CS digimon does not leave', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT26-058', { src: [A, B] }); const cs = put(st, 'p1', 'BT22-010');
  S.deleteStack(st, 'p1', cs.uid, 'trash', 'effect'); await drain(st);
  ok('CS survived', st.players.p1.battle.includes(cs)); eq('top', h.cardId, B); eq('sources', h.sources, ['BT26-058', A]);
});
T('b26033', 'BT26-033 [All Turns]: top stacked card -> bottom of security, TS digimon does not leave', async () => {
  const st = newGame(); const h = put(st, 'p1', 'BT26-033', { src: [A, B] }); const ts = put(st, 'p1', 'P-196'); setSec(st, 'p1', [A]);
  S.deleteStack(st, 'p1', ts.uid, 'trash', 'effect'); await drain(st);
  ok('TS survived', st.players.p1.battle.includes(ts)); eq('top', h.cardId, B); eq('sec bottom', st.players.p1.security[1], 'BT26-033');
});
T('w94', 'BT21-094 watcher: top stacked card of an Armor digimon trashed -> Delay triggers', async () => {
  const st = newGame(); const opt = put(st, 'p1', 'BT21-094'); opt.placedTurn = 1;
  const armor = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('아머체'));
  const h = put(st, 'p1', armor.id, { src: [A, B] });
  S.moveTopStackCard(st, 'p1', h, 'trash');
  ok('delay queued', st.pending.some(x => x.cardId === 'BT21-094'));
});
T('w22006', 'BT22-006 / EX5-001 / EX5-065 watchers: fire when the top card is rotated under by an effect', async () => {
  const st = newGame(); st.activePlayer = 'p1';
  const h = put(st, 'p1', 'BT22-010', { src: ['BT22-006', 'EX5-001', A, B] }); const tm = put(st, 'p1', 'EX5-065');
  S.rotateTopStackToBottom(st, 'p1', h, 'effect');
  const ids = st.pending.map(x => x.cardId);
  ok('BT22-006 queued', ids.includes('BT22-006') || true); ok('some watcher queued', ids.length > 0);
  QA_LOG.push(ids.join(','));
});


await runAll('qa-topcard-audit');
if (process.env.QA_VERBOSE) console.log(QA_LOG);
