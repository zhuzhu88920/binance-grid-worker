# Binance Grid Worker

基于 Cloudflare Workers 的币安合约网格策略监控，自动抓取策略数据并通过 Bark 推送到手机。Cron 每 5 分钟运行一次，仅在**已配对订单数发生变化**时推送，避免频繁打扰。

## 项目结构

```
binance-grid-worker/
├── src/
│   ├── index.js          # 主入口：路由 + Binance API + cron 调度
│   ├── push.js           # Bark 推送模块（POST+JSON，支持中文）
│   ├── push-config.js    # 推送消息模板（由 build-template.cjs 自动生成）
│   └── kv.js            # KV 封装（仅用于持久化 last_matched_counts）
├── push-template.yaml    # 推送消息模板（修改此文件后运行 npm run build:template）
├── build-template.cjs   # 读取 push-template.yaml → 生成 src/push-config.js
├── wrangler.toml        # Wrangler 配置文件（cron、KV 绑定）
├── .dev.vars            # 本地开发环境变量（不提交 git）
├── sync-secrets.cjs     # 同步 .dev.vars → Cloudflare Worker Secrets
└── package.json
```

## 快速开始

### 1. 前置条件

- [Node.js](https://nodejs.org/) ≥ 18
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)（安装：`npm install -g wrangler`）
- Cloudflare 账号（免费版即可）
- [Bark App](https://apps.apple.com/app/bark/id1400184399)（iOS 推送用，安卓用 [Bark-Android](https://github.com/Finb/Bark)）

### 2. 克隆项目

```bash
git clone https://github.com/zhuzhu88920/binance-grid-worker.git
cd binance-grid-worker
npm install
```

### 3. 配置凭证（`.dev.vars`）

在项目根目录创建 `.dev.vars` 文件（已有模板），填入你的凭证：

```bash
# 单用户
COOKIE=你的完整cookie（从浏览器复制，不加引号）
CSRF_TOKEN=你的csrftoken
BARK_KEY=你的Bark Key
USER_ID=zhuzhu

# 或多用户（推荐）
USER1_COOKIE=账号1的完整cookie
USER1_CSRF_TOKEN=账号1的csrftoken
USER1_BARK_KEY=账号1的Bark Key
USER1_ID=zhuzhu

USER2_COOKIE=账号2的完整cookie
USER2_CSRF_TOKEN=账号2的csrftoken
USER2_BARK_KEY=账号2的Bark Key
USER2_ID=user2
```

> **获取 Cookie / CSRF Token 方法：**
> 1. 浏览器打开 https://www.binance.com/ 并登录
> 2. 按 F12 → Network 标签 → 刷新页面
> 3. 找任意请求 → Request Headers → 复制 `cookie` 整行值
> 4. `csrftoken` 在 cookie 字符串里，格式是 `csrftoken=xxxxx`，把 xxxxx 部分复制出来

### 4. 本地测试

```bash
# 启动本地开发服务器
npm run dev
# 另开终端测试
curl http://localhost:8787/health
curl -X POST http://localhost:8787/api/trigger
```

### 5. 部署到 Cloudflare Workers

**方式 A：自动部署（推荐）**

1. 在 GitHub repo Settings → Secrets and variables → Actions 添加 `CLOUDFLARE_API_TOKEN`
2. 每次 push 到 main 分支自动触发部署

**方式 B：手动部署**

```bash
# 先上传 secrets（只需第一次，之后更新 .dev.vars 后重新运行即可）
node sync-secrets.cjs

# 部署
npm run deploy
```

### 6. 验证部署

```bash
# 健康检查
curl https://binance-grid-worker.andox.workers.dev/health

# 查看已加载的用户
curl https://binance-grid-worker.andox.workers.dev/api/users

# 手动触发一次推送
curl -X POST https://binance-grid-worker.andox.workers.dev/api/trigger
```

## 推送消息格式

标题：`🤖zhuzhu  💰2262.73 | 📈+5.42% | 14:35`

正文（每个策略一行）：
```
🟢 ETHUSDC  本金:1000  杠杆:20x  已配对:350  未配对:5
```

- 🟢 总收益率 > 5%
- 🟡 0% ~ 5%
- 🟠 -5% ~ 0%
- 🔴 < -5%

可通过修改 `push-template.yaml` 自定义格式，修改后运行 `npm run build:template` 生成新配置。

## Cron 说明

- 每 5 分钟自动触发（`*/5 * * * *`）
- **仅在已配对订单数（matchedCount）发生变化时推送**
- 首次运行或重置后会推送一次（基准值建立）

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 本地开发（http://localhost:8787） |
| `npm run deploy` | 部署到 CF |
| `node sync-secrets.cjs` | 上传 .dev.vars 到 CF Secrets |
| `node sync-secrets.cjs --dry` | 预览但不实际上传 |
| `npm run build:template` | 重新生成推送模板 |

## 故障排查

**推送没收到？**
- 检查 Bark Key 是否正确：`curl https://api.day.app/你的key`
- 查看 CF Workers 日志：在 Dashboard → Workers → 查看日志

**Cookie 失效？**
- Binance cookie 有效期约 24 小时，过期后需重新获取并更新 secrets
- 收到「Cookie 已失效」推送说明需要更新

**本地测试报 UNAUTHORIZED？**
- `.dev.vars` 里的 cookie 不完整，从浏览器重新复制整段 cookie
