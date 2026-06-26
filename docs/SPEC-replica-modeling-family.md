# SPEC · 复刻建模族（1:1 · ModelingPage：数据流DAG + L0-L4认证 + 对象配置）

> 引用 `SPEC-replica-design-system.md`(Shell A 顶导航 + token + 组件库)。本份只描述建模族 3 页(竞品 image2/6/5)的页面专属布局/数据/融合。**视觉1:1 + 接现有后端(轨L provenance/deriveCertification)。平台术语。**
>
> **落点**：`ModelingPage`(`/admin/modeling`,轨L 已真值闭合三栏)→ 升级到竞品像素级。
>
> ⚠️ **后端前置(摸真代码已核·见 `design-system §10`)**：**图查询页(构建器/查询语言/代码生成/Query→Skill/Query→MCP)后端基本不存在,几乎整块新建**;`L4 子项 Schema lint·已持久化` cert 无;`数据流DAG 中间处理层` 需前端从 fieldMappings 合成。真·接现成:L0-L4 五级/三维准备度/绿环/provenance(RawDataset→ObjectType)。凡与 §10③ 冲突的"接现有"注以 §10 为准。

---

## 页1 · 数据流 DAG（竞品 image2 · 段控「架构本体设计」）

**布局(Shell A 三栏)**：左画布(~40%)显**横向分层 ETL DAG** / 中"全局准备度+认证"面板 / 右 Agent。
**左画布 · 数据流 DAG(1:1)**：5 行横向流水线,每行 `事件表(蓝灰) → 数据处理_XX(绿徽 处) → 实体/关系(青/紫徽)`,最右汇聚 `本体库` 节点;节点带左右连接桩、正交折线箭头;节点名超长省略号。
- **接后端(融合·非新建)**：节点链 = `RawDataset → 建模(deriveModeling) → ObjectType` 真链(**轨L 已建 provenance/sourceBindings**,34 类真绑数据集);**复用 `PmDag`/`FdeGraph`**(现成未充分用)。处理节点=建模草案的字段映射步。**禁前端写死节点**。
**中面板(1:1·全接 `deriveCertification` 现成数据)**：① 标题「全局仿真准备度(发布就绪)」+刷新 ② **L0-L4 认证台阶**(组件库)+Schema lint/Trial Tick/已持久化✓ ③ L4 Certified 4✓清单(Trial Tick/Fanout安全/Writeback完整/Observability) ④ L3 认证审计(PASS+时间戳+system,绿提示条+展开历史) ⑤ 大**绿环 100/100**+「可进入推演」+实体/关系/行动/规则/查询计数 ⑥ 准备度三联条(结构/知识/行为+综合)。
**真值判据**：demo 打开 → DAG 显 34 类真数据集→对象链(可溯 sourceBindings)、L0-L4 接真 certification、绿环数字=真 closure。

## 页2 · 发布就绪认证（竞品 image6 · image2 的纯净2栏版）

**= 页1 中面板的高清母版**(取色最准:底`#0a0c12`/卡`#10141c`/绿徽底`#14532d`半透/用户气泡左紫条·Agent左绿条)。**2 栏**(中认证+右Agent),左画布只露节点右缘。
**用途**：作认证面板的像素基准;页1 的中面板按此精修。Agent 气泡左 3px 竖色条 + 半透底 + 圆角~10px + 📌 + 推理▾(组件库)。
**接后端**：同页1 中面板(deriveCertification);**Agent 接 QOS**(补 G-3),非新建。

## 页3 · 对象配置详情（竞品 image5 · 选中实体抽屉）

**布局(三栏)**：左画布(选中节点带4连接桩+高亮) / 中"基础图谱表单+本体构建表" / 右"子图建模+局部准备度"。
**中·基础图谱表单(1:1)**：`对象标签*`输入 / `对象类型*`下拉(Entity) / `实体字段*`下拉 / `实体类型`占位 / `对象描述`多行 / `存储模式`段控(静态图谱|本体图谱)。
**中·本体构建(1:1)**：`查看Schema`紫钮;胶囊tab `属性|类型|函数|行动|派生|安全⌄`;表格列 `名称|属性集|状态/副作用|HITL|功能描述`;`创建行动`钮。
- **接后端(融合)**：表单/表格绑真 `ObjectType`(properties/derivedProperties/行动)——**轨L 已让类型带真属性+6类派生属性**;PATCH 走现有 `patchModelingDraft`(现成)。
**右·局部准备度(1:1)**：`source→proc→modeling`链+`+添加处理步骤`;子图建模卡(打开/删除);**半圆 gauge 75/100 橙弧**(组件库)+架构健康+字段/状态变量/行动计数;三联条(结构100/知识67/行为90+综合86);知识利用率。
- **接后端**：gauge/三联=逐对象 `deriveCertification`(scope=该对象);**逐对象就绪%**(=轨A P1「逐对象就绪%」,在此落)。
**真值判据**：点一个真 ObjectType(如 Order)→表单填真属性/派生、gauge 显真逐对象准备度、改属性走真 PATCH。

---

## 增量（串行 · 接现有不重写）

- **增量0**：起 demo 真跑现 ModelingPage(轨L 态)实拍定基线,标"现有三栏/数据源面板/草案"哪些接着用。
- **增量1 数据流 DAG**：左画布换 `PmDag`/`FdeGraph` 渲染 RawDataset→对象真链(接轨L provenance),去文本映射。
- **增量2 L0-L4 认证面板**：中面板接 `deriveCertification`(L0-L4/三联/绿环/审计),像素对 image6。
- **增量3 对象配置抽屉 + 逐对象 gauge**：点节点出 image5 抽屉,gauge 接逐对象 certification。
- **增量4 Agent 指挥台接 QOS**(补 G-3)+ 主题接轨O。

## 红线
接 `deriveCertification`/`PmDag`/`patchModelingDraft`/轨L provenance,**不新建并行**;认证数字接真 closure 非写死(防假推演);无外部产品名;域色 theme-invariant。**完成=真浏览器像素对竞品 + 数字溯真后端,非测试绿。**

---

## 补遗（查漏审计补入 · 之前漏的元素）

- **中栏 6 子 tab（image1/2/6 整条漏）**：`基本信息(选中) | 图查询 | Skills | MCP服务 | 日志 | 指南` + 右胶囊 `执行节点(选中) | 单链执行 | ‹折叠`。**页1/2/3 中栏都加这条**(建模/评估中栏标准导航)。
- **图查询页（image4③ · 几乎整块漏）**：`图查询` 子 tab 下 = 查询构建器 + 查询代码生成 + 结果表 + `Query→Skill 绑定` + `Query→MCP 暴露`(接 B3/B4,见 design-system §8)。
- **对象配置·行动表细节（image5）**：`状态/副作用` 列 = 双徽叠加 `可用(绿) + 写本体(紫)`;独立 `HITL` 列;本体构建胶囊补 `安全⌄` tab。
- **数据流 DAG 命名（image2）**：中间处理层按 **5 条实体/关系链分别命名**(每实体/关系一条:事件表→数据处理_XX→节点),最右汇 `本体库_XX`;实体/关系节点带 `[模][动]` 双徽。
- **Agent 内容形态（image2）**：持久系统欢迎语(平台名 TeamAgent 类) + `node_id 级建模摘要`(node_ws_*/node_proc_* 带 ✓ 清单)。
- **认证面板精确口径（image2/6）**：L4 四✓文案(L3 Verified/Fanout安全/Writeback完整/Observability达标) + L3 审计(N当前·M历史已修复 + 展开历史失败) + 绿环旁 `可进入推演` + `架构健康 N/N·良好`。
