// The project has no @types/node; these are the only two Node functions a test reads a PNG with.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}
declare module "node:zlib" {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
