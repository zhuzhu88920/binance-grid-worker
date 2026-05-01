/**
 * Binance 网格策略监控 - Cloudflare Workers
 *
 * Cron Trigger 每 5 分钟触发一次
 * 参考原项目 binance_new/grid.py 的 API 接口和字段名
 */

import { pushBark } from './push.js';
import { getAllUserIds, getCredentials, getLastMatchedCounts, setLastMatchedCounts, getLastMatchedCount, setLastMatchedCount, addUserToList, removeUserFromList, setCredentials, getLocalStore } from './kv.js';

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

/**
 * 获取所有运行中的网格策略列表
 * 对应原项目 grid.py get_open_grids()
 * POST https://www.binance.com/bapi/futures/v2/private/future/grid/query-open-grids
 */
async function fetchOpenGrids(headers) {
  const url = 'https://www.binance.com/bapi/futures/v2/private/future/grid/query-open-grids';
  const res = await fetch(url, {
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
  // code 是字符串 "000000" 表示成功
  if (json.code !== '000000') {
    throw new Error(`Binance API 错误: code=${json.code}, message=${json.message || 'unknown'}`);
  }

  return json.data || [];
}

/**
 * 获取未配对订单数
 * 对应原项目 grid.py get_unmatched_count()
 */
async function fetchUnmatchedCount(headers, strategyId, matchedCount) {
  const url = 'https://www.binance.com/bapi/futures/v1/private/future/grid/query-grid-matched-items';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ strategyId }),
    });
    const json = await res.json();
    if (json.code === '000000') {
      const total = json.total || 0;
      return Math.max(0, total - matchedCount);
    }
  } catch (e) {
    console.error('获取未配对订单数失败:', e.message);
  }
  return 0;
}

/**
 * 获取标记价格
 * 对应原项目 grid.py get_mark_price()
 */
async function fetchMarkPrice(symbol) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const res = await fetch(url);
    const json = await res.json();
    return parseFloat(json.markPrice || 0);
  } catch (e) {
    console.error('获取标记价格失败:', e.message);
    return 0;
  }
}

// ================== 路由分发 ==================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return handleCORS();

    if (path === '/api/list' && request.method === 'GET') return handleList(env);
    if (path === '/api/trigger' && request.method === 'POST') return handleTrigger(request, env);
    if (path === '/api/add' && request.method === 'POST') return handleAdd(request, env);
    if (path === '/health' && request.method === 'GET') return jsonResponse({ status: 'ok', time: new Date().toISOString() });
    if (path === '/api/debug' && request.method === 'GET') return jsonResponse({ store: getLocalStore() });
    // 本地调试：查看环境变量加载状态
    if (path === '/api/env' && request.method === 'GET') return handleEnv(env);
    // 本地调试：直接抓取 + 推送（不传参，从 .dev.vars 读凭证）
    if (path === '/api/test' && request.method === 'GET') return handleTest(env);
    // 本地调试：只推送（使用上次缓存的 data）
    if (path === '/api/push' && request.method === 'GET') return handlePushTest(env);

    return jsonResponse({ status: 'running', endpoints: ['/health', '/api/list', '/api/trigger', '/api/add', '/api/test', '/api/push', '/api/env'] });
  },

  // Cron 触发器：每 5 分钟
  async scheduled(event, env, ctx) {
    await processAllUsers(env);
  },
};

// ================== Cron 主逻辑 ==================

async function processAllUsers(env) {
  let userIds = await getAllUserIds(env);

  // 兜底：KV 里没有用户列表时，从环境变量 BINANCE_USER_ID 读取
  if ((!userIds || userIds.length === 0) && env.BINANCE_USER_ID) {
    userIds = [env.BINANCE_USER_ID];
    console.log(`KV 用户列表为空，使用环境变量 BINANCE_USER_ID: ${env.BINANCE_USER_ID}`);
  }

  console.log(`cron: 处理 ${userIds.length} 个用户: ${userIds.join(', ')}`);

  for (const userId of userIds) {
    try {
      await processUser(userId, env);
    } catch (e) {
      console.error(`处理用户 ${userId} 失败:`, e.message);
    }
  }
}

