<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import type { MofoxBranch } from '@shared/domain/install';
import { useInstallDraftStore } from '@/stores/install-draft';

// 网络配置步骤：选择平台适配器、MoFox 跟踪分支与 OneBot WebSocket 端口。
const store = useInstallDraftStore();
const draft = store.draft;

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
};

const platforms = ref<BotPlatformMetadata[]>([]);
const loading = ref(false);
const platformError = ref('');
// 平台下拉框引用：选项异步渲染后需手动同步值，否则 Material select 不显示选中项。
const platformSelect = ref<{ value: string } | null>(null);

// 后端已按当前系统过滤，返回的平台均可安装；SnowLuma 优先推荐，作为默认选择。
const selectedPlatform = computed<BotPlatformMetadata | null>(
  () => platforms.value.find((p) => p.id === draft.platformId) ?? null,
);

function platformLabel(sys: string): string {
  return PLATFORM_LABELS[sys] ?? sys;
}

// 默认选择：用户尚未选择时，优先 SnowLuma，其次第一个可用平台。
function applyRecommendedPlatform(): void {
  if (platforms.value.some((p) => p.id === draft.platformId)) return;
  const target = platforms.value.find((p) => p.id === 'snowluma') ?? platforms.value[0];
  if (target) store.set('platformId', target.id);
}

function onPlatformChange(event: Event): void {
  store.set('platformId', (event.target as HTMLSelectElement).value);
  store.touch('platformId');
}

function onBranchChange(event: Event): void {
  store.set('mofoxBranch', (event.target as HTMLSelectElement).value as MofoxBranch);
}

function onPortInput(event: Event): void {
  const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
  store.set('wsPort', Number.isNaN(value) ? 0 : value);
  store.touch('wsPort');
}

onMounted(async () => {
  loading.value = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
    applyRecommendedPlatform();
    // Material select 的 value setter 会立即查询已渲染的选项；选项是异步渲染的，
    // 需等 DOM 就绪后把当前值同步给它，否则下拉框不显示选中项。
    await nextTick();
    if (platformSelect.value) platformSelect.value.value = draft.platformId;
  } catch (error) {
    platformError.value = error instanceof Error ? error.message : '平台列表加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="step">
    <div class="step-header">
      <h1>网络配置</h1>
      <p>选择平台适配器、MoFox 更新通道以及机器人监听的 WebSocket 端口。</p>
    </div>

    <form class="config-form" @submit.prevent>
      <div class="form-group">
        <md-outlined-select
          id="input-platform"
          ref="platformSelect"
          class="platform-select"
          label="安装平台"
          :value="draft.platformId"
          :disabled="loading || Boolean(platformError)"
          @change="onPlatformChange"
        >
          <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
          <!-- eslint-disable vue/no-deprecated-slot-attribute -->
          <md-select-option value="">
            <div slot="headline">不安装平台</div>
          </md-select-option>
          <md-select-option v-for="p in platforms" :key="p.id" :value="p.id">
            <div slot="headline">{{ p.name }}</div>
          </md-select-option>
          <!-- eslint-enable vue/no-deprecated-slot-attribute -->
        </md-outlined-select>
        <template v-if="loading">
          <span class="platform-hint">正在加载可用平台…</span>
        </template>
        <template v-else-if="platformError">
          <span class="platform-hint">{{ platformError }}</span>
        </template>
        <template v-else-if="platforms.length === 0">
          <span class="platform-hint">当前系统没有可用的平台适配器</span>
        </template>
        <template v-else>
          <span class="platform-hint">
            <template v-if="selectedPlatform">
              {{ selectedPlatform.description }}（{{
                selectedPlatform.supportedPlatforms.map(platformLabel).join(' / ')
              }}）
            </template>
            <template v-else>不安装任何平台适配器，仅安装 Neo-MoFox 核心与已选组件</template>
          </span>
        </template>
      </div>

      <div class="form-row two-cols">
        <div class="form-group">
          <md-outlined-select
            id="input-branch"
            class="platform-select"
            label="更新通道"
            :value="draft.mofoxBranch"
            @change="onBranchChange"
          >
            <!-- eslint-disable vue/no-deprecated-slot-attribute -->
            <md-select-option :value="'main' as MofoxBranch">
              <div slot="headline">稳定版 (main)</div>
            </md-select-option>
            <md-select-option :value="'dev' as MofoxBranch">
              <div slot="headline">开发版 (dev)</div>
            </md-select-option>
            <!-- eslint-enable vue/no-deprecated-slot-attribute -->
          </md-outlined-select>
          <p class="field__support">选择跟踪的 GitHub 分支</p>
        </div>

        <div class="form-group">
          <label class="field" :class="{ 'field--error': store.isInvalid('wsPort') }">
            <input
              id="input-ws-port"
              class="field__input"
              type="number"
              :value="draft.wsPort"
              min="1024"
              max="65535"
              placeholder=" "
              @input="onPortInput"
            />
            <span class="field__label">WebSocket 端口 *</span>
          </label>
          <p v-if="store.isInvalid('wsPort')" class="field__support field__support--error">
            {{ store.fieldErrors.wsPort }}
          </p>
          <p v-else class="field__support">1024-65535，平台 WS 客户端将连接到此端口</p>
        </div>
      </div>
    </form>
  </section>
</template>
