# 005 — 使用变换驱动安装进度

- **Status**: DONE
- **Commit**: 770d22a
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file, about 30 lines changed

## Problem

确定进度通过内联 `width` 更新，不定进度通过 keyframes 更新 `left`。两者都会在每一帧触发布局；安装期间主进程和日志更新同时繁忙，更容易出现不平滑。

```vue
<!-- src/renderer/src/views/InstallWizardView.vue:357 — current -->
<div class="progress-track">
  <div
    class="progress-track__bar"
    :class="{ 'progress-track__bar--indeterminate': isIndeterminate }"
    :style="isIndeterminate ? undefined : { width: `${progressPercent}%` }"
  ></div>
</div>
```

```css
/* src/renderer/src/views/InstallWizardView.vue:781 — current */
.progress-track__bar {
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  transition: width var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.progress-track__bar--indeterminate {
  width: 40% !important;
  position: absolute;
  animation: progress-indeterminate 1.4s var(--md-sys-motion-easing-standard) infinite;
}

@keyframes progress-indeterminate {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}
```

## Target

确定进度条占满轨道，通过 `scaleX(0..1)` 表示进度，变换原点固定在左侧。不定进度条固定为轨道宽度的 40%，使用线性 `translateX`；恒定运动必须用 linear。

```vue
<!-- target -->
<div class="progress-track">
  <div
    class="progress-track__bar"
    :class="{ 'progress-track__bar--indeterminate': isIndeterminate }"
    :style="isIndeterminate ? undefined : { transform: `scaleX(${progressPercent / 100})` }"
  ></div>
</div>
```

```css
/* target */
.progress-track__bar {
  width: 100%;
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.progress-track__bar--indeterminate {
  width: 40%;
  position: absolute;
  transform: translateX(-100%);
  transform-origin: center;
  animation: progress-indeterminate 1.4s linear infinite;
  transition: none;
}

@keyframes progress-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
```

`translateX(250%)` 以 bar 自身宽度计算：40% × 2.5 = 100% 轨道宽度，因此终点刚好越过右边界。

## Repo conventions to follow

- 使用已有 `--md-sys-motion-duration-medium2` 与 standard easing 处理确定进度。
- 恒定循环运动使用 CSS `linear`，符合同文件 spinner 的做法。
- `InstanceCard.vue:200-215` 已使用 transform 驱动不定进度，可作为模式参考。
- 计划 001 执行后，保留 reduced-motion 中对 `.progress-track__bar--indeterminate` 的 `animation: none`。

## Steps

1. 在模板中把内联 width 改为 `transform: scaleX(progressPercent / 100)`。
2. 给普通 bar 增加 `width: 100%`、初始 scale、左侧 transform-origin，并把 transition 属性改为 transform。
3. 重写 indeterminate 状态，删除 `!important` 和 left 动画，使用固定 40% 宽度和 transform keyframes。
4. 把不定进度 easing 改为 linear，并设置 `transition: none`，防止关键帧与确定进度 transition 竞争。
5. 合并或保留计划 001 的 reduced-motion 覆盖。

## Boundaries

- 不要修改 `progressPercent`、安装 store、步骤统计或日志逻辑。
- 不要改变轨道高度、颜色、圆角和 1.4s 循环周期。
- 不要添加 JavaScript rAF 或新依赖。
- 若代码与 commit `770d22a` 的摘录不一致，停止并报告。

## Verification

- **Mechanical**: run `npm run typecheck:renderer`, `npm run lint`, and `npm test`; all must pass.
- Use DevTools Elements to set progress values 0, 25, 50, 75, 100 and confirm the visual fill matches exactly and grows from the left edge.
- Record the Performance panel during indeterminate progress; animation frames must not contain Layout events caused by `.progress-track__bar`.
- At 10% playback, confirm the indeterminate bar moves at constant speed without easing at either edge.
- With reduced motion enabled after plan 001, confirm the bar remains visible but does not travel.
- **Done when**: progress changes animate only `transform`; no progress keyframe changes `left` or `width`.
