<script setup lang="ts">
import type { Instance } from '@shared/domain/instance';
import ErrorDialog from '@/components/ErrorDialog.vue';
import { useInstanceUpdates } from '@/composables/use-instance-updates';
const props = defineProps<{ instance: Instance }>();
const emit = defineEmits<{ toast: [message: string] }>();
const {
  errorDialog,
  target,
  mofoxInfo,
  loadingMofox,
  loadingPlatform,
  switchingBranch,
  checkingOut,
  updatingMofox,
  updatingPlatform,
  selectedBranch,
  env,
  progress,
  busy,
  mofoxBranches,
  mofoxCommits,
  hasMofoxUpdate,
  releases,
  platformInstalled,
  platformCurrentVersion,
  formatDate,
  refresh,
  onBranchChange,
  doSwitchBranch,
  doCheckout,
  doUpdateMofox,
  doUpdatePlatform,
  openRepository,
} = useInstanceUpdates(props, emit);
</script>

<template>
  <section class="manage-group">
    <div class="manage-group__card">
      <!-- 卡片头部：分区图标 + 标题描述 + 目标切换与刷新 -->
      <div class="manage-group__heading">
        <span class="msr" aria-hidden="true">system_update</span>
        <div>
          <h2>版本管理</h2>
          <p>主程序与平台版本管理</p>
        </div>
        <div class="update-heading__actions">
          <!-- 顶部切换：Neo-MoFox / 平台 -->
          <div class="update-targets" role="tablist" aria-label="更新目标">
            <button
              class="update-target state-layer"
              :class="{ 'update-target--active': target === 'mofox' }"
              type="button"
              role="tab"
              :aria-selected="target === 'mofox'"
              @click="target = 'mofox'"
            >
              <span class="msr" aria-hidden="true">smart_toy</span>
              Neo-MoFox
            </button>
            <button
              class="update-target state-layer"
              :class="{ 'update-target--active': target === 'platform' }"
              type="button"
              role="tab"
              :aria-selected="target === 'platform'"
              @click="target = 'platform'"
            >
              <span class="msr" aria-hidden="true">terminal</span>
              平台
            </button>
          </div>
          <button
            class="icon-btn state-layer"
            type="button"
            title="刷新版本信息"
            aria-label="刷新版本信息"
            @click="refresh"
          >
            <span class="msr" aria-hidden="true">refresh</span>
          </button>
        </div>
      </div>

      <div class="manage-group__body">
        <!-- ─── 主程序更新：连续双列信息流，两列始终等高 ─── -->
        <div v-if="target === 'mofox'" class="update-two-col">
          <div class="update-panel update-panel--left">
            <!-- 版本信息卡片：双栏展示当前版本信息与提交信息 -->
            <div class="update-card info-card-split">
              <div class="info-split-col">
                <h3 class="update-card__title">
                  <span class="msr" aria-hidden="true">info</span>
                  当前版本信息
                </h3>
                <div class="update-item">
                  <span class="update-item__label">当前分支</span>
                  <span class="update-badge">{{ mofoxInfo?.branch ?? '—' }}</span>
                </div>
                <div class="update-item">
                  <span class="update-item__label">当前版本</span>
                  <span class="update-value update-value--mono">{{
                    mofoxInfo?.currentCommit?.hash ?? '—'
                  }}</span>
                </div>
              </div>
              <div class="info-split-col">
                <h3 class="update-card__title">
                  <span class="msr" aria-hidden="true">update</span>
                  提交信息
                </h3>
                <div class="update-item">
                  <span class="update-item__label">最新提交</span>
                  <div class="commit-box">
                    <code class="commit-box__hash">{{
                      mofoxInfo?.currentCommit?.hash ?? '—'
                    }}</code>
                    <span class="commit-box__message">{{
                      mofoxInfo?.currentCommit?.message || '—'
                    }}</span>
                  </div>
                </div>
                <div class="update-item">
                  <span class="update-item__label">提交时间</span>
                  <span class="update-value">{{ formatDate(mofoxInfo?.currentCommit?.date) }}</span>
                </div>
              </div>
            </div>

            <!-- 分支切换 -->
            <div class="update-card">
              <h3 class="update-card__title">
                <span class="msr" aria-hidden="true">account_tree</span>
                分支切换
              </h3>
              <div class="update-control-row">
                <md-outlined-select
                  class="update-select"
                  label="选择分支"
                  :value="selectedBranch"
                  :disabled="loadingMofox || switchingBranch || busy"
                  @change="onBranchChange"
                >
                  <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
                  <!-- eslint-disable vue/no-deprecated-slot-attribute -->
                  <md-select-option v-for="branch in mofoxBranches" :key="branch" :value="branch">
                    <div slot="headline">{{ branch }}</div>
                  </md-select-option>
                  <!-- eslint-enable vue/no-deprecated-slot-attribute -->
                </md-outlined-select>
                <button
                  class="btn btn--filled state-layer"
                  type="button"
                  :disabled="!selectedBranch || switchingBranch || busy"
                  @click="doSwitchBranch"
                >
                  <span class="msr btn__icon" aria-hidden="true">swap_horiz</span>
                  {{ switchingBranch ? '切换中…' : '切换' }}
                </button>
              </div>
              <p class="update-hint">注意：切换分支将会暂存本地更改并拉取最新代码。</p>
            </div>

            <!-- 仓库状态 -->
            <div class="update-card update-fill-card">
              <h3 class="update-card__title">
                <span class="msr" aria-hidden="true">analytics</span>
                仓库状态
              </h3>
              <div class="update-item">
                <span class="update-item__label">本地进度</span>
                <span class="update-value">
                  <span class="count-chip">领先 {{ mofoxInfo?.aheadCount ?? 0 }}</span>
                  <span class="count-chip">落后 {{ mofoxInfo?.behindCount ?? 0 }}</span>
                </span>
              </div>
              <div class="update-item">
                <span class="update-item__label">远程分支</span>
                <span class="update-value">{{ mofoxInfo?.branches?.length ?? 0 }} 个可用分支</span>
              </div>
              <div class="update-item">
                <span class="update-item__label">更新依赖</span>
                <div class="dep-list">
                  <span class="dep-item">
                    <span class="msr" aria-hidden="true">code</span>
                    <span>Git</span>
                    <code>{{ env?.gitVersion || '—' }}</code>
                  </span>
                  <span class="dep-item">
                    <span class="msr" aria-hidden="true">terminal</span>
                    <span>uv</span>
                    <code>{{ env?.uvVersion || '—' }}</code>
                  </span>
                  <span class="dep-item">
                    <span class="msr" aria-hidden="true">science</span>
                    <span>Python</span>
                    <code>{{ env?.pythonVersion || '—' }}</code>
                  </span>
                </div>
              </div>
              <div class="update-repo-row">
                <span class="msr" aria-hidden="true">link</span>
                <span class="update-repo-row__text">MoFox-Studio/Neo-MoFox</span>
                <button
                  class="btn btn--tonal btn--small state-layer"
                  type="button"
                  @click="openRepository"
                >
                  <span class="msr btn__icon" aria-hidden="true">open_in_new</span>
                  打开仓库
                </button>
              </div>
            </div>
          </div>

          <div class="update-panel update-panel--right">
            <!-- 检查更新 -->
            <div class="update-card">
              <h3 class="update-card__title">
                <span class="msr" aria-hidden="true">system_update</span>
                检查更新
              </h3>
              <div class="update-status" :class="{ 'update-status--ok': hasMofoxUpdate }">
                <span class="msr" :class="{ spinning: loadingMofox }" aria-hidden="true">
                  {{
                    loadingMofox
                      ? 'progress_activity'
                      : hasMofoxUpdate
                        ? 'system_update'
                        : 'check_circle'
                  }}
                </span>
                <span class="update-status__text">
                  {{
                    loadingMofox
                      ? '正在检查更新...'
                      : hasMofoxUpdate
                        ? `发现 ${mofoxInfo?.behindCount ?? 0} 个新提交`
                        : '已是最新版本'
                  }}
                </span>
              </div>
              <button
                class="btn btn--tonal update-full"
                type="button"
                :disabled="!mofoxInfo?.isRepository || updatingMofox || busy"
                @click="doUpdateMofox"
              >
                <span class="msr btn__icon" aria-hidden="true">download</span>
                {{ updatingMofox ? '更新中…' : '检查并更新' }}
              </button>
            </div>

            <!-- 提交历史：仅长列表本身保留局部滚动 -->
            <div class="update-card update-scroll-card">
              <h3 class="update-card__title">
                <span class="msr" aria-hidden="true">history</span>
                提交历史
              </h3>
              <div v-if="loadingMofox" class="update-placeholder">
                <span class="msr update-placeholder__icon spinning" aria-hidden="true"
                  >progress_activity</span
                >
                <span>加载提交历史...</span>
              </div>
              <div v-else-if="mofoxCommits.length === 0" class="update-placeholder">
                <span>暂无提交记录</span>
              </div>
              <div v-else class="update-scroll">
                <ul class="version-list">
                  <li
                    v-for="commit in mofoxCommits"
                    :key="commit.fullHash"
                    class="version-item"
                    :class="{ 'version-item--current': commit.isCurrent }"
                  >
                    <div class="version-item__info">
                      <span class="version-item__tag">
                        <code class="version-item__hash">{{ commit.hash }}</code>
                        <span v-if="commit.isCurrent" class="version-item__current-badge"
                          >当前</span
                        >
                      </span>
                      <span class="version-item__message">{{ commit.message }}</span>
                      <span class="version-item__date">{{ formatDate(commit.date) }}</span>
                    </div>
                    <button
                      class="btn btn--tonal btn--small state-layer"
                      type="button"
                      :disabled="commit.isCurrent || checkingOut || busy"
                      @click="doCheckout(commit.hash)"
                    >
                      {{ commit.isCurrent ? '当前版本' : checkingOut ? '回退中…' : '回退' }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── 平台更新 ─── -->
        <div v-else class="update-platform">
          <template v-if="platformInstalled">
            <div class="update-card">
              <h3 class="update-card__title">
                <span class="msr" aria-hidden="true">info</span>
                当前平台版本信息
              </h3>
              <div class="update-item">
                <span class="update-item__label">当前版本</span>
                <span class="update-badge update-badge--success">{{
                  platformCurrentVersion ?? '未知'
                }}</span>
              </div>
              <div class="update-item">
                <span class="update-item__label">安装路径</span>
                <span class="update-value update-value--mono">{{
                  instance.platform?.installDir || '—'
                }}</span>
              </div>
            </div>

            <!-- 可用版本列表：更新按钮在列表上方，长列表内部滚动 -->
            <div class="update-card update-scroll-card">
              <div class="update-card__head-row">
                <h3 class="update-card__title" style="margin: 0">
                  <span class="msr" aria-hidden="true">history</span>
                  可用版本列表
                </h3>
                <button
                  class="btn btn--filled state-layer"
                  type="button"
                  :disabled="updatingPlatform || busy"
                  @click="doUpdatePlatform('')"
                >
                  <span class="msr btn__icon" aria-hidden="true">download</span>
                  {{ updatingPlatform ? '更新中…' : '更新到最新' }}
                </button>
              </div>
              <div v-if="loadingPlatform" class="update-placeholder">
                <span class="msr update-placeholder__icon spinning" aria-hidden="true"
                  >progress_activity</span
                >
                <span>加载版本列表...</span>
              </div>
              <div v-else class="update-scroll">
                <ul class="version-list">
                  <li
                    v-for="release in releases"
                    :key="release.tag_name"
                    class="version-item"
                    :class="{
                      'version-item--current': release.tag_name === platformCurrentVersion,
                    }"
                  >
                    <div class="version-item__info">
                      <span class="version-item__tag">
                        {{ release.tag_name }}
                        <span v-if="release.prerelease" class="version-item__prerelease"
                          >预发布</span
                        >
                      </span>
                      <span class="version-item__date">{{ formatDate(release.published_at) }}</span>
                    </div>
                    <button
                      class="btn btn--tonal btn--small state-layer"
                      type="button"
                      :disabled="
                        updatingPlatform || busy || release.tag_name === platformCurrentVersion
                      "
                      @click="doUpdatePlatform(release.tag_name)"
                    >
                      {{
                        release.tag_name === platformCurrentVersion
                          ? '当前版本'
                          : updatingPlatform
                            ? '更改中…'
                            : '更改到此版本'
                      }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </template>

          <div v-else class="update-empty">
            <span class="msr update-empty__icon" aria-hidden="true">warning</span>
            <h3 class="update-empty__title">平台未安装</h3>
            <p class="update-empty__desc">
              当前实例尚未安装平台组件，请在实例配置中安装平台后再进行版本管理。
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 更新进行中的进度覆盖层 -->
    <Transition name="progress-fade">
      <div v-if="busy" class="update-progress" role="status">
        <div class="update-progress__card">
          <div class="update-progress__icon">
            <span class="msr spinning" aria-hidden="true">sync</span>
          </div>
          <span class="update-progress__message">{{ progress?.message ?? '处理中...' }}</span>
          <div class="update-progress__track">
            <div
              class="update-progress__bar"
              :style="{
                width: progress && progress.percent >= 0 ? `${progress.percent * 100}%` : '40%',
              }"
            ></div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 更新失败时的应用内错误框 -->
    <ErrorDialog
      :open="errorDialog !== null"
      :title="errorDialog?.title ?? '更新失败'"
      :description="errorDialog?.description ?? '更新失败，请稍后重试'"
      :stack="errorDialog?.stack"
      @close="errorDialog = null"
    />
  </section>
</template>

<style scoped src="./InstanceUpdatePanel.css"></style>
