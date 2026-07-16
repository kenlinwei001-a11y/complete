# 产能推演看板 — 精确复刻 Spec

来源：`docs/reference/capacity-sim-obsidian-target.html`（5540 行，单文件自包含，黑曜石暗色系 + 浅色主题双模式）。
本 spec 只抽**结构 / CSS 精确值 / DOM 模板 / 数据字段名**，不含任何 hashN/riskVal 等生成的假数据值。所有行号均已用 grep 核验（对应源文件当前版本）。

## 0. 范围说明（重要，先读）

任务要求的 12 个锚点中，**多数确实位于「产能推演」视图**（`VIEWS.risk`，函数 `buildRisk()`/`openRiskCard()`，容器 `#riskwrap`），但有两个锚点实际位于同一文件里的**兄弟视图**，是共享同一套视觉语言（`.rk-top/.rk-kpi/.rk-det/.cmp/.tier-chip` 设计系统）的其它面板，如实标注如下，复刻时勿在 `buildRisk()` 源码里找它们：

- **item 7「三情景对比」`.scen-card`** → 实际在「年度情景规划台」视图（`VIEWS.aop`，函数 `buildAOP()`，容器 `#aopwrap`），第 3251–3273 行。
- **item 10「订单全链过程图 DAG」`odNodes`** → 实际在「项目推演·订单全链推演」视图（`VIEWS.order`，函数 `buildOrderView()`，容器 `#orderwrap`），第 3350–3428 行。

另外，item 5 要求的「`.cmp` 比较表结构」在「产能推演」自身的多方案 UI 里**并不存在**——那里的多方案是堆叠的 `.rk-sol` 卡片列表，逐条各带独立"采纳"按钮，不是并排比较表。真正的"多方案并排 `.cmp` 比较表"模式存在于「决策推演 DAG」（`storywrap`，第 5271–5273 行）与「S&OP」（第 5321–5322 行），已按该模式如实记录在 §5，供需要真正比较表时参照。

同样，item 3 要求"CTA 按钮"，但 `.rk-card` 实际**没有独立的 CTA 按钮元素**——整张卡片 `<div>` 本身就是点击目标（`onclick` 在卡片根节点上）。已在 §3 如实标注。

---

## 1. CSS 设计令牌（`:root`，第 11–25 行）

```css
:root{
  --ov-rgb:226,235,245;   /* 叠加面/线条基色（暗色主题用浅色叠加） */
  --sh-rgb:0,0,0;         /* 阴影基色 */
  --bg:#1A2230; --bg2:#1F2939; --panel:#262F40; --panel2:#1D2635;
  --line:rgba(var(--ov-rgb),.09); --line2:rgba(var(--ov-rgb),.16);
  --txt:#E9EEF5; --muted:#9AA8B6;
  --muted2:#67737F;
  --accent:#4C90F0; --cyan:#4C90F0;
  --factory:#5E8FE8; --product:#36BFA5; --process:#DD9551; --equip:#9D8BF0;
  --people:#DD7E9E; --quality:#62BE77; --capacity:#43B7D7; --forecast:#E8B54A;
  --solver:#C470B8; --agent:#5FC2AE;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --cjk:"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",sans-serif;
  --sans:"Inter","Segoe UI",system-ui,var(--cjk);
}
```

**字体加载**（第 7–9 行）：Google Fonts `Inter:wght@400;500;600;700` + `JetBrains+Mono:wght@400;500;600;700`（`preconnect` 到 fonts.googleapis.com / fonts.gstatic.com）。中文走系统字体栈（不联网加载中文字体）。

**排版通用规则**（第 742 行）：`b,.stat b,.rk-k b,.rk-peak,.rk-cur,.scen-big,td,.mx-cell .mx-u{font-variant-numeric:tabular-nums}` — 所有数字类粗体/表格数字用等宽数字特性对齐。

**body 基础**（第 26–36 行）：
```css
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  background:
    radial-gradient(1100px 700px at 78% -10%, rgba(76,144,240,.075), transparent 62%),
    radial-gradient(900px 600px at 4% 108%, rgba(196,112,184,.045), transparent 55%),
    radial-gradient(1400px 900px at 50% 50%, rgba(34,44,60,.55), transparent 100%),
    var(--bg);
  color:var(--txt); font-family:var(--sans); overflow:hidden;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
```
`overflow:hidden` on body — 全页无滚动，各面板自行 `overflow-y:auto`。**无任何 `@media` 响应式断点**（grep 全文件为 0 命中）——固定桌面网格设计，不做移动端适配。

**浅色主题覆盖**（`body.light`，第 818–824 行，仅重定义变量，其余靠 var() 自动适配）：
```css
body.light{
  --ov-rgb:30,48,72;      /* 叠加面/线条改用深色叠加，在浅底上可见 */
  --sh-rgb:40,60,92;      /* 阴影改为柔和蓝灰，避免纯黑过重 */
  --bg:#F6F9FD; --bg2:#F1F6FC; --panel:#FFFFFF; --panel2:#FAFCFE;
  --txt:#1B2733; --muted:#5A6878; --muted2:#8A98A8;
  --accent:#2D8CF5; --cyan:#2D8CF5;
}
```
**重要**：产能推演的风险分级色 `riskColor()`（见 §4）用的是**硬编码 hex**（`#DD7E9E` / `#D2B04C` / `#62BE77`），不是 CSS var，因此明暗主题切换时风险色不变——只有背景/文字/面板色跟随主题切换。

**"黑曜石精修层"玻璃悬浮层统一规则**（第 759–764 行，产能推演悬浮层直接继承）：
```css
.mode-card,.mc-restore,.learn-panel,.basepop,.rk-tip,.rk-pop,.rule-pop{
  border-color:rgba(var(--ov-rgb),.12);
  box-shadow:inset 0 1px 0 rgba(var(--ov-rgb),.08),0 24px 60px rgba(var(--sh-rgb),.55)}
.rk-tip,.rk-pop,.rule-pop{background:linear-gradient(165deg,rgba(48,60,79,.92),rgba(32,41,56,.9));backdrop-filter:blur(20px) saturate(150%)}
```
浅色主题覆盖（第 861–862 行）：`body.light .rk-tip,body.light .rk-pop,body.light .rule-pop{background:linear-gradient(165deg,#FFFFFF,#F1F5FA)}`（去掉 backdrop-filter 模糊玻璃感，改纯浅色不透明渐变）。

---

## 2. KPI 条（`.rk-kpi`，第 152–156 行 + DOM 第 2444–2451 行）

> 注：本节对应"产能推演"面板自身顶部的 KPI 条（位于标题/切换 tab 之下、风险卡网格之上）。全局页面顶部 header 的 `.stat-strip` 见 §11。

### CSS

```css
.rk-kpi{display:flex;gap:12px;align-items:center;margin:14px 0 16px;flex-wrap:wrap}
.rk-k{border:1px solid var(--line2);border-radius:10px;padding:9px 16px;background:rgba(var(--ov-rgb),.025);display:flex;flex-direction:column;gap:2px}
.rk-k b{font-size:19px;font-family:var(--mono)}
.rk-k span{font-size:9.5px;color:var(--muted2)}
.rk-health{font-size:10.5px;color:var(--forecast);border:1px solid rgba(232,181,74,.4);border-radius:8px;padding:8px 12px;background:rgba(232,181,74,.08);max-width:330px;line-height:1.5}
```

容器 `display:flex`（非 grid），5 张 KPI 卡 + 1 个条件性健康度提示条，同层横排，超宽自动换行（`flex-wrap:wrap`）。每卡内部 `flex-direction:column`，数值在上（19px 等宽字体）、标签在下（9.5px）。

### DOM 模板

```html
<div class="rk-kpi">
  <div class="rk-k"><b style="color:#DD7E9E">{riskBaseCount}</b><span>风险基地</span></div>
  <div class="rk-k"><b style="color:#C470B8">{riskFactorPointCount}</b><span>风险因素点</span></div>
  <div class="rk-k"><b style="color:var(--forecast)">{affectedOrderCount}</b><span>受影响订单(批)</span></div>
  <div class="rk-k"><b style="color:var(--capacity)">{affectedCustomerCount}</b><span>涉及客户</span></div>
  <div class="rk-k"><b style="color:var(--solver)">T+{earliestCrossDay} · {earliestCrossDate}</b><span>最早越线日</span></div>
  <!-- 条件渲染：仅当数据健康度降级时出现（非卡片，与 .rk-k 同级 flex item） -->
  <div class="rk-health">{healthDegradeNote}</div>
</div>
```

### 数据字段名（5 张卡 + 1 条件横幅）

| 位置 | 字段来源 | 含义 | 颜色 |
|---|---|---|---|
| 卡1 | `riskCards.length` | 风险基地数（去重基地计数） | 硬编码 `#DD7E9E` |
| 卡2 | `fpts`（各卡 `fs` 数组长度求和） | 风险因素点总数（一基地可多个因素） | 硬编码 `#C470B8` |
| 卡3 | `allOrd.size`（Set 去重） | 受影响订单批次数 | `var(--forecast)` |
| 卡4 | `allCust.size`（Set 去重） | 涉及客户数 | `var(--capacity)` |
| 卡5 | `minCross`/`dateOf(minCross)` | 全部风险卡中最早的越线相对日(T+N)与日历日期 | `var(--solver)` |
| 横幅 | `healthP90().note` | 数据健康度降级说明（如 IoT 延迟→P90 置信系数下调），无降级时字符串为空、不渲染 | `var(--forecast)` |

标题行/子标题/tab 切换（同属顶部区，紧邻 KPI 条上方，DOM 第 2436–2443 行）：

