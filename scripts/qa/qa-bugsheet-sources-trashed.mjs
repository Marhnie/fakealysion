// Bug sheet 2026-10 (1): "EX8-005가 P-167의 진화시 효과로 광물형을 가지고 있는 디지몬의 진화원에서 파기될때 메모리를 받는 효과가 발동되지 않으며, p-169의 효과도 트리거가 안됨".
// Every bespoke effect / cost that trashes cards out of a stack's evolution sources must go through the shared trasher (S.trashSourceIdxs / S.trashEvoSources) so the game event
// 'sourcesTrashed' fires ("이 카드가 …진화원에서 효과로 파기되었을 때" EX8-005/047/048/051, EX7-071, P-169 …).  Run: node scripts/qa/qa-bugsheet-sources-trashed.mjs < /dev/null
import { S, E, newBoard, stk, mkChoose, drain, scenario, report, F3, fillerLv, evo, nm, idByName } from './lib5.mjs';
const lv3 = fillerLv(3), lv4 = fillerLv(4), lv5 = fillerLv(5), lv6 = fillerLv(6);
const seen = []; // every 'sourcesTrashed' event of the running scenario
S.EVENT_HOOKS.push((state, kind, info) => { if (kind === 'sourcesTrashed') seen.push({ owner: info.owner, uid: info.stack?.uid, cardId: info.stack?.cardId, cause: info.cause, ids: [...(info.ids || [])] }); });
const reset = () => { seen.length = 0; };

