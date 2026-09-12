import type { ObjectInstance } from "../src/domain.js";
import type { TestApp } from "./helpers.js";

/**
 * WO-69 P2 · S5「实跑比对」的**观测端**：在真跑求解器时记录它**真正读到的对象类型与属性**。
 *
 * 为什么不能靠手写清单：本仓已有多具「文档式声明」的尸体（声明与实现漂移后无人发现，直到线上出错数）。
 * 故 S5 不读代码、不读注释——**真跑一遍**，把观测到的读取面与 `SOLVER_ONTOLOGY_SIGNATURES` 的声明比对。
 *
 * 观测机制（两层，覆盖求解器的两条读路径）：
 *  ① 类型层：拦 `repos.objects.listByType(tenantId, typeKey)` —— 早返回求解器（⑩ 洞：gap_attribution /
 *    concentration_risk / margin_attribution / plan_rootcause…）直接走这条路；`loadContext` 也走这条路。
 *  ② 属性层：把每个返回对象的 `props` 换成 **Proxy**，`get` 陷阱逐次记下真被读到的属性名。
 *    `ownKeys` 陷阱（`{...props}` / `Object.keys` / `JSON.stringify` 等整体枚举）记 `"*"` 哨兵 =
 *    「该类型全部属性都可能被读」→ 声明侧必须省略 propKeys（= 全属性）才算达标。
 *
 * **口径（安全语义，非"碰过就算"）**：列级安全只隐藏**属性**、不隐藏行，故
 *   *只取集合、一个属性都没读* 的类型（如 `deriveExtendedArgs` 顶部无条件 `c.materials.map(o=>o.props)`）
 *   对输出**不可能**产生影响 → 不计入读取面。**读到 ≥1 个属性**才算读取面。
 *   这条口径是 S5 与守卫判定共用的同一把尺子（不许两套）。
 *
 * 诚实边界：本记录器看得见「读了哪个属性」（Proxy get），看不见「读到的值最终有没有进输出」——
 * 它给的是**上界**（可能多记，不会漏记）。多记只会让声明变保守（多拒），不会让守卫误放行。
 */
export interface ReadRecord {
  /** typeKey → 真被读到的属性名集合（`"*"` = 发生过整体枚举）。空集 = 只取了集合、未读任何属性。 */
  types: Map<string, Set<string>>;
  /** 真被读到的链路类型（links.list 结果中出现的 link.type）。 */
  links: Set<string>;
}

const ALL = "*";

export function installReadRecorder(t: TestApp): { rec: ReadRecord; restore: () => void } {
  const rec: ReadRecord = { types: new Map(), links: new Set() };
  const note = (typeKey: string, prop?: string): void => {
    let s = rec.types.get(typeKey);
    if (!s) {
      s = new Set<string>();
      rec.types.set(typeKey, s);
    }
    if (prop !== undefined) s.add(prop);
  };

  // 同一原对象恒返回同一包装（WeakMap 缓存）—— 求解器里有 `cur === s` 这类**同一性比较**，
  // 每次新建包装会悄悄改变行为（观测手段污染被观测对象 = 另一种假绿）。
  const wrapCache = new WeakMap<ObjectInstance, ObjectInstance>();
  const wrapOne = (typeKey: string, o: ObjectInstance): ObjectInstance => {
    const hit = wrapCache.get(o);
    if (hit) return hit;
    const props = new Proxy(o.props as Record<string, unknown>, {
      get(target, p, receiver) {
        if (typeof p === "string") note(typeKey, p);
        return Reflect.get(target, p, receiver);
      },
      ownKeys(target) {
        note(typeKey, ALL);
        return Reflect.ownKeys(target);
      },
    });
    const wrapped = { ...o, props } as ObjectInstance;
    wrapCache.set(o, wrapped);
    return wrapped;
  };

  const objects = t.repos.objects as unknown as {
    listByType: (tenantId: string, type: string) => Promise<ObjectInstance[]>;
  };
  const links = t.repos.links as unknown as {
    list: (tenantId: string, pred?: (l: { type: string }) => boolean) => Promise<{ type: string }[]>;
  };
  const origListByType = objects.listByType.bind(t.repos.objects);
  const origLinkList = links.list.bind(t.repos.links);

  objects.listByType = async (tenantId: string, type: string) => {
    const rows = await origListByType(tenantId, type);
    note(type);
    return rows.map((o) => wrapOne(type, o));
  };
  links.list = async (tenantId: string, pred?: (l: { type: string }) => boolean) => {
    const rows = await origLinkList(tenantId, pred);
    for (const l of rows) rec.links.add(l.type);
    return rows;
  };

  return {
    rec,
    restore: () => {
      objects.listByType = origListByType;
      links.list = origLinkList;
    },
  };
}

/** 观测结果 → 「真读取面」：只保留读到 ≥1 个属性的类型（口径见上）。 */
export function observedReadSurface(rec: ReadRecord): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [typeKey, props] of rec.types) if (props.size > 0) out.set(typeKey, props);
  return out;
}
