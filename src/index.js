/**
 * Binance 网格策略监控 - Cloudflare Workers
 * 
 * 凭证配置方式：全部由 auto_update.js 自动抓取并推送
 * Cron Trigger 每 5 分钟触发一次
 */

import { pushBark } from './push.js';
import { getLastMatchedCounts, setLastMatchedCounts, getCronStatus, setCronStatus } from './kv.js';

// ================== 从 env 读取用户列表 ==================

function getUsersFromEnv(env) {
  const users = [];

  for (let i = 1; i <= 9; i++) {
    const prefix = `USER${i}_`;
    const cookie = env[`${prefix}COOKIE`];
    const csrf = env[`${prefix}CSRF_TOKEN`];
    if (!cookie || !csrf) continue;
    
    users.push({
      id: env[`${prefix}ID`] || `user${i}`,
      cookie: cookie,
      csrfToken: csrf,
      barkKey: env[`${prefix}BARK_KEY`] || '',
      ua: env[`${prefix}USER_AGENT`] || '',
      deviceInfo: env[`${prefix}DEVICE_INFO`] || '',
      secChUa: env[`${prefix}SEC_CH_UA`] || ''
    });
  }

  if (users.length === 0 && env.COOKIE && env.CSRF_TOKEN) {
    users.push({
      id: env.USER_ID || 'default',
      cookie: env.COOKIE,
      csrfToken: env.CSRF_TOKEN,
      barkKey: env.BARK_KEY || '',
      ua: env.USER_AGENT || '',
      deviceInfo: env.DEVICE_INFO || '',
      secChUa: env.SEC_CH_UA || ''
    });
  }

  return users;
}

// ================== Binance 请求头构建 ==================

function makeHeaders(user, symbol = 'ETHUSDC') {
  const traceId = crypto.randomUUID();

  let bncUuid = '';
  let fvideoId = '';
  try {
    const matchUuid = user.cookie.match(/bnc-uuid=([^;]+)/);
    if (matchUuid) bncUuid = matchUuid[1];
    const matchFv = user.cookie.match(/BNC_FV_KEY=([^;]+)/);
    if (matchFv) fvideoId = matchFv[1];
  } catch (e) {}

  return {
    'User-Agent': user.ua,
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'cookie': user.cookie,
    'csrftoken': user.csrfToken,
    'clienttype': 'web',
    'lang': 'zh-CN',
    'content-type': 'application/json',
    'bnc-uuid': bncUuid,
    'bnc-location': 'CN',
    'device-info': user.deviceInfo,
    'fvideo-id': fvideoId,
    'x-trace-id': traceId,
    'x-ui-request-trace': traceId,
    'x-passthrough-token': '',
    'sec-ch-ua': user.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'referer': `https://www.binance.com/zh-CN/trading-bots/futures/grid/${symbol}`,
    'origin': 'https://www.binance.com',
  };
}

// ================== Binance API (动态读取环境变量) ==================

async function fetchOpenGrids(headers, env) {
  // 修改点：从环境变量读取代理地址，如果没有配置，则默认使用币安官方地址
  const baseUrl = env.BAPI_BASE_URL || 'https://www.binance.com';
  
  const res = await fetch(`${baseUrl}/bapi/futures/v2/private/future/grid/query-open-grids`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });

  const responseText = await res.text().catch(() => '');

  if (res.status === 302 || res.status === 401 || res.status === 403) {
    throw new Error(`UNAUTHORIZED (status=${res.status}, body=${responseText.substring(0, 500)})`);
  }
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${responseText.substring(0, 300)}`);
  }

  const json = JSON.parse(responseText);
  if (json.code !== '000000') {
    throw new Error(`Binance API 错误: code=${json.code}, message=${json.message || 'unknown'}`);
  }

  return json.data || [];
}

async function fetchUnmatchedCount(headers, strategyId, matchedCount, env) {
  try {
    const baseUrl = env.BAPI_BASE_URL || 'https://www.binance.com';
    const res = await fetch(`${baseUrl}/bapi/futures/v1/private/future/grid/query-grid-matched-items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ strategyId }),
    });
    const json = await res.json();
    if (json.code === '000000') {
      return Math.max(0, (json.total || 0) - matchedCount);
    }
  } catch (e) {
    console.error('获取未配对订单数失败:', e.message);
  }
  return 0;
}

