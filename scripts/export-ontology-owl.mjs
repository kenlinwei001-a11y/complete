#!/usr/bin/env node
/**
 * 把**运行态**的本体图谱导出成 OWL 2（RDF/XML）+ Turtle。
 *
 * 用法：
 *   node scripts/export-ontology-owl.mjs --base http://127.0.0.1:4001 \
 *        --user 'demo:admin:admin|planner|catalog_admin' --out ./out
 *   node scripts/export-ontology-owl.mjs --from-dir ./dump   # 用已抓好的 json
 *
 * 数据源是**真实接口**，不是仓里的静态清单：
 *   GET /a/v1/ontology/object-types   类型 + 属性 + 派生属性 + 源绑定
 *   GET /a/v1/ontology/domains        业务域
 *   GET /a/v1/ontology/graph          图谱 nodes/edges（含 solver/agent/metric 与关系边）
 *
 * ## 映射口径（每条都是编辑决定，写在这里以便复核）
 *
 * | 平台概念 | OWL 构件 | 说明 |
 * |---|---|---|
 * | ObjectType | `owl:Class` | `rdfs:label` = 中文 displayName |
 * | 业务域 | `owl:Class` + `rdfs:subClassOf` | 域建成类、类型挂其下 ⇒ Protégé 里得到按域分组的类树 |
 * | 属性（非 ref） | `owl:DatatypeProperty` | **按类型分别铸造**（`Base_baseId`），不合并同名属性 —— 源模型本就是每类型独立 schema，合并会造出源里没有的语义 |
 * | 属性 dataType=ref | `owl:ObjectProperty` | `rdfs:range` 取 `refToTypeKey` |
 * | isPrimaryKey | `owl:hasKey` + `owl:FunctionalProperty` | OWL 2 主键公理 |
 * | derivedProperties | `owl:DatatypeProperty` + `plat:formula` | 标注 `plat:derived true`，公式原样保留 |
 * | sourceBindings | 类上的标注 | `plat:sourceDataset` / 属性上的 `plat:sourceField` |
 * | 图谱 object→object 边 | `owl:ObjectProperty` | 名字取 edge.label |
 * | 边的 cardinality | **标注，不是公理** | 见下「不编」 |
 * | solver / agent / metric 节点 | 具名个体 + 各自的类 | 它们不是对象类型，建成个体才诚实 |
 * | 非 object 边（calc/fb/orch） | 个体间的 `owl:ObjectProperty` | 保留编排/反馈链 |
 *
 * ## 不编（接口没给的，一律不造）
 *
 * - **enum 的候选值**：接口只给 `dataType:"enum"`，不下发取值域 ⇒ 落成 `xsd:string`
 *   并在 `rdfs:comment` 里注明「枚举候选值未由接口下发」。**不许**凭猜写 `owl:oneOf`。
 * - **cardinality 不落成基数公理**：`"1:N"` 这种写法**没说哪一端是 1**。
 *   本仓已有一条在册欠账正是「mock 说 1:1、真本体是 1:N」——口径本身有争议。
 *   故一律落成 `plat:cardinality` 标注，读的人自己判，机器不推理。
 * - **json 类型**落 `rdfs:Literal`，不假装它有结构。
 *
 * 导出末尾会打印一份**计数自证**（类/属性/关系各多少、来自哪个接口多少条），
 * 与接口原始条数对不上即报错退出 —— 免得静默漏掉一半还宣称「完整」。
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const OUT = arg("--out", "./out");
const FROM_DIR = arg("--from-dir", null);
const BASE = arg("--base", "http://127.0.0.1:4001");
const USER = arg("--user", "demo:admin:admin|planner|catalog_admin");
const TENANT = USER.split(":")[0] || "demo";

const IRI = `https://ontology.platform.local/${TENANT}`;
const NS = `${IRI}#`;

async function pull(path, file) {
  if (FROM_DIR) return JSON.parse(readFileSync(join(FROM_DIR, file), "utf8"));
  const r = await fetch(`${BASE}/a/v1/${path}`, { headers: { "X-Debug-User": USER } });
  if (!r.ok) throw new Error(`GET /a/v1/${path} → HTTP ${r.status}（导出中止，不产出半份本体）`);
  return r.json();
}

// ── XML/Turtle 转义 ─────────────────────────────────────────────────────────
const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ttl = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
/** IRI 局部名：只留 OWL 工具普遍安全的字符，避免 Turtle 前缀名解析歧义。 */
const ln = (s) => String(s).replace(/[^A-Za-z0-9_一-龥]/g, "_");

