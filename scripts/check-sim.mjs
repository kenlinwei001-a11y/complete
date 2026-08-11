#!/usr/bin/env node
/**
 * 门 `sim:check`（推演沙盘增量 1 · G-11）：静态守护会话层结构不变量。
 * 运行时行为由 `apps/datacore/test/sim-session.test.ts` 覆盖（init/tick/checkpoint/rollback/branch/确定性/R2）。
 * 本门守"结构"——R9 四处同改、迁移可回退(down)、entitlement 暗发不回潮、端点过门。
 */
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (rel) => { try { return readFileSync(new URL(rel, root), "utf8"); } catch { return ""; } };
let red = false;
const must = (cond, msg) => { if (!cond) { console.error(`✗ ${msg}`); red = true; } };

// 1) 迁移可回退（R9 additive 可逆）：026 含三+1 表 + down(DROP)。
const mig = read("apps/datacore/migrations/026_sim_sessions.sql");
for (const tbl of ["sim_session", "sim_tick_state", "sim_checkpoint", "sim_propagation_rule"]) {
  must(mig.includes(`CREATE TABLE IF NOT EXISTS ${tbl}`), `migration026 缺表 ${tbl}`);
  must(mig.includes(`DROP TABLE IF EXISTS ${tbl}`), `migration026 缺 ${tbl} 的 down(DROP)`);
}

// 2) R9 仓储四处同改：repo.ts 接口 + memory.ts + pg.ts 各有 SimRepo 实现。
must(/interface SimRepo\b/.test(read("apps/datacore/src/repo/repo.ts")), "repo.ts 缺 SimRepo 接口");
must(/sim:\s*SimRepo/.test(read("apps/datacore/src/repo/repo.ts")), "Repos 未挂 sim: SimRepo");
must(/class MemSimRepo\b/.test(read("apps/datacore/src/repo/memory.ts")), "memory.ts 缺 MemSimRepo");
must(/class PgSimRepo\b/.test(read("apps/datacore/src/repo/pg.ts")), "pg.ts 缺 PgSimRepo");

// 3) entitlement 暗发不回潮：features.ts 中 sim.* 全部 defaultOn:false（任一 true 即红）。
const feat = read("apps/datacore/src/features.ts");
const simFeatLines = feat.split("\n").filter((l) => /key:\s*"sim\./.test(l));
must(simFeatLines.length >= 7, `features.ts sim.* 条数异常（${simFeatLines.length}，应 ≥7）`);
for (const l of simFeatLines) must(/defaultOn:\s*false/.test(l), `sim feature 非暗发（defaultOn 非 false）: ${l.trim().slice(0, 60)}`);

// 4) 端点过 entitlement 门：每个 /a/v1/sim/ 路由块都先 requireSim（R3 先于 authz）。
const app = read("apps/datacore/src/app.ts");
must(/const requireSim\b/.test(app), "app.ts 缺 requireSim entitlement 门");
must((app.match(/requireSim\(c, "sim\./g) ?? []).length >= 7, "sim 端点未全部过 requireSim 门");

// 5) 确定性（R6）：sim 路由/会话不得用 Math.random（时钟戳是 I/O 元数据，算法须确定）。
const simBlock = app.slice(app.indexOf("推演沙盘（G-11"), app.indexOf("A4 ontology + objects", app.indexOf("推演沙盘（G-11")));
must(!/Math\.random|Math\.floor\(Math/.test(simBlock), "sim 路由出现 Math.random（破确定性 R6）");

if (red) { console.error("\n✗ sim:check 未通过（会话层结构不变量被破）。"); process.exit(1); }
console.log("· sim:check：migration026 四表+down · R9 四处 SimRepo · sim.* 暗发(defaultOn:false) · 端点过 entitlement · 确定性");
console.log("✓ sim:check：会话状态机结构不变量守住（运行时见 sim-session.test.ts）。");
