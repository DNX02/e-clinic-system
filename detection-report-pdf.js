// PDF summary of detection-report.js: diabetes and hypertension found by screening and by doctors.
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

const FONT = fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const FONT_BOLD = fileURLToPath(new URL("./fonts/DejaVuSans-Bold.ttf", import.meta.url));
const GREEN = "#0f6b5c";
const RED = "#9f1d1d";
const BLUE = "#1d4f91";
const MUTED = "#5b6472";
const LINE = "#d9e3e1";
const ddmmyyyy = (day) => (day ? day.split("-").reverse().join(".") : "");
const num = (value) => String(value ?? 0).replace(".", ",");

export function detectionReportPdf(report, { generatedAt = new Date() } = {}) {
  return new Promise((resolve, reject) => {
    const { clinic, from, to } = report.filters;
    const t = report.totals;
    const th = report.thresholds;
    const clinicLabel = clinic === "all" ? "Все поликлиники" : clinic;
    const period = from || to ? `${ddmmyyyy(from) || "с начала работы"} — ${ddmmyyyy(to) || "по сегодня"}` : "за весь период";
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Выявление СД и АГ — ${clinicLabel}`, Author: "E-Clinic" } });
    doc.registerFont("Regular", FONT);
    doc.registerFont("Bold", FONT_BOLD);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const stamp = new Date(generatedAt.getTime() + 5 * 3600000).toISOString();

    doc.rect(0, 0, doc.page.width, 96).fill(GREEN);
    doc.fillColor("white").font("Bold").fontSize(17).text("Выявление сахарного диабета и артериальной гипертензии", left, 22, { width });
    doc.font("Regular").fontSize(11).text(`${clinicLabel}  ·  ${period}`, left, 66);
    doc.fillColor(MUTED).fontSize(8.5).text(`E-Clinic · сформирован ${ddmmyyyy(stamp.slice(0, 10))} ${stamp.slice(11, 16)} (Душанбе)`, left, 106);

    doc.roundedRect(left, 124, width, 44, 6).fillAndStroke("#f1f6f5", LINE);
    doc.fillColor(MUTED).font("Regular").fontSize(9.5).text("Обследовано медсёстрами (анкет скрининга)", left + 14, 132);
    doc.fillColor("#111").font("Bold").fontSize(18).text(String(t.screened), left + 14, 145);
    doc.fillColor(MUTED).font("Regular").fontSize(9.5).text("Риск и СД, и АГ одновременно (скрининг)", left + width / 2, 132);
    doc.fillColor("#111").font("Bold").fontSize(18).text(String(t.both), left + width / 2, 145);

    // Two blocks: diabetes and hypertension.
    const block = (x, y, w, color, title, lines) => {
      doc.roundedRect(x, y, w, 196, 8).lineWidth(1.2).strokeColor(color).stroke();
      doc.rect(x, y, w, 30).fill(color);
      doc.fillColor("white").font("Bold").fontSize(11.5).text(title, x + 12, y + 9, { width: w - 24 });
      let yy = y + 42;
      for (const [label, value, strong] of lines) {
        doc.fillColor(strong ? "#111" : MUTED).font(strong ? "Bold" : "Regular").fontSize(strong ? 10 : 9).text(label, x + 12, yy, { width: w - 70 });
        const h = doc.heightOfString(label, { width: w - 70 });
        doc.fillColor(strong ? color : "#111").font("Bold").fontSize(strong ? 16 : 12).text(String(value), x + w - 58, yy - (strong ? 3 : 1), { width: 46, align: "right" });
        yy += Math.max(h, strong ? 18 : 14) + 9;
      }
    };
    const half = (width - 14) / 2;
    block(left, 184, half, RED, "Сахарный диабет 2 типа", [
      ["Диагноз СД поставлен врачом", t.dxDiabetes, true],
      ["Преддиабет (врач)", t.dxPrediabetes],
      [`Сахар крови ≥ ${num(th.glucose)} ммоль/л при скрининге`, t.glucose],
      [`  из них ≥ ${num(th.glucoseHigh)} ммоль/л`, t.glucoseHigh],
      [`Высокий риск FINDRISC (≥ ${th.findrisc} баллов)`, t.findrisc],
      ["Назначены препараты от диабета", t.diabetesDrugs]
    ]);
    block(left + half + 14, 184, half, BLUE, "Артериальная гипертензия", [
      ["Диагноз АГ поставлен врачом", t.dxHypertension, true],
      [`АД ≥ ${th.systolic}/${th.diastolic} мм рт.ст. при скрининге`, t.pressure],
      ["Назначены препараты от давления", t.hypertensionDrugs]
    ]);

    // Table by clinic.
    let y = 398;
    const cols = [["Поликлиника", 118], ["Анкет", 58], [`Сахар ≥${num(th.glucose)}`, 52], [`FINDRISC ≥${th.findrisc}`, 58], ["Диагноз СД", 56], [`АД ≥${th.systolic}/${th.diastolic}`, 62], ["Диагноз АГ", 56], ["СД+АГ риск", 55]];
    doc.fillColor("#111").font("Bold").fontSize(11).text("По поликлиникам", left, y);
    y += 18;
    const header = () => {
      doc.rect(left, y, width, 26).fill("#dcece8");
      let x = left;
      doc.fillColor("#1f2a2e").font("Bold").fontSize(7.8);
      for (const [title, w] of cols) { doc.text(title, x + 4, y + 5, { width: w - 8, align: x === left ? "left" : "right" }); x += w; }
      y += 26;
    };
    header();
    const rows = [...report.rows, ...(report.rows.length > 1 ? [t] : [])];
    rows.forEach((r, index) => {
      if (y + 20 > doc.page.height - doc.page.margins.bottom - 70) { doc.addPage(); y = doc.page.margins.top; header(); }
      const total = r === t;
      if (total) doc.rect(left, y, width, 20).fill("#eef5f3");
      else if (index % 2) doc.rect(left, y, width, 20).fill("#f7faf9");
      const values = [r.clinic, r.screened, r.glucose, r.findrisc, r.dxDiabetes, r.pressure, r.dxHypertension, r.both];
      let x = left;
      values.forEach((value, i) => {
        doc.fillColor("#111").font(total || i === 4 || i === 6 ? "Bold" : "Regular").fontSize(8.8)
          .text(String(value), x + 4, y + 6, { width: cols[i][1] - 8, align: i === 0 ? "left" : "right", lineBreak: false });
        x += cols[i][1];
      });
      y += 20;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });
    if (!report.rows.length) { doc.fillColor(MUTED).font("Regular").fontSize(10).text("За выбранный период данных нет.", left, y + 10); y += 30; }

    // How it is counted.
    if (y + 110 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
    doc.fillColor(MUTED).font("Bold").fontSize(8.5).text("Как считается", left, y + 16);
    doc.font("Regular").fontSize(7.8).text([
      "• Считаются разные пациенты: повторные анкеты и осмотры одного пациента не удваивают число.",
      `• Скрининг (медсестра): дата анкеты. Пороги — правила проекта: сахар ≥ ${num(th.glucose)} ммоль/л, FINDRISC ≥ ${th.findrisc}, АД ≥ ${th.systolic} или ≥ ${th.diastolic} мм рт.ст. Это подозрение, а не диагноз.`,
      "• Диагноз врача: дата осмотра; берётся из текста диагноза в сохранённом осмотре (русский или таджикский). Преддиабет считается отдельно; если у пациента был и преддиабет, и диабет — он учтён как диабет.",
      "• Удалённые (архивные) анкеты не учитываются."
    ].join("\n"), left, doc.y + 4, { width, lineGap: 2 });

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(MUTED).font("Regular").fontSize(8).text(`${clinicLabel} · стр. ${page + 1} из ${range.count}`, left, doc.page.height - 28, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
