<p align="center">
  <a href="https://ai6666.com/opcpay/">
    <img src="https://raw.githubusercontent.com/Yapie0/opcpay/main/docs/assets/opcpay-logo.png" width="72" height="72" alt="一人付">
  </a>
</p>

<h1 align="center">opcpay</h1>

<p align="center"><strong>一人付 · 为一人公司接入支付</strong></p>
<p align="center">由支付宝合作服务商 <strong>碳基圈</strong> 提供</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opcpay"><img src="https://img.shields.io/npm/v/opcpay?style=flat-square&amp;color=E34C3B" alt="npm version"></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/TypeScript-ready-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript">
  <a href="https://github.com/Yapie0/opcpay/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-30363D?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://ai6666.com/opcpay/"><strong>立即开通 →</strong></a>
  &nbsp;·&nbsp;
  <a href="https://ai6666.com/opcpay/docs/">API 文档</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Yapie0/opcpay/tree/main/examples/node">网页示例</a>
  &nbsp;·&nbsp;
  <a href="#让-ai-帮你接入">AI 接入</a>
</p>

---

次数、积分等权益由支付宝管理。有额度时继续使用，额度不足时引导支付宝购买，开发者专注自己的业务。目前支持支付宝，正在考虑兼容微信支付以及其他全球支付平台。

## 支付宝授权

官网第 2 步扫码进入支付宝后，“授权信息”中会显示 **“授权平台：碳基圈”**。

<p align="center">
  <img src="https://raw.githubusercontent.com/Yapie0/opcpay/main/docs/assets/alipay-authorization.png" width="300" alt="支付宝商品页面显示授权平台为碳基圈">
</p>

## 三步开通收款

| 创建项目 | 支付宝配置 | 申请 API Key |
| :--- | :--- | :--- |
| [创建项目](https://ai6666.com/opcpay/)，填写手机号和网址。 | 扫码进入支付宝，设置收费方式与套餐。 | 在项目控制台申请，配置到自己的服务端。 |

使用手机号和网址即可申请，支付宝一般会在 10 分钟内审核通过。

## 快速接入

在服务端设置环境变量 `opcpay_api_key`，然后安装：

```bash
npm install opcpay
```

```js
import { opcpay } from 'opcpay';

const pay = new opcpay();
const product = await pay.product();
const access = await pay.access('你的业务用户ID');
```

| 功能 | 方法 |
| :--- | :--- |
| 获取套餐 | `product()` |
| 创建购买入口 | `purchase()` |
| 查询用户权益 | `access()` |
| 核销次数或积分 | `consume()` |

[接入教程 →](https://github.com/Yapie0/opcpay/blob/main/docs/quickstart.md) &nbsp; [完整 API 文档 →](https://ai6666.com/opcpay/docs/)

## 让 AI 帮你接入

在你的项目中安装 Codex / Claude Code 接入技能：

```bash
npx --package=opcpay opcpay-skill --agent both --project /你的项目路径
```

然后发送：

> 使用 opcpay 技能，为当前项目接入一人付。

[技能使用说明 →](https://github.com/Yapie0/opcpay/blob/main/docs/agent-setup.md)

---

<p align="center">
  <a href="https://ai6666.com/opcpay/">一人付官网</a>
  &nbsp;·&nbsp;
  <a href="https://ai6666.com/opcpay/docs/">接入文档</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Yapie0/opcpay/blob/main/LICENSE">MIT License</a>
</p>
