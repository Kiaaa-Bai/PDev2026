// Writes a generated test city: `cursor-YYYY-MM-DD.jsonl` day files, one per working day, ending yesterday.
// Point the app at the folder with TRACKPAD_DATA_DIR so it never touches the real data folder.
//
//   pnpm make-test-city <dir> <days> [seed]
//   (that is: node --experimental-strip-types scripts/make-test-city.ts <dir> <days> [seed])
//
// The generator lives in src/sims, whose imports have no file extensions, so Node cannot load it
// directly; Vite's module runner (already a dependency) loads it instead.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

type Generator = typeof import("../src/sims/testcity");

const [dirArg, daysArg, seedArg = "1"] = process.argv.slice(2);
const days = Number(daysArg);
const seed = Number(seedArg);
if (!dirArg || !Number.isInteger(days) || days < 1 || !Number.isInteger(seed)) {
  console.error("usage: make-test-city <dir> <days> [seed]   (days is a whole number, at least 1)");
  process.exit(1);
}

const { module } = await runnerImport<Generator>(fileURLToPath(new URL("../src/sims/testcity.ts", import.meta.url)));

// The last day is yesterday: today's file belongs to the capture source, which appends to it.
const today = new Date();
const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days).getTime();
const records = module.testCityRecords(seed, days, start);
const files = module.testCityDayFiles(records);

const dir = resolve(dirArg);
mkdirSync(dir, { recursive: true });
for (const f of files) writeFileSync(join(dir, f.name), f.text);
console.log(`${records.length} records in ${files.length} day files in ${dir}`);
for (const f of files) console.log(`  ${f.name}`);
