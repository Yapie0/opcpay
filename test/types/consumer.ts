import { opcpay, opcpayError, verifyWebhook, type Product, type Consumption } from 'opcpay';
import { Buffer } from 'node:buffer';
const client = new opcpay({ apiKey: 'fixture' });
const product: Promise<Product> = client.product();
const consume: Promise<Consumption> = client.consume({ userId: 'user', idempotencyKey: 'job', amount: 1, reason: '生成报告' });
client.purchase({ userId: 'user', idempotencyKey: 'purchase', skuId: 'selected-sku' });
client.events({ limit: 10 });
verifyWebhook(Buffer.from('{}'), {}, 'fixture');
const error: Error = new opcpayError('failure', 500, {}, null);
// @ts-expect-error user identity is required
client.purchase({ skuId: 'selected-sku' });
// @ts-expect-error business key must be a string
client.consume({ userId: 'user', idempotencyKey: 5, reason: '报告' });
// @ts-expect-error quota amount must be numeric
client.access('user', '1');
// @ts-expect-error removed legacy API must not reappear
import { Yirenfu } from 'opcpay';
void [product, consume, error];
