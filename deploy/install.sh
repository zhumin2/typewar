#!/usr/bin/env bash
#
# TypeWar 服务端一键安装 / 更新脚本（Linux）
#
#   sudo ./deploy/install.sh                          # 默认 :3000，装在 /opt/typewar
#   sudo ./deploy/install.sh --port 8080
#   sudo ./deploy/install.sh --tls-cert /root/cert.pem --tls-key /root/key.pem
#   sudo ./deploy/install.sh --bind 127.0.0.1         # 只监听本机（配合 nginx/caddy 反代）
#
# 重复执行即为「更新」：拉取最新代码 → 重新编译 → 重启服务。
#
set -euo pipefail

# ---------------------------------------------------------------- 参数
APP_NAME="typewar"
APP_DIR="/opt/typewar"
PORT="3000"
BIND=""                 # 空 = 监听所有网卡（:PORT）；填 127.0.0.1 = 只监听本机
REPO="https://github.com/zhumin2/typewar.git"
BRANCH="main"
TLS_CERT=""
TLS_KEY=""
ARCHIVE_URL=""
SKIP_FIREWALL=0
GO_VERSION="${GO_VERSION:-1.23.4}"
GOPROXY_DEFAULT="https://goproxy.cn,direct"
GOLANG_MIRRORS=("${GOLANG_MIRROR:-https://golang.google.cn/dl}" "https://go.dev/dl" "https://mirrors.aliyun.com/golang")

usage() {
  cat <<'EOF'
用法: sudo ./deploy/install.sh [选项]

  sudo ./deploy/install.sh                          # 默认 :3000，装在 /opt/typewar
  sudo ./deploy/install.sh --port 8080
  sudo ./deploy/install.sh --tls-cert /root/cert.pem --tls-key /root/key.pem
  sudo ./deploy/install.sh --bind 127.0.0.1         # 只监听本机（配合 nginx/caddy 反代）

重复执行即为「更新」：拉取最新代码 → 重新编译 → 重启服务。

EOF
  cat <<'EOF'
可选参数:
  --port N          监听端口（默认 3000）
  --bind ADDR       绑定地址，如 127.0.0.1（默认监听全部网卡）
  --dir PATH        安装目录（默认 /opt/typewar）
  --repo URL        仓库地址
    --branch NAME     分支（默认 main）
    --archive URL     用 tar.gz 压缩包安装（github 不可达时使用）
    --tls-cert FILE   证书路径（提供后启用 HTTPS/WSS）
  --tls-key FILE    私钥路径
  --skip-firewall   不修改防火墙规则
  -h, --help        显示帮助

环境变量:
  GO_VERSION=1.23.4  需要安装的 Go 版本
  GOLANG_MIRROR=...  Go 下载镜像（默认优先 golang.google.cn）
  GOPROXY=...        Go 模块代理（默认 https://goproxy.cn,direct）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:?}"; shift 2 ;;
    --bind) BIND="${2:?}"; shift 2 ;;
    --dir) APP_DIR="${2:?}"; shift 2 ;;
    --repo) REPO="${2:?}"; shift 2 ;;
    --branch) BRANCH="${2:?}"; shift 2 ;;
    --archive) ARCHIVE_URL="${2:?}"; shift 2 ;;
    --tls-cert) TLS_CERT="${2:?}"; shift 2 ;;
    --tls-key) TLS_KEY="${2:?}"; shift 2 ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -n "$TLS_CERT" || -n "$TLS_KEY" ]]; then
  [[ -f "$TLS_CERT" && -f "$TLS_KEY" ]] || { echo "证书或私钥文件不存在" >&2; exit 1; }
fi

# ---------------------------------------------------------------- 输出与工具函数
C_RESET=$'\033[0m'; C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
log()  { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$C_OK" "$C_RESET" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_WARN" "$C_RESET" "$*"; }
die()  { printf '%s  ✗%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2; exit 1; }

# 安装目录规范化 + 安全检查（后续会 rm -rf 该目录）
APP_DIR="${APP_DIR%/}"
[[ -n "$APP_DIR" ]] || die "安装目录不能为空"
case "$APP_DIR" in
  /|/opt|/usr|/etc|/home|/root|/var) die "安装目录不合法: ${APP_DIR}" ;;
