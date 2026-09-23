/**
 * WO-C0828-P1 §3 · 业务键 → 真对象 id（主键优先）。
 *
 * 从 useOptionAdopt.ts 拆出的纯函数：不依赖 React / 样式链，便于直接钉对照用例
 * （`apps/frontend-shell/test/use-option-adopt-resolve.test.ts`）。
 *
 * 匹配顺序：
 * ① 按该 ObjectType 的主键属性（本体 `isPrimaryKey: true` 的那个 propKey，调用方传入）取值比对。
 *    主键已声明 ⇒ 主键匹配是**权威**：匹配不到就跳过宽松匹配直落命名约定——
 *    宽松匹配会被「另一个对象的某个**非主键**属性值恰好 == 目标业务键」拐错对象。
 * ② 主键取不到（类型未声明 / 类型清单未返回）才回落旧宽松匹配，保住未声明主键类型的既有行为。
 * ③ 最后回退命名约定，但必须验证存在。
 */
import type { fetchAllObjects } from "@/api/endpoints";

export function resolveObjectId(
  objectType: string,
  bizKey: string,
  page: Awaited<ReturnType<typeof fetchAllObjects>>,
  pkProp?: string,
): string | null {
  if (pkProp !== undefined) {
    const byPk = page.items.find((o) => {
      const v = o.props[pkProp];
      return typeof v === "string" && v === bizKey;
    });
    if (byPk) return byPk.id;
  } else {
    const byProp = page.items.find((o) =>
      Object.entries(o.props).some(([, v]) => typeof v === "string" && v === bizKey),
    );
    if (byProp) return byProp.id;
  }
  const guessed = `obj_${objectType.toLowerCase()}_${bizKey}`;
  const byId = page.items.find((o) => o.id === guessed);
  return byId ? byId.id : null;
}
