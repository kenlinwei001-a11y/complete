import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { env } from "./env";
import { initThemeMode } from "./workspace/themeMode";
import "./styles/global.css";

// WO-THEME-SWITCH-U8：启动早期套用持久化主题偏好（避免首屏闪烁）。
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
