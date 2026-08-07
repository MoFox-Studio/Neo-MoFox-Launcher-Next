# 012 — 动画化安装流程状态

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Missed opportunities / Interruptibility / Accessibility
- **Estimated scope**: 1 file，约 55 行修改

## Problem

安装日志当前使用裸 `v-show`。点击“安装日志”时，`display` 在显示与隐藏之间瞬间切换，240px 以内的日志区域直接出现或消失，执行页内容随之跳变。

```vue
<!-- src/renderer/src/views/InstallWizardView.vue:383-399 — current -->
<div class="log-panel">
  <button
    type="button"
    class="log-panel__toggle state-layer"
    @click="logPanelOpen = !logPanelOpen"
  >
    <span class="msr" aria-hidden="true">{{
      logPanelOpen ? 'expand_less' : 'expand_more'
    }}</span>
    安装日志
  </button>
  <div v-show="logPanelOpen" ref="logPanelRef" class="log-panel__body">
    <p v-for="(line, idx) in installStore.logLines" :key="idx" class="log-panel__line">
      {{ line }}
    </p>
  </div>
</div>
```

```css
/* src/renderer/src/views/InstallWizardView.vue:818-843 — current */
.log-panel {
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  overflow: hidden;
  margin-bottom: 24px;
}

.log-panel__body {
  max-height: 240px;
  overflow-y: auto;
  background: var(--md-sys-color-surface-container-highest);
  padding: 12px 16px;
}
```

安装进行中、失败和完成三种操作区也使用裸条件分支，后台状态更新时按钮与完成图标会瞬间替换。完成/失败是低频且重要的结果状态，短促入场能帮助用户识别安装已结束，但不应加入庆祝式弹跳或长动画。

```vue
<!-- src/renderer/src/views/InstallWizardView.vue:401-423 — current -->
<div class="execute-actions">
  <template v-if="installStore.isFailed">
    <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
      取消
    </button>
    <button type="button" class="btn btn--filled state-layer" @click="retryInstall">
      重试
    </button>
  </template>
  <template v-else-if="installStore.isDone">
    <span class="msr msr--fill execute-actions__done-icon" aria-hidden="true"
      >check_circle</span
    >
    <button type="button" class="btn btn--filled state-layer" @click="goToInstances">
      查看实例
    </button>
  </template>
  <template v-else>
    <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
      取消安装
    </button>
  </template>
</div>
```

## Target

### 日志展开

保留 `v-show`，在外层增加 Vue `<Transition name="log-reveal">` 与专用 grid reveal wrapper。不要过渡 `height` 或 `max-height`。wrapper 从 `grid-template-rows: 0fr` 过渡到 `1fr`，并同时使用 `clip-path` 和 opacity 遮住折叠内容；内部滚动节点继续持有 `ref="logPanelRef"`、`max-height: 240px` 与 `overflow-y: auto`。

所有属性持续时间严格为 `200ms`，使用现有 strong ease-out `--md-sys-motion-easing-emphasized-decelerate`（`cubic-bezier(0.05, 0.7, 0.1, 1)`）。CSS transition 可从当前插值状态重新定向，快速反复点击时不得用 keyframes 从零重启。

```vue
<!-- target -->
<Transition name="log-reveal">
  <div v-show="logPanelOpen" class="log-panel__reveal">
    <div ref="logPanelRef" class="log-panel__body">
      <p v-for="(line, idx) in installStore.logLines" :key="idx" class="log-panel__line">
        {{ line }}
      </p>
    </div>
  </div>
</Transition>
```

```css
/* target */
.log-panel__reveal {
  display: grid;
  grid-template-rows: 1fr;
  clip-path: inset(0 0 0 0);
  opacity: 1;
}

.log-reveal-enter-active,
.log-reveal-leave-active {
  transition:
    grid-template-rows var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-emphasized-decelerate),
    clip-path var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-emphasized-decelerate),
    opacity var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.log-reveal-enter-from,
.log-reveal-leave-to {
  grid-template-rows: 0fr;
  clip-path: inset(0 0 100% 0);
  opacity: 0;
}

.log-panel__body {
  min-height: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--md-sys-color-surface-container-highest);
  padding: 12px 16px;
}
```

