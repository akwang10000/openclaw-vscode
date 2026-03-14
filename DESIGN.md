# OpenClaw VS Code Extension — 设计文档

## 🎯 目标

让 OpenClaw Agent能通过 VS Code/Cursor 安全地操作工作区代码。  
用户在 Discord/Telegram 等渠道对话，Agent 通过插件读写文件、搜索代码、执行白名单命令。

## 🏗️ 架构

```
用户聊天渠道（Discord/Telegram/...）
    ↓ 消息
OpenClaw Gateway（Mac Mini / VPS）
    ↓ node.invoke.request (WebSocket)
VS Code Extension（MacBook Pro / 任意设备）
    ↓ VS Code Extension API
工作区文件（天然沙箱）
```

### 核心设计：Extension 作为 OpenClaw Node

插件复用 OpenClaw 的 Node 协议：
1. 通过 WebSocket 连接 Gateway（`role: "node"`）
2. 注册自定义 commands（不同于 system.run）
3. Gateway 通过 `node.invoke.request` 事件派发命令
4. 插件通过 `node.invoke.result` 返回结果

### 与 system.run Node 的区别

| | system.run Node | VS Code Extension |
|---|---|---|
| 执行方式 | child_process.spawn | VS Code Extension API |
| 安全边界 | 操作系统级 | 工作区沙箱 |
| 文件访问 | 任意路径 | 仅工作区内 |
| 终端 | 直接 shell | 可选，白名单 |
| 上下文 | 无 | 编辑器状态、诊断信息 |

## 📋 Commands（注册到 Gateway）

### 文件操作（核心）

#### `vscode.file.read`
```json
{
  "path": "src/main.ts",        // 相对于工作区根
  "offset": 0,                  // 起始行（可选）
  "limit": 100                  // 最大行数（可选）
}
→ { "content": "...", "totalLines": 250, "language": "typescript" }
```

#### `vscode.file.write`
```json
{
  "path": "src/new-file.ts",
  "content": "export const foo = 1;\n"
}
→ { "ok": true, "created": true }
```

#### `vscode.file.edit`
```json
{
  "path": "src/main.ts",
  "oldText": "const x = 1;",
  "newText": "const x = 2;"
}
→ { "ok": true, "replacements": 1 }
```

#### `vscode.file.delete`
```json
{
  "path": "src/unused.ts",
  "useTrash": true              // 默认 true，移到回收站
}
→ { "ok": true }
```

### 目录操作

#### `vscode.dir.list`
```json
{
  "path": "src/",               // 相对路径
  "recursive": false,
  "pattern": "**/*.ts"          // glob 可选
}
→ { "entries": [{ "name": "main.ts", "type": "file", "size": 1234 }, ...] }
```

### 搜索

#### `vscode.search.text`
```json
{
  "query": "TODO",
  "include": "src/**/*.ts",
  "exclude": "node_modules/**",
  "maxResults": 50
}
→ { "matches": [{ "path": "src/main.ts", "line": 42, "text": "// TODO: fix" }] }
```

#### `vscode.search.files`
```json
{
  "pattern": "**/package.json",
  "maxResults": 20
}
→ { "files": ["package.json", "packages/core/package.json"] }
```

### 上下文感知

#### `vscode.editor.active`
```json
{}
→ { "path": "src/main.ts", "language": "typescript", "selections": [...] }
```

#### `vscode.diagnostics.get`
```json
{
  "path": "src/main.ts"         // 可选，不传则返回所有
}
→ { "diagnostics": [{ "path": "...", "line": 10, "severity": "error", "message": "..." }] }
```

#### `vscode.workspace.info`
```json
{}
→ { 
    "name": "my-project",
    "rootPath": "/Users/dev/Projects/my-project",
    "folders": [...],
    "fileCount": 1234
  }
```

### 终端（可选，默认关闭）

#### `vscode.terminal.run`
```json
{
  "command": "pnpm test",
  "cwd": "packages/core",
  "timeoutMs": 60000
}
→ { "exitCode": 0, "stdout": "...", "stderr": "..." }
```

**安全控制：**
- 设置项 `openclaw.terminal.enabled`（默认 false）
- 设置项 `openclaw.terminal.allowlist`（默认 `["git", "npm", "pnpm", "npx", "node", "tsc"]`）
- 白名单按可执行文件名匹配，不接受 shell 拼接、重定向或管道
- `cwd` 必须在工作区内，越界路径直接拒绝

## 🔒 安全设计

### 1. 工作区沙箱
- 所有 `path` 参数必须是相对路径，resolve 后必须在工作区目录内
- 禁止 `..` 路径穿越
- 禁止符号链接指向工作区外

### 2. Gateway 认证
- WebSocket 连接使用 Gateway Token
- 支持设备配对（Device Identity）

### 3. 操作日志
- 所有操作记录到 VS Code Output Channel "OpenClaw"
- 文件写入/删除额外高亮

### 4. 确认模式（可选）
- 设置项 `openclaw.confirmWrites`（默认 false）
- 开启后，所有会修改工作区或仓库状态的命令都先弹确认对话框

### 5. 只读模式
- 设置项 `openclaw.readOnly`（默认 false）
- 开启后只允许只读命令，禁止文件写入、语言改写、git 变更、终端执行和 Agent 写模式

