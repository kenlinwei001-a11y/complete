// B 独立复算：读证据 txt 的 JSONL，逐步手算（不复制 A 的脚本逻辑，独立实现）
import { readFileSync } from "node:fs";
const txt = readFileSync(process.argv[2], "utf8");
const rows = JSON.parse(txt.match(/^JSONL=(.*)$/m)[1]);
const base = Number(txt.match(/t0 读数 = ([\d.]+)/)[1]);
const sat = (raw) => { const b = 25, k = 75; return raw > k ? 100 - b / (1 + (raw - k) / b) : raw; };
let prev = base, worstRaw = 0, worstVal = 0;
for (const r of rows) {
  const amt = r.amts.length ? r.amts[0] : 0;
  if (!r.sat.length) { if (r.value !== prev) console.log(`t${r.t} UNCHANGED-CLAIM VIOLATED ${r.value} vs ${prev}`); prev = r.value; continue; }
  const rawMine = 0.63 * prev + 0.37 * base + amt;     // 独立写法：0.63/0.37 硬写，不读 lam
  const valMine = sat(rawMine);
  worstRaw = Math.max(worstRaw, Math.abs(rawMine - r.sat[0].raw));
  worstVal = Math.max(worstVal, Math.abs(valMine - r.sat[0].value));
  if (r.t <= 3 || r.t === 12) console.log(`t${r.t} rawMine=${rawMine.toFixed(12)} rawRec=${r.sat[0].raw} | valMine=${valMine.toFixed(12)} valRec=${r.sat[0].value}`);
  prev = r.value;
}
console.log(`${process.argv[2]}: worstRaw=${worstRaw.toExponential(2)} worstVal=${worstVal.toExponential(2)}`);
