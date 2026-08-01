# Neo-MoFox Launcher 重构方案

> 保持 Electron，在独立的新工程中以 TypeScript 重写主进程、预加载层、服务层和 Vue 3 渲染层，并沿用 Material Design 3。
> 

## 背景与目标

### 现状

当前项目使用 Electron、CommonJS 和原生 HTML/CSS/JavaScript。渲染层包含多个独立页面、手写 DOM 操作以及大量通过 `window.mofoxAPI` 调用的 IPC 能力。主进程已经承载实例管理、安装、PTY、配置存储、平台适配和窗口生命周期等关键逻辑。

本次重构用于提升全栈类型安全、界面可维护性与 Material 3 一致性，同时避免影响成熟的本地服务能力。

### 本次要达成

- 保持 Electron 作为桌面运行时与打包框架。
- 使用 TypeScript 统一主进程、预加载层、服务层和 Vue 3 渲染层的新代码。
- 使用 Vite 作为渲染层开发服务器和生产构建工具。
- 延续 Material Design 3 的设计语言、现有动态主题能力与 Material Symbols 图标资产。
- 将 IPC 桥接 API 收敛为共享的 TypeScript 契约，避免渲染层使用无类型的 `window.mofoxAPI`。
- 在独立代码目录中完全重写应用，并以旧版本的行为、数据格式和验收流程作为参考。

> **范围边界**
> 

> Electron、electron-builder、node-pty、现有数据格式和用户可见业务语义继续保留。主进程、preload、服务层和渲染层均在新工程中重新实现；旧 JavaScript 不参与新应用运行，也不作为兼容层。
> 

---

## 技术栈

| 层级 | 选型 | 说明 |
| --- | --- | --- |
| 桌面运行时 | Electron | 继续负责窗口、系统能力、IPC 与发布打包。 |
| 主进程 | Node.js + TypeScript | 负责窗口、IPC 与系统能力；在新工程中重新实现。 |
| 预加载层 | TypeScript | 编译为本地 preload bundle；继续开启 `contextIsolation: true` 和关闭 `nodeIntegration`，只暴露白名单 API。 |
| 渲染层 | Vue 3 + TypeScript | 使用 Composition API、单文件组件和 Vue Router。 |
| 构建工具 | Vite | 负责 renderer 热更新、类型检查前的模块解析和生产资源构建。 |
| 状态管理 | Pinia | 承载实例、设置、环境检测和安装任务等跨页面状态。 |
| UI | Material Design 3 | 使用项目已有 `@material/material-color-utilities` 和 `material-symbols`，组件优先选择 Material Web。 |
| 测试 | Vitest + Vue Test Utils；Playwright（可选） | 前者覆盖组件、store 与 IPC 适配器，后者覆盖关键桌面流程。 |
| 代码质量 | TypeScript、ESLint、Prettier | 在 CI 中执行类型检查、静态检查和单元测试。 |

建议新增依赖：`vue`、`vue-router`、`pinia`、`vite`、`@vitejs/plugin-vue`、`typescript`、`vue-tsc`、`@material/web`、`vitest`、`@vue/test-utils`、`eslint`、`prettier`。保留 `@material/material-color-utilities`、`material-symbols`、CodeMirror 与 xterm.js。

---

## 架构与边界

```mermaid
flowchart LR
  Vue[Vue 3 + TypeScript Renderer] --> Store[Pinia Stores]
  Store --> Client[Typed mofoxAPI Client]
  Client --> Preload[Preload Bridge]
  Preload --> IPC[Electron IPC]
  IPC --> Main[Electron Main Process]
  Main --> Services[Existing Services and PTY]
```

### 主进程

主进程负责所有可信任操作：文件系统、进程、PTY、系统对话框、窗口控制、实例生命周期和设置持久化。新 IPC 契约按目标领域重新设计；仅保留现有业务能力与数据兼容性，不要求保留旧 handler 的通道名称。

主进程完全使用 TypeScript。新工程不引用旧 `main.js`、CommonJS IPC 注册或旧服务实现；先定义领域模型与 IPC 类型，再实现窗口管理、IPC 注册和各业务服务。不要让渲染层直接访问 Node.js 或服务实现。

### 预加载桥

预加载层是唯一允许使用 `ipcRenderer` 的渲染侧边界。它应继续通过 `contextBridge.exposeInMainWorld('mofoxAPI', api)` 提供白名单 API，并补齐每个调用的参数、返回值、事件 payload 与取消订阅类型。

