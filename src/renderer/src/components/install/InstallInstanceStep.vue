<script setup lang="ts">
import { useInstallDraftStore } from '@/stores/install-draft';

// 实例信息步骤：实例名称、Bot QQ 号与主人 QQ 号；错误以浮动标签字段下的说明文字提示。
const store = useInstallDraftStore();
const draft = store.draft;
</script>

<template>
  <section class="step">
    <div class="step-header">
      <h1>实例信息</h1>
      <p>为你的 Bot 实例设置名称，并填写机器人与主人的 QQ 账号。</p>
    </div>

    <form class="config-form" @submit.prevent>
      <div class="form-group">
        <label class="field" :class="{ 'field--error': store.isInvalid('instanceName') }">
          <input
            id="input-instance-name"
            v-model="draft.instanceName"
            class="field__input"
            type="text"
            placeholder=" "
            maxlength="32"
            @input="store.touch('instanceName')"
          />
          <span class="field__label">实例名称 *</span>
        </label>
        <p v-if="store.isInvalid('instanceName')" class="field__support field__support--error">
          {{ store.fieldErrors.instanceName }}
        </p>
        <p v-else class="field__support">1-32 字符，用于在启动器中标识此实例</p>
      </div>

      <div class="form-row two-cols">
        <div class="form-group">
          <label class="field" :class="{ 'field--error': store.isInvalid('botQQ') }">
            <input
              id="input-bot-qq"
              v-model="draft.botQQ"
              class="field__input"
              type="text"
              inputmode="numeric"
              placeholder=" "
              maxlength="12"
              @input="store.touch('botQQ')"
            />
            <span class="field__label">Bot QQ 号 *</span>
          </label>
          <p v-if="store.isInvalid('botQQ')" class="field__support field__support--error">
            {{ store.fieldErrors.botQQ }}
          </p>
          <p v-else class="field__support">5-12 位纯数字，建议使用小号避免封号风险</p>
        </div>

        <div class="form-group">
          <label class="field" :class="{ 'field--error': store.isInvalid('ownerQQ') }">
            <input
              id="input-owner-qq"
              v-model="draft.ownerQQ"
              class="field__input"
              type="text"
              inputmode="numeric"
              placeholder=" "
              maxlength="12"
              @input="store.touch('ownerQQ')"
            />
            <span class="field__label">主人 QQ 号 *</span>
          </label>
          <p v-if="store.isInvalid('ownerQQ')" class="field__support field__support--error">
            {{ store.fieldErrors.ownerQQ }}
          </p>
          <p v-else class="field__support">5-12 位纯数字，具有机器人管理权限</p>
        </div>
      </div>
    </form>
  </section>
</template>
