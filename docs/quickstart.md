# 接入一人付

## 1. 开通项目

前往[一人付官网](https://ai6666.com/opcpay/)，创建项目；在第 2 步扫码进入支付宝，配置收费方式与套餐，再在项目控制台申请 API Key。

支付宝商品页面的“授权信息”显示“授权平台：碳基圈”。[查看截图](assets/alipay-authorization.png)。

## 2. 安装 SDK

需要 Node.js 18+，支持 TypeScript。

```bash
npm install opcpay
```

在自己的服务端配置环境变量 `opcpay_api_key`，填入项目的 API Key。

```js
import { opcpay } from 'opcpay';

const pay = new opcpay();
const product = await pay.product();
```

## 3. 接入业务

用户 ID 使用你自己的登录用户 ID；套餐从 `product()` 返回的 `charging_options` 中选择。

**创建购买入口：**

```js
const purchase = await pay.purchase({
  userId: '你的业务用户ID',
  idempotencyKey: '本次购买的业务编号',
  skuId: '用户选择的sku_id',
});
```

将返回的 `purchase_url` 展示为链接或二维码，引导用户通过支付宝购买。

**查询权益：**

```js
const access = await pay.access('你的业务用户ID');
```

买断和时长套餐在 `access_granted=true` 且 `decision=ALLOW` 时开放服务；次数和积分在使用服务时核销：

```js
const result = await pay.consume({
  userId: '你的业务用户ID',
  idempotencyKey: '本次使用的业务编号',
  amount: 1,
  reason: '使用服务',
});
```

购买后查询实际权益；次数或积分核销在 `status=SUCCEEDED`、`confirmed=true` 且请求号、数量与单位匹配时交付业务。同一操作保存并复用原业务编号，重试不换号。

[完整 API 文档](https://ai6666.com/opcpay/docs/) · [网页示例](../examples/node/README.md) · [Codex / Claude Code 接入](agent-setup.md)
