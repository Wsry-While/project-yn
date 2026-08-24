/**
 * 可复用的 xlsx 批量导入骨架。
 *
 * 设计目标：
 * 1. 业务方只需要实现 mapRow（一行 → 领域输入）和 upsert（落库，幂等），
 *    其他诸如读表、按列索引访问（天然规避重名列）、进度、统计、dry-run、
 *    失败行导出 CSV 全部由骨架统一处理。
 * 2. 骨架不耦合具体业务表/服务，通过 ctx 注入 SupabaseClient 与共享服务。
 * 3. 失败不阻塞：单行异常被捕获并记录，最终汇总到报告与 CSV。
 *
 * 后续导入招投标截图/建设申请/启明星等同类 Excel 时，只需再写一个薄适配文件。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// 脚本独立运行时加载 .env（Next.js 运行时由框架加载，这里 require 容错）
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
} catch {
  // dotenv 不可用时忽略
}

export interface ImportLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export const defaultLogger: ImportLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export interface XlsxImportContext {
  db: SupabaseClient;
  dryRun: boolean;
  logger: ImportLogger;
}

export type UpsertOutcome = 'created' | 'updated' | 'skipped' | 'failed';

export interface XlsxSheetImporter<T> {
  /** 业务名，用于日志/报告，如「项目外出」。 */
  name: string;
  /** sheet 名或索引（0-based）。 */
  sheet: string | number;
  /** 表头所在行（0-based），默认 0；表头之前的行将被丢弃。 */
  headerRow?: number;
  /** 若提供，骨架会在表头行里校验这些列名存在（重名列只校验存在性）。 */
  requiredColumns?: string[];
  /**
   * 把一行二维数据映射为领域对象。
   * - row 是单元格值数组（字符串/数字/null），按列位置访问，避免重名列问题。
   * - rowIndex 是数据行号（表头行之后从 0 开始）。
   * - 返回 null 表示主动跳过该行（不计入失败）。
   * - 抛异常则该行计入失败。
   */
  mapRow: (row: unknown[], rowIndex: number, ctx: XlsxImportContext) => Promise<T | null> | T | null;
  /** 落库（要求幂等）。dry-run 时不会调用。 */
  upsert: (record: T, ctx: XlsxImportContext) => Promise<UpsertOutcome> | UpsertOutcome;
}

export interface ImportOptions {
  dryRun?: boolean;
  /** 仅处理前 N 条数据行（用于灰度预览）。 */
  limit?: number;
  /** 从第 N 条数据行开始（0-based，跳过表头）。 */
  start?: number;
  /** dry-run 时打印前 N 条映射结果，默认 10。 */
  preview?: number;
  /** 失败行导出 CSV 路径；不传则默认写到 /tmp/<name>-failed-<timestamp>.csv。 */
  failedCsv?: string;
}

export interface ImportReport {
  name: string;
  sheet: string | number;
  totalRows: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  failedCsv: string | null;
  elapsedMs: number;
}

