import fs from "node:fs";
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const b = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
let diff = 0, same = 0;
for (const k of keys) {
  const x = a[k], y = b[k];
  if (!x || !y) { console.log(`ONLY-IN-ONE  ${k}`); diff++; continue; }
  if (x.sha === y.sha) { same++; continue; }
  diff++;
  console.log(`DIFF  ${k.padEnd(28)} n:${String(x.n).padStart(6)} -> ${String(y.n).padStart(6)}   sha:${x.sha} -> ${y.sha}`);
}
console.log(`\n合计：${keys.length} 个集合，${diff} 个有差异，${same} 个逐字节相同`);