事件监听函数必须返回取消订阅函数，避免 Vue 组件卸载后保留 `ipcRenderer` listener。新桥接 API 以类型契约为准，不兼容旧 API 的不安全调用方式。

### Vue 渲染层

Vue 页面和组件只依赖 store、composable、类型化 API client 与 UI 组件。DOM 查询、全局可变状态和页面间 `postMessage` 不再作为新功能的实现方式。

页面状态按领域拆分：实例、安装、OOBE、环境、设置、日志和版本。短生命周期 UI 状态放在组件内，跨路由或需持久化的状态放入 Pinia store。

> **不可突破的安全约束**
> 

> 渲染层不得直接访问 Node.js、服务实现或 `ipcRenderer`。所有跨进程能力必须经过 preload 白名单 API；`contextIsolation: true` 和 `nodeIntegration: false` 保持不变。
> 

---

## 目标目录

```
Neo-MoFox-Launcher/
  src/
    main/
      index.ts
      ipc/
      utils/                     # 主进程 Node 工具层
        process-service.ts       # 统一子进程入口（spawn + pty）
        platform-helper.ts
        logger.ts
        mirror.ts
        range-downloader.ts
        native-file-remover.ts
      platforms/                 # Bot 平台适配层（非 OS 平台）
        base-platform.ts
        registry.ts
        napcat/
          index.ts metadata.ts installer.ts
          config.ts  updater.ts  runtime.ts    helpers.ts
        snowluma/
          index.ts metadata.ts installer.ts
          config.ts  updater.ts  runtime.ts    helpers.ts
    preload/
      index.ts
    shared/
      ipc.ts                     # API、事件与数据模型类型
      domain/
        system-env.ts
        mirror.ts
        bot-platform.ts
        logger.ts
        download.ts
    renderer/
      index.html
      src/
        main.ts
        App.vue
        router/
        views/
          DashboardView.vue
          InstancesView.vue
          InstallWizardView.vue
          OobeView.vue
          SettingsView.vue
        components/
        composables/
        stores/
        services/
          mofox-api.ts
        styles/
          tokens.css
          material-theme.css
      vite-env.d.ts
  vite.config.ts
  tsconfig.json
  tsconfig.main.json
  tsconfig.preload.json
```

新工程应使用独立目录或独立仓库，例如 `Neo-MoFox-Launcher-Next/`。旧工程保持只读，用于核对行为、数据格式、安装产物和回归用例；新工程不得导入旧 `src/main.js`、`src/preload.js`、旧页面或服务模块。Vue 入口位于新工程的 `src/renderer/src` 中。

---

## IPC 类型契约

首先建立 `src/shared/ipc.ts`，由 preload、renderer 以及未来的 main IPC 注册层共同引用。它至少包含以下内容：

- `MofoxApi`：所有 `invoke` 方法的参数和 `Promise` 返回值。
- `MofoxEventMap`：`log-output`、`install-progress`、`instance-pty-data`、`window-maximize-changed` 等事件的 payload 类型。
- 领域模型：`Instance`、安装输入与进度、环境检查结果、设置、终端状态和平台信息。
- `Unsubscribe`：事件监听的统一返回类型。

渲染层通过一个窄适配器访问桥接 API：

```tsx
// renderer/src/services/mofox-api.ts
import type { MofoxApi } from '../../../shared/ipc';

export const mofoxApi = window.mofoxAPI as MofoxApi;
```

同时通过 `renderer/src/vite-env.d.ts` 声明全局对象：

```tsx
import type { MofoxApi } from '../../shared/ipc';

declare global {
  interface Window {
    mofoxAPI: MofoxApi;
  }
}

export {};
```

该契约是重写的第一道质量门：任何新增 IPC 通道必须同时定义参数、返回值与错误语义；任何 Vue 组件不得直接使用字符串形式的 IPC channel。

> **质量门 01**
> 

> `src/shared/ipc.ts` 是 main、preload 和 renderer 的单一契约来源。没有类型定义的 IPC 通道不得新增；所有事件订阅必须可取消。
> 

---

## 主进程工具层与平台层

`src/main/utils/` 与 `src/main/platforms/` 是主进程内部能力，依赖 Node API（fs / child_process / net / http / os / zlib），只在主进程内运行，不向 renderer 直接暴露；renderer 通过 IPC 间接触发。文件统一使用 kebab-case 命名（如 `platform-helper.ts`）。

### `src/main/utils/` —— 主进程 Node 工具层