```html
<div class="rk-top">
  <div>
    <h3>产能推演</h3>
    <div class="rk-sub">{说明文案：监测执行偏离月度计划的风险 · 未来 H 天预测越线 · 今天日期 · 偏离路径}</div>
  </div>
  <div class="rk-hsel">
    <span class="tier-chip{on if riskTab==='risk'}">瓶颈视角</span>
    <span class="tier-chip{on if riskTab==='order'}">订单聚合</span>
    <span style="width:10px"></span>
    <!-- 30/60/90 天窗口切换，见 §12 -->
    <span class="tier-chip{on if H===30}">30天</span>
    <span class="tier-chip{on if H===60}">60天</span>
    <span class="tier-chip{on if H===90}">90天</span>
  </div>
</div>
```

`.rk-top`/`.rk-sub`/`.rk-hsel` CSS（第 148–151 行）：
```css
.rk-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
.rk-top h3{font-size:19px;margin:0 0 4px}
.rk-sub{font-size:11px;color:var(--muted)}
.rk-hsel{display:flex;gap:6px}
```

`.tier-chip` CSS（第 490–494 行，全站通用的"药丸开关"控件，等宽字体）：
```css
.tier-chip{font-size:11px;padding:6px 11px;border-radius:8px;border:1px solid var(--line2);
  color:var(--muted);cursor:pointer;transition:.13s;font-family:var(--mono)}
.tier-chip:hover{border-color:var(--capacity)}
.tier-chip.on{background:rgba(76,144,240,.16);border-color:var(--capacity);color:var(--txt)}
```

外层容器 `.riskwrap`（`#riskwrap`，覆盖整个 `<main>`，第 146–147 行）：
```css
.riskwrap{position:absolute;inset:0;display:none;overflow-y:auto;padding:22px 26px;
  background:radial-gradient(1200px 700px at 70% -10%,rgba(221,126,158,.06),transparent 60%)}
.riskwrap.show{display:block}
```
**层叠细节**：`.riskwrap` 自身**没有不透明底色**——只是一层玫瑰色调半透明径向渐变叠加在 `<body>` 的渐变/`var(--bg)` 之上（`<main>{position:relative;overflow:hidden}` 无自身背景），因此明暗主题切换时该面板背景通过 `var(--bg)` 自然联动，玫瑰色叠加层本身色值不随主题变化。

---

## 3. 基地风险卡网格（`.rk-grid`/`.rk-card`，CSS 第 157–169 行，DOM 第 2453–2461 行）

### CSS

```css
.rk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:12px}
.rk-card{border:1px solid var(--line2);border-radius:11px;padding:12px 14px;background:rgba(var(--ov-rgb),.03);cursor:pointer;transition:transform .15s}
.rk-card:hover{transform:translateY(-2px);background:rgba(var(--ov-rgb),.05)}
.rk-card.open{outline:2px solid rgba(221,126,158,.55)}
.rk-c-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.rk-c-h b{font-size:13px}
.rk-c-m{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}
.rk-peak{font-size:21px;font-family:var(--mono);font-weight:700}  /* 实际渲染时被行内 style 覆盖为 17px，见下 */
.rk-unit{font-size:9px;color:var(--muted2)}
.rk-c-f{display:flex;justify-content:space-between;font-size:9.5px;color:var(--muted);margin-top:5px}
.rk-own{font-size:9px;color:var(--muted2)}
.rk-chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 2px}
.rk-fchip{display:inline-block;font-size:9px;padding:2px 7px;border-radius:6px;border:1px solid;background:rgba(var(--ov-rgb),.02);white-space:nowrap}
```

**死 CSS（已定义但当前 DOM 模板未使用，复刻时不必强求还原其效果，仅供参考）**：`.rk-fac`（10.5px/700，第 163 行）、`.rk-cur`（15px 等宽灰色，第 165 行）、`.rk-arrow`（第 166 行）——这些是卡片早期版本遗留的类名，当前 `openRiskCard`/卡片模板中未出现对应 `class` 使用。

网格：`auto-fill` + `minmax(228px,1fr)` — 卡片宽度自适应容器宽度做等宽多列填充，最小 228px，无固定列数，纯响应式流式布局（不是 media query 断点，是 grid 自身特性）。

### DOM 模板（每张卡）

```html
<div class="rk-grid">
  <div class="rk-card{ open 附加 'open' }" id="rkc{index}"
       onclick="openRiskCard({index})"
       style="border-color:{riskColor(peak)}55">  <!-- 边框色随峰值风险色，55=约33%透明度 hex 后缀 -->
    <div class="rk-c-h">
      <b>{baseName（去掉'·总部'后缀）}</b>
      <span class="rk-own">{ownerName（去掉'基地负责人 · '前缀）}</span>
    </div>
    <div class="rk-c-m">
      <span class="rk-peak" style="color:{riskColor(peak)};font-size:17px">T+{crossDay}</span>
      <span class="rk-unit" style="font-size:11px;color:#DD7E9E">{crossDate} 最早越线</span>
    </div>
    <div class="rk-chips">
      <!-- 每个风险因素一个小 chip，遍历该基地全部风险因素（不止主因素） -->
      <span class="rk-fchip" style="border-color:{riskColor(factorPeak)}66;color:{riskColor(factorPeak)}">
        {factorDisplayName} T+{factorCrossDay}
      </span>
      <!-- ... repeat per factor in fs[] -->
    </div>
    <div class="rk-c-f">
      <span style="color:#DD7E9E">{factorCount} 个风险因素</span>
      <span>{orderCount} 批订单受影响</span>
    </div>
  </div>
  <!-- ... repeat per card -->
</div>
<div id="rkDetail"></div>  <!-- 点击卡片后展开详情，见下方 -->
<!-- 之后紧跟处置计划表 planTableHTML(...)，见 §8 -->
```

**关于"CTA 按钮"的如实澄清**：任务锚点描述期望卡内有"CTA 按钮"，但实际 DOM 里**没有**独立按钮元素——`onclick="openRiskCard(i)"` 直接挂在卡片根 `<div>` 上，整卡都是点击区（`cursor:pointer` 来自 `.rk-card`）。真正的按钮（`.fc-go` "采纳→工单"）出现在点开卡片后的方案列表里，见 §5。

### 数据字段名（每张卡，源对象 `riskCards[i]`）

| 字段 | 含义 |
|---|---|
| `b` | 基地名（原始，未去后缀） |
| `owner` | 基地负责人（原始，未去前缀） |
| `fs[]` | 该基地全部风险因素数组，每项 `{f(因素代码), cur(当前值), peak(窗口内峰值), cross(越线相对日)}` |
| `f`/`cur`/`peak`/`cross` | 卡片级"首要风险因素"字段（`fs` 中最早越线的一项，用于卡片主展示区） |
| `orders` | 受影响订单去重计数 |

因素代码 → 展示名映射表（`FACTOR_OBJ`，第 1721 行，7 个固定枚举）：

```
瓶颈工序 → 产线负载率
设备OEE  → 设备OEE
人力工时 → 人力工时供给
物料齐套 → 物料供给齐套
物流时长 → 物流在途时效
换型损失 → 换型占用
良率波动 → 良率稳定性
```

### 点开卡片后的详情容器（`#rkDetail`，`openRiskCard()`，第 2570–2580 行）

```html
<div class="rk-det">
  <div class="rk-det-h">
    <b>{baseName} · 产能影响对象全景</b>
    <span>{owner} · 未来 {H} 天（{startDate} ~ {endDate}）· 悬停任意点看当日影响</span>
  </div>
  <div class="rk-tl">{dateAxis}{factorRows}</div>   <!-- 见 §4 -->
  <div class="rk-leg">
    <span><i style="background:#62BE77"></i>&lt;70 正常</span>
    <span><i style="background:#D2B04C"></i>70-84 关注</span>
    <span><i style="background:#DD7E9E"></i>≥85 瓶颈</span>
    <span style="margin-left:14px;color:var(--muted2)">首要风险对象：{topFactorName}（{crossDate} 越线）</span>
  </div>
  <div class="rk-two">          <!-- 见 §5 与 §9 -->
    <div><div class="wf-t" style="color:var(--quality)">💡 对症方案 · {factorName}（{n} 个）</div>{solutionCards}</div>
    <div>
      <div class="wf-t" style="color:var(--capacity)">💬 人机对话</div>
      <div class="qa-chips">{qaChips}</div>
      <div class="rk-ans" id="rkAns">点击问题，或在下方输入追问。</div>
      <div class="rk-ask"><input id="rkInput" placeholder="输入追问，如：影响哪些客户？"><button>问</button></div>
      {审计留痕组件（.au，复用，见下）}
    </div>
  </div>
</div>
```

`.rk-det`/`.rk-det-h`/`.rk-tl`/`.rk-two` CSS（第 170–183 行）：
```css
.rk-det{margin-top:18px;border:1px solid var(--line2);border-radius:12px;padding:15px 17px;background:rgba(var(--ov-rgb),.025)}
.rk-det-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.rk-det-h b{font-size:14.5px}
.rk-det-h span{font-size:10px;color:var(--muted2)}
.rk-tl{position:relative;padding:6px 0 2px}
.rk-leg{display:flex;gap:12px;font-size:9.5px;color:var(--muted);margin:8px 0 12px;align-items:center}
.rk-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.rk-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
```

行为：点开卡片时，`document.querySelectorAll('.rk-card').forEach((e,k)=>e.classList.toggle('open',k===i))` — 同时只有一张卡处于 `.open`（互斥高亮），详情渲染完毕后 `rkDetail.scrollIntoView({behavior:'smooth',block:'start'})` 平滑滚动到详情区。

