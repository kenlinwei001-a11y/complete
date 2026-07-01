# REVIEW · GLOBAL-BACK 复验闭环（全局下钻页统一回退 DrillBack·R17·ec0b033）

> 审核方逐条真跑 + C4-C7 真浏览器 DrillBack 两分支实拍（idx>0→navigate(-1)返源；idx==0 直链→fallback 兜底，不走死路）。环境：真 datacore(4001) + 真 vite(5177·非mock·同站 cookie 深链保活)。

## 判决：✅ DONE（进得去也回得来·真浏览器四页四场景实拍·两 idx 分支均真跑）

## 契约 7 条证据
| # | 断言 | 类型 | 证据 | 判 |
|---|---|---|---|---|
| C1 | DrillBack.tsx 存在导出 + frontend typecheck exit0 | gate | `components/DrillBack.tsx` 存在·导出 DrillBack·`frontend-shell typecheck` **0 error** | ✅ |
| C2 | DrillBack 单测:idx>0→navigate(-1)·idx==0→navigate(fallbackTo) 两分支 | unit | `wo-global-back.test.tsx` **6 passed**(两分支断言) | ✅ |
| C3 | frontend test exit0·测试数≥基线·无既有回归 | gate | `frontend-shell test` **309 passed \| 0 failed**(124 文件·含 wo-global-back +6) | ✅ |
| C4 | 全局搜索命中→/o/:type/:key·o360-back count=1·点它 pathname 退回搜索前路径(非 /o/) | browser | **真搜索**"常州"→2 hits→选中→`/o/Base/changzhou`·o360-back **count=1**·**history.idx=1**(真路由)→点 back→**pathname=/(==搜索前源·非 /o/)** navigate(-1) 返源。截图 gb-c4-o360-searchdrill.png | ✅ |
| C5 | 地图 goto-risk→/v/risk?focus·risk-back count=1；直访 /v/risk(无 focus)→count=0 | browser | /v/risk?focus=洛阳 → risk-back **count=1**；/v/risk(无 focus) → risk-back **count=0**(drilledIn 门控) | ✅ |
| C6 | 直链 /o/<type>/<key>(idx==0)→点 o360-back 后 pathname=="/scenarios"(fallbackTo 兜底) | browser | 直链(全页加载·**idx==0**)/o/Base/obj_base_changzhou → o360-back count=1 → 点→**pathname=/scenarios**(fallbackTo·不退出站点) | ✅ |
| C7 | 🕐 历史→/tasks/:id·task-back count=1·点它 pathname 不再 /tasks/·与物理后退一致 | browser | /tasks/:id → task-back **count=1** → 点→**pathname=/(非 /tasks/·不死路)** | ✅ |

## 前端像素级·两分支闭环（R17"回得来"）
- **idx>0(应用内到达)**：C4 真搜索→o360·idx=1→back→navigate(-1)→**返回源页 /**(非兜底)。
- **idx==0(直链/刷新到达)**：C6 直链 o360→back→**/scenarios 兜底**；C7 直链 task→back→**/ 兜底**——**不退出站点、不走死路**（R17 命门）。
- **条件渲染**：C5 risk-back 仅 drilledIn(focus 态)现·非下钻态不现(避免冗余)。
- DrillBack 组件统一(o360-back/risk-back/task-back 同组件·各 fallbackTo)·替换各页手搓回退。

## 本体引用与影响
- 无后端/契约/本体接线变化·纯前端导航组件统一(R17)。不变量:无涉 R2/R6/no-secrets。frontend-only·不触及当前 datacore 红(MULTISRC catalog + DR-AUDIT audit-sink 两已 BLOCKED 单)·GLOBAL-BACK 判据(C1-C7 全前端)独立全过。

---
*审核方 GLOBAL-BACK 复验闭环（DrillBack 两 idx 分支真浏览器四页实拍·进得去回得来不死路·frontend 独立全绿）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
