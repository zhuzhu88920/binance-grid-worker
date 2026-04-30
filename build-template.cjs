/**
 * build-template.js
 * 读取 push-template.yaml 并生成 src/push-config.js
 * 用法: node build-template.js
 */

const fs = require('fs');
const path = require('path');

function parseSimpleYaml(text) {
  const obj = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let val = trimmed.substring(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    obj[key] = val;
  }
  return obj;
}

const yamlPath = path.join(__dirname, 'push-template.yaml');
const outPath = path.join(__dirname, 'src', 'push-config.js');

const yamlText = fs.readFileSync(yamlPath, 'utf8');
const cfg = parseSimpleYaml(yamlText);

const js = `/**
 * 推送消息模板配置（由 push-template.yaml 自动生成）
 * 如需修改推送格式，请编辑 push-template.yaml 后运行: node build-template.js
 *
 * 可用占位符:
 *   {symbol}          交易对
 *   {leverage}        杠杆倍数
 *   {total_pnl}       总收益（含未实现）
 *   {total_pnl_rate}  总收益率%
 *   {matched_count}   已配对订单数
 *   {unmatched_count} 未配对订单数
 *   {mark_price}      标记价格
 *   {indicator}       收益率颜色指示器
 *   {total_pnl_all}  所有策略总收益
 */

export const PUSH_TEMPLATE = {
  title: ${JSON.stringify(cfg.title || '')},
  strategy_line: ${JSON.stringify(cfg.strategy_line || '')},
  footer: ${JSON.stringify(cfg.footer || '')},
  empty_body: ${JSON.stringify(cfg.empty_body || '')},
  expired_title: ${JSON.stringify(cfg.expired_title || '')},
  expired_body: ${JSON.stringify(cfg.expired_body || '')},
};

/**
 * 格式化单个策略行
 */
export function formatStrategyLine(m, indicator) {
  const t = PUSH_TEMPLATE.strategy_line;
  const pnlStr = (m.total_pnl >= 0 ? '+' : '') + m.total_pnl.toFixed(2);
  const rateStr = (m.total_pnl_rate >= 0 ? '+' : '') + m.total_pnl_rate.toFixed(2);
  const markStr = m.mark_price > 0 ? m.mark_price.toFixed(2) : '?.??';
  return t
    .split('{indicator}').join(indicator)
    .split('{symbol}').join(m.symbol)
    .split('{leverage}').join(String(m.initial_leverage))
    .split('{total_pnl}').join(pnlStr)
    .split('{total_pnl_rate}').join(rateStr)
    .split('{matched_count}').join(String(m.matched_count))
    .split('{unmatched_count}').join(String(m.unmatched_count))
    .split('{mark_price}').join(markStr);
}

/**
 * 获取收益率颜色指示器
 */
export function getIndicator(rate) {
  if (rate > 5) return '\\u{1F7E2}';
  if (rate > 0) return '\\u{1F7E1}';
  if (rate > -5) return '\\u{1F7E0}';
  return '\\u{1F534}';
}
`;

fs.writeFileSync(outPath, js, 'utf8');
console.log('✅ 已生成 src/push-config.js');
console.log('当前模板配置:');
console.log(JSON.stringify(cfg, null, 2));
