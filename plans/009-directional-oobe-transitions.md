# 009 — 为 OOBE 加入方向切换

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, about 45 lines changed

## Problem

`OobeView` 的前进、跳过和返回操作最终都只修改 `currentStepId`，没有记录导航方向：

```ts
/* src/renderer/src/views/OobeView.vue:32 — current */
// 当前步骤索引（基于全部 StepId，不跳过隐藏步骤）；导航时根据 visible 决定是否停留。
const currentStepId = ref<StepId>('welcome');

const visibleSteps = computed(() => steps.value.filter((s) => s.visible));
const currentVisibleIndex = computed(() =>
  visibleSteps.value.findIndex((s) => s.id === currentStepId.value),
);

function goToStep(id: StepId): void {
  currentStepId.value = id;
}

function goNextVisible(): void {
  const idx = currentVisibleIndex.value;
  if (idx < 0 || idx >= visibleSteps.value.length - 1) return;
  currentStepId.value = visibleSteps.value[idx + 1].id;
}
```

隐藏旧版导入步骤时同样直接前往 preferences：

```ts
/* src/renderer/src/views/OobeView.vue:50 — current */
function skipLegacyStep(): void {
  // 先解除对 legacy 的停留再隐藏，否则 currentStepId 仍指向 legacy，
  // goNextVisible 会因 findIndex 返回 -1 而中止，导致用户卡在已隐藏的步骤上。
  showLegacyStep.value = false;
  goToStep('preferences');
}
```

模板为所有方向共用固定的 transition name，各事件调用也没有方向参数：

```vue
<!-- src/renderer/src/views/OobeView.vue:68 — current -->
<div class="oobe__stage">
  <transition name="oobe-slide" mode="out-in">
    <OobeWelcome v-if="currentStepId === 'welcome'" key="welcome" @next="goToStep('dependencies')" />

    <OobeDependencyInstall
      v-else-if="currentStepId === 'dependencies'"
      key="dependencies"
      @next="goNextVisible()"
      @back="goToStep('welcome')"
      @skip="goNextVisible()"
    />

    <OobeLegacyImport
      v-else-if="currentStepId === 'legacy'"
      key="legacy"
      @next="goToStep('preferences')"
      @skip="skipLegacyStep()"
    />

    <OobePreferences
      v-else-if="currentStepId === 'preferences'"
      key="preferences"
      @next="goToStep('summary')"
      @back="showLegacyStep ? goToStep('legacy') : goToStep('dependencies')"
    />
```

因此 CSS 永远把新页从右侧移入、旧页向左侧移出，即使用户执行“返回”：

```css
/* src/renderer/src/views/OobeView.vue:132 — current */
/* 步骤切换动画 */
.oobe-slide-enter-active,
.oobe-slide-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized);
}

.oobe-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.oobe-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
```

当前 reduced-motion 已正确移除位移，但选择器只覆盖固定的 `oobe-slide` 名称，改为方向类名后必须同步更新：

```css
/* src/renderer/src/views/OobeView.vue:150 — current */
@media (prefers-reduced-motion: reduce) {
  .oobe-slide-enter-active,
  .oobe-slide-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .oobe-slide-enter-from,
  .oobe-slide-leave-to {
    transform: none;
  }
}
```

## Target

在 `OobeView.vue` 维护显式的 `'forward' | 'backward'` 状态。每次实际修改步骤前先写入方向：

- 前进、继续、跳过：`forward`；新页从右侧进入，旧页向左侧退出。
- 返回：`backward`；新页从左侧进入，旧页向右侧退出。
- 普通模式每个 enter/leave 阶段使用现有 `--md-sys-motion-duration-short4`（`200ms`）与 `--md-sys-motion-easing-emphasized`。
- reduced-motion 模式保持 `100ms` opacity-only，不产生任何水平位移。
- 保留 `mode="out-in"`，不改变步骤挂载顺序。

脚本目标如下：

```ts
/* target, near currentStepId */
type TransitionDirection = 'forward' | 'backward';

const currentStepId = ref<StepId>('welcome');
const transitionDirection = ref<TransitionDirection>('forward');

function goToStep(id: StepId, direction: TransitionDirection): void {
  transitionDirection.value = direction;
  currentStepId.value = id;
}

function goNextVisible(): void {
  const idx = currentVisibleIndex.value;
  if (idx < 0 || idx >= visibleSteps.value.length - 1) return;
  transitionDirection.value = 'forward';
  currentStepId.value = visibleSteps.value[idx + 1].id;
}

function skipLegacyStep(): void {
  // 保留现有注释与先隐藏 legacy 的顺序。
  showLegacyStep.value = false;
  goToStep('preferences', 'forward');
}
```

