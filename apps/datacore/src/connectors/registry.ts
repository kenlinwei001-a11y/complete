import type { ConnectorType, SourceSchema } from "@platform/contracts";
import type { BlobStore } from "../blob.js";
import { parseCsv, parseJsonRows, parseXlsx } from "./parsers.js";
import { profileRows } from "./profiler.js";
import { validationError } from "../errors.js";

/** Unified adapter interface (PRD §2.1). */
export interface SourceAdapter {
  discoverSchema(): Promise<SourceSchema>;
  fetchBatch(
    dataset: string,
    cursor?: string,
  ): Promise<{ rows: Record<string, unknown>[]; nextCursor?: string }>;
  listDatasets(): Promise<string[]>;
}

/**
 * Connector type registry (code built-in). All 7 PRD types are registered with a
 * configSchema; implemented adapters: file_upload (CSV/JSON; XLSX is a registered
 * capability but the parser is TODO — upload .csv/.json), rest_api, mock_erp, mock_crm.
 */
export const CONNECTOR_TYPES: ConnectorType[] = [
  {
    key: "sap_erp",
    category: "ERP",
    configSchema: {
      type: "object",
      required: ["host", "client", "username", "password"],
      properties: {
        host: { type: "string" },
        client: { type: "string" },
        username: { type: "string" },
        password: { type: "string", format: "credential" },
      },
    },
    capabilities: { batch: true, incremental: true, schemaDiscovery: true },
  },
  {
    key: "salesforce_crm",
    category: "CRM",
    configSchema: {
      type: "object",
      required: ["instanceUrl", "clientId", "clientSecret"],
      properties: {
        instanceUrl: { type: "string" },
        clientId: { type: "string" },
        clientSecret: { type: "string", format: "credential" },
      },
    },
    capabilities: { batch: true, incremental: true, schemaDiscovery: true },
  },
  {
    key: "generic_jdbc",
    category: "EXTERNAL",
    configSchema: {
      type: "object",
      required: ["jdbcUrl", "username", "password"],
      properties: {
        jdbcUrl: { type: "string" },
        username: { type: "string" },
        password: { type: "string", format: "credential" },
      },
    },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    key: "rest_api",
    category: "EXTERNAL",
    configSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        datasetName: { type: "string" },
        apiKey: { type: "string", format: "credential" },
      },
    },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    key: "knowledge_base",
    category: "KB",
    configSchema: {
      type: "object",
      required: ["endpoint"],
      properties: { endpoint: { type: "string" }, token: { type: "string", format: "credential" } },
    },
    capabilities: { batch: false, incremental: false, schemaDiscovery: false },
  },
  {
    key: "external_feed",
    category: "EXTERNAL",
    configSchema: {
      type: "object",
      required: ["feedUrl"],
      properties: { feedUrl: { type: "string" } },
    },
    capabilities: { batch: true, incremental: true, schemaDiscovery: false },
  },
  {
    key: "file_upload",
    category: "FILE",
    configSchema: {
      type: "object",
      required: ["blobKey", "format", "datasetName"],
      properties: {
        blobKey: { type: "string" },
        format: { type: "string", enum: ["csv", "json", "xlsx"] },
        datasetName: { type: "string" },
      },
    },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    key: "mock_erp",
    category: "ERP",
    configSchema: { type: "object", properties: {} },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    key: "mock_crm",
    category: "CRM",
    configSchema: { type: "object", properties: {} },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    // 外部域（EXT_SIG）：出厂样例环境信号连接器（生产走 external_feed/rest_api）。
    key: "mock_external",
    category: "EXTERNAL",
    configSchema: { type: "object", properties: {} },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
];

/** Config fields treated as credentials (AES-256-GCM at rest, never echoed). */
export const CREDENTIAL_FIELDS = new Set(["password", "clientSecret", "apiKey", "token", "secret"]);

export function getConnectorType(key: string): ConnectorType | undefined {
  return CONNECTOR_TYPES.find((t) => t.key === key);
}

