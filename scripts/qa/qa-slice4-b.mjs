// Slice-4 official card Q&A scenarios, batch B (promo cards, "ことで" partial cost, name matching). Q ids -> data/rulings/slice4.json. Run: node scripts/qa/qa-slice4-b.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runDelay, drain, runAll } from './lib-s4.mjs';
const SC = [];
const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = () => pool(dig(3), 1)[0];
const cnt = (arr, id) => arr.filter(x => x === id).length;

// P-008 / P-010: the source-name condition needs the EXACT name (X-antibody variant / doctor do not count)
add(4114, 'P-008', async (ck) => { // exact-name "가루몬" required; "가루몬 X항체" is not enough
  const st = newState(); const me = put(st, 'p1', ['P-008', 'BT9-024']); me.suspended = true;
  await runEffect(st, 'P-008', '어택 시', { stackUid: me.uid });
  ck(me.suspended === true, 'P-008 unrested with 가루몬 X항체 as source');
});
add(4114, 'P-008(pos)', async (ck) => { const st = newState(); const me = put(st, 'p1', ['P-008', 'BT1-036']); me.suspended = true; await runEffect(st, 'P-008', '어택 시', { stackUid: me.uid }); ck(me.suspended === false, 'exact 가루몬 source did not unrest'); });
add(4115, 'P-010', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['P-010', 'BT1-011']); me.suspended = true; // 아구몬 박사
  const t = S.parseEffectSegments(C['P-010'].effectKo).segments[0];
  await runEffect(st, 'P-010', t.tags[0], { stackUid: me.uid });
  ck(me.suspended === true, 'unrested with 아구몬 박사 source (text: ' + t.body.slice(0, 40) + ')');
});

// P-011 inherited: fewer than 3 non-digitama cards in trash -> the effect cannot be paid, no draw, trash untouched (partial cost is not allowed)
add(4120, 'P-011', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT1-115', 'P-011']); const d = pool(dig(3), 2); st.players.p1.trash = [d[0], d[1]];
  const h0 = st.players.p1.hand.length;
  await runEffect(st, 'P-011', '어택 시', { stackUid: me.uid, inherited: true, text: S.parseEffectSegments(C['P-011'].inheritedKo).segments[0].body });
  ck(st.players.p1.hand.length === h0 && st.players.p1.trash.length === 2, `hand+${st.players.p1.hand.length - h0} trash ${st.players.p1.trash.length}`);
});
add(4122, 'P-011', async (ck) => { // 3 cards go back AND the draw happens (no skipping the draw)
  const st = newState(); const me = put(st, 'p1', ['P-011']); const d = pool(dig(3), 3); st.players.p1.trash = [...d]; const h0 = st.players.p1.hand.length, dk0 = st.players.p1.deck.length;
  await runEffect(st, 'P-011', '어택 시', { stackUid: me.uid });
  ck(st.players.p1.trash.length === 0 && st.players.p1.hand.length === h0 + 1 && st.players.p1.deck.length === dk0 + 3 - 1, `trash ${st.players.p1.trash.length} hand+${st.players.p1.hand.length - h0} deck ${st.players.p1.deck.length - dk0}`);
});

// P-012: only battle-area digimon named Vdramon enable the main effect; the DP+1000 may go to any own digimon
add(4124, 'P-012', async (ck) => { // raising-area 브이드라몬 is not referenced: the tamer is not rested (effect not activated)
  const st = newState(); const tm = put(st, 'p1', ['P-012']); st.players.p1.raising = S._s4.makeStack('BT1-115', 1);
  const seg = S.parseEffectSegments(C['P-012'].effectKo).segments.find(s => s.tags.includes('메인'));
  await runEffect(st, 'P-012', '메인', { stackUid: tm.uid, text: seg.body });
  ck(!tm.suspended, 'tamer rested with only a raising-area 브이드라몬');
});
add(4124, 'P-012(pos)', async (ck) => {
  const st = newState(); const tm = put(st, 'p1', ['P-012']); put(st, 'p1', ['BT1-115']);
  const seg = S.parseEffectSegments(C['P-012'].effectKo).segments.find(s => s.tags.includes('메인'));
  await runEffect(st, 'P-012', '메인', { stackUid: tm.uid, text: seg.body });
  ck(tm.suspended, 'tamer not rested with a battle-area 브이드라몬');
});
add(4126, 'P-012', async (ck) => {
  const st = newState(); const tm = put(st, 'p1', ['P-012']); put(st, 'p1', ['BT1-115']); const other = put(st, 'p1', [D3()]); let seen = null;
  const seg = S.parseEffectSegments(C['P-012'].effectKo).segments.find(s => s.tags.includes('메인'));
  await runEffect(st, 'P-012', '메인', { stackUid: tm.uid, text: seg.body, picks: { multipleChoice: () => 1, pickStack: (o) => { seen = o.uids; return other.uid; } } });
  ck(seen && seen.includes(other.uid), 'non-Vdramon digimon not offered: ' + JSON.stringify(seen));
});

// P-016: security attack +1 per own 디아블로몬 (itself counted)
add(4128, 'P-016', async (ck) => { const st = newState(); const me = put(st, 'p1', ['P-016']); const b = S.securityAttackBonus(me, st, 'p1'); ck(b === 1 || S.securityAttackBonus(me) === 1, 'bonus ' + b + '/' + S.securityAttackBonus(me)); });

