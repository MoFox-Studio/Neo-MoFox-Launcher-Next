import type { MirrorSource } from '../../shared/domain/mirror';

/** 镜像源存储：维护内置镜像列表并向安装器提供轮询所需的全部地址。 */
const MIRRORS: readonly MirrorSource[] = [
  { id: 'gh-direct', type: 'github', name: 'GitHub', baseUrl: 'https://github.com' },
  { id: 'gh-proxy', type: 'github', name: 'GitHub Proxy', baseUrl: 'https://ghproxy.net' },
  {
    id: 'py-tuna',
    type: 'python-ftp',
    name: 'TUNA Python',
    baseUrl: 'https://pypi.tuna.tsinghua.edu.cn',
  },
  {
    id: 'py-huawei',
    type: 'python-ftp',
    name: 'Huawei Python',
    baseUrl: 'https://repo.huaweicloud.com',
  },
];

export class MirrorService {
  list(): MirrorSource[] {
    return MIRRORS.map((mirror) => ({ ...mirror }));
  }
}
