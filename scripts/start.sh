#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
# 文档解析 + LLM 流式 + docx 生成会同时占用较多内存，显式提高老生代上限，
# 避免处理大体积招标文件时 V8 默认堆上限触发 OOM。
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
start_service
