/**
 * KV 存储封装
 * 只用于持久化 last_matched_counts（判断配对订单是否有变化）
 * 凭证从环境变量读取，不存 KV
 */

// 本地开发时用内存模拟 KV
const LOCAL_KV = new Map();

function kvGet(env, key) {
  if (env.GRID_KV) return env.GRID_KV.get(key);
  return Promise.resolve(LOCAL_KV.get(key) || null);
}

function kvPut(env, key, value) {
  if (env.GRID_KV) return env.GRID_KV.put(key, value);
  LOCAL_KV.set(key, value);
  return Promise.resolve();
}

/**
 * 获取上次记录的所有策略 matchedCount
 * 返回 { strategyId: matchedCount }
 */
export async function getLastMatchedCounts(env, userId) {
  const raw = await kvGet(env, `user:${userId}:last_matched_counts`);
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/**
 * 更新记录的所有策略 matchedCount
 */
export async function setLastMatchedCounts(env, userId, countsObj) {
  await kvPut(env, `user:${userId}:last_matched_counts`, JSON.stringify(countsObj));
}

// ================== Cron 执行状态 ==================

export async function getCronStatus(env) {
  const raw = await kvGet(env, 'cron:status');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export async function setCronStatus(env, status) {
  // status = { lastRun: ISO string, userResults: [...] }
  await kvPut(env, 'cron:status', JSON.stringify(status));
}
