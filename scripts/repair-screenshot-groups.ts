/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * 全库截图图组修复（离线，写库，幂等）。
 *
 * 背景：历史上部分 docx 内嵌图上传对象存储失败（external_file_assets.status=failed），
 * 图组沉淀时只收 stored/direct 资产，导致这些图被静默丢弃——原本应多张支撑的参数图组
 * 只剩 1 张（如「支持AI生成图谱」原文 3 张连续截图，指导书只显示 1 张）。
 *
 * 本脚本调用 ScreenshotKnowledgeService.repairGroupAssets()：
 *   1. 全量重抽每份交付 docx 内嵌图并重建参数图组（跳过 500 张视觉上限）；
 *   2. 逐张 uploadExtractedImage——stored/direct 复用，failed/pending 重新上传并原地修复；
 *   3. persistSectionGroups 重建图组关联。
 * 全程幂等，不写单条特例；不跑多模态视觉，成本低。
 *
 * 用法：
 *   pnpm tsx scripts/repair-screenshot-groups.ts          # 执行修复
 *   pnpm tsx scripts/repair-screenshot-groups.ts --dry-run # 只扫描统计，不写库
 */
import { getSupabaseAdminClient } from '../src/lib/supabase-client';
import { ScreenshotKnowledgeService } from '../src/lib/domain/screenshot-knowledge-service';

async function countFailedAssets(db: ReturnType<typeof getSupabaseAdminClient>): Promise<number> {
  const { count } = await db
    .from('external_file_assets')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'kb-docx')
    .in('status', ['failed', 'pending']);
  return count ?? 0;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = getSupabaseAdminClient();
  const svc = new ScreenshotKnowledgeService(db);

  const failedBefore = await countFailedAssets(db);
  console.log(`修复前：kb-docx failed/pending 资产 ${failedBefore} 张`);

  if (dryRun) {
    console.log('(--dry-run) 仅扫描，不执行修复。正式修复请去掉 --dry-run。');
    return;
  }

  const res = await svc.repairGroupAssets((_type, payload) => {
    const msg = (payload as { message?: string })?.message;
    if (msg) console.log('[repair]', msg);
  });

  const failedAfter = await countFailedAssets(db);
  console.log('\n===== 修复完成 =====');
  console.log(`记录数: ${res.records}`);
  console.log(`抽图处理: ${res.imagesProcessed} 张`);
  console.log(`图组发现: ${res.groupsFound}，重建: ${res.groupsPersisted}`);
  console.log(`kb-docx failed/pending 资产：${failedBefore} → ${failedAfter} 张`);
  if (res.incompleteGroups.length > 0) {
    console.log(`\n仍残缺图组 ${res.incompleteGroups.length} 个（多为超大/损坏图，重传仍失败）：`);
    for (const inc of res.incompleteGroups.slice(0, 50)) {
      console.log(`  - [${inc.got}/${inc.expected}] ${inc.title} (record=${inc.recordId})`);
    }
  } else {
    console.log('所有图组均已补齐，无残缺。');
  }
}

main().catch((err) => {
  console.error('修复失败:', err);
  process.exit(1);
});
