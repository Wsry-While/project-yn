/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * 一次性回填：对历史招投标记录里「未转存」的附件（含顶层无 objectId、
 * 仅 url 带 objectid 的招标文件等）重跑转存流程。
 *
 * processBiddingAttachments 现在会从 url 解析 objectId，把文件下载转存到对象存储
 * （超大文件降级 direct 但仍建 asset），并把 assetId/objectId 回写业务 JSONB。
 * 处理完后前端附件一律走我方 /api/files/preview 代理，不再直连超星域名。
 *
 * 用法：pnpm tsx scripts/backfill-attachment-transfer.ts [--limit=N] [--dry-run]
 */
import { getSupabaseAdminClient } from '../src/lib/supabase-client';
import { processBiddingAttachments } from '../src/lib/domain/bidding-attachment-service';

const FIELDS = ['project_bidding_file', 'delivery_document', 'attachments', 'rectified_document'];

function hasUntransferred(record: any): boolean {
  for (const field of FIELDS) {
    const value = record[field];
    if (!value) continue;
    const arr = Array.isArray(value) ? value : [value];
    for (const f of arr) {
      if (!f) continue;
      if (f.assetId) continue;
      const topOid = /^[a-f0-9]{32}$/i.test(f.objectId || '');
      const oidInUrl = /objectid=[a-f0-9]{32}/i.test(f.url || '') || /[a-f0-9]{32}/i.test(f.url || '');
      if (topOid || oidInUrl) return true;
    }
  }
  return false;
}

function rowToRecord(rec: any): any {
  // processBiddingAttachments 使用 mapper 后的驼峰字段（BiddingScreenshot 形态）
  return {
    id: rec.id,
    externalId: rec.external_id ?? rec.id,
    projectName: rec.project_name,
    projectBiddingFile: rec.project_bidding_file ?? null,
    deliveryDocument: rec.delivery_document ?? null,
    attachments: rec.attachments ?? [],
    rectifiedDocument: rec.rectified_document ?? null,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 9999;

  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from('bidding_screenshots')
    .select('id, project_name, project_bidding_file, delivery_document, attachments, rectified_document')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const pending = (data as any[]).filter(hasUntransferred);
  console.log(`待处理记录：${pending.length} 条（dryRun=${dryRun}，limit=${limit}）`);

  let done = 0;
  for (const rec of pending) {
    if (done >= limit) break;
    done++;
    console.log(`[${done}/${Math.min(pending.length, limit)}] ${rec.project_name}`);
    if (dryRun) continue;
    try {
      // processBiddingAttachments 内部按 objectId 幂等，已 stored 的跳过。
      await processBiddingAttachments(rowToRecord(rec));
    } catch (err) {
      console.warn(`   [skip] ${(err as Error).message}`);
    }
  }
  console.log(`\n完成：${dryRun ? 'dry-run' : `已处理 ${done} 条`}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
