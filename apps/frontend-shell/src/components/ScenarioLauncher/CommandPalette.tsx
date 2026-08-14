import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScenarioCards } from "@/api/endpoints";
import { Modal } from "@/components/ui/Modal";
import { useScenarioLaunch } from "./useScenarioLaunch";
import zh from "@/locales/zh";

/**
 * ⌘K 命令面板（PRD-scenario-launcher §3.5-A）：全局快捷键唤起，搜场景名/触发问句 →
 * 选中即注入 presetContext 启动（与 CLI 一句话驱动同构）。挂在 Shell 全局。
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // WO-SCENARIO-FORCED-EXTRACT：qRef 与输入同步直写——点击启动时读最新键入值，
  // 不受 React 批量提交窗口影响（快打字/测试快速键入时闭包 q 可能是上一帧）。
  const qRef = useRef("");
  const launch = useScenarioLaunch();
  const { data } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards(), enabled: open });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!needle) return items.slice(0, 8);
    return items.filter((c) => [c.name, c.triggerQuestion, c.sNo, c.summary].some((s) => s?.toLowerCase().includes(needle))).slice(0, 12);
  }, [q, data]);

  if (!open) return null;
  return (
    <Modal title={zh.launcher.paletteTitle} onClose={() => setOpen(false)} width={560}>
      <div data-testid="command-palette">
        <input
          autoFocus
          value={q}
          aria-label={zh.launcher.searchAria}
          data-testid="command-palette-input"
          placeholder={zh.launcher.searchPlaceholder}
          onChange={(e) => {
            qRef.current = e.target.value;
            setQ(e.target.value);
          }}
          style={{ width: "100%", marginBottom: 10 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflowY: "auto" }}>
          {matches.length === 0 && <div className="empty-state">无匹配场景</div>}
          {matches.map((c) => (
            <button
              key={c.sNo}
              className="btn"
              data-testid={`command-palette-item-${c.sNo}`}
              style={{ justifyContent: "flex-start", textAlign: "left" }}
              onClick={() => {
                setOpen(false);
                // WO-SCENARIO-FORCED-EXTRACT：搜索框文本作为自由文本 query 透传（缺省回退卡 triggerQuestion），
                // 与启动器卡片输入框同语义——不再把用户打的整句问句吞掉。读 qRef 取点击瞬间的最新键入值。
                const uq = qRef.current.trim();
                void launch(c, uq || undefined);
              }}
            >
              <b className="mono" style={{ marginRight: 6 }}>{c.sNo}</b>
              {c.name}
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>{c.triggerQuestion}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
