# 007 — 优化错误日志展开揭示

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Performance / Interruptibility / Accessibility
- **Estimated scope**: 1 file, about 80 lines changed

## Problem

`ErrorDialog.vue` 通过 computed 内联 `height` 在折叠态 `160px` 和展开态 `360px` 之间切换，再直接 transition `height` 300ms。高度的每一帧插值都会触发布局；弹窗、操作区和日志后的内容也会跟随重排。长堆栈正在排版和滚动时，这种主线程工作尤其容易掉帧。

`src/renderer/src/components/ErrorDialog.vue:34-48` 当前完整状态与样式计算代码：

```ts
// 日志框默认折叠，避免长堆栈抢占弹窗视觉重心。
const expanded = ref(false);

// 每次打开时复位展开状态，保证多次复用时的初始体验一致。
watch(
  () => props.open,
  (open) => {
    if (open) expanded.value = false;
  },
);

// 折叠态下若日志过长则尾部淡出，提示用户可展开查看更多。
const logboxStyle = computed(() => ({
  height: expanded.value ? `${props.expandedHeight}px` : `${props.collapsedHeight}px`,
}));
```

`src/renderer/src/components/ErrorDialog.vue:60-62` 当前切换代码：

```ts
function toggleExpanded(): void {
  expanded.value = !expanded.value;
}
```

`src/renderer/src/components/ErrorDialog.vue:83-113` 当前完整日志区域模板：

```vue
<!-- 仅在存在堆栈时展示日志框，避免空白区域 -->
<div v-if="stack" class="error-dialog__log-wrap">
  <div class="error-dialog__logbar">
    <button
      class="error-dialog__log-toggle state-layer"
      type="button"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <span class="msr error-dialog__log-toggle-icon" aria-hidden="true">
        {{ expanded ? 'expand_less' : 'expand_more' }}
      </span>
      <span>{{ expanded ? '收起堆栈' : '展开堆栈' }}</span>
    </button>
    <button
      class="error-dialog__copy state-layer"
      type="button"
      title="复制堆栈"
      aria-label="复制堆栈"
      @click="copyStack"
    >
      <span class="msr" aria-hidden="true">content_copy</span>
      <span>复制</span>
    </button>
  </div>
  <pre
    class="error-dialog__logbox"
    :class="{ 'error-dialog__logbox--collapsed': !expanded }"
    :style="logboxStyle"
  >{{ stack }}</pre>
</div>
```

`src/renderer/src/components/ErrorDialog.vue:186-218` 当前完整日志框样式：

```css
/* 等宽日志框：固定高度、内部滚动，折叠态保留底部淡出提示 */
.error-dialog__logbox {
  margin: 0;
  padding: 12px 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  position: relative;
  transition: height var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.error-dialog__logbox--collapsed::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 24px;
  border-bottom-left-radius: var(--md-sys-shape-corner-medium);
  border-bottom-right-radius: var(--md-sys-shape-corner-medium);
  background: linear-gradient(
    to bottom,
    transparent,
    var(--md-sys-color-surface-container)
  );
  pointer-events: none;
}
```

`src/renderer/src/components/ErrorDialog.vue:236-240` 当前 reduced-motion 代码：

```css
@media (prefers-reduced-motion: reduce) {
  .error-dialog__logbox {
    transition: none;
  }
}
```

## Target

采用两阶段 `clip-path` reveal，不采用 `grid-template-rows`：网格轨道从 `0fr` 到 `1fr` 的插值仍会在每帧重新计算轨道与后续内容布局，不能满足“无逐帧 Layout”。目标方案只在展开开始时或收起结束时同步一次容器高度；200ms 可见动画仅 transition `clip-path`，不 transition `height`。

状态职责必须分离：

