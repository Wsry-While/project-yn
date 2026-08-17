#!/usr/bin/env node

/**
 * 从平台拉取环境变量并生成 .env 文件
 * 用法: pnpm gen:env
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.resolve(process.cwd(), '.env');

// 需要写入 .env 的变量（仅保留开发密切相关的）
const RETAINED_KEYS = [
  // 超星 OAuth
  'CHAOXING_APPID',
  'CHAOXING_SECRET',
  'CHAOXING_FIDS',
  'CHAOXING_REDIRECT_URI',
  // Supabase
  'COZE_SUPABASE_URL',
  'COZE_SUPABASE_ANON_KEY',
  'COZE_SUPABASE_SERVICE_ROLE_KEY',
  // PostgreSQL 直连
  'PGDATABASE_URL',
  'PGDATABASE',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGSSLMODE',
  'PGCHANNELBINDING',
  // 对象存储
  'COZE_BUCKET_ENDPOINT_URL',
  'COZE_BUCKET_NAME',
  // LLM / 集成服务
  'COZE_INTEGRATION_MODEL_BASE_URL',
  'COZE_INTEGRATION_BASE_URL',
  'COZE_OUTBOUND_AUTH_ENDPOINT',
  'COZE_LOOP_BASE_URL',
  'COZE_LOOP_API_TOKEN',
  // Workload Identity
  'COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT',
  'COZE_WORKLOAD_IDENTITY_CLIENT_ID',
  'COZE_WORKLOAD_IDENTITY_CLIENT_SECRET',
  'COZE_WORKLOAD_IDENTITY_API_KEY',
  'COZE_WORKLOAD_API_TOKEN',
  'COZE_WORKLOAD_ACCESS_TOKEN_ENDPOINT',
  // 项目信息
  'COZE_PROJECT_SPACE_ID',
];

const pythonCode = `
import os, sys, json
try:
    from coze_workload_identity import Client
    client = Client()
    env_vars = client.get_project_env_vars()
    client.close()
    result = {}
    for env_var in env_vars:
        result[env_var.key] = env_var.value
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"_error": str(e)}), file=sys.stdout)
`;

function fetchEnvVars() {
  try {
    const output = execSync(`python3 -c '${pythonCode.replace(/'/g, "'\"'\"'")}'`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output.trim());
    if (parsed._error) {
      throw new Error(parsed._error);
    }
    return parsed;
  } catch (err) {
    console.error('❌ 无法从平台获取环境变量:', err.message);
    process.exit(1);
  }
}

function generateEnvFile(vars) {
  const groups = {
    '超星 OAuth 登录': [
      'CHAOXING_APPID',
      'CHAOXING_SECRET',
      'CHAOXING_FIDS',
      'CHAOXING_REDIRECT_URI',
    ],
    'Supabase (HTTP / PostgREST)': [
      'COZE_SUPABASE_URL',
      'COZE_SUPABASE_ANON_KEY',
      'COZE_SUPABASE_SERVICE_ROLE_KEY',
    ],
    'PostgreSQL 直连': [
      'PGDATABASE_URL',
      'PGDATABASE',
      'PGHOST',
      'PGPORT',
      'PGUSER',
      'PGPASSWORD',
      'PGSSLMODE',
      'PGCHANNELBINDING',
    ],
    '对象存储 (S3)': [
      'COZE_BUCKET_ENDPOINT_URL',
      'COZE_BUCKET_NAME',
    ],
    'LLM / 集成服务': [
      'COZE_INTEGRATION_MODEL_BASE_URL',
      'COZE_INTEGRATION_BASE_URL',
      'COZE_OUTBOUND_AUTH_ENDPOINT',
      'COZE_LOOP_BASE_URL',
      'COZE_LOOP_API_TOKEN',
    ],
    'Workload Identity': [
      'COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT',
      'COZE_WORKLOAD_IDENTITY_CLIENT_ID',
      'COZE_WORKLOAD_IDENTITY_CLIENT_SECRET',
      'COZE_WORKLOAD_IDENTITY_API_KEY',
      'COZE_WORKLOAD_API_TOKEN',
      'COZE_WORKLOAD_ACCESS_TOKEN_ENDPOINT',
    ],
    '项目信息': [
      'COZE_PROJECT_SPACE_ID',
    ],
  };

  const lines = [];
  for (const [title, keys] of Object.entries(groups)) {
    lines.push(`# ============================================`);
    lines.push(`# ${title}`);
    lines.push(`# ============================================`);
    for (const key of keys) {
      if (vars[key] !== undefined) {
        lines.push(`${key}=${vars[key]}`);
      } else {
        lines.push(`# ${key}=（未获取到）`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

// 主流程
const vars = fetchEnvVars();
const content = generateEnvFile(vars);
fs.writeFileSync(ENV_FILE, content, 'utf-8');

const writtenCount = RETAINED_KEYS.filter(k => vars[k] !== undefined).length;
console.log(`✅ .env 已生成 (${writtenCount}/${RETAINED_KEYS.length} 个变量) -> ${ENV_FILE}`);