`goToStep` 不提供默认 direction；所有直接跳转必须明确表达语义，避免未来新增调用悄悄沿用错误方向。`goNextVisible` 只在守卫通过、确实发生步骤变化时写入 `forward`。

模板目标如下：

```vue
<!-- target -->
<div class="oobe__stage">
  <transition :name="`oobe-slide-${transitionDirection}`" mode="out-in">
    <OobeWelcome
      v-if="currentStepId === 'welcome'"
      key="welcome"
      @next="goToStep('dependencies', 'forward')"
    />

    <OobeDependencyInstall
      v-else-if="currentStepId === 'dependencies'"
      key="dependencies"
      @next="goNextVisible()"
      @back="goToStep('welcome', 'backward')"
      @skip="goNextVisible()"
    />

    <OobeLegacyImport
      v-else-if="currentStepId === 'legacy'"
      key="legacy"
      @next="goToStep('preferences', 'forward')"
      @skip="skipLegacyStep()"
    />

    <OobePreferences
      v-else-if="currentStepId === 'preferences'"
      key="preferences"
      @next="goToStep('summary', 'forward')"
      @back="showLegacyStep
        ? goToStep('legacy', 'backward')
        : goToStep('dependencies', 'backward')"
    />
```

允许按项目格式化规则将较长的 template 表达式换行，但不要引入额外 handler 或更改事件语义。

普通模式 CSS 目标如下：

```css
/* target */
.oobe-slide-forward-enter-active,
.oobe-slide-forward-leave-active,
.oobe-slide-backward-enter-active,
.oobe-slide-backward-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.oobe-slide-forward-enter-from,
.oobe-slide-backward-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.oobe-slide-forward-leave-to,
.oobe-slide-backward-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
```

映射含义必须保持：

- `forward-enter-from: +24px`，新页从右入。
- `forward-leave-to: -24px`，旧页向左出。
- `backward-enter-from: -24px`，新页从左入。
- `backward-leave-to: +24px`，旧页向右出。

