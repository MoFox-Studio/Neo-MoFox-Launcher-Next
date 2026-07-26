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
