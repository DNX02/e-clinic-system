import fs from 'fs';
import { copyFile } from 'fs/promises';
import { join } from 'path';

const gcz11 = [
  { name: "Кодирова Озода", count: 44, note: "Кодирова Озода бегмуродовна (26), Кодирова Озода (18)" },
  { name: "Гулмаҳмадова Шодигул", count: 41, note: "Гулмахмадова Шодигул (29), Гулмамадова Шодигул (12)" },
  { name: "Мирзоева Парвина", count: 30, note: "Мирзоева Парвина (29), Мирзова Парвина (1)" },
  { name: "Пирмухаммедова Азиза", count: 20, note: "Пирмуҳамадова / Пирмухамедова Азиза" },
  { name: "Кироминова Дилноза", count: 15, note: "Кироминова Дилноза Курбоншоевна" },
  { name: "Абдуллоева Моҳира", count: 13, note: "Абдуллоева Мохира курбоновна" },
  { name: "Ашурова Фарангис", count: 12, note: "Ашурова Фарангис (10), Ашурова Ф/Фарангиз (2)" },
  { name: "Сафарова Миҷгона", count: 10, note: "Сафарова Мичгона Хайридиновна" },
  { name: "Ниҳолова Малоҳат", count: 10, note: "Нихолова малохат махмадбековна" },
  { name: "Сафарқулова Мавлуда", count: 10, note: "Сафаркулова Мавлуда / Мавлюда" },
  { name: "Маъзамбекова Розия", count: 8, note: "Мазамбекова Розия (6), Мазамбекова Розия Ш (2)" },
  { name: "Увайтова Гулчеҳра", count: 8, note: "Увайтова Г (5), Увайтова Гулчехра (3)" },
  { name: "Шарипова Сайёҳат", count: 8, note: "Шарифова Саехта / Саехат" },
  { name: "Порпиева (Парпиева) Мунира", count: 8, note: "Порниева / Портиева / Партиева Мунира" },
  { name: "Хабибова Шаҳло", count: 7, note: "Хабибова шахло азизовна" },
  { name: "Муродова Таманно", count: 7, note: "Муродова Тамано (6), Мкродова (1)" },
  { name: "Раҳматова Маҳфират", count: 7, note: "Рахматова Махфират (5), Раҳматова Маърифат (2)" },
  { name: "Аҳмадзода Муноҷот", count: 5, note: "Ахмадзода / Аҳмадзода Муноҷот" },
  { name: "Ҳукматуллоева Донагул", count: 5, note: "Ҳукматуллоева / Хукуматулоева Донагул" },
  { name: "Шамсиддинова Насиба", count: 5, note: "Шамсудинова / Шамсидинова Насиба" },
  { name: "Шарипова Сунаҳвар", count: 4, note: "Шарипова Сунахвар Рачабовна" },
  { name: "Умарова Раҷабгул", count: 4, note: "Умарова Рачабгул (3), Умарова Р (1)" },
  { name: "Нозимзода София (Сафия)", count: 4, note: "Нозимзода Сафия" },
  { name: "Шарора Иброҳимзода", count: 4, note: "Шарора Иброхимзода" },
  { name: "Хабибова Қудбия", count: 4, note: "Хабибова Кудбия" },
  { name: "Ташрипова Ситора", count: 4, note: "Ташринова С (3), Ташрипова Ситора (1)" },
  { name: "Сафарова Олуфта", count: 3, note: "Сафарова Олуфта" },
  { name: "Аҳмедова Малика", count: 3, note: "Ахмедова М" },
  { name: "Маҳмадзода Фаришта", count: 2, note: "Махмадзода Фариштаи Салуматшо" },
  { name: "Нуралиева Роҳила (Раҳима)", count: 2, note: "Нуралиева Рахима / Рохила" },
  { name: "Бозорова Миҷгона", count: 2, note: "Бозорова Мичгона" },
  { name: "Мирзобекова Гулнора", count: 2, note: "Мирзобекова Гулнора" },
  { name: "Расулова Манижа", count: 1, note: "Расулова Манижа" },
  { name: "Ҳайлоева Давлатхон", count: 1, note: "Хайлоева Давлатхон" },
  { name: "Ғуломова Бахтинисо", count: 1, note: "Гуломова Бахтинисо" },
  { name: "Абдулмаҷидзода Манижа", count: 1, note: "Абдулмачитзода Манижа" },
  { name: "Негматуллоева Нигина", count: 1, note: "Негматулоева Нигина" },
  { name: "Эшматова Мунира", count: 1, note: "Ешматова Мунира" },
  { name: "Абдуқаҳорова Нодира", count: 1, note: "Абдукахорова Нодира Кодиржоновна" },
  { name: "Раҳимова М.", count: 1, note: "Рахимовп м" },
  { name: "Не указано (без медсестры)", count: 68, note: "Анкеты без указания медсестры" }
];

