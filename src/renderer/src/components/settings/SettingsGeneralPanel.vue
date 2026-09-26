<script setup lang="ts">
// 通用面板：合并原「通用」与「日志」分区，直接绑定持久化仓库提交局部补丁。
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { LauncherSettings } from '@shared/domain/settings';
import { MofoxError } from '@shared/domain/error';
import { useSettingsStore } from '@/stores/settings';
import { mofoxApi } from '@/services/mofox-api';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const update = (patch: Partial<LauncherSettings>) => {
  settingsStore.update(patch);
};

// 数值设置在提交前限制到字段允许范围，避免无效配置写入。
const handleNumberInput = (key: keyof LauncherSettings, event: Event, min: number, max: number) => {
  const input = event.target as HTMLInputElement;
  let val = parseInt(input.value);
  if (isNaN(val)) return;
  if (val < min) val = min;
  if (val > max) val = max;
  update({ [key]: val });
};

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

// 默认安装目录通过通用对话框 IPC 选择；用户取消时不修改设置。错误就地展示在分区提示位。
const installDirBusy = ref(false);
const installDirError = ref<string | null>(null);

async function chooseInstallDir(): Promise<void> {
  if (installDirBusy.value) return;
  installDirBusy.value = true;
  try {
    const picked = await mofoxApi.pickDirectory({
      title: '选择默认安装目录',
      defaultPath: settings.value.defaultInstallDir || undefined,
    });
    if (picked) update({ defaultInstallDir: picked });
  } catch (error) {
    installDirError.value = describeError(error);
  } finally {
    installDirBusy.value = false;
  }
}

// 默认安装目录输入框在失焦或回车时提交；留空表示由安装向导临时选择。
function handleInstallDirInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  update({ defaultInstallDir: input.value.trim() });
}
</script>

<template>
  <div class="settings-group">
    <!-- 通用 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">tune</span>
        <div>
          <h2>通用</h2>
          <p>目录与运行行为</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">folder</span>
          <div class="settings-item__body">
            <span class="settings-item__label">默认安装目录</span>
            <div class="input-field input-field--path">
              <input
                type="text"
                class="input-field__native"
                :value="settings.defaultInstallDir"
                placeholder="留空使用系统默认位置"
                spellcheck="false"
                autocomplete="off"
                @change="handleInstallDirInput"
              />
            </div>
          </div>
          <button
            class="text-button state-layer"
            :disabled="installDirBusy"
            @click="chooseInstallDir"
          >
            浏览
          </button>
        </div>

        <!-- 目录选择失败提示 -->
        <div v-if="installDirError" class="settings-note settings-note--error">
          <span class="msr settings-note__icon">error</span>
          <span>{{ installDirError }}</span>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">call_to_action</span>
          <div class="settings-item__body">
            <span class="settings-item__label">关闭时最小化到托盘</span>
            <span class="settings-item__desc">
              关闭窗口后保留在系统托盘运行，可从托盘菜单显示主页面或退出；关闭后直接退出启动器
            </span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="settings.closeToTray"
            :class="{ 'md-switch--checked': settings.closeToTray }"
            @click="update({ closeToTray: !settings.closeToTray })"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">notifications</span>
          <div class="settings-item__body">
            <span class="settings-item__label">后台任务通知</span>
            <span class="settings-item__desc">
              启动器不在前台（失焦、最小化或托盘）时，任务完成将弹出系统通知
            </span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="settings.trayNotifications"
            :class="{ 'md-switch--checked': settings.trayNotifications }"
            @click="update({ trayNotifications: !settings.trayNotifications })"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">system_update_alt</span>
          <div class="settings-item__body">
            <span class="settings-item__label">自动检查更新</span>
            <span class="settings-item__desc">
              启动时检查新版本，发现更新后弹出提示；更新始终需要手动前往「关于」页面下载
            </span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="settings.autoCheckUpdates"
            :class="{ 'md-switch--checked': settings.autoCheckUpdates }"
            @click="update({ autoCheckUpdates: !settings.autoCheckUpdates })"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>

        <div v-if="false" class="settings-item">
          <span class="msr settings-item__icon">speed</span>
          <div class="settings-item__body">
            <span class="settings-item__label">硬件加速</span>
            <span class="settings-item__desc">更改后需重启启动器生效</span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="settings.hardwareAcceleration"
            :class="{ 'md-switch--checked': settings.hardwareAcceleration }"
            @click="update({ hardwareAcceleration: !settings.hardwareAcceleration })"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 日志 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">article</span>
        <div>
          <h2>日志</h2>
          <p>归档与存储限制</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">hard_drive</span>
          <div class="settings-item__body">
            <span class="settings-item__label">单文件上限</span>
          </div>
          <div class="input-field">
            <input
              type="number"
              class="input-field__native"
              :value="settings.maxLogFileSizeMb"
              @change="(e) => handleNumberInput('maxLogFileSizeMb', e, 1, 512)"
            />
            <span class="input-field__suffix">MB</span>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">history</span>
          <div class="settings-item__body">
            <span class="settings-item__label">归档保留天数</span>
          </div>
          <div class="input-field">
            <input
              type="number"
              class="input-field__native"
              :value="settings.maxLogArchiveDays"
              @change="(e) => handleNumberInput('maxLogArchiveDays', e, 1, 90)"
            />
            <span class="input-field__suffix">天</span>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">folder_zip</span>
          <div class="settings-item__body">
            <span class="settings-item__label">压缩归档日志</span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="settings.compressLogArchive"
            :class="{ 'md-switch--checked': settings.compressLogArchive }"
            @click="update({ compressLogArchive: !settings.compressLogArchive })"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped src="./settings-panel.css"></style>
