// One-off backup of the `discord` schema on the shared hosted Supabase project
// (gpfuhxmtidkynxhmfphg) before it's dropped from that project. The app itself
// moved to self-contained Supabase Lite (PGlite) on 2026-07-21 — this just
// captures whatever was still sitting in the old hosted tables.
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
}

const TABLES = ["issues", "replies", "duplicate_clusters", "theme_clusters"];
const PAGE_SIZE = 1000;
const outDir = path.join(process.cwd(), "supabase", "backups", "hosted-discord-schema-2026-07-25");

async function backupTable(table) {
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${table}.ndjson`);
  const stream = createWriteStream(outPath, { flags: "w" });
  let offset = 0;
  let total = 0;

  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Accept-Profile": "discord",
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        Prefer: "count=none",
      },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`${table} fetch failed (${res.status}): ${await res.text()}`);
    }
    const rows = await res.json();
    if (rows.length === 0) break;
    for (const row of rows) stream.write(`${JSON.stringify(row)}\n`);
    total += rows.length;
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  await new Promise((resolve) => stream.end(resolve));
  return total;
}

const counts = {};
for (const table of TABLES) {
  counts[table] = await backupTable(table);
  console.log(`${table}: ${counts[table]} rows`);
}
await writeFile(
  path.join(outDir, "manifest.json"),
  JSON.stringify({ backedUpAt: "2026-07-25", project: "gpfuhxmtidkynxhmfphg", schema: "discord", counts }, null, 2),
);
console.log("done ->", outDir);