// ================== 网格数据处理（对应原项目 fetch_and_calculate_one()）==================

/**
 * 处理单个网格策略，计算所有指标
 * 对应原项目 grid.py fetch_and_calculate_one()
 */
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

  // 1. 获取标记价格
  const markPrice = await fetchMarkPrice(symbol);

  // 2. 获取未配对订单数
  const unmatchedCount = await fetchUnmatchedCount(headers, strategyId, matchedCount);

  // 3. 计算策略本金（不含杠杆）
  const strategyAmount = initialLeverage > 0 ? gridInitialValue / initialLeverage : gridInitialValue;

  // 4. 计算未实现盈亏
  const unrealizedProfit = gridPosition * (markPrice - gridEntryPrice);

  // 5. 总收益 = 网格利润 + 未实现盈亏 + 资金费
  const totalPnl = gridProfit + unrealizedProfit + fundingFee;

  // 6. 收益率
  const totalPnlRate = strategyAmount > 0 ? (totalPnl / strategyAmount) * 100 : 0;

  // 7. 未配对盈亏
  const unmatchedProfit = totalPnl - matchedPnl - fundingFee;

  // 8. 已配对收益率
  const matchedPnlRate = strategyAmount > 0 ? (matchedPnl / strategyAmount) * 100 : 0;

  // 9. 未配对盈亏率
  const unmatchedProfitRate = strategyAmount > 0 ? (unmatchedProfit / strategyAmount) * 100 : 0;

  // 10. 运行时间
  let days = 0, hours = 0, minutes = 0;
  if (bookTime > 0) {
    const now = Date.now();
    const diffMs = now - bookTime;
    const diffMin = Math.floor(diffMs / 60000);
    days = Math.floor(diffMin / 1440);
    hours = Math.floor((diffMin % 1440) / 60);
    minutes = diffMin % 60;
  }

  // 9. 格式化启动时间
  const startTime = bookTime > 0 ? new Date(bookTime).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }) : '未知';

  return {
    // 原始字段（保持兼容，camelCase）
    strategyId,
    symbol,
    gridInitialValue,
    initialLeverage,
    gridProfit,
    matchedPnl,
    fundingFee,
    matchedCount,
    gridPosition,
    gridEntryPrice,

    // 计算字段 snake_case（供推送模板使用，对齐原项目 metrics 字典）
    initial_leverage: initialLeverage,
    matched_count: matchedCount,
    matched_pnl: matchedPnl,
    matched_pnl_rate: matchedPnlRate,
    mark_price: markPrice,
    unmatched_count: unmatchedCount,
    strategy_amount: strategyAmount,
    unrealized_profit: unrealizedProfit,
    total_pnl: totalPnl,
    total_pnl_rate: totalPnlRate,
    unmatched_profit: unmatchedProfit,
    unmatched_profit_rate: unmatchedProfitRate,
    start_time: startTime,
    days,
    hours,
    minutes,
  };
}

// ================== 用户处理主逻辑 ==================

