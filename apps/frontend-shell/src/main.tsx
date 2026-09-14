import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { env } from "./env";
import { initThemeMode } from "./workspace/themeMode";
import "./styles/global.css";

// WO-THEME-SWITCH-U8：渲染前应用持久化的明暗选择（无则 dark 默认），避免首帧明暗闪烁。
initThemeMode();

async function enableMocking(): Promise<void> {
  if (!env.mock) return;
  const { startMockWorker } = await import("./mocks/browser");
  await startMockWorker();
}

void enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
