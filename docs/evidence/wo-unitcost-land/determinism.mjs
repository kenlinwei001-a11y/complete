/**
 * WO-UNITCOST-LAND · 组① 确定性对照实验（R6 字节级一致）
 *
 * 三件事，一次跑完：
 *  ① 同 (battery, S, 42) 连跑两次 → 逐集合 hash 必须相同（自身可重入）；
 *  ② 打印**逐集合** hash —— 接线后若整体变了，能当场点名是哪个集合变的，
 *     而不是只知道「总 hash 变了」（那正是本单验收判据里「说不清哪些值变了就停手」那一条）；
 *  ③ `--strip=Model.unitCost,OrderLine.unitCost` 把新增字段从快照里剔除后再 hash，
 *     与接线前的基线逐集合比对 ⇒ 证明「除新增字段外其余值逐字节不变」。
 *
 * 金丝雀（先自证工具，再报否定结论）：
 *  · 集合数与两个已知必存在的集合（models / orderLines）必须非空；
 *  · `--mutate` 自检：人为改一个值，脚本必须报「变了」。不报 ⇒ 哈希器坏了。
 */
import { createHash } from "node:crypto";
import { generateBattery } from "../../../apps/datacore/dist/synthetic/battery.js";
import { generateExtended } from "../../../apps/datacore/dist/synthetic/battery-extended.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => (a.startsWith("--") ? a.slice(2).split("=") : [a, "1"])).map(([k, v]) => [k, v ?? "1"]),
);
const SEED = Number(args.seed ?? 42);
const SCALE = args.scale ?? "S";
const strip = String(args.strip ?? "").split(",").filter(Boolean); // "Model.unitCost" → 集合名靠 COLL_OF_TYPE 映射
const COLL_OF_TYPE = { Model: "models", OrderLine: "orderLines", Material: "materials" };

/** 稳定序列化：对象按键排序（生成器插入序变化不该被读成数值变化）。 */
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
};
const h = (v) => createHash("sha256").update(stable(v)).digest("hex").slice(0, 16);

function snapshot() {
  const g = generateBattery(SEED, SCALE);
  const ext = generateExtended(
    SEED,
    {
      models: g.models, bases: g.bases, lines: g.lines, equipment: g.equipment,
      materialBalances: g.materialBalances, demandSegments: g.demandSegments,
    },
    SCALE,
  );
  const all = { ...g, ...ext };
  // 剔除待排除字段（只从对应集合里剔，别的集合同名字段不动）
  for (const s of strip) {
    const [ty, prop] = s.split(".");
    const coll = COLL_OF_TYPE[ty] ?? ty;
    if (!Array.isArray(all[coll])) { console.log(`⛔ --strip 指向的集合不存在：${coll}（工具坏了）`); process.exit(2); }
    all[coll] = all[coll].map((r) => { const { [prop]: _drop, ...rest } = r; return rest; });
  }
  return all;
}

const a = snapshot();
const b = snapshot();

// ── 金丝雀 ─────────────────────────────────────────────────────────────
const colls = Object.keys(a).filter((k) => Array.isArray(a[k])).sort();
const canaryOk = colls.length > 40 && a.models?.length > 0 && a.orderLines?.length > 0 && a.materials?.length > 0;
console.log("═══ 金丝雀 ═══");
console.log(`  集合数=${colls.length}  models=${a.models?.length}  orderLines=${a.orderLines?.length}  materials=${a.materials?.length}`);
if (!canaryOk) { console.log("⛔ 金丝雀不中 —— 我的工具坏了，下面结论一律不作数"); process.exit(2); }
// 变异反证：哈希器真的会因一个值而变吗？
const mutated = JSON.parse(JSON.stringify(a.models));
mutated[0].unitPrice = Number(mutated[0].unitPrice) + 1;
console.log(`  变异反证：改一个 Model.unitPrice ⇒ hash ${h(a.models) === h(mutated) ? "**没变（哈希器坏了）**" : "变了 ✓"}`);
if (h(a.models) === h(mutated)) process.exit(2);

// ── 逐集合 hash ────────────────────────────────────────────────────────
console.log(`\n═══ 逐集合 hash  (seed=${SEED} scale=${SCALE}${strip.length ? ` strip=${strip.join("+")}` : ""}) ═══`);
let reentrant = true;
const lines = [];
for (const k of colls) {
  const ha = h(a[k]), hb = h(b[k]);
  if (ha !== hb) reentrant = false;
  lines.push(`${k}\t${a[k].length}\t${ha}${ha === hb ? "" : `  ✗两次不同(${hb})`}`);
}
console.log(lines.join("\n"));

const total = h(colls.map((k) => [k, h(a[k])]));
console.log(`\nTOTAL\t${total}`);
console.log(`两次重跑逐集合一致？ ${reentrant ? "是 ✓（R6 自身可重入）" : "否 ✗（存在随机源）"}`);
if (!reentrant) process.exit(1);
