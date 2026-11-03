# TypeWar ⌨️⚔️

以**打字**为核心玩法的实时对战游戏：打字积攒**行动力(AP)**与**魔法力(MP)**，释放人物特技击败对手。支持 **PVE**（四档难度 AI）与 **PVP**（WebSocket 在线对战）。

## 快速开始

需要 **Go 1.21+**（服务端已用 Go 重写，无其它依赖）。

```bash
go run ./server
# 或使用 npm start（等价于上一条命令）
# 打开 http://localhost:3000
```

- **PVE**：主菜单 → 单人挑战 → 选难度 + 词库 + 人物卡 → 开战
- **PVP**：一台设备开两个标签页，或同一局域网的两台设备（访问主机 IP:3000）
  - 玩家 1：创建对战 → 获得房间码
  - 玩家 2：加入房间 → 输入房间码
  - 双方选卡、就绪 → 倒计时开战
- **指法练习**：主菜单 → 指法练习（不带对战，专注键位与手速）

## 指法练习

独立的打字训练模式，适合赛前热身或纯练指法：

- **虚拟键盘**：每个键底部按「该用哪根手指」着色（食指青、中指绿、无名指橙、小指粉），`F`/`J` 标出基准键凸点
- **实时指导**：下一个要按的键发光放大，并提示「左手食指 · 按 F」
- **即时反馈**：打对字符变绿、打错整词抖动、连击清零
- **三种模式**：🎯 基础键位（围绕 asdf jkl 的单词）/ 🔤 常用单词 / 🐍 Python 关键字
- **成绩单**：每局 20 词，统计 WPM、准确率、用时、最高连击、错误次数

操作：直接打字即可开始，`Esc` 或「返回」退出。

启动参数：

```bash
go run ./server -addr :8080          # 改端口（也可用 PORT 环境变量）
go run ./server -dir ./public        # 改静态目录
go run ./server -tls-cert c.pem -tls-key k.pem   # 直接提供 HTTPS/WSS（否则建议放在反向代理后）
```

## 玩法规则

| 操作 | 效果 |
|---|---|
| 敲对字母 | +行动力(AP)，连击 +1 |
| 敲错字母 | 连击清零 |
| 打完整词 | 自动普攻（伤害随词长与连击提升） |
| 击破紫色魔法词 ✦ | 额外奖励魔法力(MP) |
| 击破绿色代码词 > | Python 关键字/内置函数（打字不区分大小写） |
| 词漂到防线未击破 | 自己掉血！ |
| `1` / `2` / `3` | 释放特技（也可点击技能按钮） |

HP 归零的一方落败。

## 词库

PVE 配置页可选三种词库：

| 模式 | 内容 |
|---|---|
| 🔤 标准 | 约 1750 个通用英文词，按战斗时长提升词长 |
| 🔀 混合（默认） | 英文词 + 约 22% 的 Python 词 |
| 🐍 Python | 只出 Python 词（另保留少量魔法词作为 MP 来源） |

**Python 词库**包含 35 个关键字（`False` `None` `True` `and` `as` `assert` `async` `await` `break` `class` `continue` `def` `del` `elif` `else` `except` `finally` `for` `from` `global` `if` `import` `in` `is` `lambda` `nonlocal` `not` `or` `pass` `raise` `return` `try` `while` `with` `yield`）、软关键字（`match` `case` `type`）以及常用内置函数（`print` `len` `range` `isinstance` `enumerate` …），共 107 个。

> 大小写不敏感：`True` 敲 `true` 即可。
> 带下划线的名字（`__init__`、`__main__`）未收录——引擎只接受 a-z 键位，无法输入下划线。
> PVP 对战固定使用「混合」词库。

## 人物卡（各 3 个特技）

| 人物 | HP | 定位 | 特技 |
|---|---|---|---|
| ⚔️ 剑士·凯 | 120 | AP 稳健攻防 | 破军斩(34伤) / 战吼(增伤60%) / 铁壁(护盾30) |
| 🔥 法师·璃 | 90 | MP 爆发 | 烈焰风暴(42伤) / 寒冰咒(冻结敌方词流) / 秘法汲取(偷蓝) |
| 🏹 游侠·风 | 100 | 均衡速攻 | 连珠箭(3×11) / 疾风步(资源加速) / 毒刃(中毒 DoT) |
| 🌑 术士·影 | 95 | 干扰消耗 | 混乱咒(污染敌方词流) / 吸血咒(吸血) / 暗影侵蚀(DoT+沉默) |

## AI 难度

🌱 简单 (18 WPM) → ⚔️ 普通 (30) → 🔥 困难 (45) → 💀 地狱 (62，几乎零失误)

## 技术栈

- **前端**：原生 HTML/CSS/JS（ES Modules），零构建；DOM 词流 + Canvas 粒子特效 + WebAudio 合成音效
- **后端**：Go + `gorilla/websocket`：静态托管 + WebSocket 房间（创建/加入/就绪/事件转发），编译为单二进制，无运行时依赖
- **PVP 同步**：服务器下发 RNG 种子；双方各自权威模拟己方（快照 8Hz 同步词流与状态），攻击/特技以事件广播由受害方权威结算；掉线判负
- **部署**：GitHub Pages（静态托管 PVE）+ 自建 Go 服务器（PVP），前端用 `?ws=wss://...` 指定联机地址

## 目录结构

