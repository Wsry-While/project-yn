import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requireString } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';

/**
 * GET /api/trips?schoolId=&projectId=&supportType=&year=&from=&to=
 * 项目外出申请列表
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const p = request.nextUrl.searchParams;
    const service = new TripService(getAdminSupabase());
    const data = await service.list({
      schoolId: p.get('schoolId') ?? undefined,
      projectId: p.get('projectId') ?? undefined,
      supportType: p.get('supportType') ?? undefined,
      year: p.get('year') ? Number(p.get('year')) : undefined,
      from: p.get('from') ?? undefined,
      to: p.get('to') ?? undefined,
      limit: p.get('limit') ? Number(p.get('limit')) : 200,
    });
    return ok(data);
  });
}

/**
 * POST /api/trips
 * 创建一条外出申请。字段对齐 Excel 模板，必填字段使用 requireString。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let schoolName = requireString(body.schoolName, 'schoolName', 200);
    let supportType = requireString(body.supportType, 'supportType', 60);
    const tripDate = requireString(body.tripDate, 'tripDate', 40);
    const detail = requireString(body.detail ?? body.specificMatter, 'detail', 10000);

    // 校验日期
    if (Number.isNaN(new Date(tripDate).getTime())) {
      return fail('invalid_param', 'tripDate 不是合法日期', 400);
    }

    const products = Array.isArray(body.products)
      ? (body.products as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];

    const service = new TripService(getAdminSupabase());
    const trip = await service.create({
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      schoolId: typeof body.schoolId === 'string' ? body.schoolId : null,
      schoolName,
      department: typeof body.department === 'string' ? body.department : null,
      industry: typeof body.industry === 'string' ? body.industry : null,
      year: new Date(tripDate).getFullYear(),
      supportType,
      supportTypeOther:
        typeof body.supportTypeOther === 'string' ? body.supportTypeOther : null,
      products,
      detail,
      tripDate: tripDate.slice(0, 10),
      startTime: typeof body.startTime === 'string' ? body.startTime : null,
      endTime: typeof body.endTime === 'string' ? body.endTime : null,
      weekday:
        typeof body.weekday === 'string'
          ? body.weekday
          : ['周日','周一','周二','周三','周四','周五','周六'][new Date(tripDate).getDay()],
      salesManager: typeof body.salesManager === 'string' ? body.salesManager : null,
      projectManager: typeof body.projectManager === 'string' ? body.projectManager : null,
      initiator: auth.user.profile.displayName || auth.user.chaoxing.uid || auth.user.id,
      initiatedAt: new Date().toISOString(),
      approvalStatus: 'approved',
      isCompleted: typeof body.isCompleted === 'string' ? body.isCompleted : null,
      reportConsistent: typeof body.reportConsistent === 'string' ? body.reportConsistent : null,
      serviceSummary: typeof body.serviceSummary === 'string' ? body.serviceSummary : null,
      salesLate: typeof body.salesLate === 'string' ? body.salesLate : null,
      salesScore: typeof body.salesScore === 'number' ? body.salesScore : null,
      serviceLate: typeof body.serviceLate === 'string' ? body.serviceLate : null,
      overallScore: typeof body.overallScore === 'number' ? body.overallScore : null,
      overallFeedback: typeof body.overallFeedback === 'string' ? body.overallFeedback : null,
      externalId: typeof body.externalId === 'string' ? body.externalId : null,
      externalSource: typeof body.externalSource === 'string' ? body.externalSource : null,
      externalUuid: null,
      externalOperator: null,
      externalOriginOperator: null,
      auditStatus: 1,
      deletedAt: null,
      rawPayload: null,
    });
    return ok(trip);
  });
}
