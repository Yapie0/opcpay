# opcpay

一人付为一人公司和独立开发者提供快捷收款接入。目前支持支付宝，正在考虑兼容微信支付以及其他全球支付平台。使用手机号和网址即可申请开通，支付宝一般会在 10 分钟内审核通过。

次数、积分等权益由支付宝管理。项目通过一人付查询权益，并在需要时核销：用户有可用额度时继续使用，额度不足时引导用户通过支付宝购买。开发者不必从头处理复杂的支付和权益管理逻辑，可以把精力放在自己的业务上。

这是 Node.js 服务端 SDK，需要 Node.js 18 或更高版本，包含 TypeScript 类型声明。完整网页示例需要 Node.js 22.13+。

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

完整接口说明和接入流程见 [一人付接入指南](https://ai6666.com/opcpay/docs/)。SDK 提供服务端接口调用；本仓库的完整示例演示网页接入流程。接入自己的产品时复用已有登录，并替换为实际业务交付逻辑。

## 先跑完整网页示例

```bash
git clone https://github.com/Yapie0/opcpay.git
cd opcpay/examples/node
cp .env.example .env
npm ci
npm start
```

打开 http://localhost:3000，使用示例密码 `local-demo-password` 登录，选择套餐、模拟付款，再生成报告。默认模拟模式不发生真实付款；真实模式读取项目实际套餐、价格与权益。示例使用 SQLite 持久化业务编号，支持中断恢复；同一次操作不重复扣减或交付。

[完整接入教程](https://github.com/Yapie0/opcpay/blob/main/docs/quickstart.md)说明真实模式配置、用户身份接入和业务替换位置。[示例源码](https://github.com/Yapie0/opcpay/tree/main/examples/node)包含网页、服务端和测试。

## 让 AI 帮你接入

仓库包含可安装到 Codex／Claude Code 的 opcpay 技能。在需要接入的项目目录执行：

```bash
npx --package=opcpay opcpay-skill --agent both --project /你的项目路径
```

然后告诉编程 Agent：“使用 opcpay 技能，复用当前项目的登录、数据库和页面接入一人付。”详见 [技能安装与使用](https://github.com/Yapie0/opcpay/blob/main/docs/agent-setup.md)。

## 开发与测试

```bash
npm ci
npm test
npm run test:types
npm ci --prefix examples/node
npm run test:example
```

测试使用模拟接口，不需要真实 API Key。技能安装器与 SDK 支持 Node 18+；示例测试使用 Node 22.13+ 的内置 SQLite。浏览器回归可选运行 `python3 test/browser_example.py`、`python3 test/browser_failures.py` 和 `python3 test/browser_modes.py`（需要 Playwright 及 Chromium/WebKit）。TLS 测试另需 OpenSSL。完整范围和边界见[用户视角验收记录](https://github.com/Yapie0/opcpay/blob/main/docs/user-acceptance.md)。

## 开源许可

本项目采用 [MIT License](LICENSE)。源代码：[Yapie0/opcpay](https://github.com/Yapie0/opcpay)。
