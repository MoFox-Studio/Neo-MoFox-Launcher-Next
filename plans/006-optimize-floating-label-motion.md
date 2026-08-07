# 006 — 优化浮动标签位移动画

- **Status**: DONE
- **Commit**: 9285f50
- **Severity**: MEDIUM
- **Category**: Performance / Easing & duration / Accessibility
- **Estimated scope**: 3 files, about 45 lines changed

## Problem

三个表单实现都用 `transition: all` 驱动浮动标签，并在输入框获得焦点或已有内容时把 `top` 从 `50%` 改为 `0`。`transition: all` 会把未来新增的可动画属性也意外纳入过渡；逐帧插值 `top` 会触发布局，和已经存在的 `transform` 动画重复表达同一段位移。三个组件也都没有为标签位移单独提供 `prefers-reduced-motion` 降级。

`src/renderer/src/components/oobe/OobeDependencyInstall.vue:451-472` 当前完整相关代码：

```css
.field__label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
  padding: 0 4px;
  pointer-events: none;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus+.field__label,
.field__input:not(:placeholder-shown)+.field__label {
  top: 0;
  transform: translateY(-50%) scale(.85);
}

.field__input:focus+.field__label {
  color: var(--md-sys-color-primary);
}
```

`src/renderer/src/components/oobe/OobePreferences.vue:390-411` 当前完整相关代码：

```css
.field__label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface);
  padding: 0 4px;
  pointer-events: none;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus + .field__label,
.field__input:not(:placeholder-shown) + .field__label {
  top: 0;
  transform: translateY(-50%) scale(0.85);
}

.field__input:focus + .field__label {
  color: var(--md-sys-color-primary);
}
```

`src/renderer/src/views/InstallWizardView.vue:682-711` 当前完整相关代码：

```css
.field__label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface);
  padding: 0 4px;
  pointer-events: none;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus + .field__label,
.field__input:not(:placeholder-shown) + .field__label {
  top: 0;
  transform: translateY(-50%) scale(0.85);
}

.field__input:focus + .field__label {
  color: var(--md-sys-color-primary);
}

.field--error .field__input {
  border-color: var(--md-sys-color-error);
}

.field--error .field__label {
  color: var(--md-sys-color-error);
}
```

三处 `.field` 高度均为 `56px`。标签的定位锚点固定在 `top: 50%`（即距容器顶部 `28px`）后，只需在浮起状态额外向上平移 `28px`，即可得到原来 `top: 0; transform: translateY(-50%)` 的同一最终几何位置。

## Target

三处标签都必须遵守以下运动合同：

- `top` 始终为 `50%`，状态切换不再修改任何布局属性。
- 仅过渡 `transform` 和 `color`。
- 两个属性都使用精确的 `200ms cubic-bezier(0.23, 1, 0.32, 1)`。
- 正常状态为 `translateY(-50%)`；浮起状态为 `translateY(calc(-50% - 28px)) scale(0.85)`。
- reduced-motion 下取消位置过渡，但保留有助于识别焦点/错误状态的 `color` 过渡。

在三个文件中分别使用以下目标代码；保留各文件现有的 `background` 值以及既有选择器空格风格，不需要为格式统一而扩大改动：

```css
/* target — 三处 .field__label 的 transition 均替换为以下声明 */
.field__label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  /* 其余现有视觉声明原样保留 */
  transition:
    transform 200ms cubic-bezier(0.23, 1, 0.32, 1),
    color 200ms cubic-bezier(0.23, 1, 0.32, 1);
}

.field__input:focus + .field__label,
.field__input:not(:placeholder-shown) + .field__label {
  transform: translateY(calc(-50% - 28px)) scale(0.85);
}
```

`OobeDependencyInstall.vue` 可保留当前无空格的相邻兄弟选择器写法，但结果必须等价：

```css
.field__input:focus+.field__label,
.field__input:not(:placeholder-shown)+.field__label {
  transform: translateY(calc(-50% - 28px)) scale(.85);
}
```

在三个文件各自的 `<style scoped>` 末尾加入以下 reduced-motion 覆盖；`InstallWizardView.vue` 已有 media query，应把规则合并到该现有区块中，不得创建第二个同条件区块：

```css
@media (prefers-reduced-motion: reduce) {
  .field__label {
    transition: color 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }
}
```

这里不使用 `transition: none`：颜色反馈用于区分普通、焦点与错误状态，不产生位移，应该保留。

## Repo conventions to follow

- `src/renderer/src/styles/tokens.css:51-59` 已定义 Material motion token，且 `--md-sys-motion-duration-short4` 当前等于 `200ms`；本计划仍按需求在三个局部 scoped 样式中写明精确 `200ms cubic-bezier(0.23, 1, 0.32, 1)`，不要修改全局 token 或把现有全局曲线改义。
- `src/renderer/src/components/AppTitleBar.vue:105-107` 已用逗号分隔的显式属性列表过渡 `background-color` 与 `transform`，应仿照这种“只声明会动的属性”的模式，禁止继续使用 `all`。
- `src/renderer/src/views/InstallWizardView.vue:962-989` 已有 `prefers-reduced-motion: reduce` 区块，并采用“去掉位移、保留非空间反馈”的模式；把标签覆盖合并到这里。
- 三处 `.field` 都是固定 `56px` 高，因此 `28px` 是从当前代码直接推导出的半高，不是视觉估算。不要把它抽成新全局变量，也不要改字段高度。

