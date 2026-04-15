/**
 * Cloudflare Worker — GTG + sGTM split-router for sgtm-demo.site
 *
 * Implements the Google-recommended enterprise architecture (GTG + sGTM):
 *   JS delivery  → Google Tag Gateway (fps.goog edge CDN) — zero Cloud Run load
 *   Data collect  → Cloud Run sGTM — server-side event processing only
 *
 * Route table:
 *   /scripts/*       → GTG   (GTM container JS loader)
 *   /?id=G-*         → GTG   (gtag.js runtime, requested by Google Tag)
 *   /gtd             → GTG   (gtag dependency bundle)
 *   /metrics/*       → sGTM  (prefix stripped — collection hits via transport_url)
 *   /g/collect       → sGTM  (GA4 default collection path)
 *   /gtm/*           → sGTM  (server container debug/preview)
 *   *                → Cloudflare Pages (frontend)
 */

const GTG_ORIGIN  = 'https://gtm-kxhrg8zh.fps.goog';
const SGTM_ORIGIN = 'https://sgtm-demo-377455548251.us-central1.run.app';

function isGTGScriptPath(url) {
  const path = url.pathname;
  if (path === '/gtd' || path === '/gtd/') return true;
  if (path === '/' && url.searchParams.has('id') && url.searchParams.get('id').startsWith('G-')) return true;
  return false;
}

function isSGTMCollectPath(url) {
  return url.pathname === '/g/collect';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/scripts/')) {
      return proxyToGTG(request, url, true);
    }

    if (isGTGScriptPath(url)) {
      return proxyToGTG(request, url, false);
    }

    if (path.startsWith('/metrics/')) {
      return proxyToSGTM(request, url, true);
    }

    if (isSGTMCollectPath(url)) {
      return proxyToSGTM(request, url, false);
    }

    if (path.startsWith('/gtm/')) {
      return proxyToSGTM(request, url, false);
    }

    return fetch(request);
  },
};

async function proxyToGTG(request, url, stripScriptsPrefix) {
  const path = stripScriptsPrefix
    ? url.pathname.replace(/^\/scripts/, '')
    : url.pathname;
  const targetUrl = new URL(path + url.search, GTG_ORIGIN);

  const headers = new Headers(request.headers);
  headers.set('Host', 'gtm-kxhrg8zh.fps.goog');

  const country = request.cf?.country;
  const region  = request.cf?.regionCode;
  if (country) headers.set('X-Forwarded-Country', country);
  if (region)  headers.set('X-Forwarded-Region', region);

  const gtgRequest = new Request(targetUrl.toString(), {
    method:  request.method,
    headers: headers,
    body:    request.body,
    redirect: 'follow',
  });

  const response = await fetch(gtgRequest);

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(response.body, {
    status:  response.status,
    headers: responseHeaders,
  });
}

async function proxyToSGTM(request, url, stripMetricsPrefix) {
  const path = stripMetricsPrefix
    ? url.pathname.replace(/^\/metrics/, '')
    : url.pathname;
  const targetUrl = new URL(path + url.search, SGTM_ORIGIN);

  const headers = new Headers(request.headers);
  headers.set('Host', new URL(SGTM_ORIGIN).host);
  headers.set('X-Forwarded-Host', url.hostname);

  const sgtmRequest = new Request(targetUrl.toString(), {
    method:  request.method,
    headers: headers,
    body:    request.body,
    redirect: 'follow',
  });

  return fetch(sgtmRequest);
}
