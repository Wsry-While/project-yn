import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

import { fail, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { LLM_CONFIG } from '@/lib/domain/llm-prompts';
import { WeeklyReportService, type WeeklyReportData } from '@/lib/domain/weekly-report-service';

function buildSystemPrompt(data: WeeklyReportData): string {
  const lines: string[] = [];
  lines.push(`你是一名企业项目中心运营助手，请基于以下 JSON 业务数据撰写一份结构清晰、客观简洁的中文周报。`);
  lines.push('报告必须严格使用以下 Markdown 结构：');
  lines.push('1. `## 一、本周概览` —— 用 2-3 句概括整体业务节奏，引用关键数字。');
  lines.push('2. `## 二、关键进展` —— 分条列出招投标 / 建设申请 / 启明星 / 项目外出的亮点，每条带学校、负责人、日期等具体信息。');
  lines.push('3. `## 三、交付完成情况` —— 列出已完成 / 已交付事项；如无则说明本周暂无完成记录。');
  lines.push('4. `## 四、风险与预警` —— 将 risks 字段中的风险按等级列出；若无风险明确写"本周暂无重大风险"。');
  lines.push('5. `## 五、下周计划建议` —— 基于在办与即将到期工单提出 3-5 条具体可执行的建议。');
  lines.push('');
  lines.push('写作要求：');
  lines.push('- 语言客观、克制，不使用"让我们"、"加油"、"赋能"等营销腔；');
  lines.push('- 数字必须来自数据，禁止编造；');
  lines.push('- 每条事项使用 `- ` 开头，关键名词加粗（`**xx大学**`、`**张三**`）；');
  lines.push('- 总长度控制在 600-1000 字；');
  lines.push('- 仅输出 Markdown 正文，不要任何开场白或代码块包裹。');
  lines.push('');
  lines.push('本周数据：');
  lines.push('```json');
  lines.push(JSON.stringify(data, null, 2));
  lines.push('```');
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const body = (await request.json().catch(() => ({}))) as {
    startDate?: string;
    endDate?: string;
    days?: number;
    salesManagerId?: string;
    schoolId?: string;
    extraPrompt?: string;
  };

  let data: WeeklyReportData;
  try {
    data = await WeeklyReportService.build({
      startDate: body.startDate,
      endDate: body.endDate,
      days: body.days,
      salesManagerId: body.salesManagerId,
      schoolId: body.schoolId,
    });
  } catch (err) {
    return fail('data_error', err instanceof Error ? err.message : '周报数据加载失败', 500);
  }

  if (
    data.summary.totalTrips + data.summary.newBidding + data.summary.newDemands + data.summary.newQiming ===
    0
  ) {
    return fail('no_data', '所选时间范围内暂无业务数据', 422);
  }

  const systemPrompt = buildSystemPrompt(data);
  const userPrompt = body.extraPrompt?.trim()
    ? `附加要求：${body.extraPrompt.trim()}`
    : '请按照系统提示生成周报。';

  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const client = new LLMClient(new Config({ timeout: 120_000 }), customHeaders);

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'meta', range: data.range, summary: data.summary })}\n\n`),
        );
        for await (const part of client.stream(messages, {
          model: LLM_CONFIG.model,
          temperature: 0.3,
        })) {
          const text = part?.content?.toString?.() ?? '';
          if (text) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: text })}\n\n`),
            );
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err) {
        console.error('[reports/weekly/generate] error:', err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : '生成失败' })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
  });
}