```
server/             # Go 服务端（单二进制，无运行时依赖）
  main.go           # HTTP 静态托管 + /ws 升级 + TLS/端口/目录参数
  room.go           # 连接读写泵、Hub、房间协议（创建/加入/就绪/转发/再战/掉线）
public/
  js/
    data.js         # 人物卡、特技、难度、词库（1700+ 英文词 + 107 Python 词）
    words.js        # 种子化词流生成器（长度分级/魔法词/干扰词/词库模式）
    engine.js       # 打字引擎 Lane（生成/移动/匹配/击破/撞线，大小写不敏感）
    skills.js       # 特技结算（PVE 本地 / PVP 收发）
    battle.js       # 战斗控制器（资源/连击/DoT/护盾/同步）
    ai.js           # AI 对手（WPM/准确率/技能策略）
    practice.js     # 指法练习（键位图/手指提示/成绩单）
    net.js          # WebSocket 客户端（支持 ?ws= 指定服务器）
    fx.js           # 粒子/浮动数字/弹道/屏震/音效
    ui.js           # 页面渲染（菜单/配置/大厅/结算）
    main.js         # 入口：页面流状态与网络事件
  css/style.css     # 霓虹科幻主题
scripts/build.sh    # 交叉编译（linux/windows/darwin）
Dockerfile          # 多阶段构建镜像
```

## 部署

前端是纯静态资源，可托管在任意静态站点；**PVP 需要这台 Go 服务器**。

### 1. 静态前端 → GitHub Pages

已配置 `.github/workflows/deploy-pages.yml`，推送 `main` 即自动发布 `public/`。
线上地址形如 `https://<用户名>.github.io/typewar/`（PVE 直接可玩）。

### 2. 联机服务器 → 任意 VPS（推荐一键脚本）

在阿里云 ECS / 腾讯云 / 任意 Linux 上（Alibaba Cloud Linux、CentOS、Ubuntu、Debian 均可）：

```bash
# 下载脚本后执行（脚本会自动装 Go、编译、配 systemd、放行防火墙）
curl -fsSL -o install.sh https://raw.githubusercontent.com/zhumin2/typewar/main/deploy/install.sh
sudo bash install.sh
```

> **国内服务器**：`raw.githubusercontent.com` 常被阻断，改用镜像下载脚本：
>
> ```bash
> curl -fsSL -o install.sh https://cdn.jsdelivr.net/gh/zhumin2/typewar@main/deploy/install.sh
> # 备选：https://ghfast.top/https://raw.githubusercontent.com/zhumin2/typewar/main/deploy/install.sh
> sudo bash install.sh
> ```
>
> 脚本内部也会自动处理网络问题：`git clone github.com` 失败时依次尝试
> `ghfast.top` / `gh-proxy.com` / `ghproxy.net` / `codeload` 镜像下载 tar.gz。
> 也可手动指定：`--archive <tar.gz地址>` 或 `--repo <镜像仓库地址>`。

常用参数：

```bash
sudo bash install.sh --port 8080                      # 换端口
sudo bash install.sh --bind 127.0.0.1                 # 只监听本机（配合反代，推荐）
sudo bash install.sh --tls-cert /root/cert.pem --tls-key /root/key.pem   # 直接上 HTTPS/WSS
sudo bash install.sh --skip-firewall                  # 不动防火墙
```

脚本做的事：

1. 识别 `dnf/yum/apt`，安装 git/curl 等基础依赖
2. 检测 Go，缺失或低于 1.21 则下载安装（默认走 `golang.google.cn`，失败自动回退 `go.dev`、`mirrors.aliyun.com`）
3. 克隆/更新仓库到 `/opt/typewar`，用 `goproxy.cn` 拉模块并编译
4. 创建 `typewar` 系统用户，写入 `/etc/systemd/system/typewar.service`（含 systemd 安全加固）
5. 放行防火墙端口，启动服务并做健康检查

**再次执行同一脚本即为升级**：拉最新代码 → 重新编译 → 重启。

日常运维：

```bash
systemctl status typewar        # 状态
journalctl -u typewar -f        # 实时日志
systemctl restart typewar       # 重启
```

配置文件位于 `/etc/default/typewar`（`ADDR` / `TLS_CERT` / `TLS_KEY`）。

**方式 B：Docker**

```bash
docker build -t typewar .
docker run -d --name typewar -p 3000:3000 --restart unless-stopped typewar
```

**方式 C：手动单二进制**

```bash
./scripts/build.sh linux          # 产出 bin/typewar-linux-amd64、arm64
scp bin/typewar-linux-amd64 user@vps:/opt/typewar
scp -r public user@vps:/opt/typewar/
ssh user@vps '/opt/typewar -addr :3000 -dir /opt/typewar/public'
```

### 3. HTTPS / WSS（公网联机必需）

GitHub Pages 是 https 页面，只能连 `wss://`，所以自建服务器必须配 TLS。两种方式：

**A. 反向代理（推荐）**：服务器只监听本机，由 Caddy/Nginx 终结 TLS。

```bash
sudo bash install.sh --bind 127.0.0.1
# Caddy：自动签发并续期证书，WebSocket 开箱可用
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
# 或 Nginx（示例已含 /ws 的 Upgrade 头与长连接超时）
sudo cp deploy/nginx.conf /etc/nginx/conf.d/typewar.conf && sudo nginx -s reload
```

**B. 服务端直接 TLS**：把证书交给脚本，Go 进程自己监听 443。

```bash
sudo bash install.sh --port 443 --tls-cert /path/fullchain.pem --tls-key /path/privkey.pem
```

> 阿里云还需要在 **ECS 安全组**放行对应端口（80/443 或自定义端口），否则外网访问不到。

### 4. 让 Pages 上的前端连到你的服务器

在地址后加 `?ws=` 参数即可：

```
https://<用户名>.github.io/typewar/?ws=wss://game.example.com/ws
```

自建前端与服务器同源时无需该参数，默认连 `location.host/ws`。
