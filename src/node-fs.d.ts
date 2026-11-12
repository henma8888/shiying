declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
}
