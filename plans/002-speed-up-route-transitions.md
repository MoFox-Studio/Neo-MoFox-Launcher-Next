# 002 — 加快高频路由切换

- **Status**: REVERTED
- **Commit**: 770d22a
- **Severity**: MEDIUM
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file, about 15 lines changed

## Problem

主导航是高频操作，但每次路由变化都先执行 `100ms` 离场，再执行 `300ms` 带 `12px` 位移的入场。`mode="out-in"` 串行执行两个阶段，连续点击导航时会产生等待感。

```vue
<!-- src/renderer/src/App.vue:19 — current -->
<router-view v-slot="{ Component }">
  <transition name="page" mode="out-in">
    <component :is="Component" />
  </transition>
</router-view>
```

```css
/* src/renderer/src/App.vue:59 — current */
.page-enter-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized-decelerate),
    transform var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-leave-active {
  transition: opacity var(--md-sys-motion-duration-short2)
    var(--md-sys-motion-easing-emphasized-accelerate);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.page-leave-to {
  opacity: 0;
}
```

## Target

路由切换不再等待旧页面离场，也不产生位置移动。新页面只做 `100ms` 强 ease-out 淡入；旧页面立即卸载。

```vue
<!-- target -->
<router-view v-slot="{ Component }">
  <transition name="page">
    <component :is="Component" />
  </transition>
</router-view>
```

```css
/* target */
.page-enter-active {
  transition: opacity var(--md-sys-motion-duration-short2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-enter-from {
  opacity: 0;
}
```

删除 `.page-leave-active`、`.page-leave-to` 和 `.page-enter-from` 中的 transform。不要给 leave 阶段增加替代动画。

## Repo conventions to follow

- 使用 `src/renderer/src/styles/tokens.css:53,55` 已有的 `--md-sys-motion-easing-emphasized-decelerate` 与 `--md-sys-motion-duration-short2`。
- 路由仍由 `src/renderer/src/router/index.ts` 管理；不要改路由定义或懒加载方式。
- 计划 001 会在同一文件增加 reduced-motion 覆盖；保留它并让两者兼容。

## Steps

1. 在 `src/renderer/src/App.vue:20` 删除 `<transition>` 的 `mode="out-in"`。
2. 将 `.page-enter-active` 改为仅对 opacity 做 `100ms` 过渡。
3. 删除 `.page-leave-active`、`.page-leave-to`，并从 `.page-enter-from` 删除 transform。
4. 若计划 001 已执行，保留其 `@media (prefers-reduced-motion: reduce)`；允许其中与常规样式相同的短淡入，不要重新引入位移。

## Boundaries

- 不要改变 `NavRail.vue` 的导航逻辑、路由名称或选中态。
- 不要添加方向推断、历史栈动画或 JavaScript 动画。
- 不要新增依赖或 motion token。
- 若代码与 commit `770d22a` 的摘录不一致，停止并报告。

## Verification

- **Mechanical**: run `npm run typecheck:renderer` and `npm run lint`; both must pass.
- **Feel check**: run `npm run dev:demo`, rapidly click 概览、实例、安装、设置. Content must respond immediately with no blank gap and no vertical travel.
- In DevTools Animations, use 10% playback and confirm only the entering page opacity changes for `100ms`; the old page has no leave animation.
- **Done when**: main navigation never waits for a leave transition and route content does not translate.
