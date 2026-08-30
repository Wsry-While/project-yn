/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * 截图图组召回评测（离线，只读）。
 *
 * 图组 section_title 来自历史交付文档「▲ 参数小节」的真实参数原文，与新招标评分项
 * 措辞最接近，可作为「评分项 → 正确图组」的标准答案。对每个图组，用它自己的
 * section_title 当「评分项标题」去召回，分两层评估：
 *
 * A. 判别力：对全部图组用 scoreGroupTitle 打分，看目标组排第几。
 * B. 端到端：直接调真实 searchReferenceGroup（SQL ors 预过滤 + 坏资产过滤 + 采用门槛）。
 * C. 同模块排错参数：评分项属于某模块但具体参数不同时（如「样式」vs「多形态编辑」），
 *    不得把同模块下别的参数图组召回（复刻用户反馈的错配）。
 *
 * 用法：pnpm tsx scripts/eval-screenshot-recall.ts
 */
import { getSupabaseAdminClient } from '../src/lib/supabase-client';
import {
  ScreenshotExampleService,
  extractMatchTerms,
  scoreGroupTitle,
} from '../src/lib/domain/screenshot-example-service';

async function main() {
  const db = getSupabaseAdminClient();
  const svc = new ScreenshotExampleService(db);

  const { data, error } = await db
    .from('screenshot_parameter_groups')
    .select('id,record_id,section_title,image_count,kb_version')
    .order('id');
  if (error) throw error;

  const groups = (data ?? []) as Array<{
    id: string;
    record_id: string;
    section_title: string | null;
    image_count: number;
    kb_version: string | null;
  }>;
  console.log(`图组总数: ${groups.length}\n`);

  // —— A. 判别力（全量打分排序）——
  let top1 = 0;
  let top3 = 0;
  let total = 0;
  const miss: string[] = [];
  for (const target of groups) {
    const title = (target.section_title ?? '').trim();
    if (!title) continue;
    total += 1;
    const terms = extractMatchTerms([title]);
    const scored = groups
      .map((g) => ({ id: g.id, score: scoreGroupTitle(g.section_title ?? '', terms, [title]) }))
      .sort((a, b) => b.score - a.score);
    const rank = scored.findIndex((s) => s.id === target.id) + 1;
    if (rank === 1) top1 += 1;
    if (rank <= 3) top3 += 1;
    if (rank > 3 && miss.length < 10) miss.push(`rank=${rank} 《${title.slice(0, 28)}》`);
  }
  console.log('──── A. 判别力（全量打分）────');
  console.log(`Top1: ${top1}/${total} (${((top1 / total) * 100).toFixed(1)}%)   Top3: ${top3}/${total} (${((top3 / total) * 100).toFixed(1)}%)`);
  for (const m of miss) console.log('   ' + m);

  // —— B. 端到端（真实 searchReferenceGroup，含采用门槛）——
  let eHit = 0;
  let eNull = 0;
  let eWrong = 0;
  const eMiss: string[] = [];
  let done = 0;
  for (const target of groups) {
    const title = (target.section_title ?? '').trim();
    if (!title) continue;
    done += 1;
    const res = await svc.searchReferenceGroup([title]);
    if (!res) {
      eNull += 1;
    } else if (res.groupId === target.id) {
      eHit += 1;
    } else {
      // 语义重复（标题高度重合）算正确，仅 group id 不同
      const same =
        res.sectionTitle &&
        (res.sectionTitle.includes(title.slice(0, 12)) || title.includes(res.sectionTitle.slice(0, 12)));
      if (same) eHit += 1;
      else {
        eWrong += 1;
        if (eMiss.length < 12) eMiss.push(`wrong 《${title.slice(0, 24)}》 -> ${(res.sectionTitle ?? '').slice(0, 20)}`);
      }
    }
  }
  console.log('\n──── B. 端到端（真实 searchReferenceGroup，语义重复算对）────');
  console.log(`命中(含语义重复): ${eHit} (${((eHit / done) * 100).toFixed(1)}%)   回退散图: ${eNull} (${((eNull / done) * 100).toFixed(1)}%)   错配: ${eWrong} (${((eWrong / done) * 100).toFixed(1)}%)`);
  for (const m of eMiss) console.log('   ' + m);

  // —— C. 同模块排错参数（重点防回归）——
  console.log('\n──── C. 同模块内「样式 vs 多形态」错配防护 ────');
  const cases: Array<{ name: string; keywords: string[]; mustContain: string[]; mustNotContain: string[] }> = [
    {
      name: '自定义样式设置（颜色/字体）',
      keywords: ['知识图谱支持自定义样式设置', '支持知识图谱自定义颜色设定，同时支持知识点自定义文字颜色及大小设置'],
      mustContain: ['样式', '颜色'],
      mustNotContain: ['形态'],
    },
    {
      name: '多图谱形态',
      keywords: ['知识图谱支持多种形态自定义编辑', '系统支持至少6种图谱形态，可根据课程性质选择合适的图谱形态进行编辑'],
      mustContain: ['形态'],
      mustNotContain: ['颜色', '背景色'],
    },
    {
      name: '课程章节一键转化',
      keywords: ['知识图谱支持课程章节一键转化'],
      mustContain: ['转化'],
      mustNotContain: ['形态', '样式'],
    },
  ];
  for (const c of cases) {
    const res = await svc.searchReferenceGroup(c.keywords);
    const t = res?.sectionTitle ?? '';
    const okContain = c.mustContain.every((k) => t.includes(k));
    const okNot = c.mustNotContain.every((k) => !t.includes(k));
    const ok = okContain && okNot;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    console.log(`      召回: ${t.slice(0, 46) || '（回退散图/null）'}`);
    if (!okContain) console.log(`      缺少应含词: ${c.mustContain.filter((k) => !t.includes(k)).join(',')}`);
    if (!okNot) console.log(`      命中应排除词: ${c.mustNotContain.filter((k) => t.includes(k)).join(',')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
