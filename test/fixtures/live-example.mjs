// Local TLS fixture only. Provider calls never reach opcpay/Alipay.
import { createServer } from 'node:https';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../../examples/node/server.mjs';
import { openStore } from '../../examples/node/store.mjs';
import { mockProvider } from '../../examples/node/mock.mjs';
import { pathToFileURL } from 'node:url';
const { opcpay } = await import(process.env.SDK_MODULE ? pathToFileURL(process.env.SDK_MODULE).href : '../../index.mjs');
const mode = process.env.TEST_BILLING_MODE;
const quantity = mode === 'COUNT' || mode === 'POINT';
const db = openStore(process.env.DATABASE_PATH);
const product = {
  capability_status: 'ENABLED', product_name: 'TLS 测试项目', billing_mode: quantity ? 'QUANTITY' : mode,
  ...(quantity ? { quota_unit: mode } : {}), charging_options: [{
    sku_id: 'fixture-sku', plan_id: 'fixture-plan', display_name: '测试套餐', price: '6.00', currency: 'CNY', price_version: 1,
    billing_mode: quantity ? 'QUANTITY' : mode, entitlement_rule: quantity ? 'QUOTA' : mode === 'ONE_TIME_DURATION' ? 'FIXED_DURATION' : 'PERPETUAL',
    ...(quantity ? { quota_amount: 3, quota_unit: mode } : mode === 'ONE_TIME_DURATION' ? { duration_period: 'MONTH' } : {}),
  }],
};
const provider = mockProvider(db, process.env.PUBLIC_ORIGIN, product);
const access = provider.access, consume = provider.consume, consumption = provider.consumption;
provider.access = async (user, amount) => {
  const result = await access(user, amount);
  return quantity ? { ...result, quota_unit: mode } : { access_granted: result.total > 0, decision: result.total > 0 ? 'ALLOW' : 'PURCHASE_REQUIRED', ...(mode === 'ONE_TIME_DURATION' ? { valid_until: '2099-01-01T00:00:00+08:00' } : {}) };
};
provider.consume = async input => { if (!quantity) throw Error('Non-quantity must not consume'); return { ...await consume(input), quota_unit: mode }; };
provider.consumption = async (...input) => ({ ...await consumption(...input), quota_unit: mode });
const sdk = new opcpay({ apiKey: 'local-fixture-not-a-real-key', baseURL: process.env.PUBLIC_ORIGIN + '/provider' });
const app = createApp({ db, provider: sdk, env: { ...process.env, PAYMENT_MODE: 'live', opcpay_api_key: 'local-fixture-not-a-real-key', DEMO_PASSWORD: 'private-fixture-password' } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const tls = createServer({ key: readFileSync(process.env.TEST_TLS_KEY), cert: readFileSync(process.env.TEST_TLS_CERT) }, async (req, res) => {
  if (req.url.startsWith('/provider/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer local-fixture-not-a-real-key') { res.writeHead(401); return res.end(JSON.stringify({ error: 'Invalid fixture key', error_code: 'INVALID_API_KEY', retryable: false })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    try {
      const calls = {
        '/provider/capabilities': () => provider.capabilities(), '/provider/product': () => provider.product(),
        '/provider/access': () => provider.access(input.user_id, input.amount),
        '/provider/purchase': () => provider.purchase({ userId: input.user_id, idempotencyKey: input.idempotency_key, skuId: input.sku_id, callbackURL: input.callback_url }),
        '/provider/purchase/query': () => provider.purchaseQuery(input.user_id, input.idempotency_key),
        '/provider/consumption': () => provider.consumption(input.user_id, input.idempotency_key),
        '/provider/consume': () => provider.consume({ userId: input.user_id, idempotencyKey: input.idempotency_key, amount: input.amount, reason: input.reason }),
      };
      if (!calls[req.url]) throw Error('Unsupported fixture route');
      return res.end(JSON.stringify(await calls[req.url]()));
    } catch { res.writeHead(404); return res.end(JSON.stringify({ error: 'Fixture record not found', error_code: 'REQUEST_NOT_FOUND', retryable: false })); }
  }
  const upstream = request({ host: '127.0.0.1', port: app.server.address().port, path: req.url, method: req.method, headers: req.headers }, result => { res.writeHead(result.statusCode, result.headers); result.pipe(res); });
  upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
});
await new Promise(resolve => tls.listen(Number(process.env.PORT), '127.0.0.1', resolve));
console.log('READY');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { tls.closeAllConnections(); tls.close(); await app.close(); process.exit(0); });
