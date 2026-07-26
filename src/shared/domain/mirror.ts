export type MirrorType = 'github' | 'python-ftp';

export interface MirrorSource {
  id: string;
  type: MirrorType;
  name: string;
  baseUrl: string;
  latencyMs?: number;
}

export interface MirrorSelection {
  mirror: MirrorSource;
  measuredAt: number;
}
