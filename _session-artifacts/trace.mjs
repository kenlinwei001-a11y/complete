// Replicate hashString from prng.ts (djb2-ish). Let me find the real impl first by reading.
import fs from 'node:fs';
const prng = fs.readFileSync('/home/user/complete/apps/datacore/src/prng.ts','utf8');
const m = prng.match(/export function hashString[\s\S]*?\n}/);
console.log('--- hashString impl ---');
console.log(m ? m[0] : 'NOT FOUND');