侧边嵌入的审计日志组件（`.au`，第 136–143 行 CSS，`auditHTML()`/`auditRows()` 第 3069–3070 行生成）：
```css
.au{margin-top:10px;border:1px solid rgba(98,190,119,.3);border-radius:9px;padding:10px 12px;background:rgba(98,190,119,.05)}
.au .wf-t{color:var(--quality)}
.au-row{font-size:10px;color:var(--muted);padding:5px 0;border-bottom:1px dashed var(--line);line-height:1.55}
.au-row:last-child{border-bottom:none}
.au-row b{color:var(--txt);margin:0 4px}
.au-t{font-family:var(--mono);color:var(--muted2);margin-right:4px}
.au-d{color:var(--cyan,#43B7D7);margin-left:4px}
.au-s{display:block;color:var(--forecast)}
```
仅当审计条目非空时 `display:block`，否则整块隐藏；条目字段：`{t(时间戳), user, act(动作), detail, status}`。

---

## 4. 逐因素时间轴（`.rk-frow`/`.rk-dots`，CSS 第 174–213 行，DOM 第 2540–2551 行）

### CSS

```css
.rk-dots{display:flex;gap:4px;flex-wrap:nowrap}
.rk-dot{width:14px;height:14px;border-radius:50%;cursor:pointer;flex:1;min-width:8px;max-width:18px;transition:transform .1s}
.rk-dot:hover{transform:scale(1.45)}
.rk-frow{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.rk-flab{width:168px;flex:none;display:flex;flex-direction:column;gap:1px}
.rk-flab b{font-size:10.5px}
.rk-flab span{font-size:8.5px;color:var(--muted2);font-family:var(--mono)}
.rk-frow .rk-dots{flex:1}
.rk-ticks{display:flex;gap:4px;margin:0 0 4px 178px}
.rk-tick{flex:1;min-width:8px;max-width:18px;font-size:8px;color:var(--muted2);font-family:var(--mono);
  white-space:nowrap;overflow:visible;transform:translateX(-2px)}
```

**几何对齐关键值**：`.rk-flab` 固定宽 168px + `.rk-frow` 的 `gap:10px` = 178px，这正是 `.rk-ticks` 的 `margin-left:178px` 取值——日期刻度行必须与下方各因素行的圆点起始列严格对齐，168+10=178 是复刻时必须保持的精确关系，不能只抄字面值而破坏比例。

### DOM 模板

日期刻度行（`dateAxis(H)`，第 2540–2544 行）：
```html
<div class="rk-ticks">
  <!-- 每天一个 span，d=1..H；只有 d===1 或 d%5===0 或 d===H 时才有文字，其余为空 span（占位保持对齐，不可省略！） -->
  <span class="rk-tick">{show ? dateOf(d) : ''}</span>
  <!-- ... repeat H times -->
</div>
```

单因素行（`factorRow(base, factor, H)`，第 2545–2551 行）：
```html
<div class="rk-frow">
  <div class="rk-flab">
    <b style="color:{riskColor(peak)}">{factorDisplayName}</b>
    <span>{cur}→{peak} · {cross ? ('T+'+cross+' '+dateOf(cross)) : '窗口内不越线'}</span>
  </div>
  <div class="rk-dots">
    <!-- 每天一个圆点，d=1..H -->
    <span class="rk-dot" style="background:{riskColor(riskVal(base,factor,d,H))}"
          onmouseenter="showDayTip(base,factor,d,event)" onmouseleave="hideDayTip()"></span>
    <!-- ... repeat H times -->
  </div>
</div>
<!-- 详情面板里先渲染该基地"真正命中风险"的因素行，再补全 BN_FACTORS 里其余未命中但仍相关的因素行，凑成产能影响对象全景 -->
```

整体时间轴容器：`<div class="rk-tl">{dateAxis(H)}{factorRow × N}</div>`（`.rk-tl` CSS 见 §3）。

### 逐日圆点颜色档位规则（`riskColor()`，第 1720 行，**只要规则不要值**）

```
v >= 85        → #DD7E9E（红/粉，"瓶颈"）
70 <= v < 85   → #D2B04C（黄，"关注"）
v < 70         → #62BE77（绿，"正常"）
```
三档色阶是**硬编码 hex**，非 CSS 变量，不随明暗主题变化（见 §1）。图例文案固定为 `<70 正常 / 70-84 关注 / ≥85 瓶颈`（第 2573 行）。

### Hover Tip 触发（`.rk-tip`，详见 §9）

`onmouseenter="showDayTip(base,factor,day,event)"` → 显示当日紧张度数值 + 驱动事件 + 受影响订单表（悬停即显，`mouseleave` 触发 `hideDayTip()` 隐藏，**无 pin/点击锁定机制**，与 §9 的 `.rk-pop` 不同）。

---

## 5. 多方案（`.rk-sol`，CSS 第 184–187 行，DOM 第 2560–2562 行）+ 比较表模式（`.cmp`）

### 5a. 实际形态：堆叠方案卡（产能推演风险详情内）

```css
.rk-sol{border:1px solid var(--line2);border-radius:9px;padding:9px 11px;margin-bottom:8px;background:rgba(98,190,119,.04)}
.rk-sol-h{display:flex;justify-content:space-between;align-items:center;gap:8px}
.rk-sol-h b{font-size:11px}
.rk-sol-m{font-size:9.5px;color:var(--muted);margin-top:4px}
```

```html
<!-- 按因素对症的方案库，固定 3 个/因素，从上到下堆叠，非并排比较表 -->
<div class="rk-sol">
  <div class="rk-sol-h">
    <b>{index+1}. {solutionName}</b>
    <button class="fc-go" style="margin:0;padding:3px 10px" onclick="adoptRiskSol(cardIndex, solIndex)">采纳→工单</button>
  </div>
  <div class="rk-sol-m">{effectDesc} · {timingDesc} · 投入:{costLevel} · 风险:{riskNote}</div>
</div>
<!-- ... repeat 3× -->
```

`.fc-go` 按钮 CSS（第 710–711 行）：
```css
.fc-go{display:block;margin-top:8px;padding:6px 12px;border-radius:7px;border:1px solid rgba(196,112,184,.5);
  background:rgba(196,112,184,.14);color:var(--solver);font-size:11.5px;font-weight:600;cursor:pointer;font-family:var(--cjk)}
.fc-go:hover{background:rgba(196,112,184,.24)}
```
（在 `.rk-sol-h` 内联覆盖 `margin:0;padding:3px 10px`，比默认 `.fc-go` 更紧凑）。

方案数据字段（`RISK_SOL[factorCode]`，每因素固定 3 项数组）：`n`(方案名) / `eff`(消解效果) / `t`(起效时间点) / `cost`(投入档位) / `risk`(风险提示)。

标题行：`<div class="wf-t">💡 对症方案 · {factorName}（{count} 个）</div>`，`.wf-t` CSS（第 129 行）：`font-size:11px;font-weight:700;color:var(--solver);margin-bottom:8px`。

### 5b. 真正的"并排比较表"模式（供参考，来自兄弟视图 `storywrap`/`sopwrap`，第 5271–5273、5321–5322 行）

若目标看板需要"多方案并排比较"（而非堆叠列表），应参照此模式，而非 5a：

```html
<div class="crow" style="margin-top:11px"><span class="cl">📋 多方案比对 · 对症瓶颈</span></div>
<table class="cmp">
  <thead><tr><th>方案</th><th>针对瓶颈</th><th>新增产能</th><th>6周缺口</th><th>投入</th><th>交期</th><th>风险</th></tr></thead>
  <tbody>
    <tr><td><b>{n}</b></td><td style="color:var(--solver)">{bn}</td><td>{cap}</td><td>{gap}</td><td>{cost}</td><td>{due}</td><td>{risk}</td></tr>
    <!-- ... repeat per scheme -->
  </tbody>
</table>
```
行字段：`n`(方案名)/`bn`(针对瓶颈，若无则显示"—")/`cap`(新增产能)/`gap`(窗口缺口变化)/`cost`(投入)/`due`(交期可达性)/`risk`(风险)。

### `.cmp` 表格基础样式（第 478–481 行，全站表格通用）

```css
.cmp{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:3px}
.cmp th,.cmp td{padding:5px 7px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
.cmp th{font-family:var(--mono);font-size:9px;color:var(--muted);text-transform:none}
.cmp td b{color:var(--forecast)}
```
表头等宽字体、小号、灰色、不转大写；单元格内 `<b>` 默认取橙金色（`--forecast`）强调数值；`white-space:nowrap` 意味着表格靠内容撑开、超宽需要外部容器自行处理横向滚动（该 HTML 本身未对 `.cmp` 包一层 `overflow-x` 容器，宽表在小屏会被截断/挤压父容器）。

---

## 6. 受影响订单经营表（econTable + 明细表，CSS 见上，DOM 第 2477–2537 行）

> 位置：产能推演面板「订单聚合」tab 下（`riskTab==='order'`，函数 `buildOrderAgg()`），非默认「瓶颈视角」tab。

### 6a. 经营数据聚合表（`econTable(rows)`，第 2477–2505 行）

