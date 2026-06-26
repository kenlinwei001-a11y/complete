# HANDOFF ② · 主题/配色开关（浅色 ↔ 黑曜石 · 施工/评审合同）

> **三 HANDOFF 之二**（①板块对齐=轨M ③可信溯源 ②本份）。独立可交付、用户可感。
>
> **一句话目标**：复刻设计母版的 **light/dark 主题开关**——header 一个开关切浅色/黑曜石,CSS 变量驱动,持久化。**融合优先**:系统已有 `tokens.css`(CSS 变量)+ `applyTheme`(按租户覆盖)基建,**扩它们,与租户覆盖叠加不冲突,不重构 CSS 架构**。
>
> **读这份再动手**：`AUDIT-three-boards-vs-design-master-alignment.md §5`(母版机制 + 系统现状 + 落法 SPEC,已抠到行号)。母版参照:上传的设计 HTML `toggleTheme`(line 5524-5531)。

---

## 0. 先读什么

1. **AUDIT §5**：母版主题机制(行号级)+ 系统 `tokens.css`/`theme.ts` 现状 + 三步落法。
2. **铁律0** `SYSTEM-ONTOLOGY.md`：本份触 **RL5 零业务常数**(语义域色 theme-invariant 是其延伸);若新增主题 token 契约→回写。
3. **增量0 先做**：grep 全仓硬编码十六进制(切不动的根),实拍当前暗色基线,只看不改。
4. `.claude/skills/fde-delivery`：完成=真浏览器切一遍、各页都翻、对比度不破,不是测试绿。

---

## 1.《母版 ↔ 现状 ↔ 设计》（融合优先 · 扩现有 tokens/applyTheme）

| 维度 | 母版机制(行号) | 系统现状(锚点) | 设计(扩) |
|---|---|---|---|
| 切换载体 | CSS 变量切换:`body.light` 翻 chrome 变量(`toggleTheme` line 5525) | `tokens.css:1-31` `:root` 全套 token(**仅暗 `--bg:#0d1117`**) | **扩**:加 `[data-theme="light"]`(或 `body.light`)重定义 chrome 变量组 |
| chrome 变量 | `--bg`#1A2230→#F6F9FD / `--panel`#262F40→#FFFFFF / `--txt`#E9EEF5→#1B2733 / `--accent`#4C90F0→#2D8CF5 + `--ov-rgb`/`--sh-rgb` 浅↔深翻转 | 同名 token 在 `:root` | **扩**:浅色组映射母版浅色值(bg#F6F9FD/panel#FFFFFF/txt#1B2733/accent#2D8CF5) |
| **语义域色** | **theme-invariant**(两主题不变):factory#5E8FE8/product#36BFA5/process/equip/people/quality/capacity/forecast + solver/agent | `tokens.css` `--c-factory…` | **不动**(两主题一致,RL5 延伸) |
| 开关 UI | header checkbox `#themeToggle` + 轨/钮 + 标签(浅色/黑曜石) | 无 | **加**:`ShellLayout` header 加 toggle(复用母版轨/钮样式) |
| 持久化 | `localStorage('aip-theme')`,初始化读回(line 5531) | 无 | **加**:localStorage + 启动读回设 `documentElement.dataset.theme` |
| 与租户覆盖 | —(母版无租户概念) | `workspace/theme.ts:5-20` `applyTheme` 按租户 `setProperty` 覆盖 token(`ShellLayout.tsx:181`) | **叠加**:主题切 chrome、租户覆盖品牌色,**两者不冲突**(主题设 dataset、租户仍 setProperty) |
| 硬编码收口 | ~30 条 `body.light X` 覆盖深底 | ~10-20 处硬编码十六进制(`ProjectSimView.tsx:485-486,956-991`/`DashboardView.tsx:39-44`) | **收口**:改 `var(--…)`(否则浅色切不动) |

---

## 2. 增量（串行 · 每增量一 PR）

- **增量0（零代码·摸基线）**：grep 全仓硬编码十六进制清单(`#[0-9A-Fa-f]{3,6}` 在组件/样式里,排除 tokens.css 定义);实拍当前暗色三板块。存 `docs/evidence/theme-baseline.md`。只看不改。
- **增量1（浅色 token 组）**：`tokens.css` 加 `[data-theme="light"]` 重定义 chrome 变量(bg/bg2/panel/txt/muted/accent/cyan + `--ov-rgb`/`--sh-rgb` 翻转),**语义域色 `--c-*` 不重定义**。映射母版浅色值。
- **增量2（开关 + 持久化）**：`ShellLayout` header 加 toggle(轨/钮/标签);`localStorage('aip-theme')` 持久化;启动读回设 `documentElement.dataset.theme`;**与 `applyTheme` 叠加验**(切租户后主题仍在、切主题后租户品牌色仍在)。
- **增量3（收口硬编码）**：把增量0 清单里 ~10-20 处硬编码十六进制改 `var(--…)`;浅色下逐页核对比度/无白底白字。**这是"切得动"的关键工作量。**

---

## 3. 红线（破一条即打回）

1. **语义域色两主题一致**(theme-invariant):`--c-factory` 等域色不随主题变(RL5 零业务常数延伸——颜色语义=配置)。
2. **不破现租户覆盖**：`applyTheme`(租户品牌色)与主题开关**叠加不冲突**;切租户/切主题互不抹除。
3. **纯前端·可回退**：主题切换不碰后端;默认暗色(现状),开关可回退。
4. **切得动**：硬编码十六进制收口到位——浅色下无残留深底/白底白字(jsdom 测不出,**真浏览器逐页核**)。
5. **FDE**：真浏览器切一遍,三板块 + 弹层 + tab + 按钮各态都翻,实拍浅/暗对比。

---

## 4.《本体引用与影响》

- **不变量**：**RL5 零业务常数**延伸(语义域色 theme-invariant);若新增主题 token 契约(如 `workspace.theme` 扩浅色组)→回写。
- 多为前端样式层,无链路/事件改动;若加 `theme:check` 门(扫硬编码十六进制)→回写 §7。

---

## 5. 评审协议（我怎么验）

- **FDE 真跑**：我亲手起前端 → ① 点 header 开关:全站翻浅色/黑曜石,**实拍三板块 + 弹层 + DAG + 表格各态** ② 浅色下无残留深底/白底白字/对比度破 ③ 刷新后主题持久(localStorage) ④ 切租户后主题仍在、租户品牌色仍生效(叠加不冲突) ⑤ 语义域色两主题一致。
- **两轴**：轴1 对母版浅色值逐变量;轴2 真浏览器逐页是否真翻。
- **判定**：任一红线破/任一页切不动=打回。

---

## 6. 完成判据（FDE · 用户视角）

demo 真跑:header 点开关→**全站浅色/黑曜石瞬切**,三板块/弹层/DAG/表格全部正确翻、对比度可读、语义域色不变;刷新保持;与租户品牌色叠加不冲突。**像母版一样可切、可感。**

---

## 7. 禁止清单

❌ 语义域色随主题变(破 RL5 配色语义) ❌ 抹除/冲突现租户 `applyTheme` 覆盖 ❌ 重构整套 CSS 架构(只扩 tokens + 收口硬编码) ❌ 漏收硬编码十六进制致浅色切不动 ❌ 只 jsdom 不真浏览器核各页 ❌ 测试绿冒充能用。

> 契约生效：从增量0 起逐增量提 PR,我逐 PR 按 §5 评审。有疑义先问,越红线先停。
