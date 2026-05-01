# 币安网格策略监控推送，小白也能 5 分钟搞定

> 手把手教你用 Cloudflare Workers 免费监控币安合约网格策略，自动推送到手机 Bark。

## 这东西是干嘛的？

跑币安合约网格策略的同学应该深有体会——想随时知道策略收益变化，只能频繁打开 APP 看，很烦。

这个项目帮你解决这个问题：

- **自动监控**：每 5 分钟检查一次你的网格策略
- **智能推送**：只有已配对订单数发生变化时才推送到手机，不会频繁打扰
- **完全免费**：部署在 Cloudflare Workers 免费套餐上，不花钱
- **多账号支持**：可以同时监控多个 Binance 账号

推送效果长这样：

```
标题：🤖zhuzhu  💰2262.73 | 📈+5.42% | 14:35

正文：
🟢 1000U 20x | 🔁350 ↪️5 | +54.20(+5.42%)|+50.00(+5.00%)|+4.20(+0.42%) | 7.2
```

- 🟢 总收益率 > 5%
- 🟡 0% ~ 5%
- 🟠 -5% ~ 0%
- 🔴 < -5%

---

## 前置准备

开始之前，你需要准备这些东西（都是免费的）：

| 准备项 | 说明 |
|--------|------|
| Binance 账号 | 你跑网格策略的那个账号 |
| Cloudflare 账号 | 注册：https://dash.cloudflare.com/sign-up |
| GitHub 账号 | 注册：https://github.com/signup |
| Node.js | 下载安装：https://nodejs.org/ |
| iPhone（iOS） | 安装 Bark：App Store 搜索 "Bark" |
| 安卓手机 | 安装 Bark-Android：https://github.com/Finb/Bark/releases |

---

## 第一步：安装 Bark 并获取推送 Key

### iPhone 用户

1. App Store 搜索 **Bark**，安装
2. 打开 Bark APP，首页会显示一个推送地址，类似：
   ```
   https://api.day.app/XXXXXXXXXXXXXXXX
   ```
3. 复制 `/` 后面的那串字符，这就是你的 **Bark Key**
   ```
   XXXXXXXXXX
   ```

### 安卓用户

1. 打开 https://github.com/Finb/Bark/releases 下载最新 APK
2. 安装后打开，同样的方式获取 Bark Key

> **验证 Bark 是否可用：** 浏览器直接访问 `https://api.day.app/你的BarkKey/测试消息` ，手机收到推送就说明没问题。

---

## 第二步：获取 Binance Cookie 和 CSRF Token

这是整个教程中**最关键**的一步，跟着做就行。

### 2.1 登录 Binance

用电脑浏览器打开 https://www.binance.com/ 并登录你的账号。

### 2.2 打开开发者工具

- **Chrome / Edge**：按 `F12` 键，或者右键网页 → 检查
- **Mac**：`Command + Option + I`

### 2.3 切换到 Network（网络）标签

点击顶部 **Network** 标签，然后刷新页面（`F5`）。

