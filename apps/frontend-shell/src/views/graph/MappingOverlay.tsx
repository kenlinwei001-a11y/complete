import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MappingRow } from "@platform/contracts";
import { fetchOntologyMapping, fetchRules, fetchMappingRegistries } from "@/api/endpoints";
import { Feature } from "@/workspace/featureGate";
import { buildMappingCsv, buildMappingHtml, downloadBlob, lineageSummary } from "./mappingExport";
import zh from "@/locales/zh";
import styles from "./MappingOverlay.module.css";

/**
 * §7.20 业务建模映射表：图谱工具栏入口的全屏弹层（对齐原型 map-overlay）。
 * 按数据域分组（组头行）；行点击 → 关闭并在图谱中定位；导出受 act.export 控制。
 */
export function MappingOverlay({ packageId, onClose, onLocate }: { packageId: string; onClose: () => void; onLocate: (objectKey: string) => void }) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["a", "ontology-mapping", { packageId }],
    queryFn: () => fetchOntologyMapping(packageId),
  });
  const { data: rules } = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules });
  const { data: registries } = useQuery({ queryKey: ["a", "mapping-registries", {}], queryFn: fetchMappingRegistries });
  const [openRule, setOpenRule] = useState<string | null>(null);

  const domains = [...new Set((rows ?? []).map((r) => r.domain))];

  const exportCsv = () => downloadBlob(buildMappingCsv(rows ?? []), "text/csv;charset=utf-8", "ontology-mapping.csv");
  const exportHtml = () =>
    downloadBlob(buildMappingHtml(rows ?? [], new Date().toISOString().slice(0, 19).replace("T", " ")), "text/html;charset=utf-8", "ontology-mapping.html");

  return (
    <div className={styles.overlay} data-testid="mapping-overlay" role="dialog" aria-label={zh.mapping.title}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <h3>{zh.mapping.title}</h3>
          <span className={styles.hint}>{zh.mapping.locateHint}</span>
          <Feature flag="act.export">
            <button className="btn sm" data-testid="mapping-export-csv" onClick={exportCsv}>
              {zh.mapping.exportCsv}
            </button>
            <button className="btn sm" data-testid="mapping-export-html" onClick={exportHtml}>
              {zh.mapping.exportHtml}
            </button>
          </Feature>
          <button className="btn sm" data-testid="mapping-close" onClick={onClose} aria-label={zh.common.close}>
            ✕ {zh.common.close}
          </button>
        </div>

        {isLoading && <div className="empty-state">{zh.common.loading}</div>}
        {rows && (
          <div className={styles.scroll}>
            <table className="cmp" data-testid="mapping-table">
              <thead>
                <tr>
                  <th>{zh.mapping.colObject}</th>
                  <th>{zh.mapping.colKind}</th>
                  <th>{zh.mapping.colSource}</th>
                  <th>{zh.mapping.colProps}</th>
                  <th>{zh.mapping.colRules}</th>
                  <th>{zh.mapping.colDerivations}</th>
                  <th>{zh.mapping.colLineage}</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <DomainGroup
                    key={d}
                    domain={d}
                    rows={(rows ?? []).filter((r) => r.domain === d)}
                    onLocate={onLocate}
                    openRule={openRule}
                    setOpenRule={setOpenRule}
                    ruleExpression={(key) => rules?.find((r) => r.key === key)?.expression}
                  />
                ))}
              </tbody>
            </table>
            {/* PRD-IND-map §4.5-③：四注册表段（关系类型 / 规则 / Action / 事件） */}
            {registries && (
              <div data-testid="mapping-registries">
                <RegistrySection testId="reg-link" title={zh.mapping.regLinkTypes} cols={[zh.mapping.regColLink, zh.mapping.regColFrom, zh.mapping.regColTo, zh.mapping.regColCard]}
                  rows={registries.linkTypes.map((r) => [r.key, r.fromType, r.toType, r.cardinality])} keyOf={(r) => r[0]!} />
                <RegistrySection testId="reg-rule" title={zh.mapping.regRules} cols={[zh.mapping.regColRule, zh.mapping.regColExpr, zh.mapping.regColScope, zh.mapping.regColSev]}
                  rows={registries.rules.map((r) => [r.key, r.expression, r.scope, r.severity])} keyOf={(r) => r[0]!} />
                <RegistrySection testId="reg-action" title={zh.mapping.regActions} cols={[zh.mapping.regColAct, zh.mapping.regColParams, zh.mapping.regColCheck, zh.mapping.regColTarget, zh.mapping.regColPerm]}
                  rows={registries.actions.map((r) => [r.name, r.params, r.check, r.target, r.perm])} keyOf={(r) => r[0]!} />
                <RegistrySection testId="reg-event" title={zh.mapping.regEvents} cols={[zh.mapping.regColEvent, zh.mapping.regColWindow, zh.mapping.regColAffects, zh.mapping.regColSrc]}
                  rows={registries.events.map((r) => [r.name, r.window, r.affects, r.source])} keyOf={(r) => r[0]!} />
              </div>
            )}
            <div className={styles.foot}>{zh.mapping.footnote}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function DomainGroup({
  domain,
  rows,
  onLocate,
  openRule,
  setOpenRule,
  ruleExpression,
}: {
  domain: string;
  rows: MappingRow[];
  onLocate: (objectKey: string) => void;
  openRule: string | null;
  setOpenRule: (v: string | null) => void;
  ruleExpression: (key: string) => string | undefined;
}) {
  return (
    <>
      <tr className={styles.groupRow} data-testid={`mapping-group-${domain}`}>
        <td colSpan={7}>{domain}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.objectKey} className={styles.row} data-testid={`mapping-row-${r.objectKey}`} onClick={() => onLocate(r.objectKey)}>
          <td className="zh">
            <b>{r.displayName}</b> <span className="mono" style={{ color: "var(--c-capacity)" }}>{r.objectKey}</span>
          </td>
          <td>{r.kind}</td>
          <td className="zh">{r.sourceSystem}</td>
          <td>{r.keyProps.join("、") || "—"}</td>
          <td onClick={(e) => e.stopPropagation()}>
            {r.rules.length === 0 && "—"}
            {r.rules.map((key) => (
              <span key={key} style={{ marginRight: 4 }}>
                <button className="badge" data-testid={`mapping-rule-${r.objectKey}-${key}`} onClick={() => setOpenRule(openRule === `${r.objectKey}:${key}` ? null : `${r.objectKey}:${key}`)}>
                  {key}
                </button>
                {openRule === `${r.objectKey}:${key}` && (
                  <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }} data-testid="mapping-rule-expression">
                    {ruleExpression(key) ?? "—"}
                  </div>
                )}
              </span>
            ))}
          </td>
          <td className="zh">{r.derivations.join("；") || "—"}</td>
          <td className="zh">{lineageSummary(r)}</td>
        </tr>
      ))}
    </>
  );
}

/** 注册表段（关系类型 / 规则 / Action / 事件）：标题 + 列头 + 行。 */
function RegistrySection({ testId, title, cols, rows, keyOf }: { testId: string; title: string; cols: string[]; rows: string[][]; keyOf: (r: string[]) => string }) {
  return (
    <div style={{ marginTop: 16 }} data-testid={`mapping-${testId}`}>
      <div className="section-title" style={{ fontSize: 13 }}>
        {title} <span className="mono" style={{ color: "var(--muted2)", fontSize: 11 }}>（{rows.length}）</span>
      </div>
      <table className="cmp" data-testid={`mapping-${testId}-table`}>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyOf(r)} data-testid={`mapping-${testId}-row-${keyOf(r)}`}>
              {r.map((cell, i) => (
                <td key={i} className={i === 0 ? "mono" : "zh"}>{i === 0 ? <b>{cell}</b> : cell || "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
