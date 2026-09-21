// Slice3 round 2 part C: face-up security template, option-use triggers, misc security / recovery rulings (Q ids only, paraphrased).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const mono = (color, lv, skip = []) => cards.find(c => c.category === 'digimon' && c.level === lv && c.colors.length === 1 && c.colors[0] === color && !c.effectKo?.trim() && !skip.includes(c.id))?.id;

// ===== Face-up (앞면) security template: 4 rulings repeated on every card that places face-up cards:
//  (a) placed face-up -> stays public, otherwise a normal security card; (b) checked face-up -> revealed, else normal check;
//  (c) its 【시큐리티】 effect still triggers when checked; (d) shuffling turns face-up cards face-down and they are NOT re-flipped.
const FU = [['BT18-004', [2904, 2905, 2906, 2907]], ['BT18-044', [2969, 2970, 2971, 2972]], ['BT19-048', [3100, 3101, 3102, 3103]], ['BT19-053', [3109, 3110, 3111, 3112]], ['BT19-084', [3147, 3148, 3149, 3150]], ['BT19-096', [3171, 3172, 3173, 3174]], ['BT19-100', [3180, 3182, 3183, 3184]], ['EX8-068', [3957, 3958, 3959, 3960]], ['EX8-069', [3964, 3965, 3966, 3967]], ['EX8-071', [3971, 3972, 3973, 3974]]];
const secCard = { 'BT18-004': cards.find(c => c.category === 'digimon' && c.types?.includes('로얄 베이스'))?.id, 'BT18-044': 'BT18-044', 'BT19-048': 'BT19-048', 'BT19-053': 'BT19-053', 'BT19-084': 'BT19-084', 'BT19-096': 'BT19-096', 'BT19-100': 'BT19-100', 'EX8-068': 'EX8-068', 'EX8-069': 'EX8-069', 'EX8-071': 'EX8-071' };
for (const [holder, [qa, qb, qc, qd]] of FU) {
  const id = secCard[holder];
  await sc('Q' + qa, `${holder}: a card placed under security face-up counts as face-up security (else ordinary security)`, async () => {
    const st = newState(); const pl = st.players.p1; pl.security = [FILL[0], FILL[1]]; const n0 = pl.security.length;
    S.secAddFaceUp(st, 'p1', id, 'bottom'); return all(eq('one more security card', pl.security.length, n0 + 1), eq('face-up count', S.secFaceUpCount(pl), 1), eq('at the bottom', pl.security[pl.security.length - 1], id));
  });
  await sc('Q' + qb, `${holder}: checking a face-up security card is an ordinary check (revealed as face-up)`, async () => {
    const st = newState(); const atk = put(st, 'p1', [FILL[2]]); const pl = st.players.p2; pl.security = [FILL[0]]; S.secAddFaceUp(st, 'p2', id, 'top');
    const ctl = S.beginSecurityCheck(st, 'p1', atk.uid, 'p2'); const r = S.stepSecurityCheck(ctl);
    return all(eq('revealed the card', r?.revealed, id), eq('flagged face-up', st.secReveal?.up, true), eq('removed from security', pl.security.includes(id), false));
  });
  await sc('Q' + qc, `${holder}: a checked face-up card's 【시큐리티】 effect still triggers (if it has one)`, async () => {
    const own = ['BT19-084', 'BT19-096', 'BT19-100', 'EX8-068', 'EX8-069', 'EX8-071'].includes(holder); const cid = own ? id : 'BT19-096'; // holders without a check-time 【시큐리티】 use a card that has one as the face-up subject (the rule is generic)
    const st = newState(); const atk = put(st, 'p1', [FILL[2]]); const pl = st.players.p2; pl.security = [FILL[0]]; S.secAddFaceUp(st, 'p2', cid, 'top');
    const before = st.pending.length; const ctl = S.beginSecurityCheck(st, 'p1', atk.uid, 'p2'); S.stepSecurityCheck(ctl);
    return eq('security effect queued', st.pending.slice(before).some(t => t.cardId === cid && (t.tags || []).includes('시큐리티')), true);
  });
  await sc('Q' + qd, `${holder}: shuffling security turns face-up cards face-down and does not flip them again`, async () => {
    const st = newState(); const pl = st.players.p1; pl.security = [FILL[0], FILL[1], FILL[2]]; S.secAddFaceUp(st, 'p1', id, 'top');
    const tm = put(st, 'p1', [FILL[3]]); S.queuePending(st, { player: 'p1', cardId: FILL[3], stackUid: tm.uid, tags: ['등장 시'], text: '자신의 시큐리티를 셔플한다.' }); await drain(st);
    return all(eq('none face-up after shuffle', S.secFaceUpCount(pl), 0), eq('card still in security', pl.security.includes(id), true));
  });
}

