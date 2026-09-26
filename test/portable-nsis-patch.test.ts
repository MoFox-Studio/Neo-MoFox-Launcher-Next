import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface PortableNsisPatchModule {
  afterPack: (context: { electronPlatformName: string }) => Promise<void>;
  installPatch: () => boolean;
  transformPortableScript: (script: string) => string;
}

const require_ = createRequire(import.meta.url);
const patch = require_('../scripts/portable-nsis-patch.cjs') as PortableNsisPatchModule;

// 直接以 node_modules 中真实的 portable.nsi 为夹具，标记漂移时本套测试会失败提醒
const templatePath = require_.resolve('app-builder-lib/templates/nsis/portable.nsi');
const rawTemplate = readFileSync(templatePath, 'utf8');

const PRE_CLEAN_MARKER = '  RMDir /r $INSTDIR\n  SetOutPath $INSTDIR';
const LABEL_ANCHOR = `  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'`;
const FINAL_CLEAN_MARKER = '  SetOutPath $EXEDIR\n\tRMDir /r $INSTDIR\nSectionEnd';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('portable-nsis-patch', () => {
  it('定位标记与 node_modules 中实际的 portable.nsi 保持同步', () => {
    expect(rawTemplate).toContain(PRE_CLEAN_MARKER);
    expect(rawTemplate).toContain(LABEL_ANCHOR);
    expect(rawTemplate).toContain(FINAL_CLEAN_MARKER);
    // 两处无条件 RMDir /r 正是待修复点，标记失效即说明上游模板变了
    expect(count(rawTemplate, 'RMDir /r $INSTDIR')).toBe(2);
  });

  it('对真实模板完成三处手术：跳转标签、守卫式清理、消除裸 RMDir /r', () => {
    const out = patch.transformPortableScript(rawTemplate);

    // 复用路径：标签只出现一次，且位于环境变量设置之前、Goto 可达
    expect(count(out, 'portable_launch:')).toBe(1);
    expect(count(out, 'Goto portable_launch')).toBe(1);
    expect(out.indexOf('portable_launch:')).toBeLessThan(out.indexOf('PORTABLE_EXECUTABLE_DIR'));

    // 两处无条件清理均已替换为 Rename 试探
    expect(out).not.toContain(PRE_CLEAN_MARKER);
    expect(out).not.toContain(FINAL_CLEAN_MARKER);
    expect(count(out, 'Rename "$INSTDIR" "$INSTDIR.old"')).toBe(2);
    expect(count(out, 'ClearErrors')).toBeGreaterThanOrEqual(4);
    expect(count(out, '${if} ${Errors}')).toBe(2);

    // 复用分支须在跳过解包前补齐启动参数与工作目录
    expect(out).toContain('SetOutPath $INSTDIR');
    expect(out).toContain('${StdUtils.GetAllParameters} $R0 0');

    // 新增的 LogicLib 块自身配平（上游模板存在一处 {endIf} 缺 $ 的死分支，故用增量断言）
    const ifDelta = count(out, '${if}') - count(rawTemplate, '${if}');
    const endIfDelta = count(out, '${endIf}') - count(rawTemplate, '${endIf}');
    expect(ifDelta).toBe(3);
    expect(endIfDelta).toBe(3);
  });

  it('transform 是幂等的（重复应用结果不变）', () => {
    const once = patch.transformPortableScript(rawTemplate);
    const twice = patch.transformPortableScript(once);
    expect(twice).toBe(once);
  });

  it('模板不匹配时 fail-open：原样返回不阻断构建', () => {
    const garbage = 'Section\n  Foo\nSectionEnd\n';
    expect(patch.transformPortableScript(garbage)).toBe(garbage);
  });
});
