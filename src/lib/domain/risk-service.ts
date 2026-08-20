import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 跨四大业务源的风险预警规则引擎。
 *
 * 所有规则都是无状态、只读：每次调用都重新查四张表，返回当前风险快照。
 * 风险等级：high（需立即处理） / medium（本周关注） / info（业务洞察）。
 */

export type RiskSeverity = 'high' | 'medium' | 'info';
export type RiskSource = 'bidding' | 'demand' | 'qiming' | 'trip' | 'cross';
export type RiskRuleCode =
  | 'BIDDING_OVERDUE'
  | 'BIDDING_RESERVED_LOW'
  | 'BIDDING_REQUIREMENT_MISS'
  | 'DEMAND_DUE_SOON'
  | 'DEMAND_OVERDUE'
  | 'QIMING_UNSIGNED_NEAR_DELIVERY'
  | 'QIMING_OVERDUE'
  | 'TRIP_LOW_SCORE'
  | 'TRIP_NEGATIVE_FEEDBACK'
  | 'CROSS_HIGH_VISIT_NO_PROJECT';

export interface RiskItem {
  id: string;
  ruleCode: RiskRuleCode;
  severity: RiskSeverity;
  source: RiskSource;
  title: string;
  detail: string;
  owner: string | null;
  school: string | null;
  date: string | null;
  url: string;
}

export interface RiskSummary {
  total: number;
  high: number;
  medium: number;
  info: number;
  bySource: Record<RiskSource, number>;
  items: RiskItem[];
}

const COMPLETED_KEYWORDS = ['已完成', '已交付', '已结项'];

function isOpenStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.trim();
  if (!s) return true;
  return !COMPLETED_KEYWORDS.some((k) => s.includes(k));
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDaysFromToday(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const NEGATIVE_PATTERNS = [/差/g, /不满/g, /投诉/g, /问题/g, /未解决/g, /待整改/g, /延迟/g, /拖延/g, /差$/];

function hasNegativeFeedback(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  return NEGATIVE_PATTERNS.some((re) => re.test(t));
}

export class RiskService {
  constructor(private readonly db: SupabaseClient) {}

  async list(opt?: { ownerId?: string; severity?: RiskSeverity }): Promise<RiskSummary> {
    const today = todayYmd();
    const in30 = addDaysYmd(30);

    const [biddingRes, demandRes, qimingRes, tripRes] = await Promise.all([
      this.db
        .from('bidding_screenshots')
        .select(
          'id, project_name, project_school, sales_manager, assigned_project_manager, submission_date, due_delivery_date, reserved_days, completion_status, is_meet_screenshot_requirement',
        )
        .is('deleted_at', null),
      this.db
        .from('project_demands')
        .select(
          'id, company, demand_type, product, sales_manager, project_manager, required_finish_date, completion_status',
        )
        .is('deleted_at', null),
      this.db
        .from('qiming_construction')
        .select(
          'id, project_name, school, sales_manager, project_manager, project_delivery_time, is_sign_contract, project_status_feedback, project_year',
        )
        .is('deleted_at', null),
      this.db
        .from('trip_requests')
        .select(
          'id, school_name, support_type, sales_manager_name, project_manager_name, trip_date, is_completed, overall_score, sales_score, overall_feedback_text, service_summary_text',
        )
        .is('deleted_at', null),
    ]);

    if (biddingRes.error) throw new Error(`查询招投标失败: ${biddingRes.error.message}`);
    if (demandRes.error) throw new Error(`查询建设申请失败: ${demandRes.error.message}`);
    if (qimingRes.error) throw new Error(`查询启明星失败: ${qimingRes.error.message}`);
    if (tripRes.error) throw new Error(`查询外出失败: ${tripRes.error.message}`);

    const bidRows = (biddingRes.data ?? []) as Array<Record<string, unknown>>;
    const demandRows = (demandRes.data ?? []) as Array<Record<string, unknown>>;
    const qimingRows = (qimingRes.data ?? []) as Array<Record<string, unknown>>;
    const tripRows = (tripRes.data ?? []) as Array<Record<string, unknown>>;

    const items: RiskItem[] = [];

    // 招投标
    for (const r of bidRows) {
      const id = r.id as string;
      const due = r.due_delivery_date as string | null;
      const status = r.completion_status as string | null;
      const reserved = r.reserved_days as number | null;
      const isOpen = isOpenStatus(status);

      if (isOpen && due && due < today) {
        items.push({
          id: `bid-overdue-${id}`,
          ruleCode: 'BIDDING_OVERDUE',
          severity: 'high',
          source: 'bidding',
          title: '招投标截图已逾期未交付',
          detail: `${String(r.project_name ?? '')} 应于 ${due} 交付，当前状态：${status ?? '未填'}`,
          owner: (r.assigned_project_manager as string) || (r.sales_manager as string) || null,
          school: (r.project_school as string) || null,
          date: due,
          url: `/bidding-screenshots?focus=${id}`,
        });
      } else if (isOpen && reserved !== null && reserved >= 0 && reserved <= 3) {
        items.push({
          id: `bid-reserved-${id}`,
          ruleCode: 'BIDDING_RESERVED_LOW',
          severity: 'medium',
          source: 'bidding',
          title: '招投标预留天数不足',
          detail: `${String(r.project_name ?? '')} 仅剩 ${reserved} 天预留期，截止 ${due ?? '—'}`,
          owner: (r.assigned_project_manager as string) || (r.sales_manager as string) || null,
          school: (r.project_school as string) || null,
          date: due,
          url: `/bidding-screenshots?focus=${id}`,
        });
      }

      if (r.is_meet_screenshot_requirement === false) {
        items.push({
          id: `bid-miss-${id}`,
          ruleCode: 'BIDDING_REQUIREMENT_MISS',
          severity: 'medium',
          source: 'bidding',
          title: '招投标截图未按需求完成',
          detail: `${String(r.project_name ?? '')} 销售反馈未满足截图需求`,
          owner: (r.sales_manager as string) || null,
          school: (r.project_school as string) || null,
          date: (r.submission_date as string) || null,
          url: `/bidding-screenshots?focus=${id}`,
        });
      }
    }

    // 建设申请
    for (const r of demandRows) {
      const id = r.id as string;
      const due = r.required_finish_date as string | null;
      const status = r.completion_status as string | null;
      const isOpen = isOpenStatus(status);
      if (!isOpen || !due) continue;
      const dDay = diffDaysFromToday(due);
      if (dDay === null) continue;      if (dDay < 0) {
        items.push({
          id: `demand-overdue-${id}`,
          ruleCode: 'DEMAND_OVERDUE',
          severity: 'high',
          source: 'demand',
          title: '项目建设申请已逾期',
          detail: `${String(r.company ?? '')} · ${String(r.demand_type ?? '')} 应于 ${due} 完成`,
          owner: (r.project_manager as string) || (r.sales_manager as string) || null,
          school: (r.company as string) || null,
          date: due,
          url: `/project-demands?focus=${id}`,
        });
      } else if (dDay <= 7) {
        items.push({
          id: `demand-soon-${id}`,
          ruleCode: 'DEMAND_DUE_SOON',
          severity: 'medium',
          source: 'demand',
          title: '项目建设申请 7 天内到期',
          detail: `${String(r.company ?? '')} · ${String(r.demand_type ?? '')} 还剩 ${dDay} 天`,
          owner: (r.project_manager as string) || (r.sales_manager as string) || null,
          school: (r.company as string) || null,
          date: due,
          url: `/project-demands?focus=${id}`,
        });
      }
    }

    // 启明星
    for (const r of qimingRows) {
      const id = r.id as string;
      const deliveryRaw = r.project_delivery_time as string | null;
      const deliveryDate = deliveryRaw ? deliveryRaw.slice(0, 10) : null;
      const isSigned = r.is_sign_contract as boolean | null;
      const feedback = r.project_status_feedback as string | null;
      const isOpen = isOpenStatus(feedback);
      if (!isOpen) continue;
      const dDay = diffDaysFromToday(deliveryDate);

      if (dDay !== null && dDay < 0) {
        items.push({
          id: `qiming-overdue-${id}`,
          ruleCode: 'QIMING_OVERDUE',
          severity: 'high',
          source: 'qiming',
          title: '启明星建设已过交付期',
          detail: `${String(r.project_name ?? '')} 应于 ${deliveryDate} 交付`,
          owner: (r.project_manager as string) || (r.sales_manager as string) || null,
          school: (r.school as string) || null,
          date: deliveryDate,
          url: `/qiming-construction?focus=${id}`,
        });
      } else if (dDay !== null && dDay <= 30 && isSigned === false) {
        items.push({
          id: `qiming-unsigned-${id}`,
          ruleCode: 'QIMING_UNSIGNED_NEAR_DELIVERY',
          severity: 'medium',
          source: 'qiming',
          title: '启明星临近交付但未签合同',
          detail: `${String(r.project_name ?? '')} ${dDay} 天后交付，合同状态：未签`,
          owner: (r.sales_manager as string) || null,
          school: (r.school as string) || null,
          date: deliveryDate,
          url: `/qiming-construction?focus=${id}`,
        });
      }
    }

    // 外出
    for (const r of tripRows) {
      const id = r.id as string;
      const overall = r.overall_score as number | null;
      const salesScore = r.sales_score as number | null;
      const feedback = (r.overall_feedback_text as string) || (r.service_summary_text as string) || null;
      if (overall !== null && overall <= 2) {
        items.push({
          id: `trip-score-${id}`,
          ruleCode: 'TRIP_LOW_SCORE',
          severity: 'medium',
          source: 'trip',
          title: '外出服务评分偏低',
          detail: `${String(r.school_name ?? '')} · ${String(r.support_type ?? '')} 综合评分 ${overall}${salesScore ? ` / 销售评分 ${salesScore}` : ''}`,
          owner: (r.project_manager_name as string) || (r.sales_manager_name as string) || null,
          school: (r.school_name as string) || null,
          date: (r.trip_date as string) || null,
          url: `/trips?focus=${id}`,
        });
      } else if (hasNegativeFeedback(feedback)) {
        items.push({
          id: `trip-neg-${id}`,
          ruleCode: 'TRIP_NEGATIVE_FEEDBACK',
          severity: 'medium',
          source: 'trip',
          title: '外出反馈包含负面关键词',
          detail: `${String(r.school_name ?? '')}：${(feedback ?? '').slice(0, 60)}`,
          owner: (r.project_manager_name as string) || (r.sales_manager_name as string) || null,
          school: (r.school_name as string) || null,
          date: (r.trip_date as string) || null,
          url: `/trips?focus=${id}`,
        });
      }
    }

    // 跨源洞察：30 天内外出≥2 次但没有招投标 / 建设 / 启明星记录
    const schoolVisit30 = new Map<string, number>();
    for (const r of tripRows) {
      const tripDate = (r.trip_date as string) || '';
      if (tripDate && tripDate >= in30) {
        const school = ((r.school_name as string) || '').trim();
        if (school) schoolVisit30.set(school, (schoolVisit30.get(school) ?? 0) + 1);
      }
    }
    const projectSchools = new Set<string>();
    for (const r of bidRows) {
      const s = ((r.project_school as string) || '').trim();
      if (s) projectSchools.add(s);
    }
    for (const r of demandRows) {
      const s = ((r.company as string) || '').trim();
      if (s) projectSchools.add(s);
    }
    for (const r of qimingRows) {
      const s = ((r.school as string) || '').trim();
      if (s) projectSchools.add(s);
    }
    for (const [school, count] of schoolVisit30) {
      if (count >= 2 && !projectSchools.has(school)) {
        items.push({
          id: `cross-visit-${school}`,
          ruleCode: 'CROSS_HIGH_VISIT_NO_PROJECT',
          severity: 'info',
          source: 'cross',
          title: '高频上门但未落地项目',
          detail: `${school} 近 30 天内外出 ${count} 次，但暂无招投标 / 建设 / 启明星记录`,
          owner: null,
          school,
          date: null,
          url: `/trips?search=${encodeURIComponent(school)}`,
        });
      }
    }

    const filtered = items.filter((it) => {
      if (opt?.severity && it.severity !== opt.severity) return false;
      // ownerId 过滤需要通过 sales/manager 关联，这里基于姓名字面量做最朴素过滤
      if (opt?.ownerId) {
        // 未实现 ownerId → name 的反查；仅返回与 ownerId 字面匹配的（通常 owner 是名字字符串）
        return it.owner === opt.ownerId;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const sevWeight: Record<RiskSeverity, number> = { high: 0, medium: 1, info: 2 };
      if (sevWeight[a.severity] !== sevWeight[b.severity]) {
        return sevWeight[a.severity] - sevWeight[b.severity];
      }
      const ad = a.date ?? '';
      const bd = b.date ?? '';
      return ad < bd ? 1 : ad > bd ? -1 : 0;
    });

    return summarize(filtered);
  }
}

function summarize(items: RiskItem[]): RiskSummary {
  const summary: RiskSummary = {
    total: items.length,
    high: 0,
    medium: 0,
    info: 0,
    bySource: { bidding: 0, demand: 0, qiming: 0, trip: 0, cross: 0 },
    items,
  };
  for (const it of items) {
    summary[it.severity] += 1;
    summary.bySource[it.source] += 1;
  }
  return summary;
}
