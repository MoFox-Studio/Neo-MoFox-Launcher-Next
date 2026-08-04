/** 系统环境探测结果；带问号字段表示对应工具或平台特征未被检测到。 */
export interface SystemEnvInfo {
  arch: string;
  osType: string;
  osRelease: string;
  hostname: string;
  homedir: string;
  tmpdir: string;
  shell: string;
  distroFamily?: DistroFamily;
  packageManager?: PackageManager;
  pythonVersion?: string;
  uvVersion?: string;
  gitVersion?: string;
}

/** Linux 发行版谱系，由 `/etc/os-release` 的 ID/ID_LIKE 字段推断。 */
export type DistroFamily = 'debian' | 'arch' | 'redhat' | 'suse';

/** 已支持的 Linux 包管理器；OOBE 依赖安装器据此选择安装命令。 */
export type PackageManager = 'apt' | 'pacman' | 'dnf' | 'yum' | 'zypper';
