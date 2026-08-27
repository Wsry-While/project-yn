import type { SupabaseClient } from '@supabase/supabase-js';
import type { BiddingFileRef, BiddingScreenshot } from '@/lib/domain/types';
import { mapBiddingScreenshot, type BiddingScreenshotRow } from '@/lib/domain/mappers';

export interface BiddingScreenshotListFilter {
  search?: string;
  completionStatus?: string;
  salesManager?: string;
  overdue?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface BiddingScreenshotInput {
  salesManager: string;
  salesManagerId?: string | null;
  projectName: string;
  projectSchool: string;
  projectSecondaryUnit?: string | null;
  isCompanyParameter?: boolean;
  submissionDate: string;
  dueDeliveryDate?: string | null;
  reservedDays?: number | null;
  projectBiddingFile?: BiddingFileRef | null;
  projectCategory?: string[] | null;
  projectCategoryNorm?: string[] | null;
  screenshotRequirement?: string | null;
  assignedProjectManager?: string | null;
  assignedPmId?: string | null;
  completionStatus?: string | null;
  completionStatusNorm?: string | null;
  deliveryDocument?: BiddingFileRef | null;
  deliveryRemark?: string | null;
  isMeetScreenshotRequirement?: boolean | null;
  salesFeedback?: string | null;
  attachments?: BiddingFileRef[];
  rectificationFeedback?: string | null;
  rectifiedDocument?: BiddingFileRef | null;
  externalId: string;
  externalSource: string;
  externalSerial?: string | null;
  externalOp?: string | null;
  externalOperator?: string | null;
  rawPayload?: unknown;
  rawMeta?: Record<string, unknown> | null;
}

function dateOnly(value: string): string {
  // value 可能是 ISO（带 Z 或时区）或 YYYY-MM-DD，统一截取 YYYY-MM-DD，
  // 不走 new Date()，避免 UTC 时区把本地日期前移一天。
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : value.slice(0, 10);
}

export class BiddingScreenshotService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: BiddingScreenshotListFilter = {}): Promise<{ rows: BiddingScreenshot[]; total: number }> {
    let q = this.db
      .from('bidding_screenshots')
      .select('*', { count: 'exact' })
      .order('due_delivery_date', { ascending: true, nullsFirst: false })
      .order('submission_date', { ascending: false });

