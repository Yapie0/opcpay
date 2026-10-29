# 集成参考

## 现有包和示例

源码与完整 Node 示例：https://github.com/Yapie0/opcpay/tree/main/examples/node

```js
import { opcpay } from 'opcpay';
const pay = new opcpay(); // 服务端读取 opcpay_api_key
const [caps, product] = await Promise.all([pay.capabilities(), pay.product()]);
```

SDK 默认 Node.js >=18。零运行依赖；只读 CLI 可执行 `opcpay_api_key=... node node_modules/opcpay/index.mjs product`，不要将真实 Key 写进命令历史，实际使用环境变量配置。独立示例使用 Node >=22.13 的 SQLite；这是示例要求，不要求现有应用升级到同一框架。

## 关键 SDK 对应关系

| 操作 | SDK |
|---|---|
| 获取实际能力/套餐 | `capabilities()`、`product()` |
| 购买入口 | `purchase({userId,idempotencyKey,skuId,callbackURL})` |
| 恢复原购买入口 | `purchaseQuery(userId,idempotencyKey)`；结果是记录，原购买响应在 `response` 中 |
| 查询权益 | `access(userId, amount)` |
| 次数/积分正式核销 | `consume({userId,idempotencyKey,amount,reason})` |
| 查询原核销 | `consumption(userId,idempotencyKey)` |
| 通知验签 | `verifyWebhook(rawBody,headers,secret)` |

`purchaseQuery` 是购买入口记录，不是支付宝逐笔支付状态。普通复购不能靠余额增加反推某笔成交。`transactionQuery`、`transactions`、`refund`、`refundQuery`、`bills` 当前仅预留，服务返回501；微信尚未支持。

数量套餐使用 `billing_mode=QUANTITY`，按 `quota_unit=COUNT/POINT` 区分次数/积分。买断 `ONE_TIME`、时长 `ONE_TIME_DURATION` 均查询访问决策；时长不自动续费。一次真实核销的 `amount`、`reason`、用户、商品与编号均须保存，失败恢复不能改原参数。示例统一每份报告消耗1个单位，真实项目按服务端规则计算。

## 用户身份与记录

`userId` 取当前应用服务端登录账号的稳定内部ID，不用昵称、时间戳或每次随机字符串。SDK Key 已绑定收款项目，不要求用支付宝买家账号替代应用用户。

数据至少保存购买意图、使用意图与交付回执；`(user, action)` 和核销业务号有唯一约束。客户端可以提供一次操作的随机 action ID 用于网络重试，但由服务端绑定用户并生成、保存真正业务编号。

## 通知（项目需要时才接）

必须在 JSON 解析前保留原始请求 Buffer，使用真实的 `yirenfu-timestamp`、`yirenfu-signature` 和 `yirenfu-event-id` 请求头验签；这是当前服务协议，不能单方面改成 opcpay 前缀。SDK 检查 HMAC、5分钟窗口和事件ID一致性；应用另外持久化 event.id 去重，并容忍乱序。通知是权益或核销事件，不是逐笔支付成功通知。

## 验证重点

- 调整页面/回跳URL、伪造用户或价格不能绕过服务端规则。
- 相同业务操作并发、网络超时及进程重启不重复扣减/交付。
- UNKNOWN/PROCESSING 不交付；核销明确失败才允许用户开始一个新操作。
- 已确认核销后交付失败，恢复同一交付记录。
- 测试模式和真实模式清楚区分；真实模式不提供模拟付款入口。
