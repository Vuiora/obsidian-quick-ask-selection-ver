const { normalizeSources } = require('./web-search');
const { createAbortController } = require('./transport');
const LIMIT = 5;
const ENDPOINTS = { firecrawl: 'https://api.firecrawl.dev/v2/search', exa: 'https://api.exa.ai/search',
  parallel: 'https://api.parallel.ai/v1/search', perplexity: 'https://api.perplexity.ai/search' };
function textFromHTML(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') { const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()];
  }).replace(/\s+/g, ' ').trim();
}
function parseDuckDuckGo(html) {
  if (/anomaly\.js|challenge-form|bots use duckduckgo|verify you are human/i.test(html)) throw new Error('CHALLENGE');
  const rows = [];
  const anchors = [...html.matchAll(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const href = /href=["']([^"']+)["']/i.exec(anchor[0])?.[1];
    if (!href) continue;
    let url = textFromHTML(href);
    if (url.startsWith('//')) url = 'https:' + url;
    try { const parsed = new URL(url); if (parsed.hostname === 'duckduckgo.com' && parsed.searchParams.has('uddg')) url = parsed.searchParams.get('uddg'); } catch { continue; }
    const section = html.slice(anchor.index + anchor[0].length, anchors[i + 1]?.index ?? html.length);
    const snippet = /<(?:a|div|span)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i.exec(section)?.[1];
    rows.push({ url, title: textFromHTML(anchor[0]), snippet: textFromHTML(snippet) });
  }
  const sources = normalizeSources(rows, LIMIT);
  if (!sources.length && !/no results|result--no-result/i.test(html)) throw new Error('PARSE');
  return sources;
}

// Bing result links can be wrapped in a click-tracking URL. Resolve only the
// encoded destination; never return a redirect or an unvalidated scheme.
function bingDestination(value) {
  try {
    const parsed = new URL(textFromHTML(value), 'https://www.bing.com');
    if (/^(?:www\.)?bing\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/ck/a')) {
      const encoded = parsed.searchParams.get('u');
      if (!encoded?.startsWith('a1') || !/^[A-Za-z0-9_-]+$/.test(encoded.slice(2))) return null;
      const base64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const binary = globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return normalizeSources([{ url: decoded }], 1)[0]?.url ?? null;
    }
    // Internal Bing navigation is not a source for the answer.
    if (/^(?:www\.)?bing\.com$/i.test(parsed.hostname)) return null;
    return normalizeSources([{ url: parsed.href }], 1)[0]?.url ?? null;
  } catch { return null; }
}

function parseBing(html) {
  html = String(html ?? '');
  if (/id=["']b_captcha|captcha-form|verify you are human|unusual traffic|human verification/i.test(html)) throw new Error('CHALLENGE');
  const matches = [...html.matchAll(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/gi)];
  const rows = [];
  for (let i = 0; i < matches.length; i++) {
    const section = html.slice(matches[i].index, matches[i + 1]?.index ?? html.length);
    const heading = /<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i.exec(section);
    if (!heading) continue;
    const url = bingDestination(heading[1]);
    if (!url) continue;
    const snippet = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(section)?.[1] ?? '';
    rows.push({ url, title: textFromHTML(heading[2]), snippet: textFromHTML(snippet) });
  }
  const sources = normalizeSources(rows, LIMIT);
  if (!sources.length && !/no results found|there are no results for/i.test(html)) throw new Error('PARSE');
  return sources;
}
function requestFor(provider, query, key, route = {}) {
  const headers = { 'Content-Type': 'application/json' };
  let url = ENDPOINTS[provider];
  let body;
  if (provider === 'firecrawl') { headers.Authorization = `Bearer ${key}`; body = { query, limit: LIMIT, sources: ['web'] }; }
  if (provider === 'exa') { headers['x-api-key'] = key; body = { query, numResults: LIMIT, contents: { highlights: { maxCharacters: 2000 } } }; }
  if (provider === 'parallel') { headers['x-api-key'] = key; body = { objective: query, search_queries: [query], advanced_settings: { max_results: LIMIT, excerpt_settings: { max_chars_per_result: 2000 } } }; }
  if (provider === 'perplexity') { headers.Authorization = `Bearer ${key}`; body = { query, max_results: LIMIT, max_tokens_per_page: 512 }; }
  if (provider === 'deepseek') {
    const base = String(route.baseUrl ?? '').replace(/\/+$/, '');
    url = base + (base.endsWith('/v1') ? '/tools/search' : '/v1/tools/search');
    headers.Authorization = `Bearer ${key}`;
    body = { query, count: LIMIT, need_content: false };
  }
  return { url, method: 'POST', headers, body: JSON.stringify(body) };
}
function createSearchClient({ network, secrets, scheduler }) {
  async function request(options, signal, timeoutMs = 30000) {
    if (signal?.aborted) throw new Error('ABORTED');
    const controller = createAbortController(network);
    let timer, onAbort;
    const stop = new Promise((_, reject) => {
      onAbort = () => { reject(new Error('ABORTED')); controller.abort(); };
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
      timer = scheduler.delay(timeoutMs, () => { reject(new Error('TIMEOUT')); controller.abort(); });
    });
    try {
      const result = await Promise.race([network.request({ ...options, signal: controller.signal }), stop]);
      if ((result.text?.length ?? 0) > 2_000_000) throw new Error('TOO_LARGE');
      return result;
    } finally { scheduler.cancelDelay(timer); signal?.removeEventListener('abort', onAbort); }
  }
  async function search(query, route, { signal, config, onRoute = () => {} } = {}) {
    if (route?.kind === 'off' || route?.kind === 'server') return { ok: false, code: 'DISABLED', sources: [] };
    const deepseek = route?.provider === 'deepseek';
    if (deepseek) {
      if (typeof query !== 'string' || !query.trim() || [...query.trim()].length > 128)
        return { ok: false, code: 'QUERY', message: 'DeepSeek Search requires a non-empty query of at most 128 Unicode characters. Retry with a shorter query.', sources: [] };
    } else if (typeof query !== 'string' || !query.trim() || query.length > 500) return { ok: false, code: 'QUERY', sources: [] };
    query = query.trim();
    async function runSearch(provider, actualRoute, timeoutMs) {
      try {
        let response;
        if (actualRoute.kind === 'independent' || actualRoute.kind === 'provider-api') {
          const key = secrets.resolve(actualRoute.secretId);
          if (!key || (deepseek && !key.trim())) return { ok: false, code: 'MISSING_SECRET', sources: [] };
          response = await request(requestFor(provider, query, key, actualRoute), signal, timeoutMs);
        } else {
          const url = provider === 'bing' ? `https://www.bing.com/search?q=${encodeURIComponent(query)}` : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          response = await request({ url, method: 'GET' }, signal, timeoutMs);
        }
        const status = response.status;
        if (!(status >= 200 && status < 300)) {
          return { ok: false, provider, code: status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : 'HTTP', status, sources: [] };
        }
        let sources;
        if (actualRoute.kind === 'local') sources = provider === 'bing' ? parseBing(response.text ?? '') : parseDuckDuckGo(response.text ?? '');
        else {
          const data = response.json && typeof response.json === 'object' ? response.json : JSON.parse(response.text);
          const rows = provider === 'firecrawl' ? data.data?.web : data.results;
          if (data.success === false || !Array.isArray(rows)) throw new Error('PARSE');
          sources = normalizeSources(deepseek ? rows.map(row => ({ ...row, snippet: row?.summary || row?.snippet })) : rows, LIMIT);
          if (rows.length && !sources.length) throw new Error('PARSE');
        }
        onRoute(actualRoute);
        return { ok: true, query, provider, sources };
      } catch (error) {
        const code = signal?.aborted ? 'ABORTED' : ['CHALLENGE','PARSE','TIMEOUT','TOO_LARGE'].includes(error.message) ? error.message : 'NETWORK';
        return { ok: false, provider, code, sources: [] };
      }
    }
    const duck = route.kind === 'local' && route.provider === 'duckduckgo';
    const primary = await runSearch(route.provider, route, duck ? 10000 : 30000);
    if (!duck || primary.ok || signal?.aborted || !['NETWORK', 'TIMEOUT', 'CHALLENGE', 'PARSE', 'HTTP', 'AUTH', 'RATE_LIMIT'].includes(primary.code)) return primary;
    return runSearch('bing', { kind: 'local', provider: 'bing' }, 10000);
  }
  return { search };
}
module.exports = { createSearchClient, requestFor, parseDuckDuckGo, parseBing, bingDestination, textFromHTML };