    if (!filter.includeDeleted) q = q.is('deleted_at', null);
    if (filter.completionStatus) q = q.eq('completion_status', filter.completionStatus);
    if (filter.salesManager) q = q.eq('sales_manager', filter.salesManager);
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      // project_category 是 text[]，不能直接 ilike；按需求仅搜索常见文本字段
      q = q.or(
        `project_name.ilike.${pattern},project_school.ilike.${pattern},sales_manager.ilike.${pattern},assigned_project_manager.ilike.${pattern},project_secondary_unit.ilike.${pattern},screenshot_requirement.ilike.${pattern}`,
      );
    }
    if (filter.overdue) {
      const today = new Date().toISOString().slice(0, 10);
      q = q.lt('due_delivery_date', today).neq('completion_status', '已完成').neq('completion_status', '已交付');
    }
    if (filter.limit) {
      q = q.range(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit - 1);
    }
    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: (data as BiddingScreenshotRow[]).map(mapBiddingScreenshot), total: count ?? 0 };
  }

  async getById(id: string): Promise<BiddingScreenshot | null> {
    const { data, error } = await this.db
      .from('bidding_screenshots')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapBiddingScreenshot(data as BiddingScreenshotRow) : null;
  }

  async findByExternalId(source: string, externalId: string): Promise<BiddingScreenshot | null> {
    const { data, error } = await this.db
      .from('bidding_screenshots')
      .select('*')
      .eq('external_source', source)
      .eq('external_id', externalId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapBiddingScreenshot(data as BiddingScreenshotRow) : null;
  }

  private buildRow(input: BiddingScreenshotInput, schoolId: string | null): Record<string, unknown> {
    return {
      external_id: input.externalId,
      external_source: input.externalSource,
      external_serial: input.externalSerial ?? null,
      external_op: input.externalOp ?? null,
      external_operator: input.externalOperator ?? null,
      raw_payload: (input.rawPayload ?? null) as Record<string, unknown> | null,
      raw_meta: (input.rawMeta ?? null) as Record<string, unknown> | null,
      synced_at: new Date().toISOString(),
      deleted_at: null,
      sales_manager: input.salesManager.trim().slice(0, 100),
      project_name: input.projectName.trim().slice(0, 200),
      project_school: input.projectSchool.trim().slice(0, 200),
      project_secondary_unit: input.projectSecondaryUnit?.trim() || null,
      is_company_parameter: input.isCompanyParameter ?? false,
      submission_date: dateOnly(input.submissionDate),
      due_delivery_date: input.dueDeliveryDate ? dateOnly(input.dueDeliveryDate) : null,
      reserved_days: input.reservedDays ?? null,
      project_bidding_file: input.projectBiddingFile ?? null,
      project_category: input.projectCategory ?? [],
      project_category_norm: input.projectCategoryNorm ?? input.projectCategory ?? [],
      screenshot_requirement: input.screenshotRequirement?.trim() || null,
      assigned_project_manager: input.assignedProjectManager?.trim() || null,
      completion_status: input.completionStatus?.trim() || null,
      completion_status_norm: input.completionStatusNorm ?? (input.completionStatus?.trim() || null),
      delivery_document: input.deliveryDocument ?? null,
      delivery_remark: input.deliveryRemark?.trim() || null,
      is_meet_screenshot_requirement: input.isMeetScreenshotRequirement ?? null,
      sales_feedback: input.salesFeedback?.trim() || null,
      attachments: input.attachments ?? [],
      rectification_feedback: input.rectificationFeedback?.trim() || null,
      rectified_document: input.rectifiedDocument ?? null,
      school_id: schoolId,
      sales_manager_id: input.salesManagerId ?? null,
      assigned_pm_id: input.assignedPmId ?? null,
    };
  }

  async upsertFromExternal(input: BiddingScreenshotInput, schoolId: string | null): Promise<{ row: BiddingScreenshot; created: boolean }> {
    const existing = await this.findByExternalId(input.externalSource, input.externalId);
    const row = this.buildRow(input, schoolId);
    if (existing) {
      const { data, error } = await this.db
        .from('bidding_screenshots')
        .update(row)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return { row: mapBiddingScreenshot(data as BiddingScreenshotRow), created: false };
    }
    try {
      const { data, error } = await this.db
        .from('bidding_screenshots')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return { row: mapBiddingScreenshot(data as BiddingScreenshotRow), created: true };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const retry = await this.findByExternalId(input.externalSource, input.externalId);
        if (retry) {
          const { data, error } = await this.db
            .from('bidding_screenshots')
            .update(row)
            .eq('id', retry.id)
            .select()
            .single();
          if (error) throw error;
          return { row: mapBiddingScreenshot(data as BiddingScreenshotRow), created: false };
        }
      }
      throw err;
    }
  }

  async softDeleteByExternal(source: string, externalId: string): Promise<BiddingScreenshot | null> {
    const existing = await this.findByExternalId(source, externalId);
    if (!existing) return null;
    const { data, error } = await this.db
      .from('bidding_screenshots')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return mapBiddingScreenshot(data as BiddingScreenshotRow);
  }

  async recoverByExternal(source: string, externalId: string): Promise<BiddingScreenshot | null> {
    const existing = await this.findByExternalId(source, externalId);
    if (!existing) return null;
    const { data, error } = await this.db
      .from('bidding_screenshots')
      .update({ deleted_at: null })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return mapBiddingScreenshot(data as BiddingScreenshotRow);
  }
}
