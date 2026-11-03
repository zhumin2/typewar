#!/usr/bin/env bash
# 交叉编译 TypeWar 服务端到 bin/ 目录
#   ./scripts/build.sh            # 全部平台
#   ./scripts/build.sh linux      # 只编译 linux/amd64 + arm64
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="bin"
mkdir -p "$OUT"

VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
LDFLAGS="-s -w"

build() {
  local goos=$1 goarch=$2 ext=$3
  local name="typewar-${goos}-${goarch}${ext}"
  echo "→ ${name}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "$LDFLAGS" -o "$OUT/$name" ./server
}

case "${1:-all}" in
  linux)
    build linux amd64 ""
    build linux arm64 ""
    ;;
  windows)
    build windows amd64 ".exe"
    ;;
  darwin)
    build darwin amd64 ""
    build darwin arm64 ""
    ;;
  all)
    build linux amd64 ""
    build linux arm64 ""
    build darwin arm64 ""
    build windows amd64 ".exe"
    ;;
  *)
    echo "用法: $0 [all|linux|windows|darwin]" >&2
    exit 1
    ;;
esac

echo
echo "完成，产物在 $OUT/ （版本 ${VERSION}）"
ls -lh "$OUT" | tail -n +2
