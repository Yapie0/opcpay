import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as sdk from '../index.mjs';
import { opcpay, opcpayError, verifyWebhook } from '../index.mjs';

test('只导出当前 SDK 名称', () => {
  assert.equal('Yirenfu' in sdk, false);
  assert.equal('YirenfuError' in sdk, false);
  const client = new opcpay({ apiKey: 'local-test-only' });
  assert.ok(client instanceof opcpay);
  const error = new opcpayError('test', 400, {}, 'test-request');
  assert.ok(error instanceof opcpayError);
});

test('使用 opcpay 环境变量，不回退旧环境变量，并支持显式密钥', () => {
  const originalLower = process.env.opcpay_api_key;
  const originalNew = process.env.OPCPAY_API_KEY;
  const originalOld = process.env.YIRENFU_API_KEY;
  try {
    process.env.opcpay_api_key = 'lower-local-test-only';
    process.env.OPCPAY_API_KEY = 'new-local-test-only';
    process.env.YIRENFU_API_KEY = 'old-local-test-only';
    assert.equal(new opcpay().key, 'lower-local-test-only');
    assert.equal(new opcpay({ apiKey: 'explicit-local-test-only' }).key, 'explicit-local-test-only');
    assert.throws(() => new opcpay({ apiKey: '' }));
    delete process.env.opcpay_api_key;
    assert.throws(() => new opcpay(), /opcpay_api_key/);
    delete process.env.OPCPAY_API_KEY;
    assert.throws(() => new opcpay(), /opcpay_api_key/);
    delete process.env.YIRENFU_API_KEY;
    assert.throws(() => new opcpay(), /opcpay_api_key/);
  } finally {
    if (originalLower === undefined) delete process.env.opcpay_api_key;
    else process.env.opcpay_api_key = originalLower;
    if (originalNew === undefined) delete process.env.OPCPAY_API_KEY;
    else process.env.OPCPAY_API_KEY = originalNew;
    if (originalOld === undefined) delete process.env.YIRENFU_API_KEY;
    else process.env.YIRENFU_API_KEY = originalOld;
  }
});

test('默认主站地址、自定义地址和服务端请求参数', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const client = new opcpay({ apiKey: 'local-test-only' });
    await client.product();
    await client.purchase({ userId: 'user-1', idempotencyKey: 'job-1', skuId: 'sku-1' });
    await client.consume({ userId: 'user-1', idempotencyKey: 'job-2', amount: 1, reason: 'test' });
    assert.equal(seen[0].url, 'https://ai6666.com/opcpay/api/pay/v1/product');
    assert.equal(seen[0].options.headers.Authorization, 'Bearer local-test-only');
    assert.equal(seen[0].options.redirect, 'error');
    assert.deepEqual(JSON.parse(seen[1].options.body), { user_id: 'user-1', idempotency_key: 'job-1', sku_id: 'sku-1' });
    assert.deepEqual(JSON.parse(seen[2].options.body), { user_id: 'user-1', idempotency_key: 'job-2', amount: 1, reason: 'test' });
    const custom = new opcpay({ apiKey: 'local-test-only', baseURL: 'https://example.invalid/api/pay/v1/' });
    await custom.capabilities();
    assert.equal(seen[3].url, 'https://example.invalid/api/pay/v1/capabilities');
    assert.throws(() => new opcpay({ apiKey: 'local-test-only', baseURL: 'http://example.invalid' }));
    assert.throws(() => new opcpay({ apiKey: '' }));
  } finally {
    globalThis.fetch = original;
  }
});

test('接口错误保留状态和请求编号，不自动重试', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'Not available', error_code: 'CAPABILITY_NOT_AVAILABLE', retryable: false }), {
      status: 501,
      headers: { 'x-request-id': 'test-request' },
    });
  };
  try {
    const client = new opcpay({ apiKey: 'local-test-only' });
    await assert.rejects(() => client.refund({}), error =>
      error instanceof opcpayError && error.status === 501 &&
      error.code === 'CAPABILITY_NOT_AVAILABLE' && error.requestId === 'test-request' &&
      error.retryable === false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('通知验签校验原文、时间窗口及事件 ID', () => {
  const raw = Buffer.from('{"id":"evt-test"}');
  const secret = 'local-test-only';
  const timestamp = '1791792000';
  const signature = 'v1=' + createHmac('sha256', secret).update(timestamp + '.').update(raw).digest('hex');
  const headers = { 'yirenfu-event-id': 'evt-test', 'yirenfu-timestamp': timestamp, 'yirenfu-signature': signature };
  assert.equal(verifyWebhook(raw, headers, secret, Number(timestamp)).id, 'evt-test');
  assert.throws(() => verifyWebhook(Buffer.from('{}'), headers, secret, Number(timestamp)));
  assert.throws(() => verifyWebhook(raw, headers, secret, Number(timestamp) + 301));
  assert.throws(() => verifyWebhook(raw, { ...headers, 'yirenfu-event-id': 'wrong' }, secret, Number(timestamp)));
});
