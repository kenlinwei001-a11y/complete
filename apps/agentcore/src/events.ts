import type { QueryEventRow, Repos } from "./persistence/repos.js";

export const TERMINAL_EVENTS = new Set(["answer.final", "task.failed", "task.cancelled"]);

type Listener = (row: QueryEventRow) => void;

/** Persists task events (SSE replay source) and fans them out to live subscribers. */
export class TaskEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly repos: Repos) {}

  async emit(taskId: string, event: string, payload: unknown): Promise<QueryEventRow> {
    const row = await this.repos.events.append(taskId, event, payload);
    const subs = this.listeners.get(taskId);
    if (subs) for (const l of [...subs]) l(row);
    return row;
  }

  subscribe(taskId: string, listener: Listener): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(taskId);
    };
  }

  async replayAfter(taskId: string, afterSeq: number): Promise<QueryEventRow[]> {
    return this.repos.events.listAfter(taskId, afterSeq);
  }
}