/** A11：注册表内置 category 并集（连接器类型 category 去重排序）——前端 chip/筛选枚举来源（R14 非内联）。 */
export function connectorCategories(): string[] {
  return [...new Set(CONNECTOR_TYPES.map((t) => t.category).filter(Boolean) as string[])].sort();
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

abstract class RowsAdapter implements SourceAdapter {
  protected abstract loadAll(): Promise<Record<string, Record<string, unknown>[]>>;

  async listDatasets(): Promise<string[]> {
    return Object.keys(await this.loadAll());
  }

  async discoverSchema(): Promise<SourceSchema> {
    const all = await this.loadAll();
    return {
      datasets: Object.entries(all).map(([name, rows]) => ({ name, fields: profileRows(rows) })),
    };
  }

  async fetchBatch(dataset: string): Promise<{ rows: Record<string, unknown>[] }> {
    const all = await this.loadAll();
    return { rows: all[dataset] ?? [] };
  }
}

export class FileUploadAdapter extends RowsAdapter {
  constructor(
    private blob: BlobStore,
    private config: { blobKey: string; format: string; datasetName: string },
  ) {
    super();
  }

  protected async loadAll(): Promise<Record<string, Record<string, unknown>[]>> {
    const buf = await this.blob.get(this.config.blobKey);
    const fmt = this.config.format;
    if (fmt === "csv") return { [this.config.datasetName]: parseCsv(buf.toString("utf8")) };
    if (fmt === "json") return { [this.config.datasetName]: parseJsonRows(buf.toString("utf8")) };
    if (fmt === "xlsx") return { [this.config.datasetName]: parseXlsx(buf) }; // G-6：xlsx 经 node-xlsx 解析
    throw validationError(`unsupported file format: ${fmt} (csv/json/xlsx supported)`);
  }
}

export class RestApiAdapter extends RowsAdapter {
  constructor(
    private config: { url: string; datasetName?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  protected async loadAll(): Promise<Record<string, Record<string, unknown>[]>> {
    const res = await this.fetchImpl(this.config.url);
    if (!res.ok) throw new Error(`rest_api fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    const rows = Array.isArray(body) ? (body as Record<string, unknown>[]) : parseEmbedded(body);
    return { [this.config.datasetName ?? "api_dataset"]: rows };
  }
}

function parseEmbedded(body: unknown): Record<string, unknown>[] {
  if (body && typeof body === "object") {
    for (const v of Object.values(body)) if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  throw new Error("rest_api response is not a JSON array");
}

/** Built-in ERP sample: production orders + materials (battery flavoured). */
export const MOCK_ERP_DATA: Record<string, Record<string, unknown>[]> = {
  production_orders: [
    { po: "PO-1001", model: "4680-NCM", baseId: "changzhou", qty: 1200, status: "RELEASED", startDate: "2026-05-02" },
    { po: "PO-1002", model: "4680-NCM", baseId: "hefei", qty: 800, status: "RELEASED", startDate: "2026-05-04" },
    { po: "PO-1003", model: "L300-LFP", baseId: "changzhou", qty: 1500, status: "PLANNED", startDate: "2026-05-10" },
    { po: "PO-1004", model: "L300-LFP", baseId: "yibin", qty: 950, status: "PLANNED", startDate: "2026-05-12" },
    { po: "PO-1005", model: "P28-NCM", baseId: "xian", qty: 400, status: "COMPLETED", startDate: "2026-04-21" },
    { po: "PO-1006", model: "S192-LFP", baseId: "qingdao", qty: 700, status: "RELEASED", startDate: "2026-05-15" },
    { po: "PO-1007", model: "4680-NCM", baseId: "changzhou", qty: 600, status: "PLANNED", startDate: "2026-05-18" },
    { po: "PO-1008", model: "M50-NCA", baseId: "liyang", qty: 300, status: "RELEASED", startDate: "2026-05-20" },
  ],
  materials: [
    { sku: "MAT-NCM-811", name: "NCM811 正极材料", uom: "t", safetyStock: 120 },
    { sku: "MAT-LFP-01", name: "LFP 正极材料", uom: "t", safetyStock: 200 },
    { sku: "MAT-CU-FOIL", name: "铜箔", uom: "t", safetyStock: 80 },
    { sku: "MAT-SEP-16", name: "16μm 隔膜", uom: "万㎡", safetyStock: 60 },
  ],
};

/** Built-in CRM sample: customers + sales orders referencing ERP models. */
export const MOCK_CRM_DATA: Record<string, Record<string, unknown>[]> = {
  customers: [
    { custId: "CUST-01", name: "星辰汽车", region: "华东", creditLimit: 50000000, tier: "A" },
    { custId: "CUST-02", name: "蓝海储能", region: "华南", creditLimit: 30000000, tier: "A" },
    { custId: "CUST-03", name: "极光电动", region: "华北", creditLimit: 20000000, tier: "B" },
    { custId: "CUST-04", name: "云岭新能源", region: "西南", creditLimit: 12000000, tier: "B" },
  ],
  sales_orders: [
    { so: "SO-90001", custId: "CUST-01", model: "4680-NCM", qty: 2000, due: "2026-07-01", amount: 9000000 },
    { so: "SO-90002", custId: "CUST-02", model: "S192-LFP", qty: 1500, due: "2026-07-15", amount: 5200000 },
    { so: "SO-90003", custId: "CUST-01", model: "L300-LFP", qty: 1800, due: "2026-08-01", amount: 6100000 },
    { so: "SO-90004", custId: "CUST-03", model: "4680-NCM", qty: 600, due: "2026-08-10", amount: 2700000 },
    { so: "SO-90005", custId: "CUST-04", model: "P28-NCM", qty: 350, due: "2026-08-20", amount: 1600000 },
    { so: "SO-90006", custId: "CUST-02", model: "L300-LFP", qty: 900, due: "2026-09-01", amount: 3050000 },
  ],
};

/**
 * 外部域环境信号样例（EXT_SIG）：市场/政策/汇率等可影响规划敏感性的外部信号。
 * 确定性（R6）；带 source/unit/asOf 供 R13 溯源；impact 标注其影响的规划指标（P2 敏感性接入）。
 */
// elasticity（敏感性弹性）：信号每变动 1% → impact 指标变动的百分点（pp）。确定性、随信号数据下发（R14）。
export const MOCK_EXTERNAL_DATA: Record<string, Record<string, unknown>[]> = {
  external_signals: [
    { signalKey: "li_carbonate_price", name: "电池级碳酸锂价", category: "原料价格", value: 96000, unit: "元/吨", asOf: "2026-06-15", source: "上海有色网", trend: "down", impact: "毛利", elasticity: -0.08 },
    { signalKey: "nickel_price", name: "镍价(LME)", category: "原料价格", value: 18600, unit: "USD/吨", asOf: "2026-06-15", source: "LME", trend: "flat", impact: "毛利", elasticity: -0.03 },
    { signalKey: "usd_cny", name: "美元兑人民币", category: "汇率", value: 7.18, unit: "CNY/USD", asOf: "2026-06-15", source: "中国外汇交易中心", trend: "up", impact: "出口营收", elasticity: 0.9 },
    { signalKey: "ev_demand_index", name: "新能源车需求指数", category: "需求", value: 112.4, unit: "index(2025=100)", asOf: "2026-06-01", source: "乘联会", trend: "up", impact: "需求", elasticity: 0.6 },
    { signalKey: "ess_subsidy_signal", name: "储能补贴政策强度", category: "政策", value: 0.72, unit: "0–1", asOf: "2026-06-10", source: "发改委公告解析", trend: "up", impact: "需求", elasticity: 0.25 },
    { signalKey: "industrial_power_price", name: "工业电价", category: "能源", value: 0.78, unit: "元/kWh", asOf: "2026-06-01", source: "国网", trend: "flat", impact: "成本", elasticity: 0.12 },
  ],
};

class StaticAdapter extends RowsAdapter {
  constructor(private data: Record<string, Record<string, unknown>[]>) {
    super();
  }

  protected async loadAll(): Promise<Record<string, Record<string, unknown>[]>> {
    return this.data;
  }
}

export function createAdapter(
  connectorTypeKey: string,
  config: Record<string, unknown>,
  blob: BlobStore,
  fetchImpl: typeof fetch = fetch,
): SourceAdapter {
  switch (connectorTypeKey) {
    case "file_upload":
      return new FileUploadAdapter(blob, config as { blobKey: string; format: string; datasetName: string });
    case "rest_api":
      return new RestApiAdapter(config as { url: string; datasetName?: string }, fetchImpl);
    case "mock_erp":
      return new StaticAdapter(MOCK_ERP_DATA);
    case "mock_crm":
      return new StaticAdapter(MOCK_CRM_DATA);
    case "mock_external":
      return new StaticAdapter(MOCK_EXTERNAL_DATA);
    default:
      throw validationError(
        `connector type '${connectorTypeKey}' is registered but has no adapter implementation yet`,
      );
  }
}
