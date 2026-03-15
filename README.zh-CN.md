# OpenClaw Node for VS Code / Cursor

<p align="center">
  <img src="assets/icon.png" alt="OpenClaw VS Code" width="128" />
</p>

<p align="center">
  <strong>将你的 IDE 连接到 OpenClaw Gateway 作为 Node</strong><br>
  让 AI 助手通过 VS Code API 安全地读写和操作代码
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#安装">安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#命令列表">命令列表</a> •
  <a href="#配置项">配置项</a> •
  <a href="#安全机制">安全机制</a> •
  <a href="README.md">English</a>
</p>

---

<p align="center">
  <img src="assets/demo.gif" alt="Demo" width="640" />
</p>

## 这是什么？

这个扩展将你的 VS Code 或 Cursor 编辑器变成一个 [OpenClaw](https://github.com/openclaw/openclaw) **Node**——一个可远程控制的端点，通过 Node 协议暴露 IDE 能力。

你的 AI 助手（运行在 OpenClaw Gateway 上）就可以：
- 📄 读写和编辑工作区中的文件
- 🔍 跳转定义、查找引用、获取悬停信息
- 🌿 查看 Git 状态、查看 diff、暂存和提交
- 🧪 发现和运行测试
- 🐛 启动调试器、设置断点、执行表达式
- 🤖 委派任务给 Cursor Agent CLI（plan/agent/ask 模式）

所有操作都通过 VS Code Extension API 沙箱执行——**默认不开放 shell 访问**。

## 功能特性

### 40+ IDE 命令

覆盖完整的开发工作流：

| 分类 | 命令 |
|------|------|
| **文件操作** | `read`、`write`、`edit`、`delete`、`list` |
| **编辑器** | `openFiles`、`selections`、`context`（当前文件+光标位置） |
| **语言智能** | `definition`、`references`、`hover`、`symbols`、`rename`、`codeActions`、`format` |
| **Git** | `status`、`diff`、`log`、`blame`、`stage`、`unstage`、`commit`、`stash` |
| **测试** | `list`、`run`、`results` |
| **调试** | `launch`、`stop`、`breakpoint`、`evaluate`、`stackTrace`、`variables` |
| **Agent** | `status`、`run`、`setup`（Cursor Agent CLI 集成） |

### Activity 面板
AI 助手的每个操作都会显示在底部面板中，包含意图描述、耗时和状态。

<img src="assets/activity-panel.png" alt="Activity 面板" width="600" />

### 引导式设置向导
4 步完成配置：Gateway 连接 → 安全设置 → 终端权限 → Agent 集成

<img src="assets/setup-wizard.png" alt="设置向导" width="600" />

### Cursor Agent CLI 集成
三种模式委派编码任务：
- **Agent** — 完全访问，可读写文件
- **Plan** — 分析代码库，提出方案但不执行
- **Ask** — 只读问答，了解代码库

## 安装

### 从 VSIX 安装（当前方式）

从 [Releases](https://github.com/akwang10000/openclaw-vscode/releases) 下载最新 `.vsix`，然后：

```bash
# VS Code
code --install-extension openclaw-node-vscode-x.y.z.vsix

# Cursor
cursor --install-extension openclaw-node-vscode-x.y.z.vsix
```

## 快速开始

1. **安装扩展**
2. **运行设置向导**：`Cmd/Ctrl+Shift+P` → `OpenClaw: Setup Wizard`
3. **输入 Gateway 信息**：地址、端口和 Token
4. **审批设备**：首次连接时需要在 Gateway 端批准
5. **开始使用**：AI 助手现在可以通过 `nodes invoke` 调用命令了

## 安全机制

- **路径遍历防护**：操作限制在工作区目录内
- **无 shell 访问**：终端命令默认禁用，启用后仅允许白名单命令
- **写保护**：可选只读模式和写入确认提示
- **设备身份**：Ed25519 密钥对，Gateway 必须审批每个设备
- **Gateway 级控制**：可进一步限制允许执行的命令

### 近期安全修复

- 终端执行现在会先安全解析命令，拒绝管道、重定向、`&&`、`;` 等 shell 拼接语法，并以 `shell: false` 运行
- `cwd` 等工作目录参数现在必须严格位于工作区的规范化真实路径内，不能再通过相对路径或符号链接 / junction 跳出工作区
- `openclaw.readOnly` 和 `openclaw.confirmWrites` 已覆盖所有会产生修改的命令，包括 Git 操作、格式化、重命名/代码动作、终端执行以及 Agent 写模式
- Cursor Agent CLI 集成现在会校验 `agent.cliPath`，并移除了版本检测、鉴权检查、模型列表中的 shell 拼接执行方式
- Gateway 侧发起的协议请求现在具备显式超时清理，不会再因为挂起请求长期等待

## 开发

```bash
git clone https://github.com/akwang10000/openclaw-vscode.git
cd openclaw-vscode
npm install
npm run build
npx vsce package --no-dependencies
```

## 许可证

MIT

## 相关链接

- [OpenClaw](https://github.com/openclaw/openclaw) — AI 助手框架
- [OpenClaw 文档](https://docs.openclaw.ai)
- [OpenClaw Discord](https://discord.com/invite/clawd) — 社区
