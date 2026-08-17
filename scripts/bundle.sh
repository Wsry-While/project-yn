#!/bin/bash
# 将模板打包成可交付的压缩包：剔除依赖、构建产物与密钥，保留可直接 `pnpm install` 起步的源码。
set -Eeuo pipefail

# 定位项目根目录（脚本所在目录的上一级），保证在任意位置调用都正确
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v zip >/dev/null 2>&1; then
  echo "❌ 未找到 zip 命令，请先安装 zip" >&2
  exit 1
fi

# 从 package.json 读取包名与版本（解析失败则回退默认值）
NAME="$(node -p "require('./package.json').name || 'template'" 2>/dev/null || echo template)"
VERSION="$(node -p "require('./package.json').version || '0.0.0'" 2>/dev/null || echo 0.0.0)"
DATE="$(date +%Y%m%d)"

OUT_DIR="${ROOT_DIR}/release"
ARCHIVE="${OUT_DIR}/${NAME}-${VERSION}-${DATE}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${ARCHIVE}"

echo "打包 ${NAME}@${VERSION} ..."

# 排除项：依赖 / 构建产物 / 版本库 / 所有环境文件 / 输出目录自身 / 本地杂项
zip -r -q "${ARCHIVE}" . \
  -x "node_modules/*" "*/node_modules/*" \
  -x ".next/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x "release/*" \
  -x ".env*" "*/.env*" \
  -x "*.log" \
  -x "*.tsbuildinfo" \
  -x "*.DS_Store" \
  -x ".turbo/*" \
  -x "coverage/*"

# 仅重新加入不含真实密钥的示例配置。
if [[ -f ".env.example" ]]; then
  zip -q "${ARCHIVE}" ".env.example"
fi

SIZE="$(du -h "${ARCHIVE}" | cut -f1)"
echo "✅ 已生成：${ARCHIVE} (${SIZE})"
echo
echo "收件人使用步骤："
echo "  1. 解压压缩包"
echo "  2. pnpm install"
echo "  3. cp .env.example .env  并填入配置"
echo "  4. pnpm dev   # 访问 http://127.0.0.1:5000"