`min-height: 0` 是 grid track 能收敛到 `0fr` 的必要条件。不要在 `.log-panel__body` 上设置 height transition；padding 保持原值，视觉裁切由外层 wrapper 完成。

### 完成与失败结果

进行中状态的“取消安装”保持原样且不做结果动画。把完成/失败两种分支放进一个 keyed result wrapper，并用 `<Transition name="execute-result">` 只做进入动画。结果从 `opacity: 0; transform: scale(0.97)` 进入 `opacity: 1; transform: scale(1)`，严格 `200ms` strong ease-out；不定义 leave 动画，重试时结果操作立即退出，不阻塞回到安装中状态。

目标结构应保持现有按钮、事件和分支优先级，仅新增承载动画所需的 wrapper：

```vue
<!-- target -->
<Transition name="execute-result">
  <div
    v-if="installStore.isFailed || installStore.isDone"
    :key="installStore.isFailed ? 'failed' : 'done'"
    class="execute-actions"
  >
    <template v-if="installStore.isFailed">
      <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
        取消
      </button>
      <button type="button" class="btn btn--filled state-layer" @click="retryInstall">
        重试
      </button>
    </template>
    <template v-else>
      <span class="msr msr--fill execute-actions__done-icon" aria-hidden="true"
        >check_circle</span
      >
      <button type="button" class="btn btn--filled state-layer" @click="goToInstances">
        查看实例
      </button>
    </template>
  </div>
</Transition>
<div v-if="!installStore.isFailed && !installStore.isDone" class="execute-actions">
  <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
    取消安装
  </button>
</div>
```

```css
/* target */
.execute-result-enter-active {
  transition:
    opacity var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-emphasized-decelerate),
    transform var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.execute-result-enter-from {
  opacity: 0;
  transform: scale(0.97);
}
```

reduced-motion 必须保留两类状态的 opacity 反馈，但移除 clip 和 scale 移动。日志 reveal 在 reduced-motion 下只淡入淡出 `200ms`；结果也只淡入 `200ms`。

```css
/* target: append inside existing prefers-reduced-motion block */
.log-reveal-enter-active,
.log-reveal-leave-active,
.execute-result-enter-active {
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.log-reveal-enter-from,
.log-reveal-leave-to {
  grid-template-rows: 1fr;
  clip-path: none;
}

.execute-result-enter-from {
  transform: none;
}
```

## Repo conventions to follow

- `src/renderer/src/styles/tokens.css:49-58` 已定义 `200ms` short4、standard easing 和 emphasized decelerate；不要新增 token。
- `src/renderer/src/views/InstallWizardView.vue:941-979` 已使用 Vue transition class 并在同文件的 reduced-motion 查询中移除 transform，可沿用 class 命名和媒体查询组织方式。
- `src/renderer/src/views/InstallWizardView.vue:790-816` 的进度动画已限制在 transform；不要改动该计划已完成的优化。
- `src/renderer/src/views/InstallWizardView.vue:144-150` 通过 `logPanelRef` 在日志增加后自动滚到底部。ref 必须继续指向具有 `scrollTop`/`scrollHeight` 和 `overflow-y: auto` 的 `.log-panel__body`，不能移到 reveal wrapper。
- 展开/折叠可被快速反转，因此必须使用 CSS transitions，不使用 `@keyframes`。

## Steps

