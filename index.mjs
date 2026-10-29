// Node.js 18+. Service-side SDK; never include it or API keys in browser bundles.
import {createHmac, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {realpathSync,existsSync} from 'node:fs';

export class opcpayError extends Error {
  constructor(message, status, body, requestId) {
    super(message); this.status=status; this.code=body.error_code; this.requestId=requestId;
    this.retryable=body.retryable===true; this.body=body;
  }
}
export class opcpay {
  constructor({apiKey=process.env.opcpay_api_key,baseURL='https://ai6666.com/opcpay/api/pay/v1'}={}) {
    if(!apiKey) throw new Error('Set opcpay_api_key in your server environment');
    if(new URL(baseURL).protocol!=='https:') throw new Error('API base must use HTTPS');
    this.key=apiKey;this.base=baseURL.replace(/\/$/,'');
  }
  async request(path,body,method=body===undefined?'GET':'POST') {
    const response=await fetch(this.base+path,{method,redirect:'error',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    let result;
    try { result=await response.json(); if(!result||typeof result!=='object'||Array.isArray(result)) throw new Error(); }
    catch { throw new opcpayError('API returned an invalid JSON response',response.status,{error_code:'INVALID_RESPONSE',retryable:response.status===429||response.status>=500},response.headers.get('x-request-id')); }
    if(!response.ok) throw new opcpayError(result.error||'API request failed',response.status,result,response.headers.get('x-request-id'));
    return result;
  }
  capabilities(){return this.request('/capabilities')}
  product(){return this.request('/product')}
  access(userId,amount=1){return this.request('/access',{user_id:userId,amount})}
  purchase({userId,idempotencyKey,skuId,callbackURL}){return this.request('/purchase',{user_id:userId,idempotency_key:idempotencyKey,...(skuId?{sku_id:skuId}:{}),...(callbackURL?{callback_url:callbackURL}:{})})}
  purchaseQuery(userId,idempotencyKey){return this.request('/purchase/query',{user_id:userId,idempotency_key:idempotencyKey})}
  purchases(options={}){return this.request('/purchases/list',options)}
  consume({userId,idempotencyKey,amount=1,reason}){return this.request('/consume',{user_id:userId,idempotency_key:idempotencyKey,amount,reason})}
  consumption(userId,idempotencyKey){return this.request('/consumption',{user_id:userId,idempotency_key:idempotencyKey})}
  consumptions(options={}){return this.request('/consumptions/list',options)}
  webhook(){return this.request('/webhook')}
  saveWebhook(url,enabled=true){return this.request('/webhook',{url,enabled},'PUT')}
  rotateWebhook(){return this.request('/webhook/rotate',{})}
  events(options={}){return this.request('/events/list',options)}
  retryEvent(id){return this.request('/events/'+encodeURIComponent(id)+'/retry',{})}
  // Provider-dependent routes return 501 until capabilities reports availability.
  transactionQuery(body){return this.request('/transactions/query',body)}
  transactions(body={}){return this.request('/transactions/list',body)}
  refund(body){return this.request('/refunds',body)}
  refundQuery(body){return this.request('/refunds/query',body)}
  bills(body){return this.request('/bills',body)}
}

// Pass the exact raw HTTP body (Buffer) before JSON parsing, and lower-case headers.
export function verifyWebhook(rawBody,headers,secret,now=Math.floor(Date.now()/1000)) {
  if(!Buffer.isBuffer(rawBody)||!secret) throw new Error('Raw body and webhook secret required');
  const stamp=String(headers['yirenfu-timestamp']||''),signature=String(headers['yirenfu-signature']||'');
  if(!/^\d{10,12}$/.test(stamp)||Math.abs(now-Number(stamp))>300||!/^v1=[a-f0-9]{64}$/.test(signature)) throw new Error('Invalid or expired webhook');
  const expected='v1='+createHmac('sha256',secret).update(stamp+'.').update(rawBody).digest('hex');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature))) throw new Error('Webhook signature mismatch');
  const event=JSON.parse(rawBody.toString('utf8'));
  if(!event.id||event.id!==headers['yirenfu-event-id']) throw new Error('Webhook event ID mismatch');
  return event;
}

// Read-only executable example: opcpay_api_key=... node index.mjs capabilities
// Resolve user IDs from your authenticated server session. Persist job/purchase IDs
// before writing. Network timeouts never justify a new consumption idempotency key.
if(process.argv[1]&&existsSync(process.argv[1])&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  const client=new opcpay(),command=process.argv[2]||'capabilities';
  if(!['capabilities','product'].includes(command)) throw new Error('Use capabilities or product');
  try {console.log(JSON.stringify(await client[command](),null,2))}
  catch(e){console.error(JSON.stringify({error:e.message,code:e.code,request_id:e.requestId}));process.exitCode=1}
}
