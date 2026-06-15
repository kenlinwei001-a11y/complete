import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { installMockEventSource } from "./mockEventSource";

/** VITE_MOCK=1 时启用：MSW worker + Mock EventSource（脚本化 SSE） */
export async function startMockWorker(): Promise<void> {
  installMockEventSource();
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: "bypass" });
}
