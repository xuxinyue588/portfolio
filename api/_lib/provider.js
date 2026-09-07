/**
 * DeepSeek Provider 适配层
 *
 * 换模型厂商只需要改这一个文件：对外只暴露 callModel(messages, opts)，
 * 返回统一的结果结构，上层 api/ask.js 不感知具体厂商。
 *
 * 使用 CommonJS 而不是 ESM：项目是零配置静态站 + Vercel Functions，
 * 不引入 package.json 可以避免 Vercel 误判为需要构建的 Node 项目。
 */

'use strict';

/**
 * 环境变量在函数内读取，不在模块顶层求值。
 * 顶层求值会把 BASE_URL / MODEL 固化在冷启动那一刻，既无法在运行时切换，
 * 也让本地用 stub 服务做测试变得不可能。
 */
function baseUrl() {
  return (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
}
function model() {
  return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
}

/** 首字节超时：超过这个时间还没拿到响应头就放弃 */
const TTFB_TIMEOUT_MS = 8000;
/** 整体上限：防止流式回答长时间占用函数执行时间 */
const TOTAL_TIMEOUT_MS = 45000;

/** 把上游状态码与异常映射成内部错误码，避免把厂商细节泄露给前端 */
function mapError(status, err) {
  if (err && err.name === 'AbortError') return { code: 'upstream_timeout', status: 504 };
  if (err) return { code: 'upstream_network', status: 503 };
  if (status === 401 || status === 403) return { code: 'upstream_auth', status: 503 };
  if (status === 429) return { code: 'upstream_rate_limited', status: 503 };
  if (status >= 500) return { code: 'upstream_unavailable', status: 503 };
  if (status === 400 || status === 422) return { code: 'upstream_bad_request', status: 502 };
  return { code: 'upstream_unavailable', status: 503 };
}

/**
 * 调用模型。
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {Object}  opts
 * @param {boolean} opts.stream      是否流式
 * @param {number}  opts.maxTokens   单次输出上限
 * @param {number}  opts.temperature
 * @param {boolean} opts.jsonMode    是否强制 JSON 输出（JD 模式用）
 * @returns {Promise<{ok:boolean, response?:Response, data?:Object, error?:string, status?:number}>}
 */
async function callModel(messages, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // 快速失败：缺 key 属于部署配置问题，不该表现为"模型不可用"
    return { ok: false, error: 'missing_api_key', status: 500 };
  }
  return sendRequest(apiKey, messages, opts);
}

async function sendRequest(apiKey, messages, opts) {
  const stream = !!opts.stream;
  const body = {
    model: model(),
    messages,
    stream,
    max_tokens: opts.maxTokens || 900,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  // 首字节超时只覆盖到响应头返回为止；拿到响应后立刻清掉，
  // 否则流式回答会在 8 秒时被硬生生截断。
  const ttfbTimer = setTimeout(() => ctrl.abort(), TTFB_TIMEOUT_MS);
  // 整体上限单独计时，作为函数执行时间的兜底。
  const totalTimer = setTimeout(() => ctrl.abort(), TOTAL_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(baseUrl() + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (err) {
    clearTimeout(ttfbTimer);
    clearTimeout(totalTimer);
    const m = mapError(null, err);
    return { ok: false, error: m.code, status: m.status };
  }
  clearTimeout(ttfbTimer);

  if (!res.ok) {
    clearTimeout(totalTimer);
    const m = mapError(res.status, null);
    return { ok: false, error: m.code, status: m.status, upstreamStatus: res.status };
  }

  if (stream) {
    // 交给上层边读边转发；totalTimer 由上层在读完后清理
    return { ok: true, response: res, cleanup: () => clearTimeout(totalTimer) };
  }

  try {
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    const m = mapError(null, err);
    return { ok: false, error: m.code, status: m.status };
  } finally {
    clearTimeout(totalTimer);
  }
}

module.exports = { callModel, model, baseUrl, TTFB_TIMEOUT_MS, TOTAL_TIMEOUT_MS };