esac

# ---------------------------------------------------------------- 前置检查
[[ "$(id -u)" -eq 0 ]] || die "请用 root 或 sudo 运行"
[[ "$(uname -s)" == "Linux" ]] || die "本脚本仅支持 Linux"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   GOARCH=amd64 ;;
  aarch64|arm64)  GOARCH=arm64 ;;
  *) die "不支持的架构: $ARCH" ;;
esac

# ---------------------------------------------------------------- 包管理器
if   command -v dnf     >/dev/null 2>&1; then PM=dnf
elif command -v yum     >/dev/null 2>&1; then PM=yum
elif command -v apt-get >/dev/null 2>&1; then PM=apt
else die "未识别的包管理器（需要 dnf / yum / apt-get）"
fi
log "包管理器: ${PM} | 架构: ${GOARCH}"

pkg_install() {
  case "$PM" in
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
  esac
}

log "安装基础依赖"
if [[ "$PM" == "apt" ]]; then
  apt-get update -qq
fi
pkg_install ca-certificates curl tar git >/dev/null
ok "git / curl / tar / ca-certificates 就绪"

# ---------------------------------------------------------------- Go
needs_go=1
if command -v go >/dev/null 2>&1; then
  cur="$(go version | awk '{print $3}' | sed 's/^go//')"
  major="${cur%%.*}"; rest="${cur#*.}"; minor="${rest%%.*}"
  if [[ "${major:-0}" -gt 1 ]] || { [[ "${major:-0}" -eq 1 ]] && [[ "${minor:-0}" -ge 21 ]]; }; then
    needs_go=0
    ok "已安装 Go ${cur}"
  else
    warn "Go ${cur} 版本过低（需要 ≥1.21），将安装 Go ${GO_VERSION}"
  fi
fi

if [[ "$needs_go" -eq 1 ]]; then
  log "下载并安装 Go ${GO_VERSION}（linux-${GOARCH}）"
  tmp_tgz="$(mktemp -t go.XXXXXX.tar.gz)"
  downloaded=0
  for mirror in "${GOLANG_MIRRORS[@]}"; do
    url="${mirror}/go${GO_VERSION}.linux-${GOARCH}.tar.gz"
    log "尝试镜像: ${mirror}"
    if curl -fsSL --retry 2 --connect-timeout 15 -o "$tmp_tgz" "$url"; then
      downloaded=1; break
    else
      warn "镜像不可用: ${mirror}"
    fi
  done
  [[ "$downloaded" -eq 1 ]] || { rm -f "$tmp_tgz"; die "Go 下载失败，可手动安装后重跑，或用 GOLANG_MIRROR 指定镜像"; }

  rm -rf /usr/local/go
  tar -C /usr/local -xzf "$tmp_tgz"
  rm -f "$tmp_tgz"
  ln -sf /usr/local/go/bin/go   /usr/local/bin/go
  ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  cat > /etc/profile.d/typewar-go.sh <<'EOF'
export PATH="/usr/local/go/bin:$PATH"
EOF
  chmod 644 /etc/profile.d/typewar-go.sh
  export PATH="/usr/local/go/bin:$PATH"
  ok "Go $(go version | awk '{print $3}') 安装完成"
fi

export GOPROXY="${GOPROXY:-$GOPROXY_DEFAULT}"
export CGO_ENABLED=0

# ---------------------------------------------------------------- 代码
# 国内服务器常访问不了 github.com / raw.githubusercontent.com，这里做多路回退：
#   1) 指定了 --archive：直接用该压缩包地址
#   2) 已有 git 仓库：git fetch 更新
#   3) git clone
#   4) 以上失败：依次尝试 GitHub 加速镜像下载 tar.gz
ARCHIVE_MIRRORS=()
build_archive_mirrors() {
  local owner repo path
  owner="$(printf '%s' "$REPO" | sed -n 's#.*github\.com[:/]\([^/]*\)/\([^/]*\)\.git.*#\1#p')"
  repo="$(printf '%s' "$REPO" | sed -n 's#.*github\.com[:/]\([^/]*\)/\([^/]*\)\.git.*#\2#p')"
  [[ -n "$owner" && -n "$repo" ]] || return 0
  path="${owner}/${repo}/archive/refs/heads/${BRANCH}.tar.gz"
  ARCHIVE_MIRRORS=(
    "https://ghfast.top/https://github.com/${path}"
    "https://gh-proxy.com/https://github.com/${path}"
    "https://ghproxy.net/https://github.com/${path}"
    "https://codeload.github.com/${path}"
    "https://github.com/${path}"
  )
}

