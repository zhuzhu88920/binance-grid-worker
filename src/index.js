/**
 * Binance 网格策略监控 - Cloudflare Workers
 *
 * 凭证配置方式：
 *   单用户：COOKIE / CSRF_TOKEN / BARK_KEY
 *   多用户：USER1_COOKIE / USER1_CSRF_TOKEN / USER1_BARK_KEY
 *           USER2_COOKIE / USER2_CSRF_TOKEN / USER2_BARK_KEY ...
 *
 * Cron Trigger 每 5 分钟触发一次
 */

import { pushBark } from './push.js';
import { getLastMatchedCounts, setLastMatchedCounts, getCronStatus, setCronStatus } from './kv.js';

// ================== 从 env 读取用户列表 ==================

/**
 * 从环境变量解析所有用户的凭证
 * 支持两种格式：
 *   1. 单用户：COOKIE + CSRF_TOKEN + BARK_KEY（userId 固定为 "default"）
 *   2. 多用户：USER1_COOKIE + USER1_CSRF_TOKEN + USER1_BARK_KEY / USER1_ID（可选，默认 "user1"）
 *              USER2_COOKIE + ...
 */
function getUsersFromEnv(env) {
  const users = [];

  // 先尝试多用户格式（最多支持 9 个）
  for (let i = 1; i <= 9; i++) {
    const prefix = `USER${i}_`;
    const cookie = env[`${prefix}COOKIE`];
    const csrf = env[`${prefix}CSRF_TOKEN`];
    if (!cookie || !csrf) continue;
    users.push({
      id: env[`${prefix}ID`] || `user${i}`,
      cookie,
      csrfToken: csrf,
      barkKey: env[`${prefix}BARK_KEY`] || '',
    });
  }

  // 如果没有多用户，尝试单用户格式
  if (users.length === 0 && env.COOKIE && env.CSRF_TOKEN) {
    users.push({
      id: env.USER_ID || 'default',
      cookie: env.COOKIE,
      csrfToken: env.CSRF_TOKEN,
      barkKey: env.BARK_KEY || '',
    });
  }

  return users;
}

// ================== Binance 请求头构建 ==================

function makeHeaders(cookie, csrf, symbol = 'ETHUSDC') {
  // 生成随机 trace-id（格式与浏览器一致：UUID v4）
  const traceId = crypto.randomUUID();

  // 从 cookie 中解析 bnc-uuid 和 BNC_FV_KEY
  let bncUuid = '';
  let fvideoId = '';
  try {
    const matchUuid = cookie.match(/bnc-uuid=([^;]+)/);
    if (matchUuid) bncUuid = matchUuid[1];
    const matchFv = cookie.match(/BNC_FV_KEY=([^;]+)/);
    if (matchFv) fvideoId = matchFv[1];
  } catch (e) {}

  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'cookie': cookie,
    'csrftoken': csrf,
    'clienttype': 'web',
    'lang': 'zh-CN',
    'content-type': 'application/json',
    'bnc-uuid': bncUuid,
    'bnc-location': 'CN',
    'device-info': 'eyJzY3JlZW5fcmVzb2x1dGlvbiI6IjE2ODAsMTA1MCIsImF2YWlsYWJsZV9zY3JlZW5fcmVzb2x1dGlvbiI6IjE2ODAsMTAwMiIsInN5c3RlbV92ZXJzaW9uIjoiV2luZG93cyAxMCIsImJyYW5kX21vZGVsIjoidW5rbm93biIsInN5c3RlbV9sYW5nIjoiemgtQ04iLCJ0aW1lem9uZSI6IkdNVCswODowMCIsInRpbWV6b25lT2Zmc2V0IjotNDgwLCJ1c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0Ny4wLjAuMCBTYWZhcmkvNTM3LjM2IEVkZy8xNDcuMC4wLjAiLCJsaXN0X3BsdWdpbiI6IlBERiBWaWV3ZXIsQ2hyb21lIFBERiBWaWV3ZXIsQ2hyb21pdW0gUERGIFZpZXdlcixNaWNyb3NvZnQgRWRnZSBQREYgVmlld2VyLFdlYktpdCBidWlsdC1pbiBQREYiLCJjYW52YXNfY29kZSI6IjMwNTVjYzEyIiwid2ViZ2xfdmVuZG9yIjoiR29vZ2xlIEluYy4gKE1pY3Jvc29mdCkiLCJ3ZWJnbF9yZW5kZXJlciI6IkFOR0xFIChNaWNyb3NvZnQsIE1pY3Jvc29mdCBCYXNpYyBSZW5kZXIgRHJpdmVyICgweDAwMDAwMDhDKSBEaXJlY3QzRDExIHZzXzVfMCBwc181XzAsIEQzRDExKSIsImF1ZGlvIjoiMTI0LjA0MzQ3NTI3NTE2MDc0IiwicGxhdGZvcm0iOiJXaW4zMiIsIndlYl90aW1lem9uZSI6IkFzaWEvU2hhbmdoYWkiLCJkZXZpY2VfbmFtZSI6IkNocm9tZSBWMTQ3LjAuMC4wIChXaW5kb3dzKSIsImZpbmdlcnByaW50IjoiZjcxNGMwMGNlY2YxZGM2MjJlODA4OTc5OTc3NTRhNTgiLCJkZXZpY2VfaWQiOiIiLCJyZWxhdGVkX2RldmljZV9pZHMiOiIifQ==',
    'fvideo-id': fvideoId,
    'x-trace-id': traceId,
    'x-ui-request-trace': traceId,
    'x-passthrough-token': '',
    'sec-ch-ua': '"Microsoft Edge";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'referer': `https://www.binance.com/zh-CN/trading-bots/futures/grid/${symbol}`,
    'origin': 'https://www.binance.com',
  };
}