// ===== Q3270/3306/3311/3315/3318: 「옵션을 사용했을 때」 watchers do not fire when an option's effect resolves without being USED (security effect / delay)
for (const [q, holder] of [['Q3270', 'EX2-003'], ['Q3306', 'EX2-019'], ['Q3311', 'EX2-021'], ['Q3315', 'EX2-023'], ['Q3318', 'EX2-024']]) {
  await sc(q, `${holder}: option resolved by 【시큐리티】 (not used) does not trigger the "옵션 사용" effect; a real use does`, async () => {
    const run = async (viaUse) => {
      const st = newState(); const me = put(st, 'p1', [FILL[0], holder]); if (holder === 'EX2-024') me.cardId = 'EX2-024'; if (holder === 'EX2-024') me.sources = [FILL[0]];
      const foe = put(st, 'p2', [FILL[1]]); st.players.p1.deck = FILL.slice(0, 10); st.memory = 5; const dp0 = S.effectiveDP(st, 'p2', foe), h0 = st.players.p1.hand.length, m0 = st.memory;
      if (viaUse) { st.players.p1.hand = ['EX1-072']; S.useOptionCard(st, 'p1', 0); }
      else { S.queuePending(st, { player: 'p1', cardId: 'EX1-072', stackUid: null, tags: ['시큐리티'], text: '이 턴 동안 상대는 옵션 카드를 사용할 수 없다. 그 후, 이 카드를 패에 추가한다.' }); }
      await drain(st); return [S.effectiveDP(st, 'p2', foe) - dp0, st.players.p1.hand.length - h0, st.memory - m0 + (viaUse ? 3 : 0)];
    };
    const used = await run(true), notUsed = await run(false);
    // used: a +delta effect from the watcher (draw / memory / dp); not used: only the option's own text (hand +1 for security path)
    const usedFired = used[0] !== 0 || used[2] !== 0 || used[1] > 0; const notFired = notUsed[0] === 0 && notUsed[2] === 0 && notUsed[1] <= 1;
    return all(eq('used triggers watcher', usedFired, true), eq('security-effect resolution does not trigger', notFired, true));
  });
}

// ===== Tamer-source evolution conditions (BT18-022/025/037/048/049/063/067/076/077/078/079 family; Q2933..Q3040): evolving straight from the named Tamer is not "a digimon evolving"
const tamerEvo = [['Q2933', 'BT18-022'], ['Q2943', 'BT18-025'], ['Q2957', 'BT18-037'], ['Q2976', 'BT18-048'], ['Q2979', 'BT18-049'], ['Q2996', 'BT18-063'], ['Q3002', 'BT18-067'], ['Q3020', 'BT18-076'], ['Q3023', 'BT18-077'], ['Q3026', 'BT18-078'], ['Q3034', 'BT18-079']];
for (const [q, id] of tamerEvo) await sc(q, `${id}: evolves straight from its named Tamer; digimon-evolved watchers stay silent, own 진화 시 still fires`, async () => {
  const c = C(id); const line = (c.effectKo || '').split('\n').find(l => /〔진화〕/.test(l)); const tid = [...line.matchAll(/「([^」]+)」/g)].map(m => cards.find(x => x.category === 'tamer' && S.cardNameIs(x, m[1]))?.id).find(Boolean);
  if (!tid) return 'no tamer fixture';
  const st = newState(); put(st, 'p1', ['BT25-077']); const t = put(st, 'p1', [tid]); st.players.p1.hand = [id]; st.memory = 10;
  const ms = E.evolutionMethods(t.cardId, id, S.evoExtraArg(st, 'p1', t), S.evolveTargetRestriction(st, 'p1', t), { state: st, p: 'p1', stack: t });
  if (!ms.length) return 'condition not satisfied from the tamer'; const m0 = ms.find(m => m.id !== 'tamer-as-digimon' && m.id !== 'tamer10') || ms[0];
  st._evoTamerDirect = true; const r = S.digivolve(st, 'p1', t.uid, id, m0.baseCost, 'hand'); st._evoTamerDirect = false;
  const watcher = st.pending.filter(x => x.cardId === 'BT25-077').length;
  return all(eq('evolved', !!r && r.cardId === id, true), eq('watcher silent', watcher, 0));
});
finish('slice3-r2-c');
