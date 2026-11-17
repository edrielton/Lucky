import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/** Dados do Lucky ficam FORA do workspace, para as ferramentas do agente não alcançarem. */
export function openDb(home: string): DatabaseSync {
  fs.mkdirSync(home, { recursive: true });
  return new DatabaseSync(path.join(home, "lucky.db"));
}