```html
<div class="rk-det" style="margin-top:4px">
  <div class="rk-det-h">
    <b>受影响订单 · 经营数据看板</b>
    <span>这些订单牵动的产能与库存·财务（{按整车/储能应用 或 按基地}分类）· 金额单位 亿元</span>
  </div>
  <div class="rk-segsel">分类维度：
    <span class="tier-chip{on if mode==='app'}">乘用车 / 商用车 / 储能</span>
    <span class="tier-chip{on if mode==='base'}">按基地</span>
  </div>
  <table class="cmp">
    <thead><tr>
      <th>{'应用分类' or '基地'}</th><th>受影响产能(万套)</th><th>成品库存</th><th>半成品库存</th>
      <th>原材料库存</th><th>未结订单金额</th><th>毛利额</th><th>毛利率</th>
    </tr></thead>
    <tbody>
      <tr>
        <td><div class="ob"><span class="td-dot" style="background:{segOrBaseColor}"></span><b>{segOrBaseName}</b></div></td>
        <td>{capacity}</td><td>{fg库存}</td><td>{wip库存}</td><td>{rm库存}</td>
        <td style="color:var(--forecast);font-weight:700">{未结订单金额}</td>
        <td style="color:var(--quality);font-weight:700">{毛利额}</td>
        <td>{毛利率}%</td>
      </tr>
      <!-- ... repeat per group -->
      <tr style="border-top:1px solid var(--line2)"><td><b>合计</b></td>...</tr>  <!-- 汇总行，加粗+顶部分隔线 -->
    </tbody>
  </table>
  <div class="dl-hint" style="margin-top:8px">{口径说明文案}</div>
</div>
```

分组维度切换（`.rk-segsel`，第 216 行 CSS：`font-size:11px;color:var(--muted);margin:4px 0 12px;display:flex;align-items:center;gap:7px`）：`setOrderSeg('app'|'base')` — app=按应用细分（乘用车/商用车/储能，固定顺序），base=按基地（按销售额降序排列）。

`td .ob`/`.td-dot`（第 727 行）：`td .ob{display:flex;align-items:center;gap:7px}.td-dot{width:8px;height:8px;border-radius:2px;flex:none}` — 行首色点 + 加粗名称的复合单元格模式。

字段来源（每行一个分组，`groups[key]`，`emptyAgg()`/`addAgg()` 累加得到）：`cap`(受影响产能) / `fg`(成品库存) / `wip`(半成品库存) / `rm`(原材料库存) / `sales`(未结订单金额) / `gp`(毛利额)，毛利率现算 `gp/sales*100`。

### 6b. 订单明细表（`buildOrderAgg` 内，第 2529–2537 行）

```html
<div class="rk-basesel">基地筛选：
  <select onchange="setOrderBase(this.value)">
    <option value="__all__">全部风险基地（{count}）</option>
    <option value="{baseId}">{baseName}</option>
    <!-- ... -->
  </select>
  <!-- 已筛选时出现清除 chip -->
  <span class="rk-fchip" style="border-color:var(--capacity)66;color:var(--capacity);cursor:pointer">✕ 清除（当前：{baseName}）</span>
</div>

<div class="rk-det" style="margin-top:14px">
  <div class="rk-det-h"><b>受影响订单 · 明细（{scope}）</b><span>{count} 批 · 合计 {qty} 万套 · {custCount} 家客户 · 按交期排序</span></div>
  <table class="cmp">
    <thead><tr>
      <th>订单</th><th>客户</th><th>应用</th><th>型号</th><th>数量</th><th>交期</th>
      <th>关联风险点（基地·对象·越线日）</th><th>延误</th>
    </tr></thead>
    <tbody>
      <tr>
        <td><b>{so}</b></td><td>{cust}</td>
        <td><span class="rk-fchip" style="border-color:{segColor}66;color:{segColor}">{segName}</span></td>
        <td>{model}</td><td>{qty} 万套</td><td><b>{due（月-日）}</b></td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:3px;max-width:480px">
            <!-- 每个关联风险点一个可悬停 chip，见 §9 -->
            <span class="rk-fchip rk-fchip-i" style="border-color:{riskColor(peak)}66;color:{riskColor(peak)}"
                  onmouseenter="showRiskPop(base,factor,cross,event)" onmouseleave="scheduleHideRiskPop()">
              {baseNameShort}·{factorName} {crossDate}
            </span>
            <!-- 超过 4 个时显示 +N -->
            <span class="rk-fchip" style="border-color:var(--line2);color:var(--muted2)">+{more}</span>
          </div>
        </td>
        <td style="color:#DD7E9E;font-weight:700">{delayDays} 天</td>
      </tr>
    </tbody>
  </table>
  <div class="dl-hint" style="margin-top:9px">{聚合口径说明}</div>
</div>
```

`.rk-basesel`/`.rk-fchip-i`（第 217–222 行）：
```css
.rk-basesel{font-size:12px;color:var(--muted);margin:2px 0 14px;display:flex;align-items:center;gap:9px}
.rk-basesel select{background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--txt);
  padding:6px 12px;font-size:12px;font-family:var(--cjk);cursor:pointer;min-width:170px}
.rk-basesel select:focus{outline:none;border-color:var(--capacity)}
.rk-fchip-i{cursor:pointer;transition:transform .1s}
.rk-fchip-i:hover{transform:translateY(-1px);filter:brightness(1.08)}
```

`.dl-hint`（第 599 行）：`font-size:10.5px;color:var(--muted2);line-height:1.5;margin-top:7px` — 全站通用的"口径说明"小字脚注样式。

---

## 7. 三情景对比（`.scen-card`，CSS 第 261–269 行，DOM 第 3251–3272 行，源自 `buildAOP()`）

### CSS

```css
.scen-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.scen-card{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(var(--sh-rgb),.06)}
.scen-card.pick{outline:2px solid rgba(84,181,196,.45);outline-offset:-2px}
.scen-h{display:flex;justify-content:space-between;align-items:center;font-size:14px}
.scen-big{font-size:24px;font-weight:800;margin:7px 0 2px}
.scen-big small{font-size:11px;font-weight:400;color:var(--muted2)}
.scen-note{font-size:10.5px;color:var(--muted);margin-bottom:9px}
.scen-row{font-size:10.5px;line-height:1.55;padding:5px 0;border-top:1px dashed var(--line)}
.scen-row span{display:block;font-size:9px;color:var(--muted2);font-weight:700;margin-bottom:1px}
```

`.scen-grid` 固定 3 列（`repeat(3,1fr)`，非 auto-fill）——三情景严格并排，不随容器宽度变化列数。

### DOM 模板（每张情景卡）

```html
<div class="scen-card{ pick 附加 'pick' }" style="border-top:3px solid {accentColor}">
  <div class="scen-h">
    <b style="color:{accentColor}">{scenarioName}</b>
    <!-- 仅当前拍板情景显示徽标 -->
    <span class="rk-fchip" style="border-color:#54B5C466;color:#54B5C4">已拍板 AOP</span>
  </div>
  <div class="scen-big">{annualDemand} <small>万套/年</small></div>
  <div class="scen-note">{oneLinerNote}</div>
  <div class="scen-row"><span>产能决策</span>{capacityDecisionText}</div>
  <div class="scen-row"><span>长协锁量</span>{ltaLockText}</div>
  <div class="scen-row"><span>财务测算</span>收入 {revenue} 亿 · CAPEX {capex} 亿{irr ? ' · IRR '+irr : ''}</div>
  <div class="scen-row"><span>规则校验</span>{ruleCheckText，内含 linkRules() 生成的规则悬浮链接}</div>
</div>
<!-- ... × 3 情景 -->
```

`.scen-row` 用 `border-top` 分隔（非 `border-bottom`）——每行"小标签(span, 9px灰) + 内容(10.5px)"垂直堆叠的两行式标签结构，4 个 `.scen-row` 依次为：产能决策 / 长协锁量 / 财务测算 / 规则校验。

### 数据字段名（`AOP_SCEN[]` 每项）

`n`(情景名) / `c`(强调色 hex) / `dem`(年需求量) / `note`(一句话概述) / `cap`(产能决策描述) / `lta`(长协锁量描述) / `rev`(收入) / `capex`(资本开支) / `irr`(内部收益率，可为"—"表示不适用) / `c18`/`c23`(对应规则校验结论文案) / `pick`(布尔，是否当前拍板选中)。

同一视图内还有两张关联表（同属 `buildAOP()`，第 3261–3272 行，结构与 §5b／§8 一致，此处只列字段）：
- **情景触发条件表**（`.cmp`）：列 = 触发条件 / 升级动作 / 监测状态；行字段 `cond`/`act`/`state`。
- **目标分解流**（`.dec-flow`/`.dec-q`，非表格，链式卡片）：`<div class="dec-q"><b>{季度}</b><span>{数值} 万套</span><div class="dec-m">{逐月小标签}</div></div>`，卡片间用 `<span class="dec-arrow">→</span>` 连接。CSS 第 270–276 行：
```css
.dec-flow{display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap}
.dec-q{border:1px solid var(--line2);border-radius:9px;padding:8px 12px;background:var(--panel2);font-size:11px;min-width:96px}
.dec-q b{display:block;font-size:10px;color:var(--muted)}
.dec-q>span{font-weight:800;font-size:13px;color:#B07FD8}
.dec-m{margin-top:5px;display:flex;gap:4px}
.dec-m i{font-style:normal;font-size:8.5px;background:rgba(var(--ov-rgb),.08);border:1px solid var(--line2);border-radius:5px;padding:2px 5px;color:var(--txt)}
.dec-arrow{align-self:center;color:var(--muted2);font-size:13px}
```

---

## 8. 处置计划表（`planTableHTML()`，函数定义第 3490–3496 行，风险场景调用点第 2461 行）

### DOM 模板

