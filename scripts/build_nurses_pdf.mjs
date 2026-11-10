import PDFDocument from 'pdfkit';
import fs from 'fs';
import { join } from 'path';

const gcz11 = [
  { name: "Кодирова Озода", count: 44, note: "Кодирова Озода бегмуродовна (26), Кодирова Озода (18)" },
  { name: "Гулмаҳмадова Шодигул", count: 41, note: "Гулмахмадова Шодигул (29), Гулмамадова Шодигул (12)" },
  { name: "Мирзоева Парвина", count: 30, note: "Мирзоева Парвина (29), Мирзова Парвина (1)" },
  { name: "Пирмухаммедова Азиза", count: 20, note: "Пирмуҳамадова / Пирмухамедова Азиза" },
  { name: "Кироминова Дилноза", count: 15, note: "Кироминова Дилноза Курбоншоевна" },
  { name: "Абдуллоева Моҳира", count: 13, note: "Абдуллоева Мохира курбоновна" },
  { name: "Ашурова Фарангис", count: 12, note: "Ашурова Фарангис (10), Ашурова Ф / Фарангиз (2)" },
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
  { name: "А04446777 (код медсестры)", count: 17, note: "Введён код медсестры А04446777" },
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

const total11 = 387;
const total12 = 588;

function findFont(regular = true) {
  const candidates = regular 
    ? ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/calibri.ttf"]
    : ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/calibrib.ttf"];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function generatePdfReport(outputPath) {
  return new Promise((resolve, reject) => {
    const regularFont = findFont(true);
    const boldFont = findFont(false);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      bufferPages: true,
      info: {
        Title: 'Отчёт по медсёстрам ГЦЗ №11 и ГЦЗ №12',
        Author: 'E-Clinic System'
      }
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    if (regularFont) doc.font(regularFont);

    // Helpers
    const setBold = () => { if (boldFont) doc.font(boldFont); };
    const setRegular = () => { if (regularFont) doc.font(regularFont); };

    // --- Header ---
    setBold();
    doc.fontSize(16).fillColor('#0D4436').text('E-CLINIC • СКРИНИНГ НЕИНФЕКЦИОННЫХ ЗАБОЛЕВАНИЙ', { align: 'center' });
    setRegular();
    doc.fontSize(12).fillColor('#333333').text('Отчёт по количеству скринингов в разрезе медсестёр ГЦЗ №11 и ГЦЗ №12', { align: 'center' });
    doc.fontSize(9).fillColor('#666666').text('Город Душанбе • Данные из базы платформы на 10 ноября 2026 г.', { align: 'center' });
    doc.moveDown(0.8);

    // KPI Summary boxes
    const startY = doc.y;
    const boxWidth = 165;
    const boxHeight = 44;
    const gap = 12;

    const drawBox = (x, title, value, subtitle) => {
      doc.rect(x, startY, boxWidth, boxHeight).fillAndStroke('#EAF4F1', '#165B4C');
      setBold();
      doc.fontSize(14).fillColor('#0D4436').text(String(value), x + 10, startY + 6);
      doc.fontSize(9).fillColor('#165B4C').text(title, x + 10, startY + 22);
      setRegular();
      doc.fontSize(7.5).fillColor('#666666').text(subtitle, x + 10, startY + 32);
    };

    drawBox(36, 'ГЦЗ №11 (Поликлиника 11)', `${total11}`, '32 активные медсестры');
    drawBox(36 + boxWidth + gap, 'ГЦЗ №12 (Поликлиника 12)', `${total12}`, '34 активные медсестры');
    drawBox(36 + (boxWidth + gap) * 2, 'Всего скринингов', `${total11 + total12}`, 'по двум учреждениям');

    doc.y = startY + boxHeight + 14;

    // Table drawing function
    const drawTable = (title, items, totalClinic) => {
      // Check if page break needed for title
      if (doc.y > 680) doc.addPage();

      setBold();
      doc.fontSize(12).fillColor('#0D4436').text(title);
      doc.moveDown(0.3);

      const colX = [36, 60, 230, 295, 350];
      const colW = [24, 170, 65, 55, 175];
      const rowH = 14;

      // Table Header
      const headerY = doc.y;
      doc.rect(36, headerY, 522, 16).fill('#165B4C');
      doc.fontSize(8).fillColor('#FFFFFF');
      doc.text('№', colX[0], headerY + 4, { width: colW[0], align: 'center' });
      doc.text('Медсестра (ФИО)', colX[1], headerY + 4, { width: colW[1] });
      doc.text('Скринингов', colX[2], headerY + 4, { width: colW[2], align: 'center' });
      doc.text('Доля (%)', colX[3], headerY + 4, { width: colW[3], align: 'center' });
      doc.text('Варианты в базе / Примечание', colX[4], headerY + 4, { width: colW[4] });

      doc.y = headerY + 16;

      // Rows
      items.forEach((item, index) => {
        if (doc.y > 750) {
          doc.addPage();
          // redraw mini header on next page
          const nH = doc.y;
          doc.rect(36, nH, 522, 14).fill('#165B4C');
          setBold();
          doc.fontSize(8).fillColor('#FFFFFF');
          doc.text('№', colX[0], nH + 3, { width: colW[0], align: 'center' });
          doc.text('Медсестра (ФИО)', colX[1], nH + 3, { width: colW[1] });
          doc.text('Скринингов', colX[2], nH + 3, { width: colW[2], align: 'center' });
          doc.text('Доля (%)', colX[3], nH + 3, { width: colW[3], align: 'center' });
          doc.text('Варианты в базе / Примечание', colX[4], nH + 3, { width: colW[4] });
          doc.y = nH + 14;
        }

        const rY = doc.y;
        const bg = index % 2 === 0 ? '#FFFFFF' : '#F9FBFB';
        doc.rect(36, rY, 522, rowH).fill(bg);

        setRegular();
        doc.fontSize(8).fillColor('#222222');
        doc.text(String(index + 1), colX[0], rY + 3, { width: colW[0], align: 'center' });
        
        setBold();
        doc.text(item.name, colX[1], rY + 3, { width: colW[1], lineBreak: false, ellipsis: true });
        
        doc.fillColor('#0D4436');
        doc.text(String(item.count), colX[2], rY + 3, { width: colW[2], align: 'center' });
        
        setRegular();
        doc.fillColor('#555555');
        const pct = ((item.count / totalClinic) * 100).toFixed(1) + '%';
        doc.text(pct, colX[3], rY + 3, { width: colW[3], align: 'center' });
        
        doc.fillColor('#777777');
        doc.fontSize(7).text(item.note, colX[4], rY + 3.5, { width: colW[4], lineBreak: false, ellipsis: true });

        // Line separator
        doc.rect(36, rY + rowH - 0.5, 522, 0.5).fill('#E5EBE9');
        doc.y = rY + rowH;
      });

      doc.moveDown(0.8);
    };

    drawTable(`Городской центр здоровья №11 (Поликлиника №11) — Всего: ${total11} анкет`, gcz11, total11);
    drawTable(`Городской центр здоровья №12 (Поликлиника №12) — Всего: ${total12} анкет`, gcz12, total12);

    // Number pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      setRegular();
      doc.fontSize(7.5).fillColor('#888888').text(
        `E-Clinic • Медицинская информационная система • Страница ${i + 1} из ${range.count}`,
        36,
        800,
        { align: 'center', width: 522 }
      );
    }

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const G_CLINIC_DIR = 'G:\\clinic';

const publicPdf = join(PUBLIC_DIR, 'nurses-report-gcz11-12.pdf');
const gClinicPdf = join(G_CLINIC_DIR, 'Отчет_Медсестры_ГЦЗ11_ГЦЗ12.pdf');

generatePdfReport(publicPdf)
  .then(() => {
    console.log('Public PDF generated successfully at:', publicPdf);
    if (fs.existsSync(G_CLINIC_DIR)) {
      fs.copyFileSync(publicPdf, gClinicPdf);
      console.log('Saved to G:\\clinic successfully at:', gClinicPdf);
    }
  })
  .catch(console.error);
