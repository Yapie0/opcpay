# opcpay

一人付为一人公司和独立开发者提供快捷收款服务。**碳基圈是支付宝合作服务商。**目前支持支付宝，正在考虑兼容微信支付以及其他全球支付平台。

**[前往一人付官网，创建项目并申请 API Key →](https://ai6666.com/opcpay/)**

官网第 2 步扫码进入支付宝后，“授权信息”中会显示 **“授权平台：碳基圈”**。

<img src="https://raw.githubusercontent.com/Yapie0/opcpay/main/docs/assets/alipay-authorization.png" width="360" alt="支付宝商品页面显示授权平台为碳基圈">

## 开通收款

1. 在[一人付官网](https://ai6666.com/opcpay/)登录并创建项目，填写手机号和网址等资料。
2. 在第 2 步扫码进入支付宝，配置收费方式和套餐。
3. 在项目控制台申请 API Key，配置到自己服务端的 `opcpay_api_key` 环境变量。

使用手机号和网址即可申请，支付宝一般会在 10 分钟内审核通过。

## 快速接入

Node.js 18+，支持 TypeScript。API Key 仅在服务端使用。

```bash
npm install opcpay
```

```js
import { opcpay } from 'opcpay';

const pay = new opcpay();
const product = await pay.product();
const access = await pay.access('你的业务用户ID');
```

次数、积分等权益由支付宝管理。有可用额度时继续使用，额度不足时引导支付宝购买，开发者专注自己的业务。

| 功能 | 方法 |
|---|---|
| 获取套餐 | `product()` |
| 创建购买入口 | `purchase()` |
| 查询用户权益 | `access()` |
| 核销次数或积分 | `consume()` |

[接入教程](https://github.com/Yapie0/opcpay/blob/main/docs/quickstart.md) · [完整 API 文档](https://ai6666.com/opcpay/docs/) · [网页示例](https://github.com/Yapie0/opcpay/tree/main/examples/node)

## 让 AI 帮你接入

在你的项目中执行：

```bash
npx --package=opcpay opcpay-skill --agent both --project /你的项目路径
```

然后告诉 Codex 或 Claude Code：“使用 opcpay 技能，为当前项目接入一人付。”

[技能使用说明](https://github.com/Yapie0/opcpay/blob/main/docs/agent-setup.md)

## 许可

[MIT](LICENSE)
