/**
 * KV 存储封装
 * 优化：所有数据合并存储，减少写入次数
 * - last_matched_counts: 所有用户的已配对订单数
 * - cron_status: cron 执行状态
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
 * 获取所有数据（合并存储）
 * 返回 { last_matched_counts: { userId: { strategyId: matchedCount } }, cron_status: {...} }
 */
export async function getAllData(env) {
  const raw = await kvGet(env, 'all_data');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/**
 * 更新所有数据（合并存储）
 */
export async function setAllData(env, data) {
  await kvPut(env, 'all_data', JSON.stringify(data));
}

/**
 * 获取上次记录的所有策略 matchedCount
 * 返回 { userId: { strategyId: matchedCount } }
 */
export async function getLastMatchedCounts(env, userId) {
  const allData = await getAllData(env);
  return allData.last_matched_counts?.[userId] || {};
}

/**
 * 获取 cron 状态
 */
export async function getCronStatus(env) {
  const allData = await getAllData(env);
  return allData.cron_status || {};
}