async function fetchMarkPrice(symbol, env) {
  try {
    // 合约行情读取专用代理变量
    const fapiUrl = env.FAPI_BASE_URL || 'https://fapi.binance.com';
    const res = await fetch(`${fapiUrl}/fapi/v1/premiumIndex?symbol=${symbol}`);
    const json = await res.json();
    return parseFloat(json.markPrice || 0);
  } catch {
    return 0;
  }
}

// ================== 路由分发 ==================
const coloToCountry = {
  // 美洲
  "ORD": "🇺🇸", "EWR": "🇺🇸", "ATL": "🇺🇸", "DFW": "🇺🇸", "LAX": "🇺🇸", "SEA": "🇺🇸",
  "YYZ": "🇨🇦", "YUL": "🇨🇦", "YVR": "🇨🇦",
  "GRU": "🇧🇷", "EZE": "🇦🇷",
  // 欧洲
  "LHR": "🇬🇧", "MAN": "🇬🇧", "CDG": "🇫🇷", "FRA": "🇩🇪", "MUC": "🇩🇪", "AMS": "🇳🇱",
  "MXP": "🇮🇹", "BCN": "🇪🇸", "MAD": "🇪🇸", "CPH": "🇩🇰", "ARN": "🇸🇪", "OSL": "🇳🇴",
  "HEL": "🇫🇮", "WAW": "🇵🇱", "PRG": "🇨🇿", "BUD": "🇭🇺", "VIE": "🇦🇹", "ZRH": "🇨🇭",
  "BRU": "🇧🇪", "DUB": "🇮🇪", "LIS": "🇵🇹", "OTP": "🇷🇴", "SOF": "🇧🇬", "ZAG": "🇭🇷",
  // 亚洲/中东
  "NRT": "🇯🇵", "HND": "🇯🇵", "KIX": "🇯🇵", "ICN": "🇰🇷", "PVG": "🇨🇳", "PEK": "🇨🇳",
  "HKG": "🇭🇰", "TPE": "🇨🇳", "SIN": "🇸🇬", "KUL": "🇲🇾", "BKK": "🇹🇭", "HAN": "🇻🇳",
  "SGN": "🇻🇳", "DEL": "🇮🇳", "BOM": "🇮🇳", "BLR": "🇮🇳", "DXB": "🇦🇪", "AUH": "🇦🇪",
  "DOH": "🇶🇦", "RUH": "🇸🇦", "JED": "🇸🇦", "TLV": "🇮🇱", "IST": "🇹🇷", "AYT": "🇹🇷",
  // 大洋洲
  "SYD": "🇦🇺", "MEL": "🇦🇺", "BNE": "🇦🇺", "PER": "🇦🇺", "AKL": "🇳🇿",
  // 非洲
  "JNB": "🇿🇦", "CPT": "🇿🇦", "NBO": "🇰🇪", "CAI": "🇪🇬", "CAS": "🇲🇦"
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return cors();

    if (pathname === '/health') return json({ status: 'ok', time: new Date().toISOString() });

    if (pathname === '/api/users' && request.method === 'GET') {
      const users = getUsersFromEnv(env);
      return json({ count: users.length, users: users.map(u => ({ id: u.id, hasBark: !!u.barkKey })) });
    }

    if (pathname === '/api/trigger' && request.method === 'POST') {
      const colo = request.cf?.colo || 'unknown';
      console.log(`[trigger] 边缘节点: ${colo}`);
      return handleTriggerAll(env);
    }

    if (pathname === '/api/test' && request.method === 'GET') return handleTest(env);

    if (pathname === '/api/cron-status' && request.method === 'GET') {
      const status = await getCronStatus(env);
      return json(status);
    }

    return json({ status: 'running', endpoints: ['/health', '/api/users', '/api/trigger', '/api/test', '/api/cron-status'] });
  },

  async scheduled(event, env, ctx) {
  // 1. 获取当前东八区时间，并按新格式生成 lastRun
    const nowInBeijing = new Date();
    const beijingTime = new Date(nowInBeijing.getTime() + 8 * 60 * 60 * 1000);
    const formattedDate = beijingTime.toISOString().slice(0, 10).replace(/-/g, '-');
    const hours = beijingTime.getUTCHours().toString().padStart(2, '0');
    const minutes = beijingTime.getUTCMinutes().toString().padStart(2, '0');
    const lastRun = `📅 ${formattedDate} ⏰ ${hours}:${minutes}`;

    try {
    // 2. 获取 colo 并添加国旗（如果映射表中有）
      const traceRes = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
      const traceText = await traceRes.text();
      const coloMatch = traceText.match(/colo=([A-Z]+)/);
      const coloRaw = coloMatch ? coloMatch[1] : 'unknown';
      const flag = coloToCountry[coloRaw];
      const colo = flag ? `${flag} ${coloRaw}` : `${coloRaw}（未知）`;

      console.log(`[cron] 运行边缘节点: ${colo}`);

      const details = await processAllUsers(env);
      console.log(`[cron] 处理结果:`, details);

      await setCronStatus(env, { lastRun, status: 'success', colo, details });
    } catch (e) {
      await setCronStatus(env, { lastRun, status: 'error', error: e.message });
      console.error(`[cron] 执行失败:`, e.message);
    }
  },
};

