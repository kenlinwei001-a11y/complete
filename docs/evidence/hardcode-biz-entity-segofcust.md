# HARDCODE-BIZ-ENTITY · segOfCust 去内联收口证据（Hα α1 · R14 · G-5）

日期 2026-07-04 · 分支 claude/vigilant-knuth-b1nmxn

## 1. 真实服务 curl（datacore in-memory · POST /a/v1/solvers/affected_orders/invoke）
segOfCust 现委派 classifySegment（SEG_REGISTRY.keywords 单一来源）。真起服务真跑 demo 租户，marginLedger.bySegment 逐值：
```
summary: {"orderCount":24,"totalQty":240,"custCount":8,"revenue":438.8}
bySegment:
  乘用车 revenue=259.6 orders=12 revShare=0.5916
  储能 revenue=141.4 orders=9 revShare=0.3222
  商用车 revenue=37.8 orders=3 revShare=0.0861
rows seg 抽样: 整车厂A→乘用车 · 整车厂A→乘用车 · 储能集成商D→储能 · 整车厂B→乘用车
```
→ 整车厂/海外车企→乘用车(pas) · 储能集成商/电网公司→储能(ess) · 商用车集团→商用车(com)，与迁移前逐值一致（R6）。

## 2. registry-driven 证明（换册 keywords → 输出变；非死值·非 EV 租户不全塌 pas）
```
[before override] 册 ess.keywords = ["储能","电网"]
[before override] classify( 太阳能电站运营商 ) = pas (兜底 pas — 非 EV 客户旧行为)
[after  override] 册 ess.keywords = ["储能","电网","太阳能"]
[after  override] classify( 太阳能电站运营商 ) = ess (→ ess：registry-driven，非死值)
[R6 baseline]  整车厂A→pas · 海外车企E→pas · 商用车集团G→com · 储能集成商D→ess · 电网公司F→ess · 储能集成商H→ess
```

## 3. R6 字节一致 + 门牙
- 全量 datacore 测试：909 passed / 15 skipped（基线 905 + 新增 seg-classify.test.ts 4）；既有断言零改 → 字节一致。
- 门牙 test/seg-classify.test.ts：改 SEG_REGISTRY.keywords→segOfCust 输出随之变（退回内联 /商用车/ 即红）。
