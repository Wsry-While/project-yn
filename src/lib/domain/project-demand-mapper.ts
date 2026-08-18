import type { ProjectDemand } from './types';

export type ProjectDemandRow = {
  id: string;
  external_source: string;
  external_id: string | null;
  external_op: string | null;
  external_serial: string | null;
  external_operator: string | null;
  project_year: string | null;
  sales_manager: string | null;
  demand_type: string | null;
  product: unknown;
  company: string | null;
  industry_category: string | null;
  demand_desc_html: string | null;
  demand_desc_text: string | null;
  provided_materials: unknown;
  required_finish_date: string | null;
  project_manager: string | null;
  completion_status: string | null;
  estimated_finish_date: string | null;
  delivery_content: string | null;
  other_delivery_content: string | null;
  delivery_doc_type: unknown;
  delivery_docs: unknown;
  delivery_remark: string | null;
  raw_payload: unknown;
  raw_meta: unknown;
  synced_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbResult = { data: unknown; error: { message: string } | null };

function mapFileArray(value: unknown): ProjectDemand['providedMaterials'] {
  if (!Array.isArray(value)) return [];
  // 复用 BiddingScreenshot 的 mapper 不便，这里就地最小实现
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      name: typeof x.name === 'string' ? x.name : null,
      url: typeof x.url === 'string' ? x.url : null,
      objectId: typeof x.objectId === 'string' ? x.objectId : null,
      resid: typeof x.resid === 'string' ? x.resid : null,
      suffix: typeof x.suffix === 'string' ? x.suffix : null,
      size: typeof x.size === 'string' ? x.size : null,
      byteSize: typeof x.byteSize === 'number' ? x.byteSize : null,
      type: typeof x.type === 'string' ? x.type : null,
      assetId: typeof x.assetId === 'string' ? x.assetId : null,
      bucket: typeof x.bucket === 'string' ? x.bucket : null,
      storageKey: typeof x.storageKey === 'string' ? x.storageKey : null,
      storageStatus: (['pending', 'fetching', 'stored', 'failed'].includes(String(x.storageStatus))
        ? x.storageStatus
        : null) as ProjectDemand['providedMaterials'][number]['storageStatus'],
      storedAt: typeof x.storedAt === 'string' ? x.storedAt : null,
      storageError: typeof x.storageError === 'string' ? x.storageError : null,
    }));
}

function mapStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}

/** Postgres 里可能以数组 / JSON 字符串 / 逗号分隔字符串三种形式返回，统一收敛成 string[] */
function mapStringArrayFlexible(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
      } catch {
        // fall through
      }
    }
    return trimmed.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function mapProjectDemand(row: ProjectDemandRow): ProjectDemand {
  return {
    id: row.id,
    externalSource: row.external_source,
    externalId: row.external_id,
    externalOp: row.external_op,
    externalSerial: row.external_serial,
    externalOperator: row.external_operator,
    projectYear: row.project_year,
    salesManager: row.sales_manager,
    demandType: row.demand_type,
    product: mapStringArrayFlexible(row.product),
    company: row.company,
    industryCategory: row.industry_category,
    demandDescHtml: row.demand_desc_html,
    demandDescText: row.demand_desc_text,
    providedMaterials: mapFileArray(row.provided_materials),
    requiredFinishDate: row.required_finish_date,
    projectManager: row.project_manager,
    completionStatus: row.completion_status,
    estimatedFinishDate: row.estimated_finish_date,
    deliveryContent: row.delivery_content,
    otherDeliveryContent: row.other_delivery_content,
    deliveryDocType: mapStringArray(row.delivery_doc_type),
    deliveryDocs: mapFileArray(row.delivery_docs),
    deliveryRemark: row.delivery_remark,
    rawPayload: (row.raw_payload ?? null) as Record<string, unknown> | null,
    rawMeta: (row.raw_meta ?? null) as Record<string, unknown> | null,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 这里用最小接口约束，避免在 mapper 层依赖 supabase 类型
type AnyDb = {
  from(table: string): {
    select(query?: string): {
      eq(col: string, val: unknown): { maybeSingle<T>(): Promise<{ data: T | null; error: { message: string } | null }> };
      order(col: string, opts?: { ascending?: boolean }): { range(from: number, to: number): Promise<DbResult> };
      ilike(col: string, val: string): { eq(col2: string, val2: unknown): { order(col: string, opts?: { ascending?: boolean }): { range(from: number, to: number): Promise<DbResult> } } };
      or(query: string): { order(col: string, opts?: { ascending?: boolean }): { range(from: number, to: number): Promise<DbResult> } };
    };
    insert(row: unknown): { select(): { single<T>(): Promise<{ data: T | null; error: { message: string } | null }> } };
    update(row: unknown): { eq(col: string, val: unknown): { select(): { single<T>(): Promise<{ data: T | null; error: { message: string } | null }> } } };
  };
};
