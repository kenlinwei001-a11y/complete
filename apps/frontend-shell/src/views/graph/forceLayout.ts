/**
 * 自研力导向布局（PRD §7.2）：斥力 / 弹簧 / 中心引力 + alpha 退火。
 * 纯计算模块（不依赖 DOM），便于测试与节流渲染。
 */

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

export interface SimEdge {
  from: string;
  to: string;
}

export interface ForceParams {
  repulsion: number; // 斥力系数
  springLength: number; // 弹簧自然长度
  springK: number; // 弹簧劲度
  centerGravity: number; // 中心引力
  damping: number;
  alphaDecay: number;
  alphaMin: number;
}

export const DEFAULT_PARAMS: ForceParams = {
  repulsion: 14000,
  springLength: 120,
  springK: 0.025,
  centerGravity: 0.012,
  damping: 0.82,
  alphaDecay: 0.985,
  alphaMin: 0.005,
};

export class ForceSimulation {
  nodes: SimNode[] = [];
  private edges: SimEdge[] = [];
  private index = new Map<string, SimNode>();
  alpha = 1;
  params: ForceParams;
  private width: number;
  private height: number;

  constructor(width: number, height: number, params: Partial<ForceParams> = {}) {
    this.width = width;
    this.height = height;
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  setGraph(nodeIds: string[], edges: SimEdge[], seed = 42): void {
    // 确定性初始布局（环形 + 伪随机扰动）
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    this.nodes = nodeIds.map((id, i) => {
      const angle = (i / Math.max(nodeIds.length, 1)) * Math.PI * 2;
      const r = Math.min(this.width, this.height) * 0.32 * (0.6 + rand() * 0.4);
      return {
        id,
        x: this.width / 2 + Math.cos(angle) * r,
        y: this.height / 2 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
    });
    this.edges = edges;
    this.index = new Map(this.nodes.map((n) => [n.id, n]));
    this.alpha = 1;
  }

  get(id: string): SimNode | undefined {
    return this.index.get(id);
  }

  pin(id: string, x: number, y: number): void {
    const n = this.index.get(id);
    if (!n) return;
    n.x = x;
    n.y = y;
    n.vx = 0;
    n.vy = 0;
    n.fixed = true;
  }

  release(id: string): void {
    const n = this.index.get(id);
    if (n) n.fixed = false;
  }

  reheat(alpha = 0.5): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  get settled(): boolean {
    return this.alpha < this.params.alphaMin;
  }

  /** 单步迭代；返回是否仍在活动 */
  tick(): boolean {
    if (this.settled) return false;
    const { repulsion, springLength, springK, centerGravity, damping, alphaDecay } = this.params;
    const nodes = this.nodes;
    const n = nodes.length;
    // 斥力 O(n²)（≤300 节点可接受）
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          d2 = dx * dx + dy * dy;
        }
        const f = (repulsion / d2) * this.alpha;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // 弹簧
    for (const e of this.edges) {
      const a = this.index.get(e.from);
      const b = this.index.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = springK * (d - springLength) * this.alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // 中心引力 + 积分
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (const node of nodes) {
      if (node.fixed) continue;
      node.vx += (cx - node.x) * centerGravity * this.alpha;
      node.vy += (cy - node.y) * centerGravity * this.alpha;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
    this.alpha *= alphaDecay;
    return true;
  }
}
