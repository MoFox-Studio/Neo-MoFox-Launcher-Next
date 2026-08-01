/**
 * 浏览器内 MofoxApi 模拟桥接，仅供显式演示构建使用。
 * 以可控延迟、事件和内存状态复现渲染进程依赖的主进程交互。
 */
import type { MofoxApi, MofoxEventMap, Unsubscribe } from '@shared/ipc';
import type { Instance, LauncherSettings } from '@shared/domain/instance';

type Listener<K extends keyof MofoxEventMap> = (payload: MofoxEventMap[K]) => void;

// 进程、安装与窗口状态均通过同一事件总线向渲染层推送。
const listeners = new Map<keyof MofoxEventMap, Set<Listener<never>>>();

function emit<K extends keyof MofoxEventMap>(event: K, payload: MofoxEventMap[K]): void {
  listeners.get(event)?.forEach((l) => (l as Listener<K>)(payload));
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 演示数据保持在内存中，API 对外返回副本以模拟 IPC 序列化边界。
const instances: Instance[] = [
  {
    id: 'ins-aurora',
    name: '墨狐 · 主号',
    version: '0.9.4',
    platformId: 'napcat',
    installPath: 'D:\\MoFox\\aurora',
    status: 'running',
    createdAt: Date.now() - 86_400_000 * 42,
    lastStartedAt: Date.now() - 3_600_000 * 5,
    autoStart: true,
  },
  {
    id: 'ins-dev',
    name: '开发测试机',
    version: '0.9.5-dev',
    platformId: 'snowluma',
    installPath: 'D:\\MoFox\\dev',
    status: 'stopped',
    createdAt: Date.now() - 86_400_000 * 9,
    autoStart: false,
  },
  {
    id: 'ins-guard',
    name: '群管理助手',
    version: '0.9.4',
    platformId: 'napcat',
    installPath: 'E:\\Bots\\guard',
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
  mirrorAutoSelect: true,
  closeToTray: true,
  hardwareAcceleration: true,
  maxLogFileSizeMb: 16,
  maxLogArchiveDays: 14,
  compressLogArchive: true,
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
    appendMockLog(id, source, `\x1b[36m[Launcher]\x1b[0m ${source === 'mofox' ? 'MoFox' : '平台'}进程已启动 (mock)\r\n`);
    logTimers.set(
      `${id}:${source}`,
      setInterval(() => {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const pool = MOCK_MESSAGES[source];
        const message = pool[Math.floor(Math.random() * pool.length)];
        appendMockLog(id, source, `\x1b[90m${time}\x1b[0m ${message}\r\n`);
      }, source === 'mofox' ? 1500 : 1000),
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
    for (const source of MOCK_SOURCES) appendMockLog(id, source, `\x1b[36m[Launcher]\x1b[0m 进程已停止 (mock)\r\n`);
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
      const steps = ['prepare', 'download', 'extract', 'dependencies', 'configure', 'finalize'] as const;
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
        version: request.version,
        platformId: request.platformId,
        installPath: request.targetDir,
        status: 'stopped',
        createdAt: Date.now(),
        autoStart: false,
      });
    })();
    return taskId;
  },
  async retryInstall() {},
  async cancelInstall() {},

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
  async listMirrors() {
    await delay(200);
    return [
      { id: 'gh-direct', type: 'github', name: 'GitHub 官方', baseUrl: 'https://github.com', latencyMs: 312 },
      { id: 'gh-ghproxy', type: 'github', name: 'ghproxy 镜像', baseUrl: 'https://ghproxy.net', latencyMs: 86 },
      { id: 'py-hust', type: 'python-ftp', name: '华中科技大学', baseUrl: 'https://mirrors.hust.edu.cn', latencyMs: 41 },
    ];
  },
  async selectBestMirror() {
    await delay(600);
    return {
      mirror: { id: 'py-hust', type: 'python-ftp', name: '华中科技大学', baseUrl: 'https://mirrors.hust.edu.cn', latencyMs: 41 },
      measuredAt: Date.now(),
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
