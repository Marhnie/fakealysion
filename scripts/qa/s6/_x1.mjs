import { S, E, Fx, C, plain, W } from '../lib-s6.mjs';
const seg = S.parseEffectSegments(C('BT26-047').effectKo).segments.find(s=>s.tags.includes('자신의 메인 페이즈 개시 시'));
const w = W({ p1: { battle: ['BT26-047', plain(3,2)] }, p2: { battle: [plain(3, 0)] }, memory: 10 });
const sides=[];
w.answers.pickStackAnySide = (o) => { sides.push([...new Set(o.entries.map((e) => e.player))].sort().join('')); const e = o.entries[0]; return { player: e.player, uid: e.uid }; };
w.answers.pickStack = (o)=>{ sides.push('ps'+o.player); };
await w.exec('p1', seg.body, 'BT26-047', w.p1.stacks[0].uid, { tags: seg.tags });
console.log(sides, w.errors, [...w.pl('p1').battle,...w.pl('p2').battle].map(s=>s.suspended));
