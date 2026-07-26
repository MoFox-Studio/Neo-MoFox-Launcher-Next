declare module 'tree-kill' {
  type Signal = string | number;
  type Callback = (error?: Error) => void;

  export default function kill(pid: number, signal?: Signal, callback?: Callback): void;
}