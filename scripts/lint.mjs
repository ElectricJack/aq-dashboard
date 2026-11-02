// Dependency-free syntax lint for the Node build/release scripts.
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
for (const file of readdirSync("scripts").filter((name) => name.endsWith(".mjs")).sort()) {
  execFileSync(process.execPath, ["--check", `scripts/${file}`], { stdio: "inherit" });
}
console.log("Build and release script syntax lint passed");
