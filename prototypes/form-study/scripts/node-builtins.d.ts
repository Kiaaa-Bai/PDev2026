// The project has no @types/node; these are the only Node pieces make-test-city.ts uses.
// (The fs module also has a declaration in test/node-builtins.d.ts; the two merge.)
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function realpathSync(path: string): string;
  export function writeFileSync(path: string, data: string, options?: { flag?: string }): void;
}
declare module "node:os" {
  export function homedir(): string;
}
declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare const process: { argv: string[]; exit(code?: number): never };