- `expanded`：用户意图和可见 reveal 状态，继续驱动 `aria-expanded`、按钮图标和文字。
- `logboxExpanded`：日志框当前占用的布局高度。展开时先同步为展开高度，再在下一帧揭示；收起时先裁剪，`clip-path` transition 完成后才同步为折叠高度。
- 正常偏好使用精确 `200ms cubic-bezier(0.23, 1, 0.32, 1)`。
- reduced-motion 下两个状态同步更新，不播放 reveal，也不等待不存在的 `transitionend`。
- 高度仅允许在切换边界离散更新一次；不得 transition/animate `height`、`max-height`、`grid-template-rows`、padding 或 margin。

### 目标脚本

把 Vue import 和日志展开相关状态替换为以下完整目标实现；保留 `copyStack`、`onClose` 等无关逻辑：

```ts
import { computed, nextTick, ref, watch } from 'vue';

// 日志框默认折叠，避免长堆栈抢占弹窗视觉重心。
const expanded = ref(false);
const logboxExpanded = ref(false);

const collapsedLogHeight = computed(() => Math.max(0, props.collapsedHeight));
const expandedLogHeight = computed(() =>
  Math.max(collapsedLogHeight.value, props.expandedHeight),
);
const logRevealDistance = computed(
  () => expandedLogHeight.value - collapsedLogHeight.value,
);

// 每次打开时复位语义状态和布局状态，保证多次复用时的初始体验一致。
watch(
  () => props.open,
  (open) => {
    if (open) {
      expanded.value = false;
      logboxExpanded.value = false;
    }
  },
);

const logboxStyle = computed(() => ({
  height: `${logboxExpanded.value ? expandedLogHeight.value : collapsedLogHeight.value}px`,
  '--error-log-reveal-distance': `${logRevealDistance.value}px`,
}));

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function toggleExpanded(): Promise<void> {
  if (prefersReducedMotion()) {
    expanded.value = !expanded.value;
    logboxExpanded.value = expanded.value;
    return;
  }

  if (expanded.value) {
    expanded.value = false;
    return;
  }

  if (logboxExpanded.value) {
    // 收起动画尚未结束时反向展开；CSS transition 从当前裁剪位置继续。
    expanded.value = true;
    return;
  }

  // 先离散同步布局高度，再等浏览器提交一帧，避免高度变化吞掉 reveal 起点。
  logboxExpanded.value = true;
  await nextTick();
  requestAnimationFrame(() => {
    if (logboxExpanded.value) expanded.value = true;
  });
}

function onLogboxTransitionEnd(event: TransitionEvent): void {
  if (event.target !== event.currentTarget || event.propertyName !== 'clip-path') return;
  if (!expanded.value) logboxExpanded.value = false;
}
```

`Math.max(0, collapsedHeight)` 防止负高度；`Math.max(collapsedLogHeight, expandedHeight)` 保证展开高度永远不小于折叠高度。当两者相等时 reveal distance 为 `0px`，切换仍正确但没有可见位移。

### 目标模板

保留 logbar 完整结构，只把当前 `<pre>` 替换为一个负责高度/裁剪的 viewport 和一个负责滚动、排版的 `<pre>`：

```vue
<div
  class="error-dialog__log-viewport"
  :class="{
    'error-dialog__log-viewport--layout-expanded': logboxExpanded,
    'error-dialog__log-viewport--revealed': expanded,
  }"
  :style="logboxStyle"
  @transitionend="onLogboxTransitionEnd"
>
  <pre
    class="error-dialog__logbox"
    :class="{ 'error-dialog__logbox--collapsed': !expanded }"
  >{{ stack }}</pre>
</div>
```

按钮继续使用 `:aria-expanded="expanded"` 和既有文字/图标表达式。不要把 ARIA 改绑到 `logboxExpanded`，因为后者只是内部布局阶段。

### 目标样式

用以下样式替换当前 `.error-dialog__logbox` 基础规则，并保留当前折叠渐变伪元素规则。项目的 `src/renderer/src/styles/base.css:4-6` 已对所有元素和伪元素应用 `box-sizing: border-box`，因此传入的高度继续表示日志框完整 border-box 高度。

