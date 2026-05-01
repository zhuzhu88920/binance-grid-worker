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
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
    'cookie': cookie,
    'csrftoken': csrf,
    'clienttype': 'web',
    'lang': 'zh-CN',
    'content-type': 'application/json',
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

  if (res.status === 302 || res.status === 401 || res.status === 403) {
    throw new Error('UNAUTHORIZED');
  }
  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
  }

  const json = await res.json();
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
      return handleTriggerAll(env);
    }

    // 本地调试：从 .dev.vars 读凭证，抓取并推送
    if (pathname === '/api/test' && request.method === 'GET') return handleTest(env);

    // 调试：查看 KV 状态、当前抓取结果、推送判断原因
    if (pathname === '/api/debug' && request.method === 'GET') return handleDebug(env);

    // 查看 cron 最后一次执行状态
    if (pathname === '/api/cron-status' && request.method === 'GET') {
      const status = await getCronStatus(env);
      return json(status);
    }

    return json({ status: 'running', endpoints: ['/health', '/api/users', '/api/trigger', '/api/test', '/api/debug', '/api/cron-status'] });
  },

  // Cron 触发器：每 5 分钟
  async scheduled(event, env, ctx) {
    const startTime = new Date().toISOString();
    try {
      await processAllUsers(env);
      await setCronStatus(env, { lastRun: startTime, status: 'success' });
    } catch (e) {
      await setCronStatus(env, { lastRun: startTime, status: 'error', error: e.message });
    }
  },
};

// ================== Cron 主逻辑 ==================

async function processAllUsers(env) {
  const users = getUsersFromEnv(env);

  if (users.length === 0) {
    console.log('未找到任何用户配置，请检查环境变量');
    return;
  }

  console.log(`cron: 处理 ${users.length} 个用户: ${users.map(u => u.id).join(', ')}`);

  for (const user of users) {
    try {
      await processUser(user, env);
    } catch (e) {
      console.error(`处理用户 ${user.id} 失败:`, e.message);
    }
  }
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
    return;
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

// ================== 调试接口 ==================

async function handleDebug(env) {
  try {
    const users = getUsersFromEnv(env);
    if (users.length === 0) return json({ success: false, error: '未找到用户配置' });

    const results = [];
    for (const user of users) {
      const headers = makeHeaders(user.cookie, user.csrfToken);
      let grids = [];
      try { grids = await fetchOpenGrids(headers); } catch (e) { grids = [{ error: e.message }]; }

      const currentCounts = {};
      for (const g of grids) {
        if (g.error) continue;
        currentCounts[g.strategyId] = g.matchedCount || 0;
      }

      const prevCounts = await getLastMatchedCounts(env, user.id);

      let hasChange = false;
      for (const sid of Object.keys(currentCounts)) {
        if (String(currentCounts[sid]) !== String(prevCounts[sid] || '')) {
          hasChange = true;
          break;
        }
      }

      results.push({
        userId: user.id,
        prevCounts,
        currentCounts,
        hasChange,
        willPush: hasChange,
        reason: hasChange ? 'matchedCount 有变化，会推送' : 'matchedCount 无变化，不推送',
      });
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