// P-021: play 팔몬 from hand free, returning the 이미나 to hand
add(4130, 'P-021', async (ck) => {
  const st = newState(); const t = put(st, 'p1', ['BT1-089']); st.players.p1.hand = ['P-032'];
  await runEffect(st, 'P-021', '메인');
  ck(st.players.p1.battle.some(s => s.cardId === 'P-032') && st.players.p1.hand.includes('BT1-089'), 'hand=' + st.players.p1.hand + ' battle=' + st.players.p1.battle.map(s => s.cardId));
});
// P-022: needs BOTH hand cards; with only one it cannot play the target
add(4131, 'P-022', async (ck) => {
  const st = newState(); put(st, 'p1', ['BT3-093']); put(st, 'p1', ['BT3-094']); st.players.p1.hand = ['BT3-025', 'BT3-027']; // 엑스브이몬 + 파일드라몬, no 스팅몬
  await runEffect(st, 'P-022', '메인');
  ck(!st.players.p1.battle.some(s => s.cardId === 'BT3-027') && st.players.p1.hand.length === 2, 'played 파일드라몬 with only one of the pair; hand=' + st.players.p1.hand);
});
add(4131, 'P-022(pos)', async (ck) => {
  const st = newState(); put(st, 'p1', ['BT3-093']); put(st, 'p1', ['BT3-094']); st.players.p1.hand = ['BT3-025', 'BT3-050', 'BT3-027'];
  await runEffect(st, 'P-022', '메인');
  ck(st.players.p1.battle.some(s => s.cardId === 'BT3-027') && st.players.p1.hand.length === 0, 'pair did not enable the play; hand=' + st.players.p1.hand);
});
add(4132, 'P-023', async (ck) => { // no 파닥몬 in play: nothing goes under security
  const st = newState(); put(st, 'p1', ['BT1-087']); const s0 = st.players.p1.security.length; await runEffect(st, 'P-023', '메인'); ck(st.players.p1.security.length === s0, 'security changed'); });

// ---- "ことで": partial cost payment not allowed
add(4570, 'BT21-062', async (ck) => { // 3 of the required 4 cards in trash: nothing is placed under, no option used
  const st = newState(); const me = put(st, 'p1', ['BT21-062', 'BT1-036']); st.players.p1.trash = ['BT11-061', 'BT18-060', 'BT21-056']; const s0 = me.sources.length;
  await runEffect(st, 'BT21-062', '진화 시', { stackUid: me.uid });
  ck(me.sources.length === s0 && st.players.p1.trash.length === 3, `sources ${me.sources.length - s0} trash ${st.players.p1.trash.length}`);
});
add(4782, 'EX9-028', async (ck) => { // only 2 Ver.4 cards in the trash: no evolve
  const st = newState(); const me = put(st, 'p1', ['EX9-028']); const v4 = Object.values(C).filter(c => c.category === 'digimon' && (c.types || []).includes('Ver.4')).slice(0, 3).map(c => c.id);
  st.players.p1.trash = [v4[0], v4[1]]; st.players.p1.hand = [v4[2]];
  await runEffect(st, 'EX9-028', '자신의 턴 종료 시', { stackUid: me.uid });
  ck(me.cardId === 'EX9-028' && st.players.p1.trash.length === 2, `top ${me.cardId} trash ${st.players.p1.trash.length}`);
});
add(4818, 'EX9-057', async (ck) => { // only 2 trash cards: nothing is placed on top, no destroy
  const st = newState(); const me = put(st, 'p1', ['EX9-057']); put(st, 'p2', [D3()]); const b0 = st.players.p2.battle.length;
  const nega = pool(c => /네가몬/.test(c.nameKo) && c.category === 'digimon', 3); st.players.p1.trash = [nega[0], nega[1]];
  await runEffect(st, 'EX9-057', '진화 시', { stackUid: me.uid });
  ck(st.players.p2.battle.length === b0 && st.players.p1.trash.length === 2, `opp battle ${st.players.p2.battle.length} trash ${st.players.p1.trash.length}`);
});
add(4833, 'EX9-071', async (ck) => { // delay: only 1 face-down source: cannot pay, digimon stays rested
  const st = newState(); const dm = Object.values(C).find(c => c.category === 'digimon' && (c.types || []).includes('DM') && c.level === 3).id; const me = put(st, 'p1', [dm, D3()]); me.suspended = true; me.sources = [D3()]; me.sourcesFaceDown = [true];
  const o = put(st, 'p1', ['EX9-071']); o.placedTurn = 1;
  const r = await runDelay(st, 'p1', o.uid);
  ck(me.suspended === true, 'unrested with insufficient face-down sources');
});

// ---- RB1-031 destroy: Lv <= number of evolution cards
add(4107, 'RB1-031', async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['RB1-031', 'BT1-036', 'BT2-073', 'BT5-024', 'ST2-06', 'EX1-015']); const t = put(st, 'p2', [pool(dig(5), 1)[0]]); const t2 = put(st, 'p2', [pool(dig(6), 1)[0]]);
  await runEffect(st, 'RB1-031', '진화 시', { stackUid: me.uid });
  ck(!st.players.p2.battle.some(s => s.uid === t.uid) || !st.players.p2.battle.some(s => s.uid === t2.uid), 'no destroy with 5 sources');
  ck(st.players.p2.battle.some(s => s.uid === t2.uid), 'Lv6 destroyed with 5 sources');
});

const R = await runAll(SC, 'qa-slice4-b');
process.exit(R.fail ? 1 : 0);