// ================== Cron 主逻辑 ==================

async function processAllUsers(env) {
  const users = getUsersFromEnv(env);

  if (users.length === 0) {
    console.log('未找到任何用户配置，请检查环境变量');
    return [];
  }

  const details = [];
  for (const user of users) {
    try {
      const result = await processUser(user, env);
      details.push(result);
    } catch (e) {
      details.push({ userId: user.id, error: e.message });
      console.error(`处理用户 ${user.id} 失败:`, e.message);
    }
  }
  return details;
}

// ================== 网格数据处理 ==================

async function processGrid(headers, grid, env) {
  const strategyId = grid.strategyId;
  const symbol = grid.symbol;
  const gridInitialValue = parseFloat(grid.gridInitialValue || 0);
  const initialLeverage = parseFloat(grid.initialLeverage || 1);
  const gridProfit = parseFloat(grid.gridProfit || 0);
  const matchedPnl = parseFloat(grid.matchedPnl || 0);
  const fundingFee = parseFloat(grid.fundingFee || 0);
  const matchedCount = parseInt(grid.matchedCount || 0);
  const gridPosition = parseFloat(grid.gridPosition || 0);
  const gridEntryPrice = parseFloat(grid.gridEntryPrice || 0);
  const bookTime = parseInt(grid.bookTime || 0);

  // 传入 env
  const markPrice = await fetchMarkPrice(symbol, env);
  const unmatchedCount = await fetchUnmatchedCount(headers, strategyId, matchedCount, env);

  const strategyAmount = initialLeverage > 0 ? gridInitialValue / initialLeverage : gridInitialValue;
  const unrealizedProfit = gridPosition * (markPrice - gridEntryPrice);
  const totalPnl = gridProfit + unrealizedProfit + fundingFee;
  const totalPnlRate = strategyAmount > 0 ? (totalPnl / strategyAmount) * 100 : 0;
  const unmatchedProfit = totalPnl - matchedPnl - fundingFee;
  const matchedPnlRate = strategyAmount > 0 ? (matchedPnl / strategyAmount) * 100 : 0;
  const unmatchedProfitRate = strategyAmount > 0 ? (unmatchedProfit / strategyAmount) * 100 : 0;

  let days = 0, hours = 0, minutes = 0;
  if (bookTime > 0) {
    const diffMin = Math.floor((Date.now() - bookTime) / 60000);
    days = Math.floor(diffMin / 1440);
    hours = Math.floor((diffMin % 1440) / 60);
    minutes = diffMin % 60;
  }

  const startTime = bookTime > 0 ? new Date(bookTime).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '未知';

  return {
    strategyId, symbol,
    gridInitialValue, initialLeverage, gridProfit, matchedPnl, fundingFee,
    matchedCount, gridPosition, gridEntryPrice,
    initial_leverage: initialLeverage,
    matched_count: matchedCount, matched_pnl: matchedPnl, matched_pnl_rate: matchedPnlRate,
    mark_price: markPrice, unmatched_count: unmatchedCount,
    strategy_amount: strategyAmount, unrealized_profit: unrealizedProfit,
    total_pnl: totalPnl, total_pnl_rate: totalPnlRate,
    unmatched_profit: unmatchedProfit, unmatched_profit_rate: unmatchedProfitRate,
    start_time: startTime, days, hours, minutes,
  };
}

