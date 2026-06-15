#!/usr/bin/env node
/**
 * 跨 6 域本体切片 order_fulfillment_360 —— 两场景「经切片检索 → 再推演」证据导出。
 *
 * 流程（全部经 DataCore 正门 REST，非硬编码）：
 *   1. 自起内存版 DataCore（合成 battery 数据，含 6 域链路边 + 内置切片）。
 *   2. 场景①·交期风险推演：affected_orders(常州) 命中受影响订单 → 逐单经
 *      POST /a/v1/ontology/slices/order_fulfillment_360/resolve 检索完整履约链 → 并集去重。
 *   3. 场景②·月度规划体检：plan_audit 出体检结论；并对代表订单经同一切片检索，
 *      展示喂入体检的跨域节点（供给/商务/工厂）。
 *   4. 把「完整推演节点 + 每个节点的细节 + 链路血缘」写成 Excel（SpreadsheetML 2003 .xls）。
 *
 * 用法：node scripts/slice-scenarios-excel.mjs [scale]    # scale 默认 L
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCALE = process.argv[2] ?? "L";
const SLICE = process.argv[3] ?? "order_fulfillment_360"; // 可传 order_to_cash_720 / enterprise_360 出 8 域证据
const HDR = { "content-type": "application/json", "x-debug-user": "demo:admin:admin" };

let A, children = [];
function spawnService(script, env) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let logbuf = ""; child.stdout.on("data", (c) => (logbuf += c)); child.stderr.on("data", (c) => (logbuf += c));
  child.tail = () => logbuf.split("\n").slice(-15).join("\n"); children.push(child); return child;
}
async function waitFor(url, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${url}`); await new Promise((r) => setTimeout(r, 300)); }
}
async function a(path, opts = {}) {
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const res = await fetch(`${A}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers: HDR, body });
  const text = await res.text();
  let json; try { json = text.length ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

// ---- SpreadsheetML 2003 (.xls) builder ------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function cell(v, style) {
  const isNum = typeof v === "number" && Number.isFinite(v);
  const t = isNum ? "Number" : "String";
  const val = isNum ? v : esc(v ?? "");
  return `    <Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${t}">${val}</Data></Cell>`;
}
function row(cells) { return `   <Row>\n${cells.join("\n")}\n   </Row>`; }
function sheet(name, rows) {
  return `  <Worksheet ss:Name="${esc(name)}">\n  <Table>\n${rows.join("\n")}\n  </Table>\n  </Worksheet>`;
}
function workbook(sheets) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="13" ss:Color="#1F4E79"/></Style>
  <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2E75B6" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="dom"><Font ss:Bold="1"/><Interior ss:Color="#DDEBF7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="k"><Font ss:Bold="1"/></Style>
 </Styles>
${sheets.join("\n")}
</Workbook>`;
}

const ROLE = { Order: "① 订单（履约起点）", Model: "② 型号（产品域）", Base: "③ 基地（工厂域·产能落点）", Line: "④ 产线（工厂域）", Process: "⑤ 工序（工艺域）", Equipment: "⑥ 设备（设备域·OEE 取数）", Material: "⑦ 物料（供给域·BOM/齐套）", Customer: "⑧ 客户（商务域·信用）" };
const LINK_SEM = {
  order_for_model: "订单 →(下单型号) 型号",
  model_producible_at: "型号 →(可生产于) 基地",
  line_belongs_to_base: "产线 →(归属) 基地",
  line_has_process: "产线 →(包含工序) 工序",
  equip_used_in: "设备 →(使用于) 工序",
  model_uses_material: "型号 →(BOM 用料) 物料",
  order_of_customer: "订单 →(下单客户) 客户",
};
const compact = (props) => {
  const keys = Object.keys(props).filter((k) => props[k] !== undefined && props[k] !== null);
  return keys.slice(0, 8).map((k) => `${k}=${Array.isArray(props[k]) ? props[k].join("/") : props[k]}`).join("；");
};

try {
  const BLOB = mkdtempSync(join(tmpdir(), "slx-"));
  const PORT = 15800 + Math.floor(Math.random() * 200);
  A = `http://127.0.0.1:${PORT}`;
  console.log(`【1】启动内存版 DataCore :${PORT}（scale=${SCALE}）`);
  const dc = spawnService(join(ROOT, "apps/datacore/dist/server.js"), {
    PORT: String(PORT), JWT_SECRET: "slx", SERVICE_TOKEN: "slx-svc", CREDENTIAL_KEY: "a".repeat(64),
    BLOB_DIR: BLOB, SEED_DEMO: "1", LOG_LEVEL: "warn",
  });
  try { await waitFor(`${A}/a/v1/healthz`); } catch (e) { console.error(String(e), "\nDC:", dc.tail()); process.exit(1); }

  console.log("【2】一键合成 battery 数据（含 6 域链路 + 内置切片）");
  const job = await a("/a/v1/synthetic/jobs", { body: { industry: "battery-manufacturing", scale: SCALE, seed: 42 } });
  if (job.status !== 202) throw new Error(`synthetic job: ${job.status} ${JSON.stringify(job.body)}`);
  const rowCounts = job.body?.report?.rowCounts ?? {};

  // 类型注册表（域 / 中文名 / 来源绑定）
  const typesRes = await a("/a/v1/ontology/object-types");
  const typeMeta = {};
  for (const t of Array.isArray(typesRes.body) ? typesRes.body : (typesRes.body?.items ?? [])) {
    typeMeta[t.key] = {
      domain: t.domain ?? "unassigned",
      display: t.displayName ?? t.key,
      binding: (t.sourceBindings ?? []).map((b) => `${b.connId}:${b.dataset}`).join(" | ") || "（派生/合成）",
    };
  }

  async function resolveSlice(so) {
    const r = await a(`/a/v1/ontology/slices/${SLICE}/resolve`, { body: { args: { so } } });
    if (r.status !== 200) throw new Error(`resolve ${so}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  // 并集去重：把多个订单的履约链合并为「完整推演节点」集合
  function unionInto(nodes, edges, nodeMap, edgeMap, rootSo) {
    for (const n of nodes) {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, { ...n, roots: new Set([rootSo]) });
      else nodeMap.get(n.id).roots.add(rootSo);
    }
    for (const e of edges) edgeMap.set(`${e.linkKey}|${e.from}|${e.to}`, e);
  }

  console.log("【3】场景①·交期风险推演（affected_orders @ 常州）→ 逐单经切片检索");
  const sim1 = await a("/a/v1/solvers/affected_orders/invoke", { body: { args: { baseId: "changzhou" } } });
  const aff = sim1.body?.data ?? {};
  const affList = Array.isArray(aff.affected) ? aff.affected : [];
  const s1nodes = new Map(), s1edges = new Map();
  let s1snapshot = "";
  for (const o of affList) {
    const r = await resolveSlice(o.so);
    s1snapshot = r.snapshotVersion;
    unionInto(r.nodes, r.edges, s1nodes, s1edges, o.so);
  }
  console.log(`  ✓ 命中 ${affList.length} 单 → 切片并集 ${s1nodes.size} 节点 / ${s1edges.size} 边 · snapshot ${s1snapshot}`);

  console.log("【4】场景②·月度规划体检（plan_audit）→ 代表订单经切片检索");
  const sim2 = await a("/a/v1/solvers/plan_audit/invoke", {
    body: { args: { dem: 480, seg_pas: 220, seg_ess: 170, seg_com: 90, sup: 450, ltaCov: 0.85, kitGap: 5, gmTarget: 18, cashCushion: 55, capex: 60 } },
  });
  const au = sim2.body?.data ?? {};
  // 代表订单：每个型号取交期最早的一张（覆盖全部型号 → 覆盖全部 BOM 物料 + 多基地）
  const ordersRes = await a("/a/v1/objects?type=Order&pageSize=500");
  const allOrders = (ordersRes.body?.items ?? []).map((x) => x.props);
  const repBySo = new Map();
  for (const o of allOrders) {
    const m = o.model;
    if (!repBySo.has(m) || String(o.due) < String(repBySo.get(m).due)) repBySo.set(m, o);
  }
  const reps = [...repBySo.values()];
  const s2nodes = new Map(), s2edges = new Map();
  let s2snapshot = "";
  for (const o of reps) {
    const r = await resolveSlice(o.so);
    s2snapshot = r.snapshotVersion;
    unionInto(r.nodes, r.edges, s2nodes, s2edges, o.so);
  }
  console.log(`  ✓ 体检评分 ${au.score ?? "?"}/100 · 结论 ${au.verdict ?? "?"} · 代表订单 ${reps.length} → 切片并集 ${s2nodes.size} 节点`);

  // ---- 组装 Excel --------------------------------------------------------
  const domOrder = ["product", "factory", "process", "equip", "supply", "commercial"];
  const sortNodes = (m) => [...m.values()].sort((x, y) => {
    const dx = domOrder.indexOf(typeMeta[x.typeKey]?.domain ?? "z"), dy = domOrder.indexOf(typeMeta[y.typeKey]?.domain ?? "z");
    return (dx - dy) || (x.typeKey < y.typeKey ? -1 : x.typeKey > y.typeKey ? 1 : (x.objectKey < y.objectKey ? -1 : 1));
  });
  function nodeSheet(name, title, nodeMap, snapshot, extraTop) {
    const rows = [row([cell(title, "title")])];
    for (const line of extraTop) rows.push(row([cell(line, "k")]));
    rows.push(row([cell(`快照版本 snapshotVersion=${snapshot}（{本体版本}.{派生 epoch}）`, "k")]));
    rows.push(row([cell("")]));
    const cols = ["序号", "数据域", "节点类型", "类型中文", "节点主键", "履约链角色", "关键属性（节选）", "来源系统/绑定（输入源）", "覆盖订单数"];
    rows.push(row(cols.map((c) => cell(c, "hdr"))));
    let i = 0; let lastDom = null;
    for (const n of sortNodes(nodeMap)) {
      i++;
      const meta = typeMeta[n.typeKey] ?? {};
      const dom = meta.domain ?? "unassigned";
      if (dom !== lastDom) { rows.push(row([cell(""), cell(`▼ ${dom} 域`, "dom")])); lastDom = dom; }
      rows.push(row([
        cell(i), cell(dom), cell(n.typeKey), cell(meta.display ?? n.typeKey),
        cell(n.objectKey), cell(ROLE[n.typeKey] ?? "—"), cell(compact(n.props)),
        cell(meta.binding ?? "—"), cell(n.roots ? n.roots.size : 1),
      ]));
    }
    return sheet(name, rows);
  }
  function edgeSheet(name, title, edgeMap, nodeMap) {
    const rows = [row([cell(title, "title")]), row([cell("")]),
      row(["序号", "链路 linkKey", "链路语义（跨域）", "上游节点", "上游域", "下游节点", "下游域"].map((c) => cell(c, "hdr")))];
    let i = 0;
    const desc = (id) => { const n = nodeMap.get(id); return n ? `${n.typeKey}:${n.objectKey}` : id; };
    const domOf = (id) => { const n = nodeMap.get(id); return n ? (typeMeta[n.typeKey]?.domain ?? "?") : "?"; };
    for (const e of edgeMap.values()) {
      i++;
      rows.push(row([cell(i), cell(e.linkKey), cell(LINK_SEM[e.linkKey] ?? e.linkKey),
        cell(desc(e.from)), cell(domOf(e.from)), cell(desc(e.to)), cell(domOf(e.to))]));
    }
    return sheet(name, rows);
  }

  const overview = sheet("概览", [
    row([cell("跨 6 域本体切片 order_fulfillment_360 —— 两场景推演节点导出", "title")]),
    row([cell("")]),
    row([cell("切片链路", "k"), cell("Order(产品) → Model(产品) → Base(工厂) → Line(工厂) → Process(工艺) → Equipment(设备)；旁挂 Model→Material(供给)、Order→Customer(商务)")]),
    row([cell("覆盖数据域", "k"), cell("product · factory · process · equip · supply · commercial（6 域）")]),
    row([cell("检索入口", "k"), cell("POST /a/v1/ontology/slices/order_fulfillment_360/resolve（A6 行级过滤逐跳生效，args.so 选定根订单）")]),
    row([cell("")]),
    row([cell("数据规模（本次 scale=" + SCALE + "；生产档 XL=10⁴ 订单，链结构与 scale 无关）", "hdr"), cell("行数", "hdr")]),
    ...Object.entries(rowCounts).sort().map(([k, v]) => row([cell(`${k}（${typeMeta[k]?.display ?? ""}）`), cell(v)])),
    row([cell("")]),
    row([cell("场景①·交期风险推演", "hdr"), cell("", "hdr")]),
    row([cell("求解器", "k"), cell("affected_orders（baseId=常州 changzhou）")]),
    row([cell("命中受影响订单", "k"), cell(affList.length)]),
    row([cell("切片并集节点 / 边", "k"), cell(`${s1nodes.size} / ${s1edges.size}`)]),
    row([cell("快照版本", "k"), cell(s1snapshot)]),
    row([cell("")]),
    row([cell("场景②·月度规划体检", "hdr"), cell("", "hdr")]),
    row([cell("求解器", "k"), cell("plan_audit（需求 480 万套；细分 220/170/90 自洽；现金垫 55 亿；毛利目标 18%）")]),
    row([cell("体检评分 / 结论", "k"), cell(`${au.score ?? "?"}/100 · ${au.verdict ?? "?"}`)]),
    row([cell("代表订单（每型号交期最早一张）", "k"), cell(reps.length)]),
    row([cell("切片并集节点 / 边", "k"), cell(`${s2nodes.size} / ${s2edges.size}`)]),
  ]);

  const xml = workbook([
    overview,
    nodeSheet("场景①推演·节点明细", "场景①·交期风险推演 —— 受影响订单履约链完整节点（并集去重）", s1nodes, s1snapshot,
      [`求解器 affected_orders @ 常州；命中 ${affList.length} 单，逐单经切片检索后并集去重。`]),
    edgeSheet("场景①·链路血缘", "场景①·履约链上下游血缘（边）", s1edges, s1nodes),
    nodeSheet("场景②体检·节点明细", "场景②·月度规划体检 —— 代表订单跨域输入完整节点（并集去重）", s2nodes, s2snapshot,
      [`求解器 plan_audit；按每型号交期最早订单经切片检索喂入跨域输入（供给齐套/商务信用/工厂产能）。`]),
    edgeSheet("场景②·链路血缘", "场景②·履约链上下游血缘（边）", s2edges, s2nodes),
  ]);

  const outDir = join(ROOT, "deliverables");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${SLICE === "order_fulfillment_360" ? "跨域切片-两场景推演节点" : SLICE + "-跨域推演节点"}.xls`);
  writeFileSync(outPath, "﻿" + xml, "utf8");
  console.log(`\n✅ 已导出 Excel：${outPath}`);
  console.log(`   场景① ${s1nodes.size} 节点/${s1edges.size} 边 · 场景② ${s2nodes.size} 节点/${s2edges.size} 边`);
  for (const c of children) c.kill();
  process.exit(0);
} catch (err) {
  console.error("失败：", err);
  for (const c of children) c.kill();
  process.exit(1);
}
