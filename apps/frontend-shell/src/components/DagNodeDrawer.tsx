import { Modal } from "@/components/ui/Modal";
import { RuleRef } from "@/components/RuleRef";

/**
 * DAG 节点溯源抽屉（R13 信任 = 出处 + 推导可当场亮出）——全平台 DAG 节点点穿复用的单一组件。
 * 抽取自 ProjectSimView（型号六步 DAG）→ 共享给驾驶舱/规划根因 DAG（ProvenanceDag）等，
 * 接现成不新建并行（轨N 增量1·N-G1）。
 */
export interface DagDetail {
  title: string;
  verdict?: string;
  src: string;
  fresh?: string;
  formula?: string;
  inputs?: string[];
  rule?: string;
  note?: string;
  /** 可选下钻动作（如 event 节点"查看受影响订单"）——保上下文的就地跳转。 */
  action?: { label: string; onClick: () => void };
}

export function DagNodeDrawer({ detail, onClose }: { detail: DagDetail; onClose: () => void }) {
  return (
    <Modal title={`🔍 ${detail.title}`} onClose={onClose} width={560}>
      <div data-testid="dag-node-drawer">
        {detail.verdict && (
          <div className="okBar" style={{ border: "1px solid var(--line2)", borderRadius: 6, padding: "6px 10px", marginBottom: 10 }} data-testid="dag-node-verdict">
            {detail.verdict}
          </div>
        )}
        <table className="cmp">
          <tbody>
            <tr>
              <td style={{ width: 96, color: "var(--muted2)" }}>来源系统</td>
              <td data-testid="dag-node-src">{detail.src}</td>
            </tr>
            {detail.fresh && (
              <tr>
                <td style={{ color: "var(--muted2)" }}>新鲜度</td>
                <td>{detail.fresh}</td>
              </tr>
            )}
            {detail.formula && (
              <tr>
                <td style={{ color: "var(--muted2)" }}>推导公式</td>
                <td>
                  <code style={{ fontSize: 11 }}>{detail.formula}</code>
                </td>
              </tr>
            )}
            {detail.inputs && detail.inputs.length > 0 && (
              <tr>
                <td style={{ color: "var(--muted2)" }}>输入数据</td>
                <td>{detail.inputs.join(" · ")}</td>
              </tr>
            )}
            {detail.rule && (
              <tr>
                <td style={{ color: "var(--muted2)" }}>关联规则</td>
                <td data-testid="dag-node-rule">
                  <RuleRef code={detail.rule} />
                </td>
              </tr>
            )}
            {detail.note && (
              <tr>
                <td style={{ color: "var(--muted2)" }}>备注</td>
                <td style={{ color: "var(--muted)" }}>{detail.note}</td>
              </tr>
            )}
          </tbody>
        </table>
        {detail.action && (
          <button className="btn sm" style={{ marginTop: 10 }} data-testid="dag-node-action" onClick={detail.action.onClick}>
            {detail.action.label}
          </button>
        )}
        <div style={{ marginTop: 8, fontSize: 10, color: "var(--muted2)" }}>信任 = 出处 + 推导可当场亮出（R13）</div>
      </div>
    </Modal>
  );
}