```html
<div class="rk-det" style="margin-top:14px">
  <div class="rk-det-h">
    <b>📋 {title}</b>
    <span>{sub}　<span class="tier-chip" style="display:inline-block" onclick="exportPlanTable(key)">⬇ 导出最终规划</span></span>
  </div>
  <table class="cmp">
    <thead><tr><th>#</th><th>行动项</th><th>负责人</th><th>启动</th><th>完成</th><th>预期效果</th><th>依据 / 规则</th></tr></thead>
    <tbody>
      <tr>
        <td><b>{index+1}</b></td>
        <td><b>{act}</b><br><span style="font-size:9px;color:var(--muted2)">{det}</span></td>  <!-- det 可选 -->
        <td>{owner}</td>
        <td style="white-space:nowrap"><b>{start}</b></td>
        <td style="white-space:nowrap">{done}</td>
        <td style="color:var(--quality)">{eff}</td>
        <td>{rule，含 linkRules() 规则悬浮链接}</td>
      </tr>
      <!-- ... -->
    </tbody>
  </table>
  <div class="dl-hint" style="margin-top:6px">行动项按启动时间排序；采纳后经 C10 审批留痕下发为 Action/工单。导出含口径与时间戳，可直接进入 S&OP 决议附件。</div>
</div>
```

**行数据字段（通用 schema，适用于任何调用方）**：`act`(行动项名) / `det`(明细，可选，小字灰色附加行) / `owner`(负责人) / `start`(启动时间点，含相对天数与日历日) / `done`(完成时间点) / `eff`(预期效果，绿色强调) / `rule`(依据规则，内联规则悬浮链接文本)。

产能推演场景下行数据来源（`buildRiskPlanRows()`，第 3531–3545 行）：每个风险卡生成 1（或 2，当峰值≥90 时追加备份方案）行，`act`=方案名+基地，`start`=越线日前置 7 天（备份方案前置 3 天），`done`=越线日（备份方案则越线日+7天），另有一行汇总"14 天内越线需反提月度计划差异"的基地列表（若存在）。行按 `start` 排序。

### 导出行为（`exportPlanTable()`，第 3498–3512 行）

点击"⬇ 导出最终规划"→ 生成一个**独立的、内嵌简化样式的静态 HTML**（浅色系，`max-width:1050px`，见文件第 3501–3504 行的迷你 `<style>` 块：白底黑字表格，`th{background:#f3f6f9}`），用 `Blob` + `URL.createObjectURL` 触发浏览器下载，文件名 = 标题去除空格/间隔号 + 日期。**不是导出当前页面截图，是重新生成一份独立可分享的表格文档**，字段与页面内表格一致但去除了交互态（无 tier-chip、无 hover）。

---

## 9. 悬浮源家族（锚点 `.rk-tip` 第 197 行，含同族 `.rk-pop`/`.rule-pop`/来源 Modal）

产能推演面板里"悬浮看溯源"实际由 4 套独立但视觉同构的机制组成，按任务要求的"来源/规则/字段/dataMode"逐一对应如下。

### 9a. `.rk-tip`（日期点悬浮 tip，`showDayTip()`，第 2600–2618 行）—— 纯 hover，无 pin

```css
.rk-tip{position:fixed;z-index:200;width:360px;display:none;pointer-events:none;
  background:var(--panel);border:1px solid var(--line2);border-radius:11px;padding:12px 14px;
  box-shadow:0 14px 38px rgba(var(--sh-rgb),.22)}
.rk-tip.show{display:block}
.rk-tip-h{font-size:12px;margin-bottom:5px}
.rk-tip-ev{font-size:10px;color:var(--muted);line-height:1.5}
```
（叠加 §1 的玻璃层规则：暗色渐变背景 + `backdrop-filter:blur(20px) saturate(150%)`；浅色主题改纯白渐变、去模糊。）

```html
<div class="rk-tip show" id="rkTip" style="left:{x}px; top:{y}px">
  <div class="rk-tip-h"><b>{date}</b>（T+{d}）· {factorName} 紧张度 <b style="color:{riskColor(v)}">{v}</b></div>
  <div class="rk-tip-ev">{驱动事件描述，若无则显示"基线负荷自然爬升（无事件脉冲）"}</div>
  <table class="cmp" style="margin-top:6px">
    <thead><tr><th>订单</th><th>客户</th><th>数量</th><th>交期</th><th>影响</th></tr></thead>
    <tbody>
      <tr><td><b>{so}</b></td><td>{cust}</td><td>{qty}万</td><td>{due}</td>
          <td style="color:{v>=85?'#DD7E9E':'var(--forecast)'}">{v>=85 ? '延误'+delay+'天' : '关注'}</td></tr>
      <!-- 最多 4 行 + "… 等 N 批" -->
    </tbody>
  </table>
</div>
```

**触发**：圆点 `onmouseenter="showDayTip(...)"` / `onmouseleave="hideDayTip()"`。**定位算法**：tip 宽度固定 360px，水平居中于触发元素、夹紧在视口内（`Math.max(10, Math.min(innerWidth-370, x))`）；默认出现在触发元素下方 10px，若超出视口底部则翻转到上方 10px。tip 挂载在 `document.body`（单例 `#rkTip`，动态创建复用，不是每次新建）。

### 9b. `.rk-pop`（风险点悬浮弹层，可 pin 转人机对话，第 2685–2718 行）

```css
.rk-pop{position:fixed;z-index:300;width:380px;display:none;pointer-events:auto;
  background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:13px 15px;
  box-shadow:0 16px 44px rgba(var(--sh-rgb),.26)}
.rk-pop.show{display:block}
.rk-pop-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:9px;position:relative}
.rk-pop-h b{font-size:13px}
.rk-pop-h span{font-size:10px;font-weight:700}
.rk-pop-x{position:absolute;top:0;right:0;border:none;background:none;color:var(--muted2);cursor:pointer;font-size:14px;padding:2px 4px;line-height:1}
.rk-pop-x:hover{color:var(--txt)}
.rk-pop-sec{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:var(--muted);margin:9px 0 3px}
.rk-pop-sec i{width:7px;height:7px;border-radius:2px;display:inline-block}
.rk-pop-t{font-size:10.5px;line-height:1.6;color:var(--txt)}
.rk-pop-chat{width:100%;margin-top:11px;padding:8px;border-radius:8px;border:1px solid rgba(84,181,196,.4);
  background:rgba(84,181,196,.1);color:var(--capacity);font-size:11.5px;cursor:pointer;font-family:var(--cjk)}
.rk-pop-chat:hover{background:rgba(84,181,196,.18)}
```

```html
<!-- 未 pin 态（纯 hover 预览） -->
<div class="rk-pop show" id="rkPop">
  <div class="rk-pop-h"><b>{baseName} · {factorName}</b><span style="color:{riskColor(peak)}">峰值 {peak} · {crossDate} 越线</span></div>
  <div class="rk-pop-sec"><i style="background:#DD7E9E"></i>风险描述</div><div class="rk-pop-t">{desc}</div>
  <div class="rk-pop-sec"><i style="background:var(--forecast)"></i>根因分析</div><div class="rk-pop-t">{cause，含 src-link 来源跳转}</div>
  <div class="rk-pop-sec"><i style="background:var(--capacity)"></i>时序推演依据</div><div class="rk-pop-t">{basis，公式化文案}</div>
  <button class="rk-pop-chat">💬 就该风险点发起人机对话</button>
</div>

<!-- pin 态（点击"发起人机对话"后固化，出现关闭按钮 + 追问区，替换掉"发起对话"按钮） -->
<div class="rk-pop show">
  ...（同上三段）
  <div class="rk-pop-h">...<button class="rk-pop-x">✕</button></div>  <!-- 仅 pin 态出现 -->
  <div class="rk-pop-sec"><i style="background:var(--capacity)"></i>人机对话</div>
  <div class="qa-chips">{4个预设问题 chip}</div>
  <div class="rk-ans" id="rkPopAns">点击问题，或在下方输入追问。</div>
  <div class="rk-ask"><input id="rkPopInput" placeholder="输入追问…"><button>问</button></div>
</div>
```

**触发与状态机**：
- 悬停 `.rk-fchip-i`（订单明细表里的风险点 chip，见 §6b）→ `showRiskPop()` → 未 pin，`mouseleave` 延迟 240ms 隐藏（`scheduleHideRiskPop`，鼠标移入 pop 本体会 `cancelHideRiskPop`，允许鼠标从 chip 移到 pop 上不消失）。
- 点击 pop 内"💬 就该风险点发起人机对话"→ `pinRiskPop()` → 转为固定态，`mouseleave` 不再自动隐藏，需点 `.rk-pop-x` 手动 `closeRiskPop()`。
- 同一风险点重复悬停不重新拉取（`_rkPopCtx` 命中缓存直接跳过）。
- **定位算法**与 9a 相同模式（宽度 380px，居中夹紧视口，下方优先上方兜底）。

字段：`desc`(风险描述，模板化文案) / `cause`(根因，含 `src-link` 可点击跳转 `openSrcModal`) / `basis`(推演公式说明文案)。

### 9c. `.rule-link` + `.rule-pop`（规则悬浮，`linkRules()`/`showRulePop()`，第 5286–5304 行）

任何文案里出现 `C01`–`C23` 编号，`linkRules(txt)` 会自动把它包成：
```html
<span class="rule-link" onmouseenter="showRulePop(id,event)" onmouseleave="hideRulePop()">{ruleId}</span>
```
`.rule-link` CSS（第 240–241 行）：`color:var(--solver);font-weight:700;cursor:help;border-bottom:1px dotted var(--solver);padding:0 1px`（`cursor:help` 明确提示这是可悬浮元素）。

