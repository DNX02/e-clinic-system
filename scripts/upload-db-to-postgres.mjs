import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const dbPath = process.argv[2] || "data/db.json";
const raw = await readFile(dbPath, "utf8");
const db = JSON.parse(raw);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

try {
  await pool.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(
    `insert into app_state (id, data, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    ["main", JSON.stringify(db)]
  );
  console.log(`Uploaded ${dbPath} to PostgreSQL app_state/main.`);
} finally {
  await pool.end();
}
