/**
 * 同步 .dev.vars → Cloudflare Worker Secrets
 * 用法:
 *   $env:CLOUDFLARE_API_TOKEN="cfut_xxx"; node sync-secrets.cjs
 *   node sync-secrets.cjs --dry   # 只打印，不实际上传
 *
 * 需要环境变量 CLOUDFLARE_API_TOKEN
 */

const fs = require('fs');
const https = require('https');

const ACCOUNT_ID = '7eeac3798da0cafbdd84901d4d9fab18';
const WORKER_NAME = 'binance-grid-worker';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!API_TOKEN) {
  console.error('错误：未设置 CLOUDFLARE_API_TOKEN 环境变量');
  console.error('用法: $env:CLOUDFLARE_API_TOKEN="cfut_xxx"; node sync-secrets.cjs');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry');

// 解析 .dev.vars（跳过 # 注释行和空行）
function parseEnvFile(path) {
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

function api(method, path, body = null) {
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
        const j = JSON.parse(data);
        j.success ? resolve(j) : reject(new Error(JSON.stringify(j.errors)));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function sync() {
  const env = parseEnvFile('.dev.vars');
  const keys = Object.keys(env);
  console.log(`读取到 ${keys.length} 个变量: ${keys.join(', ')}`);

  if (DRY_RUN) {
    console.log('\n[dry-run] 以下内容会被上传:');
    for (const [k, v] of Object.entries(env)) console.log(`  ${k} = (${v.length} 字符)`);
    return;
  }

  // 上传新变量
  console.log('\n上传 secrets...');
  for (const [name, value] of Object.entries(env)) {
    const body = JSON.stringify({ type: 'secret_text', name, text: value });
    try {
      await api('PUT', `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`, body);
      console.log(`  ✓ ${name} (${value.length} 字符)`);
    } catch (e) {
      console.error(`  ✗ ${name} 失败:`, e.message);
    }
  }

  // 删除已知旧名称（如果存在）
  const oldNames = ['BINANCE_COOKIE', 'BINANCE_CSRF_TOKEN', 'BINANCE_USER_ID', 'UPDATE_SECRET', 'BARK_KEY', 'COOKIE', 'CSRF_TOKEN'];
  console.log('\n清理旧 secrets...');
  for (const name of oldNames) {
    try {
      await api('DELETE', `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets/${name}`);
      console.log(`  ✓ 已删除旧 secret: ${name}`);
    } catch {
      // 不存在也没关系
    }
  }

  console.log('\n完成！可运行 wrangler deploy 或等待 GitHub Actions 自动部署');
}

sync().catch(console.error);
