import { BUSINESS_TYPE_LABEL, BusinessTypeSchema, type BusinessType } from "@platform/contracts";
import { validationError } from "../errors.js";
import { normalizeBaseRef, str } from "./types.js";
import { businessTypeOfOrder } from "./portfolio.js";

/**
 * WO-SANDBOX-E2 · 推演作用域（业务线 / 基地 / 型号 三维）归一 —— **单一出处**。
 *
 * ── 为什么是「扩挂载点」而不是「造机制」（三分法定性 · 铁律 0.5 自查见交付说明）──
 * 业务线维度**早就接了线**：`service.ts` portfolio 分支解析 `args.businessTypes` → `PortfolioInput.businessTypes`
 * → `portfolio.ts` `btFilter` 真在收窄世界重解（收窄 orders/bases/lines/demandSegments）。
 * 病不在"没机制"，在**只挂了 portfolio 一个点**：沙盘链路上真正出订单集的 `affected_orders` /
 * `order_fullchain` / `atp_check` 一个都没吃这一维 → 用户以为筛了储能，拿到的仍是全细分
 * （§8 `G-SEG-ATTR-CROSS-SEGMENT` 那次"储能达成率下钻混入整车厂"就是同一类事故的另一形态）。
 * 故本文件**不新造词表、不新造归一**：
 *   · 业务线枚举 = `BusinessTypeSchema`（`global-sim.ts` 单源 `passenger|commercial|storage`）；
 *   · 中文标签   = `BUSINESS_TYPE_LABEL`（同源·报错文案用它，禁止在本文件写中文业务线字面量）；
 *   · 订单→业务线的判定 = `portfolio.ts` 的 `businessTypeOfOrder`（种子 `Order.businessType` 优先·
 *     缺省按客户名兜底）——与既有 portfolio 挂载点**逐字同口径**，避免"两个地方对同一张单判出两种业务线"；
 *   · base 标识归一 = `types.normalizeBaseRef`（认 `obj_base_<id>` / `<id>` / 中文名 / object ref）。
 *
 * ── 诚实缺席（本文件最要紧的一条）──
 * 「静默返回全集」是最危险的失败形态：用户以为筛了、其实没筛，而且界面上完全看不出来。
 * 所以本归一对**认不出的值一律抛**（`VALIDATION_ERROR`），绝不 filter 掉不认识的值再看剩下几个——
 * 既有 portfolio 挂载点原本正是这个病：`portfolio.ts` `btFilter` 把非法值 filter 光 → `btScoped=false`
 * → **全世界重解**（`businessTypes:["氢能"]` 与不传逐字节同结果）。本单顺手把那个入口也收进本归一。
 *
 * ── `[]` 的口径（归一，不是兜底）──
 * 前端「业务类型勾选」未勾任何一项时**整个字段省掉**（`GlobalSimView.tsx`
 * `...(btArr.length ? { businessTypes: btArr } : {})`），语义 = 全类型。
 * 故本归一把 `[]` **归一为「字段缺省」**（= 未限定/全域），与 S0 冻结的 `ChainScope`
 *「要表达全域就把字段整个省掉」落到同一形态；这是把松散入参映射到规范形态，不是给缺失值编默认值。
 *
 * R6：纯函数，无时钟 / 无随机；输出数组去重后**字典序排序**（同输入字节一致）。
 */

/** 业务线取值集（派生自 `BusinessTypeSchema` 单源·禁止在本仓任何地方另抄一份）。 */
export const CHAIN_SCOPE_BUSINESS_TYPES: readonly BusinessType[] = BusinessTypeSchema.options;

/**
 * 归一后的推演作用域。三个字段**全 optional**，缺省 = 该维未限定（全域）。
 * 与 S0 冻结的 `ChainScope` 同名同义同值域（复数 `businessTypes`，值域 = `BusinessTypeSchema`）。
 * `baseIds` 是 `normalizeBaseRef` **字符串归一后**的裸 base 键（可能是 `baseId` 也可能是中文名），
 * 落到具体数据集的解析走 `resolveScopeBaseIds`（各调用方拿自己那份 Base 表来解）。
 */
export interface ChainScope {
  businessTypes?: BusinessType[];
  baseIds?: string[];
  modelIds?: string[];
}

/** 未限定（全域）判据的唯一实现——别在调用点自己写 `if`。 */
export function isChainScopeUnscoped(scope: ChainScope): boolean {
  return scope.businessTypes === undefined && scope.baseIds === undefined && scope.modelIds === undefined;
}

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort();

/** 数组维通用解析：非数组即抛（不吞成"没传"）；`[]` → 归一为字段缺省。 */
function arrayDim(raw: unknown, field: string): unknown[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw validationError(`推演作用域 ${field} 必须是数组（收到 ${typeof raw}）——单数写法不受支持，请用复数 ${field}`);
  }
  return raw.length === 0 ? undefined : raw;
}

/**
 * 松散 `args` → 规范 `ChainScope`（**唯一入口**·所有吃这三维的求解器都走这里）。
 *
 * 不认识的值一律抛（诚实缺席 > 静默全集）：
 *   · `businessTypes` 含非 `BusinessTypeSchema` 值 → `VALIDATION_ERROR`（附合法值 + 中文标签）；
 *   · `baseIds` / `modelIds` 含空串或非字符串 → `VALIDATION_ERROR`。
 */