// ================== 用户处理主逻辑 ==================

async function processUser(user, env) {
  const headers = makeHeaders(user);
  const grids = await fetchOpenGrids(headers, env); // 传入 env

  if (!grids || grids.length === 0) {
    console.log(`[${user.id}] 无运行中的策略`);
    return { userId: user.id, pushed: false, reason: '无运行中的策略' };
  }

  const current = {};
  for (const g of grids) current[g.strategyId] = g.matchedCount || 0;

  const prev = await getLastMatchedCounts(env, user.id);
  const changed = Object.keys(current).some(sid => current[sid] !== (prev[sid] || 0));

  console.log(`[${user.id}] 上次=${JSON.stringify(prev)} 当前=${JSON.stringify(current)} 有变化=${changed}`);

  if (changed) {
    const metricsList = await Promise.all(grids.map(g => processGrid(headers, g, env))); // 传入 env
    await pushBark(user.id, 'normal', { strategies: metricsList, user_id: user.id }, user.barkKey);
    console.log(`[${user.id}] 已推送 ${grids.length} 个策略`);
  }

  await setLastMatchedCounts(env, user.id, current);

  return { userId: user.id, prev, current, changed, pushed: changed };
}

// ================== API 处理器 ==================

async function handleTriggerAll(env) {
  try {
    const users = getUsersFromEnv(env);
    if (users.length === 0) return json({ success: false, error: '未找到用户配置' });

    const results = [];
    for (const user of users) {
      try {
        const headers = makeHeaders(user);
        const grids = await fetchOpenGrids(headers, env); // 传入 env
        const metricsList = await Promise.all(grids.map(g => processGrid(headers, g, env))); // 传入 env
        const currentCounts = {};
        for (const g of grids) currentCounts[g.strategyId] = g.matchedCount || 0;
        await pushBark(user.id, 'manual', { strategies: metricsList, user_id: user.id }, user.barkKey);
        await setLastMatchedCounts(env, user.id, currentCounts);
        results.push({ userId: user.id, success: true, strategyCount: grids.length });
      } catch (e) {
        results.push({ userId: user.id, success: false, error: e.message });
      }
    }
    return json({ success: true, results });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

async function handleTest(env) {
  try {
    const users = getUsersFromEnv(env);
    if (users.length === 0) return json({ success: false, error: '未找到用户配置，请检查 .dev.vars' });

    const results = [];
    for (const user of users) {
      const headers = makeHeaders(user);
      const grids = await fetchOpenGrids(headers, env); // 传入 env
      const metricsList = await Promise.all(grids.map(g => processGrid(headers, g, env))); // 传入 env
      const ok = user.barkKey
        ? await pushBark(user.id, 'manual', { strategies: metricsList, user_id: user.id }, user.barkKey)
        : false;
      results.push({ userId: user.id, gridCount: metricsList.length, pushed: ok });
    }
    return json({ success: true, results });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

// ================== 工具函数 ==================

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function cors() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}