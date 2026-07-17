import * as path from "node:path";
import { tenetsDir } from "../paths";

interface AuditRun {
  status: number;
  /** For index.ts to print — the engine's own output streams straight
   * through via inherited stdio and never lands here. */
  message?: { text: string; stream: "stdout" | "stderr" };
}

/** Runs `bun .tenets/engine/audit.ts . [--json]` (via the running Bun
 * binary), passing its output and exit code straight through: audit's job is
 * to proxy the vendored engine faithfully, including whatever exit code it
 * uses, not to force it into this CLI's 0/1/2 contract. index.ts applies the
 * returned exit code — commands never terminate the process themselves
 * (architecture.test.ts). */
export async function runAudit(root: string, json: boolean): Promise<AuditRun> {
  const auditPath = path.join(tenetsDir(root), "engine", "audit.ts");
  if (!(await Bun.file(auditPath).exists())) {
    const remedy = "re-run init";
    return {
      status: 1,
      message: json
        ? {
            text: JSON.stringify({ error: "audit.ts not vendored in this project.", remedy }, null, 2),
            stream: "stdout",
          }
        : { text: `gateward: audit.ts not vendored in this project. remedy: ${remedy}`, stream: "stderr" },
    };
  }

  const args = [auditPath, "."];
  if (json) args.push("--json");
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({
      cmd: [process.execPath, ...args],
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (err) {
    return {
      status: 1,
      message: {
        text: `gateward: failed to run the vendored audit: ${(err as Error).message}`,
        stream: "stderr",
      },
    };
  }
  return { status: result.exitCode ?? 1 };
}
