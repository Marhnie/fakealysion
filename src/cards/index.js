// Per-card bespoke scripts, one file per shard. Each shard exports
//   SCRIPTS: { 'CARD-ID::firstTag': [ ...ops ] }   (key = cardId + '::' + segment.tags[0])
//   OPS:     { opName: async (instr, ctx) => {} }   (custom ops used by that shard's scripts)
import * as s1 from './shard1.js';
import * as s2 from './shard2.js';
import * as s3 from './shard3.js';
import * as s4 from './shard4.js';
import * as s5 from './shard5.js';
import * as s6 from './shard6.js';
import * as s7 from './shard7.js';
import * as s8 from './shard8.js';
import * as s10 from './shard10.js';
import * as s11 from './shard11.js';
import * as s12 from './shard12.js';
import * as s13 from './shard13.js';
import * as s14 from './shard14.js';
import * as s15 from './shard15.js';
import * as s16 from './shard16.js';
import * as s17 from './shard17.js';
import * as s18 from './shard18.js';
import * as s19 from './shard19.js';
import * as s20 from './shard20.js';
import * as s21 from './shard21.js';
import * as s22 from './shard22.js';
import * as s23 from './shard23.js';
import * as s24 from './shard24.js';
import * as s31 from './shard31.js';

const shards = [s1, s2, s3, s4, s5, s6, s7, s8, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s31];
export const SCRIPTS = Object.assign({}, ...shards.map(s => s.SCRIPTS));
export const OPS = Object.assign({}, ...shards.map(s => s.OPS));
// Optional per-shard continuous/replacement/event hooks (consumed by state.js): { 'CARD-ID': [descriptor, ...] }.
// A shard that has none simply doesn't export HOOKS.
export const HOOKS = {};
for (const s of shards) for (const [id, list] of Object.entries(s.HOOKS || {})) HOOKS[id] = (HOOKS[id] || []).concat(list);
