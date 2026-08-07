# 008 — 完善全局减弱动态效果

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 9 files, about 70 lines changed

## Problem

项目已经在路由、对话框和 OOBE 页面切换上处理了 `prefers-reduced-motion`，但仍有九个文件中的持续旋转、无限脉冲、位置移动、按压缩放和开关滑块运动不受该偏好控制。选择“减少动态效果”的用户仍会看到持续或空间运动。

四个 OOBE 子组件各自定义并无限播放 spinner 旋转：

```css
/* src/renderer/src/components/oobe/OobeDependencyInstall.vue:546 — current */
.spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-primary);
  animation: spinner-spin .8s linear infinite;
}
```

```css
/* src/renderer/src/components/oobe/OobeLegacyImport.vue:302 — current */
.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
  animation: spinner-spin 0.8s linear infinite;
}
```

```css
/* src/renderer/src/components/oobe/OobePreferences.vue:577 — current */
.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
  animation: spinner-spin 0.8s linear infinite;
}
```

```css
/* src/renderer/src/components/oobe/OobeSummary.vue:232 — current */
.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
  animation: spinner-spin 0.8s linear infinite;
}
```

`StatusBadge` 在启动和停止期间让状态点无限改变 opacity：

```css
/* src/renderer/src/components/StatusBadge.vue:60 — current */
.status-badge--pulsing .status-badge__dot {
  animation: status-badge-pulse 1.4s var(--md-sys-motion-easing-standard) infinite;
}
```

`InstanceLogView` 的 toast 同时过渡 opacity 和 transform，并从下方 `8px` 移入：

```css
/* src/renderer/src/views/InstanceLogView.vue:669 — current */
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
```

标题栏和主导航的按钮会在按下时缩放：

```css
/* src/renderer/src/components/AppTitleBar.vue:96 — current */
.titlebar__btn {
  /* unchanged declarations omitted */
  transition:
    background-color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}

.titlebar__btn:active {
  transform: scale(0.94);
}
```

```css
/* src/renderer/src/components/NavRail.vue:113 — current */
.rail__item {
  /* unchanged declarations omitted */
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}

.rail__item:active,
.rail__primary:active {
  transform: scale(0.97);
}

/* src/renderer/src/components/NavRail.vue:152 — current */
.rail__primary {
  /* unchanged declarations omitted */
  transition: transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}
```

Settings 的三个开关共用同一滑块规则。状态变化通过 transform 在水平位置和 scale 之间过渡；reduce 模式目前没有覆盖：

```css
/* src/renderer/src/views/SettingsView.vue:1173 — current */
.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-on-surface-variant);
  transform: translate(0, -50%) scale(0.6667);
  transform-origin: center;
  transition:
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked .md-switch__thumb {
  background: var(--md-sys-color-on-primary);
  transform: translate(20px, -50%) scale(1);
}
```

## Target

在 `prefers-reduced-motion: reduce` 下保留有助于理解状态的 opacity 与颜色反馈，但移除所有持续、位置和缩放运动：

- OOBE spinner 停止旋转；保留不对称边框和当前颜色，仍可作为静态忙碌标记。
- `StatusBadge` 停止无限脉冲；保留状态点及徽标的状态色。
- toast 继续以 `100ms` opacity 淡入淡出，但进入前、离开后都保持用于水平居中的 `translateX(-50%)`，不再产生 `translateY` 位移。
- `AppTitleBar` 与 `NavRail` 不再做按压 scale；保留背景色、文字色和全局 `.state-layer` opacity 反馈。
- Settings 开关滑块的 transform 状态仍应立即切换，以表达开关值，但 transform 不得 transition；轨道和滑块颜色继续使用已有 `200ms` 过渡。

在四个 OOBE spinner 文件各自的 `<style scoped>` 末尾、`</style>` 之前增加：

```css
/* target: OobeDependencyInstall.vue, OobeLegacyImport.vue,
   OobePreferences.vue, OobeSummary.vue */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
```

在 `StatusBadge.vue` 增加：

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  .status-badge--pulsing .status-badge__dot {
    animation: none;
  }
}
```

在 `InstanceLogView.vue` 增加：

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2)
      var(--md-sys-motion-easing-standard);
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translateX(-50%);
  }
}
```

不要把 toast 的 transform 设为 `none`：`.log-view__toast` 的常态 `transform: translateX(-50%)` 是水平居中布局的一部分，不是需要移除的动态效果。

在 `AppTitleBar.vue` 增加：

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  .titlebar__btn {
    transition: background-color var(--md-sys-motion-duration-short2)
      var(--md-sys-motion-easing-standard);
  }

  .titlebar__btn:active {
    transform: none;
  }
}
```

在 `NavRail.vue` 增加；放在响应式布局规则之后、现有 `prefers-reduced-transparency` 媒体查询之前：

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  .rail__item {
    transition:
      background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
      color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  }

  .rail__primary {
    transition: none;
  }

  .rail__item:active,
  .rail__primary:active {
    transform: none;
  }
}
```

