# opcpay

一人付为一人公司和独立开发者提供快捷收款接入。目前支持支付宝，正在考虑兼容微信支付。使用手机号和网址即可申请开通，支付宝一般会在 10 分钟内审核通过。

次数、积分等权益由支付宝管理。项目通过一人付查询权益，并在需要时核销：用户有可用额度时继续使用，额度不足时引导用户通过支付宝购买。开发者不必从头处理复杂的支付和权益管理逻辑，可以把精力放在自己的业务上。

这是 Node.js 服务端 SDK，需要 Node.js 18 或更高版本。

```bash
npm install opcpay
```

在服务端环境变量 `opcpay_api_key` 中配置项目 API Key，然后在服务端调用：

```js
import { opcpay } from 'opcpay';

const client = new opcpay();
const capabilities = await client.capabilities();
const product = await client.product();
```

默认 API 地址为 `https://ai6666.com/opcpay/api/pay/v1`，也可以在创建客户端时通过 `baseURL` 配置其他受信任的 HTTPS 地址。切勿将 API Key 或本 SDK 放进浏览器代码、公开仓库或日志中。

SDK 封装了套餐查询、购买入口、权益查询、核销和通知验签等接口。可用能力取决于项目配置和 `/capabilities` 的实际返回；部分交易、退款和账单接口尚未开放。购买入口或页面跳转不代表支付成功，应查询实际权益。业务用户 ID 必须来自服务端认证，购买和核销应持久化业务编号，并使用原编号安全重试。

完整接口说明和接入流程见 [一人付接入指南](https://ai6666.com/opcpay/docs/)。这个 SDK 只封装服务端接口，不包含完整收银页面、登录系统或业务交付逻辑。

## 开发与测试

```bash
git clone https://github.com/Yapie0/opcpay.git
cd opcpay
npm test
```

测试使用模拟接口，不需要真实 API Key。

## 开源许可

本项目采用 [MIT License](LICENSE)。源代码：[Yapie0/opcpay](https://github.com/Yapie0/opcpay)。
