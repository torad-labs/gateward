import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tenetsDir } from "../paths";

/** Shells `python3 .tenets/engine/audit.py . [--json]`, passing its output
 * and exit code straight through. Calls `process.exit` itself: audit's job
 * is to proxy the vendored engine faithfully, including whatever exit code
 * it uses, not to force it into this CLI's 0/1/2 contract. */
export function runAudit(root: string, json: boolean): never {
  const auditPath = path.join(tenetsDir(root), "engine", "audit.py");
  if (!fs.existsSync(auditPath)) {
    const remedy = "re-run init";
    if (json) {
      console.log(JSON.stringify({ error: "audit.py not vendored in this project.", remedy }, null, 2));
    } else {
      console.error(`portable-hooks: audit.py not vendored in this project. remedy: ${remedy}`);
    }
    process.exit(1);
  }

  const args = [auditPath, "."];
  if (json) args.push("--json");
  const result = spawnSync("python3", args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`portable-hooks: failed to run python3: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
