import { useToastStore } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./Toasts.module.css";

/** 全局 toast：API 错误展示 code + message + requestId（可复制） */
export function Toasts() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className={styles.wrap} role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.kind] ?? ""}`}>
          <div className={styles.msg}>
            {t.code && <span className={`badge ${t.kind === "error" ? "red" : "blue"}`}>{t.code}</span>}
            <span>{t.message}</span>
          </div>
          {t.requestId && (
            <button
              className={styles.reqId}
              title={zh.common.copy}
              onClick={() => void navigator.clipboard?.writeText(t.requestId!)}
            >
              {zh.common.requestId}: {t.requestId} ⧉
            </button>
          )}
          <button className={styles.x} onClick={() => dismiss(t.id)} aria-label={zh.common.close}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
