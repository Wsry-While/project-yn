/**
 * 前端 CSV 导出工具。
 *
 * 列表页直接用当前已加载并完成筛选的数据在浏览器侧生成 CSV，
 * 不额外请求后端，导出即所见即所得。带 UTF-8 BOM，Excel 直接打开中文不乱码。
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface ExportColumn<T> {
  /** 表头中文 */
  header: string;
  /** 从行数据取值；返回字符串/数字/空 */
  get: (row: T) => string | number | null | undefined;
}

/**
 * 触发浏览器下载 CSV。
 * @param filename 文件名（无需 .csv 后缀，会自动追加）
 * @param columns  列定义
 * @param rows     数据行
 */
export function exportCsv<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[],
): void {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCell(c.header)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.get(row))).join(','));
  }
  // UTF-8 BOM，让 Excel 正确识别中文编码
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 释放需要留到点击事件处理完成后
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 生成带日期戳的文件名前缀 */
export function datedName(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${ymd}`;
}