const gcz12 = [
  { name: "Ҳусейнзода Амин Қурбон", count: 69, note: "ҲУСЕНЗОДА АМИН ҚУРБОН" },
  { name: "Исҳоқова Малика", count: 61, note: "Исхокова Малика (60), Исҳоқова Малика (1)" },
  { name: "Моҳсафари Худойқулзода", count: 54, note: "Мохсафари Худойкулзода (50), Моҳсафари Худойқулзода (4)" },
  { name: "Салимова Нозанин", count: 43, note: "Салимова Нозанин (39), Салимов Нозанин (4)" },
  { name: "Раҳматова Зиёда", count: 31, note: "Раҳматова Зиёда (20), Рахматова Зиёда (11)" },
  { name: "Исматова Нигора", count: 31, note: "Исматова нигора (25), Исматлва нигора (4), др. (2)" },
  { name: "Сафарова Мушкинисо", count: 28, note: "Мушкинисои М (27), Сафарова (1)" },
  { name: "А04446777 (код/участок)", count: 17, note: "Введён код медсестры А04446777" },
  { name: "Исматова Сувайдо", count: 11, note: "Исматова сувайдо" },
  { name: "Барнои Ҳусайн", count: 10, note: "Барнои Хисайн" },
  { name: "Нарзуллоева Маҳфират", count: 10, note: "Нарзуллоева Махфират Файзуллоевна" },
  { name: "Сумани Қурбонали", count: 10, note: "Сумани Курбонали (8), Суман Курбонали (2)" },
  { name: "Холова Шабнам", count: 10, note: "Холова шабнам (9), Холова Ш. Х (1)" },
  { name: "Ташрипова Гулноза", count: 9, note: "Ташрипова Гулноза Хукуматовна" },
  { name: "Раҳмонқулова (Раҳмонова) Адиба", count: 9, note: "Рахмонова Адиба" },
  { name: "Сафарзода Самирабону", count: 9, note: "Сафарзода Самирабону (5), Сафарзода Самирони (4)" },
  { name: "Ҷалолова Гулнора", count: 8, note: "Ҷалолова Гулнора (7), Чалолова гулнора чабборовна (1)" },
  { name: "Мунисаи Раҳим", count: 8, note: "Мунисаи Рахим" },
  { name: "Қосимова Сарвиноз", count: 8, note: "Косимова С" },
  { name: "Файзова Маҳбуба", count: 8, note: "Файзова Махбуба" },
  { name: "Фотимаи Худойдод", count: 7, note: "Фотимаи Худойдод" },
  { name: "М.3 ш (медсестра 3 участка)", count: 7, note: "М.3 ш" },
  { name: "Зокирова Муҳайё", count: 7, note: "Зокирова Мухайё / Мухайе" },
  { name: "Исломова Шоира", count: 6, note: "Исломова Шоира (5), Исломова Ш93оира (1)" },
  { name: "Ашурова Шабнам", count: 4, note: "Ашурова Шабнам Туракуловна" },
  { name: "Саидзода Моҳирабону", count: 4, note: "Саидзода мохирабону" },
  { name: "Ғоибова Ҳанифа", count: 4, note: "Гоибова ханифа рачабовна" },
  { name: "Исоева Сафармо", count: 3, note: "Исоева Сафармо Бозхоновна" },
  { name: "Саидова Занҷира", count: 3, note: "Саидова Занчира / Занчирамох" },
  { name: "Саидова Меҳрубон", count: 2, note: "Саидова М" },
  { name: "Оишамоҳи Эмомалӣ", count: 2, note: "Оишамохи Эмомали / Эмомалии" },
  { name: "Шораҳматова Дилором", count: 2, note: "Шорахматова дилором / Шорахматова Д" },
  { name: "Ҷалилова Марҷона", count: 2, note: "Ҷалилова Марҷона" },
  { name: "Судиқова Насиба", count: 2, note: "Судикова Насиба Музафаровна" },
  { name: "Юсупова Фирӯза", count: 1, note: "Юсупова Фируза" },
  { name: "Ҳасанова Сарвинисо", count: 1, note: "Хасанова Сарвинисо" },
  { name: "Боронова Шаҳноза", count: 1, note: "Боронова Шахноза" },
  { name: "Қурбонова Марҷона", count: 1, note: "Курбонова Марчона Кобилчоновна" },
  { name: "Не указано (без медсестры)", count: 85, note: "Анкеты без указания медсестры" }
];

// Check totals
const total11 = gcz11.reduce((sum, item) => sum + item.count, 0);
const total12 = gcz12.reduce((sum, item) => sum + item.count, 0);
console.log(`Total GCZ 11: ${total11} (expected 387)`);
console.log(`Total GCZ 12: ${total12} (expected 588)`);

function xmlCell(value, type = "String") {
  const escaped = String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return `<Cell><Data ss:Type="${type}">${escaped}</Data></Cell>`;
}

