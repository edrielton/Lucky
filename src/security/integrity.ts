import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { RELEASE_HASHES } from "./release-manifest.ts";

export interface IntegrityIssue {
  path: string;
  reason: "missing" | "not_regular_file" | "hash_mismatch" | "invalid_manifest";
}

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  issues: IntegrityIssue[];
}

/**
 * Compara os arquivos críticos com os hashes da distribuição. A lista esperada
 * pode ser injetada nos testes; a aplicação usa o manifesto do release.
 */
export function verifyReleaseIntegrity(
  root: string,
  expected: Readonly<Record<string, string>> = RELEASE_HASHES,
): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  let checked = 0;
  const absoluteRoot = path.resolve(root);

  for (const [relative, expectedHash] of Object.entries(expected)) {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      issues.push({ path: relative, reason: "invalid_manifest" });
      continue;
    }
    const target = path.resolve(absoluteRoot, relative);
    const rel = path.relative(absoluteRoot, target);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      issues.push({ path: relative, reason: "invalid_manifest" });
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(target);
    } catch {
      issues.push({ path: relative, reason: "missing" });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push({ path: relative, reason: "not_regular_file" });
      continue;
    }
    checked++;
    const actualHash = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    if (actualHash !== expectedHash) issues.push({ path: relative, reason: "hash_mismatch" });
  }
  return { ok: issues.length === 0 && checked === Object.keys(expected).length, checked, issues };
}

export function formatIntegrityReport(report: IntegrityReport): string {
  if (report.ok) return `Integridade do release: OK (${report.checked} arquivos críticos verificados).`;
  const lines = report.issues.map((issue) => `- ${issue.path}: ${issue.reason}`);
  return [
    `INTEGRIDADE REPROVADA: ${report.checked} arquivo(s) verificado(s); ${report.issues.length} problema(s).`,
    ...lines,
    "Inicialização bloqueada. Restaure uma distribuição oficial antes de continuar.",
  ].join("\n");
}