download_archive() {
  local url="$1" tmp
  tmp="$(mktemp -t typewar.XXXXXX.tar.gz)"
  if ! curl -fL --retry 2 --connect-timeout 15 --max-time 300 -o "$tmp" "$url" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  if ! tar -xzf "$tmp" -C "$APP_DIR" --strip-components=1 2>/dev/null; then
    rm -f "$tmp"
    rm -rf "$APP_DIR"
    return 1
  fi
  rm -f "$tmp"
  return 0
}

CODE_VERSION=""
build_archive_mirrors

if [[ -n "$ARCHIVE_URL" ]]; then
  log "从指定压缩包安装: ${ARCHIVE_URL}"
  download_archive "$ARCHIVE_URL" || die "压缩包下载或解压失败: ${ARCHIVE_URL}"
  CODE_VERSION="archive"
elif [[ -d "$APP_DIR/.git" ]]; then
  log "更新代码: ${APP_DIR} (${BRANCH})"
  if git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" >/dev/null 2>&1; then
    git -C "$APP_DIR" reset --hard "origin/${BRANCH}" >/dev/null
    CODE_VERSION="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  else
    warn "git fetch 失败，改用镜像压缩包"
    for u in "${ARCHIVE_MIRRORS[@]}"; do
      if download_archive "$u"; then CODE_VERSION="archive"; break; fi
    done
    [[ -n "$CODE_VERSION" ]] || die "代码更新失败：git 与镜像均不可用，可用 --archive 指定可访问的压缩包地址"
  fi
elif [[ -d "$APP_DIR" && ! -d "$APP_DIR/.git" ]]; then
  # 上次是用压缩包安装的：直接重新下载
  log "重新下载代码到 ${APP_DIR}（压缩包模式）"
  for u in "${ARCHIVE_MIRRORS[@]}"; do
    log "  尝试: ${u}"
    if download_archive "$u"; then CODE_VERSION="archive"; break; fi
  done
  [[ -n "$CODE_VERSION" ]] || die "代码更新失败：可用 --archive <tar.gz 地址> 指定可访问的地址"
else
  mkdir -p "$(dirname "$APP_DIR")"
  if git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR" >/dev/null 2>&1; then
    CODE_VERSION="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  else
    warn "git clone 失败（国内网络常见），尝试镜像下载压缩包"
    rm -rf "$APP_DIR"
    for u in "${ARCHIVE_MIRRORS[@]}"; do
      log "  尝试: ${u}"
      if download_archive "$u"; then CODE_VERSION="archive"; break; fi
    done
    [[ -n "$CODE_VERSION" ]] || die "代码获取失败：可用 --archive <tar.gz 地址> 或 --repo <镜像仓库地址> 重试"
  fi
fi

if [[ "$CODE_VERSION" == "archive" ]]; then
  ok "代码版本: 压缩包（无 git 历史）"
else
  ok "代码版本: ${CODE_VERSION}"
fi

# ---------------------------------------------------------------- 编译
log "编译服务端（GOPROXY=${GOPROXY}）"
mkdir -p "$APP_DIR/bin"
( cd "$APP_DIR" && go build -trimpath -ldflags="-s -w" -o "$APP_DIR/bin/$APP_NAME" ./server )
chmod 755 "$APP_DIR/bin/$APP_NAME"
ok "编译完成: $(du -h "$APP_DIR/bin/$APP_NAME" | cut -f1)"

# ---------------------------------------------------------------- 运行用户
if ! id -u "$APP_NAME" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_NAME" 2>/dev/null \
    || useradd -r -M -s /usr/sbin/nologin "$APP_NAME"
  ok "创建系统用户 ${APP_NAME}"
fi

