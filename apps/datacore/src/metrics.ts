/** Minimal in-process Prometheus text-format registry (PRD §11 dc_* metrics). */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`).join(",") + "}";
}

export class Metrics {
  private counters = new Map<string, Map<string, number>>();
  private gauges = new Map<string, Map<string, number>>();

  inc(name: string, labels: Labels = {}, value = 1): void {
    const series = this.counters.get(name) ?? new Map<string, number>();
    const key = labelKey(labels);
    series.set(key, (series.get(key) ?? 0) + value);
    this.counters.set(name, series);
  }

  set(name: string, labels: Labels = {}, value: number): void {
    const series = this.gauges.get(name) ?? new Map<string, number>();
    series.set(labelKey(labels), value);
    this.gauges.set(name, series);
  }

  get(name: string, labels: Labels = {}): number {
    return this.counters.get(name)?.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [lk, v] of series) lines.push(`${name}${lk} ${v}`);
    }
    for (const [name, series] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const [lk, v] of series) lines.push(`${name}${lk} ${v}`);
    }
    return lines.join("\n") + "\n";
  }
}
