# 统一推演控制台 E2E 实测 findings（真后端 SEED_DEMO=1 @4001 · vite preview @5173 · 合并树 dist）

[06:58:03] ⚠ 浏览器 console.error: Failed to load resource: the server responded with a status of 401 (Unauthorized)
[06:58:04] 未登录访问根路径 ⇒ 被守卫送到 /login（符合预期）
[06:58:04] ⚠ 浏览器 console.error: Failed to load resource: the server responded with a status of 404 (Not Found)
[06:58:04] 登录成功（demo/admin），落地 http://127.0.0.1:5173/
[06:58:08] 左导航找到「统一推演控制台」并点击
[06:58:08] 控制台已渲染，URL=http://127.0.0.1:5173/v/sim-unified
[06:58:11] service worker 注册：无（MSW mock 未激活）
[06:58:11] 至此打到 :4001 真后端的请求数 = 11（0 即前端没连真后端）
[06:58:41] 会话出处行：(读不到)
[06:58:41] 事件 material-price-up: landable=1 「原材料涨价选择物料 · 涨幅＋」
[06:58:41] 事件 batch-defect: landable=1 「批次不良 / 召回选择批次 · 不良率＋」
[06:58:41] 事件 rush-order: landable=1 「临时插单选择订单 · 增量＋」
[06:58:41] 事件 due-change: landable=1 「订单改交期选择订单 · 提前天数＋」
[06:58:41] 事件 order-cancel: landable=1 「订单取消选择订单 · 撤单量＋」
[06:58:41] 事件 inbound-delay: landable=1 「物料到货延迟选择供应商 · 延迟天数＋」
[06:58:41] 事件 material-short: landable=1 「物料短缺选择物料 · 缺口量＋」
[06:58:41] 事件 equipment-down: landable=1 「设备故障选择设备 · 停机天数＋」
[06:58:41] 事件 capacity-loss: landable=1 「产能损失选择基地 · 损失幅度＋」
[06:58:41] 事件 ship-to-change: landable=1 「改交付地点选择收货地 · 改派＋」
[06:58:41] 事件 order-reprice: landable=1 「订单改价选择订单 · 价格变动＋」
[06:58:42] 已加入待施加：material-price-up → 落点「铝箔」幅度 20（候选 8 个）
[06:58:43] 已加入待施加：inbound-delay → 落点「容百科技」幅度 7（候选 15 个）
[06:58:43] 已加入待施加：rush-order → 落点「广汽集团」幅度 30（候选 500 个）
[06:58:44] 已加入待施加：equipment-down → 落点「obj_equipment_LINE-WS-changzhou-assembly-assembly-E1」幅度 2（候选 500 个）
[06:58:44] 待施加清单屏上回显：已添加 4 件扰动事件（本脚本加了 4 件）
[06:58:44] 推演时长：3（屏上口径：= 3 天（3 拍），推演至 2026-04-11（第 100 拍））
[06:58:44] 已点「开始推演」…
[06:59:02] ✅ 推演完成，耗时 18298ms。verdict：本次推演4 件扰动 · 推演至 2026-04-11（第 100 拍）3580 格读数发生变化 · 明细在下方页签?重新推演受阻环节?18卡点5 · 堵点6 · 断点7读对象层真字段 · 判规则表真红线 · 不随扰动变受影响订单?~150集合由占位世界选出共 500 张 · 读到 500 张按世界差分全集判定 · 不按源格受影响客户?~17集合由占位世界选出共 20 家由受影响订单按 Order.cust 归并被推动的订单敞口?~156
[06:59:03] API 侧会话：sims_demo_seed_world status=RUNNING curTick=100
[06:59:03] tick-response-1.json: curTick=100 披露字段=[fromTick,toTick,data,slice,rules,constraints,agent,timings]
[06:59:03] API 侧已施加扰动 5 条（种子自带 1 条 + 本次 4 条 ⇒ 期望 5）：demand_shift@obj_equipment_LINE-WS-changzhou-assembly-assembly-E1 delta20 startTick=1 | cost_shock@obj_material_al_foil delta20 startTick=97 | supply_disruption@obj_supplier_SUP-001 delta7 startTick=97 | demand_shift@obj_order_SO-3391 delta30 startTick=97 | capacity_loss@obj_equipment_LINE-WS-changzhou-assembly-assembly-E1 delta2 startTick=97
[06:59:03] 🔴 步骤「6-逐环节验真」异常：Error: ENOENT: no such file or directory, open '/tmp/wo-console-e2e/evidence/world-0.json'（不绕行，留 DOM 与截图后续查）
[06:59:03] 结果/降级面板 testid 扫描：命中 c0828-money · c0828-cust · c0828-board · c0828-options · c0828-exposure · c0828-impediment · c0828-graph-absent · c0828-kpi-nospark · c0828-board-missing-cols · c0828-watchonly · c0828-honesty
[06:59:03]   └ c0828-board-missing-cols 原文：以下三列当前缺失，逐列说明：
[06:59:03]   └ c0828-kpi-nospark 原文：各卡不带迷你走势线；第二行是同次推演内的对比（占订单簿 / 占总数），不是「较上周」。
[06:59:03] 已进入专家模式（8 档页签工作台）
[06:59:07] 指标卡墙：wall 内按钮数=5，分组=7，截断标记=true，wall 文本 1829 字符
[06:59:07] usim-status：会话 sims_demo_seed_world自动选中最近一条正在推演的会话世界态出处：结构派生的占位读数，不是实测 · 种子世界的 tick0 读数分两种：4171 格是实测（状态变量名就是对象上的属性名，直接读了那个对象的真实业务数）；其余 2192 格是本体结构派生的确定性占位（这些状态变量在本平台不是对象属性，
[06:59:07] usim-origin：世界态出处：结构派生的占位读数，不是实测 · 种子世界的 tick0 读数分两种：4171 格是实测（状态变量名就是对象上的属性名，直接读了那个对象的真实业务数）；其余 2192 格是本体结构派生的确定性占位（这些状态变量在本平台不是对象属性，对象上取不到值）。拿占位格当起点算出的差值，量级不可当实测读；实测格没有这个
[06:59:07] usim-lifecycle：状态 推演中 —— 世界会随拍推进，可施加扰动暂停恢复结束⬇ 导出?
[06:59:08] ⚠ 右栏没有「看看改这一格会波及谁」按钮（卡无落点对象？）
[06:59:40] 页签 指标态势：renderer=? 已挂载
[06:59:43] 页签 传导识别：renderer=sim-conduction 已挂载
[06:59:46] 页签 损失归因：renderer=sim-attribution 已挂载
[06:59:48] 页签 方案寻优：renderer=sim-optimize 已挂载
[06:59:48] 页签 演习结论：禁用
[06:59:51] 页签 产销线路图：renderer=chain-line-map 已挂载
[06:59:51] 页签 传导边册：禁用
[06:59:51] 页签 本体与就绪：禁用
[07:00:25] 按「暂停」后 lifecycle data-status=RUNNING；壳日志尾：切到「指标态势」切到「传导识别」切到「损失归因」切到「方案寻优」切到「产销线路图」请求把会话迁到「PAUSED」
[07:00:25] 暂停态下 POST tick ⇒ HTTP 409（世界真的冻结，符合屏上说法）
[07:00:29] 按「恢复」后 lifecycle data-status=RUNNING
[07:00:29] 
全程打到 :4001 真后端的请求总数 = 57
[07:00:29] ═══ 脚本走完（各步异常已在上面逐条记录，未绕行）═══
