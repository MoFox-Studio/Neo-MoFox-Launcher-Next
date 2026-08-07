# 010 — 加快当前路由切换

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Easing & duration
- **Estimated scope**: 1 file，约 12 行修改

## Problem

主导航属于每天会触发数十次的高频交互，但当前路由切换通过 `mode="out-in"` 串行执行离场和入场。旧页面先用 `100ms` 淡出，新页面再用 `300ms` 淡入，总预算达到 `400ms`；两个阶段之间还会出现内容为空的离场空档，导航反馈因此显得迟缓。

```vue
<!-- src/renderer/src/App.vue:20-24 — current -->
<router-view v-slot="{ Component }">
  <transition name="page" mode="out-in">
    <component :is="Component" />
  </transition>
</router-view>
```

```css
/* src/renderer/src/App.vue:81-97 — current */
.page-enter-active {
  transition: opacity var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-leave-active {
  transition: opacity var(--md-sys-motion-duration-short2)
    var(--md-sys-motion-easing-emphasized-accelerate);
}

.page-enter-from {
  opacity: 0;
}

.page-leave-to {
  opacity: 0;
}
```

当前 reduced-motion 规则仍同时覆盖进入和离场：

```css
/* src/renderer/src/App.vue:99-104 — current */
@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }
}
```

## Target

移除串行模式和整个离场动画。旧页面不等待淡出，新页面立即挂载并只做 `200ms` opacity 淡入；不增加 `translate`、`scale`、blur 或任何方向动画。

`200ms` 位于目标要求的 `150–200ms` 上限，并直接复用仓库的 `--md-sys-motion-duration-short4`。进入使用现有 emphasized decelerate 强 ease-out：`cubic-bezier(0.05, 0.7, 0.1, 1)`。

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
  transition: opacity var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-enter-from {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }
}
```

必须删除 `.page-leave-active` 与 `.page-leave-to`，不能用同步交叉淡出替代。这样没有离场计时，也没有旧页面先消失、新页面后出现的空白阶段。

## Repo conventions to follow

- `src/renderer/src/styles/tokens.css:49-58` 已定义：
  - `--md-sys-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1)`；
  - `--md-sys-motion-easing-emphasized-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1)`；
  - `--md-sys-motion-duration-short2: 100ms`；
  - `--md-sys-motion-duration-short4: 200ms`。
- 当前 `src/renderer/src/App.vue:77-80` 已记录不使用位移的合成原因：路由根节点上的 transform 会影响 `SettingsView` 和 `InstallWizardView` 中 `backdrop-filter` 的稳定合成。保留并遵守该约束。
- reduced-motion 在本仓库不是“移除所有反馈”，而是保留更短的 opacity 过渡并移除空间移动；本计划仍保留 `100ms` 淡入。

## Steps

1. 在 `src/renderer/src/App.vue:21` 从 `<transition name="page" mode="out-in">` 删除 `mode="out-in"`，保留 `name="page"` 和现有 `router-view` 插槽结构。
2. 在 `src/renderer/src/App.vue:81-84` 将进入持续时间从 `--md-sys-motion-duration-medium2`（`300ms`）改为 `--md-sys-motion-duration-short4`（`200ms`）；继续只过渡 `opacity`，继续使用 `--md-sys-motion-easing-emphasized-decelerate`。
3. 完整删除当前 `.page-leave-active` 和 `.page-leave-to` 规则，不添加其他 leave class。
4. 保留 `.page-enter-from { opacity: 0; }`，不要加入 transform、filter、clip-path 或延迟。
5. 将 reduced-motion 媒体查询的选择器收窄为 `.page-enter-active`；保留 `100ms` standard opacity 过渡，不留下已无用途的 `.page-leave-active`。
6. 保留 `src/renderer/src/App.vue:77-80` 关于禁止路由位移的注释；如需调整措辞，只能让其准确描述“仅淡入且没有离场动画”，不得改变技术约束。

## Boundaries

- 只修改 `src/renderer/src/App.vue`；不要修改路由表、`NavRail.vue`、页面组件或全局 token。
- 不要引入 `mode="in-out"`、同步 leave 淡出、绝对定位叠层或 JavaScript 动画。
- 不要添加任何位移、缩放、模糊、延迟、stagger 或方向推断。
- 不要更改 `bare` 布局、`WallpaperLayer`、标题栏或导航栏的挂载逻辑。
- 不要添加依赖。
- 如果 commit `9285f50` 之后 `src/renderer/src/App.vue:20-24` 或 `81-104` 与上述摘录发生漂移，停止并报告，不要自行套用。

## Verification

- **Mechanical**：在仓库根目录依次运行：
  - `npm run typecheck:renderer`；预期退出码为 0。
  - `npm run lint`；预期退出码为 0。
  - `npm test`；预期全部测试通过。
  - `npm run build:renderer`；预期 renderer 构建成功。
- **Feel check**：运行 `npm run dev:demo`，连续快速点击“概览”“实例”“安装”“设置”：
  - 点击后新页面立即出现并开始淡入，没有先等待旧页面淡出的空白窗口；
  - 进入只改变 opacity，页面在任何帧都没有横向或纵向位移，也没有缩放；
  - 快速连续换页时不累计 `400ms` 串行等待，最终页面与最后一次点击一致。
- 在 Chromium DevTools Animations 面板设为 `10%` 播放速度：
  - 每次导航只看到新页面 `200ms` opacity 进入轨迹；
  - 不存在 page leave 轨迹；
  - 检查关键帧，transform 始终为 `none`/未参与动画。
- 在 Rendering 面板模拟 `prefers-reduced-motion: reduce`：
  - 新页面仍有 `100ms` opacity 反馈；
  - 不出现 leave 动画或空间移动。
- **Done when**：`mode="out-in"` 和所有 `.page-leave-*` 样式均不存在；常规进入严格为 `200ms` 纯淡入，路由切换没有离场空档。
