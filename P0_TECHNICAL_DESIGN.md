# DSH Telegram Relay P0 技术方案

## 1. 目标

在本机运行 DeepSeek Harness 后，用户可以通过个人 Telegram Bot 与 DSH Agent 连续对话。

```text
Telegram 私聊消息
  -> Telegram Bot API getUpdates
  -> DSH Telegram Relay
  -> DSH Agent
  -> 模型及已启用工具
  -> Telegram Bot API sendMessage
  -> Telegram 私聊
```

P0 只交付文本对话闭环，不提供主动通知和定时任务。

## 2. P0 范围

### 2.1 包含

- 通过长轮询接收 Telegram 文本消息。
- 仅允许配置在 allowlist 中的私聊访问 DSH。
- 直接使用 Telegram `chat_id` 的字符串形式作为 DSH Session ID。
- 同一私聊持续复用同一个 DSH Session。
- 重启后由 DSH Session 持久化恢复对话上下文。
- 将当前 DSH turn 的最终文本回答发送回 Telegram。
- 同一 chat 的消息严格串行执行。
- Telegram 网络错误重试、Update 去重和优雅停机。
- 配置说明、基础单元测试和本地运行示例。

### 2.2 不包含

- `telegram_send_message` 模型工具。
- Schedule、定时提醒和主动通知。
- Webhook、公网服务和云部署。
- 群聊、频道、图片、文件、语音和消息编辑。
- `/new` 等 Bot 命令。
- 多 Bot、多租户或管理后台。
- Telegram 与 DSH Session 的额外映射数据库。

## 3. 核心设计决定

### 3.1 独立插件仓库

实现保留在 `DSH-Telegram-Relay`，不修改 `deepseek-harness/packages`。插件通过 `dsh.bundle` 和 `cordis.patch.yml` 安装到 DSH profile。

### 3.2 使用 polling

插件调用 Telegram Bot API `getUpdates` 长轮询，不监听本地端口，也不需要公网地址。

### 3.3 直接使用 chat_id

```ts
const sessionId = SessionId(String(message.chat.id))
```

插件只负责确定消息属于哪个 Session。聊天记录、工具调用记录、上下文裁剪和 Session 文件均由 DSH 管理。

P0 假设一个 DSH 数据目录只运行一个 Telegram Bot。多个 Bot 共用同一数据目录时，纯 `chat_id` 可能发生 Session ID 冲突，该场景不在 P0 范围内。

### 3.4 使用 DSH 默认模型

创建新 Agent 时读取：

```ts
ctx.agentDefaultModel.currentSelection()
```

Telegram 入口与 Web 入口使用同一套默认模型设置，插件不再单独维护 provider 和 model 配置。

### 3.5 使用成熟 Telegram 客户端

使用 `grammy` 访问 Telegram Bot API，避免自行维护 Bot API 请求类型和轮询协议。轮询的启动、停止和异常恢复仍由插件负责，并挂入 Cordis 生命周期。

## 4. 目录规划

```text
DSH-Telegram-Relay/
├── src/
│   ├── index.ts              # Cordis 插件入口和配置校验
│   ├── telegram-client.ts    # getMe、getUpdates、sendMessage
│   ├── polling-loop.ts       # 长轮询、offset 和重试
│   ├── chat-queue.ts         # per-chat 串行队列
│   ├── agent-manager.ts      # Agent 创建、恢复和缓存
│   ├── turn-relay.ts         # 提交用户消息并提取本 turn 回答
│   ├── reply.ts              # 文本提取和 Telegram 分片
│   └── config.ts             # Config 类型与 Schema
├── tests/
│   ├── config.spec.ts
│   ├── polling-loop.spec.ts
│   ├── agent-manager.spec.ts
│   └── turn-relay.spec.ts
├── examples/
│   └── telegram-bridge/
│       └── cordis.patch.yml
├── cordis.patch.yml
├── package.json
├── tsconfig.json
└── README.md
```

构建产物放入 `lib/`，npm 包只发布运行所需文件。

## 5. 插件依赖

插件声明以下 Cordis 硬依赖：

```ts
export const inject = [
  'agents',
  'agentDefaultModel',
  'sessionPersistence',
]
```

职责如下：

| 服务 | 用途 |
| --- | --- |
| `agents` | 创建、恢复和驱动 DSH Agent |
| `agentDefaultModel` | 读取当前默认模型选择 |
| `sessionPersistence` | 判断指定 Session 是否已经存在 |

所有长轮询、重试等待和资源释放都由 `ctx.effect()` 管理。插件卸载时 Abort 当前请求，停止接收新消息，并等待已经开始的消息处理结束。

## 6. 配置

配置示例：

