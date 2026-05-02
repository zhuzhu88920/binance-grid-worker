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
├── auto_update.js        # [本地工具] 自动抓取浏览器 cookie 并同步到 CF（不提交 git）
├── build-template.cjs   # 读取 push-template.yaml → 生成 src/push-config.js
├── push-template.yaml   # 推送消息模板（修改后运行 npm run build:template）
├── wrangler.toml        # Wrangler 配置文件（cron、KV 绑定）
├── .dev.vars            # 本地环境变量（不提交 git）
└── package.json
```

## 快速开始

### 1. 前置条件

- [Node.js](https://nodejs.org/) >= 18
- Cloudflare 账号（免费版即可）
- [Bark App](https://apps.apple.com/app/bark/id1400184399)（iOS 推送用，安卓用 [Bark-Android](https://github.com/Finb/Bark)）

### 2. 克隆项目

```bash
git clone https://github.com/zhuzhu88920/binance-grid-worker.git
cd binance-grid-worker
npm install
```

### 3. 自动抓取 Cookie 并配置（推荐）

项目自带 `auto_update.js` 工具，可以自动从浏览器抓取 Binance 凭证并推送到 Cloudflare：

1. 用远程调试模式启动 Edge 浏览器：
   ```
   msedge --remote-debugging-port=9222
   ```
2. 在浏览器中登录 Binance 并打开网格交易页面
3. 运行抓取工具：
   ```bash
   node auto_update.js
   ```
4. 按菜单提示操作：
   - 选项 1/2/3：抓取指定用户的 cookie（仅保存到本地 `.dev.vars`）
   - 选项 4：将本地 `.dev.vars` 推送到 Cloudflare Secrets
5. 在 `.dev.vars` 中手动补充 `USER1_BARK_KEY`、`USER1_ID` 等字段（抓取工具不会自动写入这些）

> **注意**：`auto_update.js` 不会提交到 git，仅在本地使用。

### 4. 手动配置凭证（备选）

如果不想用自动抓取，也可以手动创建 `.dev.vars`：

```bash
# 多用户格式（支持 1-9 个用户）
USER1_COOKIE=账号1的完整cookie
USER1_CSRF_TOKEN=账号1的csrftoken
USER1_BARK_KEY=账号1的Bark Key
USER1_ID=zhuzhu

USER2_COOKIE=账号2的完整cookie
USER2_CSRF_TOKEN=账号2的csrftoken
USER2_BARK_KEY=账号2的Bark Key
USER2_ID=queena
```

然后用 `auto_update.js` 选项 4 或手动 `wrangler secret put` 上传到 Cloudflare。

### 5. 本地测试

```bash
npm run dev
# 另开终端
curl http://localhost:8787/health
curl http://localhost:8787/api/users
curl -X POST http://localhost:8787/api/trigger
```

### 6. 部署到 Cloudflare Workers

```bash
# 先上传凭证到 CF Secrets（通过 auto_update.js 选项 4 或手动 wrangler secret put）
# 然后部署
npm run deploy
```

### 7. 验证部署

```bash
curl https://binance-grid-worker.andox.workers.dev/health
curl https://binance-grid-worker.andox.workers.dev/api/users
curl https://binance-grid-worker.andox.workers.dev/api/cron-status
```

## API 端点

| 路由 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/api/users` | GET | 查看已加载的用户列表（不含敏感信息） |
| `/api/trigger` | POST | 手动触发一次全部用户推送 |
| `/api/test` | GET | 本地调试：从 .dev.vars 读凭证并推送 |
| `/api/cron-status` | GET | 查看 cron 最后一次执行状态 |

## 推送消息格式

标题：`zhuzhu | 2262.73 | +5.42% | 14:35`

正文（每个策略一行）：
```
ETHUSDC  本金:1000  杠杆:20x  已配对:350  未配对:5
```

可通过修改 `push-template.yaml` 自定义格式，修改后运行 `npm run build:template` 生成新配置。

## Cron 说明

- 每 5 分钟自动触发（`*/5 * * * *`）
- **仅在已配对订单数（matchedCount）发生变化时推送**
- 首次运行或重置后会推送一次（基准值建立）

## 故障排查

**推送后 `/api/users` 返回 0 个用户？**
- 用 `auto_update.js` 选项 4 推送后，立即 `curl /api/users` 验证
- 如果 count=0，说明 cookie 或 csrf_token 被设为了空值，需要重新推送

**Cookie 失效？**
- Binance cookie 有效期约 24 小时，过期后需重新运行 `auto_update.js` 抓取

**Bark 推送没收到？**
- 检查 Bark Key 是否正确：`curl https://api.day.app/你的key`
- 查看 CF Workers 日志：Dashboard → Workers → 查看日志
