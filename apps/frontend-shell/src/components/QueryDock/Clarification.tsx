import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { replyClarification, searchObjects } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import type { ClarificationPayload } from "@/sse/taskStreamReducer";
import zh from "@/locales/zh";
import styles from "./Clarification.module.css";

/** 澄清交互（PRD §6.4）：INTENT_CHOICE 选项卡片 / SLOT_FILLING 内联表单 */
export function ClarificationView({ taskId, payload }: { taskId: string; payload: ClarificationPayload }) {
  // CLARIFY-CHAIN-FIX（簇⑨断③·多轮澄清死屏）：此前 submitted 布尔常驻 → 第 1 轮提交后组件
  // 永远 null，第 2 轮 `clarification.required` 到达也不渲染（S06 实测 >92s 死屏挂起）。
  // 改按**轮次**记提交：新一轮 payload.round ≠ 已提交轮 → 重新渲染表单。
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);

  const send = async (body: Parameters<typeof replyClarification>[1]) => {
    try {
      await replyClarification(taskId, body);
      setSubmittedRound(payload.round);
    } catch (e) {
      toastError(e);
    }
  };

  if (submittedRound === payload.round) return null;

  return (
    <div className={styles.wrap} data-testid="clarification">
      <div className={styles.roundLabel} data-testid="clarify-round">
        {zh.dock.clarifyRound(payload.round)}
      </div>
      {payload.kind === "INTENT_CHOICE" ? (
        <IntentChoice key={payload.round} payload={payload} onChoose={(key) => void send({ kind: "INTENT_CHOICE", chosenIntentKey: key })} onNone={() => void send({ kind: "INTENT_CHOICE", none: true })} />
      ) : (
        // key=round：多轮之间重置表单内部值（上一轮残值不粘连到下一轮）。
        <SlotFilling key={payload.round} payload={payload} onSubmit={(values) => void send({ kind: "SLOT_FILLING", slotValues: values })} />
      )}
    </div>
  );
}

function IntentChoice({
  payload,
  onChoose,
  onNone,
}: {
  payload: ClarificationPayload;
  onChoose: (intentKey: string) => void;
  onNone: () => void;
}) {
  return (
    <div className={styles.options}>
      {/* 契约 options.intentKey 可为 null（服务端「都不是」哨兵项）——null 项路由到 onNone，
          且不与下方固定「都不是」按钮重复渲染。 */}
      {(payload.options ?? [])
        .filter((opt): opt is { intentKey: string; name: string; description: string } => opt.intentKey != null)
        .map((opt) => (
          <button key={opt.intentKey} className={styles.optionCard} onClick={() => onChoose(opt.intentKey)} data-testid={`intent-option-${opt.intentKey}`}>
            <strong>{opt.name}</strong>
            <span>{opt.description}</span>
          </button>
        ))}
      <button className="btn" onClick={onNone} data-testid="intent-none">
        {zh.dock.clarifyNone}
      </button>
    </div>
  );
}

/**
 * FILL-BOUNDARY-GUARDRAIL · B1 复用：缺口卡触发前「先澄清」也用同一套 SLOT_FILLING 表单
 * （复用 SlotControl + 「第 n/2 次确认」轮次标）。接受契约 SlotDef[]（refType→objectType 归一）。
 */
