import { useState } from "react";
import { InferenceProcessDag } from "./InferenceProcessDag";
import zh from "@/locales/zh";

/**
 * 推演过程折叠面板（横切复用）：在任意推演视图（risk/project/order/audit/generate）的结论旁挂一个
 * "▸ 推演过程（编排 DAG）"，展开见 QOS 同构 10 节点编排图。solved=该次推演已出结论 → 全节点 done；
 * gapNode/缺口由调用方按结论传入（断在哪一步标红）。轨迹来自真实推演（R13），拓扑=编排定义（R14）。
 */
export function InferenceProcessPanel({ testId, solved = true, gapNode = null, mode = "orchestration" }: { testId: string; solved?: boolean; gapNode?: number | null; mode?: "orchestration" | "model-network" }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn sm ghost" data-testid={`${testId}-toggle`} onClick={() => setOpen((v) => !v)}>
        {open ? zh.sim.inference.hide : zh.sim.inference.toggle}
      </button>
      {open && <InferenceProcessDag solved={solved} gapNode={gapNode} mode={mode} testId={testId} />}
    </div>
  );
}
