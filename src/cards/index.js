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

const shards = [s1, s2, s3, s4, s5, s6, s7, s8];
export const SCRIPTS = Object.assign({}, ...shards.map(s => s.SCRIPTS));
export const OPS = Object.assign({}, ...shards.map(s => s.OPS));
// Optional per-shard continuous/replacement/event hooks (consumed by state.js): { 'CARD-ID': [descriptor, ...] }.
// A shard that has none simply doesn't export HOOKS.
export const HOOKS = {};
for (const s of shards) for (const [id, list] of Object.entries(s.HOOKS || {})) HOOKS[id] = (HOOKS[id] || []).concat(list);
