/**
 * WO-SLICE-DISCOVERY · 切片 root selector 里 `{{args.X}}` 占位符的**唯一真源**。
 *
 * 来历（为什么必须是一个模块而不是三处正则）：本仓此前有**两处**手抄的同一条正则 ——
 *   · `apps/datacore/src/ontology-core.ts` `executeSlice` 内联 `resolveTemplate`（执行期真解析）
 *   · `apps/datacore/src/ontology/slice-layers.ts` `diagnoseEmptyGraph` 的 `PLACEHOLDER`（缺参诊断）
 * 后者的注释写着「与 ontology-core.ts:596 resolveTemplate **一字不差**（口径单源，改一处必同改）」——
 * 那不是单源，那是**约定俗成的两处写**：靠人记得同改。本单要加第三个消费方（目录摘要下发
 * `requiredArgs`），再抄一份就是三处；「两处写判据 = 迟早对不上」这条坑本仓已反复吃过。
 * 故把正则与扫描逻辑提到此处，三方共用：**执行、诊断、发现看到的必须是同一组参数名**，
 * 否则「摘要说要 so、执行却按别的名字取」这种静默错答无人能发现。
 *
 * 纯函数（R6 确定性）：无 IO / 无 Date.now / 无随机；同入参同出参、requiredArgs 恒字典序。
 */

/**
 * `{{args.X}}` 占位符正则（**全仓唯一定义**）。
 * 整串匹配（`^…$`）：只有「整个值就是一个占位符」才算，`"SO-{{args.so}}"` 这类内嵌**不支持** ——
 * 与 `executeSlice` 的实际行为一致（它也只做整串替换）。改这条正则 = 同时改执行/诊断/发现三方。
 */
export const ARG_PLACEHOLDER_RE = /^\{\{\s*args\.([\w]+)\s*\}\}$/;

/** 取占位符里的参数名；非字符串 / 不是占位符 → null。 */
export function matchArgPlaceholder(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = ARG_PLACEHOLDER_RE.exec(raw);
  return m ? (m[1] as string) : null;
}

/**
 * 执行期解析：值是占位符 → 取 `args[名]`（**未提供即 undefined**，故意不兜底 ——
 * 兜底会让「缺参数」伪装成「过滤没匹配」，正是 `G-SLICE-EMPTYGRAPH-MISREAD` 那个误判的来源）；
 * 否则原样返回。
 */
export function resolveArgTemplate(raw: unknown, args: Record<string, unknown>): unknown {
  const name = matchArgPlaceholder(raw);
  return name === null ? raw : args[name];
}

/**
 * 参数**出处**：只记参数名不记出处，就答不出「这个参数该填什么」——
 * 那正是缺参诊断与目录 argHints 最有用的一半。
 *  · `objectKey`：占位符写在 `selector.byKey` 上 ⇒ 该填 root 对象的业务主键；
 *  · `prop`：占位符写在 `selector.filter` 的某个键上 ⇒ 该填 root 对象**那个属性**的取值。
 */
export type SliceArgSource = { from: "objectKey" } | { from: "prop"; propKey: string };

export interface RootArgScan {
  /** root selector 里出现的全部 `{{args.X}}` 参数名，字典序去重（R6）。 */
  requiredArgs: string[];
  /** 参数名 → 出处（同名多处出现时取**首见**，与 requiredArgs 的扫描序一致）。 */
  argSource: Map<string, SliceArgSource>;
}

/** root selector 的最小形状（与 `SliceSpecRecord["spec"]["root"]["selector"]` 结构兼容）。 */
export interface RootSelectorShape {
  byKey?: string;
  filter?: Record<string, unknown>;
}

/**
 * 扫描一条切片 root selector 声明的实参需求（**发现 / 诊断 / 摘要三方共用**）。
 * 扫描序 = byKey 先、filter 后（filter 内按 `Object.entries` 声明序）；requiredArgs 另按字典序输出。
 */
export function scanRootArgs(selector: RootSelectorShape | undefined): RootArgScan {
  const argSource = new Map<string, SliceArgSource>();
  const found: string[] = [];
  const scan = (raw: unknown, source: SliceArgSource): void => {
    const name = matchArgPlaceholder(raw);
    if (name === null) return;
    if (!argSource.has(name)) argSource.set(name, source);
    found.push(name);
  };
  if (selector?.byKey !== undefined) scan(selector.byKey, { from: "objectKey" });
  for (const [propKey, raw] of Object.entries(selector?.filter ?? {})) scan(raw, { from: "prop", propKey });
  return {
    requiredArgs: [...new Set(found)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    argSource,
  };
}
