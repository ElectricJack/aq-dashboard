// pnpm forwards the optional npm-style separator; Vitest treats it as the
// end of options. Normalize it so `pnpm test -- -t name` selects that test.
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...args], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
