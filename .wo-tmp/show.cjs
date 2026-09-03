// WO-SIM-DISCLOSURE 对照实验读数器（临时件，建在本 worktree 内）。
const d = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")).disclosure;
const t = Object.fromEntries(d.timings.map((x) => [x.phase, x.ms]));
console.log(
  `${process.argv[3]}  命中规则数=${d.rules.fired}  本拍传导边数=${d.rules.contributions}  快照版本=${d.data.snapshotVersion}`,
);
console.log(
  `      喂入=${d.rules.declared}  扰动写入=${d.rules.perturbationWrites}  合计耗时=${t.total}ms  传导耗时=${t.engine}ms  饱和=${d.constraints.saturations}`,
);
console.log(
  `      图: 对象=${d.data.objects} 边=${d.data.links}  切片=${d.slice.sliceKey}  拍 ${d.fromTick}→${d.toTick}  agent=${d.agent.invoked ? "调用了" : "未调用"}`,
);
