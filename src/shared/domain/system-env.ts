/** 系统环境探测结果；带问号字段表示对应工具或平台特征未被检测到。 */
export interface SystemEnvInfo {
  arch: string;
  osType: string;
  osRelease: string;
  hostname: string;
  homedir: string;
  tmpdir: string;
  shell: string;
  distroFamily?: 'debian' | 'arch' | 'redhat' | 'suse';
  packageManager?: 'apt' | 'pacman' | 'dnf' | 'yum' | 'zypper';
  pythonVersion?: string;
  uvVersion?: string;
  gitVersion?: string;
}