export function normalizeChainScope(args: Record<string, unknown>): ChainScope {
  const scope: ChainScope = {};

  const btRaw = arrayDim(args.businessTypes, "businessTypes");
  if (btRaw) {
    const legal = CHAIN_SCOPE_BUSINESS_TYPES.map((t) => `${t}(${BUSINESS_TYPE_LABEL[t]})`).join(" / ");
    const bts: BusinessType[] = [];
    for (const v of btRaw) {
      const parsed = BusinessTypeSchema.safeParse(v);
      if (!parsed.success) {
        throw validationError(
          `推演作用域 businessTypes 含未知业务线 ${JSON.stringify(v)}——合法值：${legal}。` +
            `（拒绝按"认识几个算几个"处理：那样非法值会被 filter 光、作用域退回全域，用户以为筛了其实没筛。）`,
        );
      }
      bts.push(parsed.data);
    }
    scope.businessTypes = sortedUnique(bts) as BusinessType[];
  }

  const baseRaw = arrayDim(args.baseIds, "baseIds");
  if (baseRaw) {
    const keys = baseRaw.map((v) => {
      const k = normalizeBaseRef(v); // 单一出处归一（obj_base_<id> / <id> / 中文名 / object ref）
      if (!k) throw validationError(`推演作用域 baseIds 含空/无法归一的基地引用 ${JSON.stringify(v)}`);
      return k;
    });
    scope.baseIds = sortedUnique(keys);
  }

  const modelRaw = arrayDim(args.modelIds, "modelIds");
  if (modelRaw) {
    const ids = modelRaw.map((v) => {
      const s = str(v).trim();
      if (!s) throw validationError(`推演作用域 modelIds 含空/非字符串的型号 ${JSON.stringify(v)}`);
      return s;
    });
    scope.modelIds = sortedUnique(ids);
  }

  return scope;
}

/**
 * `scope.baseIds`（归一后的裸键）→ 本数据集里的真 `baseId` 集合。
 * 语义与 `risk.resolveBaseId` 逐字一致（按 `baseId | name` 匹配、未知基地**抛**不静默），
 * 差别只在入参形态：那个吃 `SolverContext`，这个吃一组 Base props（service.ts 私有方法侧直接 listByType 拿到的形态）。
 * `scope.baseIds` 未设 → 返回 `null`（= 该维未限定），调用方据此跳过基地过滤。
 */
export function resolveScopeBaseIds(
  scope: ChainScope,
  bases: readonly Record<string, unknown>[],
): Set<string> | null {
  if (!scope.baseIds) return null;
  const out = new Set<string>();
  for (const ref of scope.baseIds) {
    const b = bases.find((x) => str(x.baseId) === ref || str(x.name) === ref);
    if (!b) throw validationError(`推演作用域 baseIds 含未知基地 ${JSON.stringify(ref)}`);
    out.add(str(b.baseId));
  }
  return out;
}

/**
 * 一张订单在不在这次推演里（**效果层判据**·三维全 AND）。
 *
 * `resolvedBaseIds` 必须由调用方经 `resolveScopeBaseIds` 解出来传进来：
 * `scope.baseIds` 有值却没给解析结果时**抛**——不允许"解不出来就当没这一维"，那正是静默全集。
 */
export function orderInChainScope(
  scope: ChainScope,
  orderProps: Record<string, unknown>,
  resolvedBaseIds?: Set<string> | null,
): boolean {
  if (scope.businessTypes && !scope.businessTypes.includes(businessTypeOfOrder(orderProps))) return false;
  if (scope.modelIds && !scope.modelIds.includes(str(orderProps.model))) return false;
  if (scope.baseIds) {
    if (!resolvedBaseIds) {
      throw validationError("推演作用域 baseIds 已限定但调用方未先经 resolveScopeBaseIds 解析——拒绝按未限定处理（静默全集）");
    }
    const bases = Array.isArray(orderProps.bases) ? (orderProps.bases as unknown[]).map((b) => str(b)) : [];
    if (!bases.some((b) => resolvedBaseIds.has(b))) return false;
  }
  return true;
}

/**
 * 回带给下游的作用域（R-ARG-FIDELITY）：base 维换成**解析后的 canonical `baseId`**。
 * 理由：`normalizeChainScope` 只做字符串归一（`normalizeBaseRef` 的既有约定），
 * 故 `["枣庄","zaozhuang"]` 归一后仍是两条；但它们**是同一个基地**，回带两条会让前端以为筛了两个基地。
 * 解析发生在各调用方（各自有自己的 Base 表），所以由调用方在回带时套这一层。
 */
export function echoChainScope(scope: ChainScope, resolvedBaseIds: Set<string> | null): ChainScope {
  return resolvedBaseIds ? { ...scope, baseIds: [...resolvedBaseIds].sort() } : scope;
}

/** 人读作用域描述（诚实报错文案用·未限定维不出现）。 */
export function describeChainScope(scope: ChainScope): string {
  const parts: string[] = [];
  if (scope.businessTypes) parts.push(`业务线=[${scope.businessTypes.map((t) => BUSINESS_TYPE_LABEL[t]).join("、")}]`);
  if (scope.baseIds) parts.push(`基地=[${scope.baseIds.join("、")}]`);
  if (scope.modelIds) parts.push(`型号=[${scope.modelIds.join("、")}]`);
  return parts.length ? parts.join(" ∧ ") : "全域（未限定）";
}