```yaml
- id: telegram-relay
  name: dsh-telegram-relay
  config:
    tokenEnv: TELEGRAM_BOT_TOKEN
    allowedChatIds:
      - "123456789"
    pollTimeoutSeconds: 30
    retryMinMilliseconds: 1000
    retryMaxMilliseconds: 30000
    stateFile: !!js dshHomePath('telegram-relay/state.json')
```

配置规则：

- `tokenEnv` 必填，值是环境变量名，不是 Bot Token。
- `allowedChatIds` 必填、不能为空、不可重复。
- chat ID 按十进制字符串保存，避免 JavaScript 数值精度和 YAML 类型差异。
- timeout 和 retry 范围在插件加载时校验。
- `stateFile` 只保存 polling offset，不保存聊天内容和 Bot Token。
- 缺少环境变量、空 allowlist 或非法配置时，插件加载失败，不静默降级。

启动方式：

```sh
export TELEGRAM_BOT_TOKEN='<BotFather 返回的 token>'

pnpm --dir <workspace>/deepseek-harness \
  dsh plugin --profile web add \
  <workspace>/DSH-Telegram-Relay

pnpm --dir <workspace>/deepseek-harness dsh web
```

## 7. 启动流程

1. Cordis 等待三个依赖服务可用。
2. 插件校验配置和 `tokenEnv`。
3. 使用 Bot Token 调用 `getMe`，确认凭证有效。
4. 读取本地 polling offset。
5. 创建 AbortController 和 per-chat 队列。
6. 启动 `getUpdates` 长轮询。
7. 插件卸载时停止 polling，并释放 Agent 引用和队列。

Token 只存在于进程内存和 Telegram HTTPS 请求中。日志禁止打印请求 URL、Authorization 信息、完整 Telegram 错误对象和原始配置。

## 8. 入站消息处理

每个 Update 按以下顺序处理：

1. 检查 `update_id`，丢弃已经确认的 Update。
2. 只接受 `message.text`。
3. 只接受 `message.chat.type === 'private'`。
4. 将 `String(message.chat.id)` 与 allowlist 精确匹配。
5. 未授权消息不创建 Session、不调用模型、不回显任何系统信息。
6. 授权消息进入该 chat 的串行队列。
7. 获取或恢复 Agent。
8. 将 Telegram 文本作为普通用户消息提交给 Agent。
9. 等待这个用户消息对应的 DSH turn 结束。
10. 提取该 turn 最后一条非空 assistant 文本。
11. 分片调用 `sendMessage` 回复原 chat。
12. 成功后推进并持久化 polling offset。

不同 chat 可以并行处理；同一 chat 必须串行，避免两个 turn 同时争用同一个 Session。

## 9. Agent 创建与恢复

进程内维护：

```ts
Map<string, Promise<Agent>>
```

Map 的 key 是 `String(chat_id)`。Promise 缓存用于合并同一 chat 同时到达的首次初始化。

初始化过程：

1. 使用 chat ID 构造 Session ID。
2. 如果 Agent 已经 live，直接复用。
3. 如果 Session 持久化中存在，调用 `ctx.agents.resume()`。
4. 如果 Session 不存在，读取默认模型并调用 `ctx.agents.create()`。
5. Agent 创建或恢复失败时删除失败的 Promise，允许下一条消息重试。

插件不保存 chat 到 Session 的映射，因为二者在 P0 中是一一对应关系：

```text
Session ID = String(Telegram chat_id)
```

## 10. DSH turn 与 Telegram 回复关联

不能仅调用 `agent.whenIdle()` 后读取“最后一条消息”，因为 idle 只表示 Agent 当前没有工作，不能证明某条回答属于当前 Telegram 输入。

每条 Telegram 消息创建唯一的 DSH 用户消息 ID。`turn-relay` 监听该 Session 的事件，并按以下关系定位结果：

1. 找到携带该用户消息 ID 的 `user/message`。
2. 确定包含该消息的 `turn/start`。
3. 收集同一 turn 内的 `assistant/message`。
4. 等待该 turn 的 `turn/end`。
5. 仅返回该 turn 最后一条非空 assistant 文本。

这样可以避免把恢复流程、后台任务或其他 turn 的回答误发到 Telegram。

如果 turn 以错误结束，Bot 返回稳定、无敏感信息的错误文案：

```text
请求处理失败，请稍后重试。
```

内部日志记录错误码和 Telegram `update_id`，不记录用户完整消息正文。

## 11. Telegram 回复

P0 使用纯文本 `sendMessage`，不启用 Markdown 或 HTML parse mode，避免模型输出触发 Telegram 格式解析错误。