// ================== Binance API ==================

async function fetchOpenGrids(headers) {
  const res = await fetch('https://www.binance.com/bapi/futures/v2/private/future/grid/query-open-grids', {
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

async function fetchUnmatchedCount(headers, strategyId, matchedCount) {
  try {
    const res = await fetch('https://www.binance.com/bapi/futures/v1/private/future/grid/query-grid-matched-items', {
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

async function fetchMarkPrice(symbol) {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    const json = await res.json();
    return parseFloat(json.markPrice || 0);
  } catch {
    return 0;
  }
}

// ================== 路由分发 ==================

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return cors();

    // 健康检查
    if (pathname === '/health') return json({ status: 'ok', time: new Date().toISOString() });

    // 查看已加载的用户列表（不含敏感信息）
    if (pathname === '/api/users' && request.method === 'GET') {
      const users = getUsersFromEnv(env);
      return json({ count: users.length, users: users.map(u => ({ id: u.id, hasBark: !!u.barkKey })) });
    }

    // 手动触发全部用户推送
    if (pathname === '/api/trigger' && request.method === 'POST') {
      const colo = request.cf?.colo || 'unknown';
      console.log(`[trigger] 边缘节点: ${colo}`);
      return handleTriggerAll(env);
    }

    // 本地调试：从 .dev.vars 读凭证，抓取并推送
    if (pathname === '/api/test' && request.method === 'GET') return handleTest(env);

    // 查看 cron 最后一次执行状态
    if (pathname === '/api/cron-status' && request.method === 'GET') {
      const status = await getCronStatus(env);
      return json(status);
    }

    return json({ status: 'not found' }, 404);
  },

  // Cron 触发器：每 5 分钟
  async scheduled(event, env, ctx) {
    const startTime = new Date().toISOString();
    try {
      // 诊断：记录 cron 运行在哪个边缘节点
      const traceRes = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
      const traceText = await traceRes.text();
      const coloMatch = traceText.match(/colo=([A-Z]+)/);
      const colo = coloMatch ? coloMatch[1] : 'unknown';
      console.log(`[cron] 运行边缘节点: ${colo}`);

      // 直接调用处理逻辑，不 fetch 自己（避免 1042 错误）
      const details = await processAllUsers(env);
      console.log(`[cron] 处理结果:`, details);

      await setCronStatus(env, { lastRun: startTime, status: 'success', colo, details });
      console.log(`[cron] 状态已更新: ${colo}`);
    } catch (e) {
      await setCronStatus(env, { lastRun: startTime, status: 'error', error: e.message });
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

  console.log(`cron: 处理 ${users.length} 个用户: ${users.map(u => u.id).join(', ')}`);

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

async function processGrid(headers, grid) {
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

  const markPrice = await fetchMarkPrice(symbol);
  const unmatchedCount = await fetchUnmatchedCount(headers, strategyId, matchedCount);

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

/**
 * 每5分钟cron调用一次
 * 逻辑：抓取每个策略的matchedCount → 与上次对比 → 有变化就推送 → 更新基准值
 */
async function processUser(user, env) {
  const headers = makeHeaders(user.cookie, user.csrfToken);
  const grids = await fetchOpenGrids(headers);

  if (!grids || grids.length === 0) {
    console.log(`[${user.id}] 无运行中的策略`);
    return { userId: user.id, pushed: false, reason: '无运行中的策略' };
  }

  // 当前 matchedCount：{ strategyId: matchedCount }
  const current = {};
  for (const g of grids) current[g.strategyId] = g.matchedCount || 0;

  // 上次 matchedCount（从KV读取）
  const prev = await getLastMatchedCounts(env, user.id);

  // 对比：任何一个策略的 matchedCount 变了就推送
  const changed = Object.keys(current).some(sid => current[sid] !== (prev[sid] || 0));

  console.log(`[${user.id}] 上次=${JSON.stringify(prev)} 当前=${JSON.stringify(current)} 有变化=${changed}`);

  if (changed) {
    const metricsList = await Promise.all(grids.map(g => processGrid(headers, g)));
    await pushBark(user.id, 'normal', { strategies: metricsList, user_id: user.id }, user.barkKey);
    console.log(`[${user.id}] 已推送 ${grids.length} 个策略`);
  }

  // 无论是否推送，都更新基准值
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
        const headers = makeHeaders(user.cookie, user.csrfToken);
        const grids = await fetchOpenGrids(headers);
        const metricsList = await Promise.all(grids.map(g => processGrid(headers, g)));
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
      const headers = makeHeaders(user.cookie, user.csrfToken);
      const grids = await fetchOpenGrids(headers);
      const metricsList = await Promise.all(grids.map(g => processGrid(headers, g)));
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
