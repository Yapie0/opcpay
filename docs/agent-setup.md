# 使用 Codex 或 Claude Code 接入

先在[一人付官网](https://ai6666.com/opcpay/)创建项目，按指引扫码配置支付宝套餐并申请 API Key。将 Key 配置到自己的服务端环境变量 `opcpay_api_key`。

在你的项目中安装技能：

```bash
npx --package=opcpay opcpay-skill --agent both --project /你的项目路径
```

然后告诉 Codex 或 Claude Code：

> 使用 opcpay 技能，为当前项目接入一人付，复用已有登录和页面。

也可以用 `$opcpay`（Codex）或 `/opcpay`（Claude Code）调用。

只安装到一种工具时，将 `both` 改为 `codex` 或 `claude`。更新已有技能可加 `--force`，安装器会保留原文件备份。

[接入教程](quickstart.md) · [完整 API 文档](https://ai6666.com/opcpay/docs/)
