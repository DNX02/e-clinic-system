import pg from 'pg';
import fs from 'fs';

// Read env if not set
if (!process.env.DATABASE_URL && fs.existsSync('/etc/e-clinic.env')) {
  const envContent = fs.readFileSync('/etc/e-clinic.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2]?.replace(/^["']|["']$/g, '') || '';
    }
  }
}

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_REPORT_CHAT_ID;

if (!botToken || !chatId) {
  console.error('TELEGRAM_BOT_TOKEN or TELEGRAM_REPORT_CHAT_ID missing');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const today = new Date().toISOString().slice(0, 10);

  const surveysRes = await pool.query(
    "SELECT COUNT(*) FROM app_nurse_surveys WHERE updated_at::date = CURRENT_DATE"
  );
  const surveysCount = Number(surveysRes.rows[0].count);

  const totalSurveysRes = await pool.query("SELECT COUNT(*) FROM app_nurse_surveys");
  const totalSurveys = Number(totalSurveysRes.rows[0].count);

  const totalVisitsRes = await pool.query("SELECT COUNT(*) FROM app_doctor_visits");
  const totalVisits = Number(totalVisitsRes.rows[0].count);

  const text = [
    `📊 <b>E-Clinic — Ежедневный отчёт (${today})</b>`,
    ``,
    `👩‍⚕️ <b>Активность за сегодня:</b>`,
    `• Осмотрено пациентов медсёстрами: <b>${surveysCount}</b>`,
    ``,
    `📈 <b>Общие показатели платформы:</b>`,
    `• Всего анкет пациентов в базе: <b>${totalSurveys}</b>`,
    `• Всего врачебных осмотров: <b>${totalVisits}</b>`,
    ``,
    `🟢 <i>Автоматическая вечерняя сводка E-Clinic (ежедневно в 20:00).</i>`
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    })
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(result)}`);
  }
  console.log('Daily report successfully sent to Telegram!');
} finally {
  await pool.end();
}
