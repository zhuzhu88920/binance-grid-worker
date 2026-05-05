# Binance Grid Worker - 长期记忆

## 项目概述
- Cloudflare Workers 项目，监控 Binance 网格策略的 matchedCount 变化，通过 Bark 推送通知
- 仓库：X:\code\binance-grid-worker
- Worker URL：https://binance-grid-worker.andox.workers.dev
- Cron：每 5 分钟触发一次

## 用户信息
- 用户有两个 Binance 账号：zhuzhu 和 queena
- 使用 Bark 推送通知，Bark Key: YwSqmvunLvMV8a3Nn4gS7c

## 架构要点
- `src/index.js`: 主逻辑（请求头构建、API 调用、数据处理、路由）
- `src/push.js`: Bark 推送
- `src/kv.js`: KV 存储操作（matchedCount 持久化、cron 状态）
- `.dev.vars`: 本地环境变量（不提交 git）
- CF secrets: `wrangler secret put USER{N}_COOKIE/CSRF_TOKEN/BARK_KEY/ID`

## 关键技术发现
- CF Worker 不能 fetch 自己的 URL（会触发 1042 错误），scheduled 必须直接调用函数
- Binance API 需要完整的浏览器请求头才能通过认证（cookie、csrftoken、device-info、fvideo-id、bnc-uuid、sec-ch-ua、sec-fetch-* 等）
- `aws-waf-token` 是 AWS WAF Bot Control token，可能绑定 IP 地址
- `device-info` 是 base64 编码的 JSON 设备指纹
- `fvideo-id` 应与 cookie 中的 `BNC_FV_KEY` 值相同
- `csrftoken` 是自定义请求头（不是 cookie），由前端框架内存中生成
- **获取账户总资产**用 wallet-group API：`/bapi/asset/v3/private/asset-service/wallet/wallet-group?quoteAsset=USDT&needAlphaAsset=true&needEuFuture=true`，GET 请求，返回 data[] 按 walletGroupType 分组（TradingBots/Futures/Spot/Funding），每组有 totalBalance 字段
- **获取详细余额**用 balance API：`/bapi/asset/v2/private/asset-service/wallet/balance?quoteAsset=USDT&needBalanceDetail=true&needEuFuture=true`，返回各钱包的具体币种余额（含 assetBalances 数组，有 free/locked/freeze 等字段）
- 网格策略的"总资产"= wallet-group 中 TradingBots.totalBalance + Futures.totalBalance
- `strategyAmount`（query-open-grids 返回）≈ TradingBots.totalBalance，差额是实时浮动盈亏
- Futures.totalBalance 是合约钱包可用余额（未投入网格的 USDC）
- balance API 中 FUTURE 钱包的 assetBalances 里 USDC 的 free 字段就是可用余额

## 已知问题
- zhuzhu 账号 cookie 频繁失效（401 code 100002001），可能因 aws-waf-token 绑定 IP
- queena 账号一直稳定
- Cookie 更新依赖用户手动操作（浏览器 DevTools 复制请求头）
- CF Durable Objects 可用于固定 Worker 出口 IP 到 HK（方案待实施）

## 排查经验
- **`auto_update.js` 推送 secret 为空的 bug 已修复**（stdio: 'ignore' → 'pipe'）
- 推送后务必 `curl /api/users` 验证，count=0 说明 cookie/csrf 有空值
- `execSync` 带 `input:` 时，`stdio` 必须 `'pipe'`，否则 stdin 关闭导致 wrangler 读到空值
- 本地验证用 `wrangler dev --local` + `curl <http://localhost:8787/api/users>`
