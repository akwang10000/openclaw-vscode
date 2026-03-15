# OpenClaw Node for VS Code / Cursor

<p align="center">
  <img src="assets/icon.png" alt="OpenClaw VS Code" width="128" />
</p>

<p align="center">
  <strong>把 VS Code 或 Cursor 接入 OpenClaw Gateway，作为远程 IDE Node。</strong><br>
  OpenClaw 可以通过 VS Code API 沙箱安全地读代码、查符号、执行 IDE 操作，并调度可恢复的 Codex 任务。
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

## 这个扩展是做什么的

这个扩展会把 VS Code / Cursor 注册到 OpenClaw Gateway，暴露一组 `vscode.*` 命令。

接入后，OpenClaw 可以：
- 读取、写入、编辑工作区文件
- 查询定义、引用、悬停、符号、诊断信息
- 通过 VS Code API 执行 Git、测试、调试相关操作
- 执行白名单终端命令
- 调用 Cursor Agent CLI
- 调用支持状态查询、决策回合、取消和结果获取的 Codex CLI 任务

它默认是受限运行的：
- `path` 和 `cwd` 必须留在工作区内
- 终端默认关闭
- 会修改内容的操作受 `openclaw.readOnly` 和 `openclaw.confirmWrites` 约束

如果你更希望像聊天一样使用 OpenClaw，而不是自己记底层命令，请看：
- [自然语言调用指南](NATURAL_LANGUAGE_CALLING.zh-CN.md)

## 当前能力

已实现的命令族：
- `vscode.file.*`
- `vscode.dir.list`
- `vscode.editor.*`
- `vscode.diagnostics.get`
- `vscode.workspace.info`
- `vscode.lang.*`
- `vscode.code.format`
- `vscode.git.*`
- `vscode.test.*`
- `vscode.debug.*`
- `vscode.terminal.run`
- `vscode.agent.*`
- `vscode.agent.task.*`

暂未实现：
- `vscode.search.text`
- `vscode.search.files`

## 安装

### 从 VSIX 安装

从这里下载最新安装包：
- <https://github.com/akwang10000/openclaw-vscode/releases>

然后执行：

```bash
# VS Code
code --install-extension openclaw-node-vscode-x.y.z.vsix

# Cursor
cursor --install-extension openclaw-node-vscode-x.y.z.vsix
```

### 本地开发安装

```bash
npm install
npm run build
npx vsce package --no-dependencies
code --install-extension openclaw-node-vscode-0.2.0.vsix --force
```

## 快速开始

1. 安装扩展
2. 在 VS Code 里运行 `OpenClaw: Setup Wizard`
3. 填写 Gateway 的 host、port、token
4. 第一次连接时，在 Gateway 侧审批这个设备
5. 确认节点已经连上，并且已经暴露 `vscode.*` 命令

建议第一次这样配置：
- `openclaw.confirmWrites = true`
- `openclaw.terminal.enabled = false`
- 确认本机有可用 `codex` CLI 之后，再打开 `openclaw.agent.codex.enabled`

### 第一次联通测试

先从 OpenClaw 调一条最简单的只读命令：

```text
vscode.workspace.info
```

预期返回结构类似：

```json
{
  "name": "openclaw-vscode",
  "rootPath": "H:\\workspace\\openclaw-vscode",
  "folders": ["H:\\workspace\\openclaw-vscode"]
}
```

### 如果你更想用自然语言

你可以把 OpenClaw 当成 IDE 助手来直接对话，而不是自己记命令名。

例如：
- “读一下 README，告诉我怎么安装这个项目。”
- “分析下一步最值得做的改动，但先不要修改代码。”
- “继续刚才那个任务，按推荐方案继续。”

推荐行为：
- 读与查询默认保持只读
- 规划类请求默认走 Codex task 的 `plan` 流程
- 修改类请求在真正执行前应先确认

### 首次使用常见问题

- 本地 Gateway 一般应该用 `127.0.0.1:18789`，并保持 `openclaw.gatewayTls = false`
- token 从 `~/.openclaw/openclaw.json` 的 `gateway.auth.token` 里取
- 如果节点状态显示 `connected: true`、`paired: true`，但 `commands: []`，检查 `gateway.nodes.allowCommands`，必须写完整命令名，比如 `vscode.workspace.info`、`vscode.file.read`
- 可以直接在 VS Code 里运行 `OpenClaw: Diagnose Connection`

## 命令分类

通过 OpenClaw 调用时，请使用完整命令名。

### 文件与工作区