![](https://imglf3.lf127.net/img/20260501/example-network.png)

### 2.4 复制 Cookie

1. 在请求列表中随便点一个 `www.binance.com` 的请求
2. 右侧展开 **Request Headers**（请求头）
3. 找到 `cookie:` 那一行，**把整个 cookie 值全部复制**（很长的一段文字）

> **注意：** 一定要完整复制！cookie 很长，大概 2000-3000 个字符。确保从头到尾全部选中。

### 2.5 提取 CSRF Token

CSRF Token 其实就藏在你刚复制的 Cookie 里面。

在 Cookie 值中搜索 `csrftoken=`，找到类似这样的内容：

```
csrftoken=c169f9da1d39007442486cd35c3ebe22
```

把等号后面的那串字符复制出来，这就是你的 **CSRF Token**。

---

## 第三步：注册 Cloudflare 并创建 API Token

### 3.1 登录 Cloudflare

打开 https://dash.cloudflare.com/ 用邮箱注册 / 登录。

### 3.2 创建 API Token

1. 点击右侧头像 → **My Profile**
2. 左侧菜单选 **API Tokens**
3. 点击 **Create Token**
4. 选择 **Edit Cloudflare Workers** 模板
5. Account Resources 选择你的账号
6. 点击 **Continue to summary** → **Create Token**
7. **立刻复制 Token**（只显示一次！格式是 `cfut_` 开头的一长串字符）

> **这个 Token 务必保存好！** 后面配置 GitHub Actions 和同步 Secrets 都要用到。

### 3.3 记录 Account ID

在 Cloudflare Dashboard 右侧边栏或任意域名的概览页，找到 **Account ID**（32位字符），复制保存。

---

## 第四步：Fork 项目并配置 GitHub

### 4.1 Fork 项目

打开项目地址：https://github.com/zhuzhu88920/binance-grid-worker

点击右上角 **Fork** 按钮，将项目复制到你自己的 GitHub 账号。

### 4.2 配置 GitHub Secrets

1. 进入你 Fork 后的仓库页面
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加以下内容：

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | 粘贴你在第三步获取的 `cfut_` 开头的 Token |

### 4.3 在本地克隆你的仓库

打开终端（Windows 用 Git Bash 或 PowerShell），运行：

```bash
git clone https://github.com/你的用户名/binance-grid-worker.git
cd binance-grid-worker
npm install
```

### 4.4 创建环境变量文件

在项目根目录创建一个名为 `.dev.vars` 的文件（注意文件名前面有个点），内容如下：

```
USER1_COOKIE=这里粘贴你第二步复制的完整cookie
USER1_CSRF_TOKEN=这里粘贴你的CSRF_Token
USER1_BARK_KEY=这里粘贴你的Bark_Key
USER1_ID=随便取个名字，比如zhuzhu
```

> **重要：** 每个等号后面的值直接粘贴，不要加引号！不要换行！

完整示例：

```
USER1_COOKIE=bnc-uuid=abc123; BNC_FV_KEY=def456; lang=zh-CN; logined=y; theme=dark; ...（很长，粘贴完整的）
USER1_CSRF_TOKEN=c169f9da1d39007442486cd35c3ebe22
USER1_BARK_KEY=YwSqmvunLvMV8a3Nn4gS7c
USER1_ID=zhuzhu
```

---

## 第五步：部署到 Cloudflare Workers

### 5.1 上传 Secrets 到 Cloudflare

在项目目录打开终端，运行：

```bash
# 设置 CF API Token 环境变量（只需设置一次，关掉终端后失效）
# Windows PowerShell:
$env:CLOUDFLARE_API_TOKEN="cfut_你的Token"

# Mac / Linux:
export CLOUDFLARE_API_TOKEN="cfut_你的Token"

# 运行同步脚本
node sync-secrets.cjs
```

看到以下输出就说明成功了：

```
读取到 4 个变量: USER1_COOKIE, USER1_CSRF_TOKEN, USER1_BARK_KEY, USER1_ID

上传 secrets...
  ✓ USER1_COOKIE (2798 字符)
  ✓ USER1_CSRF_TOKEN (32 字符)
  ✓ USER1_BARK_KEY (22 字符)
  ✓ USER1_ID (6 字符)

清理旧 secrets...
完成！
```

### 5.2 部署

```bash
npx wrangler deploy
```

看到以下输出就说明部署成功：

```
Uploaded binance-grid-worker
Deployed binance-grid-worker triggers
  https://binance-grid-worker.你的子域名.workers.dev
  schedule: */5 * * * *
```

> **记下这个 URL**，这是你 Worker 的访问地址。

---

## 第六步：验证推送

### 6.1 手动触发一次推送

浏览器直接访问（或用 curl）：

```
https://binance-grid-worker.你的子域名.workers.dev/api/trigger
```

看到返回 `{"success": true}` 就说明成功了。

**此时你的手机应该收到一条 Bark 推送！**

### 6.2 检查健康状态

访问：

```
https://binance-grid-worker.你的子域名.workers.dev/health
```

应该返回 `{"status": "ok", "time": "..."}`

---

## 日常使用说明

### 自动运行

部署完成后，Worker 会**每 5 分钟自动运行一次**，完全不需要你做任何事情。

### 推送时机

- ✅ **会推送**：已配对订单数发生变化时
- ✅ **会推送**：首次部署或重置后（建立基准）
- ✅ **会推送**：Cookie 失效时（提醒你更新）
- ❌ **不会推送**：没有变化时（安静运行）

### Cookie 过期怎么办？

Binance Cookie 大约 **24 小时**后会过期。过期后你会收到一条提示推送：

```
⚠️ Binance Cookie 已失效
请更新 Cookie 和 CSRF Token
```

更新方法：

1. 重新打开 Binance 网页，登录
2. 按照**第二步**重新获取 Cookie 和 CSRF Token
3. 修改本地的 `.dev.vars` 文件
4. 重新运行 `node sync-secrets.cjs` 上传

**代码不需要重新部署**，只需更新 Secrets 即可。

---

## 多账号配置

如果你有多个 Binance 账号要监控，在 `.dev.vars` 中追加即可：

```
# 第一个账号
USER1_COOKIE=账号1的cookie
USER1_CSRF_TOKEN=账号1的csrf
USER1_BARK_KEY=账号1的bark
USER1_ID=账号1

# 第二个账号
USER2_COOKIE=账号2的cookie
USER2_CSRF_TOKEN=账号2的csrf
USER2_BARK_KEY=账号2的bark
USER2_ID=账号2
```

然后重新运行 `node sync-secrets.cjs`，最多支持 9 个账号。

---

## 常见问题

### Q: 推送没收到？

1. 检查 Bark Key 是否正确：浏览器访问 `https://api.day.app/你的key/测试`
2. 如果手机能收到但 Worker 推送收不到，访问 `/api/trigger` 看返回结果
3. 在 Cloudflare Dashboard → Workers & Pages → 你的 Worker → Logs 查看日志

### Q: 提示 UNAUTHORIZED？

Cookie 不完整或已过期。重新按照第二步获取完整 Cookie。

### Q: 代码更新后需要重新配置吗？

不需要。代码推送（git push）后 GitHub Actions 会自动重新部署，你的 Secrets 配置不受影响。

### Q: 这个项目花钱吗？

**完全免费**。Cloudflare Workers 免费套餐每天 10 万次请求，cron 每 5 分钟跑一次 = 每天 288 次，远低于限额。

---

## 项目地址

https://github.com/zhuzhu88920/binance-grid-worker

有问题欢迎提 Issue 或留言。