## ⚙️ 配置项

```json
{
  "openclaw.gatewayHost": "localhost",
  "openclaw.gatewayPort": 18789,
  "openclaw.gatewayToken": "",
  "openclaw.gatewayTls": false,
  "openclaw.autoConnect": false,
  "openclaw.displayName": "VS Code",
  "openclaw.terminal.enabled": false,
  "openclaw.terminal.allowlist": ["git", "npm", "pnpm", "npx", "node", "tsc"],
  "openclaw.confirmWrites": false,
  "openclaw.readOnly": false
}
```

## 🖥️ UI

### 状态栏
- 连接状态指示（🔴 断开 / 🟡 连接中 / 🟢 已连接）
- 点击切换连接/断开

### 命令面板
- `OpenClaw: Connect` — 连接 Gateway
- `OpenClaw: Disconnect` — 断开
- `OpenClaw: Show Log` — 打开 Output Channel
- `OpenClaw: Toggle Read-Only` — 切换只读模式

### Activity Bar（可选，Phase 2+）
- 显示最近的操作日志
- 连接状态和 Gateway 信息

## 🛠️ 技术栈

- **语言**：TypeScript
- **构建**：esbuild（VS Code Extension 标准）
- **WebSocket**：`ws` 库（Node.js 环境）
- **VS Code API**：`vscode.workspace.fs`、`WorkspaceEdit`、`TextSearchQuery` 等
- **协议**：复用 OpenClaw Gateway Protocol（node.invoke.request/result）

## 📦 项目结构

```
openclaw-vscode-extension/
├── package.json              # Extension manifest
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── extension.ts          # 入口：activate/deactivate
│   ├── gateway-client.ts     # WebSocket 客户端（精简版 GatewayClient）
│   ├── commands/
│   │   ├── file.ts           # vscode.file.* 命令处理
│   │   ├── dir.ts            # vscode.dir.* 命令处理
│   │   ├── search.ts         # vscode.search.* 命令处理
│   │   ├── editor.ts         # vscode.editor.* 命令处理
│   │   ├── terminal.ts       # vscode.terminal.* 命令处理
│   │   └── registry.ts       # 命令注册表
│   ├── security.ts           # 路径校验、沙箱检查
│   ├── logger.ts             # Output Channel 日志
│   ├── status-bar.ts         # 状态栏 UI
│   └── config.ts             # 配置读取
├── .vscodeignore
└── README.md
```

## 📅 开发计划

### Phase 1：基础连接 + 文件读写（MVP）✅
- [x] 项目脚手架（package.json、tsconfig、esbuild）
- [x] GatewayClient 精简实现（WebSocket + 协议）
- [x] vscode.file.read / write / edit / delete
- [x] vscode.dir.list
- [x] 路径安全校验
- [x] 状态栏 UI
- [x] Output Channel 日志
- [x] vscode.editor.active / diagnostics.get / workspace.info
- [x] vscode.terminal.run（白名单模式）

### Phase 2：语言智能 ✅
- [x] vscode.lang.definition — 跳转定义
- [x] vscode.lang.references — 查找引用
- [x] vscode.lang.hover — 类型信息
- [x] vscode.lang.symbols — 文件/全局符号
- [x] vscode.lang.rename — 跨文件安全重命名
- [x] vscode.lang.codeActions — 获取可用修复
- [x] vscode.lang.applyCodeAction — 应用修复
- [x] vscode.code.format — 文档格式化
- [x] vscode.editor.openFiles — 所有打开标签
- [x] vscode.editor.selections — 当前选中代码

### Phase 3：测试 + Git ✅
- [x] vscode.test.list / run / results — 测试发现与执行
- [x] vscode.git.status — 分支、暂存、修改、未追踪
- [x] vscode.git.diff — diff（支持 staged/ref）
- [x] vscode.git.log — 提交历史
- [x] vscode.git.blame — 行级 blame
- [x] vscode.git.stage / unstage — 暂存管理
- [x] vscode.git.commit — 提交
- [x] vscode.git.stash — stash push/pop/list

### Phase 4：调试 ✅
- [x] vscode.debug.launch — 启动调试（支持自定义/命名配置）
- [x] vscode.debug.stop — 停止调试
- [x] vscode.debug.breakpoint — 增删查清断点（支持条件断点）
- [x] vscode.debug.evaluate — 在断点上下文求值
- [x] vscode.debug.stackTrace — 调用栈
- [x] vscode.debug.variables — 变量查看（支持 scope 选择）
- [x] vscode.debug.status — 调试会话状态

### Phase 5：打磨 + 发布（待开始）
- [ ] 设备配对流程（Gateway approve）
- [ ] Activity Bar 面板
- [ ] README + 文档
- [ ] VS Code Marketplace 发布
- [ ] Gateway 端适配（识别 vscode.* 命令）

## 🔗 参考

- OpenClaw Node Protocol: `src/node-host/runner.ts`
- Gateway Protocol Schema: `src/gateway/protocol/schema/nodes.ts`
- GatewayClient: `src/gateway/client.ts`
- 现有 VS Code Extension: `openknot/openclaw-extension`（Open VSX）
