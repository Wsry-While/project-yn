import type { SupabaseClient } from '@supabase/supabase-js';
import type { QimingConstruction, QimingConstructionInput } from './types';
import { mapQimingConstruction, type QimingConstructionRow } from './qiming-construction-mapper';
import { sanitizeRichText } from './sanitize';

export class QimingConstructionService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: {
    search?: string;
    year?: string;
    salesManager?: string;
    school?: string;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ rows: QimingConstruction[]; total: number }> {
    const limit = Math.min(filter.limit ?? 100, 500);
    const offset = filter.offset ?? 0;

    let q = this.db.from('qiming_construction').select('*', { count: 'exact' });
    if (!filter.includeDeleted) q = q.is('deleted_at', null);
    if (filter.year) q = q.eq('project_year', filter.year);
    if (filter.salesManager) q = q.eq('sales_manager', filter.salesManager);
    if (filter.school) q = q.ilike('school', `%${filter.school}%`);
    if (filter.search) {
      const k = `%${filter.search}%`;
      const orQuery = [
        `school.ilike.${k}`,
        `college.ilike.${k}`,
        `project_name.ilike.${k}`,
        `sales_manager.ilike.${k}`,
        `project_manager.ilike.${k}`,
        `build_major.ilike.${k}`,
      ].join(',');
      q = q.or(orQuery);
    }

    const { data, error, count } = await q
      .order('project_delivery_time', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`查询启明星建设失败: ${error.message}`);
    return {
      rows: (data as QimingConstructionRow[] | null)?.map(mapQimingConstruction) ?? [],
      total: count ?? 0,
    };
  }

  async getById(id: string): Promise<QimingConstruction | null> {
    const { data, error } = await this.db
      .from('qiming_construction')
      .select('*')
      .eq('id', id)
      .maybeSingle<QimingConstructionRow>();
    if (error) throw new Error(`查询启明星建设失败: ${error.message}`);
    return data ? mapQimingConstruction(data) : null;
  }

  async findByExternalId(externalSource: string, externalId: string): Promise<QimingConstruction | null> {
    const { data, error } = await this.db
      .from('qiming_construction')
      .select('*')
      .eq('external_source', externalSource)
      .eq('external_id', externalId)
      .is('deleted_at', null)
      .maybeSingle<QimingConstructionRow>();
    if (error) throw new Error(`查询启明星建设失败: ${error.message}`);
    return data ? mapQimingConstruction(data) : null;
  }

  async upsertFromExternal(input: QimingConstructionInput): Promise<{ row: QimingConstruction; created: boolean }> {
    const existing = await this.findByExternalId(input.externalSource, input.externalId);
    const cleanedBuildContent = input.buildContentHtml
      ? sanitizeRichText({ html: input.buildContentHtml, text: input.buildContentText })
      : null;
    const cleanedSpecialDesc = input.buildSpecialDescHtml
      ? sanitizeRichText({ html: input.buildSpecialDescHtml, text: input.buildSpecialDescText })
      : null;

    const dbRow = {
      external_source: input.externalSource,
      external_id: input.externalId,
      external_op: input.externalOp ?? null,
      external_serial: input.externalSerial ?? null,
      external_operator: input.externalOperator ?? null,
      sales_manager: input.salesManager,
      project_year: input.projectYear,
      project_name: input.projectName,
      is_sign_contract: input.isSignContract,
      school: input.school,
      college: input.college,
      school_level: input.schoolLevel,
      build_major: input.buildMajor,
      build_content_html: cleanedBuildContent?.html ?? null,
      build_content_text: cleanedBuildContent?.text ?? input.buildContentText,
      build_special_desc_html: cleanedSpecialDesc?.html ?? null,
      build_special_desc_text: cleanedSpecialDesc?.text ?? input.buildSpecialDescText,
      project_materials: input.projectMaterials,
      project_delivery_time: input.projectDeliveryTime,
      project_manager: input.projectManager,
      project_status_feedback: input.projectStatusFeedback,
      raw_payload: (input.rawPayload ?? null) as Record<string, unknown> | null,
      raw_meta: (input.rawMeta ?? null) as Record<string, unknown> | null,
      synced_at: new Date().toISOString(),
      deleted_at: null,
    };

    if (existing) {
      const { data, error } = await this.db
        .from('qiming_construction')
        .update(dbRow)
        .eq('id', existing.id)
        .select()
        .single<QimingConstructionRow>();
      if (error) throw new Error(`更新启明星建设失败: ${error.message}`);
      return { row: mapQimingConstruction(data), created: false };
    }
    const { data, error } = await this.db
      .from('qiming_construction')
      .insert(dbRow)
      .select()
      .single<QimingConstructionRow>();
    if (error) throw new Error(`创建启明星建设失败: ${error.message}`);
    return { row: mapQimingConstruction(data), created: true };
  }

  async softDeleteByExternal(externalSource: string, externalId: string): Promise<QimingConstruction | null> {
    const existing = await this.findByExternalId(externalSource, externalId);
    if (!existing) return null;
    const { data, error } = await this.db
      .from('qiming_construction')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single<QimingConstructionRow>();
    if (error) throw new Error(`软删除启明星建设失败: ${error.message}`);
    return mapQimingConstruction(data);
  }

  async recoverByExternal(externalSource: string, externalId: string): Promise<QimingConstruction | null> {
    const { data, error } = await this.db
      .from('qiming_construction')
      .update({ deleted_at: null })
      .eq('external_source', externalSource)
      .eq('external_id', externalId)
      .select()
      .single<QimingConstructionRow>();
    if (error) {
      if (/no rows/i.test(error.message)) return null;
      throw new Error(`恢复启明星建设失败: ${error.message}`);
    }
    return mapQimingConstruction(data);
  }
}
