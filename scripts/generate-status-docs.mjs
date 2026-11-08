import fs from 'node:fs';
import path from 'node:path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType
} from 'docx';

const sourceMdPath = path.resolve('docs/PROJECT_STATUS.md');
const mdContent = fs.readFileSync(sourceMdPath, 'utf8');

// 1. Copy MD to public and G:\clinic
const publicDir = path.resolve('public');
const clinicDir = 'G:\\clinic';

fs.writeFileSync(path.join(publicDir, 'PROJECT_STATUS.md'), mdContent, 'utf8');
if (fs.existsSync(clinicDir)) {
  fs.writeFileSync(path.join(clinicDir, 'PROJECT_STATUS.md'), mdContent, 'utf8');
}

// 2. Generate clean, styled HTML
const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Отчёт о текущем состоянии проекта E-Clinic (Ноябрь 2026)</title>
  <style>
    :root {
      --primary: #0f4c45;
      --primary-light: #e8f5f3;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
      --bg: #f9fafb;
      --card-bg: #ffffff;
      --accent: #2563eb;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--text);
      background-color: var(--bg);
      line-height: 1.6;
      padding: 24px;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      background: var(--card-bg);
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
    }
    .header-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease-in-out;
    }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: #0c3c37; }
    .btn-secondary { background: white; color: var(--text); border-color: var(--border); }
    .btn-secondary:hover { background: #f3f4f6; }
    h1 { color: var(--primary); font-size: 26px; margin-bottom: 8px; }
    .meta-bar {
      background: var(--primary-light);
      border-left: 4px solid var(--primary);
      padding: 12px 16px;
      border-radius: 4px;
      margin-bottom: 28px;
      font-size: 14px;
      color: #0d3d37;
    }
    h2 { color: var(--primary); font-size: 20px; margin-top: 32px; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    h3 { font-size: 16px; margin-top: 20px; margin-bottom: 8px; color: #111827; }
    p { margin-bottom: 12px; }
    ul, ol { margin-left: 24px; margin-bottom: 16px; }
    li { margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    th, td { padding: 10px 14px; border: 1px solid var(--border); text-align: left; }
    th { background: #f3f4f6; font-weight: 600; color: #374151; }
    tr:nth-child(even) td { background: #fafafa; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-ok { background: #def7ec; color: #03543f; }
    .badge-info { background: #e1effe; color: #1e429f; }
    .note-box {
      background: #eff6ff;
      border-left: 4px solid #3b82f6;
      padding: 12px 16px;
      margin: 16px 0;
      border-radius: 4px;
      font-size: 14px;
    }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; padding: 0; }
      .header-actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-actions">
      <div>
        <span class="badge badge-ok">✓ Актуально на ноябрь 2026</span>
        <span class="badge badge-info">v2.4.0 (PWA v92)</span>
      </div>
      <div class="btn-group">
        <button onclick="window.print()" class="btn btn-primary">🖨️ Печать / Сохранить в PDF</button>
        <a href="/PROJECT_STATUS.docx" download class="btn btn-secondary">📄 Скачать Word (.docx)</a>
        <a href="/PROJECT_STATUS.md" download class="btn btn-secondary">📝 Скачать Markdown (.md)</a>
      </div>
    </div>

    <h1>Отчёт о текущем состоянии проекта «E-Clinic»</h1>
    <div class="meta-bar">
      <strong>Дата формирования:</strong> 8 ноября 2026 г. | <strong>Окружение:</strong> Продакшн (AWS Lightsail, PostgreSQL 16) | <strong>Домен:</strong> https://admin.e-clinic-control.ru
    </div>

    <h2>1. Обзор системы и назначение</h2>
    <p><strong>E-Clinic (Medical QR System)</strong> — специализированная медицинская веб-платформа и PWA для первичного скрининга, стратификации рисков и диспансерного учёта пациентов с подозрением или подтверждённым диагнозом сахарного диабета 2-го типа (СД2) и сердечно-сосудистых заболеваний (ССЗ) в амбулаторных поликлиниках.</p>
    <ul>
      <li>Массовый скрининг взрослого населения силами участковых медсестёр (включая работу в полном офлайн-режиме без интернета).</li>
      <li>Автоматический расчёт шкал <strong>FINDRISC</strong>, <strong>SCORE2 Lite</strong> и идеальной массы тела по <strong>Рабито</strong>.</li>
      <li>Автоматическая маршрутизация пациентов с высоким риском к терапевту и узким специалистам.</li>
      <li>Диспансерный учёт, дневник повторных визитов, контроль лабораторных показателей (глюкоза, HbA1c, липиды, креатинин, СКФ).</li>
      <li>Управленческий аудит для главных врачей, старших медсестёр и координаторов Минздрава.</li>
    </ul>

    <h2>2. Живые показатели базы данных (на 8 ноября 2026 г.)</h2>
    <table>
      <thead>
        <tr><th>Показатель</th><th>Значение</th><th>Описание</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Всего анкет пациентов</strong></td><td><strong style="color:#0f4c45; font-size:16px;">11 502</strong></td><td>Общий реестр обследованных пациентов</td></tr>
        <tr><td><strong>Подключенных поликлиник</strong></td><td><strong>15</strong></td><td>Городские амбулаторные учреждения</td></tr>
        <tr><td><strong>Зарегистрировано врачей</strong></td><td><strong>45</strong></td><td>Участковые врачи и узкие специалисты</td></tr>
        <tr><td><strong>Проведено врачебных приёмов</strong></td><td><strong>137</strong></td><td>Завершённые повторные осмотры с назначениями</td></tr>
        <tr><td><strong>Записей аудита действий</strong></td><td><strong>5 227</strong></td><td>Полный журнал авторизаций, правок и экспортов</td></tr>
        <tr><td><strong>Нагрузка сервера Lightsail</strong></td><td><strong>0.00, 0.02, 0.00</strong></td><td>Uptime 9+ дней, RAM 836 МБ из 1.9 ГБ</td></tr>
      </tbody>
    </table>

    <h3>Топ-10 поликлиник по числу обследованных:</h3>
    <ol>
      <li><strong>Поликлиника №10</strong> — 2 564 пациента</li>
      <li><strong>Поликлиника №14</strong> — 2 105 пациентов</li>
      <li><strong>Поликлиника №15</strong> — 1 995 пациентов</li>
      <li><strong>Поликлиника №4</strong> — 1 452 пациента</li>
      <li><strong>Поликлиника №2</strong> — 824 пациента</li>
      <li><strong>Поликлиника №12</strong> — 585 пациентов</li>
      <li><strong>Поликлиника №1</strong> — 575 пациентов</li>
      <li><strong>Поликлиника №9</strong> — 574 пациента</li>
      <li><strong>Поликлиника №7</strong> — 424 пациента</li>
      <li><strong>Поликлиника №11</strong> — 385 пациентов</li>
    </ol>

    <h2>3. Недавние критические доработки (Релиз ноябрь 2026)</h2>
    <ul>
      <li><strong>Поддержка однофамильцев и года рождения:</strong> устранена ложная блокировка пациентов с одинаковыми ФИО благодаря сверке года рождения (<code>extractBirthYear</code>). Добавлена кнопка <code>➕ Сохранить как нового пациента</code> (флаг <code>allowDuplicate: true</code>).</li>
      <li><strong>Разблокировка офлайн-очереди медсестры:</strong> исправлена проблема застревания 17 анкет при коде 409 («уже существует в базе»). Система корректно завершает синхронизацию и очищает очередь на устройстве. В шторку добавлены кнопки «✓ Уже в базе» и «✓ Очистить дубликаты».</li>
      <li><strong>Устранение краша Safari WebKit в админ-панели (Пагинация):</strong> внедрена серверная и клиентская пагинация по 50 строк. Размер передаваемого JSON снижен с 3.0 МБ до 44 КБ (отдача за 0.26 сек), полностью решена проблема вылета браузера на iPhone/iPad.</li>
      <li><strong>Калькулятор ИМТ в кабинете врача:</strong> изолирован расчёт ИМТ и категории ожирения при заполнении визита.</li>
      <li><strong>Снятие лимитов и CORS:</strong> оптимизирована пропускная способность для массового медсестринского опроса с мобильных устройств.</li>
    </ul>

    <h2>4. Доступные ссылки и приложения системы</h2>
    <table>
      <thead>
        <tr><th>Модуль</th><th>URL / Путь</th><th>Назначение</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Опросник медсестры</strong></td><td><code>/app-3-patient-survey</code></td><td>Скрининг, расчёт риска, офлайн-режим PWA</td></tr>
        <tr><td><strong>Кабинет врача</strong></td><td><code>/app-2-doctor</code></td><td>Приём пациентов высокого риска, визиты, анализы</td></tr>
        <tr><td><strong>Панель администратора</strong></td><td><code>/app-1-admin-panel</code></td><td>Реестр 11.5k, аккаунты врачей, аудит</td></tr>
        <tr><td><strong>Обучающие тесты</strong></td><td><code>/nurse-training.html</code>, <code>/training.html</code></td><td>Тестирование знаний медперсонала</td></tr>
        <tr><td><strong>Презентация</strong></td><td><code>/presentation.html</code>, <code>/presentation.pptx</code></td><td>Презентационные слайды для медперсонала</td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(publicDir, 'PROJECT_STATUS.html'), htmlContent, 'utf8');
if (fs.existsSync(clinicDir)) {
  fs.writeFileSync(path.join(clinicDir, 'PROJECT_STATUS.html'), htmlContent, 'utf8');
}

// 3. Generate Word document (.docx)
async function buildDocx() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: "Отчёт о текущем состоянии проекта «E-Clinic»",
            heading: HeadingLevel.TITLE
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Дата: 8 ноября 2026 г. | Окружение: Продакшн (PostgreSQL 16) | Версия: 2.4.0 (PWA v92)", italics: true, color: "666666" })
            ]
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: "1. Обзор системы и назначение",
            heading: HeadingLevel.HEADING_1
          }),
          new Paragraph({
            text: "E-Clinic — специализированная медицинская веб-платформа и PWA для первичного скрининга, стратификации рисков и диспансерного учёта пациентов с подозрением или подтверждённым диагнозом сахарного диабета 2-го типа (СД2) и сердечно-сосудистых заболеваний (ССЗ) в амбулаторных поликлиниках."
          }),
          new Paragraph({
            text: "• Массовый скрининг взрослого населения силами медсестёр (включая полный офлайн-режим)."
          }),
          new Paragraph({
            text: "• Автоматический расчёт шкал FINDRISC (0-26 баллов), SCORE2 Lite и формулы Рабито."
          }),
          new Paragraph({
            text: "• Автоматическая маршрутизация пациентов высокого риска к врачу-терапевту."
          }),
          new Paragraph({
            text: "• Диспансерный учёт, повторные визиты, контроль лабораторных показателей и назначений."
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: "2. Живые показатели базы данных (на 8 ноября 2026 г.)",
            heading: HeadingLevel.HEADING_1
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Показатель", bold: true })] }),
                  new TableCell({ children: [new Paragraph({ text: "Значение", bold: true })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Всего анкет пациентов" })] }),
                  new TableCell({ children: [new Paragraph({ text: "11 502" })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Подключенных поликлиник" })] }),
                  new TableCell({ children: [new Paragraph({ text: "15" })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Зарегистрировано врачей" })] }),
                  new TableCell({ children: [new Paragraph({ text: "45" })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Проведено врачебных приёмов" })] }),
                  new TableCell({ children: [new Paragraph({ text: "137" })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Записей аудита действий" })] }),
                  new TableCell({ children: [new Paragraph({ text: "5 227" })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Нагрузка сервера Lightsail" })] }),
                  new TableCell({ children: [new Paragraph({ text: "0.00 load average (9+ дней uptime, 836 МБ RAM)" })] })
                ]
              })
            ]
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: "3. Недавние критические доработки",
            heading: HeadingLevel.HEADING_1
          }),
          new Paragraph({
            text: "1. Поддержка однофамильцев и проверка года рождения: разграничение пациентов с одинаковыми ФИО по extractBirthYear, кнопка принудительного сохранения «Сохранить как нового пациента» (allowDuplicate: true)."
          }),
          new Paragraph({
            text: "2. Разблокировка офлайн-очереди медсестры: автоматическое снятие зависших анкет при ошибке 409 («уже в базе»), кнопки «Уже в базе» и «Очистить дубликаты»."
          }),
          new Paragraph({
            text: "3. Устранение краша Safari WebKit в админ-панели: серверная и клиентская пагинация по 50 строк (снижение объёма JSON с 3.0 МБ до 44 КБ, отдача за 0.26 сек)."
          }),
          new Paragraph({
            text: "4. Корректный расчёт ИМТ в форме осмотра врача в реальном времени."
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: "4. Ссылки и доступ к системе",
            heading: HeadingLevel.HEADING_1
          }),
          new Paragraph({
            text: "• Основной домен: https://admin.e-clinic-control.ru"
          }),
          new Paragraph({
            text: "• Опросник медсестры: /app-3-patient-survey"
          }),
          new Paragraph({
            text: "• Кабинет врача: /app-2-doctor"
          }),
          new Paragraph({
            text: "• Панель администратора: /app-1-admin-panel"
          })
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(publicDir, 'PROJECT_STATUS.docx'), buffer);
  if (fs.existsSync(clinicDir)) {
    fs.writeFileSync(path.join(clinicDir, 'PROJECT_STATUS.docx'), buffer);
  }
}

await buildDocx();
console.log('Docs generated successfully in public and G:\\clinic!');
