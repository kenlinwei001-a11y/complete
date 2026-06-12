/**
 * Mock EventSource：脚本化 SSE 事件序列（正常流/澄清流/失败流/断线重放流）。
 * - 事件 id 单调递增；连接携带 lastEventId 时从其后续接（重放语义）。
 * - frame.disconnectAfter=true：发完该帧后触发 onerror（仅一次），验证退避重连 + 去重。
 * - 分段（segment）之间等待 release（澄清答复后继续）。
 */

export interface ScriptFrame {
  event: string;
  data: Record<string, unknown>;
  delayMs?: number;
  disconnectAfter?: boolean;
}

interface TaskScript {
  segments: ScriptFrame[][];
  releasedSegments: number;
  disconnected: boolean;
  /** 扁平化后帧的全局 id 从 1 开始 */
  listeners: Set<MockEventSource>;
}

const registry = new Map<string, TaskScript>();

export function registerTaskScript(taskId: string, segments: ScriptFrame[][]): void {
  registry.set(taskId, { segments, releasedSegments: 1, disconnected: false, listeners: new Set() });
}

/** 澄清答复后释放下一段 */
export function releaseNextSegment(taskId: string): void {
  const script = registry.get(taskId);
  if (!script) return;
  script.releasedSegments = Math.min(script.releasedSegments + 1, script.segments.length);
  for (const es of script.listeners) es.pump();
}

export function clearTaskScripts(): void {
  registry.clear();
}

function flatFrames(script: TaskScript): (ScriptFrame & { id: number; segment: number })[] {
  const out: (ScriptFrame & { id: number; segment: number })[] = [];
  let id = 0;
  script.segments.forEach((seg, si) => {
    for (const f of seg) out.push({ ...f, id: ++id, segment: si });
  });
  return out;
}

export class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  /** 测试可调：帧间默认延迟 */
  static defaultDelay = 15;

  url: string;
  readyState = 0;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;

  private handlers = new Map<string, Set<(ev: MessageEvent) => void>>();
  private taskId: string;
  private cursor: number; // 已投递的最大事件 id
  private timer: ReturnType<typeof setTimeout> | null = null;
  private script: TaskScript | undefined;

  constructor(url: string) {
    this.url = url;
    const u = new URL(url, "http://mock.local");
    const m = /\/b\/v1\/queries\/([^/]+)\/events/.exec(u.pathname);
    this.taskId = m?.[1] ?? "";
    this.cursor = Number(u.searchParams.get("lastEventId") ?? "0") || 0;
    this.script = registry.get(this.taskId);
    this.script?.listeners.add(this);
    this.readyState = 1;
    setTimeout(() => {
      this.onopen?.(new Event("open"));
      this.pump();
    }, 0);
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    this.handlers.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
    if (this.timer) clearTimeout(this.timer);
    this.script?.listeners.delete(this);
  }

  /** 投递下一帧（若有） */
  pump(): void {
    if (this.readyState === 2 || !this.script) return;
    if (this.timer) return; // 已有调度
    const frames = flatFrames(this.script);
    const next = frames.find((f) => f.id > this.cursor && f.segment < this.script!.releasedSegments);
    if (!next) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.readyState === 2) return;
      this.cursor = next.id;
      const ev = new MessageEvent(next.event, {
        data: JSON.stringify(next.data),
        lastEventId: String(next.id),
      });
      this.handlers.get(next.event)?.forEach((h) => h(ev));
      if (next.event === "message") this.onmessage?.(ev);
      if (next.disconnectAfter && !this.script!.disconnected) {
        // 模拟服务端断开：触发 onerror，让客户端带 Last-Event-ID 重连
        this.script!.disconnected = true;
        this.readyState = 2;
        this.script!.listeners.delete(this);
        this.onerror?.(new Event("error"));
        return;
      }
      this.pump();
    }, next.delayMs ?? MockEventSource.defaultDelay);
  }
}

export function installMockEventSource(): void {
  (globalThis as Record<string, unknown>).EventSource = MockEventSource as unknown;
}
