import fs from "node:fs";
import { runCommand } from "./exec.ts";
import { decideCommand, resolveInside } from "./kernel/policy.ts";
import type { Criterion } from "./store.ts";

const describe = (c: Criterion) =>
  c.type === "file_exists" ? `arquivo existe: ${c.path}` :
  c.type === "file_contains" ? `arquivo ${c.path} contém "${c.text}"` : `comando ok: ${c.command}`;

/** Verificação feita por código, nunca pelo modelo conferindo a si mesmo. */
export async function verifyCriteria(criteria: Criterion[], workspace: string): Promise<{ ok: boolean; report: string[] }> {
  if (!criteria.length) return { ok: false, report: ["sem critérios verificáveis"] };
  const report: string[] = [];
  let ok = true;
  for (const c of criteria) {
    let pass = false;
    let detail = "";
    try {
      if (c.type === "file_exists") {
        pass = fs.existsSync(resolveInside(workspace, c.path));
      } else if (c.type === "file_contains") {
        const p = resolveInside(workspace, c.path);
        pass = fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(c.text);
      } else {
        const d = decideCommand(c.command);
        if (d.action !== "allow") {
          detail = d.action === "deny"
            ? d.reason
            : "comando fora da allowlist; verificação automática não solicita nem presume aprovação";
        } else {
          const r = await runCommand(c.command, workspace);
          pass = r.code === 0;
          detail = `(exit ${r.code})${r.output ? ` ${r.output}` : ""}`;
        }
      }
    } catch (e) {
      detail = (e as Error).message;
    }
    if (!pass) ok = false;
    report.push(`${pass ? "✔" : "✘"} ${describe(c)} ${detail}`.trim());
  }
  return { ok, report };
}