## Steps

1. 编辑 `src/renderer/src/components/oobe/OobeDependencyInstall.vue`：把 `.field__label` 的 `transition: all ...` 改为精确的 `transform`、`color` 两项 200ms 曲线；从浮起选择器删除 `top: 0`，把 transform 改为 `translateY(calc(-50% - 28px)) scale(.85)`。
2. 在 `OobeDependencyInstall.vue` 的 scoped style 末尾添加 reduced-motion 区块，使 `.field__label` 只保留相同 200ms 曲线的 `color` transition。
3. 对 `src/renderer/src/components/oobe/OobePreferences.vue` 执行同样替换，保留其 `scale(0.85)` 与选择器空格风格，并在 scoped style 末尾增加相同 reduced-motion 覆盖。
4. 对 `src/renderer/src/views/InstallWizardView.vue` 执行同样替换；保留 `.field--error .field__label` 的错误色规则，使 color transition 同时覆盖普通色、焦点色与错误色之间的变化。
5. 把 `InstallWizardView.vue` 的 `.field__label` reduced-motion 规则合并到现有 `@media (prefers-reduced-motion: reduce)`（当前 `962-989`），不要新增重复 media query。
6. 检查三处浮起选择器：不得再包含 `top`；三处 `.field__label` 不得再包含 `transition: all`；不要改模板或 TypeScript。

## Boundaries

- 只修改 `src/renderer/src/components/oobe/OobeDependencyInstall.vue`、`src/renderer/src/components/oobe/OobePreferences.vue`、`src/renderer/src/views/InstallWizardView.vue` 中上述浮动标签样式。
- 不要修改 `src/renderer/src/styles/tokens.css`，不要新增 motion token，不要改变其他组件的 easing。
- 不要改变 `.field` 的 `56px` 高度、input padding、边框宽度、标签字体、背景、颜色、缩放值或 DOM 结构。
- 不要把 transition 扩展到 `opacity`、`font-size`、`top`、`left`、padding 或任何其他属性。
- reduced-motion 只移除 transform 的插值；标签仍应立即到达正确位置并继续平滑切换 color。
- 当前几何推导依赖 `.field` 高度为 `56px`。若执行时任一目标 `.field` 不再是 `56px`，或 commit `9285f50` 后上述摘录发生漂移，停止并报告，不要猜测新偏移量。
- 不要添加依赖、测试框架、注释或无关格式化。

## Verification

- **Mechanical**：在仓库根目录依次运行 `npm run typecheck:renderer`、`npm run lint`、`npm test`、`npm run build:renderer`；四个命令都必须以退出码 0 完成。
- **Static mechanical check**：搜索三个目标文件，确认 `.field__label` 不再出现 `transition: all`，浮起选择器不再设置 `top: 0`，且 transition 列表只包含 `transform` 和 `color`。
- **Performance mechanical check**：在 Chromium DevTools Performance 面板录制一次空字段 focus/blur 和一次已有值字段 focus/blur。筛选对应 200ms 区间，`.field__label` 动画帧不得产生由 `top` 插值导致的逐帧 `Layout`；Computed 面板中 `top` 在整个切换期间必须始终为 `28px`（`56px` 容器的 50%）。
- **几何检查**：分别在依赖安装 sudo 密码、OOBE 默认安装目录、安装向导实例名称/自定义版本/目标目录字段检查空态与浮起态。浮起后的标签中心必须仍贴合输入框上边线，不能比修改前高或低，也不能被边框切断。
- **Feel check（10% 慢放）**：在 DevTools Animations 面板把 playback rate 设为 `10%`，依次 focus、输入一个字符、blur、清空。确认标签从中心快速起步并平顺减速到边框，路径只有垂直位移和缩放；开始/结束时不得因 `top` 与 transform 叠加而跳一帧，color 与 transform 应在同一 200ms 窗口完成。
- **中断检查**：动画未结束前快速重复 focus/blur，确认 CSS transition 从当前视觉位置重定向，不回跳到起点。
- **Reduced motion**：在 DevTools Rendering 面板模拟 `prefers-reduced-motion: reduce`。focus 或输入时标签必须立即到达浮起位置，不播放空间位移；焦点色和错误色仍以 `200ms cubic-bezier(0.23, 1, 0.32, 1)` 过渡。
- **Done when**：三处标签最终几何位置与当前实现一致；正常偏好下只插值 `transform`/`color` 且无逐帧 Layout；减少动态效果时无位置动画但颜色反馈保留。
