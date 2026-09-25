/** 渲染端读取 Windows 平台版本所需的 UA-CH 最小形状;标准 DOM 类型尚未收录。 */
interface NavigatorUAData {
  getHighEntropyValue(hints: string[]): Promise<{ platformVersion?: string }>;
}

/** Electron 渲染进程的 UA 恒带 Electron/<version> 标记;浏览器 demo 模式没有。 */
const ELECTRON_UA_PATTERN = /Electron\//;

/**
 * Windows 11 22H2 的 UA-CH platformVersion 主版本号。
 * Windows 10 为 0~10,21H2 为 13;DWM 自 22H2 起才支持 backgroundMaterial,
 * 与主进程的判定口径保持一致。
 */
const WINDOWS_11_22H2_PLATFORM_VERSION = 14;

let detection: Promise<boolean> | null = null;

/**
 * 判定窗口背景是否由系统原生材质提供(Win11 22H2+ 的 Mica、macOS 的 vibrancy)。
 *
 * - 非 Electron 宿主(浏览器 demo)没有窗口材质,恒定返回 false。
 * - macOS 不受 UA-CH 影响,vibrancy 任意版本可用,直接返回 true。
 * - Windows 依据 UA-CH platformVersion 判定,21H2 与 Windows 10 返回 false,
 *   由渲染端的 CSS Mica 罩层接管背景。
 *
 * UA-CH 不可用或解析失败时一律按无原生材质处理:宁可多铺一层罩层,
 * 也不让 Windows 10 露出未经处理的透明窗口。结果只依赖宿主环境,
 * 进程生命周期内不会变化,因此仅计算一次。
 *
 * @returns 系统原生窗口材质是否可用。
 */
export function hasNativeBackdrop(): Promise<boolean> {
  detection ??= detectNativeBackdrop();
  return detection;
}

/** 平台探测的真实现;所有失败路径都收敛为 false,不会向调用方抛错。 */
async function detectNativeBackdrop(): Promise<boolean> {
  if (!ELECTRON_UA_PATTERN.test(navigator.userAgent)) return false;
  if (navigator.platform.includes('Mac')) return true;
  const userAgentData = (navigator as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData;
  if (!userAgentData) return false;
  try {
    const { platformVersion } = await userAgentData.getHighEntropyValue(['platformVersion']);
    const major = Number.parseInt(platformVersion?.split('.')[0] ?? '', 10);
    return Number.isFinite(major) && major >= WINDOWS_11_22H2_PLATFORM_VERSION;
  } catch {
    return false;
  }
}
