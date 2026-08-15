/**
 * 浏览器内 MofoxApi 模拟桥接，仅供显式演示构建使用。
 * 以可控延迟、事件和内存状态复现渲染进程依赖的主进程交互。
 */
import type { MofoxApi, MofoxEventMap, Unsubscribe } from '@shared/ipc';
import type { Instance } from '@shared/domain/instance';
import {
  DEFAULT_WALLPAPER_BLUR,
  DEFAULT_WALLPAPER_OPACITY,
  type LauncherSettings,
} from '@shared/domain/settings';
import type {
  LegacyLauncherInfo,
  MigrationPreview,
  MigrationResult,
} from '@shared/domain/migration';
import type { OobeCompletionSummary, OobeDependencyStatus } from '@shared/domain/oobe';

type Listener<K extends keyof MofoxEventMap> = (payload: MofoxEventMap[K]) => void;

// 进程、安装与窗口状态均通过同一事件总线向渲染层推送。
const listeners = new Map<keyof MofoxEventMap, Set<Listener<never>>>();

function emit<K extends keyof MofoxEventMap>(event: K, payload: MofoxEventMap[K]): void {
  listeners.get(event)?.forEach((l) => (l as Listener<K>)(payload));
}

/**
 * 等待指定时长以模拟 IPC 或后台任务延迟。
 *
 * @param ms - 等待的毫秒数。
 * @returns 延迟结束后兑现的 Promise。
 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 演示数据保持在内存中，API 对外返回副本以模拟 IPC 序列化边界。
const instances: Instance[] = [
  {
    id: 'ins-aurora',
    name: '墨狐 · 主号',
    mofoxInstallDir: 'D:\\MoFox\\aurora',
    platform: { id: 'napcat', installDir: 'D:\\MoFox\\aurora\\napcat', version: '4.2.19' },
    status: 'running',
    createdAt: Date.now() - 86_400_000 * 42,
    lastStartedAt: Date.now() - 3_600_000 * 5,
    autoStart: true,
  },
  {
    id: 'ins-dev',
    name: '开发测试机',
    mofoxInstallDir: 'D:\\MoFox\\dev',
    platform: { id: 'snowluma', installDir: 'D:\\MoFox\\dev\\snowluma', version: '1.3.0' },
    status: 'stopped',
    createdAt: Date.now() - 86_400_000 * 9,
    lastStartedAt: null,
    autoStart: false,
  },
  {
    id: 'ins-guard',
    name: '群管理助手',
    mofoxInstallDir: 'E:\\Bots\\guard',
    platform: { id: 'napcat', installDir: 'E:\\Bots\\guard\\napcat', version: '4.2.0' },
    status: 'error',
    createdAt: Date.now() - 86_400_000 * 120,
    lastStartedAt: Date.now() - 86_400_000 * 2,
    autoStart: false,
  },
];

let settings: LauncherSettings = {
  themeMode: 'system',
  seedColor: '#7C5CDB',
  language: 'zh-CN',
  defaultInstallDir: 'D:\\MoFox',
  closeToTray: true,
  hardwareAcceleration: true,
  maxLogFileSizeMb: 16,
  maxLogArchiveDays: 14,
  compressLogArchive: true,
  wallpaperType: 'none',
  wallpaperFileName: '',
  wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
  wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
  oobeCompleted: false,
};

let maximized = false;

type MockSource = 'mofox' | 'platform';
const MOCK_SOURCES: MockSource[] = ['mofox', 'platform'];

// 实时日志缓存、定时器及启动时间共同支撑日志与进程统计演示。
const logBuffers = new Map<string, string>();
const logTimers = new Map<string, ReturnType<typeof setInterval>>();
const startTimes = new Map<string, number>();

function appendMockLog(id: string, source: MockSource, data: string): void {
  const key = `${id}:${source}`;
  const output = `${logBuffers.get(key) ?? ''}${data}`;
  logBuffers.set(key, output.length > 200_000 ? output.slice(-200_000) : output);
  emit('instance-pty-data', { instanceId: id, source, data });
}

const MOCK_MESSAGES: Record<MockSource, string[]> = {
  mofox: [
    '\x1b[32m[INFO]\x1b[0m 心跳正常，模型连接稳定',
    '\x1b[32m[INFO]\x1b[0m 收到消息事件 group_message',
    '\x1b[33m[WARN]\x1b[0m LLM 响应耗时 812ms，超过阈值',
    '\x1b[32m[INFO]\x1b[0m 插件 auto-reply 触发',
    '\x1b[90m[DEBUG]\x1b[0m memory store flushed',
  ],
  platform: [
    '\x1b[32m[INFO]\x1b[0m OneBot 11 连接正常',
    '\x1b[90m[DEBUG]\x1b[0m ws frame received: 128 bytes',
    '\x1b[32m[INFO]\x1b[0m 消息上报 group 114514',
    '\x1b[33m[WARN]\x1b[0m 心跳延迟 233ms',
  ],
};

function startMockLogStream(id: string): void {
  // 每个来源独立追加历史日志并按固定节奏推送终端输出。
  stopMockLogStream(id);
  startTimes.set(id, Date.now());
  for (const source of MOCK_SOURCES) {
    appendMockLog(
      id,
      source,
      `\x1b[36m[Launcher]\x1b[0m ${source === 'mofox' ? 'MoFox' : '平台'}进程已启动 (mock)\r\n`,
    );
    logTimers.set(
      `${id}:${source}`,
      setInterval(
        () => {
          const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          const pool = MOCK_MESSAGES[source];
          const message = pool[Math.floor(Math.random() * pool.length)];
          appendMockLog(id, source, `\x1b[90m${time}\x1b[0m ${message}\r\n`);
        },
        source === 'mofox' ? 1500 : 1000,
      ),
    );
  }
}

function stopMockLogStream(id: string): void {
  for (const source of MOCK_SOURCES) {
    const timer = logTimers.get(`${id}:${source}`);
    if (timer) clearInterval(timer);
    logTimers.delete(`${id}:${source}`);
  }
  startTimes.delete(id);
}

export const mockApi: MofoxApi = {
  async windowMinimize() {},
  async windowToggleMaximize() {
    maximized = !maximized;
    emit('window-maximize-changed', maximized);
  },
  async windowClose() {},
  async windowIsMaximized() {
    return maximized;
  },

  async listInstances() {
    await delay(120);
    return instances.map((i) => ({ ...i }));
  },
  async startInstance(id) {
    // 模拟启动态到运行态的异步事件序列，并在完成后开始日志流。
    const ins = instances.find((i) => i.id === id);
    if (!ins) throw new Error(`unknown instance ${id}`);
    ins.status = 'starting';
    emit('instance-status-changed', { instanceId: id, status: 'starting' });
    await delay(900);
    ins.status = 'running';
    ins.lastStartedAt = Date.now();
    emit('instance-status-changed', { instanceId: id, status: 'running' });
    startMockLogStream(id);
  },
  async stopInstance(id) {
    // 先广播停止中，再终止日志流并提交最终停止状态。
    const ins = instances.find((i) => i.id === id);
    if (!ins) throw new Error(`unknown instance ${id}`);
    ins.status = 'stopping';
    emit('instance-status-changed', { instanceId: id, status: 'stopping' });
    await delay(700);
    stopMockLogStream(id);
    for (const source of MOCK_SOURCES)
      appendMockLog(id, source, `\x1b[36m[Launcher]\x1b[0m 进程已停止 (mock)\r\n`);
    ins.status = 'stopped';
    emit('instance-status-changed', { instanceId: id, status: 'stopped' });
  },
  async restartInstance(id) {
    await mockApi.stopInstance(id);
    await mockApi.startInstance(id);
  },
  async removeInstance(id) {
    stopMockLogStream(id);
    for (const source of MOCK_SOURCES) logBuffers.delete(`${id}:${source}`);
    const idx = instances.findIndex((i) => i.id === id);
    if (idx >= 0) instances.splice(idx, 1);
  },
  async openInstanceFolder() {},
  async getInstanceLogBuffer(id, source) {
    return logBuffers.get(`${id}:${source}`) ?? '';
  },
  async clearInstanceLogBuffer(id, source) {
    logBuffers.delete(`${id}:${source}`);
  },
  async writeInstancePty(id, source, data) {
    // 按终端回显规则写回输入内容。
    appendMockLog(id, source, data.replace(/\r/g, '\r\n'));
  },
  async resizeInstancePty() {},
  async getInstanceStats(id) {
    const startedAt = startTimes.get(id);
    /**
     * 根据实例启动时间生成指定进程的模拟运行统计。
     *
     * @param pidBase - 该进程的固定模拟 PID。
     * @returns 进程运行状态、运行时长和 PID。
     */
    const stats = (pidBase: number) =>
      startedAt === undefined
        ? { running: false, uptimeMs: null, pid: null }
        : { running: true, uptimeMs: Date.now() - startedAt, pid: pidBase };
    return { mofox: stats(41000), platform: stats(42000) };
  },
  async exportInstanceLogs(id, source) {
    if (!logBuffers.get(`${id}:${source}`)?.trim()) throw new Error('当前没有可导出的日志');
    return `D:\\MoFox\\exports\\${id}_${source}_${Date.now()}.log`;
  },

  async startInstall(request) {
    // 后台异步逐步派发进度；调用方立即获得任务 ID 以保持非阻塞。
    const taskId = `task-${Date.now()}`;
    void (async () => {
      const steps = [
        'prepare',
        'download',
        'extract',
        'dependencies',
        'configure',
        'finalize',
      ] as const;
      for (let s = 0; s < steps.length; s += 1) {
        for (let p = 0; p <= 10; p += 1) {
          await delay(steps[s] === 'download' ? 260 : 90);
          emit('install-progress', {
            taskId,
            instanceName: request.instanceName,
            step: steps[s],
            stepIndex: s,
            stepCount: steps.length,
            status: 'running',
            progress: p / 10,
            message: `${steps[s]} ${p * 10}%`,
          });
        }
      }
      emit('install-progress', {
        taskId,
        instanceName: request.instanceName,
        step: 'finalize',
        stepIndex: steps.length - 1,
        stepCount: steps.length,
        status: 'done',
        progress: 1,
        message: '安装完成',
      });
      instances.push({
        id: `ins-${Date.now()}`,
        name: request.instanceName,
        mofoxInstallDir: '',
        platform: { id: request.platformId, installDir: request.targetDir, version: request.version },
        status: 'stopped',
        createdAt: Date.now(),
        lastStartedAt: null,
        autoStart: false,
      });
    })();
    return taskId;
  },
  async retryInstall() {},
  async cancelInstall() {},
  async manualImportInstance(request) {
    await delay(160);
    const instanceId = `ins-${Date.now()}`;
    instances.push({
      id: instanceId,
      name: request.instanceName,
      mofoxInstallDir: request.mofoxInstallDir,
      platform:
        request.platformId && request.platformDir
          ? { id: request.platformId, installDir: request.platformDir, version: null }
          : { id: null, installDir: null, version: null },
      status: 'stopped',
      createdAt: Date.now(),
      lastStartedAt: null,
      autoStart: false,
    });
    return { instanceId };
  },

  async detectSystemEnv() {
    await delay(350);
    return {
      arch: 'x64',
      osType: 'Windows_NT',
      osRelease: '10.0.26100',
      hostname: 'DESKTOP-MOFOX',
      homedir: 'C:\\Users\\mofox',
      tmpdir: 'C:\\Users\\mofox\\AppData\\Local\\Temp',
      shell: 'powershell.exe',
      pythonVersion: '3.12.7',
      uvVersion: '0.5.11',
      gitVersion: '2.47.1',
    };
  },
  async listBotPlatforms() {
    await delay(150);
    return [
      {
        id: 'napcat',
        name: 'NapCat',
        description: '基于 NapCatQQ 的 OneBot 11 接入，稳定成熟。',
        supportedPlatforms: ['win32'],
        supportedArch: ['x64'],
        latestVersion: '4.2.19',
      },
      {
        id: 'snowluma',
        name: 'SnowLuma',
        description: '跨平台轻量适配器，支持 Windows / Linux / macOS。',
        supportedPlatforms: ['win32', 'linux', 'darwin'],
        supportedArch: ['x64', 'arm64'],
        latestVersion: '1.3.0',
      },
    ];
  },

  async getSettings() {
    await delay(60);
    return { ...settings };
  },
  async updateSettings(patch) {
    settings = { ...settings, ...patch };
    return { ...settings };
  },

  // 旧启动器迁移：演示构建中模拟一次成功的导入，便于在浏览器中预览界面。
  async detectLegacyLauncher(): Promise<LegacyLauncherInfo | null> {
    await delay(180);
    return {
      dataDirectory: 'C:\\Users\\mofox\\AppData\\Roaming\\Neo-MoFox-Launcher',
      instanceCount: instances.length,
      modifiedAt: Date.now() - 86_400_000,
    };
  },
  async previewLegacyMigration(): Promise<MigrationPreview> {
    await delay(260);
    return {
      legacy: {
        dataDirectory: 'C:\\Users\\mofox\\AppData\\Roaming\\Neo-MoFox-Launcher',
        instanceCount: instances.length,
        modifiedAt: Date.now() - 86_400_000,
      },
      previews: instances.map((instance) => ({
        instance: { ...instance },
        conflict: null,
        nameSource: 'name' as const,
      })),
    };
  },
  async importLegacyMigration(): Promise<MigrationResult> {
    await delay(420);
    return { imported: instances.length, skipped: 0, total: instances.length };
  },

  // OOBE 演示：模拟 sudo 验证、依赖安装与完成流程，便于在浏览器中预览界面。
  async oobeVerifySudo(password: string): Promise<boolean> {
    await delay(120);
    return password.length > 0;
  },
  async oobeInspectDependencies(): Promise<OobeDependencyStatus[]> {
    await delay(180);
    return [
      {
        id: 'git',
        displayName: 'Git',
        status: 'skipped',
        version: '2.47.1',
        message: '已安装 2.47.1',
      },
      { id: 'python', displayName: 'Python', status: 'pending', message: '未安装' },
      { id: 'uv', displayName: 'uv', status: 'pending', message: '未安装' },
    ];
  },
  async oobeInstallDependencies(): Promise<OobeDependencyStatus[]> {
    const statuses: OobeDependencyStatus[] = [
      { id: 'git', displayName: 'Git', status: 'pending' },
      { id: 'python', displayName: 'Python', status: 'pending' },
      { id: 'uv', displayName: 'uv', status: 'pending' },
    ];
    for (const status of statuses) {
      status.status = 'installing';
      emit('oobe-progress', {
        phase: 'installing',
        dependencyId: status.id,
        message: `正在安装 ${status.displayName}...`,
        progress: -1,
        dependencies: statuses.map((s) => ({ ...s })),
      });
      await delay(360);
      status.status = 'installed';
      status.version = '1.2.3';
      emit('oobe-progress', {
        phase: 'installing',
        dependencyId: status.id,
        message: `${status.displayName} 安装完成`,
        progress: 1,
        dependencies: statuses.map((s) => ({ ...s })),
      });
    }
    return statuses;
  },
  async oobeCancelInstall(): Promise<void> {},
  async oobeComplete(): Promise<OobeCompletionSummary> {
    await delay(180);
    settings = { ...settings, oobeCompleted: true };
    return {
      completed: true,
      dependencies: [
        { id: 'git', displayName: 'Git', status: 'installed', version: '2.47.1' },
        { id: 'python', displayName: 'Python', status: 'installed', version: '3.12.8' },
        { id: 'uv', displayName: 'uv', status: 'installed', version: '0.5.11' },
      ],
      legacy: null,
    };
  },

  // 通用对话框：演示构建中无法访问原生 dialog，统一返回 null 表示用户取消。
  async pickFile() {
    await delay(60);
    return null;
  },
  async pickDirectory() {
    await delay(60);
    return null;
  },
  async selectWallpaper() {
    await delay(60);
    return null;
  },
  async commitWallpaper() {
    return { ...settings };
  },
  async discardWallpaper() {},
  async removeWallpaper() {
    settings = {
      ...settings,
      wallpaperType: 'none',
      wallpaperFileName: '',
      wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
      wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    };
    return { ...settings };
  },

  on(event, listener) {
    // 返回取消函数，使仓库和组件可在作用域销毁时解除订阅。
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    const unsubscribe: Unsubscribe = () => {
      set?.delete(listener as Listener<never>);
    };
    return unsubscribe;
  },
};
