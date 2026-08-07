# Animation improvement plans

本轮计划基于 commit `9285f50`。执行器必须在引用代码发生漂移时停止并报告，不得自行猜测套用。

## 计划清单

| # | 计划 | 严重度 | 状态 | 依赖 |
| --- | --- | --- | --- | --- |
| 002 | [加快高频路由切换](002-speed-up-route-transitions.md) | MEDIUM | REVERTED | 已由 010 取代 |
| 003 | [修正安装向导切换方向](003-directional-wizard-transitions.md) | MEDIUM | DONE | 无 |
| 004 | [优化设置开关动画](004-optimize-settings-switch.md) | MEDIUM | DONE | 无 |
| 005 | [使用变换驱动安装进度](005-transform-install-progress.md) | MEDIUM | DONE | 无 |
| 006 | [优化浮动标签位移动画](006-optimize-floating-label-motion.md) | MEDIUM | DONE | 008 需合并相同文件的 reduced-motion 规则 |
| 007 | [优化错误日志展开揭示](007-optimize-error-log-reveal.md) | MEDIUM | DONE | 无 |
| 008 | [完善全局减弱动态效果](008-complete-reduced-motion.md) | HIGH | DONE | 建议最先执行 |
| 009 | [为 OOBE 加入方向切换](009-directional-oobe-transitions.md) | MEDIUM | DONE | 008 的无障碍约定 |
| 010 | [加快当前路由切换](010-speed-up-current-route-transitions.md) | MEDIUM | DONE | 取代 002 |
| 011 | [收敛实例列表动效](011-refine-instance-list-motion.md) | MEDIUM | DONE | 保留 008 的 reduced-motion 行为 |
| 012 | [动画化安装流程状态](012-animate-install-flow-states.md) | MEDIUM | DONE | 006、008；合并 InstallWizardView 样式 |
| 013 | [复用带动画的删除对话框](013-use-animated-delete-dialog.md) | MEDIUM | DONE | 直接复用 BaseDialog |

## 推荐执行顺序

1. **008 — 完善全局减弱动态效果**：先建立所有后续动效必须遵守的无障碍底线。
2. **006 — 优化浮动标签位移动画**：消除三处 `transition: all` 和 `top` 布局动画；执行时合并 008 已加入的同条件 media query。
3. **007 — 优化错误日志展开揭示**：消除错误日志的逐帧 `height` 布局动画。
4. **010 — 加快当前路由切换**：移除主导航约 400ms 的串行等待；该计划正式取代已回退的 002。
5. **011 — 收敛实例列表动效**：移除不可点击卡片的装饰位移，并统一不定进度节奏。
6. **009 — 为 OOBE 加入方向切换**：在性能与无障碍基础稳定后修正前后导航空间关系。
7. **012 — 动画化安装流程状态**：最后为日志折叠、成功和失败状态增加克制动效；需与 006、008 对 InstallWizardView 的修改合并。
8. **013 — 复用带动画的删除对话框**：独立改动，可在 008 后任意执行。

## 依赖与冲突说明

- **002 不要执行**：其状态为 `REVERTED`，当前代码与摘录已经漂移；使用 010。
- **006、008、012 都会修改 `InstallWizardView.vue`**：必须按 `008 → 006 → 012` 顺序执行，并合并现有 `@media (prefers-reduced-motion: reduce)`，不要创建互相覆盖的重复规则。
- **008 与 009 都涉及 OOBE reduced motion**：008 修改子组件 spinner；009 修改父级步骤 transition，写集不重叠，但必须共同验证。
- **008 与 011 都涉及 reduced motion**：011 必须保留实例进度条在 reduce 模式下停止并以 `opacity: 0.65` 静态显示的行为。
- **013 不修改 `BaseDialog.vue`**：直接继承既有模态动效和 reduced-motion，不建立第二套动画。
- 所有计划均禁止新增动画依赖；继续使用 Vue `<Transition>`、CSS transition/keyframes 与现有 motion token。

## 统一验证

完成全部计划后，在仓库根目录依次运行：

```sh
npm run typecheck:renderer
npm run lint
npm test
npm run build:renderer
```

然后运行 `npm run dev:demo`：

1. 在 Chromium DevTools Animations 面板使用 `10%` 播放速度检查每项计划的路径、方向和时长。
2. 在 Rendering 面板模拟 `prefers-reduced-motion: reduce`，确认空间运动、旋转和脉冲被移除，但 opacity、颜色和静态状态仍可理解。
3. 在 Performance 面板检查浮动标签和错误日志展开，不得出现由 `top` 或 `height` 动画导致的连续 Layout。
4. 快速重复导航、展开/收起和切换步骤，确认 CSS transitions 可从当前视觉状态反向，不会从关键帧起点重播。
