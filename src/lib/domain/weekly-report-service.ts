import { getAdminSupabase } from './api-utils';

export interface WeeklyDateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: number;
}

export interface WeeklyReportData {
  range: WeeklyDateRange;
  generatedAt: string;
  summary: {
    totalTrips: number;
    completedTrips: number;
    newBidding: number;
    newDemands: number;
    newQiming: number;
    overdueBidding: number;
    overdueDemands: number;
    avgScore: number | null;
  };
  trips: Array<{
    id: string;
    school: string | null;
    supportType: string | null;
    topic: string | null;
    tripDate: string | null;
    salesManager: string | null;
    projectManager: string | null;
    overallScore: number | null;
    overallComment: string | null;
    isCompleted: boolean | null;
  }>;
  bidding: Array<{
    id: string;
    projectName: string | null;
    school: string | null;
    salesManager: string | null;
    submissionDate: string | null;
    dueDeliveryDate: string | null;
    completionStatus: string | null;
    isMeet: boolean | null;
  }>;
  demands: Array<{
    id: string;
    company: string | null;
    demandType: string | null;
    salesManager: string | null;
    requiredFinishDate: string | null;
    completionStatus: string | null;
  }>;
  qiming: Array<{
    id: string;
    projectName: string | null;
    school: string | null;
    salesManager: string | null;
    deliveryTime: string | null;
    isSignContract: boolean | null;
    statusFeedback: string | null;
  }>;
  risks: Array<{ level: string; title: string; detail: string }>;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isOverdue(due: string | null, status: string | null): boolean {
  if (!due) return false;
  if (status && ['已完成', '已交付', '完成', '已结项'].some((k) => status.includes(k))) return false;
  return new Date(due) < new Date();
}

export class WeeklyReportService {
  static resolveRange(input?: { startDate?: string; endDate?: string; days?: number }): WeeklyDateRange {
    const days = input?.days && input.days > 0 && input.days <= 90 ? input.days : 7;
    if (input?.startDate) {
      const start = new Date(input.startDate);
      const end = input.endDate ? new Date(input.endDate) : new Date(start.getTime() + (days - 1) * 86400000);
      return { startDate: toYmd(start), endDate: toYmd(end), days: Math.round((end.getTime() - start.getTime()) / 86400000) + 1 };
    }
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    return { startDate: toYmd(start), endDate: toYmd(end), days };
  }

