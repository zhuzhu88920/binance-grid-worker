import fs from 'fs';
import { execSync } from 'child_process';

const WORKSPACE_DIR = 'X:\\code\\binance-grid-worker';
const VARS_FILE = `${WORKSPACE_DIR}\\.dev.vars`;

console.log('开始解析 .dev.vars 并同步 Secrets 到 Cloudflare...\n');

// 1. 读取并手动解析 .dev.vars 文件
let varsContent = '';
try {
  varsContent = fs.readFileSync(VARS_FILE, 'utf8');
} catch (e) {
  console.error(`❌ 读取 .dev.vars 失败: ${e.message}`);
  process.exit(1);
}

const secrets = {};
const lines = varsContent.split('\n');

for (let line of lines) {
  line = line.trim();
  // 忽略空行和注释
  if (!line || line.startsWith('#')) continue;
  
  // 找到第一个等号的位置，分割键和值
  const firstEqIdx = line.indexOf('=');
  if (firstEqIdx === -1) continue;

  const key = line.substring(0, firstEqIdx).trim();
  let value = line.substring(firstEqIdx + 1).trim();

  // 如果值被单引号或双引号包裹（为了防解析），在这里去掉引号，还原真实字符串
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.substring(1, value.length - 1);
  }

  secrets[key] = value;
}

// 2. 定义需要推送到 Cloudflare 的变量列表
const keysToPush = [
  'USER1_COOKIE',
  'USER1_CSRF_TOKEN',
  'USER1_BARK_KEY',
  'USER1_ID'
];

// 3. 循环推送
for (const key of keysToPush) {
  const value = secrets[key];
  if (value === undefined) {
    console.warn(`⚠️ 在 .dev.vars 中未找到 [${key}]，跳过推送。`);
    continue;
  }

  console.log(`正在推送 ${key}...`);
  try {
    // 核心安全点：使用 input 直接将内存中的文本喂给 wrangler，彻底杜绝 CMD 特殊字符截断
    const output = execSync(`npx wrangler secret put ${key}`, { 
      cwd: WORKSPACE_DIR,
      input: value,       
      stdio: 'pipe',
      shell: true
    });
    console.log(`✅ [${key}] 更新成功！`);
  } catch(e) {
    console.error(`❌ [${key}] 更新失败:`);
    console.error(e.stderr ? e.stderr.toString() : e.message);
  }
  console.log('----------------------------------------');
}

console.log('🎉 所有指定的 Secrets 推送流程结束！');