```css
/* viewport 离散同步布局高度；可见揭示只动画 clip-path。 */
.error-dialog__log-viewport {
  min-height: 0;
  overflow: hidden;
  border-radius: var(--md-sys-shape-corner-medium);
  clip-path: inset(0 0 var(--error-log-reveal-distance) 0 round var(--md-sys-shape-corner-medium));
  transition: clip-path 200ms cubic-bezier(0.23, 1, 0.32, 1);
}

.error-dialog__log-viewport--revealed {
  clip-path: inset(0 0 0 0 round var(--md-sys-shape-corner-medium));
}

.error-dialog__logbox {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 12px 16px;
  border-radius: inherit;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  position: relative;
}
```

将现有 reduced-motion 规则替换为：

```css
@media (prefers-reduced-motion: reduce) {
  .error-dialog__log-viewport {
    transition: none;
    clip-path: none;
  }
}
```

`clip-path: none` 确保 reduced-motion 下不隐藏折叠框内容；实际可见区域仍由 viewport 的折叠高度和 `overflow: hidden` 限定。脚本分支会同步 `expanded` 与 `logboxExpanded`，因此不会等待 `transitionend`。

## Repo conventions to follow

- `src/renderer/src/components/BaseDialog.vue:177-214` 使用 CSS transition 并在 `prefers-reduced-motion: reduce` 下移除 transform、保留更温和反馈；本计划同样由 CSS media query负责视觉降级，但因收起流程依赖 transition end，脚本还必须同步分支。
- `src/renderer/src/styles/tokens.css:55-59` 中 `short4` 是 200ms、`medium2` 是 300ms。本计划按要求明确使用 `200ms cubic-bezier(0.23, 1, 0.32, 1)`，不要修改全局 Material token 的值或语义。
- 使用 CSS transition 而非 keyframes：用户可快速反向切换，transition 会从当前 `clip-path` 插值位置重定向，不应从零重播。
- 保留现有固定高度 props API（默认折叠 160px、展开 360px）和日志框内部 `overflow: auto`；不要改调用方。

## Steps

1. 在 `src/renderer/src/components/ErrorDialog.vue` 的 Vue import 中加入 `nextTick`。
2. 按“目标脚本”增加 `logboxExpanded`、三个归一化高度 computed 与 `prefersReducedMotion`；更新 open watcher，使每次打开同时复位语义和布局状态。
3. 按目标代码改写 `logboxStyle`。只能把高度离散绑定到 `logboxExpanded`，并提供精确的 `--error-log-reveal-distance`；不得为 height 添加 transition。
4. 按目标代码把 `toggleExpanded` 改为 async 两阶段流程，并添加 `onLogboxTransitionEnd`。保留 target/currentTarget 和 `propertyName === 'clip-path'` 双重守卫，避免内部元素的 transition 冒泡错误收起布局。
5. 在模板中用 `.error-dialog__log-viewport` 包裹 `<pre>`，把 style、阶段 class 和 transitionend handler 放在 viewport 上；把滚动和堆栈文本保留在 `<pre>` 上。
6. 用目标 viewport/logbox CSS 替换当前 height transition；保留 `.error-dialog__logbox--collapsed::after` 的 24px 渐变提示及其他视觉样式。
7. 替换 reduced-motion 规则，使 viewport 无 transition、无 clip；确认脚本 reduced-motion 分支同步两个状态。
8. 静态检查文件中不再存在 `transition: height`，也未引入 `grid-template-rows`、`max-height` 动画、keyframes、计时器或新依赖。

## Boundaries