在 `SettingsView.vue` 增加：

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  .md-switch__thumb {
    transition: background-color var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-standard);
  }
}
```

该规则只删除 transform 的插值过程，不得删除常态和 checked 状态的 transform 值。用户切换设置时，滑块位置与尺寸应瞬时到达目标状态，同时轨道和滑块颜色平滑更新。

## Repo conventions to follow

- 项目的 motion token 位于 `src/renderer/src/styles/tokens.css:49-58`。本计划只复用 `--md-sys-motion-duration-short2`（`100ms`）、`--md-sys-motion-duration-short4`（`200ms`）和 `--md-sys-motion-easing-standard`，不新增 token。
- `src/renderer/src/App.vue:99-104` 已使用局部 `@media (prefers-reduced-motion: reduce)`，并保留短 opacity 过渡；各 scoped 组件沿用同一模式，不创建全局总开关。
- `src/renderer/src/views/OobeView.vue:150-159` 已证明项目的 reduce 约定是保留 opacity transition、覆盖 transform 位移。
- `src/renderer/src/styles/base.css:89-98` 的 `.state-layer::after` 使用 opacity 表达 hover/pressed 状态。本计划保留该反馈，不修改全局 state layer。
- 所有修改均为现有 `<style scoped>` 内的 CSS 覆盖；不修改模板、脚本、业务状态或 ARIA。

## Steps

1. 在 `src/renderer/src/components/oobe/OobeDependencyInstall.vue` 的 spinner keyframes 之后加入 reduce 媒体查询，将 `.spinner` 的 animation 设为 `none`。
2. 对 `src/renderer/src/components/oobe/OobeLegacyImport.vue`、`src/renderer/src/components/oobe/OobePreferences.vue`、`src/renderer/src/components/oobe/OobeSummary.vue` 重复同一局部覆盖；不要合并或移动四个 scoped spinner 定义。
3. 在 `src/renderer/src/components/StatusBadge.vue` 增加 reduce 覆盖，仅停止 `.status-badge--pulsing .status-badge__dot` 的 animation；保留 keyframes 和普通模式行为。
4. 在 `src/renderer/src/views/InstanceLogView.vue` 增加 reduce 覆盖：active 阶段只 transition opacity `100ms`；from/to 阶段把 transform 固定为 `translateX(-50%)`，同时沿用原规则的 `opacity: 0`。
5. 在 `src/renderer/src/components/AppTitleBar.vue` 增加 reduce 覆盖：按钮只 transition background-color，并将 active transform 设为 `none`。
6. 在 `src/renderer/src/components/NavRail.vue` 增加 reduce 覆盖：导航项只 transition background-color 和 color；主按钮不 transition；两类按钮 active 时均不 scale。
7. 在 `src/renderer/src/views/SettingsView.vue` 增加 reduce 覆盖，只把 `.md-switch__thumb` 的 transition 收窄为 background-color；保留 `.md-switch` 轨道颜色 transition 以及两种状态的 transform 声明。
8. 检查九个文件的普通模式规则未被改动，所有覆盖只在 `prefers-reduced-motion: reduce` 生效。

## Boundaries

- 只修改本计划列出的九个 Vue 文件；不要修改 `src/renderer/src/styles/tokens.css`、`src/renderer/src/styles/base.css` 或其他组件。
- 不要修改 `src/renderer/src/views/OobeView.vue` 的步骤切换；方向与该过渡的 reduce 兼容性属于计划 009。
- 不要删除 spinner 或 pulse keyframes；普通模式必须保持当前动画。
- 不要用全局 `animation: none !important` 或 `transition: none !important`，也不要取消 opacity/color 状态反馈。
- 不要改变 toast 的常态定位、DOM 生命周期或显示计时。
- 不要删除 Settings thumb 的 transform 状态；reduce 模式下应瞬时切换位置与视觉尺寸，而不是停留在 unchecked 外观。
- 不要改变模板、业务逻辑、设置保存、窗口控制、导航、日志操作或 ARIA 属性。
- 不要添加依赖或新 motion token。
- 如果代码与 commit `9285f50` 的路径、选择器或摘录不一致，停止并报告，不要自行改写方案。

## Verification

- **Mechanical**: 运行 `npm run typecheck:renderer`、`npm run lint` 和 `npm test`；三者都必须通过。
- **Static check**: 确认四个 OOBE spinner 文件和 `StatusBadge.vue` 都有局部 reduce animation 覆盖；确认 toast、标题栏、NavRail 和 Settings thumb 都有局部 reduce transition/transform 覆盖。
- **Feel check — normal**: 运行 `npm run dev:demo`，关闭系统 reduced motion。确认 OOBE spinner 持续旋转、启动/停止状态点脉冲、日志 toast 上移淡入、标题栏和 NavRail 按下缩放、Settings thumb 平滑移动，行为与修改前一致。
- **Feel check — reduce**: 在 DevTools Rendering 面板模拟 `prefers-reduced-motion: reduce`，逐一确认：
  - OOBE 的依赖检查、sudo 验证、旧版导入预览、壁纸导入和完成安装 spinner 均静止，但颜色与不对称边框可见。
  - starting/stopping 的 `StatusBadge` 状态点不再脉冲，但状态文字、点和状态色仍可见。
  - 日志 toast 只淡入淡出，不发生纵向位移，且仍保持水平居中。
  - 标题栏控制按钮、NavRail 项和“新建实例”按钮按下时不缩放，但背景/文字/state-layer 状态仍变化。
  - 三个 Settings switch 的 thumb 瞬时到达新位置和尺寸，轨道及 thumb 颜色仍以 `200ms` 更新。
- **Slow motion**: 在 DevTools Animations 面板设为 10% 播放速度；reduce 模式下不得观察到旋转、脉冲、toast 位移、按压 scale 或 switch transform 插值。
- **Done when**: reduce 模式保留所有必要的 opacity/color 状态表达，但指定的持续、位置和缩放运动全部消失；普通模式无视觉回归。
