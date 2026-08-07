# 004 — 优化设置开关动画

- **Status**: DONE
- **Commit**: 770d22a
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file, about 25 lines changed

## Problem

设置开关对所有属性做 transition，并通过 `left`、`width`、`height` 移动和缩放滑块。这些属性会触发布局和绘制，且 `transition: all` 可能意外动画化未来新增属性。

```css
/* src/renderer/src/views/SettingsView.vue:654 — current */
.md-switch {
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  border: 2px solid var(--md-sys-color-outline);
  position: relative;
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked .md-switch__thumb {
  left: 20px;
  width: 24px;
  height: 24px;
  background: var(--md-sys-color-on-primary);
}
```

## Target

轨道只过渡颜色。滑块始终保持 `24px` 布局尺寸，未选中时通过 scale 视觉缩小到 `16px`，选中时使用完整 transform 平移 `20px` 并恢复到 1 倍。

```css
/* target */
.md-switch {
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  border: 2px solid var(--md-sys-color-outline);
  position: relative;
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

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

保留 `.md-switch--checked` 的轨道颜色规则。删除 checked thumb 中的 `left`、`width`、`height`。

## Repo conventions to follow

- 使用现有 `--md-sys-motion-duration-short4` 和 `--md-sys-motion-easing-standard`。
- 动态颜色继续来自主题 token；不要硬编码颜色。
- CSS transform 必须直接设置在 thumb 上，不通过父级 CSS 变量驱动。

## Steps

1. 在 `src/renderer/src/views/SettingsView.vue` 将 `.md-switch` 的 `transition: all` 替换为 background-color 和 border-color。
2. 将 thumb 固定为 `24px × 24px`、`left: 0`，设置 transform、transform-origin 和显式 transition。
3. 将 checked thumb 改为 `transform: translate(20px, -50%) scale(1)`，保留 background，删除布局属性。
4. 检查模板的 checked class 与 disabled/ARIA 行为，保持原样。

## Boundaries

- 不要改变设置保存、异步更新或点击处理逻辑。
- 不要改变开关外部尺寸、颜色 token 或 DOM 结构。
- 不要用 `translateX`/`scale` 独立属性；使用完整 `transform` 字符串。
- 不要添加依赖。
- 若代码与 commit `770d22a` 的摘录不一致，停止并报告。

## Verification

- **Mechanical**: run `npm run typecheck:renderer` and `npm run lint`; both must pass.
- In DevTools Performance, toggle each setting repeatedly and confirm no Layout event is caused by thumb animation after the click state update.
- At 10% animation playback, confirm the thumb center travels smoothly from x=12px to x=32px and the visible diameter changes from 16px to 24px without jumping.
- Confirm light and dark themes retain correct thumb/track colors.
- **Done when**: no switch rule contains `transition: all`, and checked-state motion changes only transform and background color.