```css
.rule-pop{position:fixed;z-index:320;width:320px;display:none;pointer-events:auto;
  background:var(--panel);border:1px solid var(--line2);border-radius:11px;padding:12px 14px;
  box-shadow:0 14px 40px rgba(var(--sh-rgb),.24)}
.rule-pop.show{display:block}
.rule-pop-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px}
.rule-pop-expr{font-size:11px;line-height:1.55;color:var(--txt);background:var(--panel2);
  border:1px solid var(--line);border-radius:7px;padding:7px 9px;margin-bottom:8px}
.rule-pop-meta{display:flex;justify-content:space-between;font-size:10.5px;padding:3px 0}
.rule-pop-meta span{color:var(--muted2)}
.rule-pop-tip{font-size:9.5px;color:var(--muted);line-height:1.5;margin-top:7px;padding-top:7px;border-top:1px dashed var(--line)}
```
```html
<div class="rule-pop show">
  <div class="rule-pop-h"><b>{ruleId} · 约束规则</b><span style="color:{severityColor}">{severity}</span></div>
  <div class="rule-pop-expr">{ruleExpression}</div>
  <div class="rule-pop-meta"><span>作用对象</span><b>{scope}</b></div>
  <div class="rule-pop-meta"><span>责任人 / 版本</span><b>{owner} · {version}</b></div>
  <div class="rule-pop-tip">规则是本体一等对象，由解释校验Agent 在推演中执行（图谱「约束规则」节点可下钻全部 N 条）</div>
</div>
```
严重级配色：`阻断`→`#DD7E9E`，`告警`→`var(--forecast)`，其余（自动/降级）→`var(--capacity)`。字段来自规则注册表：`id`/`expr`(表达式)/`scope`(作用域)/`sev`(严重级)/`owner`(责任人)/`ver`(版本)。

### 9d. `.src-link` + 来源系统 Modal（点击态，非 hover，`openSrcModal()`，第 2641–2657 行）

`.src-link` CSS（第 238–239 行）：`color:var(--capacity);cursor:pointer;border-bottom:1px dashed rgba(84,181,196,.45)`；点击后打开 `#srcModal`（复用通用 `.modal-bg`/`.modal`，`style="z-index:400"` 单独提高层级——因为常从已固定的 `.rk-pop`（z-index 300）内部触发，必须盖过它）：

```html
<div id="srcModalBody">
  <div class="bp" style="margin-bottom:8px"><span>来源系统</span><b>{sysName} · {moduleName}</b></div>
  <div class="bp" style="margin-bottom:8px"><span>数据表/对象</span><b style="font-family:var(--mono);font-size:11px">{tableName}</b></div>
  <div class="wf-t" style="margin:8px 0 4px">数据明细（{eventTag} · {eventDate}）</div>
  <div class="bprofile">
    <!-- 2 列 grid，每个字段一个 .bp 卡 -->
    <div class="bp"><span>{fieldLabel}</span><b>{fieldValue}</b></div>
    <!-- ... 4-5 个字段 -->
  </div>
  <div class="bn-d-meta" style="margin-top:10px">
    <div class="bp"><span>采集频率</span><b>{freq}</b></div>
    <div class="bp"><span>最近更新</span><b>{lastUpdateTimestamp}</b></div>
    <div class="bp"><span>数据责任人</span><b>{steward}</b></div>
    <div class="bp"><span>数据血缘</span><b>{lineage}</b></div>
  </div>
  <div class="dl-hint" style="margin-top:8px">该明细为根因量化因子的原始出处，口径与时间轴/经营看板一致；血缘说明此来源如何派生到对应风险对象。</div>
</div>
```

`.bp`/`.bprofile`（第 619–622 行）：
```css
.bprofile{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.bp{background:rgba(var(--ov-rgb),.04);border:1px solid var(--line);border-radius:7px;padding:7px 9px}
.bp span{display:block;font-size:9.5px;color:var(--muted);margin-bottom:2px}
.bp b{font-size:12px;font-weight:600}
```
"标签在上(9.5px灰)、值在下(12px粗体)"的卡片式 key-value 展示单元，全站复用（基地档案/规则弹层元信息/来源详情通用）。

字段来源两张表：`SRC_META[srcSystemName]`（`sys`/`mod`/`table`/`steward`/`freq`/`lineage`）+ 动态明细字段（因来源系统而异，如检修工单号/计划停机/OEE基线下调 或 关联订单/交付数量/交期 或 安全库存覆盖/物料齐套率）。

### 9e. "dataMode"/数据新鲜度（`DATA_HEALTH` 注册表，第 1687–1690 行）

不是独立 UI 组件，而是一个全局字典 `{sysName: {status(状态:'正常'|'延迟'), detail(采集频率/延迟说明文案), impact?(仅异常时,对下游的影响说明)}}`，被 §2 KPI 条的 `.rk-health` 横幅、§10 DAG 节点详情的"来源系统·新鲜度"列（第 3419 行 `${(DATA_HEALTH[x[2]]||{}).detail}`）等多处引用，用于统一渲染"数据新鲜度"提示。**只有 IoT/SCADA 一个源在示例数据里标记为异常（延迟），其余全部'正常'**——这是唯一一个真正承载"降级"业务逻辑的健康度开关，其余是静态陈列。

---

## 10. 订单全链过程图 DAG（`odNodes`，第 3351–3428 行，源自 `buildOrderView()`/`orderwrap`）

### 结构：4 层有向无环图，11 条固定边

```
Layer 0（根）:        so（订单根对象）
Layer 1（并行 4 支）:  net（可产网络） / bom（BOM展开） / eco（单价与细分） / cred（信用档案）
Layer 2（3 项判定）:   jcap（①交期判） / jkit（②齐套判） / jfin（③财务判）
Layer 3（结论）:       vrd（结论）

边（source→target）：
so→net, so→bom, so→eco, so→cred,
net→jcap, bom→jkit, eco→jfin, cred→jfin,
jcap→vrd, jkit→vrd, jfin→vrd
```
（`cred`→`jfin` 而非独立判定——信用汇入财务判定分支，不是第 4 个并列判定，注意这不是严格对称的"4 进 3 出 3 进 1 出"，是 `eco` 和 `cred` 共同汇入 `jfin`。）

### 节点数据字段（`odNodes(order, judgeResult)` 每项）

```
id       : 节点 id（'so'/'net'/'bom'/'eco'/'cred'/'jcap'/'jkit'/'jfin'/'vrd'）
L        : 层号 0-3
l        : 主标签（粗体，第一行）
s        : 副标签（灰色小字，第二行）
c        : 节点强调色 hex
det.logic   : 节点逻辑说明（一段话）
det.formula : 推导公式文本（可选，等宽字体展示）
det.inputs  : [[字段名, 值, 来源系统], ...] 数组
det.chain   : [本体对象名, ...] 数组（业务建模链路径，每个可点击跳转）
det.rule    : 关联规则文本（含 C-编号，自动生成 rule-link）
```

### SVG 布局算法（`odDagSVG()`，第 3392–3408 行）

```
画布 viewBox: 0 0 1100 H       // W=1100 固定宽（视口用 style width:100%;height:auto 缩放）
节点高 NH = 46px
层间距 LH = 82px（纵向）
首层 y 偏移 topY = 27px
每层节点数组按 L 分桶后：该层 x 间隔 g = W / (count+1)，第 i 个节点 x = g*(i+1)
节点宽 n.w = min(count>3 ? 198 : 250, g-12)     // 节点越多，单节点越窄，但设上限
总高 H = topY + 4*LH + 2
```

边渲染为三次贝塞尔曲线（非直线/折线）：
```
起点 (A.x, A.y+NH/2) → 终点 (B.x, B.y-NH/2)
控制点 1: (A.x, (A.y+B.y)/2)     // 与起点同 x，纵向中点
控制点 2: (B.x, (A.y+B.y)/2)     // 与终点同 x，纵向中点
```
即经典"纵向流程图 S 形连接线"，`stroke:#7C8896;stroke-width:1.4;opacity:.6`，箭头用 `<marker id="odar">`（8×8，三角形 `M0,0 L6,3 L0,6 Z`，填充同色）。

节点渲染：
```html
<g onclick="odPick(nodeId)" style="cursor:pointer">
  <rect x="{x-w/2}" y="{y-23}" width="{w}" height="46" rx="9"
        fill="{color}{selected?'26':'12'}"          <!-- hex透明度后缀：选中≈15%，未选中≈7% -->
        stroke="{color}" stroke-width="{selected?2.4:1.5}"/>
  <text x="{x}" y="{y-5}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--txt)">{l}</text>
  <text x="{x}" y="{y+9}" text-anchor="middle" font-size="8" fill="var(--muted)">{s}</text>
  <!-- 仅选中态额外显示左上角小标签 -->
  <text x="{x-w/2+5}" y="{y-18}" font-size="7" font-weight="800" fill="{color}">已选</text>
</g>
```

`.sdag-wrap`/`.sdag-svg` 外层容器 CSS（第 254–259 行，注：这套壳类用于另一个"决策推演 DAG"缩略图，`odDagSVG` 本身直接内嵌无额外壳类，容器由调用处的 `#odDag` div 承载）：
```css
.sdag-wrap{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:10px 14px;margin-bottom:6px;box-shadow:0 2px 10px rgba(var(--sh-rgb),.06)}
.sdag-svg{width:100%;height:auto;max-height:330px;display:block}
```
`odDagSVG` 返回的 `<svg>` 直接内联 `style="width:100%;height:auto;max-height:430px"`（注意与 `.sdag-svg` 的 330px 上限不同——DAG 用 430px）。

