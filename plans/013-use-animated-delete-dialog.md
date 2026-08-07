# 013 — 复用带动画的删除对话框

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Accessibility
- **Estimated scope**: 1 file，约 45 行删除与 15 行模板修改

## Problem

实例列表在视图内裸写了一套删除确认弹窗。它通过 `v-if` 瞬间出现/消失，没有任何进入、离开或 reduced-motion 处理；同时重复维护 scrim、容器、标题、正文和 actions 样式。

```vue
<!-- src/renderer/src/views/InstancesView.vue:175-191 — current -->
<!-- 删除操作必须经确认对话框后才提交到实例仓库 -->
<div v-if="pendingRemoveInstance" class="dialog-scrim" @click.self="cancelRemove">
  <div class="dialog" role="alertdialog" aria-modal="true">
    <h2 class="dialog__title">删除实例</h2>
    <p class="dialog__body">
      确定要删除实例「{{ pendingRemoveInstance.name }}」吗？此操作无法撤销。
    </p>
    <div class="dialog__actions">
      <button class="btn btn--text state-layer" type="button" @click="cancelRemove">
        取消
      </button>
      <button class="btn btn--error state-layer" type="button" @click="confirmRemove">
        删除
      </button>
    </div>
  </div>
</div>
```

```css
/* src/renderer/src/views/InstancesView.vue:346-383 — current */
.dialog-scrim {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
  display: grid;
  place-items: center;
  z-index: 20;
}

.dialog {
  width: 320px;
  padding: 24px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-sys-elevation-level3);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog__title {
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
}

.dialog__body {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

仓库已有 `BaseDialog`，统一负责 Teleport、遮罩点击、Esc 关闭和模态进出动画，但该页面没有复用它：

```vue
<!-- src/renderer/src/components/BaseDialog.vue:63-101 — existing exemplar -->
<Teleport to="body">
  <Transition name="dialog">
    <div v-if="open" class="dialog-scrim" @click.self="requestClose">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        :style="{ width: typeof width === 'number' ? `${width}px` : width }"
      >
        <h2 v-if="title" class="dialog__title">{{ title }}</h2>
        <div v-if="$slots.default" class="dialog__body">
          <slot />
        </div>
        <div v-if="$slots.actions" class="dialog__actions">
          <slot name="actions" />
        </div>
        <!-- … -->
      </div>
    </div>
  </Transition>
</Teleport>
```

`BaseDialog` 当前在 `src/renderer/src/components/BaseDialog.vue:45-59` 仅在 open 时监听 Esc，并在关闭/卸载时清理；它不主动移动、捕获或恢复焦点。当前裸对话框同样没有 autofocus、focus trap 或显式恢复焦点。因此本迁移必须保持这份现状，不在本计划中悄悄引入新的焦点策略。

## Target

在 `InstancesView.vue` 导入并复用现有 `BaseDialog`。`open` 由 `pendingRemoveInstance !== null` 驱动；标题和 320px 宽度保持不变；正文使用默认 slot，按钮使用 actions slot，以保留 destructive “删除”按钮的 `.btn--error` 样式。

```ts
// target import
import BaseDialog from '@/components/BaseDialog.vue';
```

```vue
<!-- target -->
<!-- 删除操作必须经确认对话框后才提交到实例仓库 -->
<BaseDialog
  :open="pendingRemoveInstance !== null"
  title="删除实例"
  :width="320"
  @close="cancelRemove"
>
  <p v-if="pendingRemoveInstance" class="remove-dialog__body">
    确定要删除实例「{{ pendingRemoveInstance.name }}」吗？此操作无法撤销。
  </p>
  <template #actions>
    <button class="btn btn--text state-layer" type="button" @click="cancelRemove">
      取消
    </button>
    <button class="btn btn--error state-layer" type="button" @click="confirmRemove">
      删除
    </button>
  </template>
