/**
 * 一键更新：.dev.vars → CF Secrets → 校验 → 触发推送
 *
 * 用法:
 *   $env:CLOUDFLARE_API_TOKEN="cfut_xxx"; node sync-secrets.cjs
 *   node sync-secrets.cjs --dry   # 只预览，不上传
 */

const fs = require('fs');
const https = require('https');

const ACCOUNT_ID = '7eeac3798da0cafbdd84901d4d9fab18';
const WORKER_NAME = 'binance-grid-worker';
const WORKER_URL = 'https://binance-grid-worker.andox.workers.dev';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!API_TOKEN && !process.argv.includes('--dry')) {
  console.error('\n  错误：未设置 CLOUDFLARE_API_TOKEN 环境变量');
  console.error('  用法: $env:CLOUDFLARE_API_TOKEN="cfut_xxx"; node sync-secrets.cjs\n');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry');

// ==================== 工具函数 ====================

function parseEnvFile(path) {
  if (!fs.existsSync(path)) {
    console.error(`\n  错误：找不到 ${path}\n`);
    process.exit(1);
  }
  return fs.readFileSync(path, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .reduce((acc, line) => {
      const eq = line.indexOf('=');
      if (eq !== -1) acc[line.slice(0, eq)] = line.slice(eq + 1);
      return acc;
    }, {});
}

function cfApi(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          j.success ? resolve(j) : reject(new Error(JSON.stringify(j.errors)));
        } catch (e) {
          reject(new Error(`响应解析失败: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpPost(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST' }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

// ==================== 步骤 1：读取 .dev.vars ====================

function step1_parse() {
  console.log('\n========================================');
  console.log('  步骤 1/4：读取 .dev.vars');
  console.log('========================================\n');

  const env = parseEnvFile('.dev.vars');
  const keys = Object.keys(env);

  // 统计用户数
  const userNums = new Set();
  for (const k of keys) {
    const m = k.match(/^USER(\d)_/);
    if (m) userNums.add(m[1]);
  }
  const userCount = userNums.size || (keys.includes('COOKIE') ? 1 : 0);

  console.log(`  检测到 ${userCount} 个用户，${keys.length} 个变量:`);
  for (const k of keys) {
    console.log(`    ${k} = (${env[k].length} 字符)`);
  }

  return env;
}

// ==================== 步骤 2：上传 Secrets ====================

async function step2_upload(env) {
  console.log('\n========================================');
  console.log('  步骤 2/4：上传 Secrets 到 Cloudflare');
  console.log('========================================\n');

  let ok = 0, fail = 0;
  for (const [name, value] of Object.entries(env)) {
    const body = JSON.stringify({ type: 'secret_text', name, text: value });
    try {
      await cfApi('PUT', `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`, body);
      console.log(`  ✓ ${name}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${name} 失败: ${e.message}`);
      fail++;
    }
  }

  // 清理旧名称
  const oldNames = ['BINANCE_COOKIE', 'BINANCE_CSRF_TOKEN', 'BINANCE_USER_ID', 'UPDATE_SECRET'];
  for (const name of oldNames) {
    try {
      await cfApi('DELETE', `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets/${name}`);
    } catch { /* 不存在就跳过 */ }
  }

  if (fail > 0) {
    console.error(`\n  ⚠ ${fail} 个变量上传失败，请检查！`);
    process.exit(1);
  }
  console.log(`\n  全部 ${ok} 个变量上传成功`);
}

// ==================== 步骤 3：校验 Secrets ====================

async function step3_verify(env) {
  console.log('\n========================================');
  console.log('  步骤 3/4：校验 Secrets');
  console.log('========================================\n');

  const res = await cfApi('GET', `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`);
  const remoteNames = new Set((res.result || []).map(s => s.name));

  let missing = [];
  for (const name of Object.keys(env)) {
    if (!remoteNames.has(name)) missing.push(name);
  }

  if (missing.length > 0) {
    console.error(`  ✗ 以下变量在 CF 上不存在: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`  ✓ 全部 ${Object.keys(env).length} 个变量校验通过`);
  return remoteNames;
}

// ==================== 步骤 4：触发推送 ====================

async function step4_trigger() {
  console.log('\n========================================');
  console.log('  步骤 4/4：触发推送');
  console.log('========================================\n');

  // 先检查 /api/users
  try {
    const usersRaw = await httpGet(`${WORKER_URL}/api/users`);
    const users = JSON.parse(usersRaw);
    console.log(`  Worker 已加载 ${users.count} 个用户: ${users.users.map(u => u.id).join(', ')}`);
  } catch (e) {
    console.error(`  ✗ Worker 无响应: ${e.message}`);
    process.exit(1);
  }

  // POST /api/trigger
  try {
    const raw = await httpPost(`${WORKER_URL}/api/trigger`);
    const result = JSON.parse(raw);

    if (result.success) {
      console.log('\n  推送结果:');
      for (const r of result.results) {
        if (r.success) {
          console.log(`    ✓ ${r.userId} — ${r.strategyCount} 个策略已推送`);
        } else {
          console.log(`    ✗ ${r.userId} — 失败: ${r.error}`);
        }
      }
    } else {
      console.error(`  ✗ 触发失败: ${result.error}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`  ✗ 触发请求失败: ${e.message}`);
    process.exit(1);
  }
}

// ==================== 主流程 ====================

async function main() {
  console.log('\n  Binance Grid Worker — 一键更新');
  console.log('  ===============================');

  const env = step1_parse();

  if (DRY_RUN) {
    console.log('\n  [dry-run] 以上内容会被上传，实际未执行');
    return;
  }

  await step2_upload(env);
  await step3_verify(env);
  await step4_trigger();

  console.log('\n========================================');
  console.log('  全部完成！推送已触发。');
  console.log('========================================\n');
}

main().catch(e => {
  console.error(`\n  执行出错: ${e.message}\n`);
  process.exit(1);
});
