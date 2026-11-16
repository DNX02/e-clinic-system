// PDF version of the nurse activity report (nurse-report.js): A4, Tajik/Russian names, page numbers.
// The font ships with the app (fonts/), so Cyrillic and Tajik letters print on any server.
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

const FONT = fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const FONT_BOLD = fileURLToPath(new URL("./fonts/DejaVuSans-Bold.ttf", import.meta.url));
const GREEN = "#0f6b5c";
const MUTED = "#5b6472";
const LINE = "#d9e3e1";
const COLUMNS = [
  { title: "№", width: 26, align: "right" },
  { title: "Медсестра", width: 186 },
  { title: "Анкет", width: 46, align: "right" },
  { title: "К врачу", width: 52, align: "right" },
  { title: "Дней", width: 42, align: "right" },
  { title: "Первая — последняя", width: 163 }
];

const ddmmyyyy = (day) => (day ? day.split("-").reverse().join(".") : "");

export function nurseReportPdf(report, { generatedAt = new Date() } = {}) {
  return new Promise((resolve, reject) => {
    const { clinic, from, to } = report.filters;
    const clinicLabel = clinic === "all" ? "Все поликлиники" : clinic;
    const period = from || to ? `${ddmmyyyy(from) || "с начала работы"} — ${ddmmyyyy(to) || "по сегодня"}` : "за весь период";
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Отчёт по медсёстрам — ${clinicLabel}`, Author: "E-Clinic" } });
    doc.registerFont("Regular", FONT);
    doc.registerFont("Bold", FONT_BOLD);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 24;
    const stamp = new Date(generatedAt.getTime() + 5 * 3600000).toISOString();

    // Title block
    doc.rect(0, 0, doc.page.width, 92).fill(GREEN);
    doc.fillColor("white").font("Bold").fontSize(20).text("Отчёт по медсёстрам", left, 26);
    doc.font("Regular").fontSize(11).text(`${clinicLabel}  ·  ${period}`, left, 56);
    doc.fillColor(MUTED).fontSize(8.5).text(`E-Clinic · сформирован ${ddmmyyyy(stamp.slice(0, 10))} ${stamp.slice(11, 16)} (Душанбе)`, left, 104);

    // Summary
    const boxes = [["Анкет", report.totals.surveys], ["Медсестёр", report.totals.nurses], ["Направлено к врачу", report.totals.needsDoctor]];
    const boxWidth = (width - 20) / 3;
    boxes.forEach(([label, value], index) => {
      const x = left + index * (boxWidth + 10);
      doc.roundedRect(x, 124, boxWidth, 52, 6).fillAndStroke("#f1f6f5", LINE);
      doc.fillColor(MUTED).font("Regular").fontSize(9).text(label, x + 12, 132, { width: boxWidth - 24 });
      doc.fillColor("#111").font("Bold").fontSize(18).text(String(value), x + 12, 147, { width: boxWidth - 24 });
    });
    let y = 194;
    if (report.totals.withoutName) {
      doc.fillColor(MUTED).font("Regular").fontSize(8.5)
        .text(`Без ФИО медсестры (добавлены врачом или старые записи): ${report.totals.withoutName} — в конце таблицы.`, left, y, { width });
      y = doc.y + 8;
    }

    const header = () => {
      doc.rect(left, y, width, 22).fill("#dcece8");
      let x = left;
      doc.fillColor("#1f2a2e").font("Bold").fontSize(8.5);
      for (const column of COLUMNS) {
        doc.text(column.title, x + 5, y + 7, { width: column.width - 10, align: column.align || "left", lineBreak: false });
        x += column.width;
      }
      y += 22;
    };
    header();

    report.rows.forEach((row, index) => {
      const variants = row.variants.length ? `Написания: ${row.variants.map((item) => `${item.name} (${item.count})`).join(", ")}` : "";
      doc.font("Bold").fontSize(9.5);
      const nameHeight = doc.heightOfString(row.name, { width: COLUMNS[1].width - 10 });
      doc.font("Regular").fontSize(7.5);
      const variantsHeight = variants ? doc.heightOfString(variants, { width: COLUMNS[1].width - 10 }) + 2 : 0;
      const rowHeight = Math.max(22, nameHeight + variantsHeight + 12);
      if (y + rowHeight > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
        header();
      }
      if (index % 2) doc.rect(left, y, width, rowHeight).fill("#f7faf9");
      const cells = [String(index + 1), null, String(row.surveys), String(row.needsDoctor), String(row.activeDays), `${ddmmyyyy(row.firstDate)} — ${ddmmyyyy(row.lastDate)}`];
      let x = left;
      COLUMNS.forEach((column, i) => {
        if (i === 1) {
          doc.fillColor(row.special ? MUTED : "#111").font("Bold").fontSize(9.5).text(row.name, x + 5, y + 6, { width: column.width - 10 });
          if (variants) doc.fillColor(MUTED).font("Regular").fontSize(7.5).text(variants, x + 5, y + 6 + nameHeight + 2, { width: column.width - 10 });
        } else {
          doc.fillColor(row.special ? MUTED : "#111").font(i === 2 ? "Bold" : "Regular").fontSize(i === 5 ? 8.5 : 9).text(cells[i], x + 5, y + 7, { width: column.width - 10, align: column.align || "left", lineBreak: false });
        }
        x += column.width;
      });
      y += rowHeight;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });

    if (!report.rows.length) {
      doc.fillColor(MUTED).font("Regular").fontSize(10).text("За выбранный период анкет нет.", left, y + 12);
    } else {
      if (y + 30 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      doc.fillColor("#111").font("Bold").fontSize(10)
        .text(`ИТОГО: ${report.totals.surveys} анкет, к врачу направлено ${report.totals.needsDoctor}.`, left, y + 12, { width });
      doc.fillColor(MUTED).font("Regular").fontSize(7.5)
        .text("Разные написания одной фамилии (х/ҳ, ч/ҷ, с отчеством и без) собраны в одну строку. Опечатки не объединяются — проверьте похожие фамилии.", left, doc.y + 6, { width });
    }

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing in the footer must not start a new page
      doc.fillColor(MUTED).font("Regular").fontSize(8)
        .text(`${clinicLabel} · стр. ${page + 1} из ${range.count}`, left, doc.page.height - 28, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
