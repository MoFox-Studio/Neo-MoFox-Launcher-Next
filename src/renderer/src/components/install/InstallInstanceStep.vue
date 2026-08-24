<script setup lang="ts">
import { useInstallDraftStore } from '@/stores/install-draft';

// 实例信息步骤：实例名称、Bot QQ 号与主人 QQ 号；所有输入都有校验与错误提示。
const store = useInstallDraftStore();
const draft = store.draft;
</script>

<template>
  <section class="step">
    <h2 class="step__title">实例信息</h2>
    <p class="step__desc">为你的 Bot 实例设置名称，并填写机器人与主人的 QQ 账号。</p>

    <label class="field" :class="{ 'field--error': store.isInvalid('instanceName') }">
      <input
        v-model="draft.instanceName"
        class="field__input"
        type="text"
        placeholder=" "
        maxlength="32"
        @input="store.touch('instanceName')"
      />
      <span class="field__label">实例名称</span>
    </label>
    <p v-if="store.isInvalid('instanceName')" class="field__support field__support--error">
      {{ store.fieldErrors.instanceName }}
    </p>
    <p v-else class="field__support">1-32 字符，用于在启动器中标识此实例</p>

    <div class="field__row">
      <div>
        <label class="field" :class="{ 'field--error': store.isInvalid('botQQ') }">
          <input
            v-model="draft.botQQ"
            class="field__input"
            type="text"
            inputmode="numeric"
            placeholder=" "
            maxlength="12"
            @input="store.touch('botQQ')"
          />
          <span class="field__label">Bot QQ 号</span>
        </label>
        <p v-if="store.isInvalid('botQQ')" class="field__support field__support--error">
          {{ store.fieldErrors.botQQ }}
        </p>
        <p v-else class="field__support">建议使用小号，避免封号风险</p>
      </div>

      <div>
        <label class="field" :class="{ 'field--error': store.isInvalid('ownerQQ') }">
          <input
            v-model="draft.ownerQQ"
            class="field__input"
            type="text"
            inputmode="numeric"
            placeholder=" "
            maxlength="12"
            @input="store.touch('ownerQQ')"
          />
          <span class="field__label">主人 QQ 号</span>
        </label>
        <p v-if="store.isInvalid('ownerQQ')" class="field__support field__support--error">
          {{ store.fieldErrors.ownerQQ }}
        </p>
        <p v-else class="field__support">具有机器人管理权限的 QQ 号</p>
      </div>
    </div>
  </section>
</template>
