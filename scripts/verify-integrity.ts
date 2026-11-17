import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatIntegrityReport, verifyReleaseIntegrity } from "../src/security/integrity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = verifyReleaseIntegrity(root);
console.log(formatIntegrityReport(report));
if (!report.ok) process.exitCode = 1;
