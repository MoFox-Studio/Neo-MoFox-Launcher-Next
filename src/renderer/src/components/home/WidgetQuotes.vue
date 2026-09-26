<script setup lang="ts">
// 名言部件：经主进程代理从在线一言服务获取句子，支持定时轮换与来源/作者/出处开关。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Quote, QuoteProviderId, QuotesWidgetConfig } from '@shared/domain/home';
import { mofoxApi } from '@/services/mofox-api';
import HomeWidgetCard from './HomeWidgetCard.vue';
import { QUOTE_ROTATION_MS } from '@/data/quote-providers';

const props = defineProps<{ config: QuotesWidgetConfig }>();

const quote = ref<Quote | null>(null);
const loading = ref(false);
const errorText = ref<string | null>(null);
let inFlight = false;
let timer: number | undefined;

/** 把任意抛出的错误收敛为可读文案。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

/** 随机模式下打乱来源顺序；显式指定来源时只尝试该来源。 */
function providerOrder(): QuoteProviderId[] {
  if (props.config.provider !== 'random') return [props.config.provider];
  return Math.random() < 0.5 ? ['hitokoto', 'jinrishici'] : ['jinrishici', 'hitokoto'];
}

/** 加载一条名言；随机模式下首个来源失败自动换下一个来源重试一次。 */
async function loadQuote(): Promise<Quote> {
  // 分类列表来自响应式设置树，先展开为纯数组再跨 IPC 传递。
  const categories = [...props.config.categories];
  const providers = providerOrder();
  let lastError: unknown;
  for (const provider of providers) {
    try {
      return await mofoxApi.fetchQuote(provider, categories);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('获取名言失败');
}

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  loading.value = true;
  errorText.value = null;
  try {
    quote.value = await loadQuote();
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
    inFlight = false;
  }
}

/** 依据轮换配置重建定时器；页面不可见时由回调自行跳过，避免后台空转请求。 */
function syncRotation(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
  const interval = props.config.rotation;
  if (interval === 'off') return;
  timer = window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, QUOTE_ROTATION_MS[interval]);
}

watch(() => props.config.rotation, syncRotation);
watch(() => props.config.provider, () => void refresh());
watch(() => props.config.categories.join(','), () => void refresh());

onMounted(() => {
  syncRotation();
  void refresh();
});

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});

/** 作者与出处的展示片段；各自独立受开关控制。 */
const attribution = computed(() => {
  const parts: string[] = [];
  if (props.config.showAuthor && quote.value?.author) parts.push(quote.value.author);
  if (props.config.showSource && quote.value?.source) parts.push(quote.value.source);
  return parts.join(' · ');
});
</script>

<template>
  <HomeWidgetCard title="名人名言" icon="format_quote" class="quote-widget">
    <template #actions>
      <button
        type="button"
        class="home-widget__icon-button state-layer"
        title="换一句"
        aria-label="换一句"
        :disabled="loading"
        @click="refresh"
      >
        <span class="msr" :class="{ 'quote-widget__spin': loading }" aria-hidden="true">
          refresh
        </span>
      </button>
    </template>

    <figure v-if="quote" class="quote-widget__figure">
      <blockquote :title="quote.text">“{{ quote.text }}”</blockquote>
      <figcaption v-if="attribution">—— {{ attribution }}</figcaption>
    </figure>

    <div v-else-if="loading" class="home-widget__placeholder">
      <span class="msr" aria-hidden="true">progress_activity</span>
      <span>正在获取名言…</span>
    </div>

    <div v-else-if="errorText" class="home-widget__placeholder">
      <span class="msr home-widget__placeholder-error" aria-hidden="true">cloud_off</span>
      <span>名言获取失败：{{ errorText }}</span>
      <button type="button" class="home-widget__text-button state-layer" @click="refresh">
        重试
      </button>
    </div>
  </HomeWidgetCard>
</template>

<style scoped>
.quote-widget__figure {
  margin: 0;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.quote-widget__figure blockquote {
  margin: 0;
  font: var(--md-sys-typescale-title-medium);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}

.quote-widget__figure figcaption {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.quote-widget__spin {
  animation: quote-widget-rotate 1s linear infinite;
}

@keyframes quote-widget-rotate {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .quote-widget__spin {
    animation: none;
  }
}
</style>