async function processUser(userId, env) {
  let credentials = await getCredentials(env, userId);

  // 本地开发兜底：从环境变量读取
  if (!credentials && env.BINANCE_COOKIE && env.BINANCE_CSRF_TOKEN) {
    credentials = {
      cookie: env.BINANCE_COOKIE,
      csrfToken: env.BINANCE_CSRF_TOKEN,
      authToken: env.BINANCE_AUTH_TOKEN || '',
      barkKey: env.BARK_KEY || '',
    };
    console.log(`用户 ${userId}: 使用环境变量中的凭证（本地开发模式）`);
  }

  if (!credentials) {
    console.log(`用户 ${userId}: 未找到凭证`);
    return;
  }

  const headers = makeHeaders(credentials.cookie, credentials.csrfToken);

  try {
    const grids = await fetchOpenGrids(headers);
    if (!grids || grids.length === 0) {
      console.log(`用户 ${userId}: 没有运行中的网格策略`);
      return;
    }

    // 构建当前所有策略的 matchedCount 映射 { strategyId: matchedCount }
    const currentCounts = {};
    for (const g of grids) {
      currentCounts[g.strategyId] = g.matchedCount || 0;
    }

    // 读取上次记录的所有策略 matchedCount
    const prevCounts = await getLastMatchedCounts(env, userId);

    // 检查是否有任何策略的 matchedCount 发生变化（含新增策略）
    let hasChange = false;
    for (const sid of Object.keys(currentCounts)) {
      if (String(currentCounts[sid]) !== String(prevCounts[sid] || '')) {
        hasChange = true;
        break;
      }
    }

    console.log(`用户 ${userId}: 变化检测 prev=${JSON.stringify(prevCounts)} current=${JSON.stringify(currentCounts)} hasChange=${hasChange}`);

    if (hasChange) {
      // 有变化，处理所有网格指标并推送
      const metricsList = await Promise.all(
        grids.map(g => processGrid(headers, g))
      );
      const pushData = { strategies: metricsList, user_id: userId };
      await pushBark(userId, 'normal', pushData, credentials.barkKey);
    }

    // 无论是否推送，都更新存储的 counts
    await setLastMatchedCounts(env, userId, currentCounts);

  } catch (e) {
    if (e.message === 'UNAUTHORIZED') {
      console.log(`用户 ${userId}: Cookie 已失效`);
      await pushBark(userId, 'cookie_expired', null, credentials.barkKey);
    } else {
      throw e;
    }
  }
}

// ================== 本地调试端点 ==================

async function handleEnv(env) {
  const cookie = env.BINANCE_COOKIE || '';
  const csrf = env.BINANCE_CSRF_TOKEN || '';
  return jsonResponse({
    BINANCE_COOKIE: { exists: !!cookie, length: cookie.length },
    BINANCE_CSRF_TOKEN: { exists: !!csrf, length: csrf.length, value: csrf },
    BINANCE_USER_ID: env.BINANCE_USER_ID || '(empty)',
    BARK_KEY: env.BARK_KEY ? env.BARK_KEY.substring(0, 8) + '...' : '(empty)',
  });
}

async function handleTest(env) {
  try {
    if (!env.BINANCE_COOKIE || !env.BINANCE_CSRF_TOKEN) {
      return jsonResponse({ success: false, error: '缺少 BINANCE_COOKIE 或 BINANCE_CSRF_TOKEN' });
    }

    const headers = makeHeaders(env.BINANCE_COOKIE, env.BINANCE_CSRF_TOKEN);
    const userId = env.BINANCE_USER_ID || 'test';
    const barkKey = env.BARK_KEY || '';

    console.log(`[test] 抓取中，Cookie长度: ${env.BINANCE_COOKIE.length}`);

    const grids = await fetchOpenGrids(headers);

    // 处理每个网格，计算完整指标
    const metricsList = await Promise.all(
      grids.map(g => processGrid(headers, g))
    );

    // 推送到 Bark
    const pushResult = { pushed: false, skipped: false, error: null };
    if (barkKey) {
      const pushData = { strategies: metricsList, user_id: userId };
      const ok = await pushBark(userId, 'manual', pushData, barkKey);
      pushResult.pushed = ok;
      if (!ok) pushResult.error = '推送失败';
    } else {
      pushResult.skipped = true;
    }

    return jsonResponse({
      success: true,
      userId,
      gridCount: metricsList.length,
      strategies: metricsList,
      push: pushResult,
    });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message });
  }
}

/**
 * 纯推送测试：用模拟数据推送一条 Bark 消息，验证推送通道是否通畅
 */
