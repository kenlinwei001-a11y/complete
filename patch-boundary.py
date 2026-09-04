import io
p="packages/contracts/src/base-registry.ts"
s=io.open(p,encoding="utf8").read()
a='''export interface BoundaryConsumer {
  /** 派生消费端源文件。 */
  file: string;'''
b='''export interface BoundaryConsumer {
  /**
   * 派生消费端**业务面**（屏上显示的那一栏）。
   * R-UI-4：源码坐标不上屏，屏上给的是「哪个系统的哪一层在用它」——
   * 这一栏与 `binding` 合起来足以让人自己去核对，而不需要知道文件路径。
   */
  surface: string;
  /** 派生消费端源文件（**门/测试用**：boundary-singlesource 据此定位源码核对派生。不上屏。） */
  file: string;'''
assert a in s
s=s.replace(a,b,1)
surf={
 ('apps/datacore/src/synthetic/battery.ts','BASES'):'DataCore · 合成种子',
 ('apps/frontend-shell/src/mocks/fixtures.ts','BASES'):'前端 · mock 固件',
 ('apps/frontend-shell/src/mocks/simSolvers.ts','MOCK_BASES'):'前端 · mock 求解器',
 ('apps/datacore/src/synthetic/battery.ts','SEGMENTS / audit.segMargins'):'DataCore · 合成种子',
 ('apps/datacore/src/solvers/risk.ts','SEG_PRICE'):'DataCore · 求解器 risk',
 ('apps/frontend-shell/src/views/plan/OrderChainView.tsx','ECON / SEG_COLOR'):'前端 · 订单链视图',
 ('apps/frontend-shell/src/mocks/simSolvers.ts','AUDIT_T.segMargins'):'前端 · mock 求解器',
 ('apps/datacore/src/synthetic/battery.ts','planGenerate.targets'):'DataCore · 合成种子',
 ('apps/frontend-shell/src/views/sim/PlanGenerateView.tsx','DEFAULT_GOALS'):'前端 · 方案生成视图',
 ('apps/frontend-shell/src/mocks/fixtures.ts','planGoals'):'前端 · mock 固件',
}
n=0
for (f,bind),sur in surf.items():
    old='{ file: "%s", binding: "%s",' % (f,bind)
    new='{ surface: "%s", file: "%s", binding: "%s",' % (sur,f,bind)
    assert old in s, old
    s=s.replace(old,new,1); n+=1
io.open(p,"w",encoding="utf8").write(s)
print("consumers patched",n)

p2="apps/frontend-shell/src/pages/admin/BoundaryPage.tsx"
s2=io.open(p2,encoding="utf8").read()
a2='<span className="mono">{c.file}</span> · {c.binding}'
b2='<span className="mono">{c.surface}</span> · {c.binding}'
assert a2 in s2
io.open(p2,"w",encoding="utf8").write(s2.replace(a2,b2,1))
print("page ok")