1. 在 `src/renderer/src/views/InstallWizardView.vue:394-398` 外包裹 `<Transition name="log-reveal">`，并在 `v-show` 节点与 `.log-panel__body` 之间引入 `.log-panel__reveal` wrapper，结构严格按 Target；保留 `v-show`，不要改成 `v-if`。
2. 让 `v-show="logPanelOpen"` 位于 `.log-panel__reveal`；让 `ref="logPanelRef"` 和现有日志循环继续位于内部 `.log-panel__body`。
3. 在 scoped CSS 中加入 `.log-panel__reveal`、`.log-reveal-enter-active/.log-reveal-leave-active` 和 from/to 规则；三项过渡均为 `200ms` emphasized decelerate。不要添加 `height`、`max-height` transition。
4. 给现有 `.log-panel__body` 增加 `min-height: 0`；其余 `max-height: 240px`、滚动、背景与 padding 保持不变。
5. 重构 `src/renderer/src/views/InstallWizardView.vue:401-423`：完成和失败共用一个 keyed `.execute-actions` result wrapper，并置于 `<Transition name="execute-result">`；进行中状态保留为 transition 外的独立 `.execute-actions`。保持失败优先于完成的现有判断语义。
6. 添加仅进入的 `.execute-result-enter-active` 与 `.execute-result-enter-from`，使用 `opacity + scale(0.97 → 1)`、`200ms` emphasized decelerate。不要定义 `.execute-result-leave-*`，不要使用 `mode="out-in"`。
7. 在现有 `@media (prefers-reduced-motion: reduce)` 中追加 Target 所示覆盖：日志与结果只过渡 opacity `200ms` standard；日志不折叠 grid track、不 clip；结果 transform 为 none。
8. 检查 scoped transition class 能命中 Vue 生成的节点，并确认模板只有一个 result transition child，不产生 Vue Transition 多根警告。

## Boundaries

- 只修改 `src/renderer/src/views/InstallWizardView.vue`。
- 不要修改 `installStore`、IPC、安装请求、重试/取消/跳转函数、状态优先级、进度计算或日志自动滚动逻辑。
- 不要动画 `height`、`max-height`、margin、padding、top 或 left；日志展开只使用本计划规定的 grid/clip/opacity。
- 不要给结果加入 bounce、旋转、位移、彩屑、颜色闪烁、stagger 或声音。
- 不要改变进度条、wizard 步骤切换、spinner 或已有 keyframes。
- 不要改变按钮文案、类名、事件、disabled 行为或完成图标。
- 不要添加依赖或全局 motion token。
- 如果 commit `9285f50` 之后 `InstallWizardView.vue:131-150`、`383-423`、`818-862` 或 `962-989` 与摘录发生漂移，停止并报告，不要自行套用。

## Verification

- **Mechanical**：在仓库根目录依次运行：
  - `npm run typecheck:renderer`；预期退出码为 0，且 Vue Transition 模板无类型错误。
  - `npm run lint`；预期退出码为 0。
  - `npm test`；预期全部测试通过。
  - `npm run build:renderer`；预期 renderer 构建成功且无 Transition 多根警告。
- **Feel check — 日志**：运行 `npm run dev:demo` 并进入安装执行页：
  - 点击“安装日志”，日志在 `200ms` 内通过 grid 收放、向上裁切和 opacity 平滑展开/折叠；
  - 展开过程不通过 `height`/`max-height` transition，日志上限仍为 `240px`，内容过多时内部正常滚动；
  - 在展开/折叠尚未结束前连续反向点击，动画从当前视觉状态平滑反向，不跳回起点、不等待前一次结束；
  - 安装期间新增日志时仍自动滚到底部，折叠后新增日志不抛错，再展开可看到最新行。
- **Feel check — 结果**：分别制造安装成功和失败：
  - 完成图标与“查看实例”、失败的“取消/重试”均从 `scale(0.97)` 和 opacity 0 在 `200ms` 内克制入场；
  - 不发生位移、弹跳或延迟；按钮在动画期间保持可点击；
  - 失败后点击“重试”，结果区立即退出并恢复“取消安装”，没有离场空档或 `mode="out-in"` 等待。
- 在 DevTools Animations 面板以 `10%` 播放：
  - 日志轨迹恰为 `200ms`，没有 height/max-height transition 或 keyframes；
  - result 只有 enter 轨迹，scale 精确从 `0.97` 到 `1`。
- 在 Performance 面板记录日志展开：确认没有 JavaScript rAF；允许 grid track 插值产生必要布局，但不得出现由 height/max-height transition 引起的动画。
- 在 Rendering 面板模拟 `prefers-reduced-motion: reduce`：
  - 日志区域只做 `200ms` opacity，尺寸立即处于最终展开/折叠状态且无 clip 动画；
  - 完成/失败只做 `200ms` opacity，transform 始终为 none。
- **Done when**：日志 `v-show` 具备可中断的 `200ms` grid/clip/opacity transition，未动画 height；完成与失败严格使用 `opacity + scale(0.97 → 1)` 的 `200ms` ease-out 进入；reduced-motion 两者均为 opacity-only。
