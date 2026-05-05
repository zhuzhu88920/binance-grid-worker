# Binance Grid Worker

基于 Cloudflare Workers 的币安合约网格策略监控，自动抓取策略数据并通过 Bark 推送到手机。Cron 每 5 分钟运行一次，仅在**已配对订单数发生变化**时推送，避免频繁打扰。

## 项目结构

```
binance-grid-worker/
├── src/
│   ├── index.js          # 主入口：路由 + Binance API + cron 调度
│   ├── push.js           # Bark 推送模块（POST+JSON，支持中文）
│   ├── push-config.js    # 推送消息模板（由 build-template.cjs 自动生成）
│   └── kv.js            # KV 封装（合并存储：last_matched_counts + cron_status）
├── auto_update.js        # [本地工具] 自动抓取浏览器 cookie 并同步到 CF（不提交 git）
├── build-template.cjs   # 读取 push-template.yaml → 生成 src/push-config.js
├── push-template.yaml   # 推送消息模板（修改后运行 npm run build:template）
├── wrangler.toml        # Wrangler 配置文件（cron、KV 绑定）
├── .dev.vars            # 本地环境变量（不提交 git）
└── package.json
```

## 架构说明

### KV 存储优化策略

为减少 Cloudflare KV 写入次数，项目采用**合并存储**策略：

**存储结构**：
- 所有用户数据合并存储在单个 KV 键 `all_data` 中
- 包含 `last_matched_counts`（所有用户的已配对订单数）和 `cron_status`（cron 执行状态）

**写入优化**：
- 仅在数据变化时写入（如果所有用户的已配对订单数无变化，不执行写入）
- 一次性写入所有数据（所有用户 + cron 状态）
- 读取操作无限制（CF KV 读取不计入配额）

**配额计算**：
- 假设每天网格策略变化 100 次
- 每次变化：1 次写入
- 每天写入：100 次
- CF KV 免费额度：1,000 次/天

**结论**：即使多用户场景，也完全不会超出免费限制。

### 451 错误解决方案

Cloudflare Workers 的边缘节点可能分布在全球不同地区，当节点位于美国等地时，Binance 会返回 451 错误（`Service unavailable from a restricted location`）。

本项目通过**反向代理**解决此问题：
1. 在香港 VPS 上部署 Nginx Proxy Manager（或直接用 Nginx 配置反向代理）
2. Worker 请求先打到香港代理，再由代理转发到 Binance
3. 代理出口 IP 位于香港，Binance 允许访问

### 请求头变量化

为了提高安全性并避免被 Binance 封号，API 请求头（包括 User-Agent、Device-Info、Sec-CH-UA 等）不再硬编码，而是存储在环境变量中：
- `USER1_USER_AGENT` - 用户代理字符串
- `USER1_DEVICE_INFO` - 设备指纹（base64 编码）
- `USER1_SEC_CH_UA` - 浏览器 UA 元数据

每个用户账号的请求头独立配置，更加安全灵活。

## 快速开始

### 1. 前置条件

