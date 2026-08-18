import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectDemand, ProjectDemandInput } from './types';
import { mapProjectDemand, type ProjectDemandRow } from './project-demand-mapper';
import { sanitizeRichText } from './sanitize';

export class ProjectDemandService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: {
    search?: string;
    year?: string;
    salesManager?: string;
    completionStatus?: string;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ rows: ProjectDemand[]; total: number }> {
    const limit = Math.min(filter.limit ?? 100, 500);
    const offset = filter.offset ?? 0;

    let q = this.db.from('project_demands').select('*', { count: 'exact' });
    if (!filter.includeDeleted) q = q.is('deleted_at', null);
    if (filter.year) q = q.eq('project_year', filter.year);
    if (filter.salesManager) q = q.eq('sales_manager', filter.salesManager);
    if (filter.completionStatus) q = q.eq('completion_status', filter.completionStatus);
    if (filter.search) {
      const k = `%${filter.search}%`;
      const orQuery = [
        `company.ilike.${k}`,
        `sales_manager.ilike.${k}`,
        `project_manager.ilike.${k}`,
        `demand_type.ilike.${k}`,
        `product.ilike.${k}`,
      ].join(',');
      q = q.or(orQuery);
    }
    const { data, error, count } = await q
      .order('required_finish_date', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`查询项目建设申请失败: ${error.message}`);
    return { rows: (data as ProjectDemandRow[] | null)?.map(mapProjectDemand) ?? [], total: count ?? 0 };
  }

  async getById(id: string): Promise<ProjectDemand | null> {
    const { data, error } = await this.db
      .from('project_demands')
      .select('*')
      .eq('id', id)
      .maybeSingle<ProjectDemandRow>();
    if (error) throw new Error(`查询项目建设申请失败: ${error.message}`);
    return data ? mapProjectDemand(data) : null;
  }

  async findByExternalId(externalSource: string, externalId: string): Promise<ProjectDemand | null> {
    const { data, error } = await this.db
      .from('project_demands')
      .select('*')
      .eq('external_source', externalSource)
      .eq('external_id', externalId)
      .is('deleted_at', null)
      .maybeSingle<ProjectDemandRow>();
    if (error) throw new Error(`查询项目建设申请失败: ${error.message}`);
    return data ? mapProjectDemand(data) : null;
  }

  async upsertFromExternal(input: ProjectDemandInput): Promise<{ row: ProjectDemand; created: boolean }> {
    const existing = await this.findByExternalId(input.externalSource, input.externalId);
    const cleanedDemand = input.demandDescHtml
      ? sanitizeRichText({ html: input.demandDescHtml, text: input.demandDescText })
      : null;
    const dbRow = {
      external_source: input.externalSource,
      external_id: input.externalId,
      external_op: input.externalOp ?? null,
      external_serial: input.externalSerial ?? null,
      external_operator: input.externalOperator ?? null,
      project_year: input.projectYear,
      sales_manager: input.salesManager,
      demand_type: input.demandType,
      product: input.product,
      company: input.company,
      industry_category: input.industryCategory,
      demand_desc_html: cleanedDemand?.html ?? null,
      demand_desc_text: cleanedDemand?.text ?? input.demandDescText,
      provided_materials: input.providedMaterials,
      required_finish_date: input.requiredFinishDate,
      project_manager: input.projectManager,
      completion_status: input.completionStatus,
      estimated_finish_date: input.estimatedFinishDate,
      delivery_content: input.deliveryContent,
      other_delivery_content: input.otherDeliveryContent,
      delivery_doc_type: input.deliveryDocType,
      delivery_docs: input.deliveryDocs,
      delivery_remark: input.deliveryRemark,
      raw_payload: (input.rawPayload ?? null) as Record<string, unknown> | null,
      raw_meta: (input.rawMeta ?? null) as Record<string, unknown> | null,
      synced_at: new Date().toISOString(),
      deleted_at: null,
    };

    if (existing) {
      const { data, error } = await this.db
        .from('project_demands')
        .update(dbRow)
        .eq('id', existing.id)
        .select()
        .single<ProjectDemandRow>();
      if (error) throw new Error(`更新项目建设申请失败: ${error.message}`);
      return { row: mapProjectDemand(data), created: false };
    }
    const { data, error } = await this.db
      .from('project_demands')
      .insert(dbRow)
      .select()
      .single<ProjectDemandRow>();
    if (error) throw new Error(`创建项目建设申请失败: ${error.message}`);
    return { row: mapProjectDemand(data), created: true };
  }

  async softDeleteByExternal(externalSource: string, externalId: string): Promise<ProjectDemand | null> {
    const existing = await this.findByExternalId(externalSource, externalId);
    if (!existing) return null;
    const { data, error } = await this.db
      .from('project_demands')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single<ProjectDemandRow>();
    if (error) throw new Error(`软删除项目建设申请失败: ${error.message}`);
    return mapProjectDemand(data);
  }

  async recoverByExternal(externalSource: string, externalId: string): Promise<ProjectDemand | null> {
    const { data, error } = await this.db
      .from('project_demands')
      .update({ deleted_at: null })
      .eq('external_source', externalSource)
      .eq('external_id', externalId)
      .select()
      .single<ProjectDemandRow>();
    if (error) {
      if (/no rows/i.test(error.message)) return null;
      throw new Error(`恢复项目建设申请失败: ${error.message}`);
    }
    return mapProjectDemand(data);
  }
}
