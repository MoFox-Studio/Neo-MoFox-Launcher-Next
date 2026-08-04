<script setup lang="ts">
import { ref, computed } from 'vue';
import { useOobeStore } from '@/stores/oobe';
import { MofoxError } from '@shared/domain/error';

const oobe = useOobeStore();

const password = ref('');
const confirmPassword = ref('');
const verifying = ref(false);
const errorMessage = ref<string | null>(null);

const canSubmit = computed(
  () => password.value.length > 0 && password.value === confirmPassword.value && !verifying.value,
);

const emit = defineEmits<{ (e: 'next'): void; (e: 'skip'): void }>();

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  verifying.value = true;
  errorMessage.value = null;
  try {
    const ok = await oobe.verifySudo(password.value);
    if (!ok) {
      errorMessage.value = '密码错误或 sudo 不可用，请重新输入。';
      return;
    }
    emit('next');
  } catch (error) {
    errorMessage.value = error instanceof MofoxError ? error.message : '验证失败，请重试。';
  } finally {
    verifying.value = false;
  }
}
</script>

<template>
  <section class="oobe-step">
    <h2 class="oobe__step-title">授权与密码</h2>
    <p class="oobe__step-desc">
      接下来安装系统依赖需要 sudo 权限。密码仅用于本次安装期间在主进程内存中保留，安装完成后立即清空，不会写入磁盘。
    </p>

    <div class="sudo-form">
      <label class="field">
        <input
          v-model="password"
          class="field__input"
          type="password"
          placeholder=" "
          autocomplete="new-password"
        />
        <span class="field__label">sudo 密码</span>
      </label>

      <label class="field">
        <input
          v-model="confirmPassword"
          class="field__input"
          type="password"
          placeholder=" "
          autocomplete="new-password"
          @keyup.enter="submit"
        />
        <span class="field__label">确认密码</span>
      </label>

      <p v-if="password && confirmPassword && password !== confirmPassword" class="field__support field__support--error">
        两次输入不一致
      </p>
      <p v-else-if="errorMessage" class="field__support field__support--error">{{ errorMessage }}</p>

      <div class="sudo-actions">
        <button type="button" class="btn btn--text state-layer" @click="emit('skip')">跳过依赖安装</button>
        <button
          type="button"
          class="btn btn--filled state-layer"
          :disabled="!canSubmit"
          @click="submit"
        >
          <span v-if="verifying" class="spinner spinner--small" aria-hidden="true"></span>
          验证并继续
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sudo-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 420px;
}

.sudo-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

.field {
  position: relative;
  display: block;
  height: 56px;
}

.field__input {
  width: 100%;
  height: 100%;
  padding: 20px 16px 6px;
  border-radius: var(--md-sys-shape-corner-small);
  border: 1px solid var(--md-sys-color-outline);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
  outline: none;
  transition: border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus {
  border: 2px solid var(--md-sys-color-primary);
  padding: 19px 15px 5px;
}

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

.field__support {
  margin: -14px 0 0 16px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.field__support--error {
  color: var(--md-sys-color-error);
}

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
  animation: spinner-spin 0.8s linear infinite;
}

.spinner--small {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
