import { useEffect, useMemo, useState } from "react";
import {
  PROCESS_TASK_WAIT_STATE_META,
  tasksFromStepTemplate,
  type ProcessDefinition,
  type ProcessInstanceDetail,
  type ProcessStepTemplateResponse,
} from "@platform/contracts";
import {
  createProcessInstance,
  fetchProcessDefinitions,
  fetchProcessStepTemplate,
  queryObjectsPaged,
} from "@/api/endpoints";
import styles from "./ProcessStartFromTemplate.module.css";

/**
 * WO-STEP-TEMPLATE-LAYER · 「**按模板建一条流程实例**」。
 *
 * ══ 这块界面为什么到今天才有 ═══════════════════════════════════════════════
 *
 * `POST /a/v1/process-instances` 在接缝门 `befe-seam` 上挂着「后端注册了·前端零调用」。
 * 分诊结论不是"前端偷懒"，是**接线的前置不存在**：建实例要求 `tasks.min(1)`
 * （步骤逐条给全），而 `ProcessDefinition` 九个字段里没有一个是步骤 ⇒
 * 界面上接个按钮，就得**凭空发明步骤**。步骤模板层补上之后，这块才敢有按钮。
 *
 * ══ 🔴 三条纪律（都能被测试咬住）═══════════════════════════════════════════
 *
 * **① 步骤只从模板来，前端一个字都不发明。**
 * `tasks` 由契约的 `tasksFromStepTemplate(steps)` 折出 —— 那是模板→任务的**唯一一处转换**，
 * 前后端 import 同一个函数。本文件里**没有任何一处**构造步名/责任职能的字面量。
 *
 * **② 没有模板的流程：说清楚，且不给按钮。**
 * `available:false` 时原样显示后端给的 `absence.reason` 与可复跑的 `absence.probe`，
 * 启动按钮**不渲染**。⛔ 绝不拿一份"默认三步"顶上去 —— 宁可少展示，不许造数。
 * 缺席理由做成后端下发的字段而不是前端文案，是因为写在前端的诚实位会随改版蒸发
 * （本仓 `G-FRONTEND-HARDCODED-ABSENCE` 记的就是这个病）。
 *
 * **③ 承载对象必须是真实存在的对象，不许手填一个 id 就建。**
 * 承载对象从 `GET /a/v1/objects?type=<carrierTypeKey>` 现取（复用既有端点，不新造）。
 * 该类型一条对象都没有 ⇒ 同样**不给按钮** + 说清是"这个类型今天没有对象"，
 * 而不是让用户编一个 id ——「实例必须作用在具体对象上」是运行时层自己的红线。
 *
 * ══ R14 去行业锁死 ═══════════════════════════════════════════════════════
 * 流程名 / 步名 / 职能名 / 等待态人话全部随响应或契约词表下发，本文件不写任何行业字面量。
 */

type Load<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "disabled" }
  | { status: "error"; code: string; message: string };

interface EnvelopeLike {
  code?: string;
  status?: number;
  message?: string;
}

/** 只陈述能从响应直接读出的事实；不内联因果猜测（前端看不见病因，只看得见响应）。 */
function readError(e: unknown): { code: string; message: string; status?: number } {
  const err = e as EnvelopeLike;
  return {
    code: typeof err?.code === "string" ? err.code : "UNKNOWN",
    message: typeof err?.message === "string" ? err.message : String(e),
    ...(typeof err?.status === "number" ? { status: err.status } : {}),
  };
}

const isFeatureOff = (e: { code: string; status?: number }) => e.code === "FEATURE_NOT_FOUND" || e.status === 404;

/** 工期显示：模板层是**计划**工期，口径名随文案写死在标签上，免得被读成实测。 */
const days = (n: number) => `${n} 天`;