### 点击下钻交互（`odPick()`/`odDetHTML()`，第 3410–3428 行）

- 点节点 → `odSel` 记录当前选中 id（再点同一节点 → 置空，即"再点取消选中"）→ 重渲染整个 SVG（更新描边/填充透明度）+ 重渲染右侧/下方详情面板。
- 未选中任何节点时详情面板提示：`点击 DAG 任意节点 → 查看该节点的判定逻辑、推导公式、输入数据（含来源与新鲜度）、业务建模链与关联规则。`
- 选中后详情面板：

```html
<div style="border-left:3px solid {nodeColor};padding-left:11px">
  <div style="font-size:12.5px;font-weight:800;color:{nodeColor}">{label} <span style="font-size:10px;color:var(--muted);font-weight:400">{subLabel}</span></div>
  <div style="font-size:10.5px;color:var(--muted);line-height:1.65;margin-top:5px"><b style="color:var(--txt)">节点逻辑：</b>{logic}</div>
  <div style="font-size:10px;margin-top:5px"><span style="color:var(--muted2)">推导：</span><code style="font-size:10px">{formula}</code></div>  <!-- formula 可选 -->
  <table class="cmp" style="margin-top:7px">
    <thead><tr><th>输入数据</th><th>值</th><th>来源系统 · 新鲜度</th></tr></thead>
    <tbody>
      <tr><td>{fieldName}</td><td><b>{value}</b></td><td>{sourceSystem}{freshness ? ' · '+freshness : ''}</td></tr>
      <!-- ... -->
    </tbody>
  </table>
  <div style="font-size:10px;margin-top:7px"><span style="color:var(--muted2)">业务建模链（本体对象路径）：</span>
    <span class="rk-fchip" style="border-color:#54B5C455;color:#54B5C4;cursor:pointer" onclick="跳转到全景图并高亮该本体节点">{chainNodeName}</span>
    <span style="color:var(--muted2)"> → </span>
    <!-- ... chain 数组每项一个 chip，箭头分隔 -->
  </div>
  <div style="font-size:10px;margin-top:6px"><span style="color:var(--muted2)">关联规则：</span>{ruleText，含 rule-link}</div>
</div>
```

链路 chip 点击行为：`setView('all')` 切回全局本体图谱视图 + `setTimeout(()=>pickNode(chainObjName), 120)` 延迟 120ms 后高亮对应节点（延迟是为了等视图切换的 DOM/力导向布局先完成）——**这是"点击对象名跳转回全局本体图并高亮"的标准模式**，产能推演面板本身没有此模式（因为它是全屏面板，没有本体图谱作为背景画布）。

### 顶部选择器 + KPI 条（`buildOrderView()`，第 3429–3448 行，附带展示，非本节主体但同页）

```html
<div class="rk-hsel" style="align-items:center">
  {aiBar 组件：🤖 AI 对话 开关 + ⬇ 导出}
  <span class="tier-chip on">订单全链推演</span>
  <span class="tier-chip">型号产能推演</span>
  <span class="rk-basesel" style="margin:0 0 0 10px">选择订单：<select>{订单下拉}</select></span>
</div>
<div class="rk-kpi">
  <!-- 6 张 KPI 卡：数量/应用型号、交期可达性、正极缺口、订单收入、毛利率(vs线)、推演结论 -->
</div>
```

---

## 11. 整体页面骨架

### 顶层网格（`.app`，第 37 行）

```css
.app{display:grid; grid-template-columns:248px 1fr 340px; grid-template-rows:62px 1fr; height:100vh}
```
```
┌─────────────────────── header (62px, 跨 3 列) ───────────────────────┐
│ aside.left (248px) │        main (1fr)         │ aside.right (340px) │
│                     │                            │                      │
└─────────────────────┴────────────────────────────┴──────────────────────┘
```
`grid-template-rows:62px 1fr`，`height:100vh` — 严格铺满视口高度，无页面级滚动（各子区域自行滚动）。

进入任意全屏子看板（含"产能推演"）时，`.app` 追加 `.map-mode` 类（第 629–630 行）：
```css
.app.map-mode{grid-template-columns:248px 1fr 0}
.app.map-mode aside.right{display:none}
```
右侧本体检查器栏收起（宽度归零+隐藏），中间 `main` 区被 `riskwrap`（或其它 `*wrap`）绝对定位铺满替代原本的 SVG 力导向图。**左侧导航栏 248px 始终保留、不隐藏**——所有全屏子看板都还能切换回其它 tab。

### Header（第 881–902 行）

```html
<header>
  <div class="brand">
    <div class="logo"></div>
    <div><h1>{系统全名}</h1><div class="sub">{副标题}</div></div>
  </div>
  <div class="hgrow"></div>  <!-- flex:1 占位撑开 -->
  <label class="theme-switch">{明暗主题切换开关}</label>
  <div class="stat-strip">
    <div class="stat"><b id="s-obj">—</b><span>对象</span></div>
    <div class="stat"><b id="s-link">—</b><span>关系</span></div>
    <div class="stat"><b id="s-solver">4</b><span>求解器</span></div>
    <div class="stat"><b id="s-agent">—</b><span>智能体</span></div>
    <div class="stat"><b id="s-dom">14</b><span>数据域</span></div>
  </div>
</header>
```
```css
header{
  grid-column:1/4; display:flex; align-items:center; gap:18px;
  padding:0 22px; border-bottom:1px solid rgba(var(--ov-rgb),.09);
  background:linear-gradient(180deg,rgba(42,54,72,.82),rgba(28,36,50,.66));
  backdrop-filter:blur(18px) saturate(150%);
  box-shadow:inset 0 1px 0 rgba(var(--ov-rgb),.05), 0 10px 30px rgba(var(--sh-rgb),.35);
  position:relative; z-index:20;
}
.stat-strip{display:flex;gap:22px}
.stat{text-align:right}
.stat b{display:block;font-size:17px;font-weight:600;font-family:var(--mono);line-height:1}
.stat span{font-size:10px;color:var(--muted);letter-spacing:.4px;text-transform:uppercase}
```
Header 全局统计条（对象/关系/求解器/智能体/数据域计数）与产能推演面板内的 `.rk-kpi`（§2）是两套独立的 KPI 展示，不要混淆——header 的是"全站本体规模"，`.rk-kpi` 是"本次推演结果"。

### 左侧导航栏（`aside.left`，第 904–909 行 + 第 5424–5442 行导航数据结构）

```css
aside.left{border-right:1px solid var(--line);padding:16px 14px;overflow-y:auto;background:var(--panel2)}
```
分组结构（`NAV` 数组，第 5424–5429 行）：
```
组1（无标题）:        [dash]（经营驾驶舱）
组2「规划决策推演」:   [audit, generate]（规划体检、规划建议）
组3「项目决策推演」:   [order, risk]（项目推演、产能推演）  ← 本 spec 主体 tab 在此组
组4「业务建模」(默认折叠): [all, backbone, source, agent, map, solver, story, loop]
```
分组标题（`.nav-master`）可点击折叠/展开（箭头图标 `▾` 旋转 -90° 表示已折叠），子项（`.tab.sub`）左缩进 14px。"产能推演" tab：`dot:'#DD7E9E', label:'产能推演', tag:'预警'`。

### `<main>` 内的层叠内容（第 911–943 行）

`<main>{position:relative;overflow:hidden}` 内，从底到顶大致是：SVG 力导向本体图（默认视图）→ `.mode-card` 节点详情浮卡 → 多个 `.riskwrap` 绝对定位全屏面板（互斥显示，JS 控制 `.show`）→ `.mapwrap` 地理地图面板 → `.map-overlay` 映射表弹层。"产能推演"对应 `#riskwrap`，与 `#storywrap`/`#sopwrap`/`#aopwrap`/`#qwrap`/`#orderwrap`/`#dashwrap`/`#auditwrap`/`#genwrap`/`#planwrap` 是同级兄弟节点，共用 `.riskwrap` 类与显隐机制（`hideWraps()` 统一隐藏，切视图时目标 wrap 加 `.show`）。

### 右侧本体检查器（`aside.right#inspector`，第 945–951 行）

仅在非全屏视图（即右栏未被 `.map-mode` 隐藏时）可见，默认展示空状态提示文案；点击图谱节点后填充该对象的完整映射信息。产能推演等全屏面板激活时此栏整体 `display:none`。

### 全局 Modal 层（第 954–998 行，与 `<div class="app">` 同级，直接挂在 `<body>` 下）

四个功能 modal，全部复用 `.modal-bg`/`.modal` 外壳（第 666–676 行）：`#srcModal`（来源详情，`max-width:520px`，`z-index:400` 内联覆盖）、`#dayModal`（时点影响分析，`max-width:640px`）、`#actModal`（采纳方案→工单，`max-width:560px`）、`#bnModal`（多维瓶颈矩阵，默认 `max-width:1120px`）。

```css
.modal-bg{position:fixed;inset:0;background:rgba(5,8,12,.74);backdrop-filter:blur(3px);
  display:none;z-index:300;align-items:center;justify-content:center;padding:30px}
.modal-bg.show{display:flex}
.modal{position:relative;background:linear-gradient(170deg,rgba(44,56,74,.97),rgba(31,40,54,.97));
  border:1px solid var(--line2);border-radius:15px;max-width:1120px;max-height:88vh;overflow:auto;
  padding:22px 26px;box-shadow:0 30px 80px rgba(var(--sh-rgb),.205)}
```
点击遮罩空白处关闭（`onclick="if(event.target===this)close...()"`），非点击 modal 内容本身。

### 响应式断点