Telegram `sendMessage` 的 `text` 上限为 4096 个字符。回复模块按段落和 Unicode code point 保守分片，每片不超过限制，并按顺序发送。

发送策略：

- 400 类永久错误不重试。
- 429 按 Telegram `retry_after` 等待后重试。
- 网络错误和 5xx 使用有上限的指数退避。
- 达到重试上限后停止推进 polling，保留当前进程中的回答，不在同一进程内重复运行 DSH turn。

## 12. Update 去重与交付语义

`stateFile` 保存：

```json
{
  "version": 1,
  "nextUpdateOffset": 123456
}
```

写入采用临时文件加原子 rename。文件权限为 `0600`，父目录权限为 `0700`。

只有 DSH turn 完成且 Telegram 回复发送成功后，才将 offset 推进到 `update_id + 1`。未授权或不支持的消息在完成校验后直接推进。

P0 提供至少一次处理，不承诺严格 exactly-once：

- 进程在回复成功后、offset 落盘前崩溃，重启后可能重复处理一次。
- 进程在 DSH turn 完成后、Telegram 回复成功前退出，重启后可能重复运行一次 turn。
- Telegram `sendMessage` 没有业务幂等键，无法完全消除该崩溃窗口。

正常运行、重复批次和重启读取已落盘 offset 时，同一 Update 不会重复驱动 Agent。

## 13. 错误处理

| 场景 | 行为 |
| --- | --- |
| Token 缺失或无效 | 插件加载失败 |
| allowlist 为空 | 插件加载失败 |
| 未授权 chat | 静默忽略并确认 Update |
| 非私聊 | 静默忽略并确认 Update |
| 非文本消息 | 回复“当前仅支持文本消息”并确认 Update |
| DSH turn 失败 | 返回稳定错误文案，不泄露内部错误 |
| Telegram 429 | 遵循 `retry_after` |
| Telegram 5xx 或网络错误 | 有上限退避重试 |
| Session 恢复失败 | 记录 Session ID 和错误码，不自动覆盖原 Session |
| 插件卸载 | Abort polling，停止新任务，等待在途任务结束 |

## 14. 安全要求

- Bot Token 只能从环境变量读取。
- 配置、Session、状态文件和日志均不得保存 Token。
- allowlist 必须显式配置且不能为空。
- 只允许 private chat。
- 未授权 Update 不得进入 DSH Session。
- 不记录完整 Telegram Update 或用户消息正文。
- Telegram API 错误先脱敏再记录。
- 不在错误消息中暴露本机路径、模型凭证或 DSH 内部调用栈。

## 15. 测试方案

### 15.1 配置测试

- 缺少 `tokenEnv`、环境变量或 allowlist 时加载失败。
- 重复和非法 chat ID 被拒绝。
- retry 和 timeout 越界被拒绝。

### 15.2 Polling 测试

- `allowed_updates` 只请求 `message` 类型。
- 已确认 `update_id` 不重复处理。
- 未授权、群聊和非文本消息不触发 Agent。
- 429、5xx 和网络错误按策略重试。
- Abort 后不再发起下一次 polling。

### 15.3 Session 测试

- Session ID 等于 `String(chat_id)`。
- 已有 Session 调用 resume。
- 不存在的 Session 调用 create。
- 创建时使用 `agentDefaultModel.currentSelection()`。
- 同一 chat 复用 Agent，不同 chat 使用不同 Agent。

### 15.4 对话闭环测试

- Telegram 文本被提交为 DSH 用户消息。
- 只回传对应 turn 的最终 assistant 文本。
- 同一 chat 的两条消息严格串行。
- 长回答按 Telegram 限制正确分片。
- `sendMessage` 成功后才推进 offset。
- Agent 或 Telegram 失败时不会错误确认 Update。

## 16. 验收标准

1. 本机设置 `TELEGRAM_BOT_TOKEN` 并启动安装了插件的 DSH。
2. allowlist 用户给 Bot 发送文本，Bot 返回 DSH 最终回答。
3. 用户连续追问时，DSH 能使用同一 Session 中的历史上下文。
4. 重启 DSH 后再次发送消息，原 Session 上下文仍可恢复。
5. 非 allowlist 用户无法触发 Session 创建、模型调用或工具调用。
6. 重复 Update 在正常运行和 offset 已持久化的重启场景下不会重复执行。
7. 日志、配置和状态文件中均找不到 Bot Token。

## 17. 后续版本

P0 稳定后再单独设计：

- P1：`telegram_send_message` 主动通知工具。
- P1：Schedule 定时提醒。
- P2：图片、文件、语音和流式状态。
- P2：多 Bot、多用户授权和 Session 管理界面。
- P3：Webhook 和服务端部署。
