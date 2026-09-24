import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function labHasResult(lab) {
  return Boolean(String(lab.result || '').trim() || Object.values(lab.fields || {}).some(value => String(value || '').trim()));
}

export function patientChanges(before, after) {
  return Object.keys(after).filter(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

export function waitingPatients(db, now = Date.now()) {
  const visited = new Set((db.doctorVisits || []).map(visit => visit.surveyId));
  return (db.nurseSurveys || []).filter(survey => survey.needsDoctor && !survey.archivedAt && !visited.has(survey.id))
    .map(survey => ({ id: survey.id, patientName: [survey.patient?.lastName, survey.patient?.firstName, survey.patient?.middleName].filter(Boolean).join(' '),
      clinic: survey.patient?.clinic || survey.clinic || '', phone: survey.patient?.phone || '',
      waitingDays: Math.max(0, Math.floor((now - Date.parse(survey.createdAt)) / 86400000)),
      status: survey.outreach?.status || 'pending', updatedAt: survey.outreach?.updatedAt || '' }))
    .sort((a, b) => b.waitingDays - a.waitingDays);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export async function verifyBackupRestore(snapshot, { pool, directory, collections }) {
  const counts = {};
  for (const name of collections) {
    if (!Array.isArray(snapshot[name])) throw new Error(`В копии отсутствует коллекция ${name}`);
    const ids = snapshot[name].map(item => item.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(`Неверные идентификаторы: ${name}`);
    counts[name] = ids.length;
  }
  if (!snapshot.admins.some(admin => admin.role === 'owner' && admin.passwordHash)) throw new Error('В копии отсутствует доступ главного администратора');
  if (pool) {
    const client = await pool.connect();
    const schema = `restore_check_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".records (collection text, id text, data jsonb, PRIMARY KEY(collection, id))`);
      for (const name of collections) {
        await client.query(`INSERT INTO "${schema}".records SELECT $1, item->>'id', item FROM jsonb_array_elements($2::jsonb) item`, [name, JSON.stringify(snapshot[name])]);
        const restored = await client.query(`SELECT data FROM "${schema}".records WHERE collection=$1 ORDER BY id`, [name]);
        const sorted = [...snapshot[name]].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
        if (digest(restored.rows.map(row => row.data)) !== digest(sorted)) throw new Error(`Не совпали восстановленные данные: ${name}`);
      }
      await client.query(`CREATE TABLE "${schema}".settings (data jsonb)`);
      await client.query(`INSERT INTO "${schema}".settings VALUES ($1::jsonb)`, [JSON.stringify(snapshot.settings || {})]);
      const settings = await client.query(`SELECT data FROM "${schema}".settings`);
      if (digest(settings.rows[0].data) !== digest(snapshot.settings || {})) throw new Error('Не совпали восстановленные настройки');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  } else {
    const temporary = await mkdtemp(join(directory, 'restore-check-'));
    try {
      await writeFile(join(temporary, 'db.json'), JSON.stringify(snapshot), { mode: 0o600 });
      const restored = JSON.parse(await readFile(join(temporary, 'db.json'), 'utf8'));
      if (digest(restored) !== digest(snapshot)) throw new Error('Не совпали восстановленные данные');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return { verifiedAt: new Date().toISOString(), mode: pool ? 'postgres-isolated-schema' : 'isolated-file-database', counts };
}