**无。** 全文件 0 处 `@media` 查询。所有尺寸均为像素定值或 `fr`/`%` 相对布局，面向固定桌面视口（隐含假设 ≥1280px 宽），未做窄屏/移动端适配。

### Z-index 层级总表

| 层 | z-index | 说明 |
|---|---|---|
| header | 20 | 固定在顶部，遮住下方内容滚动 |
| `.map-overlay` | 30 | 映射表弹层（main 内） |
| `.rk-tip` | 200 | 日期悬浮 tip |
| `.modal-bg`（默认） | 300 | 四个功能 modal 的遮罩 |
| `.rk-pop` | 300 | 风险点悬浮/固定弹层（与 modal 同级） |
| `.rule-pop` | 320 | 规则悬浮弹层（需盖过 rk-pop） |
| `#srcModal`（内联覆盖） | 400 | 来源详情（常从已 pin 的 rk-pop 内触发，需最高层级） |

---

## 12. 交互清单（供 L2 UX 复刻）

| # | 触发元素 | 触发方式 | 预期行为 |
|---|---|---|---|
| 1 | 左侧导航"产能推演" tab | click | `setView('risk')` → 隐藏 SVG 本体图/右侧检查器/其它 wrap，`#riskwrap` 加 `.show`，调用 `buildRisk(30)`（默认 30 天窗口）全量重渲染面板 |
| 2 | 顶部「瓶颈视角 / 订单聚合」两个 `.tier-chip` | click | `setRiskTab('risk'|'order')` → 切换 `riskTab` 状态并整面板重建；'risk' 显示风险卡网格，'order' 显示经营聚合表+订单明细表（§6），二者互斥、非并存 |
| 3 | 顶部「30天/60天/90天」三个 `.tier-chip` | click | `buildRisk(H)` → 改变推演时间窗口 `riskH`，重新计算全部风险卡/时间轴/KPI，整面板重建；当前选中窗口 chip 加 `.on` |
| 4 | 风险基地卡片（整张 `.rk-card`，无独立 CTA 按钮） | click | `openRiskCard(i)` → 该卡加 `.open`（发光描边，同时只有一张卡是 open 态）、下方 `#rkDetail` 填充该基地完整时间轴+方案+人机问答、平滑滚动到详情区 |
| 5 | 时间轴逐日圆点 `.rk-dot` | hover (mouseenter/mouseleave) | `showDayTip()`/`hideDayTip()` → 弹出 `.rk-tip`（360px，无 pin），展示当日紧张度数值+驱动事件+最多4条受影响订单表；纯 hover，鼠标移开即消失 |
| 6 | 方案卡「采纳→工单」按钮（`.fc-go`，位于 `.rk-sol` 内） | click | `adoptRiskSol(cardIdx, solIdx)` → 打开 `#actModal`，展示工单草稿（工单号/触发依据/行动项/发起-审批人），需再点"▶ 提交审批"（`submitRiskAction`）才真正写入审计日志（`AUDIT` 数组 unshift）并关闭 modal |
| 7 | QA 预设问题 chip（`.qa-chip`，风险详情右栏） | click | `riskAsk(cardIdx, qIdx)` → 直接用预置问答对渲染 `#rkAns`（**非真实调用 LLM，是本地确定性问答表**） |
| 8 | 追问输入框 `#rkInput` + "问"按钮 | Enter 键 / click | `riskFree(cardIdx)` → 用简单关键词正则（客户/订单、方案/建议、为什么/原因、最坏/后果）路由到对应确定性回答模板，命中即渲染、不命中给通用兜底文案 |
| 9 | 订单明细表里的风险点 chip（`.rk-fchip-i`，§6b） | hover (mouseenter/mouseleave，240ms 延迟隐藏) | `showRiskPop()`/`scheduleHideRiskPop()` → 弹出 `.rk-pop`（380px，风险描述+根因+推演依据三段） |
| 10 | `.rk-pop` 内"💬 就该风险点发起人机对话"按钮 | click | `pinRiskPop()` → 弹层从 hover 态转为固定态（出现 ✕ 关闭按钮 + 4 个预设问题 + 追问框），不再随鼠标移开消失 |
| 11 | `.rk-pop` 内根因描述里的"来源：XX ⤢"（`.src-link`） | click | `openSrcModal(base,factor,day)` → 打开 `#srcModal`（z-index 400，盖过 rk-pop），展示来源系统/数据表/明细字段/采集频率/责任人/血缘 |
| 12 | 任意文案中的规则编号（`C01`–`C23`，`.rule-link`） | hover (mouseenter/mouseleave 200ms 延迟) | `showRulePop()`/`hideRulePop()` → 弹出 `.rule-pop`（320px），展示规则表达式/作用对象/责任人版本 |
| 13 | 「分类维度：乘用车/商用车/储能 \| 按基地」两个 chip（econTable 上方，§6a） | click | `setOrderSeg('app'|'base')` → 触发整面板 `buildRisk(riskH)` 重建，经营表按新维度重新分组聚合 |
| 14 | 基地筛选下拉 `.rk-basesel select`（§6b） | change | `setOrderBase(baseId)` → 整面板重建，订单明细表+经营表都收窄到该基地相关订单；下拉旁出现"✕ 清除"chip 可一键回到全部 |
| 15 | "✕ 清除（当前：xx）" chip | click | `setOrderBase('__all__')` → 清除基地筛选，回到全量视图 |
| 16 | 「⬇ 导出最终规划」chip（处置计划表标题栏，§8） | click | `exportPlanTable(key)` → 前端生成独立浅色系静态 HTML 文件并触发浏览器下载（非截图，是重新渲染的表格文档） |
| 17 | **[兄弟视图]** 订单全链推演 DAG 节点（`<g onclick="odPick(id)">`，§10） | click | 切换该节点选中态（再点同节点取消选中）→ SVG 重渲染描边高亮 + 下方详情面板刷新为该节点的逻辑/公式/输入表/本体链/规则 |
| 18 | **[兄弟视图]** DAG 详情面板里的本体链 chip（`chain[]` 各项） | click | `setView('all')` 切回全局本体力导向图，`setTimeout(120ms)` 后 `pickNode(objName)` 高亮对应节点——即"点对象名跳回全景图定位" |
| 19 | **[兄弟视图]** 订单选择下拉（`buildOrderView` 顶部 `.rk-basesel select`） | change | 切换 `orderSelSo`，重新计算 `orderJudge()` 三关联判，整面板+DAG 重建，`odSel` 重置为未选中 |
| 20 | **[兄弟视图]** 「订单全链推演 / 型号产能推演」两个 `.tier-chip`（`orderMode`） | click | 切换 `orderMode`，`buildOrderView()` 内部分流到 `renderProjModel()`（型号视角）或订单 DAG 视角，两套完全不同的渲染路径 |
| 21 | 主题切换开关（header，`.theme-switch`） | click (checkbox toggle) | `toggleTheme()` → `body` 加/去 `.light` 类，全局 CSS 变量切换明暗主题；产能推演内的风险三色（红/黄/绿）**不随主题变化**（硬编码 hex，见 §1/§4） |

**关于"方案数切换"的如实说明**：产能推演的方案库固定为每因素 3 个方案（`RISK_SOL` 各分类数组长度均为 3），源码里**没有**改变方案数量的 UI 控件；标题里的"（N 个）"只是对固定数组长度的只读展示。若目标看板需要"切换显示方案数量"的能力，需自行新增该交互，源参照物不存在。

---

## 附：关键函数/行号速查表（便于回源核对）

| 内容 | 函数/常量名 | 行号 |
|---|---|---|
| 风险三色分档 | `riskColor()` | 1720 |
| 因素代码→展示名 | `FACTOR_OBJ` | 1721 |
| 因素枚举全集(7个) | `BN_FACTORS` | 2396 |
| 构建风险卡数组 | `buildRiskCards()` | 1725 |
| 面板主渲染 | `buildRisk()` | 2431–2463 |
| 经营聚合表 | `econTable()` | 2477–2505 |
| 订单聚合视图 | `buildOrderAgg()` | 2506–2539 |
| 日期刻度行 | `dateAxis()` | 2540–2544 |
| 单因素时间轴行 | `factorRow()` | 2545–2551 |
| 展开风险卡详情 | `openRiskCard()` | 2552–2583 |
| 日期点 tip | `showDayTip()`/`hideDayTip()` | 2600–2618 |
| 来源详情弹层数据 | `SRC_META`/`srcDetailRows()` | 2620–2639 |
| 来源详情 Modal | `openSrcModal()` | 2641–2657 |
| 风险点悬浮弹层 | `buildRiskPop()`/`showRiskPop()` | 2662–2718 |
| 采纳方案→工单 | `adoptRiskSol()`/`submitRiskAction()` | 2732–2747 |
| 处置计划行数据 | `buildRiskPlanRows()` | 3531–3545 |
| 处置计划表渲染+导出 | `planTableHTML()`/`exportPlanTable()` | 3490–3512 |
| 年度情景规划(三情景) | `buildAOP()`/`AOP_SCEN` | 3238–3273 |
| 订单全链 DAG 节点 | `odNodes()` | 3351–3391 |
| DAG SVG 渲染 | `odDagSVG()` | 3392–3409 |
| DAG 节点详情面板 | `odDetHTML()`/`odPick()` | 3410–3428 |
| 订单全链主视图 | `buildOrderView()` | 3429–3483 |
| 规则悬浮 | `linkRules()`/`showRulePop()` | 5286–5304 |
| 导航结构 | `NAV`/`buildUI()` | 5424–5444 |
| 视图注册表(含 risk) | `VIEWS` | 1441–1567 |