| 命令 | 参数 | 说明 |
|------|------|------|
| `vscode.file.read` | `path`, `offset?`, `limit?` | 按行读取文件 |
| `vscode.file.write` | `path`, `content` | 写入或创建文件 |
| `vscode.file.edit` | `path`, `edits[]` | 精准文本编辑 |
| `vscode.file.delete` | `path` | 删除文件 |
| `vscode.dir.list` | `path?`, `recursive?`, `pattern?` | 列目录 |
| `vscode.workspace.info` | 无 | 返回工作区名称和文件夹列表 |

### 编辑器与语言能力

| 命令 | 参数 | 说明 |
|------|------|------|
| `vscode.editor.active` | 无 | 当前编辑器路径、语言、选择区 |
| `vscode.editor.openFiles` | 无 | 打开的标签页 |
| `vscode.editor.selections` | 无 | 所有编辑器中的选择区 |
| `vscode.lang.definition` | `path`, `line`, `character` | 跳转定义 |
| `vscode.lang.references` | `path`, `line`, `character` | 查找引用 |
| `vscode.lang.hover` | `path`, `line`, `character` | 悬停信息 |
| `vscode.lang.symbols` | `path?`, `query?` | 文档或工作区符号 |
| `vscode.lang.rename` | `path`, `line`, `character`, `newName` | 重命名符号 |
| `vscode.lang.codeActions` | `path`, `startLine`, `endLine` | 列出代码动作 |
| `vscode.lang.applyCodeAction` | `path`, `startLine`, `endLine`, `title` | 应用代码动作 |
| `vscode.code.format` | `path` | 格式化文档 |
| `vscode.diagnostics.get` | `path?`, `severity?` | 诊断信息 |

### Git、测试、调试

| 命令 | 参数 | 说明 |
|------|------|------|
| `vscode.git.status` | 无 | 工作区 Git 状态 |
| `vscode.git.diff` | `path?`, `staged?` | 查看 diff |
| `vscode.git.log` | `count?`, `path?` | 提交历史 |
| `vscode.git.blame` | `path` | blame 信息 |
| `vscode.git.stage` | `paths[]` | stage 文件 |
| `vscode.git.unstage` | `paths[]` | unstage 文件 |
| `vscode.git.commit` | `message` | 提交 |
| `vscode.git.stash` | `action`, `message?` | stash 操作 |
| `vscode.test.list` | 无 | 枚举测试 |
| `vscode.test.run` | `testIds?`, `grep?` | 运行测试 |
| `vscode.test.results` | 无 | 最近测试结果 |
| `vscode.debug.launch` | `config?` | 启动调试 |
| `vscode.debug.stop` | 无 | 停止调试 |
| `vscode.debug.breakpoint` | `path`, `line`, `action?` | 切换断点 |
| `vscode.debug.evaluate` | `expression`, `frameId?` | 求值 |
| `vscode.debug.stackTrace` | 无 | 调用栈 |
| `vscode.debug.variables` | `frameId?` | 变量 |
| `vscode.debug.status` | 无 | 调试状态 |

### 终端与旧 Agent CLI

| 命令 | 参数 | 说明 |
|------|------|------|
| `vscode.terminal.run` | `command`, `cwd?`, `timeoutMs?` | 安全解析后运行白名单可执行文件 |
| `vscode.agent.status` | 无 | 检查 Cursor Agent CLI 是否可用 |
| `vscode.agent.run` | `prompt`, `mode?`, `model?`, `cwd?`, `timeoutMs?` | 调用 Cursor Agent CLI |
| `vscode.agent.setup` | 无 | 打开安装向导 |

## Codex 任务编排用法

新的任务接口用于可恢复的 Codex CLI 运行。

### 命令列表

| 命令 | 参数 | 说明 |
|------|------|------|
| `vscode.agent.task.start` | `provider`, `prompt`, `mode?`, `cwd?`, `timeoutMs?`, `metadata?` | 启动 Codex 任务 |
| `vscode.agent.task.status` | `taskId` | 获取任务快照 |
| `vscode.agent.task.list` | `status?`, `limit?` | 列最近任务 |
| `vscode.agent.task.respond` | `taskId`, `choice`, `notes?` | 对等待决策的 plan 任务继续下一轮 |
| `vscode.agent.task.cancel` | `taskId` | 取消任务 |
| `vscode.agent.task.result` | `taskId` | 获取最终结果、错误或待决策信息 |

### Ask 模式示例

启动参数：

```json
{
  "provider": "codex",
  "prompt": "Reply with exactly the words OPENCLAW TEST.",
  "mode": "ask",
  "cwd": "."
}
```

之后轮询：
- `vscode.agent.task.status`
- `vscode.agent.task.result`

### Plan 模式示例

1. 先启动：

```json
{
  "provider": "codex",
  "prompt": "Analyze this repository and give me two implementation options.",
  "mode": "plan",
  "cwd": "."
}
```