/**
 * 全局 IRI 登记表 —— **撞车即报错退出**，不许静默产出两个同名实体。
 *
 * 来历：第一版没有这道闸，产出的文件 XML 良构、悬空引用为零、计数自证也全绿，
 * 但拿 rdflib 真解析时 `owl:Class` 从 112 掉到 111、个体从 20 掉到 19 ——
 * **三处 IRI 撞车被 RDF 的集合语义静默吞掉了**：
 *   · 对象类型键 `Metric`（经营指标）撞上本脚本自造的构件类 `Metric`
 *   · 两个图谱节点映射到同一个 `Solver_capacity_forecast`
 *   · `InterBaseTransfer.etaDay` 既是普通属性又是派生属性，被声明两次
 * 形态：**「我用『元素个数』当作『实体个数』的证据，而 RDF 里前者并不度量后者」**。
 * 所以判据不能是「我写了几个元素」，必须是「有几个不同的 IRI」。
 */
const REG = new Map();
const claim = (iri, what) => {
  const prev = REG.get(iri);
  if (prev && prev !== what) {
    console.error(`⛔ IRI 撞车：${iri}\n   已被「${prev}」占用，现「${what}」又要用它。`);
    console.error(`   RDF 会把两者**静默合并**成一个实体 —— 宁可导出失败，不产出悄悄少一条的本体。`);
    process.exit(1);
  }
  REG.set(iri, what);
  return !prev; // true = 首次登记
};

const XSD = {
  string: "http://www.w3.org/2001/XMLSchema#string",
  enum: "http://www.w3.org/2001/XMLSchema#string",
  number: "http://www.w3.org/2001/XMLSchema#decimal",
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  date: "http://www.w3.org/2001/XMLSchema#date",
  json: "http://www.w3.org/2000/01/rdf-schema#Literal",
};

