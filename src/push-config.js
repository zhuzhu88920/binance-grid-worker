/**
 * 推送消息模板配置（由 push-template.yaml 自动生成）
 * 可用占位符见 push-template.yaml
 */

export const PUSH_TEMPLATE = {
  title: "🤖{username} 🏦{total_assets}U 💰{mark_price_fmt} ⏰{time} ",
  strategy_line: "{indicator}{strategy_amount}U {leverage}x 🍻{matched_count} 🍺{unmatched_count} 🚀{total_pnl}({total_pnl_rate}%)|{matched_pnl}({matched_pnl_rate}%)|{unmatched_profit}({unmatched_profit_rate}%) ☀{days}day",
  footer: "",
  empty_body: "⚠️ 未获取到任何策略数据",
  expired_title: "⚠️ Binance Cookie 已失效",
  expired_body: "请更新 Cookie 和 CSRF Token",
};

/**
 * 格式化数字，正数加 + 号，保留2位小数
 */
function fmtNum(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

/**
 * 格式化策略本金（取整）
 */
function fmtAmt(v) {
  return Math.floor(v).toString();
}

/**
 * 格式化天数（1位小数，不含 "day" 后缀，由模板控制后缀）
 * 0.7day / 7.6day / 99.1day
 */
function fmtDays(d, h, m) {
  var total = d + h / 24 + m / 1440;
  return total.toFixed(1);
}

/**
 * 格式化单个策略行
 * m: processGrid() 输出的 metrics 对象
 * indicator: 颜色指示器 emoji
 */
export function formatStrategyLine(m, indicator) {
  var t = PUSH_TEMPLATE.strategy_line;
  t = t.split('{indicator}').join(indicator);
  t = t.split('{strategy_amount}').join(fmtAmt(m.strategy_amount));
  t = t.split('{leverage}').join(String(m.initial_leverage));
  t = t.split('{matched_count}').join(String(m.matched_count));
  t = t.split('{unmatched_count}').join(String(m.unmatched_count));
  t = t.split('{total_pnl}').join(fmtNum(m.total_pnl));
  t = t.split('{total_pnl_rate}').join(fmtNum(m.total_pnl_rate));
  t = t.split('{matched_pnl}').join(fmtNum(m.matched_pnl));
  t = t.split('{matched_pnl_rate}').join(fmtNum(m.matched_pnl_rate));
  t = t.split('{unmatched_profit}').join(fmtNum(m.unmatched_profit));
  t = t.split('{unmatched_profit_rate}').join(fmtNum(m.unmatched_profit_rate));
  t = t.split('{days}').join(fmtDays(m.days, m.hours, m.minutes));
  return t;
}

/**
 * 获取收益率颜色指示器
 */
export function getIndicator(rate) {
  if (rate > 5) return '🟢';
  if (rate > 0) return '🟡';
  if (rate > -5) return '🟠';
  return '🔴';
}