async function handlePushTest(env) {
  try {
    const barkKey = env.BARK_KEY || '';
    if (!barkKey) {
      return jsonResponse({ success: false, error: '未设置 BARK_KEY，无法推送' });
    }

    const userId = env.BINANCE_USER_ID || 'test';

    // 构造模拟数据来测试推送格式
    const mockData = {
      strategies: [
        {
          symbol: 'ETHUSDC',
          initial_leverage: 20,
          total_pnl: 108.45,
          total_pnl_rate: 5.42,
          matched_count: 350,
          unmatched_count: 5,
          mark_price: 2650.50,
        },
      ],
      user_id: userId,
    };

    const ok = await pushBark(userId, 'manual', mockData, barkKey);
    return jsonResponse({
      success: ok,
      message: ok ? '推送成功，请检查手机' : '推送失败',
    });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message });
  }
}

// ================== API 处理器 ==================

async function parseBody(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await request.json();
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const form = await request.formData();
    const obj = {};
    for (const [k, v] of form.entries()) obj[k] = v.toString().trim();
    return obj;
  }
  try { return await request.json(); } catch { return {}; }
}

async function handleList(env) {
  const userIds = await getAllUserIds(env);
  const users = [];
  for (const uid of userIds) {
    const creds = await getCredentials(env, uid);
    if (creds) {
      const matched = await getLastMatchedCount(env, uid);
      users.push({ userId: uid, matchedCount: matched ? Number(matched) : null });
    }
  }
  return jsonResponse({ users, count: users.length });
}

async function handleAdd(request, env) {
  try {
    const body = await parseBody(request);
    const userId = (body.userId || '').trim();
    const cookie = (body.cookie || '').trim();
    const csrfToken = (body.csrfToken || '').trim();
    const authToken = (body.authToken || '').trim();
    const barkKey = (body.barkKey || '').trim();

    if (!userId || !cookie || !csrfToken) {
      return jsonResponse({ success: false, error: '缺少必要参数 (userId, cookie, csrfToken)' });
    }
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(userId)) {
      return jsonResponse({ success: false, error: '用户名格式非法' });
    }

    await setCredentials(env, userId, { cookie, csrfToken, authToken, barkKey });
    await addUserToList(env, userId);

    // 获取初始所有策略的 matchedCount
    const headers = makeHeaders(cookie, csrfToken);
    const grids = await fetchOpenGrids(headers);

    if (grids && grids.length > 0) {
      const initialCounts = {};
      for (const g of grids) {
        initialCounts[g.strategyId] = g.matchedCount || 0;
      }
      await setLastMatchedCounts(env, userId, initialCounts);
    }

    return jsonResponse({ success: true, strategyCount: grids?.length || 0 });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message });
  }
}

async function handleTrigger(request, env) {
  try {
    const body = await parseBody(request);
    const userId = (body.userId || '').trim();

    if (!userId) return jsonResponse({ success: false, error: '缺少 userId' });

    let credentials = await getCredentials(env, userId);
    if (!credentials && env.BINANCE_COOKIE && env.BINANCE_CSRF_TOKEN) {
      credentials = { cookie: env.BINANCE_COOKIE, csrfToken: env.BINANCE_CSRF_TOKEN, barkKey: env.BARK_KEY || '' };
    }
    if (!credentials) return jsonResponse({ success: false, error: '用户不存在' });

    const headers = makeHeaders(credentials.cookie, credentials.csrfToken);
    const grids = await fetchOpenGrids(headers);

    if (!grids || grids.length === 0) {
      return jsonResponse({ success: false, error: '未获取到策略数据' });
    }

    // 处理每个网格，计算完整指标
    const metricsList = await Promise.all(
      grids.map(g => processGrid(headers, g))
    );

    const pushData = { strategies: metricsList, user_id: userId };

    // 构建当前所有策略的 counts，用于更新存储
    const currentCounts = {};
    for (const g of grids) {
      currentCounts[g.strategyId] = g.matchedCount || 0;
    }

    await pushBark(userId, 'manual', pushData, credentials.barkKey);
    await setLastMatchedCounts(env, userId, currentCounts);

    return jsonResponse({
      success: true,
      message: '手动触发，已推送',
      strategyCount: grids.length,
    });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message });
  }
}

// ================== 工具函数 ==================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function handleCORS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
