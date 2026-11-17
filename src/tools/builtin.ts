import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../exec.ts";
import { resolveInside } from "../kernel/policy.ts";
import type { Tool } from "../types.ts";

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

export const builtinTools: Tool[] = [
  {
    name: "read_file",
    description: "Lê um arquivo de texto do workspace.",
    parameters: obj({ path: { type: "string" } }, ["path"]),
    risk: "read",
    permissions: ["fs.read:workspace"],
    async run(args, ctx) {
      const p = resolveInside(ctx.workspace, String(args.path));
      return { ok: true, output: fs.readFileSync(p, "utf8").slice(0, 20_000) };
    },
  },
  {
    name: "list_dir",
    description: "Lista arquivos e pastas de um diretório do workspace.",
    parameters: obj({ path: { type: "string" } }, []),
    risk: "read",
    permissions: ["fs.read:workspace"],
    async run(args, ctx) {
      const p = resolveInside(ctx.workspace, String(args.path ?? "."));
      const items = fs.readdirSync(p, { withFileTypes: true }).map((d) => d.name + (d.isDirectory() ? "/" : ""));
      return { ok: true, output: items.join("\n") || "(vazio)" };
    },
  },
  {
    name: "write_file",
    description: "Cria ou sobrescreve um arquivo no workspace. Faz backup do arquivo anterior.",
    parameters: obj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
    risk: "write_reversible",
    permissions: ["fs.write:workspace"],
    async run(args, ctx) {
      const p = resolveInside(ctx.workspace, String(args.path));
      let backup = "sem arquivo anterior";
      if (fs.existsSync(p)) {
        const dir = path.join(ctx.home, "backups");
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `${Date.now()}-${path.basename(p)}`);
        fs.copyFileSync(p, dest);
        backup = `backup em ${dest}`;
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const content = String(args.content);
      fs.writeFileSync(p, content);
      return { ok: true, output: `escrito ${Buffer.byteLength(content)} bytes em ${args.path} (${backup})` };
    },
  },
  {
    name: "run_command",
    description: "Executa um comando (sem shell, sem pipes). Comandos fora da lista segura pedem aprovação.",
    parameters: obj({ command: { type: "string" } }, ["command"]),
    risk: "irreversible",
    permissions: ["process.exec:workspace"],
    async run(args, ctx) {
      const r = await runCommand(String(args.command), ctx.workspace, 60_000, ctx.approved === true);
      return { ok: r.code === 0, output: `exit ${r.code}\n${r.output}` };
    },
  },
];
