# DSH Telegram Relay

独立的 DeepSeek Harness 插件。它通过 Telegram Bot API 长轮询接收私人消息，将文本提交给本机 DSH Agent，再把最终回答发回 Telegram。

```text
Telegram 私聊 -> getUpdates -> DSH Session -> 模型/工具 -> sendMessage
```

P0 只支持文本对话，不包含 Schedule、主动通知、Webhook、群聊和媒体消息。

## 前置条件

- Node.js `^22.19.0` 或 `>=24.0.0`
- 相邻目录存在 `deepseek-harness`
- DSH 已配置可用模型
- 已通过 `@BotFather` 创建 Bot
- 已取得自己的 Telegram 私聊 `chat_id`

## 安全配置

Token 和 allowlist 只通过环境变量传入。不要将 Token 写入代码、YAML、README 或 Git。

```sh
export TELEGRAM_BOT_TOKEN='<BotFather 返回的 Token>'
export TELEGRAM_ALLOWED_CHAT_IDS='<你的私聊 chat_id>'
```

允许多个私聊时使用英文逗号分隔：

```sh
export TELEGRAM_ALLOWED_CHAT_IDS='123456789,987654321'
```

插件只接受 `private` chat。未授权 chat 不会创建 DSH Session，也不会触发模型或工具。

## 本地构建

当前 DSH RC 包由相邻的 Harness 仓库提供。首次开发时安装普通依赖，并将 DSH peer dependencies 链接到本地 Harness：

```sh
cd <workspace>/DSH-Telegram-Relay
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

`pnpm link` 只用于本机开发。不要提交它写入的本机 `link:` 路径。

## 安装与启动

安装到 DSH `web` profile：

```sh
pnpm --dir <workspace>/deepseek-harness \
  dsh plugin --profile web add \
  <workspace>/DSH-Telegram-Relay
```

确认 bundle 已合入：

```sh
pnpm --dir <workspace>/deepseek-harness \
  dsh plugin --profile web list
```

在设置环境变量的同一个终端启动 DSH：

```sh
pnpm --dir <workspace>/deepseek-harness dsh web
```

日志出现以下内容表示 Telegram 已连接：

```text
telegram-relay: connected as @<bot_username>
```

然后给 Bot 发送文本。首次消息会创建 Session ID 为 `String(chat_id)` 的 DSH Agent；后续消息复用该 Session。DSH 重启后，插件从 Session persistence 恢复上下文。

## 工作目录

默认 `cordis.patch.yml` 使用启动 DSH 时的 `process.cwd()` 作为 Telegram Session 的工作目录：

```yaml
cwd: !!js process.cwd()
```

需要固定目录时，在 profile 的后置 patch 中覆盖为绝对路径。

## 状态文件

插件只额外保存 Telegram offset：

```text
$DSH_HOME/telegram-relay/state.json
```

文件不包含 Token、消息正文或 Session 内容。对话历史由 DSH Session persistence 管理。

## 验证

```sh
pnpm test
pnpm run typecheck:test
pnpm run typecheck
pnpm run build
```

当前单元测试覆盖配置、allowlist、Telegram 错误分类、长轮询、offset 去重、Session 创建与恢复、turn 回答关联、文本分片和失败回传。

## 常见问题

### `result: []`

`getUpdates` 没有未消费消息。先停止其他 polling 进程，再给 Bot 发送一条新消息。

### `409 Conflict`

同一个 Bot Token 正被另一个 polling 进程使用，或仍配置了 webhook。确保只运行一个 DSH 实例，并删除 webhook。

### Bot 没有回复

依次检查：

1. DSH 日志是否出现 `connected as`。
2. `TELEGRAM_ALLOWED_CHAT_IDS` 是否与 `message.chat.id` 完全一致。
3. DSH Web 是否能正常调用模型。
4. 是否有另一个进程消费了同一 Bot 的 Update。

## 交付语义

offset 只在 DSH turn 完成且 Telegram 回复成功后推进。正常运行时 Update 不会重复处理；进程在回复成功后、offset 落盘前崩溃时可能重复一次，因此 P0 是至少一次交付，不承诺严格 exactly-once。
