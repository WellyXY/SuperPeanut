# SuperPeanut

SuperPeanut 是一个侧载式 Chrome Extension，用于在 LinkedIn 候选人页面读取公开履历、维护 HC，并由 Codex Agent 生成中文招聘匹配报告。

## 功能

- LinkedIn 页面常驻 Peanut 与 Mochi 双狗入口
- 两只狗可整组拖动并记住位置，面板从宠物左侧展开
- 匹配 Loading 中 Peanut 会与白色卷毛狗 Mochi 一起奔跑
- 读取候选人当前职位、地点、工作经历与教育背景
- 在 LinkedIn People Search 当前页自动初筛可见候选人，并标注最佳 HC 与初筛分数
- 基于完整 HC/JD 生成单一最佳岗位报告
- HC 支持 XLSX 导入、Agent 粘贴新增、编辑与删除
- HC 可按日期、优先级、大区和产品线筛选
- 查询记录保存候选人快照、LinkedIn 链接与历史报告
- Peanut 对话支持当前候选人上下文及 CV 上传
- Railway Postgres 按匿名用户隔离 HC、历史匹配和对话数据

首次安装不会预载任何 HC、候选人记录或对话。

## 安装 Extension

1. 下载或克隆本仓库。
2. 打开 Chrome 的 `chrome://extensions`。
3. 开启「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择仓库根目录。
6. 打开 LinkedIn 页面，点击右下角 Peanut。

更新 Extension 后，需要在 `chrome://extensions` 点击重新加载，并刷新已经打开的 LinkedIn 页面。

## HC 数据

在「HC 库」中可以：

- 导入 XLSX；支持 `岗位名称`、`国家/城市`、`事业部/产品线`、`职能`、`大区`、`优先级`、`HC`、`备注/JD`、`招聘负责人`、`更新日期` 等列。
- 直接粘贴一整段岗位需求，由 Peanut 自动整理为结构化 HC。
- 查看、编辑、删除及按产品线 Tag 筛选。

## Agent Broker

`agent/broker.mjs` 使用本机已登录的 Codex CLI，提供：

- `POST /match`
- `POST /chat`
- `POST /resume`
- `POST /role`

本机启动：

```bash
node agent/broker.mjs
```

Extension 当前通过配置的 Cloudflare Tunnel 域名访问 broker。自行部署时，请修改 `content.js` 中的 `AGENT_ENDPOINT`。

## Railway Storage API

`storage-api/server.mjs` 使用 PostgreSQL，主要表为：

- `users`
- `hcs`
- `match_history`
- `agent_messages`

启动所需环境变量：

```bash
DATABASE_URL=postgresql://...
PORT=3000
```

运行：

```bash
cd storage-api
npm install
npm start
```

自行部署时，请修改 `lib/storage.js` 中的 `STORAGE_ENDPOINT`，并同步修改 `manifest.json` 的 `host_permissions`。

## 隐私与合规

结构化候选人快照、报告、HC 与对话会发送到配置的 Agent 和 Railway 服务。原始 LinkedIn Network response 与原始 CV 不会由 broker 持久保存。

使用者需要遵守 LinkedIn 条款及所在地的招聘、隐私与劳动法规。年龄、性别、国籍、族裔、残障等受保护属性不得用于自动化招聘决策。
