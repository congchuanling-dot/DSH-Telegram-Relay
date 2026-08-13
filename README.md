# DSH Telegram Relay

让 Telegram 成为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的移动端对话入口。

插件在本机通过 Telegram Bot API 长轮询接收私聊文本，将消息交给 DSH Agent 处理，并把最终回答发送回原会话。每个 Telegram `chat_id` 对应一个持久化 DSH Session，因此连续追问和进程重启后都能保留上下文。

## 效果展示

同一条对话由 DSH Session 持久化管理。Telegram 负责移动端收发，Web UI 可查看同一套 Agent 能力和执行过程。

<table>
  <tr>
    <td width="34%">
      <img src="./docs/assets/telegram-conversation.jpg" alt="Telegram Bot 对话效果">
    </td>
    <td width="66%">
      <img src="./docs/assets/dsh-web-session.png" alt="DeepSeek Harness Web 会话效果">
    </td>
  </tr>
  <tr>
    <td align="center">Telegram 移动端</td>
    <td align="center">DeepSeek Harness Web</td>
  </tr>
</table>

## 核心能力

| 能力 | 实现 |
| --- | --- |
| Telegram 私聊入口 | 使用 `getUpdates` 长轮询，无需公网 IP、域名或 Webhook |
| DSH 完整能力 | 消息进入真实 DSH Agent，可使用当前 profile 已启用的模型和工具 |
| 连续上下文 | `String(chat_id)` 直接作为 DSH Session ID |
| 重启恢复 | 从 DSH Session persistence 恢复历史对话 |
| 安全访问 | 只允许显式配置在 allowlist 中的私聊 |
| Update 去重 | 成功回复后原子持久化 Telegram offset |
| 长文本回复 | 按 Telegram 4096 字符限制进行 Unicode 安全分片 |
| 生命周期管理 | 插件卸载时中止 polling，并释放本插件持有的 Agent |

## 工作原理

```text
Telegram 用户
      │
      │ 私聊文本
      ▼
Telegram Bot API
      │ getUpdates 长轮询
      ▼
DSH Telegram Relay
      │ allowlist 校验
      │ chat_id -> Session ID
      ▼
DeepSeek Harness Agent
      │ 模型推理 / 工具调用 / Session 持久化
      ▼
DSH Telegram Relay
      │ sendMessage
      ▼
Telegram 用户
```

等待 `getUpdates` 返回时使用异步网络 I/O，不会通过 CPU 忙等持续轮询。

## 快速开始

### 1. 准备 Bot

1. 在 Telegram 联系 `@BotFather`。
2. 执行 `/newbot` 创建 Bot。
3. 保存 Bot Token。
4. 给新 Bot 发送一条消息，并通过 `getUpdates` 查询自己的私聊 `chat_id`。

```sh
node -e 'fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`).then(r => r.json()).then(x => console.dir(x, { depth: null }))'
```

结果中的 `message.chat.id` 就是 allowlist 所需的 `chat_id`。

### 2. 配置环境变量

Token 和 allowlist 只通过环境变量传入。不要将 Token 写入代码、YAML、README 或 Git。

```sh
export TELEGRAM_BOT_TOKEN='<BotFather 返回的 Token>'
export TELEGRAM_ALLOWED_CHAT_IDS='<你的私聊 chat_id>'
```

允许多个私聊时使用英文逗号分隔：

```sh
export TELEGRAM_ALLOWED_CHAT_IDS='123456789,987654321'
```

### 3. 安装依赖并构建

当前开发方式假设 `DSH-Telegram-Relay` 与 `deepseek-harness` 位于同一父目录：

```text
myOwnProject/
├── deepseek-harness/
└── DSH-Telegram-Relay/
```

首次开发时安装依赖，并将 DSH peer dependencies 链接到本地 Harness：

```sh
cd DSH-Telegram-Relay
pnpm install --config.auto-install-peers=false

pnpm link \
  ../deepseek-harness/vendor/cordis \
  ../deepseek-harness/packages/core/agent \
  ../deepseek-harness/packages/core/agent-default-model \
  ../deepseek-harness/packages/llm/llm \
  ../deepseek-harness/packages/core/session \
  ../deepseek-harness/packages/session/session-persistence

pnpm run build
```

`pnpm link` 只用于本机开发，不要提交它写入的本机 `link:` 路径。

### 4. 安装到 DSH

将插件加入 `web` profile：

```sh
pnpm --dir ../deepseek-harness \
  dsh plugin --profile web add \
  "$(pwd)"
```

确认插件已经安装：

```sh
pnpm --dir ../deepseek-harness \
  dsh plugin --profile web list