# TLS 证书放到受保护目录
if [[ -n "$TLS_CERT" ]]; then
  install -d -m 750 -o root -g "$APP_NAME" /etc/typewar
  install -m 640 -o root -g "$APP_NAME" "$TLS_CERT" /etc/typewar/cert.pem
  install -m 640 -o root -g "$APP_NAME" "$TLS_KEY"  /etc/typewar/key.pem
  TLS_CERT="/etc/typewar/cert.pem"
  TLS_KEY="/etc/typewar/key.pem"
  ok "证书已部署到 /etc/typewar/"
fi

# ---------------------------------------------------------------- 环境变量
ADDR_VALUE=":${PORT}"
[[ -n "$BIND" ]] && ADDR_VALUE="${BIND}:${PORT}"

{
  echo "# TypeWar 服务端配置（systemd EnvironmentFile）"
  echo "ADDR=${ADDR_VALUE}"
  [[ -n "$TLS_CERT" ]] && echo "TLS_CERT=${TLS_CERT}"
  [[ -n "$TLS_KEY" ]]  && echo "TLS_KEY=${TLS_KEY}"
} > /etc/default/"$APP_NAME"
chmod 644 /etc/default/"$APP_NAME"
ok "监听地址: ${ADDR_VALUE}"

# ---------------------------------------------------------------- systemd
log "写入 systemd 服务"
cat > /etc/systemd/system/"$APP_NAME".service <<EOF
[Unit]
Description=TypeWar 打字对战服务器
Documentation=${REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_NAME}
Group=${APP_NAME}
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/default/${APP_NAME}
ExecStart=${APP_DIR}/bin/${APP_NAME} -dir ${APP_DIR}/public
Restart=always
RestartSec=3

# 安全加固：服务只需读取代码与静态文件
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
chmod 644 /etc/systemd/system/"$APP_NAME".service

systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null 2>&1 || true
systemctl restart "$APP_NAME"
ok "服务已启动"

# ---------------------------------------------------------------- 防火墙
if [[ "$SKIP_FIREWALL" -eq 0 ]]; then
  PORTS=("$PORT")
  [[ -n "$TLS_CERT" ]] && PORTS+=(443)
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    for p in "${PORTS[@]}"; do
      firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null
    done
    firewall-cmd --reload >/dev/null
    ok "firewalld 已放行: ${PORTS[*]}/tcp"
  elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q active; then
    for p in "${PORTS[@]}"; do ufw allow "${p}/tcp" >/dev/null; done
    ok "ufw 已放行: ${PORTS[*]}/tcp"
  else
    warn "未检测到启用的防火墙，跳过（阿里云还需在安全组放行端口）"
  fi
fi

# ---------------------------------------------------------------- 健康检查
log "健康检查"
sleep 1
SCHEME="http"
[[ -n "$TLS_CERT" ]] && SCHEME="https"
if curl -fk --max-time 5 -o /dev/null "${SCHEME}://127.0.0.1:${PORT}/" 2>/dev/null; then
  ok "服务响应正常"
else
  warn "健康检查未通过，请查看日志：journalctl -u ${APP_NAME} -n 50 --no-pager"
fi

# ---------------------------------------------------------------- 汇总
IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
PUBLIC_HOST="${IP:-<服务器IP>}"

cat <<EOF

$(printf '%s  ✓ 安装完成  %s' "$C_OK" "$C_RESET")

  访问地址     ${SCHEME}://${PUBLIC_HOST}:${PORT}/
  静态目录     ${APP_DIR}/public
  运行用户     ${APP_NAME}
  配置文件     /etc/default/${APP_NAME}
  服务管理     systemctl {status|restart|stop} ${APP_NAME}
  实时日志     journalctl -u ${APP_NAME} -f

  公网 PVP（GitHub Pages 前端连过来）：
    https://<用户名>.github.io/typewar/?ws=wss://<你的域名>/ws

$(printf '%s  提醒%s' "$C_WARN" "$C_RESET")
  · 阿里云ECS 需在【安全组】放行 ${PORT}/tcp（用 TLS 时再放行 443/tcp）
  · 直接用 IP + http 只能玩 PVE 和同网页的 PVP；Pages 是 https，
    连自建服务器必须走 wss，建议用 Caddy/Nginx 反代 + 证书（见 deploy/ 下的示例配置）
  · 更新版本：重新执行本脚本即可（自动拉取 + 编译 + 重启）

EOF
