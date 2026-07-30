# SuperPeanut

SuperPeanut 是一个侧载式 Chrome Extension，用于在 LinkedIn 候选人页面读取公开履历、维护 HC，并由 Codex Agent 生成中文招聘匹配报告。

## 功能

- LinkedIn 页面常驻 Peanut 与 Mochi 双狗入口
- 两只狗可整组拖动并记住位置，面板从宠物左侧展开
- 匹配 Loading 中 Peanut 会与白色卷毛狗 Mochi 一起奔跑
- 读取候选人当前职位、地点、工作经历与教育背景
- 基于候选人背景路由到一个公司专属 Skill，再用该公司完整 HC/JD 生成单一最佳岗位报告
- HC 支持任意栏位结构的 XLSX Agent 合并导入、粘贴新增、Company、编辑与删除
- HC 可按日期、优先级、大区和产品线筛选
- 查询记录保存候选人快照、LinkedIn 链接与历史报告
- Peanut 对话支持当前候选人上下文及 CV 上传
- Railway Postgres 按匿名用户隔离 HC、历史匹配和对话数据
- 每家公司独立保存匹配 Skill；Skill 第一部分为公司介绍，随后才执行该公司的完整匹配规则

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

- 导入 XLSX；浏览器读取所有 Sheet 的原始储存格，再由 Peanut 识别标题列与任意语言栏名，统一转换为含 Company 的标准 HC。分组式表格中只在首行填写的公司会在同一连续岗位区块向下继承。重复上传会按公司、岗位及标准化地点／完整 JD 更新现有记录，新岗位才会新增，未出现在新文件中的旧 HC 会保留。
- 直接粘贴一整段岗位需求，由 Peanut 自动整理为结构化 HC。
- 查看、编辑、删除及按产品线 Tag 筛选。

Company 是导入与匹配的必要条件。单条岗位缺少公司时不会保存；Excel 中任意岗位缺少公司时整批拒绝且不写入 HC 库。首次保存某家公司时，Peanut 会依据该公司的完整 HC/JD 生成专属匹配 Skill；未明确提供的禁招公司、门槛或政策不会被模型补写。三一重工使用内置的完整 SANY Skill。

## Agent Broker

`agent/broker.mjs` 使用本机已登录的 Codex CLI，提供：

- `POST /match`
- `POST /chat`
- `POST /resume`
- `POST /role`
- `POST /roles/import`
- `POST /skills/generate`

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
- `company_skills`

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