</BaseDialog>
```

为正文保留原先的零 margin；字体和颜色由 `BaseDialog` 的 `.dialog__body` 容器继承，不在页面重复定义：

```css
/* target */
.remove-dialog__body {
  margin: 0;
}
```

删除 `InstancesView.vue` 中 `.dialog-scrim`、`.dialog`、`.dialog__title`、`.dialog__body`、`.dialog__actions` 全部重复样式。不要在页面复制或覆盖 `BaseDialog` 动画。

迁移后直接继承 `BaseDialog.vue:177-215` 的既有模态动效：scrim 过渡 opacity；dialog 过渡 opacity 和 transform，从 `scale(0.9)` 进入/离开；reduced-motion 下仅保留 `100ms` opacity 并将 transform 设为 none。本计划不调整这些既有值。

关闭和业务语义必须明确保持：

- 点击“取消”调用 `cancelRemove()`，只清空 `pendingRemoveInstance`；
- 点击 scrim 通过 `BaseDialog @close` 调用 `cancelRemove()`；
- 按 Escape 通过 `BaseDialog @close` 调用 `cancelRemove()`；
- 点击“删除”仍只调用现有 `confirmRemove()`，等待 `instancesStore.remove(id)` 后清空状态；
- 点击 dialog 内容不关闭；
- 不设置 `dismissible="false"`，使用默认 `true`；
- 不新增 autofocus、focus trap 或手动 `.focus()`；打开后触发删除的按钮保持原有浏览器焦点行为，关闭语义由 BaseDialog 统一提供。

## Repo conventions to follow

- `src/renderer/src/components/ErrorDialog.vue:2,69-120` 是复用 `BaseDialog` 并通过 actions slot 提供自定义按钮的现有范例。
- `src/renderer/src/components/BaseDialog.vue:22-30` 默认 `dismissible: true`、`width: 320`；本计划仍显式传 `:width="320"` 以固定删除确认框的尺寸契约。
- `src/renderer/src/components/BaseDialog.vue:37-59` 是关闭语义的唯一实现：scrim/Escape 触发 `close`，父组件负责清理 open 状态。
- `src/renderer/src/components/BaseDialog.vue:177-215` 已提供标准模态动效和 reduced-motion，不要在 `InstancesView.vue` 建立第二套 transition class。
- 页面现有 `.btn--error` 位于 `InstancesView.vue:329-332`，actions slot 中必须继续使用它，避免把破坏性操作误改为普通 primary 按钮。

## Steps

1. 在 `src/renderer/src/views/InstancesView.vue:7-9` 的组件导入区加入 `BaseDialog`，路径使用 `@/components/BaseDialog.vue`；保留现有导入顺序风格。
2. 将 `src/renderer/src/views/InstancesView.vue:176-191` 的裸 `v-if` scrim/dialog 整体替换为 Target 中的 `<BaseDialog>`。
3. 使用 `:open="pendingRemoveInstance !== null"`，不要把 `pendingRemoveInstance` 改成单独 boolean；使用 `@close="cancelRemove"` 接住 scrim 与 Escape 关闭。
4. 默认 slot 内保留 `v-if="pendingRemoveInstance"` 守卫，防止关闭过渡期间状态已清空却访问 `.name`。正文文本与实例名称插值必须逐字保持。
5. 使用 `#actions` slot 保留“取消”和“删除”两个按钮、原类名、type 和 click handler；不要使用 BaseDialog 默认 confirm 按钮，因为它不是 error 样式。
6. 添加 `.remove-dialog__body { margin: 0; }`，只处理 `<p>` 浏览器默认 margin；字体和颜色交给 BaseDialog 容器继承。
7. 删除 `InstancesView.vue:346-383` 的 `.dialog-scrim`、`.dialog`、`.dialog__title`、`.dialog__body`、`.dialog__actions`。确认页面不再残留这些局部重复选择器。
8. 不修改 `BaseDialog.vue`。迁移必须直接使用它当前的 Teleport、Transition、Escape listener、scrim click 与 reduced-motion 行为。

## Boundaries

- 只修改 `src/renderer/src/views/InstancesView.vue`；不要修改 `BaseDialog.vue` 或其他组件。
- 不要改变 `requestRemove`、`cancelRemove`、`confirmRemove`、store 删除调用、await 时机或删除后的状态清理。
- 不要增加 loading、disabled、错误处理、二次确认或自动关闭策略；这些属于业务变更。
- 不要给 `BaseDialog` 增加新 prop，不要覆盖其 transition、z-index、scrim、scale、duration 或 reduced-motion。
- 不要改动实例列表、筛选、搜索、卡片或按钮的其他样式。
- 不要新增 autofocus、focus trap、焦点恢复代码或第三方 focus 库；现有 `BaseDialog` 不提供这些能力，本计划只保持当前焦点策略并统一关闭入口。
- 不要添加依赖。
- 如果 commit `9285f50` 之后 `InstancesView.vue:90-102`、`175-191`、`309-383` 或 `BaseDialog.vue:37-101,177-215` 与摘录发生漂移，停止并报告，不要自行套用。

## Verification

- **Mechanical**：在仓库根目录依次运行：
  - `npm run typecheck:renderer`；预期退出码为 0，slot 与 nullable 实例访问无类型错误。
  - `npm run lint`；预期退出码为 0。
  - `npm test`；预期全部测试通过。
  - `npm run build:renderer`；预期 renderer 构建成功。
- **Feel check — 动效**：运行 `npm run dev:demo`，在实例列表点击任一删除按钮：
  - scrim 和 dialog 使用现有 BaseDialog 动效出现，不再瞬间弹出；
  - dialog 居中、宽度为 `320px`，正文和 actions 间距由 BaseDialog 保持；
  - 在 DevTools Animations 面板以 `10%` 播放，确认使用 `.dialog-*` 轨迹，不存在 `InstancesView` 自定义第二套模态轨迹。
- **Feel check — 关闭语义**：分别重新打开对话框并验证：
  - 点击 scrim 空白处关闭且不删除；
  - 点击 dialog 正文不关闭；
  - 按 Escape 关闭且不删除；
  - 点击“取消”关闭且不删除；
  - 点击“删除”仅执行一次原有删除流程，完成后关闭；
  - 快速重复打开/关闭时 transition 正常反向，不残留 scrim。
- **焦点检查**：
  - 仅用键盘聚焦一个实例的删除按钮并触发打开，确认没有新增脚本把焦点移动到意外元素；
  - Escape 关闭后继续按 Tab，焦点顺序仍回到实例卡片操作区附近；
  - 检查控制台无 focus、Teleport 或已卸载节点相关报错。
- 在 Rendering 面板模拟 `prefers-reduced-motion: reduce`：dialog 和 scrim 只做 BaseDialog 现有 `100ms` opacity 过渡，dialog 不缩放。
- 在 Elements 面板确认模态节点 Teleport 到 `body`，`role="dialog"`、`aria-modal="true"` 和标题派生的 `aria-label="删除实例"` 来自 BaseDialog。
- **Done when**：`InstancesView.vue` 只通过 `BaseDialog` 展示删除确认；本地 scrim/dialog 重复 CSS 已删除；删除业务、按钮、焦点策略和所有关闭路径保持明确，且模态自动继承现有动画与 reduced-motion。
