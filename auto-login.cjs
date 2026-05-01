/**
 * auto-login.cjs - 自动获取 Binance Cookie
 *
 * 用法：node auto-login.cjs [用户编号]
 *   例如：node auto-login.cjs 1    → 更新 USER1
 *         node auto-login.cjs        → 默认更新 USER1
 *
 * 流程：弹出 Chrome → 打开 Binance 登录页 → 你扫码登录 → 自动提取 Cookie/CSRF → 写入 .dev.vars
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BINANCE_LOGIN_URL = 'https://www.binance.com/zh-CN/login';
const DEV_VARS_PATH = path.join(__dirname, '.dev.vars');

// Binance 需要提取的 cookie 列表
const REQUIRED_COOKIES = ['logined', 'blcvxxxx', 'p20t', 'userInfo', 'canvas_hash', 'gid', 'BNC_UUID'];

async function autoLogin(userNum) {
  const prefix = userNum === 1 ? '' : `${userNum}`;
  const userId = userNum === 1 ? 'zhuzhu' : `user${userNum}`;

  console.log('========================================');
  console.log(`  自动获取 Binance Cookie - ${userId}`);
  console.log('========================================');
  console.log('');
  console.log('即将打开浏览器，请在页面中扫码/输入密码登录...');
  console.log('登录成功后会自动提取 Cookie，无需其他操作。');
  console.log('');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,       // 有界面，方便扫码
    defaultViewport: null,  // 使用窗口默认大小
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    const page = await browser.newPage();

    // 隐藏自动化特征
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log('正在打开 Binance 登录页...');
    await page.goto(BINANCE_LOGIN_URL, { waitUntil: 'networkidle0', timeout: 60000 });

    console.log('');
    console.log('>>> 请在浏览器中完成登录（扫码或输入密码）');
    console.log('>>> 登录成功后，脚本会自动检测并提取 Cookie...');
    console.log('');

    // 等待登录成功的标志：出现 logined cookie
    let cookies = [];
    const startTime = Date.now();
    const TIMEOUT = 300000; // 5 分钟超时

    while (Date.now() - startTime < TIMEOUT) {
      await new Promise(r => setTimeout(r, 3000)); // 每 3 秒检测一次
      cookies = await page.cookies('https://www.binance.com');

      const loginedCookie = cookies.find(c => c.name === 'logined');
      if (loginedCookie && loginedCookie.value === 'true') {
        console.log('✅ 检测到登录成功！');
        break;
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed % 15 === 0) {
        console.log(`   等待登录中... (${elapsed}s / ${TIMEOUT / 1000}s)`);
      }
    }

    if (Date.now() - startTime >= TIMEOUT) {
      console.log('❌ 等待登录超时（5分钟），请重试。');
      await browser.close();
      return false;
    }

    // 再等 2 秒确保所有 cookie 都写入
    await new Promise(r => setTimeout(r, 2000));
    cookies = await page.cookies('https://www.binance.com');

    // 提取 CSRF Token（从页面 localStorage）
    const csrfToken = await page.evaluate(() => {
      return localStorage.getItem('csrfToken') || '';
    });

    if (!csrfToken) {
      console.log('⚠️  未找到 CSRF Token，尝试从 cookie 获取...');
      const csrfCookie = cookies.find(c => c.name === 'csrfToken');
      // 如果都找不到，用空字符串，后续手动填
    }

    // 构建 cookie 字符串
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 检查关键 cookie
    const cookieNames = cookies.map(c => c.name);
    const missing = REQUIRED_COOKIES.filter(n => !cookieNames.includes(n));
    if (missing.length > 0) {
      console.log(`⚠️  缺少部分 Cookie: ${missing.join(', ')}`);
      console.log('   这可能影响功能，但仍然会保存已获取的 Cookie。');
    }

    console.log('');
    console.log('📋 提取结果：');
    console.log(`   Cookie 长度: ${cookieStr.length} 字符`);
    console.log(`   CSRF Token: ${csrfToken ? csrfToken.substring(0, 8) + '...' : '未找到（需手动填写）'}`);
    console.log(`   Cookie 数量: ${cookies.length} 个`);

    // 写入 .dev.vars
    await writeToDevVars(userNum, cookieStr, csrfToken);

    console.log('');
    console.log('✅ Cookie 已写入 .dev.vars');
    console.log('');
    console.log('后续步骤：');
    console.log('  1. 检查 .dev.vars 中 BARK_KEY 和 ID 是否正确');
    console.log('  2. 运行 update.bat 上传到 CF Secrets 并触发推送');
    console.log('');

    return true;

  } catch (e) {
    console.error('❌ 出错:', e.message);
    return false;
  } finally {
    await browser.close();
    console.log('浏览器已关闭。');
  }
}

async function writeToDevVars(userNum, cookie, csrfToken) {
  let content = '';

  if (fs.existsSync(DEV_VARS_PATH)) {
    content = fs.readFileSync(DEV_VARS_PATH, 'utf-8');
  }

  const prefix = userNum === 1 ? '' : `${userNum}`;
  const cookieKey = `${prefix}COOKIE`;
  const csrfKey = `${prefix}CSRF_TOKEN`;

  // 用正则替换或追加
  const lines = content.split('\n');
  let foundCookie = false, foundCsrf = false;
  const newLines = [];

  for (const line of lines) {
    if (line.startsWith(`${cookieKey}=`)) {
      newLines.push(`${cookieKey}=${cookie}`);
      foundCookie = true;
    } else if (line.startsWith(`${csrfKey}=`)) {
      newLines.push(`${csrfKey}=${csrfToken || '需要手动填写'}`);
      foundCsrf = true;
    } else {
      newLines.push(line);
    }
  }

  if (!foundCookie) newLines.push(`${cookieKey}=${cookie}`);
  if (!foundCsrf) newLines.push(`${csrfKey}=${csrfToken || '需要手动填写'}`);

  fs.writeFileSync(DEV_VARS_PATH, newLines.join('\n'), 'utf-8');
}

// 解析命令行参数
const userNum = parseInt(process.argv[2] || '1', 10);
autoLogin(userNum).then(ok => process.exit(ok ? 0 : 1));
