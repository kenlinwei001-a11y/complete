// WO-COMPUTED-EDGE · R6 探针：对一棵树的 dist 跑 generateBattery("S", 42)，逐集合算 sha256。
// **同一份脚本跑两棵树** ⇒ 差异只能来自代码，不来自序列化约定（判据落在这里，不在跟某个外部 hash 串比）。
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.argv[2];
if (!root) { console.error("usage: determinism.mjs <repoRoot>"); process.exit(2); }
const mod = await import(pathToFileURL(path.join(root, "apps/datacore/dist/synthetic/battery.js")).href);
const g = mod.generateBattery(42, "S"); // 签名是 (seed, scale)，不是 (scale, seed)

// 稳定序列化：对象键**排序**后再串（JSON.stringify 的键序 = 插入序，
// 会把「加了一列」与「只是换了列序」混为一谈，那正是本仓「拿 X 当 Y 的证据」那个形态）。
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return v === undefined ? "null" : JSON.stringify(v);
};
const out = {};
for (const k of Object.keys(g).sort()) {
  const v = g[k];
  out[k] = { n: Array.isArray(v) ? v.length : null, sha: createHash("sha256").update(stable(v)).digest("hex").slice(0, 16) };
}
out.__ALL__ = { n: null, sha: createHash("sha256").update(Object.keys(g).sort().map((k) => `${k}=${out[k].sha}`).join("|")).digest("hex").slice(0, 16) };
console.log(JSON.stringify(out, null, 1));
