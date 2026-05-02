import fs from 'fs';
import { execSync } from 'child_process';
import puppeteer from 'puppeteer-core';

// 配置区
const WORKSPACE_DIR = 'X:\\code\\binance-grid-worker';
const VARS_FILE = `${WORKSPACE_DIR}\\.dev.vars`;
const MY_BNC_UUID = 'a9c792d0-6a98-4c69-ae95-8c2465b1724b'; // 你的专属设备指纹

async function main() {
    console.log('🔄 [1/4] 正在连接到 Edge 浏览器...');
    let browser;
    try {
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });
    } catch (err) {
        console.error('\n❌ 无法连接到 Edge！请确认已用 --remote-debugging-port=9222 启动。');
        process.exit(1);
    }

    const pages = await browser.pages();
    const binancePages = pages.filter(p => p.url().includes('binance.com'));

    if (binancePages.length === 0) {
        console.error('❌ 未找到打开的币安页面。');
        process.exit(1);
    }

    let targetPage = binancePages.find(p => p.url().includes('ETHUSDC')) || binancePages[0];
    await targetPage.bringToFront();
    console.log(`✅ 锁定目标页面: ${targetPage.url()}`);

    console.log('📡 [2/4] 正在深入浏览器网络底层，拦截完整凭证...');
    
    const cdpSession = await targetPage.target().createCDPSession();
    await cdpSession.send('Network.enable');

    let capturedCookie = '';
    let capturedCsrf = '';
    let capturedUA = '';
    
    const requestMap = {};

    // 封装成 Promise，带超时机制
    const grabCredentials = new Promise(async (resolve, reject) => {
        // 设置 15 秒超时
        const timeoutId = setTimeout(() => {
            reject(new Error('抓取超时，未拦截到目标请求'));
        }, 15000);

        const checkMatch = async (reqId) => {
            const req = requestMap[reqId];
            if (req && req.url && req.headers) {
                if (req.url.includes('/private/future/grid/query-open-grids')) {
                    
                    const getHeader = (name) => {
                        const key = Object.keys(req.headers).find(k => k.toLowerCase() === name.toLowerCase());
                        return key ? req.headers[key] : '';
                    };

                    const cookie = getHeader('cookie');
                    const csrf = getHeader('csrftoken');
                    const ua = getHeader('user-agent');

                    if (cookie && cookie.includes(MY_BNC_UUID)) {
                        clearTimeout(timeoutId);
                        capturedCookie = cookie;
                        capturedCsrf = csrf;
                        capturedUA = ua;
                        resolve();
                    }
                }
            }
        };

        cdpSession.on('Network.requestWillBeSent', (event) => {
            const reqId = event.requestId;
            requestMap[reqId] = requestMap[reqId] || {};
            requestMap[reqId].url = event.request.url;
            checkMatch(reqId);
        });

        cdpSession.on('Network.requestWillBeSentExtraInfo', (event) => {
            const reqId = event.requestId;
            requestMap[reqId] = requestMap[reqId] || {};
            requestMap[reqId].headers = event.headers;
            checkMatch(reqId);
        });

        console.log('🔄 自动刷新页面，触发底层请求...');
        await targetPage.reload({ waitUntil: 'domcontentloaded' });
    });

    try {
        await grabCredentials;
        console.log('\n🎉 成功截获完美凭证！');
        console.log(`   - CSRF Token: ${capturedCsrf}`);
        console.log(`   - Cookie 长度: ${capturedCookie.length} 字符\n`);
    } catch (error) {
        console.error(`\n❌ ${error.message}`);
        await cdpSession.detach();
        await browser.disconnect();
        process.exit(1);
    }

    // 抓取完成，断开连接
    await cdpSession.detach();
    await browser.disconnect();

    // ==========================================
    // 更新本地 .dev.vars
    // ==========================================
    console.log('🔄 [3/4] 正在更新本地 .dev.vars 文件...');
    let varsContent = fs.existsSync(VARS_FILE) ? fs.readFileSync(VARS_FILE, 'utf8') : '';

    const updateVar = (key, value, wrapQuotes = false) => {
        const safeValue = wrapQuotes ? `'${value}'` : value;
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(varsContent)) {
            varsContent = varsContent.replace(regex, `${key}=${safeValue}`);
        } else {
            varsContent += `\n${key}=${safeValue}`;
        }
    };

    updateVar('USER1_COOKIE', capturedCookie, true); // 给Cookie加单引号防Wrangler报错
    updateVar('USER1_CSRF_TOKEN', capturedCsrf, false);
    updateVar('USER1_USER_AGENT', capturedUA, true);

    fs.writeFileSync(VARS_FILE, varsContent.trim() + '\n');
    console.log('✅ 本地 .dev.vars 更新完成！');

    // ==========================================
    // 推送到 Cloudflare Secrets
    // ==========================================
    console.log('\n☁️  [4/4] 正在同步 Secrets 到 Cloudflare...');
    
    const pushSecret = (key, value) => {
        try {
            console.log(`   推送 ${key}...`);
            // 重点：使用 input 原样注入，防截断
            execSync(`npx wrangler secret put ${key}`, { 
                cwd: WORKSPACE_DIR, input: value, stdio: 'ignore', shell: true 
            });
            console.log(`   ✅ ${key} 同步成功！`);
        } catch(e) {
            console.error(`   ❌ ${key} 同步失败`);
        }
    };

    pushSecret('USER1_COOKIE', capturedCookie);
    pushSecret('USER1_CSRF_TOKEN', capturedCsrf);
    // pushSecret('USER1_USER_AGENT', capturedUA); // 如果你后续Worker需要UA，可以取消注释

    console.log('\n🚀 全部流程完美结束！你现在可以直接运行你的主脚本了。');
}

main();