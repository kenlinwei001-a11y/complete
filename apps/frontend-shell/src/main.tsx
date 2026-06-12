import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { env } from "./env";
import "./styles/global.css";

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