export function SlotFillingForm({
  slots,
  round,
  onSubmit,
  submitLabel,
  testid = "boundary-clarify",
}: {
  slots: { name: string; type: SlotDefVM["type"]; enumValues?: string[]; clarifyPrompt?: string; description?: string; refType?: string; objectType?: string }[];
  round?: number;
  onSubmit: (values: Record<string, unknown>) => void;
  submitLabel?: string;
  testid?: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));
  return (
    <form
      className={styles.slotForm}
      data-testid={testid}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {round != null && (
        <div className={styles.roundLabel} data-testid="boundary-clarify-round">
          {zh.dock.clarifyRound(round)}
        </div>
      )}
      {slots.map((slot) => {
        // 契约 SlotDef.clarifyPrompt 可缺（B1 边界闸路径直传 SlotDef[]）→ 本地按服务端同优先级
        // clarifyPrompt ?? description ?? 裸名兜底归一为 ClarificationSlot（人话优先，不甩裸 key）。
        const label = slot.clarifyPrompt?.trim() || slot.description?.trim() || `请提供${slot.name}`;
        const vm: SlotDefVM = { name: slot.name, type: slot.type, enumValues: slot.enumValues, clarifyPrompt: label, description: slot.description ?? "", objectType: slot.refType ?? slot.objectType };
        return (
          <div key={slot.name} className={styles.slotRow}>
            <label htmlFor={`slot-${slot.name}`}>{label}</label>
            <SlotControl slot={vm} value={values[slot.name]} onChange={(v) => set(slot.name, v)} />
          </div>
        );
      })}
      <button type="submit" className="btn primary sm">
        {submitLabel ?? zh.common.submit}
      </button>
    </form>
  );
}

function SlotFilling({ payload, onSubmit }: { payload: ClarificationPayload; onSubmit: (values: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

  return (
    <form
      className={styles.slotForm}
      data-testid="slot-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {(payload.slots ?? []).map((slot) => (
        <div key={slot.name} className={styles.slotRow}>
          <label htmlFor={`slot-${slot.name}`}>{slot.clarifyPrompt ?? `请提供${slot.name}`}</label>
          <SlotControl slot={slot} value={values[slot.name]} onChange={(v) => set(slot.name, v)} />
        </div>
      ))}
      <button type="submit" className="btn primary sm">
        {zh.common.submit}
      </button>
    </form>
  );
}

type SlotDefVM = NonNullable<ClarificationPayload["slots"]>[number];

/** 按 SlotDef.type 渲染控件 */
function SlotControl({ slot, value, onChange }: { slot: SlotDefVM; value: unknown; onChange: (v: unknown) => void }) {
  const id = `slot-${slot.name}`;
  switch (slot.type) {
    case "date":
      return <input id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "enum":
      return (
        <select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            请选择
          </option>
          {(slot.enumValues ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    case "number":
      return <input id={id} type="number" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
    case "timeWindow":
      return <TimeWindowControl id={id} value={value as { from?: string; to?: string } | undefined} onChange={onChange} />;
    case "objectRef":
      return <ObjectRefSelector id={id} objectType={slot.objectType ?? "Base"} value={value as { objectId: string; label?: string } | undefined} onChange={onChange} />;
    default:
      return <input id={id} type="text" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** timeWindow → 双日期 */
function TimeWindowControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: { from?: string; to?: string } | undefined;
  onChange: (v: unknown) => void;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input id={id} type="date" aria-label="开始日期" value={value?.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      <span style={{ color: "var(--muted2)" }}>~</span>
      <input type="date" aria-label="结束日期" value={value?.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value })} />
    </span>
  );
}

/** objectRef → 对象搜索选择器（GET /a/v1/objects?type=&q=） */
export function ObjectRefSelector({
  id,
  objectType,
  value,
  onChange,
}: {
  id: string;
  objectType: string;
  value: { objectId: string; label?: string } | undefined;
  onChange: (v: unknown) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["a", "objects", { type: objectType, q }],
    queryFn: () => searchObjects(objectType, q),
    enabled: open,
  });

  return (
    <span style={{ position: "relative", display: "inline-block", minWidth: 220 }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        placeholder={`搜索 ${objectType}…`}
        value={value?.label ?? q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(undefined);
          setOpen(true);
        }}
      />
      {open && data && (
        <ul className={styles.dropdown} role="listbox">
          {data.items.map((item) => {
            const label = String(item.props.name ?? item.props.so ?? item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value?.objectId === item.id}
                  onClick={() => {
                    onChange({ objectType, objectId: item.id, label });
                    setOpen(false);
                  }}
                >
                  {label}
                </button>
              </li>
            );
          })}
          {data.items.length === 0 && <li className={styles.noResult}>{zh.common.none}</li>}
        </ul>
      )}
    </span>
  );
}