export default function ProcessStartFromTemplate() {
  const [defs, setDefs] = useState<Load<ProcessDefinition[]>>({ status: "loading" });
  const [selected, setSelected] = useState<string>("");
  const [tpl, setTpl] = useState<Load<ProcessStepTemplateResponse>>({ status: "idle" });
  const [carriers, setCarriers] = useState<Load<{ id: string; label: string }[]>>({ status: "idle" });
  const [carrierId, setCarrierId] = useState<string>("");
  const [created, setCreated] = useState<Load<ProcessInstanceDetail>>({ status: "idle" });

  // ── 流程台账（模板层端点，无 entitlement 门）──
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchProcessDefinitions();
        if (!alive) return;
        const list = [...res.definitions].sort((a, b) => a.key.localeCompare(b.key));
        setDefs({ status: "ready", data: list });
        if (list.length > 0) setSelected(list[0]!.key);
      } catch (e) {
        const { code, message } = readError(e);
        if (alive) setDefs({ status: "error", code, message });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── 选中流程 → 取它的步骤模板 + 该承载类型的真实对象 ──
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setTpl({ status: "loading" });
    setCarriers({ status: "idle" });
    setCarrierId("");
    setCreated({ status: "idle" });
    void (async () => {
      let t: ProcessStepTemplateResponse;
      try {
        t = await fetchProcessStepTemplate(selected);
      } catch (e) {
        const { code, message } = readError(e);
        if (alive) setTpl({ status: "error", code, message });
        return;
      }
      if (!alive) return;
      setTpl({ status: "ready", data: t });
      // 没有模板就不去取承载对象：这条路已经断在上一步，再取一次只是白跑。
      if (!t.available) return;
      setCarriers({ status: "loading" });
      try {
        const page = await queryObjectsPaged(t.carrierTypeKey, 1, 20, {});
        if (!alive) return;
        /**
         * 标签**就用对象 id**（`GET /a/v1/objects` 的 `items` 只有 `{id,type,props}`，没有 display 字段）。
         * 想显示得好看，就得在前端挑一个"看起来像名字"的 prop —— 那是一条会随类型漂移的启发式，
         * 挑错了屏上就是一个对不上的名字。id 不好看，但它是**真的**，而且正是建实例要用的那个值。
         */
        const items = page.items.map((o) => ({ id: o.id, label: o.id }));
        setCarriers({ status: "ready", data: items });
        if (items.length > 0) setCarrierId(items[0]!.id);
      } catch (e) {
        const { code, message } = readError(e);
        if (alive) setCarriers({ status: "error", code, message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const steps = tpl.status === "ready" && tpl.data.available ? tpl.data.steps : [];

  /**
   * 🔴 `tasks` 的**唯一**来源。这里刻意用 `useMemo` 包一层只是为了稳定引用；
   * 转换本身一个字都不在本文件里 —— 它在契约的 `tasksFromStepTemplate()`。
   */
  const tasks = useMemo(() => tasksFromStepTemplate(steps), [steps]);

  const canStart =
    tpl.status === "ready" &&
    tpl.data.available &&
    tasks.length > 0 &&
    carriers.status === "ready" &&
    carriers.data.length > 0 &&
    carrierId.length > 0 &&
    created.status !== "loading";

  const start = async () => {
    if (tpl.status !== "ready" || !tpl.data.available) return;
    setCreated({ status: "loading" });
    try {
      const detail = await createProcessInstance({
        definitionKey: tpl.data.processKey as `P${number}`,
        subjectRef: { typeKey: tpl.data.carrierTypeKey, objectId: carrierId },
        tasks,
      });
      setCreated({ status: "ready", data: detail });
    } catch (e) {
      const err = readError(e);
      // 「功能没开」与「请求失败」是两件事：前者是预期的暗发态（process.runtime defaultOn:false）。
      setCreated(
        isFeatureOff(err)
          ? { status: "disabled" }
          : { status: "error", code: err.code, message: err.message },
      );
    }
  };

  return (
    <section className={styles.root} data-testid="start-from-template">
      <div className={styles.head}>
        <h4>按模板建一条流程实例</h4>
        <p className={styles.sub}>
          步骤**逐条来自该流程的标准步骤模板**，界面一个步骤都不发明。没有步骤模板的流程，
          这里会说清为什么，并且**不给启动按钮** —— 宁可少展示，不许造数。
        </p>
      </div>

      {defs.status === "error" ? (
        <div className={styles.error} data-testid="start-defs-error">
          读取流程台账失败：<code>{defs.code}</code> {defs.message}
        </div>
      ) : null}

      {defs.status === "ready" ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>流程</span>
          <select
            className={styles.select}
            data-testid="start-process-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {defs.data.map((d) => (
              <option key={d.key} value={d.key}>
                {d.key} · {d.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {tpl.status === "loading" ? <p className={styles.stateLine}>正在读取步骤模板…</p> : null}

      {tpl.status === "error" ? (
        <div className={styles.error} data-testid="start-tpl-error">
          读取步骤模板失败：<code>{tpl.code}</code> {tpl.message}
        </div>
      ) : null}

      {/* ── 没有模板：说清楚 + 不给按钮（红线②）── */}
      {tpl.status === "ready" && !tpl.data.available ? (
        <div className={styles.absent} data-testid="start-no-template">
          <strong>这条流程还没有步骤模板</strong>，因此**建不出实例** —— 建实例要求把步骤逐条给全，
          而这条流程今天没有可依据的步骤来源。
          <br />
          <span data-testid="start-absent-reason">{tpl.data.absence?.reason}</span>
          <br />
          <span className={styles.probe}>
            自己复验：<code data-testid="start-absent-probe">{tpl.data.absence?.probe}</code>
          </span>
        </div>
      ) : null}

      {/* ── 有模板：把它逐条摆出来（这就是将来那条实例的步骤，所见即所建）── */}
      {tpl.status === "ready" && tpl.data.available ? (
        <>
          <ol className={styles.steps} data-testid="start-steps">
            {tpl.data.steps.map((s) => (
              <li key={s.seq} className={styles.step} data-testid="start-step" data-seq={s.seq}>
                <span className={styles.stepName}>
                  第 {s.seq} 步 · {s.name}
                </span>
                <span className={styles.stepMeta}>
                  责任职能 <code data-testid="start-step-owner">{s.ownerFunctionKey}</code>
                </span>
                <span className={styles.stepMeta}>
                  {/* 口径名写在标签上：这是**计划**工期，不是实测（实测在实例的步上） */}
                  标准工期 {days(s.stdDurationDays)}
                </span>
                <span className={styles.badge}>
                  通常等待：{PROCESS_TASK_WAIT_STATE_META[s.waitKind].displayName}
                </span>
                <span className={styles.stepMeta}>
                  单据痕迹{" "}
                  <code>
                    {tpl.data.carrierTypeKey}.{s.carrierAnchor.propKey}
                    {s.carrierAnchor.value !== null ? `="${s.carrierAnchor.value}"` : ""}
                  </code>
                </span>
              </li>
            ))}
          </ol>
          <p className={styles.stateLine} data-testid="start-total">
            各步标准工期合计 {days(tpl.data.stepsTotalStdDurationDays ?? 0)}，
            与流程定义的标准工期 {days(tpl.data.definitionStdDurationDays)} 相等 ——
            步骤模板只是把这个数拆开，不新增总量。
          </p>

          {/* ── 承载对象：从真实对象里选，不许手填（红线③）── */}
          {carriers.status === "loading" ? <p className={styles.stateLine}>正在读取承载对象…</p> : null}
          {carriers.status === "error" ? (
            <div className={styles.error} data-testid="start-carrier-error">
              读取承载对象失败：<code>{carriers.code}</code> {carriers.message}
            </div>
          ) : null}
          {carriers.status === "ready" && carriers.data.length === 0 ? (
            <div className={styles.absent} data-testid="start-no-carrier">
              承载类型 <code>{tpl.data.carrierTypeKey}</code> 今天一条对象都没有，
              因此**没有可以作用的具体对象**，建不出实例。这不是模板的问题 ——
              模板在（上面就是），缺的是这个类型的数据。
            </div>
          ) : null}
          {carriers.status === "ready" && carriers.data.length > 0 ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>作用在哪个 {tpl.data.carrierTypeKey} 上</span>
              <select
                className={styles.select}
                data-testid="start-carrier-select"
                value={carrierId}
                onChange={(e) => setCarrierId(e.target.value)}
              >
                {carriers.data.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {canStart ? (
            <button type="button" className={styles.primary} data-testid="start-submit" onClick={() => void start()}>
              按这 {tasks.length} 步建实例
            </button>
          ) : null}
        </>
      ) : null}

      {created.status === "loading" ? <p className={styles.stateLine}>正在建实例…</p> : null}

      {created.status === "disabled" ? (
        <div className={styles.absent} data-testid="start-disabled">
          流程运行时（<code>process.runtime</code>）未开通。这不是故障：该功能默认关闭，
          需由租户显式开通后才能建实例。
        </div>
      ) : null}

      {created.status === "error" ? (
        <div className={styles.error} data-testid="start-error">
          建实例失败：<code>{created.code}</code> {created.message}
        </div>
      ) : null}

      {created.status === "ready" ? (
        <div className={styles.ok} data-testid="start-created">
          已建实例 <code data-testid="start-created-id">{created.data.instance.id}</code>，
          共 <strong data-testid="start-created-count">{created.data.tasks.length}</strong> 步：
          <ol className={styles.steps}>
            {created.data.tasks.map((t) => (
              <li key={t.id} className={styles.step} data-testid="start-created-task" data-seq={t.seq}>
                <span className={styles.stepName}>
                  第 {t.seq} 步 · {t.name}
                </span>
                <span className={styles.stepMeta}>
                  责任职能 <code>{t.ownerFunctionKey}</code>
                </span>
                <span className={styles.badge}>{t.status}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
