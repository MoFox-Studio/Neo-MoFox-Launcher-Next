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
  {
    id: 'pip-tsinghua',
    type: 'pip',
    name: '清华 PyPI',
    baseUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  },
  {
    id: 'pip-aliyun',
    type: 'pip',
    name: '阿里云 PyPI',
    baseUrl: 'https://mirrors.aliyun.com/pypi/simple',
  },
  {
    id: 'pip-ustc',
    type: 'pip',
    name: '中科大 PyPI',
    baseUrl: 'https://pypi.mirrors.ustc.edu.cn/simple',
  },
  {
    id: 'pip-tencent',
    type: 'pip',
    name: '腾讯云 PyPI',
    baseUrl: 'https://mirrors.cloud.tencent.com/pypi/simple',
  },
  { id: 'pip-official', type: 'pip', name: '官方 PyPI', baseUrl: 'https://pypi.org/simple' },
];

export class MirrorService {
  /**
   * 返回内置镜像源的浅拷贝列表。
   *
   * @returns 镜像源对象数组；调用方可安全修改而不影响内置列表。
   */
  list(): MirrorSource[] {
    return MIRRORS.map((mirror) => ({ ...mirror }));
  }
}
