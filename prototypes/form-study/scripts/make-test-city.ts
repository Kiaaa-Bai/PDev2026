// Writes a generated test city: `cursor-YYYY-MM-DD.jsonl` day files, one per working day.
// Point the app at the folder with TRACKPAD_DATA_DIR so it never touches the real data folder.
//
//   pnpm make-test-city <dir> <days> [start-date] [seed]
//   (that is: node --experimental-strip-types scripts/make-test-city.ts <dir> <days> [start-date] [seed])
//
//   start-date  YYYY-MM-DD of the first day. Give it for a city that can be made again exactly, on any
//               later day (same file names, same timestamps). Default: `days` days before today, so the
//               last day is yesterday (today's file belongs to the capture source, which appends to it).
//   seed        default 1.
//
// It never overwrites: it refuses a folder that already holds day files or a city snapshot (a real
// folder always does, and a rerun would mix old days with new and leave a stale snapshot), and it
// refuses the app's real data folders outright. Use a new folder for each city.
//
// The generator lives in src/sims, whose imports have no file extensions, so Node cannot load it
// directly; Vite's module runner (already a dependency) loads it instead.
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

type Generator = typeof import("../src/sims/testcity");

function fail(message: string): never {
  console.error(`make-test-city: ${message}`);
  return process.exit(1);
}

/** The path with symlinks resolved, for a folder that may not exist yet (its nearest existing parent is resolved). */
function real(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}

const [dirArg, daysArg, startArg, seedArg = "1"] = process.argv.slice(2);
const days = Number(daysArg);
const seed = Number(seedArg);
if (!dirArg || !Number.isInteger(days) || days < 1 || !Number.isInteger(seed)) {
  fail("usage: make-test-city <dir> <days> [start-date YYYY-MM-DD] [seed]   (days is a whole number, at least 1)");
}

const { module } = await runnerImport<Generator>(fileURLToPath(new URL("../src/sims/testcity.ts", import.meta.url)));

const start = module.testCityStart(days, startArg, Date.now());
if (start === null) fail(`start date "${startArg}" is not a real date; write it as YYYY-MM-DD`);

const dir = real(dirArg);
const protectedDirs = [
  // the folder the app reads and writes on this Mac: the identifier in capture/src-tauri/tauri.conf.json
  real(join(homedir(), "Library", "Application Support", "edu.nyu.kiabai.trackpad")),
  // prototypes/data (prototypes/data/test-city is fine)
  real(fileURLToPath(new URL("../../data", import.meta.url))),
];
const problem = module.testCityTargetProblem(dir, protectedDirs, existsSync(dir) ? readdirSync(dir) : []);
if (problem) fail(problem);

const records = module.testCityRecords(seed, days, start);
const files = module.testCityDayFiles(records);

mkdirSync(dir, { recursive: true });
// flag "wx": fail rather than overwrite, whatever happened since the check above
for (const f of files) writeFileSync(join(dir, f.name), f.text, { flag: "wx" });
console.log(`${records.length} records in ${files.length} day files in ${dir}`);
for (const f of files) console.log(`  ${f.name}`);