reduced-motion CSS 目标如下：

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  .oobe-slide-forward-enter-active,
  .oobe-slide-forward-leave-active,
  .oobe-slide-backward-enter-active,
  .oobe-slide-backward-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2)
      var(--md-sys-motion-easing-standard);
  }

  .oobe-slide-forward-enter-from,
  .oobe-slide-forward-leave-to,
  .oobe-slide-backward-enter-from,
  .oobe-slide-backward-leave-to {
    transform: none;
  }
}
```

普通方向规则仍为这些 from/to 类设置 `opacity: 0`，所以 reduce 覆盖只需删除 transform；前后导航均继续通过短淡入淡出表达步骤变化。

## Repo conventions to follow

- 项目使用 Vue 3 Composition API 和 Vue `<transition>`；`ref` 已在 `src/renderer/src/views/OobeView.vue:2` 导入，不增加 composable 或动画库。
- `src/renderer/src/views/InstallWizardView.vue` 已采用方向状态、动态 transition name 和 forward/backward 类名；OOBE 应沿用同一架构，而不是根据 DOM 或浏览器历史推断方向。
- motion token 位于 `src/renderer/src/styles/tokens.css:49-58`：`--md-sys-motion-duration-short4` 是 `200ms`，`--md-sys-motion-duration-short2` 是 `100ms`，普通移动使用现有 `--md-sys-motion-easing-emphasized`。
- OOBE 当前位移幅度是 `24px`；只反转方向并缩短普通持续时间，不引入新距离或 token。
- 项目的 reduced-motion 约定是保留 opacity/color 状态、移除位置和缩放运动。`src/renderer/src/App.vue:99-104` 和当前 OOBE 媒体查询都是可遵循的范例。

## Steps

1. 在 `src/renderer/src/views/OobeView.vue` 的 `StepId` 附近声明 `TransitionDirection = 'forward' | 'backward'`，并在 `currentStepId` 后增加初值为 `'forward'` 的 `transitionDirection` ref。
2. 将 `goToStep` 改为必须接收 direction；函数中先赋值 `transitionDirection.value`，再赋值 `currentStepId.value`。
3. 在 `goNextVisible` 的现有边界守卫之后、步骤赋值之前设置 `transitionDirection.value = 'forward'`。守卫失败时不要改变方向。
4. 保留 `skipLegacyStep` 先把 `showLegacyStep.value` 设为 false 的逻辑和现有解释注释；把随后调用改为 `goToStep('preferences', 'forward')`。
5. 将 `<transition name="oobe-slide" mode="out-in">` 改为动态 `:name="`oobe-slide-${transitionDirection}`"`，保留 `mode="out-in"`。
6. 更新模板中每个直接 `goToStep` 调用：Welcome next、Legacy next、Preferences next 使用 `forward`；Dependency back 和 Preferences 的两个 back 分支使用 `backward`。继续/skip 仍调用固定为 forward 的 `goNextVisible`，Legacy skip 仍调用 `skipLegacyStep`。
7. 用四组 directional active/from/to 选择器替换当前固定 `oobe-slide` CSS；把普通持续时间从 medium2 `300ms` 改为 short4 `200ms`，保留 emphasized easing 和 `24px` 距离。
8. 更新现有 reduce 媒体查询，使其覆盖 forward/backward 的所有 active 与 from/to 类。active 只 transition opacity `100ms`；所有方向的 transform 均覆盖为 `none`。
9. 全文检索 `goToStep(`，确认每个调用都显式提供 direction；全文检索 `.oobe-slide-enter`，确认旧的无方向选择器已全部删除。

## Boundaries

- 只修改 `src/renderer/src/views/OobeView.vue`；不要修改任何 OOBE 子组件、Stepper、路由或全局样式。
- 不要改变 `StepId`、步骤顺序、`visibleSteps`、`currentVisibleIndex` 或 legacy 显示/隐藏语义。
- 不要根据步骤字符串、数组索引、浏览器 history 或事件名称自动猜方向；调用点必须显式传入，`goNextVisible` 固定为 forward。
- 不要改变 `mode="out-in"`，不要并行挂载两个步骤，也不要增加绝对定位来重叠页面。
- 不要改变 `24px` 位移、opacity 起止值、OOBE 布局或组件 key。
- 不要给 `goToStep` 增加默认 direction。
- 不要在 reduced-motion 下保留 transform；该模式必须是 opacity-only。
- 不要添加依赖、JavaScript 动画、watcher 或新 motion token。
- 如果代码与 commit `9285f50` 的路径、导航入口或摘录不一致，停止并报告，不要自行推断新的调用关系。

## Verification

- **Mechanical**: 运行 `npm run typecheck:renderer`、`npm run lint` 和 `npm test`；三者都必须通过。
- **Static check**: `goToStep(` 的每个调用必须有第二个方向参数；普通 active 规则必须使用 short4；旧的 `.oobe-slide-enter-*` / `.oobe-slide-leave-*` 无方向选择器不得残留。
- **Feel check — normal, legacy visible**: 运行 `npm run dev:demo` 并关闭 reduced motion。依次验证 welcome → dependencies → legacy → preferences → summary；每次前进都应新页右入、旧页左出。再从 preferences 返回 legacy、从 dependencies 返回 welcome；每次返回都应新页左入、旧页右出。
- **Feel check — normal, legacy skipped/hidden**: 从 dependencies 跳过到 preferences，确认仍为 forward；当 legacy 不可见时从 preferences 返回 dependencies，确认仍为 backward。不得出现因 `findIndex` 为 `-1` 而停滞。
- **Slow motion**: 在 DevTools Animations 面板设为 10% 播放速度，逐帧确认 forward 与 backward 的 enter/leave 是完全镜像的；每个 enter 或 leave 阶段标称持续 `200ms`，没有 `300ms` medium2 残留。
- **Reduced motion**: 在 DevTools Rendering 面板模拟 `prefers-reduced-motion: reduce`，重复前进、返回和跳过。所有路径都只能改变 opacity，不得出现水平位移；淡入淡出使用 short2 `100ms`。
- **Regression**: 确认每一步仍只挂载一个子组件，按钮事件、legacy 可见性和当前 Stepper 指示与修改前一致。
- **Done when**: 所有前进路径均右入左出，所有返回路径均左入右出，普通阶段为 short4 `200ms`，reduce 模式对两个方向都为 opacity-only。
