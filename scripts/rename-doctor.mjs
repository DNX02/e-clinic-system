import crypto from "node:crypto";
import pg from "pg";

const [oldSurname, newSurname, mode] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!oldSurname || !newSurname) throw new Error("Usage: node scripts/rename-doctor.mjs OLD_SURNAME NEW_SURNAME [--apply]");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 1
});
const client = await pool.connect();

try {
  const result = await client.query("select id, data from app_doctors order by id");
  const matches = result.rows.filter(({ data }) => String(data?.fullName || "").trim().split(/\s+/)[0] === oldSurname);
  if (matches.length !== 1) throw new Error(`Expected exactly one doctor with surname ${oldSurname}, found ${matches.length}`);
  const match = matches[0];
  const oldFullName = String(match.data.fullName).trim();
  const newFullName = oldFullName.replace(new RegExp(`^${oldSurname}(?=\\s|$)`), newSurname);
  console.log(`${mode === "--apply" ? "RENAME" : "DRY RUN"}: ${oldFullName} -> ${newFullName}`);
  if (mode !== "--apply") process.exitCode = 2;
  else {
    await client.query("begin");
    const doctor = { ...match.data, fullName: newFullName, updatedAt: new Date().toISOString() };
    await client.query("update app_doctors set data = $2::jsonb, updated_at = now() where id = $1", [match.id, JSON.stringify(doctor)]);

    const stateResult = await client.query("select data from app_state where id = 'main' for update");
    if (stateResult.rowCount) {
      const state = stateResult.rows[0].data;
      const legacyDoctor = (state.doctors || []).find((item) => item.id === match.id);
      if (legacyDoctor) Object.assign(legacyDoctor, { fullName: newFullName, updatedAt: doctor.updatedAt });
      state.activityEvents ||= [];
      const event = {
        id: crypto.randomUUID(),
        type: "doctor_name_corrected",
        actorRole: "system",
        actorName: "Техническое исправление",
        clinic: doctor.clinic || "",
        details: `Исправлена опечатка в фамилии врача: ${oldSurname} -> ${newSurname}`,
        createdAt: new Date().toISOString()
      };
      state.activityEvents.push(event);
      await client.query("update app_state set data = $2::jsonb, updated_at = now() where id = $1", ["main", JSON.stringify(state)]);
      await client.query("insert into app_activity_events (id, data, updated_at) values ($1, $2::jsonb, now())", [event.id, JSON.stringify(event)]);
    }
    await client.query("commit");
    console.log(`Updated doctor id ${match.id}`);
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
