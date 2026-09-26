/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, console */
/**
 * electron-builder afterPack 钩子 —— 加固 portable（便携版）NSIS 脚本。
 *
 * 背景：electron-builder 的 portable.nsi 模板把应用自解包到固定目录
 * `%TEMP%\<UNPACK_DIR_NAME>`（26.x 未配置 unpackDirName 时为构建期生成的
 * 固定 KSUID），并在启动前与主程序退出后各执行一次 `RMDir /r $INSTDIR`。
 * ExecWait 只等待被直接启动的进程，而本应用常驻托盘、会派生 MoFox 子进程，
 * 因此两次清理都可能发生在“仍有进程依赖解包目录”时：运行中实例按需读取的
 * `app.asar.unpacked`（node-pty 的 conpty.node 等原生模块）、`icudtl.dat`、
 * `locales/*` 会被第一批删掉，导致
 * `Failed to load native module: conpty.node` / `Invalid file descriptor to
 * ICU data received` 等启动失败。
 *
 * 修复：把无条件删除改为“Rename 试探”——
 *   - 改名成功 ⇒ 目录内没有文件被任何进程锁定 ⇒ 删除是安全的；
 *   - 改名失败 ⇒ 有实例正在运行 ⇒ 复用现有解包（同一次构建的解包目录名固定、
 *     载荷一致），交给应用自身的单实例锁合并窗口。
 *
 * 挂载方式：electron-builder.yml 的 `afterPack`（官方生命周期钩子）。26.x 的
 * portable 目标不支持 nsis.script/include（模板无条件取自内置文件），但其
 * 编译前必经 NsisTarget#computeFinalScript，这里对该方法打补丁改写脚本。
 * 模板标记不匹配时（electron-builder 升级改版）打印警告并原样放行，
 * 不阻断构建。
 */
'use strict';

// —— 模板定位标记（与 app-builder-lib 26.x 的 portable.nsi 逐字对应，含缩进/制表符）——

/** 解包前的无条件清理（启动前那次 `RMDir /r`）。 */
const PRE_CLEAN_MARKER = '  RMDir /r $INSTDIR\n  SetOutPath $INSTDIR';

/** 启动前设置环境变量的第一行，复用路径的跳转标签插在它之前。 */
const LABEL_ANCHOR = `  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'`;

/** 主程序退出后的无条件清理（`ExecWait` 之后那次 `RMDir /r`，模板中为 TAB 缩进）。 */
const FINAL_CLEAN_MARKER = '  SetOutPath $EXEDIR\n\tRMDir /r $INSTDIR\nSectionEnd';

/** 跳转标签：复用路径从这里继续，跳过解包直达启动段。 */
const LAUNCH_LABEL = '  portable_launch:\n';

// —— 替换内容（NSIS 语法；使用 ${if}/${else}/${endIf}，模板已通过 common.nsh 引入 LogicLib）——

const PRE_CLEAN_REPLACEMENT = [
  '  ; === [portable-nsis-patch] 用 Rename 试探代替无条件的 RMDir /r ===',
  '  ; 先清掉上次退出时可能遗留的 .old 目录（能被改名的内容必然没有运行中的进程）',
  '  RMDir /r "$INSTDIR.old"',
  '  ; Rename 只有在目录内所有文件都未被任何进程锁定时才会成功',
  '  ClearErrors',
  '  Rename "$INSTDIR" "$INSTDIR.old"',
  '  ${if} ${Errors}',
  '    ; 改名失败：目录不存在（首次运行），或仍有实例正在运行',
  '    ClearErrors',
  '    ${if} ${FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"',
  '      ; 有实例在运行：复用现有解包（同一次构建的解包目录名固定，载荷一致），',
  '      ; 交给应用自身的单实例锁合并窗口。绝不能在运行中删除文件，否则',
  '      ; app.asar.unpacked（node-pty 原生模块）、icudtl.dat 等会被删成残缺目录，',
  '      ; 导致 conpty.node / ICU 数据加载失败（便携版启动失败的根因）。',
  '      SetOutPath $INSTDIR',
  '      ${StdUtils.GetAllParameters} $R0 0',
  '      Goto portable_launch',
  '    ${endIf}',
  '    ; 首次运行或残缺目录（主程序不存在）：继续走下面的全新解包',
  '  ${else}',
  '    ; 无人占用：刚改名的旧目录现在可以安全删除',
  '    RMDir /r "$INSTDIR.old"',
  '  ${endIf}',
  '  SetOutPath $INSTDIR',
].join('\n');

