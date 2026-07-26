/// <reference types="vite/client" />
import type { MofoxApi } from '../shared/ipc';

declare global {
  interface Window {
    mofoxAPI?: MofoxApi;
  }
}

export {};
