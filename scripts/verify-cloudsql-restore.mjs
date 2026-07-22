import pg from "pg";

const sourceDatabaseUrl = process.env.DATABASE_URL;
const restoredHost = process.env.RESTORED_DB_HOST;

if (!sourceDatabaseUrl || !restoredHost) {
  console.error("DATABASE_URL and RESTORED_DB_HOST are required");
  process.exit(2);
}

const restoredDatabaseUrl = new URL(sourceDatabaseUrl);
restoredDatabaseUrl.hostname = restoredHost;

const collectionNames = [
  "admins",
  "doctors",
  "nurseSurveys",
  "doctorVisits",
  "trainingParticipants",
  "trainingAttempts",
  "nurseTrainingParticipants",
  "nurseTrainingAttempts"
];

async function readSummary(databaseUrl) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });
  try {
    const result = await pool.query("select data from app_state where id = $1", ["main"]);
    if (result.rowCount !== 1) throw new Error("app_state/main is missing");
    const data = result.rows[0].data;
    return Object.fromEntries(collectionNames.map((name) => [name, Array.isArray(data[name]) ? data[name].length : null]));
  } finally {
    await pool.end();
  }
}

const [source, restored] = await Promise.all([
  readSummary(sourceDatabaseUrl),
  readSummary(restoredDatabaseUrl.toString())
]);

const invalidCollections = collectionNames.filter((name) => restored[name] === null);
const comparison = Object.fromEntries(collectionNames.map((name) => [name, {
  source: source[name],
  restored: restored[name],
  difference: source[name] - restored[name]
}]));

console.log(JSON.stringify({
  valid: invalidCollections.length === 0 && restored.admins >= 1,
  invalidCollections,
  comparison
}, null, 2));

if (invalidCollections.length || restored.admins < 1) process.exit(1);