- 只修改 `src/renderer/src/components/ErrorDialog.vue`；不要修改 `BaseDialog.vue`、调用方、全局 token、store 或错误模型。
- 保留 `collapsedHeight`、`expandedHeight` props 名称、默认值和外部 API。负值归一为 0，`expandedHeight < collapsedHeight` 时归一为折叠高度；不要抛错或改变调用方。
- 保留日志复制、关闭、每次打开复位、折叠渐变、内部滚动、换行和长单词断行行为。
- 不要把方案改为 `grid-template-rows` 动画：它仍会逐帧执行 Layout。
- 不要 transition/animate `height`、`max-height`、`min-height`、padding、margin 或 grid tracks。高度只可在展开开始/收起结束离散更新一次。
- 不要用 `setTimeout` 猜测 200ms 完成时刻；正常偏好必须以 guarded `transitionend` 收尾。
- 不要把 `<pre>` 复制成两份，不要用 JS 测量 `scrollHeight`，不要添加 `ResizeObserver`、rAF 动画循环或第三方依赖。
- `requestAnimationFrame` 仅用于让浏览器提交展开前的裁剪起点，回调只改一次布尔状态；禁止在 rAF 中逐帧写样式。
- 快速反向切换时，如果收起尚未完成又点击展开，必须保持 `logboxExpanded = true` 并仅把 `expanded` 改回 true；迟到的 transitionend 只有在 `expanded` 仍为 false 时才能压缩布局。
- reduced-motion 下不得依赖 transitionend，因为 `transition: none` 不会可靠触发该事件。
- 若 commit `9285f50` 后上述脚本、模板或样式摘录发生漂移，停止并报告，不要自行套用到新的结构。

## Verification

- **Mechanical**：在仓库根目录依次运行 `npm run typecheck:renderer`、`npm run lint`、`npm test`、`npm run build:renderer`；全部必须以退出码 0 完成。特别确认 `TransitionEvent`、`nextTick` 和模板 style 自定义属性通过 Vue typecheck。
- **Static mechanical check**：在 `ErrorDialog.vue` 搜索 `transition: height`、`grid-template-rows`、`max-height`、`@keyframes`；结果必须为零。唯一可见 reveal transition 必须是 `clip-path 200ms cubic-bezier(0.23, 1, 0.32, 1)`。
- **Performance mechanical check**：用一段超过 360px 且包含长行的 stack 打开弹窗，在 Chromium DevTools Performance 面板分别录制展开、收起和快速反向切换。200ms reveal 区间不得出现由日志框逐帧尺寸插值导致的连续 Layout 事件；允许展开开始或收起结束出现一次离散 Layout。若每帧仍有 Layout，视为失败。记录中允许 Chromium 为 `clip-path` 产生 Paint/Composite 工作，本计划的硬目标是消除逐帧 Layout。
- **尺寸边界**：分别检查默认 `160/360`、相等 `240/240`、反向 `360/160`、负值 `-10/360`。默认值折叠/展开视觉高度必须为 160/360；相等或反向值不得产生负裁剪；负折叠值应归一为 0。所有状态不得出现 Vue warning 或无效 CSS 长度。
- **内容边界**：检查空 stack（日志区不渲染）、短 stack、超长 stack、超长无空格行和连续换行。展开态滚动条必须可用，复制内容必须仍是原始完整 stack；折叠态底部 24px 渐变仍只在 `!expanded` 时出现。
- **Feel check（10% 慢放）**：在 DevTools Animations 面板把 playback rate 设为 `10%`。展开时先建立最终空间，日志内容从折叠边界向下揭示，使用强 ease-out 快速起步并在终点平滑减速；收起时内容先向折叠边界裁掉，空间只在内容不可见后压缩。不得看到文字被 `scaleY` 拉伸、首帧闪到全高、末帧回弹或圆角露出方角。
- **Interruptibility**：在 200ms 内连续点击“展开/收起”至少 10 次。reveal 必须从当前裁剪位置反向，不从起点重播；最终按钮文字、图标、`aria-expanded`、viewport 高度和可见内容必须一致，不能卡在“文字显示展开但高度仍折叠”的状态。
- **Reduced motion**：在 DevTools Rendering 面板模拟 `prefers-reduced-motion: reduce` 后重新打开弹窗。点击切换应立即更新高度和内容，无 clip reveal、无等待、无卡住；折叠态仍只显示折叠高度，展开态仍可滚动完整日志。
- **Done when**：默认和自定义高度 API 保持可用；日志 reveal 的 200ms 区间没有连续 Layout；快速反向切换稳定；10% 慢放无闪烁/拉伸；reduced-motion 即时且状态一致。
