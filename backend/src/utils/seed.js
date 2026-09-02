/*
  Runs both seed scripts in sequence via Node's child_process directly,
  instead of relying on shell operators like && or ; in package.json.
  Those differ between shells (bash vs Windows cmd.exe vs PowerShell) and
  are a common source of "works on my machine" failures — this avoids the
  problem entirely by never going through a shell separator.

  Usage: npm run seed
*/
import { fileURLToPath } from "url";
import path from "path";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runStep = (label, file) => {
  console.log(`\n--- ${label} ---`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.warn(`${label} exited with a non-zero status — continuing to the next step anyway.`);
  }
};

runStep("Seeding vendors", "seedVendors.js");
runStep("Seeding parts", "seedParts.js");
runStep("Backfilling part vendors", "seedPartVendors.js");