- **`process-service.ts`** —— 子进程统一入口，**API 层面统一、底层分开**。对外两个方法：
  - `runOneShot(cmd, args, opts): Promise<ExecResult>` —— 一次性命令，内部用 `child_process.spawn`，stdout/stderr 分离、Promise 化、收退出码、超时杀进程。
  - `attachInteractive(cmd, args, opts): PtySession` —— 长生命周期交互终端，内部用 `node-pty`，输出为 TTY 流（含 ANSI 颜色码），通过事件推送 data/exit。

  不强行把所有子进程都改成 node-pty：一次性命令（`taskkill`、`apt-get install`、版本检查）保留 spawn 的轻量与分离 stdout/stderr；交互终端（跑 bot 实例）才用 PTY 的真实终端语义。`ExecResult` 与 `PtySession` 类型留 main 内部，不进 `shared/domain/`（renderer 经 IPC 拿到的是已解析过的事件 payload，不直接接触这两个类型）。
- **`platform-helper.ts`** —— OS 多平台便捷调用。**不用**配置表，仅导出系统判断函数与跨系统便捷调用，全部为 module 级函数（无状态部分纯函数，有状态部分显式 memo）。提供：
  - 系统判断：`isWindows()` / `isLinux()` / `isMac()`
  - 系统环境检测：`detectSystemEnv()` 返回 arch/osType/osRelease/hostname/homedir/tmpdir/shell，Linux 下解析 `/etc/os-release` 识别发行版（debian/arch/redhat/suse）与包管理器（apt/pacman/dnf/yum/zypper）
  - Python/uv 解释器：`pythonExeName()`、`findVenvPython(projectDir)`
  - 进程管理：`spawnProcess` / `execCommand` / `killProcessTree` 改为薄封装，转调 `process-service`（不再直接 `require('child_process')`）；`killProcessTree(pid, signal)` 走 tree-kill 优先、回退 `taskkill`/`kill`
  - 解压：`unzip(zipPath, destDir)` 走 extract-zip 库
  - shell 引号：`quoteShellArg(arg)` 按平台规则转义（Windows 双引号、POSIX 单引号）、`prepareArgsForShell(args, useShell)`
  - spawn env：`buildSpawnEnv(extraEnv)` 注入 `PYTHONIOENCODING=utf-8`/`PYTHONUNBUFFERED=1`，Linux/macOS 下补 `~/.cargo/bin`、`~/.local/bin`、`~/bin` 到 PATH
  - Windows 下 spawn 自动前置 `chcp 65001` 以保证 UTF-8 输出

  **不再包含**：`PLATFORM_CONFIG` 表、`getKillCommand`（并入 `killProcessTree` 内部分支）、`getPackageManagerUpdateCmd`/`getPackageManagerInstallCmd`（包管理器命令生成移到 environment service 等使用方）。
- **`logger.ts`** —— 统一日志服务。文件写入、按日期/大小轮转、gzip 归档、历史读取。配置项（`maxFileSize`/`maxArchiveDays`/`compressArchive`）通过依赖注入的 SettingsService 读取，不再用 `require` 延迟导入打破循环依赖。
- **`mirror.ts`** —— 镜像源管理。集中维护 GitHub 与 Python FTP 镜像列表，通过 TCP 连接延迟检测选最优镜像；提供统一 URL 获取接口，供安装、许可证加载、版本检查复用。
- **`range-downloader.ts`** —— HTTP Range 分片并发下载器。纯 Node `http`/`https`/`fs`，默认并发 8、最小分片 32MB、最大重定向 5；进度回调带节流（200ms / 1% 增量），避免淹没 IPC 与渲染进程。
- **`native-file-remover.ts`** —— 原生文件删除。绕过 Node.js 对 asar 路径的特殊处理；`removePathNative` 走平台原生命令，`removePathSafe` 失败时回退 `noAsar` 模式。

### `src/main/platforms/` —— Bot 平台适配层

> 注意：此处「platform」指 QQ bot 框架适配器（napcat、snowluma），**不是 OS 平台**。二者维度不同，命名上易混淆，需在文档中明确区分。

