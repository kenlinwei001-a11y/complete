import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { handlers } from "@/mocks/handlers";
import { resetMockDb } from "@/mocks/db";
import { clearTaskScripts, installMockEventSource, MockEventSource } from "@/mocks/mockEventSource";
import { queryClient } from "@/store/queryClient";
import { tokenStore } from "@/api/tokenStore";
import { useSessionStore } from "@/store/sessionStore";

export const server = setupServer(...handlers);

// rAF polyfill（jsdom 非 pretendToBeVisual 模式）
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  installMockEventSource();
  MockEventSource.defaultDelay = 5;
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDb();
  clearTaskScripts();
  queryClient.clear();
  tokenStore.clear();
  useSessionStore.getState().reset();
});

afterAll(() => server.close());
