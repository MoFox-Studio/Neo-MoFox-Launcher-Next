# 011 — 收敛实例列表动效

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Accessibility / Easing & duration
- **Estimated scope**: 1 file，约 18 行修改

## Problem

`InstanceCard` 的卡片容器本身不是链接或按钮；实际可点击目标全部位于卡片底部操作区。但当前整张卡片在 hover 时上移 `2px`，会给用户“卡片可点击”的错误可供性，并在高频扫描实例列表时制造不必要的持续移动。该 hover 也没有通过 `hover: hover`、`pointer: fine` 限制到精确指针设备，触屏设备可能产生粘滞的伪 hover。

```vue
<!-- src/renderer/src/components/InstanceCard.vue:40-41, 63-65 — current -->
<template>
  <article class="instance-card">
    <!-- … -->
    <div class="instance-card__actions">
      <button
```

```css
/* src/renderer/src/components/InstanceCard.vue:131-152 — current */
.instance-card {
  /* … */
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.instance-card:hover {
  box-shadow: var(--app-glass-card-shadow-hover);
  transform: translateY(-2px);
}
```

此外，启动或停止期间的不定进度是恒速循环运动，却使用 standard easing。每个循环都会减速和重新加速，与安装页已经采用的线性不定进度不一致，并产生可见顿挫。

```css
/* src/renderer/src/components/InstanceCard.vue:219-234 — current */
.instance-card__progress-bar {
  width: 40%;
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-tertiary);
  animation: instance-card-indeterminate 1.2s var(--md-sys-motion-easing-standard) infinite;
}

@keyframes instance-card-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
```

reduced-motion 当前还需要专门撤销 hover 位移，说明常规规则把不必要的移动扩散到了所有输入类型：

```css
/* src/renderer/src/components/InstanceCard.vue:285-299 — current */
@media (prefers-reduced-motion: reduce) {
  .instance-card {
    transition:
      background-color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard),
      box-shadow var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .instance-card:hover {
    transform: none;
  }

  .instance-card__progress-bar {
    animation: none;
    opacity: 0.65;
  }
}
```

## Target

卡片 hover 只增强阴影，不发生位移，并且该视觉反馈只在同时满足 hover 能力和精确指针时启用。卡片基础 transition 不再包含 `transform`。

```css
/* target */
.instance-card {
  /* existing declarations unchanged */
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

@media (hover: hover) and (pointer: fine) {
  .instance-card:hover {
    box-shadow: var(--app-glass-card-shadow-hover);
  }
}
```

不定进度保留现有 `1.2s` 周期、`40%` bar 宽度和 `translateX(-100% → 250%)` 路径，仅把 timing function 精确改为 `linear`，与安装进度一致。

```css
/* target */
.instance-card__progress-bar {
  width: 40%;
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-tertiary);
  animation: instance-card-indeterminate 1.2s linear infinite;
}
```

reduced-motion 继续停止不定进度并保留 `opacity: 0.65` 状态提示；由于常规 hover 已不含移动，应删除媒体查询中冗余的 `.instance-card:hover { transform: none; }`。

## Repo conventions to follow

- `src/renderer/src/views/InstallWizardView.vue:800-816` 是同类不定进度的正确范例：`animation: progress-indeterminate 1.4s linear infinite`，并仅通过 transform 移动。
- `src/renderer/src/styles/tokens.css:49,57` 的 standard easing 和 `200ms` short4 仍适合阴影/颜色 hover；恒定循环运动按审计准则必须使用 CSS `linear`，不要为 linear 新建 token。
- `src/renderer/src/components/InstanceCard.vue:285-299` 已有 reduced-motion 合约：停止无限动画，但保留静态 bar 和 opacity 状态反馈。必须保留。
- 精确指针门控使用完整查询 `@media (hover: hover) and (pointer: fine)`，两个条件缺一不可。

## Steps

1. 在 `src/renderer/src/components/InstanceCard.vue:143-146` 从 `.instance-card` 的 transition 列表删除整个 `transform` 项，保留 background-color 与 box-shadow 的现有 `200ms` standard 过渡。
2. 删除当前无条件 `.instance-card:hover` 规则。
3. 在基础卡片规则之后增加 `@media (hover: hover) and (pointer: fine)`，其中 `.instance-card:hover` 只设置 `box-shadow: var(--app-glass-card-shadow-hover)`；不要设置 transform、position、margin 或其他移动属性。
4. 在 `src/renderer/src/components/InstanceCard.vue:224` 把不定进度 timing function 从 `var(--md-sys-motion-easing-standard)` 改为字面量 `linear`。保留 `1.2s`、`infinite`、keyframe 名称及 transform 端点。
5. 在 reduced-motion 块中保留卡片的短颜色/阴影过渡，以及进度条的 `animation: none; opacity: 0.65;`；删除现在冗余的 `.instance-card:hover { transform: none; }`。
6. 不改卡片模板和按钮事件；本计划只纠正卡片表面的反馈与进度节奏。

## Boundaries

- 只修改 `src/renderer/src/components/InstanceCard.vue`。
- 不要把 `<article>` 改为链接/按钮，不要给整卡添加 click、键盘处理、tabindex 或 cursor pointer。
- 不要移除卡片内各操作按钮现有的 state-layer、disabled 状态或事件。
- 不要改变阴影 token、颜色、卡片尺寸、进度条宽度、`1.2s` 周期或 keyframe 路径。
- 不要给进度条增加 bounce、ease、位移之外的动画或 JavaScript 驱动逻辑。
- 不要修改 `InstancesView.vue`、安装 store、全局 token或添加依赖。
- 如果 commit `9285f50` 之后 `InstanceCard.vue:131-152`、`219-234` 或 `285-299` 与摘录发生漂移，停止并报告，不要自行套用。

## Verification

- **Mechanical**：在仓库根目录依次运行：
  - `npm run typecheck:renderer`；预期退出码为 0。
  - `npm run lint`；预期退出码为 0。
  - `npm test`；预期全部测试通过。
  - `npm run build:renderer`；预期 renderer 构建成功。
- **Feel check — 卡片**：运行 `npm run dev:demo` 并打开实例列表：
  - 用鼠标悬停卡片，阴影在 `200ms` 内增强，但卡片边缘和内部文字在前后帧中保持同一坐标；
  - 移动鼠标快速扫过多张卡片，不出现上下跳动，也不暗示整卡可点击；
  - 卡片内部按钮仍正常响应，整卡空白区域点击不触发操作。
- 在 DevTools Sensors/设备模拟或真实触屏设备验证：不支持 hover 或 pointer 为 coarse 时，卡片不会进入 hover 阴影状态。
- **Feel check — 进度**：制造 `starting` 或 `stopping` 状态，在 Animations 面板以 `10%` 播放：
  - bar 从 `-100%` 到 `250%` 全程匀速；
  - 每个 `1.2s` 循环边界没有减速/加速的顿挫；
  - 与安装页不定进度的运动节奏同属线性恒速。
- 在 Rendering 面板模拟 `prefers-reduced-motion: reduce`：进度条停止移动但以 `0.65` opacity 保持可见；hover 不产生任何空间移动。
- **Done when**：`InstanceCard.vue` 不再包含 `translateY(-2px)` 或卡片 transform transition；hover 阴影只存在于精确指针媒体查询内；不定进度 animation 明确使用 `linear`。