  static async build(filter?: {
    startDate?: string;
    endDate?: string;
    days?: number;
    salesManagerId?: string;
    schoolId?: string;
  }): Promise<WeeklyReportData> {
    const admin = getAdminSupabase();
    const range = this.resolveRange(filter);
    const start = `${range.startDate}T00:00:00`;
    const end = `${range.endDate}T23:59:59`;

    const salesFilter = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
      filter?.salesManagerId ? q.eq('sales_manager_id', filter.salesManagerId) : q;
    const schoolFilter = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
      filter?.schoolId ? q.eq('school_id', filter.schoolId) : q;

    const [tripRes, bidRes, demandRes, qimingRes] = await Promise.all([
      schoolFilter(
        salesFilter(
          admin
            .from('trip_requests')
            .select(
              'id, school_name, support_type, trip_topic, trip_date, sales_manager_name, project_manager_name, overall_score, overall_feedback_text, is_completed',
            )
            .is('deleted_at', null)
            .gte('trip_date', start)
            .lte('trip_date', end)
            .order('trip_date', { ascending: false })
            .limit(200),
        ),
      ),
      schoolFilter(
        salesFilter(
          admin
            .from('bidding_screenshots')
            .select(
              'id, project_name, project_school, sales_manager, submission_date, due_delivery_date, completion_status, is_meet_screenshot_requirement',
            )
            .is('deleted_at', null)
            .gte('created_at', start)
            .lte('created_at', end)
            .limit(200),
        ),
      ),
      schoolFilter(
        salesFilter(
          admin
            .from('project_demands')
            .select(
              'id, company, demand_type, sales_manager, required_finish_date, completion_status',
            )
            .is('deleted_at', null)
            .gte('created_at', start)
            .lte('created_at', end)
            .limit(200),
        ),
      ),
      schoolFilter(
        salesFilter(
          admin
            .from('qiming_construction')
            .select(
              'id, project_name, school, sales_manager, project_delivery_time, is_sign_contract, project_status_feedback',
            )
            .is('deleted_at', null)
            .gte('created_at', start)
            .lte('created_at', end)
            .limit(200),
        ),
      ),
    ]);

    const trips = (tripRes.data ?? []) as Array<Record<string, unknown>>;
    const biddings = (bidRes.data ?? []) as Array<Record<string, unknown>>;
    const demands = (demandRes.data ?? []) as Array<Record<string, unknown>>;
    const qimings = (qimingRes.data ?? []) as Array<Record<string, unknown>>;

    const scores = trips.map((t) => t.overall_score).filter((v): v is number => typeof v === 'number' && v > 0);
    const avgScore = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;

    const overdueBidding = biddings.filter((r) =>
      isOverdue(r.due_delivery_date ? String(r.due_delivery_date) : null, (r.completion_status as string) ?? null),
    ).length;
    const overdueDemands = demands.filter((r) =>
      isOverdue(r.required_finish_date ? String(r.required_finish_date) : null, (r.completion_status as string) ?? null),
    ).length;

    const risks: WeeklyReportData['risks'] = [];
    if (overdueBidding) risks.push({ level: 'high', title: '招投标逾期', detail: `${overdueBidding} 条招投标已过交付期但未完成` });
    if (overdueDemands) risks.push({ level: 'high', title: '建设申请逾期', detail: `${overdueDemands} 条建设申请已过要求完成时间但未完成` });
    for (const q of qimings) {
      if (q.is_sign_contract === false && q.project_delivery_time) {
        const d = new Date(String(q.project_delivery_time)).getTime() - Date.now();
        if (d < 30 * 86400000) {
          risks.push({
            level: 'medium',
            title: '启明星未签合同',
            detail: `${String(q.project_name ?? '')} 临近交付但未签合同`,
          });
        }
      }
    }
    for (const t of trips) {
      if (typeof t.overall_score === 'number' && t.overall_score > 0 && t.overall_score <= 2) {
        risks.push({
          level: 'medium',
          title: '外出低评分',
          detail: `${String(t.school_name ?? '')} 评分 ${t.overall_score}`,
        });
      }
    }

    return {
      range,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTrips: trips.length,
        completedTrips: trips.filter((t) => t.is_completed === true).length,
        newBidding: biddings.length,
        newDemands: demands.length,
        newQiming: qimings.length,
        overdueBidding,
        overdueDemands,
        avgScore,
      },
      trips: trips.map((t) => ({
        id: t.id as string,
        school: (t.school_name as string) ?? null,
        supportType: (t.support_type as string) ?? null,
        topic: (t.trip_topic as string) ?? null,
        tripDate: t.trip_date ? String(t.trip_date) : null,
        salesManager: (t.sales_manager_name as string) ?? null,
        projectManager: (t.project_manager_name as string) ?? null,
        overallScore: (t.overall_score as number) ?? null,
        overallComment: (t.overall_feedback_text as string) ?? null,
        isCompleted: (t.is_completed as boolean) ?? null,
      })),
      bidding: biddings.map((b) => ({
        id: b.id as string,
        projectName: (b.project_name as string) ?? null,
        school: (b.project_school as string) ?? null,
        salesManager: (b.sales_manager as string) ?? null,
        submissionDate: b.submission_date ? String(b.submission_date) : null,
        dueDeliveryDate: b.due_delivery_date ? String(b.due_delivery_date) : null,
        completionStatus: (b.completion_status as string) ?? null,
        isMeet: (b.is_meet_screenshot_requirement as boolean) ?? null,
      })),
      demands: demands.map((d) => ({
        id: d.id as string,
        company: (d.company as string) ?? null,
        demandType: (d.demand_type as string) ?? null,
        salesManager: (d.sales_manager as string) ?? null,
        requiredFinishDate: d.required_finish_date ? String(d.required_finish_date) : null,
        completionStatus: (d.completion_status as string) ?? null,
      })),
      qiming: qimings.map((q) => ({
        id: q.id as string,
        projectName: (q.project_name as string) ?? null,
        school: (q.school as string) ?? null,
        salesManager: (q.sales_manager as string) ?? null,
        deliveryTime: q.project_delivery_time ? String(q.project_delivery_time) : null,
        isSignContract: (q.is_sign_contract as boolean) ?? null,
        statusFeedback: (q.project_status_feedback as string) ?? null,
      })),
      risks,
    };
  }
}
