import puppeteer from 'puppeteer-core';

// 你的专属设备指纹，用来精准识别是不是你的账户
const MY_BNC_UUID = 'a9c792d0-6a98-4c69-ae95-8c2465b1724b';

async function main() {
    console.log('🔄 正在连接到 Edge 浏览器 (127.0.0.1:9222)...');
    let browser;
    try {
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });
    } catch (err) {
        console.error('❌ 无法连接到 Edge！请确认已用 --remote-debugging-port=9222 启动。');
        process.exit(1);
    }

    const pages = await browser.pages();
    const binancePages = pages.filter(p => p.url().includes('binance.com'));

    if (binancePages.length === 0) {
        console.error('❌ 未找到打开的币安页面。');
        process.exit(1);
    }

    // 找到你的以太坊网格页面，并弹到最前面
    let targetPage = binancePages.find(p => p.url().includes('ETHUSDC')) || binancePages[0];
    await targetPage.bringToFront();
    console.log(`✅ 锁定目标页面: ${targetPage.url()}`);
    console.log('📡 正在深入浏览器网络底层，拦截完整请求头...');

    // ====================================================
    // 核心黑科技：启用 CDP 协议，抓取和 F12 完全一样的底层数据
    // ====================================================
    const cdpSession = await targetPage.target().createCDPSession();
    await cdpSession.send('Network.enable');

    let foundCookie = '';
    let foundCsrf = '';
    
    // 用于记录网络底层请求的字典
    const requestMap = {};

    return new Promise(async (resolve) => {
        // 检查是否是我们想要的那个接口，并且包含了你的 UUID
        const checkMatch = async (reqId) => {
            const req = requestMap[reqId];
            if (req && req.url && req.headers) {
                // 只匹配你抓包出来的那个网格接口
                if (req.url.includes('/private/future/grid/query-open-grids')) {
                    
                    // CDP 抓到的 headers key 大小写可能不同，做个兼容查找
                    const getHeader = (name) => {
                        const key = Object.keys(req.headers).find(k => k.toLowerCase() === name.toLowerCase());
                        return key ? req.headers[key] : '';
                    };

                    const cookie = getHeader('cookie');
                    const csrf = getHeader('csrftoken');

                    // 【终极校验】判断这个 Cookie 是不是包含你的专属 UUID
                    if (cookie && cookie.includes(MY_BNC_UUID)) {
                        console.log('\n🎉 抓取成功！完全匹配 F12 的底层数据：');
                        console.log('======================================================');
                        console.log(`📌 请求接口: ${req.url}`);
                        console.log(`🔑 CSRF Token: \n${csrf}`);
                        console.log(`🍪 完整 Cookie: \n${cookie}`);
                        console.log('======================================================\n');
                        
                        foundCookie = cookie;
                        foundCsrf = csrf;
                        
                        // 抓到后断开连接
                        await cdpSession.detach();
                        await browser.disconnect();
                        resolve();
                    }
                }
            }
        };

        // 监听底层请求发起
        cdpSession.on('Network.requestWillBeSent', (event) => {
            const reqId = event.requestId;
            requestMap[reqId] = requestMap[reqId] || {};
            requestMap[reqId].url = event.request.url;
            checkMatch(reqId);
        });

        // 监听底层请求头（这里才包含浏览器自动拼接的完整 Cookie）
        cdpSession.on('Network.requestWillBeSentExtraInfo', (event) => {
            const reqId = event.requestId;
            requestMap[reqId] = requestMap[reqId] || {};
            requestMap[reqId].headers = event.headers;
            checkMatch(reqId);
        });

        console.log('🔄 自动刷新页面，触发接口请求...');
        await targetPage.reload({ waitUntil: 'domcontentloaded' });
    });
}

main();