2. 持续查 `vscode.agent.task.status`，直到出现：

```json
{
  "status": "waiting_decision",
  "decisionRequest": {
    "question": "What should the next implementation focus be for this repository?",
    "options": [
      { "id": "unify-agent-providers", "label": "..." },
      { "id": "add-search-commands", "label": "..." }
    ],
    "recommendedOption": "unify-agent-providers",
    "contextSummary": "..."
  }
}
```

3. 然后继续：

```json
{
  "taskId": "your-task-id",
  "choice": "unify-agent-providers",
  "notes": "Use the recommended option and continue."
}
```

4. 再查 `status`，最后调用 `vscode.agent.task.result`

补充说明：
- v1 只支持 `provider = "codex"`
- `mode = "agent"` 被视为可修改模式，受 `readOnly` / `confirmWrites` 约束
- `cwd` 必须位于当前工作区内

## 配置项

所有设置都在 `openclaw.*` 下。

### 连接

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `openclaw.gatewayHost` | `"127.0.0.1"` | Gateway 主机 |
| `openclaw.gatewayPort` | `18789` | Gateway 端口 |
| `openclaw.gatewayToken` | `""` | Gateway token |
| `openclaw.gatewayTls` | `false` | 是否使用 `wss://` |
| `openclaw.autoConnect` | `false` | 启动时自动连接 |
| `openclaw.displayName` | `"VS Code"` | 节点显示名 |

### 安全

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `openclaw.readOnly` | `false` | 阻止修改类命令 |
| `openclaw.confirmWrites` | `false` | 修改前确认 |
| `openclaw.terminal.enabled` | `false` | 是否允许终端命令 |
| `openclaw.terminal.allowlist` | `["git","npm","pnpm","npx","node","tsc"]` | 允许的可执行文件 basename |
| `openclaw.commandTimeout` | `90` | 默认命令超时，单位秒 |

### Cursor Agent CLI

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `openclaw.agent.enabled` | `false` | 开启 Cursor Agent CLI |
| `openclaw.agent.cliPath` | `"agent"` | CLI 路径 |
| `openclaw.agent.defaultMode` | `"agent"` | 默认模式 |
| `openclaw.agent.defaultModel` | `""` | 默认模型 |
| `openclaw.agent.timeoutMs` | `300000` | 超时，单位毫秒 |

### Codex 任务

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `openclaw.agent.codex.enabled` | `false` | 开启 Codex 任务编排 |
| `openclaw.agent.codex.cliPath` | `"codex"` | Codex CLI 路径 |
| `openclaw.agent.taskHistoryLimit` | `50` | 保留的已完成任务数量 |

## 安全说明

### 工作区边界

所有 `path` 和 `cwd` 都会走规范化 containment 校验：
- 不接受绝对路径
- 不允许通过 `..` 跳出工作区
- 不允许通过 symlink / junction 越界

### 修改权限控制

`openclaw.readOnly` 和 `openclaw.confirmWrites` 现在覆盖：
- 文件写入、编辑、删除
- rename、format、apply code action
- Git 修改类操作
- 终端执行
- 可写模式的 agent 运行

### 终端加固

`vscode.terminal.run` 现在会：
- 先解析命令
- 拒绝管道、重定向、命令拼接、命令替换
- 以 `shell: false` 执行
- 只按可执行文件 basename 做白名单判断

### 设备身份

每个扩展实例都会生成一个 Ed25519 身份文件，路径是：

```text
~/.openclaw-vscode/device.json
```

Gateway 必须审批后，这个节点才能执行命令。

## 故障排查

### 已连接但没有命令

检查 `~/.openclaw/openclaw.json` 里的 `gateway.nodes.allowCommands`，必须使用完整命令名，比如：
- `vscode.workspace.info`
- `vscode.file.read`
- `vscode.agent.task.start`

### 本地 Gateway 报 TLS 错误

如果看到 `WRONG_VERSION_NUMBER`，通常是把本地明文 Gateway 当成了 TLS 连接。应配置：

```json
{
  "openclaw.gatewayHost": "127.0.0.1",
  "openclaw.gatewayPort": 18789,
  "openclaw.gatewayTls": false
}
```

### Codex 任务启动失败

检查：
- `openclaw.agent.codex.enabled = true`
- `openclaw.agent.codex.cliPath` 指向可运行的 `codex`
- `cwd` 没有越出工作区

## 开发

```bash
git clone https://github.com/akwang10000/openclaw-vscode.git
cd openclaw-vscode
npm install
npm run test
npm run lint
npm run build
npx vsce package --no-dependencies
```

## 参考

- [OpenClaw](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [设计说明](DESIGN.md)
- [License](LICENSE)
