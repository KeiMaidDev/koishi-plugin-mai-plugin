# README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the project README in the concise style of `mai-bridge` and add an accurate project structure section.

**Architecture:** Replace the existing long-form operations manual with a user-first document whose sections follow installation and first-use order. Derive package metadata, required services, configuration names, command names, callback routes, and directory responsibilities from the current repository rather than copying assumptions from the reference project.

**Tech Stack:** Markdown, Koishi 4.18.7, TypeScript, Yakumo, PowerShell

## Global Constraints

- Modify `README.md` only for the implementation deliverable.
- Preserve unrelated working-tree changes in `src/platform/fallback-message.ts` and `src/services/update-service.ts`.
- Do not add package scripts, test tools, TypeScript, Vitest, vite-node, or `@types/node` dependencies.
- Build only through the Koishi root workspace with `yarn build`.
- Keep OAuth, public callback URL, sensitive-token, and controlled-proxy warnings concise but explicit.

---

### Task 1: Rewrite And Verify README

**Files:**
- Modify: `README.md`
- Reference: `package.json`
- Reference: `src/config.ts`
- Reference: `src/commands/*.ts`
- Reference: `src/server/*.ts`

**Interfaces:**
- Consumes: current package metadata, `ConfigSchema`, registered `mai.*` commands, HTTP routes, and repository directory layout.
- Produces: a standalone Chinese README for plugin installers, users, operators, and workspace developers.

- [ ] **Step 1: Replace the README structure**

Write these sections in order, using the current implementation as the source of truth:

```markdown
# koishi-plugin-mai-plugin
项目简介和 npm 徽章

## 功能
成绩查询、Takumi 图片渲染、曲目查询、猜歌、排卡、成绩更新

## 安装
Koishi 插件市场名称和 npm 包名

## 运行要求
Koishi、database、server、HTTP、Takumi 原生包和 QQ 富媒体兼容条件

## 基础配置
可直接使用的 YAML 示例和关键配置说明

## 查分器绑定
水鱼、落雪及查分器选择流程

## 常用命令
按使用场景列出主要命令

## 回调与兼容模式
落雪 OAuth、水鱼更新回调、publicBaseUrl 和 compatibilityMode

## 项目结构
根目录、assets、src 子目录的树形结构和职责

## 开发
从 C:\koishi-app 执行 yarn build

## 许可证
MIT
```

- [ ] **Step 2: Check README facts against source**

Run:

```powershell
rg "ctx\.command" src/commands -n
Get-Content -Raw -Encoding utf8 src/config.ts
Get-Content -Raw -Encoding utf8 package.json
```

Expected: every documented command, configuration key, dependency, and package name has a matching source declaration.

- [ ] **Step 3: Run Markdown and diff checks**

Run:

```powershell
git diff --check -- README.md
rg "TODO|TBD|npm (run|test)|Vitest|vite-node|@types/node" README.md
```

Expected: `git diff --check` exits successfully; the prohibited-content scan returns no matches.

- [ ] **Step 4: Build from the Koishi root workspace**

Run:

```powershell
cd C:\koishi-app
$env:NODE_OPTIONS='--max-old-space-size=256'
yarn build
```

Expected: after the Vite CJS API deprecation warning and several seconds of compilation, the command exits with code 0.

- [ ] **Step 5: Clean generated artifacts and commit only the README**

Run:

```powershell
cd C:\koishi-app
yarn clean mai-plugin
cd C:\koishi-app\external\mai-plugin
git add -- README.md
git diff --cached --check
git commit -m "docs: rewrite plugin README"
```

Expected: the commit contains only `README.md`; unrelated source modifications remain unstaged.
