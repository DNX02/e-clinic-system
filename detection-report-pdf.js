// PDF summary of detection-report.js: diabetes, blood pressure bands and body weight, found by screening
// and by doctors. A4 landscape: three blocks in a row and a wide per-clinic table.
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

const FONT = fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const FONT_BOLD = fileURLToPath(new URL("./fonts/DejaVuSans-Bold.ttf", import.meta.url));
const GREEN = "#0f6b5c";
const RED = "#9f1d1d";
const BLUE = "#1d4f91";
const AMBER = "#8a5200";
const MUTED = "#5b6472";
const LINE = "#d9e3e1";
const ddmmyyyy = (day) => (day ? day.split("-").reverse().join(".") : "");
const dec = (value) => Number(value ?? 0).toFixed(1).replace(".", ","); // 7,0 · 6,1 · 29,9

export function detectionReportPdf(report, { generatedAt = new Date() } = {}) {
  return new Promise((resolve, reject) => {
    const { clinic, from, to } = report.filters;
    const t = report.totals;
    const th = report.thresholds;
    const [es, ed] = th.bpExact;
    const [hs, hd] = th.bpHypertension;
    const clinicLabel = clinic === "all" ? "Все поликлиники" : clinic;
    const period = from || to ? `${ddmmyyyy(from) || "с начала работы"} — ${ddmmyyyy(to) || "по сегодня"}` : "за весь период";
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: `Выявление СД, АГ и ожирения — ${clinicLabel}`, Author: "E-Clinic" } });
    doc.registerFont("Regular", FONT);
    doc.registerFont("Bold", FONT_BOLD);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
    const stamp = new Date(generatedAt.getTime() + 5 * 3600000).toISOString();

    // Title
    doc.rect(0, 0, doc.page.width, 64).fill(GREEN);
    doc.fillColor("white").font("Bold").fontSize(16).text("Выявление сахарного диабета, артериальной гипертензии и ожирения", left, 16, { width });
    doc.font("Regular").fontSize(10.5).text(`${clinicLabel}  ·  ${period}`, left, 40);
    doc.fillColor(MUTED).fontSize(8).text(`E-Clinic · сформирован ${ddmmyyyy(stamp.slice(0, 10))} ${stamp.slice(11, 16)} (Душанбе)`, left, 70);

    // Summary strip
    const strip = [["Обследовано медсёстрами", t.screened], [`Сахар ≥ ${dec(th.glucose)} и АД ≥ ${hs}/${hd} одновременно`, t.both], ["ИМТ известен у", t.bmiKnown]];
    const stripWidth = width / strip.length;
    doc.roundedRect(left, 84, width, 38, 6).fillAndStroke("#f1f6f5", LINE);
    strip.forEach(([label, value], i) => {
      const x = left + i * stripWidth + 12;
      doc.fillColor(MUTED).font("Regular").fontSize(8.5).text(label, x, 90, { width: stripWidth - 24 });
      doc.fillColor("#111").font("Bold").fontSize(14).text(String(value), x, 102);
    });

    // Three blocks
    const blockTop = 132;
    const blockHeight = 152;
    const gap = 12;
    const blockWidth = (width - 2 * gap) / 3;
    const block = (index, color, title, lines) => {
      const x = left + index * (blockWidth + gap);
      doc.roundedRect(x, blockTop, blockWidth, blockHeight, 8).lineWidth(1.2).strokeColor(color).stroke();
      doc.rect(x, blockTop, blockWidth, 26).fill(color);
      doc.fillColor("white").font("Bold").fontSize(10.5).text(title, x + 10, blockTop + 8, { width: blockWidth - 20 });
      let y = blockTop + 34;
      for (const [label, value, strong] of lines) {
        const labelWidth = blockWidth - 66;
        doc.fillColor(strong ? "#111" : MUTED).font(strong ? "Bold" : "Regular").fontSize(strong ? 9.2 : 8.5).text(label, x + 10, y, { width: labelWidth });
        const h = doc.heightOfString(label, { width: labelWidth });
        doc.fillColor(strong ? color : "#111").font("Bold").fontSize(strong ? 14 : 11).text(String(value), x + blockWidth - 54, y - (strong ? 2 : 0), { width: 44, align: "right" });
        y += Math.max(h, strong ? 16 : 12) + 7;
      }
    };
    block(0, RED, "Сахарный диабет 2 типа", [
      ["Диагноз СД поставлен врачом", t.dxDiabetes, true],
      [`Сахар ≥ ${dec(th.glucose)} ммоль/л (подозрение на СД)`, t.glucose, true],
      [`Предиабет: сахар ${dec(th.glucoseImpaired)}–6,9 ммоль/л`, t.glucoseImpaired],
      ["Преддиабет по диагнозу врача", t.dxPrediabetes],
      ["Назначены препараты от диабета", t.diabetesDrugs]
    ]);
    block(1, BLUE, "Артериальное давление", [
      ["Диагноз АГ поставлен врачом", t.dxHypertension, true],
      [`АД ≥ ${hs}/${hd} — гипертоническая болезнь (АГ 1 ст. и выше)`, t.bpHypertension, true],
      [`Выше ${es}/${ed}, но ниже ${hs}/${hd} — высокое нормальное`, t.bpHighNormal],
      [`Ровно ${es}/${ed}`, t.bpExact],
      ["Назначены препараты от давления", t.hypertensionDrugs]
    ]);
    block(2, AMBER, "Масса тела (ИМТ, ВОЗ)", [
      [`Избыточный вес: ИМТ ${th.bmiOverweight}–${dec(th.bmiObesity - 0.1)}`, t.overweight, true],
      [`Ожирение: ИМТ ≥ ${th.bmiObesity}`, t.obesity, true],
      [`  I степени (${th.bmiObesity}–${dec(th.bmiObesity2 - 0.1)})`, t.obesity1],
      [`  II степени (${th.bmiObesity2}–${dec(th.bmiObesity3 - 0.1)})`, t.obesity2],
      [`  III степени (≥ ${th.bmiObesity3})`, t.obesity3]
    ]);

    // Per-clinic table
    let y = blockTop + blockHeight + 16;
    const cols = [
      ["Поликлиника", 150, "clinic"], ["Анкет", 44, "screened"], [`Сахар ≥${dec(th.glucose)}`, 56, "glucose"], [`Предиабет ${dec(th.glucoseImpaired)}–6,9`, 62, "glucoseImpaired"],
      ["Диагноз СД", 50, "dxDiabetes"], [`Ровно ${es}/${ed}`, 52, "bpExact"], [`Выше ${es}/${ed}`, 54, "bpHighNormal"], [`АД ≥${hs}/${hd}`, 56, "bpHypertension"],
      ["Диагноз АГ", 50, "dxHypertension"], ["Избыт. вес", 54, "overweight"], ["Ожирение", 56, "obesity"], ["СД+АГ", 50, "both"]
    ];
    const strongKeys = new Set(["dxDiabetes", "dxHypertension", "glucose", "bpHypertension", "obesity"]);
    const header = () => {
      doc.rect(left, y, width, 24).fill("#dcece8");
      let x = left;
      doc.fillColor("#1f2a2e").font("Bold").fontSize(7.4);
      for (const [title, w] of cols) {
        doc.text(title, x + 3, y + 4, { width: w - 6, align: x === left ? "left" : "right" });
        x += w;
      }
      y += 24;
    };
    doc.fillColor("#111").font("Bold").fontSize(10.5).text("По поликлиникам", left, y);
    y += 15;
    header();
    const rows = [...report.rows, ...(report.rows.length > 1 ? [t] : [])];
    rows.forEach((r, index) => {
      if (y + 18 > bottom()) { doc.addPage(); y = doc.page.margins.top; header(); }
      const total = r === t;
      if (total) doc.rect(left, y, width, 18).fill("#eef5f3");
      else if (index % 2) doc.rect(left, y, width, 18).fill("#f7faf9");
      let x = left;
      for (const [, w, key] of cols) {
        doc.fillColor("#111").font(total || strongKeys.has(key) ? "Bold" : "Regular").fontSize(8.4)
          .text(String(r[key] ?? 0), x + 3, y + 5, { width: w - 6, align: key === "clinic" ? "left" : "right", lineBreak: false });
        x += w;
      }
      y += 18;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });
    if (!report.rows.length) { doc.fillColor(MUTED).font("Regular").fontSize(10).text("За выбранный период данных нет.", left, y + 8); y += 26; }

    // How it is counted
    const notes = [
      "• Считаются разные пациенты: повторные анкеты и осмотры одного пациента не удваивают число.",
      `• Скрининг (медсестра) — по дате анкеты; это подозрение, а не диагноз. Сахар ≥ ${dec(th.glucose)} ммоль/л — подозрение на СД (глюкометры откалиброваны по плазме), ${dec(th.glucoseImpaired)}–6,9 — предиабет. FINDRISC не учитывается.`,
      `• Давление — три группы без пересечений: ровно ${es}/${ed}; выше ${es}/${ed} (верхнее > ${es} или нижнее > ${ed}), но ниже ${hs}/${hd}; ${hs}/${hd} и выше (верхнее ≥ ${hs} или нижнее ≥ ${hd}). Давление ниже ${es}/${ed} в группы не входит.`,
      `• ИМТ — по ВОЗ; если пациента не взвешивали, ИМТ считается по весу Rabito (оценка). Анкеты без роста и веса в группы ИМТ не входят.`,
      "• Диагноз врача — по дате осмотра, из текста диагноза (русский или таджикский). Если у пациента был и преддиабет, и диабет — он учтён как диабет. Архивные анкеты не учитываются."
    ].join("\n");
    doc.font("Regular").fontSize(7.4);
    const notesHeight = doc.heightOfString(notes, { width, lineGap: 1.5 }) + 16;
    if (y + notesHeight > bottom()) { doc.addPage(); y = doc.page.margins.top; }
    doc.fillColor(MUTED).font("Bold").fontSize(8.2).text("Как считается", left, y + 10);
    doc.font("Regular").fontSize(7.4).text(notes, left, doc.y + 3, { width, lineGap: 1.5 });

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(MUTED).font("Regular").fontSize(8).text(`${clinicLabel} · стр. ${page + 1} из ${range.count}`, left, doc.page.height - 22, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