- **`base-platform.ts`** —— 新平台继承用的抽象基类 `BaseBotPlatform`，`implements BotPlatform`（接口来自 `shared/domain/bot-platform.ts`）。声明所有平台必须实现的抽象成员（`id`/`name`/`supportedPlatforms`/`supportedArch`/`isAvailable`/`install`/`getStartCommand` 等），并提供共享具体方法（如日志、根目录解析）供子类复用。新增平台时 `extends BaseBotPlatform` 即可，未实现抽象成员会在 `vue-tsc` 编译期报错。等价于 Python 的 `abc.ABC` + `@abstractmethod`。
- **`registry.ts`** —— `PlatformRegistry` 平台注册表，类型为 `BotPlatform[]`，注册时校验必填元数据与能力函数；依赖 `utils/` 里的 platform-helper / mirror / range-downloader。
- **`napcat/`** —— `class NapCatPlatform extends BaseBotPlatform`，基于 NapCatQQ 的 OneBot 11 接入，当前仅 Windows x64。模块切分：`index` 导出单实例、`metadata` 元数据、`installer`/`config`/`updater`/`runtime` 四能力方法、`helpers` 平台内部工具。
- **`snowluma/`** —— `class SnowLumaPlatform extends BaseBotPlatform`，同 7 模块切分，跨平台支持范围由其自身 metadata 声明。

### 与 `shared/domain/` 的契约关系

下列类型须由 utils 与 platforms 模块在 `shared/domain/` 中预先声明，供 main / preload / renderer 三方共用，避免各进程自定义形状导致漂移：

> 原则：**只有跨 IPC 边界、renderer 需要展示或消费的返回类型才入 domain；main 内部用的类型（如 `OsPlatformConfig`、`ExecResult`、`PtySession`）留在 main 内部**。

- `system-env.ts` —— `SystemEnvInfo`（renderer 环境页展示）
- `mirror.ts` —— `MirrorSource`、`MirrorType`、`MirrorSelection`（renderer 镜像选择 UI）
- `bot-platform.ts` ——
  - `BotPlatform` **interface**（registry 用的契约类型）
  - `BaseBotPlatform` 不在此处（运行时基类在 `src/main/platforms/base-platform.ts`）
  - `BotPlatformMetadata`、`SystemRequirement`、`PlatformAvailability`、`PlatformInstaller`/`PlatformConfig`/`PlatformUpdater`/`PlatformRuntime` 能力接口、`StartCommand`、`InstallContext`、`InstallResult`
- `logger.ts` —— `LogLevel`、`RotationMode`、`LogEntry`（renderer 日志查看器）
- `download.ts` —— `DownloadProgress`、`RangeDownloadOptions`（renderer 安装进度条）

> **质量门 02**
> 

> `src/main/utils/` 与 `src/main/platforms/` 中所有模块：
> - 不再使用 `require` / `module.exports`，统一 ESM `import`/`export` + TypeScript。
> - 所有 JSDoc `@param`/`@returns` 必须升级为真实 TS 类型；公共返回类型须同步到 `shared/domain/` 供 renderer 复用。
> - 单例服务（Logger、Mirror 等）改为 module 级函数导出，依赖（如 SettingsService）通过参数注入，不再用延迟 `require` 打破循环依赖。
> - OS 平台分支必须收敛到 `platform-helper.ts` 内部，禁止散落的 `process.platform === 'win32'` 字面量判断。
> - 所有子进程调用必须经 `process-service.ts`，禁止直接 `require('child_process')` 或 `require('node-pty')`；一次性命令走 `runOneShot`（spawn），交互终端走 `attachInteractive`（pty）。
> - bot 平台必须 `extends BaseBotPlatform`，由 `PlatformRegistry` 在注册时按 `BotPlatform` 接口校验；不得绕过基类直接 `implements BotPlatform` 构造字面量对象。
> 

---

## 安装流程与生命周期

适用于 MoFox 实例本体及 napcat、snowluma 等平台依赖的全部安装任务，约束 `platforms/*/installer.ts` 与 `InstallWizardView` 的实现。

### 临时目录先行

- 所有安装任务先在 `os.tmpdir()` 下的 `mofox-install-<instanceId>-<step>-<ts>` 临时目录中完成下载、解压、依赖装配与校验，**全部成功后**再原子地移动到最终安装目录。
- 最终安装目录在临时阶段不落地任何中间产物，避免失败后残留半成品。
- 跨卷移动由 `platform-helper` 按平台规则处理（Windows `MoveFileEx`、POSIX `rename`，跨卷回退 copy+truncate）。

### 失败与重试

- 安装失败仅给「重试 / 取消」二选一，**不提供续装**。
- **重试**：回退到当前步骤开头（删除本步骤已落地的临时产物，恢复到该步骤起始状态），再从头执行该步骤；不跨步骤回退，每次重试等价于该步骤的一次全新执行。
- **取消**：直接删除整个临时目录，不留残留，回到未开始状态。

### 退出安装界面

- 在安装进行中离开安装界面（返回、切路由、最小化窗口等）**不停止安装**，转入后台继续执行。
- 进度由 Pinia store 与 IPC 事件流保持，用户可回到安装界面继续查看实时进度与日志。
- 后台完成正常落盘并通知；后台失败按上面「失败与重试」规则保留失败态等待用户回界面处理。

