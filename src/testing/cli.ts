import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSelfTests } from "./runner.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  const result = await runSelfTests(projectRoot);
  console.log(result.report);
  console.log("\n--- saída dos testes ---\n" + (result.output || "(sem saída)"));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`Autoteste não executado: ${(error as Error).message}`);
  process.exitCode = 1;
}
