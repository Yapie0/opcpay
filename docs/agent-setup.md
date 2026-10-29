# 交给 Codex 或 Claude Code 接入

**上线前先开通项目：[前往一人付官网](https://ai6666.com/opcpay/)**。登录后创建自己的项目，官网第 2 步会通过扫码或打开支付宝引导你进入支付宝商品页面，其中“授权信息”显示“授权平台：碳基圈”。完成支付宝套餐配置后，再在项目控制台申请 API Key。将 Key 配置到自己的服务端环境变量 `opcpay_api_key`，不要粘贴到聊天里。技能负责接入代码，不能代替项目开通。已有项目和 Key 可直接复用。

两种工具共用同一份 `skills/opcpay/SKILL.md`。安装只会把技能复制到你指定的项目，不修改项目支付代码、登录或全局设置。

从已克隆的仓库执行：

```bash
node scripts/install-skill.mjs --agent codex --project /你的项目路径
node scripts/install-skill.mjs --agent claude --project /你的项目路径
# 同时安装：
node scripts/install-skill.mjs --agent both --project /你的项目路径
```

npm 安装方式（opcpay 0.3.0+）：

```bash
npx --package=opcpay opcpay-skill --agent both --project /你的项目路径
```

Codex 的技能目录为 `.agents/skills/opcpay`，Claude Code 为 `.claude/skills/opcpay`。已有同名目录时安装器会停止；如确需更新，可加 `--force`，原文件会先保留到对应工具目录下的 `opcpay-skill-backups`，不会与正常技能一起加载。不覆盖符号链接。

在目标项目中启动新的 Codex／Claude Code 会话，发送：

> 使用 opcpay 技能，为当前项目接入一人付。复用已有登录、数据库和页面风格，展示项目实际套餐，实现购买入口、权益查询及适用的次数/积分核销。先使用模拟接口验证；API Key 通过服务端环境变量配置。

Codex 可以用 `$opcpay` 明确选技能；Claude Code 可以输入 `/opcpay`。是否自动发现取决于工具当前配置。技能读取项目技术栈再决定改哪些文件，不会强制把现有应用改成示例的 Node/SQLite 结构。

没有使用技能安装功能时，也可以直接将[仓库地址](https://github.com/Yapie0/opcpay)和[接入教程](quickstart.md)发给编程 Agent。不要把真实 API Key 粘贴进聊天、提交到 Git 或放在网页环境变量中。

官方技能说明：[Codex](https://developers.openai.com/codex/skills)、[Claude Code](https://code.claude.com/docs/en/skills)。
