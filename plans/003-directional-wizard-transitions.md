# 003 — 修正安装向导切换方向

- **Status**: DONE
- **Commit**: 770d22a
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, about 40 lines changed

## Problem

前进、返回和点击已完成步骤都直接修改 `currentStep`，但 CSS 永远让新内容从右侧进入、旧内容向左侧离开。因此“上一步”也播放前进方向，空间关系与操作相反。

```ts
// src/renderer/src/views/InstallWizardView.vue:109 — current
function goNext(): void {
  if (!canGoNext.value || currentStep.value >= 4) return;
  currentStep.value += 1;
}

function goPrev(): void {
  if (currentStep.value > 1) currentStep.value -= 1;
}

function goToStep(step: number): void {
  if (step < currentStep.value && currentStep.value < 5) currentStep.value = step;
}
```

```vue
<!-- src/renderer/src/views/InstallWizardView.vue:211 — current -->
<transition name="wizard-slide" mode="out-in">
  <div :key="currentStep" class="wizard__content">
```

```css
/* src/renderer/src/views/InstallWizardView.vue:926 — current */
.wizard-slide-enter-active,
.wizard-slide-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized);
}

.wizard-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.wizard-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
```

## Target

维护显式方向状态。前进时新内容从右进入；后退时新内容从左进入。使用已有 `200ms` token，单段动画不超过 `300ms`。

```ts
/* target, near currentStep declaration */
const stepDirection = ref<'forward' | 'backward'>('forward');

function goNext(): void {
  if (!canGoNext.value || currentStep.value >= 4) return;
  stepDirection.value = 'forward';
  currentStep.value += 1;
}

function goPrev(): void {
  if (currentStep.value <= 1) return;
  stepDirection.value = 'backward';
  currentStep.value -= 1;
}

function goToStep(step: number): void {
  if (step >= currentStep.value || currentStep.value >= 5) return;
  stepDirection.value = 'backward';
  currentStep.value = step;
}
```

在 `startInstall()` 将步骤设为 5 之前添加 `stepDirection.value = 'forward';`。在 `onMounted()` 恢复后台安装并直接设为 5 时无需动画方向修正，因为组件尚未挂载。

```vue
<!-- target -->
<transition :name="`wizard-slide-${stepDirection}`" mode="out-in">
```

```css
/* target */
.wizard-slide-forward-enter-active,
.wizard-slide-forward-leave-active,
.wizard-slide-backward-enter-active,
.wizard-slide-backward-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.wizard-slide-forward-enter-from,
.wizard-slide-backward-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.wizard-slide-forward-leave-to,
.wizard-slide-backward-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
```

## Repo conventions to follow

- `ref` 已从 Vue 导入；沿用现有 Composition API，不创建新 composable。
- 使用 `src/renderer/src/styles/tokens.css:52,56` 的 emphasized easing 与 `200ms` short4 duration。
- 动画仍用 Vue `<transition>` 和 CSS transform/opacity。
- 若计划 001 已执行，更新其 reduced-motion 选择器以覆盖 forward/backward 类名；计划 001 已给出完整选择器。

## Steps

1. 在 `currentStep` 附近声明 `stepDirection`。
2. 在 `goNext`、`goPrev`、`goToStep` 修改步骤前设置方向，采用上面的守卫结构。
3. 在 `startInstall()` 设置 `currentStep.value = 5` 前设置 forward。
4. 将 transition name 改为动态的 `wizard-slide-${stepDirection}`，保留 `mode="out-in"`。
5. 用上面的四组方向 CSS 替换原 `wizard-slide` CSS，并把持续时间改为 short4 `200ms`。
6. 合并计划 001 的 reduced-motion 规则时，不得让 transform 在 reduce 模式下生效。

## Boundaries

- 不要改变步骤校验、可点击范围、安装请求或 currentStep 的数值语义。
- 不要移除 `mode="out-in"`；并行动画需要额外定位，不在本计划范围。
- 不要改 OOBE 动画。
- 不要添加依赖。
- 若代码与 commit `770d22a` 的摘录不一致，停止并报告。

## Verification

- **Mechanical**: run `npm run typecheck:renderer`, `npm run lint`, and `npm test`; all must pass.
- **Feel check**: run `npm run dev:demo`. Complete enough fields to move through steps 1→2→3, then use 上一步 and completed step markers.
- At 10% DevTools playback, confirm forward enters from right and leaves left; backward enters from left and leaves right. No step should move in the opposite semantic direction.
- With reduced motion enabled after plan 001, confirm both directions become opacity-only.
- **Done when**: every step mutation sets an explicit direction and back navigation visually reverses forward navigation.