```

输出中应包含：

```text
dsh-telegram-relay@link:.../DSH-Telegram-Relay
```

### 5. 启动

必须在设置环境变量的同一个终端启动 DSH：

```sh
cd ../deepseek-harness
pnpm dsh web
```

现在给 Bot 发送文本即可开始对话。首次消息会创建 Session，后续消息继续复用该 Session。

## 配置

插件 bundle 默认配置位于 [`cordis.patch.yml`](./cordis.patch.yml)：

```yaml
- insert:
    - id: telegram-relay
      name: dsh-telegram-relay
      config:
        tokenEnv: TELEGRAM_BOT_TOKEN
        allowedChatIds: !!js process.env.TELEGRAM_ALLOWED_CHAT_IDS?.split(',')
        cwd: !!js process.cwd()
        stateFile: !!js dshHomePath('telegram-relay/state.json')
```

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `tokenEnv` | 保存 Bot Token 的环境变量名 | `TELEGRAM_BOT_TOKEN` |
| `allowedChatIds` | 允许访问 DSH 的私聊 ID，不能为空 | 从 `TELEGRAM_ALLOWED_CHAT_IDS` 读取 |
| `cwd` | 新建 Telegram Session 的工具工作目录 | 启动 DSH 时的当前目录 |
| `pollTimeoutSeconds` | 单次长轮询等待时间 | `30` |
| `retryMinMilliseconds` | 网络错误后的最短退避时间 | `1000` |
| `retryMaxMilliseconds` | 网络错误后的最长退避时间 | `30000` |
| `stateFile` | Telegram offset 状态文件 | `$DSH_HOME/telegram-relay/state.json` |

需要固定工具工作目录时，在 profile 的后置 patch 中将 `cwd` 覆盖为绝对路径。

## 安全边界

- Bot Token 仅从环境变量读取。
- allowlist 不能为空，且只接受 Telegram `private` chat。
- 未授权 chat 不创建 Session，不触发模型，也不触发工具。
- 日志不记录 Token、完整 Telegram Update 或用户消息正文。
- offset 文件不保存 Token、聊天内容或 DSH Session 数据。
- DSH 处理失败时只向 Telegram 返回稳定错误文案，不暴露本机路径和调用栈。

## Session 与状态

插件不维护额外的 chat-to-session 数据库：

```text
DSH Session ID = String(Telegram chat_id)
```

对话历史、模型消息和工具调用记录全部由 DSH Session persistence 管理。插件只额外保存下一个 Telegram Update offset：

```text
$DSH_HOME/telegram-relay/state.json
```

offset 只在 DSH turn 完成且 Telegram 回复成功后推进。正常运行时 Update 不会重复处理；进程在回复成功后、offset 落盘前崩溃时可能重复一次，因此 P0 提供至少一次交付，不承诺严格 exactly-once。

## 开发与验证

```sh
pnpm test
pnpm run typecheck:test
pnpm run typecheck
pnpm run build
```

测试覆盖：

- 配置与 allowlist 校验
- Telegram 错误分类和重试
- 长轮询与 Update 去重
- offset 原子持久化
- Session 创建、复用与恢复
- 当前 turn 的回答关联
- Telegram 长文本分片
- 未授权访问和失败回传

详细设计见 [`P0_TECHNICAL_DESIGN.md`](./P0_TECHNICAL_DESIGN.md)。

## 常见问题

### 启动时报 `TELEGRAM_BOT_TOKEN is required`

当前终端没有 Token。重新设置后，在同一个终端执行 `pnpm dsh web`：

```sh
export TELEGRAM_BOT_TOKEN='<Bot Token>'
```

### `getUpdates` 返回 `result: []`

当前没有未消费消息。停止其他 polling 进程，给 Bot 发送一条新消息后再次查询。

### Telegram 返回 `409 Conflict`

同一个 Bot Token 正被另一个 polling 进程使用，或者 Bot 仍配置了 webhook。确保只运行一个 DSH 实例，并删除 webhook：

```sh
node -e 'fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteWebhook`).then(r => r.json()).then(console.log)'
```

### Bot 没有回复

1. 确认 Web 插件列表中的 `telegram-relay` 已启用且没有加载错误。
2. 确认 `TELEGRAM_ALLOWED_CHAT_IDS` 与 `message.chat.id` 完全一致。
3. 确认 DSH Web 本身可以正常调用模型。
4. 确认没有其他进程消费同一 Bot 的 Update。

## P0 边界

当前版本只实现 Telegram 私聊文本对话。主动通知、Schedule 定时提醒、群聊、图片、文件、语音和 Webhook 将作为后续能力独立设计。
