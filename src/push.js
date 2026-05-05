/**
 * Bark 推送模块
 * 使用 src/push-config.js 中的模板配置
 */

import { PUSH_TEMPLATE, formatStrategyLine, getIndicator } from './push-config.js';

/**
 * 获取当前时间字段
 */
function getTimeFields() {
  // Cloudflare Workers 使用 UTC 时间，需转换为北京时间 (UTC+8)
  var now = new Date();
  // 直接构造北京时间字符串
  var bjStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  // bjStr 格式如 "2026/5/1 04:17:30"，提取 HH:MM
  var match = bjStr.match(/(\d{2}):(\d{2})/);
  var h = '00', m = '00';
  if (match) {
    h = match[1];
    m = match[2];
  }
  return {
    hour: h,
    minute: m,
    time: h + ':' + m,
  };
}

/**
 * 填充模板字符串中的 {key} 占位符
 */
function fillTemplate(template, vars) {
  return template.replace(/\{([^}]+)\}/g, function (_, key) {
    return vars[key] !== undefined ? String(vars[key]) : '{' + key + '}';
  });
}

/**
 * 格式化数字，正数加 + 号，保留2位小数
 */
function fmtNum(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

/**
 * 格式化推送消息正文
 */
function formatMessage(data) {
  const tf = getTimeFields();
  const strategies = data.strategies || [];
  const userId = data.user_id || 'unknown';

  if (!strategies || strategies.length === 0) {
    var titleVars = Object.assign({}, tf, {
      username: userId,
      mark_price_fmt: '?.??',
      total_pnl_fmt: '?.??',
    });
    var title = fillTemplate(PUSH_TEMPLATE.title, titleVars);
    return { title: title, body: PUSH_TEMPLATE.empty_body };
  }

  var totalPnlAll = 0;
  var lines = [];

  for (var i = 0; i < strategies.length; i++) {
    var m = strategies[i];
    totalPnlAll += m.total_pnl;
    var indicator = getIndicator(m.total_pnl_rate);
    lines.push(formatStrategyLine(m, indicator));
  }

  // 标题变量
  var first = strategies[0];
  var titleVars2 = Object.assign({}, tf, {
    username: userId,
    mark_price_fmt: first.mark_price > 0 ? first.mark_price.toFixed(2) : '?.??',
    total_pnl_fmt: fmtNum(totalPnlAll),
    total_assets: data.total_assets || 0,
  });
  var title = fillTemplate(PUSH_TEMPLATE.title, titleVars2);

  // 正文 = 策略行 + 底部总收益
  var footerVars = {
    total_pnl_all: fmtNum(totalPnlAll),
  };
  var footer = fillTemplate(PUSH_TEMPLATE.footer, footerVars);

  var body = lines.join('\n') + '\n' + footer;
  return { title: title, body: body };
}

/**
 * 格式化 Cookie 失效消息
 */
function formatExpiredMessage() {
  var tf = getTimeFields();
  return {
    title: fillTemplate(PUSH_TEMPLATE.expired_title, tf),
    body: PUSH_TEMPLATE.expired_body,
  };
}

/**
 * 发送 Bark 推送
 */
export async function pushBark(userId, type, data, barkKey) {
  var title, body;

  if (type === 'cookie_expired') {
    var msg = formatExpiredMessage();
    title = msg.title;
    body = msg.body;
  } else {
    var msg2 = formatMessage(data);
    title = msg2.title;
    body = msg2.body;
  }

  // Bark 有字符长度限制，超过 500 字符截断
  if (body.length > 500) {
    body = body.substring(0, 497) + '...';
  }

  if (!barkKey) {
    console.log('[跳过推送] ' + title + '\n' + body);
    return true;
  }

  try {
    var barkUrl = 'https://api.day.app/' + barkKey;
    var resp = await fetch(barkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, body: body, group: 'binance_' + userId }),
    });

    if (resp.ok) {
      console.log('✅ 推送成功: ' + userId + ' - ' + title);
      return true;
    } else {
      var text = await resp.text().catch(function () { return ''; });
      console.error('❌ 推送失败: ' + resp.status + ' ' + text.substring(0, 200));
      return false;
    }
  } catch (e) {
    console.error('❌ 推送异常:', e.message);
    return false;
  }
}
