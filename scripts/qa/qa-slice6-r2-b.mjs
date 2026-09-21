// Slice-6 round 2, part B: face-up security (G73-76), security digimon order (G104), cards under tamers (G47/G229/G285), option 【사용】 details.
// Run: node scripts/qa/qa-slice6-r2-b.mjs [G#...] < /dev/null
import * as fs from 'fs';
import { S, E, Fx, C, plain, plainTamer, plainOption, W, scenario, run } from './lib-s6.mjs';
const G = JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json', 'utf8'));
const FU = ['BT25-094', 'BT25-095', 'BT25-097', 'BT25-099', 'BT25-102', 'EX12-069']; // face-up-security option group (G73-76)
// ---- G73: an option placed face-up under security is a face-up security card; bottom of the security, count unchanged (hand +1, security same) ----
scenario('G73', 'face-up security options: 【메인】 takes the bottom security to hand and puts the option face-up at the bottom', async () => {
  const w = W({ p1: { hand: ['BT25-094'], battle: ['P-196'] }, p2: {}, memory: 10 });
  const sec0 = w.pl('p1').security.length;
  await w.useOption('p1', 'BT25-094');
  w.eq(w.pl('p1').security.length, sec0, 'security count unchanged (one out, option in)');
  w.eq(w.pl('p1').security[w.pl('p1').security.length - 1], 'BT25-094', 'option at the bottom');
  w.eq(w.pl('p1').secUp['BT25-094'], 1, 'marked face-up');
  return w;
});
// ---- G75/G74: checked face-up security: card is publicly checked, its 【시큐리티】 effect triggers, then leaves security ----
scenario('G75', 'face-up security card that is checked triggers its 【시큐리티】 effect and leaves security/face-up state', async () => {
  const w = W({ p1: { battle: [plain(4, 0)] }, p2: { security: ['BT25-094', plain(3, 0), plain(3, 1)] } });
  w.pl('p2').secUp = { 'BT25-094': 1 };
  await w.attack('p1', w.p1.stacks[0].uid, 'PLAYER');
  w.ok(w.fires('BT25-094', '시큐리티') >= 1, '【시큐리티】 effect fired');
  w.eq(w.pl('p2').security.includes('BT25-094'), false, 'checked card left the security');
  w.ok(!(w.pl('p2').secUp['BT25-094'] > 0), 'face-up mark consumed');
  return w;
});
scenario('G74', 'checking a face-up security: no other rule change (one card per S-attack, security shrinks by 1, card to trash)', async () => {
  const w = W({ p1: { battle: [plain(4, 0)] }, p2: { security: ['BT25-095', plain(3, 0), plain(3, 1)] } });
  w.pl('p2').secUp = { 'BT25-095': 1 };
  await w.attack('p1', w.p1.stacks[0].uid, 'PLAYER');
  w.eq(w.pl('p2').security.length, 2, 'security -1');
  w.ok(w.pl('p2').trash.includes('BT25-095'), 'option card trashed after its security effect');
  return w;
});
// ---- G76: shuffling security turns all face-up cards face-down first and they stay face-down ----
scenario('G76', 'security shuffle turns face-up cards face-down', async () => {
  const w = W({ p1: {}, p2: {} });
  w.pl('p1').security = ['BT25-094', plain(3, 0), plain(3, 1)]; w.pl('p1').secUp = { 'BT25-094': 1 };
  await w.exec('p1', '자신의 시큐리티를 셔플한다.', plainTamer());
  w.eq(Object.values(w.pl('p1').secUp || {}).reduce((a, b) => a + b, 0), 0, 'no face-up left');
  w.eq(w.pl('p1').security.length, 3, 'same cards');
  return w;
});
await run('slice6-r2-b');
