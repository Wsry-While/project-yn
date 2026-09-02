/* eslint-disable no-console */
// 轻量 SQL 迁移执行器：用 PGDATABASE_URL 直连 PG 执行指定 .sql 文件。
// 用法：pnpm tsx scripts/run-sql.ts scripts/sql/202609_screenshot_guides.sql
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();
import { Client } from 'pg';

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('用法: pnpm tsx scripts/run-sql.ts <sql 文件>');
  const url = process.env.PGDATABASE_URL;
  if (!url) throw new Error('缺少 PGDATABASE_URL 环境变量');
  const sql = readFileSync(resolve(file), 'utf8');
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`✅ 已执行 ${file}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌ 迁移失败:', e);
  process.exit(1);
});
