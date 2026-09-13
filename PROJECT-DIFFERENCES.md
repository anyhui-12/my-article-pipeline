# `my-article-pipeline` 与 `node-agent-pipeline` 差异说明

更新时间：2026-08-25

## 1. 文档目的

本文档总结两个项目的关系、架构差异、模块映射和使用方式差异。

- 原项目：`/Users/xuhui/Documents/study/node-agent-pipeline`
- 新项目：`/Users/xuhui/Documents/study/my-article-pipeline`
- 参考文章：[Node 搭 Agent 实战：用 LangChain.js v1 手把手跑通公众号流水线](https://mp.weixin.qq.com/s/yGL-i1N1DvrM8DNdFN4blw)

结论先行：`my-article-pipeline` 不是重新实现一套 Agent，而是在原项目的 ReAct + Harness + SubAgent + Skill 基础上，去掉对 ExoMind 私有服务的强绑定，增加本地素材管理、可切换 LLM、微信公众号官方 API 发布、封面管理、文章库和 Web 控制台，使其从“架构演示 Demo”变成“个人公众号生产工具”。

## 2. 总体定位差异

| 维度 | `node-agent-pipeline` | `my-article-pipeline` |
|---|---|---|
| 主要目标 | 演示 Node Agent 的五块核心零件如何组合 | 支持个人持续生产、编辑、管理和发布公众号文章 |
| 文章生产 | 外部知识库取材 → 写作 → 排版 | 本地探讨笔记/素材 → 写作 → 排版，可选外部 MCP 补充 |
| 外部服务依赖 | 强依赖 `exomind` CLI、ExoMind MCP 和其发布链路 | 默认不依赖 ExoMind；MCP 为可选扩展 |
| 发布方式 | 通过 ExoMind 注入正文并调用其微信发布命令 | 通过微信公众号官方 API 直连发布 |
| 使用入口 | Node CLI | Node CLI + Node HTTP API + Web 控制台 |
| 输出管理 | `output/<时间戳>.md/.html` 平铺文件 | `output/<文章 ID>/article.md/.html/readme.log` 文章文件夹 |
| 模型配置 | 固定 DeepSeek V4 Flash/Pro | DeepSeek、Moonshot、任意 OpenAI 兼容服务可配置 |
| 校验策略 | 默认强制 `## 小结` 和至少 600 字，并首轮强制精修 | 规则环境变量化，默认只校验字数，不强制固定小节 |
| 产品化能力 | 基础流水线 | 文章库、编辑、封面、图片、设置、投递记录和多账号 |

## 3. 共同保留的核心架构

两个项目的核心执行链路一致：

```text
输入选题
  → input_guardrail
  → 主 ReAct Agent
  → validator
       ├─ 不通过：把当前草稿和反馈交给 refine 节点修订
       └─ 通过：output_guardrail
  → Markdown + 微信内联样式 HTML
  → 可选发布
```

### 3.1 ReAct Agent

两个项目都使用 LangChain.js v1 的 `createAgent`，而不是已经弃用的 `createReactAgent`。主控 Agent 使用较快的模型，负责决定何时调用取材、写作和排版工具。

对应文件：

- 原项目：[src/agents/reactAgent.ts](/Users/xuhui/Documents/study/node-agent-pipeline/src/agents/reactAgent.ts)
- 新项目：[src/agents/reactAgent.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/agents/reactAgent.ts)

### 3.2 写作 SubAgent

两个项目都把独立的写作 Agent 通过 `tool()` 包装为 `delegate_to_writer`。主控只需要传入选题/大纲和素材，写作 Agent 返回完整 Markdown，从而隔离长文本写作上下文。

新项目主要调整了写作定位：从“技术长文写手”改为“把探讨结论写成自己的理解”，强调第一人称、讲人话和自然组织结构。

对应文件：[src/agents/writerAgent.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/agents/writerAgent.ts)

### 3.3 HarnessAgent

两个项目都使用外层 `StateGraph` 和 `MemorySaver`：

- `input_guardrail`：检查选题是否合法
- `react`：调用主 ReAct Agent
- `validator`：对文章做确定性规则校验
- `output_guardrail`：检查 HTML 是否有效

内层 Agent 不挂第二个 checkpointer，避免状态重复管理。

对应目录：[src/harness](/Users/xuhui/Documents/study/my-article-pipeline/src/harness)

## 4. 关键差异详解

### 4.1 取材方式：ExoMind 知识库改为本地素材优先

#### 原项目

原项目启动时固定创建 `exomind mcp` 子进程，通过 MCP 动态发现 `search`、`query`、`entity`、`relations`、`ingest`、`stats` 等工具。主控 Agent 从远端知识库检索素材。

这使 Demo 能展示 MCP，但运行前必须满足：

1. 安装 `exomind` CLI；
2. 执行 `exomind login`；
3. 具备 ExoMind 服务访问条件。

#### 新项目

新项目默认采用本地素材笔记：

- `materials/` 目录中的 `.md`、`.txt`、`.markdown` 文件；
- CLI 的 `--notes <文件>` 参数；
- Web 界面传入的内联探讨笔记；
- Agent 运行中可按需调用 `list_materials`、`read_material`。

外部 MCP 改成可选项，仅当设置 `MCP_COMMAND` 时启动，并通过 `MCP_ARGS` 传参。

对应文件：

- 新项目素材工具：[src/tools/materials.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/tools/materials.ts)
- 新项目 MCP：[src/tools/mcp.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/tools/mcp.ts)
- 配置：[src/config.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/config.ts)

#### 影响

- 优点：不依赖私有知识库，素材内容可控，适合“先和 AI 探讨，再沉淀成文章”的工作流。
- 取舍：默认没有远端检索能力；需要联网检索时必须额外配置 MCP server。

### 4.2 LLM：固定 DeepSeek 改为供应商预设 + 环境变量

#### 原项目

模型和地址基本固定：

- 主控：`deepseek-v4-flash`
- 写作：`deepseek-v4-pro`
- Base URL：`https://api.deepseek.com/v1`
- Key：`DEEPSEEK_API_KEY`

#### 新项目

新增 `LLM_PROVIDER` 和统一的 `LLM_API_KEY`，内置三类配置：

| Provider | 主控模型 | 写作模型 |
|---|---|---|
| `deepseek` | `deepseek-v4-flash` | `deepseek-v4-pro` |
| `moonshot` | `kimi-k2.5` | `kimi-k2.6` |
| `custom` | `LLM_MODEL_FLASH` | `LLM_MODEL_PRO` |

Base URL、模型名和 Key 都可以通过 `.env` 覆盖，同时兼容 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY` 作为 Key 别名。

对应文件：[src/llm.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/llm.ts)、[src/config.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/config.ts)

### 4.3 校验策略：固定演示规则改为可配置规则

#### 原项目默认行为

- 文章至少 600 字；
- 必须包含 `## 小结`；
- 首轮无条件强制精修一次，用于稳定演示 Harness 回退；
- 最多重试两次。

#### 新项目默认行为

- 最少字数由 `MIN_ARTICLE_LEN` 配置，默认 600；
- 必需小节由 `REQUIRED_SECTIONS` 配置，默认空值；
- 首轮强制精修由 `FORCE_FIRST_REFINE=1` 开启，默认关闭；
- 最大重试次数由 `MAX_RETRIES` 配置，默认 2。

此外，入口选题长度从原来的 4～200 字放宽为 2～200 字。

对应文件：[src/harness/nodes.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/harness/nodes.ts)

#### 影响

新项目更适合不同主题和个人写作习惯，但默认结构约束变弱。如果希望保持原项目的固定文章结构，可以设置：

```dotenv
REQUIRED_SECTIONS=## 小结
FORCE_FIRST_REFINE=1
```

### 4.4 发布：ExoMind 中转改为 Publisher 抽象层 + 微信官方 API

#### 原项目

原项目的 `publish_wechat` 依赖 ExoMind 完成两步：

1. 通过 HTTP 注入 Markdown 正文；
2. 调用 `exomind draft wechat` 完成封面生成和微信公众号投递。

#### 新项目

新项目将发布拆成三层：

```text
publish_article 工具
  → publishArticle()
  → Publisher Registry
  → WechatPublisher
  → 微信官方 API
```

当前微信链路包括：

1. 按账号读取 `AppID/AppSecret`；
2. 获取并缓存 `access_token`；
3. 使用永久素材接口上传封面；
4. 将正文图片上传到微信图床并替换本地引用；
5. 调用草稿接口创建草稿；
6. 写入 `output/deliveries.jsonl` 投递记录。

对应文件：

- 发布工具：[src/tools/publish.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/tools/publish.ts)
- 发布接口：[src/publishers/types.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/publishers/types.ts)
- 平台注册：[src/publishers/registry.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/publishers/registry.ts)
- 微信实现：[src/publishers/wechat.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/publishers/wechat.ts)

#### 影响

- 优点：不再依赖 ExoMind，微信发布链路更直接；未来新增平台只需实现 `Publisher` 并注册。
- 取舍：需要自行维护微信公众号 `AppID/AppSecret`、公网 IP 白名单和封面配置。

### 4.5 CLI：从单一生成命令扩展为两种模式

#### 原项目

```bash
node src/index.ts "选题"
```

如果设置 `PUBLISH_ACCOUNT`，则在 Agent 工具中追加发布步骤。

#### 新项目

完整生产模式：

```bash
node src/index.ts "选题" [--notes 笔记.md] [--publish 账号] [--platform wechat]
```

直发已有 Markdown：

```bash
node src/index.ts --publish-file article.md --title "标题" --account 账号
```

直发模式不启动 Agent，也不需要 LLM API Key，适合重新投递或发布手工编辑后的文章。

入口文件：[src/index.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/index.ts)

### 4.6 输出管理：平铺文件改为文章文件夹

#### 原项目

```text
output/<时间戳>.md
output/<时间戳>.html
```

#### 新项目

```text
output/<文章 ID>/
├── article.md
├── article.html
├── readme.log
├── cover.png       # 可选
└── images/         # 可选正文插图
```

新项目的 `articles.ts` 负责创建、列表、读取、编辑、重排版、删除、封面和图片管理。服务启动时还会把旧版平铺产出迁移为文章文件夹。

对应文件：[src/articles.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/articles.ts)

### 4.7 新增 Web 控制台和 HTTP API

原项目没有 Web 层，新项目新增：

- `src/server.ts`：Node 原生 HTTP 服务；
- `web/src/App.tsx`：文章生产台界面；
- `web/src/api.ts`：前端 API 客户端；
- `web/src/styles.css`：界面样式。

当前 Web 能力包括：

- 发起流水线任务并通过 SSE 实时查看日志；
- 输入选题和探讨笔记；
- 上传、浏览和读取素材；
- 查看、编辑、添加和删除文章；
- Markdown 与 HTML 预览；
- 上传/选择/自动生成封面；
- 上传正文图片；
- 选择公众号账号并投递；
- 查看投递记录；
- 图形化修改部分 `.env` 设置。

对应文件：[src/server.ts](/Users/xuhui/Documents/study/my-article-pipeline/src/server.ts)、[web/src/App.tsx](/Users/xuhui/Documents/study/my-article-pipeline/web/src/App.tsx)

### 4.8 新增封面和图片能力

原项目的封面主要由 ExoMind 发布链路负责；新项目将封面管理独立出来：

- `covers/`：封面库；
- `src/tools/imagegen.ts`：调用 OpenAI 兼容生图接口；
- `src/tools/coverDesign.ts`：根据文章内容生成封面画面描述；
- `src/articles.ts`：将封面复制到文章目录；
- `src/publishers/wechat.ts`：按文件哈希缓存微信永久素材。

支持通义万相、豆包 Seedream、智谱 CogView、OpenAI 等兼容接口，具体由 `IMAGE_BASE_URL`、`IMAGE_MODEL` 和 `IMAGE_API_KEY` 配置。

## 5. 文件映射表

| 原项目 | 新项目 | 变化 |
|---|---|---|
| `src/agents/reactAgent.ts` | `src/agents/reactAgent.ts` | 保留 ReAct；工具改为本地素材、可选 MCP、通用发布工具 |
| `src/agents/writerAgent.ts` | `src/agents/writerAgent.ts` | 保留 SubAgent；改写提示词，适配探讨笔记和个人表达 |
| `src/harness/*` | `src/harness/*` | 保留 StateGraph；校验规则改为环境变量驱动 |
| `src/llm.ts` | `src/llm.ts` | 固定 DeepSeek 改为多供应商/自定义兼容接口 |
| `src/tools/mcp.ts` | `src/tools/mcp.ts` | ExoMind 专用改为通用可选 MCP |
| 无 | `src/tools/materials.ts` | 新增本地素材工具 |
| `src/tools/publishWechat.ts` | `src/tools/publish.ts` + `src/publishers/*` | ExoMind 发布改为 Publisher 抽象和微信官方 API |
| 无 | `src/articles.ts` | 新增文章库和文章目录管理 |
| 无 | `src/server.ts` + `web/` | 新增 HTTP API 和 Web 控制台 |
| 无 | `src/settings.ts` | 新增图形化配置持久化 |
| 无 | `src/tools/imagegen.ts`、`coverDesign.ts` | 新增 AI 封面生成 |
| `output/<ts>.md/.html` | `output/<id>/article.*` | 输出从平铺文件改为可管理的文章实体 |

## 6. 运行与部署依赖差异

### 原项目依赖

- Node.js 原生运行 TypeScript；
- DeepSeek API Key；
- `exomind` CLI；
- ExoMind 登录凭证；
- 如需发布，还需要 ExoMind 的微信投递能力。

### 新项目依赖

- Node.js；
- 至少一个 OpenAI 兼容 LLM API Key；
- 默认只需要本地 `materials/` 和 `output/`；
- 如需微信发布，需要公众号 AppID/AppSecret、IP 白名单和封面；
- 如需 AI 封面，需要额外配置生图 API；
- 如需远程取材，需要额外配置 MCP server。

新项目因此降低了默认启动门槛，但发布和生图相关配置从 ExoMind 内部能力转移到了项目自身。

## 7. 设计取舍总结

| 新项目改造 | 获得的能力 | 引入的成本/注意事项 |
|---|---|---|
| 本地素材优先 | 内容来源可控、适合个人知识沉淀 | 默认没有远端搜索 |
| 可选 MCP | 可以按需接入搜索、知识库等服务 | 需要自行维护 MCP server |
| LLM 可切换 | 降低单一模型绑定 | 不同模型的工具调用和输出质量可能不同 |
| 官方微信 API | 发布链路直接、可控 | 需要 AppID/AppSecret、IP 白名单和永久素材管理 |
| Publisher 抽象 | 可扩展多平台 | 当前实际只注册了微信平台 |
| 文章文件夹 | 支持编辑、图片、封面、日志 | 文件结构和管理逻辑更复杂 |
| Web 控制台 | 更适合日常使用 | 增加 HTTP 服务、配置写入和接口安全边界 |
| 校验配置化 | 适配不同文章类型 | 默认结构约束弱，需要按需配置规则 |

## 8. 当前验证状态

- `my-article-pipeline` 的 `pnpm typecheck` 已通过。
- 当前项目已有生成文章、HTML、日志和封面样例，说明生成与文章落盘链路已运行过。
- 原项目的本地依赖环境中未找到 `tsc` 命令，因此本次未能完成原项目的类型检查；这不等同于源码本身存在类型错误。

## 9. 一句话结论

`node-agent-pipeline` 重点回答“如何用 LangChain.js/LangGraph.js 组装一个具备 ReAct、Harness、MCP、SubAgent 和 Skill 的公众号 Agent”；`my-article-pipeline` 重点回答“如何把这套 Agent 架构改造成一个不依赖私有知识库、支持本地素材、微信直投、封面管理和 Web 操作的个人文章生产系统”。
