import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const port = 3847;
const dataDir = await mkdtemp(join(tmpdir(), 'eclinic-surveys-test-'));
const adminPassword = 'TestAdmin1234';
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, INITIAL_ADMIN_PASSWORD: adminPassword, DATABASE_URL: '' };
const proc = spawn('node', ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
proc.stdout.on('data', d => output += d);
proc.stderr.on('data', d => output += d);

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) { ready = true; break; }
    } catch {}
    await setTimeout(100);
  }
  assert.ok(ready, 'Server did not start: ' + output);

  // Login as admin
  const loginRes = await fetch(`http://127.0.0.1:${port}/api/login/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword })
  });
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie, 'Admin login failed');

  // Submit 5 test nurse surveys
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/api/nurse-surveys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nurseName: 'Тестовая Медсестра',
        lastName: `Тестов${i}`,
        firstName: `Иван${i}`,
        middleName: `Иванович`,
        clinic: i % 2 === 0 ? 'Поликлиника №1' : 'Поликлиника №2',
        birthDate: '1980-01-01',
        phone: `+99290000000${i}`,
        address: 'г. Душанбе',
        sex: 'female',
        age: 45,
        smoker: 'no',
        systolic: 120,
        diastolic: 80,
        weight: 70,
        height: 165,
        waist: 80,
        activity: 'yes',
        vegetables: 'yes',
        bpMeds: 'no',
        highGlucose: 'no',
        familyDiabetes: 'none'
      })
    });
    assert.equal(res.status, 201, 'Survey submit failed');
  }

  // Test dashboard with tab=surveys
  const surveysRes = await fetch(`http://127.0.0.1:${port}/api/admin/dashboard?tab=surveys&page=1&clinic=all`, {
    headers: { Cookie: cookie.split(';')[0] }
  });
  assert.equal(surveysRes.status, 200);
  const data = await surveysRes.json();
  assert.ok(Array.isArray(data.surveys), 'data.surveys must be an array');
  assert.equal(data.surveys.length, 5);
  assert.equal(data.surveysTotal, 5);
  assert.equal(data.surveysPage, 1);
  assert.equal(data.surveysPageCount, 1);
  assert.equal(data.surveysPageSize, 50);
  assert.ok(Array.isArray(data.surveyClinics), 'surveyClinics must be an array');
  assert.ok(data.surveyClinics.includes('Поликлиника №1'));
  assert.ok(data.surveyClinics.includes('Поликлиника №2'));

  // Ensure lightweight: no bulky answers or changeHistory
  assert.equal(data.surveys[0].answers, undefined, 'surveys must not include answers in dashboard');

  // Test clinic filter
  const c1Res = await fetch(`http://127.0.0.1:${port}/api/admin/dashboard?tab=surveys&page=1&clinic=${encodeURIComponent('Поликлиника №1')}`, {
    headers: { Cookie: cookie.split(';')[0] }
  });
  const c1Data = await c1Res.json();
  assert.equal(c1Data.surveysTotal, 2);
  assert.ok(c1Data.surveys.every(s => s.patient.clinic === 'Поликлиника №1'));

  // Test search query
  const searchRes = await fetch(`http://127.0.0.1:${port}/api/admin/dashboard?tab=surveys&page=1&clinic=all&search=${encodeURIComponent('Тестов3')}`, {
    headers: { Cookie: cookie.split(';')[0] }
  });
  const searchData = await searchRes.json();
  assert.equal(searchData.surveysTotal, 1);
  assert.equal(searchData.surveys[0].patient.lastName, 'Тестов3');

  console.log('ALL ADMIN SURVEYS PAGINATION & FILTER TESTS PASSED SUCCESSFULLY!');
} finally {
  proc.kill();
  await rm(dataDir, { recursive: true, force: true });
}