/** 从环境变量创建 Supabase admin 客户端（与应用/其他脚本保持一致）。 */
export function createAdminClientFromEnv(): SupabaseClient {
  const url =
    process.env.COZE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key =
    process.env.COZE_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    '';
  if (!url || !key) {
    throw new Error('缺少 COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY 环境变量');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 解析 CLI 参数：--dry-run / --limit=N / --start=N / --preview=N / 位置参数=文件路径。 */
export function parseImportArgs(argv: string[]): {
  file: string | null;
  options: ImportOptions;
} {
  const options: ImportOptions = {};
  let file: string | null = null;
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--start=')) options.start = Number(arg.split('=')[1]);
    else if (arg.startsWith('--preview=')) options.preview = Number(arg.split('=')[1]);
    else if (arg.startsWith('--failed-csv=')) options.failedCsv = arg.split('=')[1];
    else if (!arg.startsWith('--') && !file) file = arg;
  }
  return { file, options };
}

function readSheetRows(filePath: string, sheet: string | number): unknown[][] {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const target =
    typeof sheet === 'number'
      ? wb.SheetNames[sheet]
      : wb.SheetNames.includes(sheet)
        ? sheet
        : wb.SheetNames[0];
  const ws = wb.Sheets[target];
  if (!ws) throw new Error(`找不到 sheet：${String(sheet)}`);
  // header:1 二维数组；raw:false 全部按格式化字符串读取，日期由业务自己 parse；defval 补空。
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeFailedCsv(
  filePath: string,
  headers: string[],
  rows: Array<{ rowIndex: number; reason: string; row: unknown[] }>,
): void {
  const lines = [['row_index', 'reason', ...headers].map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([r.rowIndex, r.reason, ...r.row].map(csvEscape).join(','));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

export async function runXlsxImport<T>(
  filePath: string,
  importer: XlsxSheetImporter<T>,
  options: ImportOptions = {},
  ctxOverride?: Partial<XlsxImportContext>,
): Promise<ImportReport> {
  const startedAt = Date.now();
  const logger = ctxOverride?.logger ?? defaultLogger;
  const dryRun = options.dryRun ?? false;
  const db = ctxOverride?.db ?? createAdminClientFromEnv();
  const ctx: XlsxImportContext = { db, dryRun, logger };

  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);

  const allRows = readSheetRows(filePath, importer.sheet);
  const headerRow = importer.headerRow ?? 0;
  const headerCells = (allRows[headerRow] ?? []) as unknown[];
  const headers = headerCells.map((h) => (h == null ? '' : String(h)));

  if (importer.requiredColumns?.length) {
    const missing = importer.requiredColumns.filter((c) => !headers.includes(c));
    if (missing.length) throw new Error(`表头缺少必填列：${missing.join('、')}`);
  }

  const dataRows = allRows.slice(headerRow + 1);
  const start = options.start ?? 0;
  const limit = options.limit;
  const slice = dataRows.slice(start, limit ? start + limit : undefined);

  logger.info(
    `[${importer.name}] 文件：${filePath} | sheet=${String(importer.sheet)} | ` +
      `表头 ${headers.length} 列 | 数据 ${dataRows.length} 行 | ` +
      `本次处理 ${slice.length} 行（start=${start}）${dryRun ? ' | DRY-RUN' : ''}`,
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failedRows: Array<{ rowIndex: number; reason: string; row: unknown[] }> = [];
  const previewN = options.preview ?? 10;

  for (let i = 0; i < slice.length; i++) {
    const rowIndex = start + i;
    const row = slice[i];
    try {
      const mapped = await importer.mapRow(row, rowIndex, ctx);
      if (mapped === null) {
        skipped++;
        continue;
      }
      if (dryRun) {
        if (i < previewN) {
          logger.info(`  [preview #${rowIndex}] ${JSON.stringify(mapped).slice(0, 500)}`);
        }
        // dry-run 统一计为 created（仅用于量级预估），不实际写库
        created++;
        continue;
      }
      const outcome = await importer.upsert(mapped, ctx);
      if (outcome === 'created') created++;
      else if (outcome === 'updated') updated++;
      else if (outcome === 'skipped') skipped++;
      else failed++;

      if ((i + 1) % 50 === 0) {
        logger.info(`  ...已处理 ${i + 1}/${slice.length}（新增${created} 更新${updated} 跳过${skipped} 失败${failed}）`);
      }
    } catch (err) {
      failed++;
      const reason = err instanceof Error ? err.message : String(err);
      failedRows.push({ rowIndex, reason, row });
      if (failedRows.length <= 20) logger.warn(`  [row ${rowIndex}] 失败：${reason}`);
    }
  }

  let failedCsv: string | null = null;
  if (failedRows.length) {
    failedCsv =
      options.failedCsv ??
      path.join('/tmp', `${importer.name}-failed-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    writeFailedCsv(failedCsv, headers, failedRows);
  }

  const report: ImportReport = {
    name: importer.name,
    sheet: importer.sheet,
    totalRows: dataRows.length,
    processed: slice.length,
    created,
    updated,
    skipped,
    failed,
    dryRun,
    failedCsv,
    elapsedMs: Date.now() - startedAt,
  };

  logger.info(
    `[${importer.name}] 完成：处理 ${report.processed} 行 = 新增 ${created} / 更新 ${updated} / ` +
      `跳过 ${skipped} / 失败 ${failed}，耗时 ${report.elapsedMs}ms` +
      (failedCsv ? `，失败明细：${failedCsv}` : ''),
  );
  return report;
}