- [Node.js](https://nodejs.org/) >= 18
- Cloudflare 账号（免费版即可）
- [Bark App](https://apps.apple.com/app/bark/id1400184399)（iOS 推送用，安卓用 [Bark-Android](https://github.com/Finb/Bark)）
- **香港 VPS**（用于部署反向代理，可选，如遇到 451 错误则必须配置）

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

### 4. 配置反向代理（如遇到 451 错误）

如果 Cloudflare 边缘节点位于美国等地，Binance 会返回 451 错误。需要在香港 VPS 上配置反向代理：

#### 方案一：Nginx Proxy Manager（推荐）

1. 在香港 VPS 上安装 [Nginx Proxy Manager](https://nginxproxymanager.com/)
2. 添加 Proxy Host：
   - **Domain Names**: `binance.***.cc.cd`（换成你的域名）
   - **Scheme**: `https`
   - **Forward Hostname / IP**: `www.binance.com`
   - **Forward Port**: `443`
   - **Cache Assets**: OFF
   - **Block Common Exploits**: ON
   - **Websockets Support**: ON
3. 在 "Custom Nginx Configuration" 中添加：
   ```nginx
   location / {
       proxy_set_header Host www.binance.com;
       proxy_set_header Origin https://www.binance.com;
       proxy_set_header Referer https://www.binance.com/;
       proxy_set_header Accept */*;
       proxy_set_header Accept-Language zh-CN,zh;q=0.9,en;q=0.8;
       proxy_set_header Accept-Encoding gzip,deflate,br;
       proxy_set_header Content-Type application/json;
       
       proxy_ssl_server_name on;
       proxy_ssl_protocols TLSv1.2 TLSv1.3;
       
       proxy_pass https://www.binance.com;
   }
   ```
4. 同理配置 `fapi.***.cc.cd` → `fapi.binance.com`（行情 API）

#### 方案二：直接用 Nginx

```nginx
server {
    listen 80;
    server_name binance.***.cc.cd;

    location / {
        proxy_set_header Host www.binance.com;
        proxy_set_header Origin https://www.binance.com;
        proxy_set_header Referer https://www.binance.com/;
        proxy_set_header Accept */*;
        proxy_set_header Accept-Language zh-CN,zh;q=0.9,en;q=0.8;
        proxy_set_header Accept-Encoding gzip,deflate,br;
        proxy_set_header Content-Type application/json;
        
        proxy_ssl_server_name on;
        proxy_ssl_protocols TLSv1.2 TLSv1.3;
        
        proxy_pass https://www.binance.com;
    }
}
```

5. 配置完成后，将代理地址添加到 Cloudflare Secrets：
   ```bash
   wrangler secret put BAPI_BASE_URL
   # 输入：http://binance.***.cc.cd
   
   wrangler secret put FAPI_BASE_URL
   # 输入：http://fapi.***.cc.cd
   ```

### 5. 手动配置凭证（备选）

如果不想用自动抓取，也可以手动创建 `.dev.vars`：

```bash
# 多用户格式（支持 1-9 个用户）
USER1_COOKIE=账号1的完整cookie
USER1_CSRF_TOKEN=账号1的csrftoken
USER1_BARK_KEY=账号1的Bark Key
USER1_ID=zhuzhu
USER1_USER_AGENT=账号1的User-Agent（从浏览器DevTools复制）
USER1_DEVICE_INFO=账号1的device-info（base64编码的JSON）
USER1_SEC_CH_UA=账号1的sec-ch-ua

USER2_COOKIE=账号2的完整cookie
USER2_CSRF_TOKEN=账号2的csrftoken
USER2_BARK_KEY=账号2的Bark Key
USER2_ID=queena
USER2_USER_AGENT=账号2的User-Agent
USER2_DEVICE_INFO=账号2的device-info
USER2_SEC_CH_UA=账号2的sec-ch-ua

# 反向代理地址（如已配置代理）
BAPI_BASE_URL=http://binance.***.cc.cd
FAPI_BASE_URL=http://fapi.***.cc.cd
```

> **注意**：为提高安全性，每个用户的 `USER_AGENT`、`DEVICE_INFO`、`SEC_CH_UA` 应与该用户的浏览器环境保持一致。

然后用 `auto_update.js` 选项 4 或手动 `wrangler secret put` 上传到 Cloudflare。

### 6. 本地测试

```bash
npm run dev
# 另开终端
curl http://localhost:8787/health
curl http://localhost:8787/api/users
curl -X POST http://localhost:8787/api/trigger
```

### 7. 部署到 Cloudflare Workers

```bash
# 先上传凭证到 CF Secrets（通过 auto_update.js 选项 4 或手动 wrangler secret put）
# 然后部署
npm run deploy
```

### 8. 验证部署

```bash
curl https://binance-grid-worker.*****.workers.dev/health
curl https://binance-grid-worker.*****.workers.dev/api/users
curl https://binance-grid-worker.*****.workers.dev/api/cron-status
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

标题：`🤖zhuzhu 💰2375.88 ⏰23:00 🏦3790U`

- 🤖 用户名
- 💰 当前标记价格
- ⏰ 北京时间
- 🏦 总资产（USDT，整数，来自 wallet-group API）

正文（每个策略一行）：
```
🟢500U 20x 🍻350 🍺5 🚀+5.42(+0.54%)|+3.20(+0.32%)|+2.22(+0.22%) ☀7.5day
```

可通过修改 `push-template.yaml` 自定义格式，修改后运行 `npm run build:template` 生成新配置。

## Cron 说明

- 每 5 分钟自动触发（`*/5 * * * *`）
- **仅在已配对订单数（matchedCount）发生变化时推送**
- 首次运行或重置后会推送一次（基准值建立）

## KV 存储优化

为减少 Cloudflare KV 写入次数，项目采用**合并存储**策略：

### 存储结构

所有数据合并存储在单个 KV 键 `all_data` 中：
```javascript
{
  "last_matched_counts": {
    "user1": {"strategy1": 10},
    "user2": {"strategy2": 5}
  },
  "cron_status": {
    "lastRun": "📅 2026-05-03 ⏰ 14:30",
    "status": "success",
    "colo": "🇺🇸 ORD"
  }
}
```

### 写入优化

- **仅在数据变化时写入**：如果所有用户的已配对订单数无变化，不执行写入操作
- **一次性写入**：所有用户数据和 cron 状态合并为一次写入
- **读取无限制**：CF KV 读取操作不计入配额

### 配额计算

假设每天网格策略变化 100 次：
- 每次变化：1 次写入
- 每天写入：100 次
- **CF KV 免费额度**：1,000 次/天

**结论**：即使多用户场景，也完全不会超出免费限制。

## 故障排查

**遇到 451 错误？**
- 错误信息：`Service unavailable from a restricted location`
- 原因：Cloudflare 边缘节点位于美国等地，Binance 限制了该地区访问
- 解决：参考本文档"配置反向代理"章节，添加 `BAPI_BASE_URL` 和 `FAPI_BASE_URL` 到 Cloudflare Secrets

**推送后 `/api/users` 返回 0 个用户？**
- 用 `auto_update.js` 选项 4 推送后，立即 `curl /api/users` 验证
- 如果 count=0，说明 cookie 或 csrf_token 被设为了空值，需要重新推送

**Cookie 失效？**
- Binance cookie 有效期约 24 小时，过期后需重新运行 `auto_update.js` 抓取

**Bark 推送没收到？**
- 检查 Bark Key 是否正确：`curl https://api.day.app/你的key`
- 查看 CF Workers 日志：Dashboard → Workers → 查看日志