await scenario('sheet-1a', 'P-167 【진화 시】 cost: trashing EX8-005 from a 광물형 Digimon\'s sources fires sourcesTrashed -> EX8-005 메모리 +1 and P-169 (own 광물형 stack) triggers', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: lv3[0], src: ['EX8-005'] }, 'P-169'], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0];
  chk(!!evo(st, 'p1', h, 'P-167', 0), 'evolution into P-167 happened');
  const m0 = st.memory, ran = await drain(st, mkChoose(st));
  chk(seen.length >= 1 && seen[0].cause === 'effect' && seen[0].ids.includes('EX8-005'), 'sourcesTrashed(effect) emitted for EX8-005: ' + JSON.stringify(seen));
  chk(ran.some(x => /^EX8-005/.test(x)), 'EX8-005 inherited effect pending ran: ' + ran.join(' ; '));
  chk(ran.some(x => /^P-169/.test(x)), 'P-169 【서로의 턴】 pending ran: ' + ran.join(' ; '));
  chk(st.memory >= m0 + 1, 'memory went up (EX8-005 +1): ' + m0 + ' -> ' + st.memory);
});
await scenario('sheet-1b', 'P-167 cost: P-169 rests and puts a 광물형 trash card under THAT Digimon (the trashed EX8-005 can be the one)', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: lv3[0], src: ['EX8-005'] }, 'P-169'], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0], tam = stk(st, 'p1', 'P-169');
  evo(st, 'p1', h, 'P-167', 0); await drain(st, mkChoose(st));
  chk(tam.suspended, 'P-169 was rested as its cost');
  chk(h.sources.includes('EX8-005'), 'a 광물형/광석형 card was placed back under the Digimon: ' + h.sources.map(nm).join(','));
});
await scenario('sheet-1c', 'P-167 cost with a second (vanilla) host: EX8-005 under a non-광물형 host does not give memory', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: lv3[0], src: [] }, { id: lv3[1], src: ['EX8-005'] }], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; evo(st, 'p1', h, 'P-167', 0);
  const m0 = st.memory; const ran = await drain(st, mkChoose(st));
  chk(seen.length === 1 && seen[0].ids[0] === 'EX8-005', 'event fired once for the vanilla host: ' + JSON.stringify(seen));
  chk(!ran.some(x => /^EX8-005/.test(x)), 'EX8-005 does not trigger under a non-광물형 Digimon: ' + ran.join(' ; '));
  chk(st.memory === m0, 'no memory: ' + m0 + ' -> ' + st.memory);
});
await scenario('sheet-1d', 'P-167: a FACE-DOWN source has no card info and is never offered as the cost', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: lv3[0], src: ['EX8-005'], fd: 1 }], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; evo(st, 'p1', h, 'P-167', 0); await drain(st, mkChoose(st));
  chk(seen.length === 0 && h.sources.includes('EX8-005'), 'face-down EX8-005 untouched: ' + JSON.stringify(seen));
});
await scenario('sheet-1e', 'EX7-010 (s4_trashSourceOption): EX7-071 trashed from a source -> its own 「진화원에서 효과로 파기되었을 때, 메모리 +1」 gives exactly +1', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: lv3[0], src: ['EX7-071'] }], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; evo(st, 'p1', h, 'EX7-010', 0);
  const m0 = st.memory; await drain(st, mkChoose(st));
  chk(seen.length === 1 && seen[0].ids.includes('EX7-071'), 'sourcesTrashed emitted: ' + JSON.stringify(seen));
  chk(st.memory === m0 + 1, 'memory +1 exactly: ' + m0 + ' -> ' + st.memory);
});
const war = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.nameKo.includes('워매몬'))?.id;
await scenario('sheet-1f', 'RB1-019 【어택 시】 cost (워매몬 from its own sources) fires sourcesTrashed', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: 'RB1-019', src: [war] }], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; S.queueTriggersForStack(st, 'p1', h, 'attack'); await drain(st, mkChoose(st));
  chk(seen.length === 1 && seen[0].cause === 'effect' && seen[0].ids[0] === war, 'sourcesTrashed(effect): ' + JSON.stringify(seen));
});
await scenario('sheet-1g', 'EX3-013 【서로의 턴】 replacement (Lv.5 sources x2 -> not deleted) fires sourcesTrashed (and still stays on the field)', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: 'EX3-013', src: [lv5[0], lv5[1]] }] }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p2' });
  const h = st.players.p1.battle[0];
  S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk(st.players.p1.battle.includes(h), 'EX3-013 survived');
  chk(seen.length === 1 && seen[0].ids.length === 2, 'sourcesTrashed emitted for both Lv.5 sources: ' + JSON.stringify(seen));
  chk(h.sources.length === 0 && st.players.p1.trash.length >= 2, 'sources moved to trash');
});
await scenario('sheet-1h', 'BT5-086 survive replacement (Lv.6 source trashed) fires sourcesTrashed', async (chk) => {
  reset();
  const st = newBoard({ p1: { battle: [{ id: 'BT5-086', src: [lv6[0]] }] }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p2' });
  const h = st.players.p1.battle[0]; S.deleteStack(st, 'p1', h.uid, 'trash', 'effect');
  chk(st.players.p1.battle.includes(h), 'BT5-086 survived');
  chk(seen.length === 1 && seen[0].ids[0] === lv6[0], 'sourcesTrashed emitted: ' + JSON.stringify(seen));
});
await scenario('sheet-1i', 'EX13-032 【진화 시】 cost: a face-down card under the Tamer trashed -> sourcesTrashed on the Tamer stack (BT26-002 style watchers)', async (chk) => {
  reset();
  const tamer = 'P-169';
  const st = newBoard({ p1: { battle: [{ id: lv3[0], rested: true }, tamer], deck: lv3.slice(5, 15) }, p2: { battle: [lv3[3]] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; const tm = st.players.p1.battle.find(s => s.cardId === tamer);
  tm.sources.push(lv3[9]); tm.s5fd = 1; // one face-down card under the Tamer
  chk(tm.sources.length === 1 && S.fdCount(tm) === 1, 'fixture: tamer holds one face-down card');
  chk(!!evo(st, 'p1', h, 'EX13-032', 0), 'evolved');
  await drain(st, mkChoose(st, { answer: (k, o) => k === 'multipleChoice' && (o.options || []).some(x => /뒷면/.test(x)) ? o.options.findIndex(x => /뒷면/.test(x)) : undefined }));
  chk(seen.some(e => e.uid === tm.uid && e.ids.length === 1), 'sourcesTrashed on the Tamer stack: ' + JSON.stringify(seen));
  chk(tm.sources.length === 0 && S.fdCount(tm) === 0, 'tamer sources + face-down counter cleaned');
});
await scenario('sheet-1j', 'RB1-016 / s2_pluck: an effect trashing a source of an OPPONENT\'s Digimon fires sourcesTrashed for the opponent (EX8-005 pays out to ITS owner)', async (chk) => {
  reset();
  const blue = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.colors || []).includes('blue') && c.level === 3 && !c.effectKo && !c.inheritedKo)?.id;
  const st = newBoard({ p1: { battle: [{ id: lv4[0] }], hand: [blue], deck: lv3.slice(5, 15) }, p2: { battle: [{ id: 'P-167', src: ['EX8-005'] }] }, memory: 3, active: 'p1' });
  const h = st.players.p1.battle[0]; evo(st, 'p1', h, 'RB1-016', 0);
  const m0 = st.memory; await drain(st, mkChoose(st, { answer: (k, o) => k === 'multipleChoice' && /^0장$/.test(o.options?.[0] || '') ? o.options.length - 1 : undefined })); // discard the blue card
  chk(seen.some(e => e.owner === 'p2' && e.ids.includes('EX8-005')), 'sourcesTrashed owner p2: ' + JSON.stringify(seen));
  chk(st.memory === m0 - 1, 'p2 got memory +1 from EX8-005 (relative to p1: -1): ' + m0 + ' -> ' + st.memory);
});
report();
