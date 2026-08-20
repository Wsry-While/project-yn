import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

import { fail, ok, readJson, withApi } from '@/lib/domain/http';
import { getAdminSupabase, requireUser } from '@/lib/domain/api-utils';
import { LLM_CONFIG } from '@/lib/domain/llm-prompts';

interface NLQuery {
  source: 'bidding' | 'demand' | 'qiming' | 'trip' | null;
  filters: {
    school?: string;
    salesManager?: string;
    year?: string;
    status?: string;
    overdue?: boolean;
    lowScore?: boolean;
  };
  intent: string;
}

const SYSTEM_PROMPT = `你是一个把中文自然语言转换为结构化查询的解析器。项目中心包含四张业务表：
- bidding（招投标截图）：字段有 project_name / project_school / sales_manager / project_year / completion_status / due_delivery_date
- demand（项目建设申请）：字段有 other_delivery_content / company / sales_manager / project_year / completion_status / required_finish_date
- qiming（启明星建设）：字段有 project_name / school / sales_manager / project_year / project_status_feedback / project_delivery_time / is_sign_contract
- trip（项目外出）：字段有 trip_topic / school_name / sales_manager_name / trip_year / overall_score / is_completed / trip_date

用户会用中文提出查询问题，例如"张三上个月去了哪些学校"、"今年有哪些招投标逾期"、"XX 大学启明星交付了没"。
你必须只输出一个 JSON 对象，不要任何解释或代码块。格式：
{
  "source": "bidding" | "demand" | "qiming" | "trip",
  "filters": {
    "school"?: string,
    "salesManager"?: string,
    "year"?: string,
    "status"?: string,
    "overdue"?: true,
    "lowScore"?: true
  },
  "intent": "一句话复述用户意图"
}
如果无法识别源表，source 返回 null。filters 只填能确定的字段。`;

interface Row {
  id: string;
  title: string;
  school: string | null;
  owner: string | null;
  date: string | null;
  status: string | null;
  url: string;
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
  const auth = await requireUser(request);
  if ('status' in auth) return auth;

  const body = await readJson<{ query?: unknown }>(request);
  if (typeof body.query !== 'string' || !body.query.trim()) {
    return fail('invalid_param', 'query 不能为空', 400);
  }

  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const client = new LLMClient(new Config({ timeout: 30_000 }), customHeaders);
  let raw = '';
  try {
    for await (const part of client.stream(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: body.query },
      ],
      { model: LLM_CONFIG.model, temperature: 0 },
    )) {
      raw += part?.content?.toString?.() ?? '';
    }
  } catch (err) {
    return fail('llm_error', err instanceof Error ? err.message : 'NL 解析失败', 502);
  }

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: NLQuery;
  try {
    parsed = JSON.parse(cleaned) as NLQuery;
  } catch {
    return fail('parse_error', '无法解析自然语言，请换一种问法', 422, { raw: cleaned.slice(0, 200) });
  }
  if (!parsed.source) {
    return fail('not_supported', '无法识别查询范围，请明确包含招投标 / 建设申请 / 启明星 / 外出 关键词', 422);
  }

  const admin = await getAdminSupabase();
  const f = parsed.filters ?? {};
  const rows: Row[] = [];

  if (parsed.source === 'trip') {
    let q = admin.from('trip_requests').select(
      'id, trip_topic, school_name, sales_manager_name, trip_date, overall_score, is_completed',
    ).is('deleted_at', null).limit(50);
    if (f.school) q = q.ilike('school_name', `%${f.school}%`);
    if (f.salesManager) q = q.ilike('sales_manager_name', `%${f.salesManager}%`);
    if (f.year) q = q.eq('trip_year', f.year);
    if (f.lowScore) q = q.lte('overall_score', 2);
    const { data } = await q;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        id: r.id as string,
        title: (r.trip_topic as string) || '项目外出',
        school: (r.school_name as string) ?? null,
        owner: (r.sales_manager_name as string) ?? null,
        date: r.trip_date ? String(r.trip_date).slice(0, 10) : null,
        status: typeof r.overall_score === 'number' ? `评分 ${r.overall_score}` : (r.is_completed ? '已完成' : '未完成'),
        url: `/trips?focus=${r.id}`,
      });
    }
  } else if (parsed.source === 'bidding') {
    let q = admin.from('bidding_screenshots').select(
      'id, project_name, project_school, sales_manager, submission_date, due_delivery_date, completion_status',
    ).is('deleted_at', null).limit(50);
    if (f.school) q = q.ilike('project_school', `%${f.school}%`);
    if (f.salesManager) q = q.ilike('sales_manager', `%${f.salesManager}%`);
    if (f.year) q = q.eq('project_year', f.year);
    if (f.overdue) q = q.lt('due_delivery_date', new Date().toISOString().slice(0, 10));
    const { data } = await q;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        id: r.id as string,
        title: (r.project_name as string) || '招投标',
        school: (r.project_school as string) ?? null,
        owner: (r.sales_manager as string) ?? null,
        date: r.due_delivery_date ? String(r.due_delivery_date).slice(0, 10) : (r.submission_date ? String(r.submission_date).slice(0, 10) : null),
        status: (r.completion_status as string) ?? null,
        url: `/bidding-screenshots?focus=${r.id}`,
      });
    }
  } else if (parsed.source === 'demand') {
    let q = admin.from('project_demands').select(
      'id, other_delivery_content, company, sales_manager, required_finish_date, completion_status',
    ).is('deleted_at', null).limit(50);
    if (f.school) q = q.ilike('company', `%${f.school}%`);
    if (f.salesManager) q = q.ilike('sales_manager', `%${f.salesManager}%`);
    if (f.year) q = q.eq('project_year', f.year);
    if (f.overdue) q = q.lt('required_finish_date', new Date().toISOString().slice(0, 10));
    const { data } = await q;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        id: r.id as string,
        title: (r.other_delivery_content as string) || '建设申请',
        school: (r.company as string) ?? null,
        owner: (r.sales_manager as string) ?? null,
        date: r.required_finish_date ? String(r.required_finish_date).slice(0, 10) : null,
        status: (r.completion_status as string) ?? null,
        url: `/project-demands?focus=${r.id}`,
      });
    }
  } else if (parsed.source === 'qiming') {
    let q = admin.from('qiming_construction').select(
      'id, project_name, school, sales_manager, project_delivery_time, project_status_feedback',
    ).is('deleted_at', null).limit(50);
    if (f.school) q = q.ilike('school', `%${f.school}%`);
    if (f.salesManager) q = q.ilike('sales_manager', `%${f.salesManager}%`);
    if (f.year) q = q.eq('project_year', f.year);
    if (f.overdue) q = q.lt('project_delivery_time', new Date().toISOString());
    const { data } = await q;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        id: r.id as string,
        title: (r.project_name as string) || '启明星',
        school: (r.school as string) ?? null,
        owner: (r.sales_manager as string) ?? null,
        date: r.project_delivery_time ? String(r.project_delivery_time).slice(0, 10) : null,
        status: (r.project_status_feedback as string) ?? null,
        url: `/qiming-construction?focus=${r.id}`,
      });
    }
  }

  return ok({
    intent: parsed.intent,
    source: parsed.source,
    filters: parsed.filters,
    count: rows.length,
    rows,
  });
  });
}