function xmlSheet(name, headers, rows) {
  const header = `<Row ss:StyleID="Header">${headers.map((item) => xmlCell(item)).join("")}</Row>`;
  const body = rows.map((row) => `<Row>${row.map((item) => xmlCell(item, typeof item === "number" ? "Number" : "String")).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${name}"><Table>${header}${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
}

const sheets = [
  xmlSheet("ГЦЗ №11 (Поликлиника 11)", ["№", "ФИО медсестры", "Количество скринингов", "Варианты написания / Примечание"], gcz11.map((item, idx) => [idx + 1, item.name, item.count, item.note])),
  xmlSheet("ГЦЗ №12 (Поликлиника 12)", ["№", "ФИО медсестры", "Количество скринингов", "Варианты написания / Примечание"], gcz12.map((item, idx) => [idx + 1, item.name, item.count, item.note]))
].join("");

const excelXml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1E5E4E" ss:Pattern="Solid"/></Style></Styles>${sheets}</Workbook>`;

// Build standalone HTML report for mobile
const htmlReport = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отчёт по медсёстрам ГЦЗ №11 и ГЦЗ №12</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f4f6f8; color: #222; margin: 0; padding: 16px; }
  .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; color: #0d4436; margin-top: 0; }
  h2 { font-size: 17px; margin-top: 24px; color: #165b4c; border-bottom: 2px solid #e2ece9; padding-bottom: 8px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stat-card { background: #eaf4f1; border-radius: 8px; padding: 12px 16px; border-left: 4px solid #165b4c; }
  .stat-num { font-size: 24px; font-weight: bold; color: #0d4436; }
  .stat-label { font-size: 13px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
  th { background: #165b4c; color: #fff; text-align: left; padding: 10px 8px; font-weight: 600; }
  td { padding: 8px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) { background: #fbfbfb; }
  .badge { background: #e2ece9; color: #0d4436; font-weight: bold; padding: 3px 8px; border-radius: 12px; display: inline-block; }
  .muted { color: #777; font-size: 12px; }
  .btn-download { display: inline-block; background: #165b4c; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; margin-top: 12px; }
</style>
</head>
<body>
<div class="container">
  <h1>Скрининг НИЗ: Количество анкет по медсёстрам</h1>
  <p class="muted">Данные из базы E-Clinic по состоянию на 10 ноября 2026 г.</p>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-num">${total11}</div>
      <div class="stat-label">ГЦЗ №11 (Поликлиника 11)</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${total12}</div>
      <div class="stat-label">ГЦЗ №12 (Поликлиника 12)</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${total11 + total12}</div>
      <div class="stat-label">Всего по двум поликлиникам</div>
    </div>
  </div>

  <a class="btn-download" href="/nurses-report-gcz11-12.xls" download>📥 Скачать таблицу Excel (.xls)</a>

  <h2>🏥 ГЦЗ №11 (Поликлиника №11) — ${total11} анкет</h2>
  <table>
    <thead><tr><th>№</th><th>Медсестра</th><th style="text-align:center;">Анкет</th><th>Примечание / Варианты</th></tr></thead>
    <tbody>
      ${gcz11.map((item, idx) => `<tr><td>${idx + 1}</td><td><strong>${item.name}</strong></td><td style="text-align:center;"><span class="badge">${item.count}</span></td><td class="muted">${item.note}</td></tr>`).join('')}
    </tbody>
  </table>

  <h2>🏥 ГЦЗ №12 (Поликлиника №12) — ${total12} анкет</h2>
  <table>
    <thead><tr><th>№</th><th>Медсестра</th><th style="text-align:center;">Анкет</th><th>Примечание / Варианты</th></tr></thead>
    <tbody>
      ${gcz12.map((item, idx) => `<tr><td>${idx + 1}</td><td><strong>${item.name}</strong></td><td style="text-align:center;"><span class="badge">${item.count}</span></td><td class="muted">${item.note}</td></tr>`).join('')}
    </tbody>
  </table>
</div>
</body>
</html>`;

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const G_CLINIC_DIR = 'G:\\clinic';

// Save files locally in project public/
fs.writeFileSync(join(PUBLIC_DIR, 'nurses-report-gcz11-12.xls'), excelXml, 'utf8');
fs.writeFileSync(join(PUBLIC_DIR, 'nurses-report-gcz11-12.html'), htmlReport, 'utf8');

// Save to G:\clinic\
if (fs.existsSync(G_CLINIC_DIR)) {
  fs.writeFileSync(join(G_CLINIC_DIR, 'Отчет_Медсестры_ГЦЗ11_ГЦЗ12.xls'), excelXml, 'utf8');
  fs.writeFileSync(join(G_CLINIC_DIR, 'Отчет_Медсестры_ГЦЗ11_ГЦЗ12.html'), htmlReport, 'utf8');
  console.log('Saved to G:\\clinic successfully!');
}

console.log('Reports generated successfully!');
