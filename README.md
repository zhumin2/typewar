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

### 2. 联机服务器 → 任意 VPS

**方式 A：单二进制**

```bash
./scripts/build.sh linux          # 产出 bin/typewar-linux-amd64、arm64
scp bin/typewar-linux-amd64 user@vps:/opt/typewar
scp -r public user@vps:/opt/typewar/
ssh user@vps '/opt/typewar -addr :3000 -dir /opt/typewar/public'
```

**方式 B：Docker**

```bash
docker build -t typewar .
docker run -d --name typewar -p 3000:3000 --restart unless-stopped typewar
```

**TLS**：建议用 Caddy/Nginx 反代并签发证书，再将 443 转发到 `:3000`。

### 3. 让 Pages 上的前端连到你的服务器

在地址后加 `?ws=` 参数即可（`https` 页面必须用 `wss://`）：

```
https://<用户名>.github.io/typewar/?ws=wss://game.example.com/ws
```

自建前端与服务器同源时无需该参数，默认连 `location.host/ws`。