### 关闭主窗口

- 主窗口关闭（标题栏 X、Alt+F4 等）在存在进行中的安装任务时弹出二次确认，明确告知「仍有实例正在安装，关闭将停止安装并删除已下载内容」。
- 用户选**确认关闭**：取消所有进行中的安装任务，删除对应临时目录与已落地内容，再关闭主窗口。
- 用户选**取消**：不关闭主窗口，留在安装界面。

### 取消安装

- 安装界面内的「取消」按钮：直接删除该实例的临时目录与已落地内容，不弹二次确认，取消即放弃。
- 已移到最终安装目录的产物不在本规则范围内（删除已安装实例走实例管理流程）。

> **质量门 03**
> 
> - 临时目录先行，最终目录原子落地；任何步骤失败不得在最终目录残留半成品。
> - 不提供续装能力；失败只能重试（同步骤回退重来）或取消（整体删除）。
> - 退出安装界面一律转后台，不得停止或丢弃进行中的安装任务。
> - 关闭主窗口在有进行中安装时必须二次确认；确认后取消任务并删除临时内容。
> - 取消安装直接删除临时目录，不得保留任何残留。
> 

---

## Material Design 3

### 主题与资产

- 继续使用 `@material/material-color-utilities` 生成亮色和暗色 token。
- 复制并纳入版本控制项目所需的 `assets/material-symbols` 图标资产。
- 在新主题系统中定义 Material 3 semantic token，例如 `--md-sys-color-surface`、`--md-sys-color-primary`、`--md-sys-color-on-surface`。
- 将主题初始化前置到 Vue 挂载前，避免启动时主题闪烁。

### 组件策略

优先使用 `@material/web` 的可访问组件，如按钮、文本框、选择框、对话框、菜单、标签页、开关、进度条和导航组件。对于实例卡片、PTY 终端容器和复杂安装流程，使用 Vue 组件组合 Material 3 token 实现，不强行套用不适合的通用组件。

避免复制旧 CSS 的结构和局部 token。新工程只维护一套 Material 3 token，并根据旧版本的视觉效果和可用性目标重新实现组件。

---

## 测试覆盖

### IPC 全链路覆盖

测试必须覆盖 IPC 全链路三层，缺一不可：

- **`shared/ipc.ts` 类型层**：由 `vue-tsc` 在 CI 中执行类型检查作为编译期门；任何新增通道未定义类型即编译失败。
- **main IPC 注册层**：每个 `ipcMain.handle` / `ipcMain.on` 通道必须有对应单元测试，覆盖正常路径、参数校验、错误返回与边界；mock 掉 `utils/` 与 `platforms/` 实现，断言 invoke 入参与返回 payload 形态与 `MofoxApi` 契约一致。
- **preload 桥接层**：对 `contextBridge.exposeInMainWorld('mofoxAPI', ...)` 暴露的每个 API 方法测试参数透传与事件订阅可取消性；事件 listener 必须返回 `Unsubscribe`，且调用后 `ipcRenderer.removeListener` 真正移除。
- **renderer API client**：`services/mofox-api.ts` 仅做类型窄化、不引入新行为，不单独写运行时测试，由各业务 store 的集成测试覆盖其调用面。

**不允许**：仅有类型定义而无 handler 测试；handler 测试断言 Node 内部实现而非 IPC 契约；preload 测试绕过 `contextBridge` 直接调 `ipcRenderer`。

> **质量门 04**
> 
> IPC 三层（shared 类型 / main handlers / preload 桥）必须有对应测试；新增或修改通道未补测试视为不通过，CI 中 IPC 通道测试覆盖率以通道为粒度须达 100%。

### 面向用户函数的边界用例

对 main/ipc 中每一个面向用户的 IPC 函数（安装、卸载、启动/停止实例、镜像测速、环境检测、版本检查、下载、解压等），除 happy path 与契约测试外，必须穷举「刁钻」边界用例。下面以 `install` 为模板，其余函数按各自语义类推：

其余面向用户函数（启动/停止实例、卸载、版本检查、镜像测速、环境检测）按各自语义对照上述五类逐一补全；CI 以「每个面向用户函数至少 N 个边界用例」为门，N 由 review 决定，下限不少于 8。

> **质量门 05**
> 
> 每个面向用户的 IPC 函数必须有边界用例测试，至少覆盖资源/IO 失败、时序竞态、输入异常、进程级中断、契约与状态一致性五类；仅 happy path + 单一错误码的测试不通过。