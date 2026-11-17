import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQualityGate } from "./quality.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  const result = await runQualityGate(root);
  console.log(result.report);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`Portão de qualidade não executado: ${(error as Error).message}`);
  process.exitCode = 1;
}