const FINAL_CLEAN_REPLACEMENT = [
  '  SetOutPath $EXEDIR',
  '  ; === [portable-nsis-patch] 退出后同样先试探再清理 ===',
  '  ; 仍有句柄占用（如子进程继承了工作目录）时保留目录，',
  '  ; 由下次启动的前置清理兜底，避免与残留进程竞态',
  '  ClearErrors',
  '  Rename "$INSTDIR" "$INSTDIR.old"',
  '  ${if} ${Errors}',
  '    ClearErrors',
  '  ${else}',
  '    RMDir /r "$INSTDIR.old"',
  '  ${endIf}',
  'SectionEnd',
].join('\n');

/**
 * 把 portable.nsi 模板中的两处无条件 `RMDir /r` 替换为占用试探式清理。
 * 模板与预期标记不符时打警告并原样返回（fail-open）。
 */
function transformPortableScript(script) {
  const missing = [PRE_CLEAN_MARKER, LABEL_ANCHOR, FINAL_CLEAN_MARKER].filter(
    (marker) => !script.includes(marker),
  );
  if (missing.length > 0) {
    console.warn(
      '[portable-nsis-patch] portable.nsi 与预期标记不符（electron-builder 可能已升级），跳过加固并使用原模板',
    );
    return script;
  }
  // 替换使用函数形式，避免 String.prototype.replace 对 `$` 序列的特殊解释
  return script
    .replace(PRE_CLEAN_MARKER, () => PRE_CLEAN_REPLACEMENT)
    .replace(LABEL_ANCHOR, () => LAUNCH_LABEL + LABEL_ANCHOR)
    .replace(FINAL_CLEAN_MARKER, () => FINAL_CLEAN_REPLACEMENT);
}

let patchInstalled = false;

/**
 * 给 NsisTarget#computeFinalScript 打补丁（幂等）。
 * 仅当目标为 portable 时改写脚本；安装版（nsis）分支原样透传。
 * 返回是否成功挂上补丁。
 */
function installPatch() {
  if (patchInstalled) return true;
  let NsisTarget;
  try {
    ({ NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget'));
  } catch (error) {
    console.warn('[portable-nsis-patch] 无法加载 app-builder-lib，跳过加固：', error);
    return false;
  }
  if (!NsisTarget || typeof NsisTarget.prototype.computeFinalScript !== 'function') {
    console.warn('[portable-nsis-patch] 未找到 NsisTarget#computeFinalScript，跳过加固');
    return false;
  }
  const originalComputeFinalScript = NsisTarget.prototype.computeFinalScript;
  NsisTarget.prototype.computeFinalScript = async function patchedComputeFinalScript(
    originalScript,
    isInstaller,
    archs,
  ) {
    const script = await originalComputeFinalScript.call(this, originalScript, isInstaller, archs);
    if (!this.isPortable) return script;
    return transformPortableScript(script);
  };
  patchInstalled = true;
  return true;
}

/**
 * electron-builder afterPack 钩子入口。
 * 在打包完成后、NSIS 目标编译（finishBuild）前执行，时机上必然先于 makensis。
 */
async function afterPack(context) {
  if (!context || context.electronPlatformName !== 'win32') return;
  if (installPatch()) {
    console.log(
      '[portable-nsis-patch] 已加固 portable NSIS 脚本：运行中实例的解包目录不再被 RMDir /r 拆毁',
    );
  }
}

module.exports = { afterPack, installPatch, transformPortableScript };