const main = async () => {
  const types = await pull("ontology/object-types", "types.json");
  const domains = await pull("ontology/domains", "domains.json");
  const graph = await pull("ontology/graph", "graph.json");

  const typeKeys = new Set(types.map((t) => t.key));
  const nodeKind = new Map((graph.nodes || []).map((n) => [n.id, n.kind]));
  const nodeByI = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const domByKey = new Map(domains.map((d) => [d.domainKey, d]));

  // 统计器：每落一条就 +1，最后与接口原始条数对账
  const N = { classes: 0, domainClasses: 0, dataProps: 0, derivedProps: 0, refProps: 0, relProps: 0,
              keys: 0, individuals: 0, orchEdges: 0, skippedRef: [], skippedEdge: [], derivedMerged: [], dupNodes: [] };

  const A = []; // RDF/XML 片段
  const T = []; // Turtle 片段

  const clsIri = (k) => `${NS}${ln(k)}`;
  const domIri = (k) => `${NS}Domain_${ln(k)}`;

  // ── 业务域 → 类 ───────────────────────────────────────────────────────────
  for (const d of domains) {
    if (!claim(domIri(d.domainKey), `业务域 ${d.domainKey}`)) continue;
    N.domainClasses++;
    A.push(`  <owl:Class rdf:about="${xml(domIri(d.domainKey))}">
    <rdfs:label xml:lang="zh">${xml(d.displayName)}</rdfs:label>
    <rdfs:comment xml:lang="zh">业务域（分组类）：本体中所有属于该域的对象类型均为其子类。</rdfs:comment>
    <plat:domainKey>${xml(d.domainKey)}</plat:domainKey>${d.color ? `
    <plat:color>${xml(d.color)}</plat:color>` : ""}
  </owl:Class>`);
    T.push(`plat:Domain_${ln(d.domainKey)} a owl:Class ;
  rdfs:label "${ttl(d.displayName)}"@zh ;
  plat:domainKey "${ttl(d.domainKey)}" .`);
  }

  // ── 对象类型 → 类 + 属性 ──────────────────────────────────────────────────
  for (const t of types) {
    if (!claim(clsIri(t.key), `对象类型 ${t.key}`)) continue;
    N.classes++;
    const props = t.properties || [];
    const pks = props.filter((p) => p.isPrimaryKey);
    const sb = (t.sourceBindings || [])[0];
    const gn = (graph.nodes || []).find((n) => n.kind === "object" && n.key === t.key);

    const parts = [];
    parts.push(`    <rdfs:label xml:lang="zh">${xml(t.displayName || t.key)}</rdfs:label>`);
    if (t.domain && domByKey.has(t.domain)) parts.push(`    <rdfs:subClassOf rdf:resource="${xml(domIri(t.domain))}"/>`);
    if (t.domain) parts.push(`    <plat:domainKey>${xml(t.domain)}</plat:domainKey>`);
    if (t.status) parts.push(`    <plat:status>${xml(t.status)}</plat:status>`);
    if (t.published != null) parts.push(`    <plat:published rdf:datatype="${XSD.boolean}">${!!t.published}</plat:published>`);
    if (t.version != null) parts.push(`    <plat:version>${xml(t.version)}</plat:version>`);
    if (sb) parts.push(`    <plat:sourceDataset>${xml(`${sb.connId}/${sb.dataset}`)}</plat:sourceDataset>`);
    if (gn?.tier != null) parts.push(`    <plat:tier>${xml(gn.tier)}</plat:tier>`);
    if (pks.length) {
      N.keys++;
      parts.push(`    <owl:hasKey rdf:parseType="Collection">
${pks.map((p) => `      <owl:DatatypeProperty rdf:about="${xml(`${NS}${ln(t.key)}_${ln(p.propKey)}`)}"/>`).join("\n")}
    </owl:hasKey>`);
    }
    A.push(`  <owl:Class rdf:about="${xml(clsIri(t.key))}">\n${parts.join("\n")}\n  </owl:Class>`);
    T.push(`plat:${ln(t.key)} a owl:Class ;
  rdfs:label "${ttl(t.displayName || t.key)}"@zh ;${t.domain && domByKey.has(t.domain) ? `\n  rdfs:subClassOf plat:Domain_${ln(t.domain)} ;` : ""}
  plat:status "${ttl(t.status || "")}" .`);

    const fieldMap = sb?.fieldMappings || {};
    for (const p of props) {
      const pi = `${NS}${ln(t.key)}_${ln(p.propKey)}`;
      const label = p.displayName || p.propKey;
      const extra = [];
      if (p.unit) extra.push(`    <plat:unit>${xml(p.unit)}</plat:unit>`);
      if (p.temporal) extra.push(`    <plat:temporal rdf:datatype="${XSD.boolean}">true</plat:temporal>`);
      if (p.searchable) extra.push(`    <plat:searchable rdf:datatype="${XSD.boolean}">true</plat:searchable>`);
      if (fieldMap[p.propKey]) extra.push(`    <plat:sourceField>${xml(fieldMap[p.propKey])}</plat:sourceField>`);
      if (p.isPrimaryKey) extra.push(`    <rdf:type rdf:resource="http://www.w3.org/2002/07/owl#FunctionalProperty"/>`);

      if (p.dataType === "ref") {
        // ref 必须有目标类型，否则**跳过并记账**——宁可少一条，不许指向不存在的类
        if (!p.refToTypeKey || !typeKeys.has(p.refToTypeKey)) {
          N.skippedRef.push(`${t.key}.${p.propKey}→${p.refToTypeKey ?? "(无)"}`);
          continue;
        }
        if (!claim(pi, `${t.key}.${p.propKey} 引用属性`)) continue;
        N.refProps++;
        A.push(`  <owl:ObjectProperty rdf:about="${xml(pi)}">
    <rdfs:label xml:lang="zh">${xml(label)}</rdfs:label>
    <rdfs:domain rdf:resource="${xml(clsIri(t.key))}"/>
    <rdfs:range rdf:resource="${xml(clsIri(p.refToTypeKey))}"/>
    <plat:origin>property.ref</plat:origin>
${extra.join("\n")}
  </owl:ObjectProperty>`);
        T.push(`plat:${ln(t.key)}_${ln(p.propKey)} a owl:ObjectProperty ;
  rdfs:label "${ttl(label)}"@zh ; rdfs:domain plat:${ln(t.key)} ; rdfs:range plat:${ln(p.refToTypeKey)} .`);
      } else {
        if (!claim(pi, `${t.key}.${p.propKey} 数据属性`)) continue;
        N.dataProps++;
        const range = XSD[p.dataType] || XSD.string;
        // 枚举：接口不下发取值域 ⇒ 不许造 owl:oneOf，落 string 并说明
        const cmt = p.dataType === "enum"
          ? `\n    <rdfs:comment xml:lang="zh">枚举属性；候选值未由 /a/v1/ontology/object-types 下发，故落为 xsd:string，未生成 owl:oneOf。</rdfs:comment>`
          : p.dataType === "json"
            ? `\n    <rdfs:comment xml:lang="zh">JSON 属性；结构未在本体中声明，落为 rdfs:Literal。</rdfs:comment>` : "";
        A.push(`  <owl:DatatypeProperty rdf:about="${xml(pi)}">
    <rdfs:label xml:lang="zh">${xml(label)}</rdfs:label>
    <rdfs:domain rdf:resource="${xml(clsIri(t.key))}"/>
    <rdfs:range rdf:resource="${xml(range)}"/>
    <plat:dataType>${xml(p.dataType)}</plat:dataType>${cmt}
${extra.join("\n")}
  </owl:DatatypeProperty>`);
        T.push(`plat:${ln(t.key)}_${ln(p.propKey)} a owl:DatatypeProperty ;
  rdfs:label "${ttl(label)}"@zh ; rdfs:domain plat:${ln(t.key)} ; rdfs:range <${range}> ; plat:dataType "${ttl(p.dataType)}" .`);
      }
    }

    for (const dp of t.derivedProperties || []) {
      const pi = `${NS}${ln(t.key)}_${ln(dp.propKey)}`;
      // 同一 propKey 既在 properties 又在 derivedProperties（实测 InterBaseTransfer.etaDay）：
      // 只补 plat:formula 标注，不再声明第二个同 IRI 属性（RDF 会静默合并，计数就骗人了）。
      if (REG.has(pi)) {
        N.derivedMerged.push(`${t.key}.${dp.propKey}`);
        A.push(`  <rdf:Description rdf:about="${xml(pi)}">\n    <plat:derived rdf:datatype="${XSD.boolean}">true</plat:derived>\n    <plat:formula>${xml(dp.formula)}</plat:formula>\n  </rdf:Description>`);
        N.derivedProps++;
        continue;
      }
      claim(pi, `${t.key}.${dp.propKey} 派生属性`);
      N.derivedProps++;
      A.push(`  <owl:DatatypeProperty rdf:about="${xml(pi)}">
    <rdfs:label xml:lang="zh">${xml(dp.propKey)}</rdfs:label>
    <rdfs:domain rdf:resource="${xml(clsIri(t.key))}"/>
    <plat:derived rdf:datatype="${XSD.boolean}">true</plat:derived>
    <plat:formula>${xml(dp.formula)}</plat:formula>
    <rdfs:comment xml:lang="zh">派生属性：由公式在运行时计算，非源系统字段。</rdfs:comment>
  </owl:DatatypeProperty>`);
      T.push(`plat:${ln(t.key)}_${ln(dp.propKey)} a owl:DatatypeProperty ;
  rdfs:domain plat:${ln(t.key)} ; plat:derived true ; plat:formula "${ttl(dp.formula)}" .`);
    }
  }

  // ── 图谱 object→object 边 → 关系属性 ──────────────────────────────────────
  const seenRel = new Set();
  for (const e of graph.edges || []) {
    const kf = nodeKind.get(e.from), kt = nodeKind.get(e.to);
    if (kf !== "object" || kt !== "object") continue;
    const from = nodeByI.get(e.from), to = nodeByI.get(e.to);
    if (!typeKeys.has(from?.key) || !typeKeys.has(to?.key)) { N.skippedEdge.push(e.id); continue; }
    const name = ln(e.label || e.id);
    if (seenRel.has(name)) continue;
    seenRel.add(name);
    if (!claim(NS + name, `关系 ${e.label || e.id}`)) continue;
    N.relProps++;
    A.push(`  <owl:ObjectProperty rdf:about="${xml(NS + name)}">
    <rdfs:label xml:lang="zh">${xml(e.label || e.id)}</rdfs:label>
    <rdfs:domain rdf:resource="${xml(clsIri(from.key))}"/>
    <rdfs:range rdf:resource="${xml(clsIri(to.key))}"/>
    <plat:edgeKind>${xml(e.kind)}</plat:edgeKind>${e.cardinality ? `
    <plat:cardinality>${xml(e.cardinality)}</plat:cardinality>
    <rdfs:comment xml:lang="zh">基数记号 "${xml(e.cardinality)}" 仅作标注：该记法未指明哪一端为 1，故**不**生成 owl:FunctionalProperty / 基数公理。</rdfs:comment>` : ""}
    <plat:origin>graph.edge</plat:origin>
  </owl:ObjectProperty>`);
    T.push(`plat:${name} a owl:ObjectProperty ;
  rdfs:label "${ttl(e.label || e.id)}"@zh ; rdfs:domain plat:${ln(from.key)} ; rdfs:range plat:${ln(to.key)} ;
  plat:edgeKind "${ttl(e.kind)}"${e.cardinality ? ` ; plat:cardinality "${ttl(e.cardinality)}"` : ""} .`);
  }

  // ── solver / agent / metric → 具名个体（它们不是对象类型，建成个体才诚实） ──
  // 前缀 Platform_ 是因为实测撞过车：对象类型里就有一个键叫 `Metric`（经营指标）。
  const KIND_CLASS = { solver: "Platform_Solver", agent: "Platform_Agent", metric: "Platform_Metric" };
  const KIND_LABEL = { solver: "求解器", agent: "智能体", metric: "指标" };
  for (const [k, c] of Object.entries(KIND_CLASS)) {
    A.push(`  <owl:Class rdf:about="${xml(NS + c)}">
    <rdfs:label xml:lang="zh">${xml(KIND_LABEL[k])}</rdfs:label>
    <rdfs:comment xml:lang="zh">平台构件类（非业务对象类型）：其成员为运行态注册的${xml(KIND_LABEL[k])}。</rdfs:comment>
  </owl:Class>`);
    T.push(`plat:${c} a owl:Class ; rdfs:label "${ttl(KIND_LABEL[k])}"@zh .`);
  }
  const indIri = (n) => `${NS}${KIND_CLASS[n.kind]}_${ln(n.key || n.id)}`;
  for (const n of graph.nodes || []) {
    if (n.kind === "object") continue;
    if (!KIND_CLASS[n.kind]) continue;
    if (!claim(indIri(n), `构件个体 ${n.key || n.id}`)) { N.dupNodes.push(n.key || n.id); continue; }
    N.individuals++;
    A.push(`  <owl:NamedIndividual rdf:about="${xml(indIri(n))}">
    <rdf:type rdf:resource="${xml(NS + KIND_CLASS[n.kind])}"/>
    <rdfs:label xml:lang="zh">${xml(n.label || n.key)}</rdfs:label>
    <plat:nodeKey>${xml(n.key)}</plat:nodeKey>${n.domain ? `
    <plat:domainKey>${xml(n.domain)}</plat:domainKey>` : ""}
  </owl:NamedIndividual>`);
    T.push(`plat:${KIND_CLASS[n.kind]}_${ln(n.key || n.id)} a owl:NamedIndividual, plat:${KIND_CLASS[n.kind]} ;
  rdfs:label "${ttl(n.label || n.key)}"@zh .`);
  }
  // 非 object 边（calc / fb / orch …）：保留编排与反馈链
  A.push(`  <owl:ObjectProperty rdf:about="${xml(NS)}graphLink">
    <rdfs:label xml:lang="zh">图谱连边</rdfs:label>
    <rdfs:comment xml:lang="zh">连接平台构件（求解器/智能体/指标）与对象类型的图谱边，保留原 kind 与 label。</rdfs:comment>
  </owl:ObjectProperty>`);
  for (const e of graph.edges || []) {
    const nf = nodeByI.get(e.from), nt = nodeByI.get(e.to);
    if (!nf || !nt) continue;
    if (nf.kind === "object" && nt.kind === "object") continue;
    const ref = (n) => (n.kind === "object" ? clsIri(n.key) : indIri(n));
    N.orchEdges++;
    A.push(`  <rdf:Description rdf:about="${xml(ref(nf))}">
    <plat:graphLinkTo rdf:resource="${xml(ref(nt))}"/>
    <plat:graphLinkLabel>${xml(`${e.label || e.id} [${e.kind}] → ${nt.key}`)}</plat:graphLinkLabel>
  </rdf:Description>`);
  }

  // ── 计数自证：与接口原始条数对账，对不上就报错，不产出「宣称完整」的半份 ──
  const srcTypes = types.length;
  const srcProps = types.reduce((a, t) => a + (t.properties || []).filter((p) => p.dataType !== "ref").length, 0);
  const srcRefs = types.reduce((a, t) => a + (t.properties || []).filter((p) => p.dataType === "ref").length, 0);
  const srcDerived = types.reduce((a, t) => a + (t.derivedProperties || []).length, 0);
  const srcOO = (graph.edges || []).filter((e) => nodeKind.get(e.from) === "object" && nodeKind.get(e.to) === "object").length;
  const srcNonObj = (graph.nodes || []).filter((n) => n.kind !== "object").length;

  const rows = [
    ["对象类型 → owl:Class", N.classes, srcTypes],
    ["业务域 → owl:Class", N.domainClasses, domains.length],
    ["数据属性 → DatatypeProperty", N.dataProps, srcProps],
    ["引用属性 → ObjectProperty", N.refProps + N.skippedRef.length, srcRefs],
    ["派生属性 → DatatypeProperty", N.derivedProps, srcDerived],
    ["构件节点 → NamedIndividual", N.individuals + N.dupNodes.length, srcNonObj],
  ];
  let bad = 0;
  console.log(`\n=== 计数自证（落地数 vs 接口原始数）===`);
  for (const [name, got, want] of rows) {
    const ok = got === want; if (!ok) bad++;
    console.log(`  ${ok ? "✅" : "❌"} ${name}: ${got} / ${want}`);
  }
  console.log(`  ℹ️ 关系属性 ${N.relProps}（object→object 边 ${srcOO} 条，按 label 去重后）`);
  console.log(`  ℹ️ 构件连边 ${N.orchEdges}（solver/agent/metric 相关）`);
  if (N.derivedMerged.length) console.log(`  ℹ️ 派生属性与同名普通属性合并 ${N.derivedMerged.length} 条（只补 formula 标注，不重复声明）：${N.derivedMerged.join(", ")}`);
  if (N.dupNodes.length) console.log(`  ⚠️ 图谱里同 key 的构件节点重复 ${N.dupNodes.length} 个，已去重：${N.dupNodes.join(", ")}`);
  if (N.skippedRef.length) console.log(`  ⚠️ ref 目标类型缺失、已跳过 ${N.skippedRef.length} 条：${N.skippedRef.join(", ")}`);
  if (N.skippedEdge.length) console.log(`  ⚠️ 端点不在类型表、已跳过边 ${N.skippedEdge.length} 条`);
  if (bad) { console.error(`\n⛔ ${bad} 项对不上 —— 不产出「宣称完整」的半份本体。`); process.exit(1); }

  // ── 落盘 ──────────────────────────────────────────────────────────────────
  mkdirSync(OUT, { recursive: true });
  // 头部计数一律**从 IRI 登记表现算**，不用「我写了几条」——
  // 后者在有合并/去重时会比真实实体数多，正是本脚本第一版栽过的那个坑。
  const tally = (pred) => [...REG.values()].filter(pred).length;
  const nClass = N.classes + N.domainClasses + 3;
  const nData = tally((v) => /数据属性$|派生属性$/.test(v));
  const nObj = tally((v) => /引用属性$/.test(v)) + tally((v) => v.startsWith("关系 ")) + 1; // +1 = graphLink
  const nInd = tally((v) => v.startsWith("构件个体 "));
  const header = `本体导出 · 租户 ${TENANT}
类 ${nClass} 个（对象类型 ${N.classes} · 业务域 ${N.domainClasses} · 构件类 3）
数据属性 ${nData} 个（其中派生 ${N.derivedProps}，含 ${N.derivedMerged.length} 条与同名普通属性合并）· 对象属性 ${nObj} 个
个体 ${nInd} 个（求解器/智能体/指标；图谱 ${N.individuals + N.dupNodes.length} 个节点中 ${N.dupNodes.length} 个 key 重复已去重）
枚举候选值与基数公理**未生成**：接口未下发取值域；基数记号未指明哪端为 1（见属性上的 rdfs:comment）`;

  const rdf = `<?xml version="1.0" encoding="UTF-8"?>
<!--
${header}
-->
<rdf:RDF xmlns="${NS}" xml:base="${IRI}"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
  xmlns:owl="http://www.w3.org/2002/07/owl#"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema#"
  xmlns:plat="${NS}">
  <owl:Ontology rdf:about="${IRI}">
    <rdfs:label xml:lang="zh">全域数字化智能决策支撑系统 · 本体图谱（租户 ${TENANT}）</rdfs:label>
    <rdfs:comment xml:lang="zh">${xml(header)}</rdfs:comment>
  </owl:Ontology>
${["domainKey", "color", "status", "published", "version", "tier", "dataType", "unit", "temporal", "searchable",
   "sourceDataset", "sourceField", "derived", "formula", "edgeKind", "cardinality", "origin", "nodeKey",
   "graphLinkTo", "graphLinkLabel"].map((p) => `  <owl:AnnotationProperty rdf:about="${NS}${p}"/>`).join("\n")}
${A.join("\n")}
</rdf:RDF>
`;

  const turtle = `@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix plat: <${NS}> .

<${IRI}> a owl:Ontology ;
  rdfs:label "全域数字化智能决策支撑系统 · 本体图谱（租户 ${TENANT}）"@zh .

${T.join("\n\n")}
`;

  writeFileSync(join(OUT, `ontology-${TENANT}.owl`), rdf);
  writeFileSync(join(OUT, `ontology-${TENANT}.ttl`), turtle);
  console.log(`\n✅ 已产出：\n  ${join(OUT, `ontology-${TENANT}.owl`)}  (RDF/XML)\n  ${join(OUT, `ontology-${TENANT}.ttl`)}  (Turtle)`);
};

main().catch((e) => { console.error("⛔ " + e.message); process.exit(1); });
