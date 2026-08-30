/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * 截图图组召回评测（离线，只读）。
 *
 * 图组 section_title 来自历史交付文档「▲ 参数小节」的真实参数原文，与新招标评分项
 * 措辞最接近，可作为「评分项 → 正确图组」的标准答案。对每个图组，用它自己的
 * section_title 当「评分项标题」去召回，分两层评估：
 *
 * A. 判别力：不做 SQL 预过滤，对全部图组用 scoreGroupTitle 打分，看目标组排第几
 *    （衡量打分函数能否把对的排在前面、跨模块误匹配多不多）。
 * B. 端到端：直接调真实 searchReferenceGroup（含 SQL ors 预过滤 + 坏资产过滤），
 *    看能否召回、召回的是否目标组（衡量生产链路真实命中率）。
 *
 * 用法：pnpm tsx scripts/eval-screenshot-recall.ts
 */
import { getSupabaseAdminClient } from '../src/lib/supabase-client';
import {
  ScreenshotExampleService,
  extractMatchTerms,
  scoreGroupTitle,
} from '../src/lib/domain/screenshot-example-service';

const MIN_SCORE = 3.5;

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
  let hasResult = 0;
  let total = 0;
  const miss: Array<{ title: string; rank: number; self: number }> = [];

  for (const target of groups) {
    const title = (target.section_title ?? '').trim();
    if (!title) continue;
    total += 1;
    const terms = extractMatchTerms([title]);
    const scored = groups
      .map((g) => ({ id: g.id, score: scoreGroupTitle(g.section_title ?? '', terms, [title]) }))
      .sort((a, b) => b.score - a.score);
    const rank = scored.findIndex((s) => s.id === target.id) + 1;
    const selfScore = scored.find((s) => s.id === target.id)?.score ?? 0;
    if (selfScore >= MIN_SCORE) hasResult += 1;
    if (rank === 1) top1 += 1;
    if (rank <= 3) top3 += 1;
    if (rank > 3 && miss.length < 12) miss.push({ title: title.slice(0, 30), rank, self: Number(selfScore.toFixed(1)) });
  }

  console.log('──── A. 判别力（全量打分）────');
  console.log(`有效图组: ${total}`);
  console.log(`自身分≥${MIN_SCORE}: ${hasResult} (${((hasResult / total) * 100).toFixed(1)}%)`);
  console.log(`Top1: ${top1} (${((top1 / total) * 100).toFixed(1)}%)   Top3: ${top3} (${((top3 / total) * 100).toFixed(1)}%)`);
  for (const m of miss) console.log(`   rank=${m.rank} self=${m.self} 《${m.title}》`);

  // —— B. 端到端（真实 searchReferenceGroup）——
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
      if (eMiss.length < 12) eMiss.push(`null  《${title.slice(0, 28)}》`);
    } else if (res.groupId === target.id) {
      eHit += 1;
    } else {
      eWrong += 1;
      if (eMiss.length < 12) eMiss.push(`wrong 《${title.slice(0, 28)}》 -> ${res.sectionTitle?.slice(0, 20)}`);
    }
  }

  console.log('\n──── B. 端到端（真实 searchReferenceGroup）────');
  console.log(`调用: ${done}`);
  console.log(`命中目标组: ${eHit} (${((eHit / done) * 100).toFixed(1)}%)`);
  console.log(`未召回(回退散图): ${eNull} (${((eNull / done) * 100).toFixed(1)}%)`);
  console.log(`召回但非目标组: ${eWrong} (${((eWrong / done) * 100).toFixed(1)}%)`);
  for (const m of eMiss) console.log(`   ${m}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
