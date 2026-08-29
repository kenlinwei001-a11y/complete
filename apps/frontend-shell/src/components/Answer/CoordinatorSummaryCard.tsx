import { useMemo } from "react";
import type { Answer } from "@platform/contracts";
import styles from "./CoordinatorSummaryCard.module.css";

/**
 * WO-FIVE-ROLE-AI-EMPLOYEE P1 · Coordinator 跨域协作汇总卡（C5）。
 * 后端 synthesize 产出的结构化 markdown（"**跨域协调（Coordinator）**" 概览 + "### 【角色】⟨scope⟩" 各角色栏 +
 * "---" 综合结论）→ 这里解析成**每角色一栏**（角色名 + scope 徽标 + 对象域 + 子问 + 答）+ 综合结论（分歧红色高亮）。
 * agent.coordinator 关 → 后端不产此形态答案 → 本卡不出现（R3 关则不存在·前端零假数据）。
 */

interface RoleColumn {
  label: string;
  scope: string;
  objectTypes: string;
  subQuestion: string;
  answer: string;
}

const OVERVIEW_MARKER = "**跨域协调（Coordinator）**";

/** 探测某 Answer 是否 Coordinator 汇总（第一个 text 块含标记）。 */
export function isCoordinatorAnswer(answer: Answer): boolean {
  const first = answer.blocks.find((b) => b.type === "text");
  return Boolean(first && first.type === "text" && first.markdown.includes(OVERVIEW_MARKER));
}

function parse(answer: Answer): { overview: string; roles: RoleColumn[]; consensus: string; conflict: boolean } {
  let overview = "";
  const roles: RoleColumn[] = [];
  let consensus = "";
  let conflict = false;
  for (const b of answer.blocks) {
    if (b.type !== "text") continue;
    const md = b.markdown;
    if (md.includes(OVERVIEW_MARKER)) {
      overview = md.replace(/\*\*/g, "").trim();
      continue;
    }
    if (md.startsWith("### 【")) {
      const label = /### 【([^】]+)】/.exec(md)?.[1] ?? "角色";
      const scope = /scope:\s*([^·⟩]+)/.exec(md)?.[1]?.trim() ?? "";
      const objectTypes = /对象域:\s*([^⟩]+)⟩/.exec(md)?.[1]?.trim() ?? "";
      const subQuestion = /\*\*子问\*\*：([^\n]+)/.exec(md)?.[1]?.trim() ?? "";
      const answerText = /作答\*\*：([\s\S]+)$/.exec(md)?.[1]?.trim() ?? "";
      roles.push({ label, scope, objectTypes, subQuestion, answer: answerText });
      continue;
    }
    if (md.includes("存在分歧") || md.includes("一致判断") || md.includes("综合结论")) {
      consensus = md.replace(/^---\n?/, "").replace(/\*\*/g, "").trim();
      conflict = md.includes("存在分歧");
    }
  }
  return { overview, roles, consensus, conflict };
}

export function CoordinatorSummaryCard({ answer }: { answer: Answer }) {
  const { overview, roles, consensus, conflict } = useMemo(() => parse(answer), [answer]);
  return (
    <div className={styles.wrap} data-testid="coordinator-summary">
      <div className={styles.overview}>🧭 {overview}</div>
      <div className={styles.grid}>
        {roles.map((r, i) => (
          <div key={i} className={styles.col} data-testid={`coordinator-role-${i}`}>
            <div className={styles.colHead}>
              <span className={styles.roleName}>{r.label}</span>
              <span className={styles.scopeBadge} title="行级过滤 scope">
                {r.scope}
              </span>
            </div>
            {r.objectTypes && <div className={styles.objTypes}>对象域：{r.objectTypes}</div>}
            {r.subQuestion && <div className={styles.subQ}>子问：{r.subQuestion}</div>}
            <div className={styles.roleAnswer}>{r.answer}</div>
          </div>
        ))}
      </div>
      {consensus && (
        <div className={`${styles.consensus} ${conflict ? styles.conflict : ""}`} data-testid="coordinator-consensus">
          {consensus}
        </div>
      )}
    </div>
  );
}
