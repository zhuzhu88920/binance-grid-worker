/**
 * Cloudflare KV 存储封装
 * 本地开发时使用内存模拟，部署到 CF 时使用真实的 GRID_KV
 */

// ================== 本地开发用内存存储 ==================

const LOCAL_STORE = {
  data: new Map(),
  userList: [],
};

// ================== 跨平台 KV 接口 ==================

/**
 * 获取所有用户 ID 列表
 */
export async function getAllUserIds(env) {
  if (!env.GRID_KV) {
    return LOCAL_STORE.userList || [];
  }
  try {
    const userListJson = await env.GRID_KV.get('meta:user_list');
    if (!userListJson) return [];
    return JSON.parse(userListJson);
  } catch {
    return LOCAL_STORE.userList || [];
  }
}

/**
 * 添加用户到列表
 */
export async function addUserToList(env, userId) {
  const users = await getAllUserIds(env);
  if (!users.includes(userId)) {
    users.push(userId);
    const json = JSON.stringify(users);
    if (!env.GRID_KV) {
      LOCAL_STORE.data.set('meta:user_list', json);
      LOCAL_STORE.userList = users;
    } else {
      try {
        await env.GRID_KV.put('meta:user_list', json);
      } catch {
        LOCAL_STORE.data.set('meta:user_list', json);
        LOCAL_STORE.userList = users;
      }
    }
  }
}

/**
 * 从列表移除用户
 */
export async function removeUserFromList(env, userId) {
  const users = await getAllUserIds(env);
  const filtered = users.filter((id) => id !== userId);
  const json = JSON.stringify(filtered);
  if (!env.GRID_KV) {
    LOCAL_STORE.data.set('meta:user_list', json);
    LOCAL_STORE.userList = filtered;
  } else {
    try {
      await env.GRID_KV.put('meta:user_list', json);
    } catch {
      LOCAL_STORE.data.set('meta:user_list', json);
      LOCAL_STORE.userList = filtered;
    }
  }
}

/**
 * 获取用户凭证
 */
export async function getCredentials(env, userId) {
  const key = `user:${userId}:credentials`;
  if (!env.GRID_KV) {
    const json = LOCAL_STORE.data.get(key);
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  }
  try {
    const json = await env.GRID_KV.get(key);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    const json = LOCAL_STORE.data.get(key);
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  }
}

/**
 * 写入用户凭证（data === null 时删除）
 */
export async function setCredentials(env, userId, data) {
  const key = `user:${userId}:credentials`;
  if (data === null) {
    if (!env.GRID_KV) {
      LOCAL_STORE.data.delete(key);
    } else {
      try { await env.GRID_KV.delete(key); } catch { LOCAL_STORE.data.delete(key); }
    }
    return;
  }
  const json = JSON.stringify(data);
  if (!env.GRID_KV) {
    LOCAL_STORE.data.set(key, json);
  } else {
    try { await env.GRID_KV.put(key, json); } catch { LOCAL_STORE.data.set(key, json); }
  }
}

// ================== matchedCount 存储（新格式：存所有策略）==================

/**
 * 获取上次记录的所有策略 matchedCount（新格式）
 * 返回 { strategyId: matchedCount }
 */
export async function getLastMatchedCounts(env, userId) {
  const key = `user:${userId}:last_matched_counts`;
  let raw;
  if (!env.GRID_KV) {
    raw = LOCAL_STORE.data.get(key) || '{}';
  } else {
    try {
      raw = await env.GRID_KV.get(key) || '{}';
    } catch {
      raw = LOCAL_STORE.data.get(key) || '{}';
    }
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * 更新记录的所有策略 matchedCount（新格式）
 * countsObj: { strategyId: matchedCount }
 */
export async function setLastMatchedCounts(env, userId, countsObj) {
  const key = `user:${userId}:last_matched_counts`;
  const value = JSON.stringify(countsObj);
  if (!env.GRID_KV) {
    LOCAL_STORE.data.set(key, value);
  } else {
    try { await env.GRID_KV.put(key, value); } catch { LOCAL_STORE.data.set(key, value); }
  }
}

// ================== matchedCount 存储（旧格式，向后兼容）==================

/**
 * 获取上次记录的 matchedCount（旧格式，仅第一个策略）
 */
export async function getLastMatchedCount(env, userId) {
  const key = `user:${userId}:last_matched_count`;
  if (!env.GRID_KV) {
    return LOCAL_STORE.data.get(key) || '';
  }
  try {
    const val = await env.GRID_KV.get(key);
    return val || '';
  } catch {
    return LOCAL_STORE.data.get(key) || '';
  }
}

/**
 * 更新记录的 matchedCount（旧格式）
 */
export async function setLastMatchedCount(env, userId, count) {
  const key = `user:${userId}:last_matched_count`;
  const value = String(count);
  if (!env.GRID_KV) {
    LOCAL_STORE.data.set(key, value);
  } else {
    try { await env.GRID_KV.put(key, value); } catch { LOCAL_STORE.data.set(key, value); }
  }
}

/**
 * 获取本地存储状态（调试用）
 */
export function getLocalStore() {
  return {
    userList: LOCAL_STORE.userList,
    keys: Array.from(LOCAL_STORE.data.keys()),
  };
}
