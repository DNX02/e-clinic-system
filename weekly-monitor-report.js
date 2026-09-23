import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  HeadingLevel,
  InternalHyperlink,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";

const CONTENT_WIDTH = 9360;
const GREEN = "0F4C45";
const INK = "1F2937";

export function monitorReportPeriod(filters = {}, now = new Date()) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (isoDate.test(filters.from || "") && isoDate.test(filters.to || "") && filters.from <= filters.to) {
    return { from: filters.from, to: filters.to };
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thisMonday = new Date(today);
  thisMonday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const previousMonday = new Date(thisMonday);
  previousMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const previousSaturday = new Date(previousMonday);
  previousSaturday.setUTCDate(previousMonday.getUTCDate() + 5);
  return {
    from: previousMonday.toISOString().slice(0, 10),
    to: previousSaturday.toISOString().slice(0, 10)
  };
}

function reportDays(from, to) {
  const result = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function dateLabel(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  });
}

function anchorFor(clinic) {
  return `clinic_${String(clinic).replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, "_")}`;
}

function paragraph(text, options = {}) {
  return new Paragraph({
    heading: options.heading,
    pageBreakBefore: options.pageBreakBefore,
    alignment: options.alignment,
    spacing: { before: options.before ?? 0, after: options.after ?? 120, line: 264, lineRule: "auto" },
    children: [new TextRun({
      text: String(text ?? ""),
      font: "Arial",
      size: options.size ?? 22,
      bold: options.bold,
      color: options.color || INK
    })]
  });
}

function cell(content, width, options = {}) {
  const children = Array.isArray(content) ? content : [new Paragraph({
    alignment: options.alignment,
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
    children: [new TextRun({
      text: String(content ?? ""),
      font: "Arial",
      size: options.size || 19,
      bold: options.header || options.bold,
      color: options.header ? GREEN : INK
    })]
  })];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: options.header ? { type: ShadingType.CLEAR, fill: "E6F3EF" } : undefined,
    borders: Object.fromEntries(["top", "bottom", "left", "right"].map((side) => [side, { style: BorderStyle.SINGLE, size: 4, color: "CFE2DA" }])),
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children
  });
}

function table(headers, rows, widths) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((value, index) => cell(value, widths[index], { header: true, alignment: index ? AlignmentType.CENTER : AlignmentType.LEFT })) }),
      ...rows.map((row) => new TableRow({ children: row.map((value, index) => cell(value, widths[index], { alignment: index ? AlignmentType.CENTER : AlignmentType.LEFT })) }))
    ]
  });
}

function metric(label, value) {
  return cell([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 35 }, children: [new TextRun({ text: Number(value || 0).toLocaleString("ru-RU"), font: "Arial", size: 30, bold: true, color: GREEN })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: label, font: "Arial", size: 18, color: "64748B" })] })
  ], 4680);
}

export async function buildWeeklyMonitorReportDocx(db, period, helpers) {
  const { surveyRows, visitRows, eventRows } = helpers.buildRows(db);
  const days = reportDays(period.from, period.to);
  const inPeriod = (value) => {
    const day = helpers.dateKey(value);
    return day >= period.from && day <= period.to;
  };
  const surveys = surveyRows.filter((row) => inPeriod(row.createdAt));
  const visits = visitRows.filter((row) => inPeriod(row.createdAt));
  const views = eventRows.filter((row) => row.type === "doctor_survey_viewed" && inPeriod(row.createdAt));
  const clinics = [...new Set([...surveys, ...visits, ...views].map((row) => row.clinic))]
    .filter(Boolean)
    .sort((a, b) => helpers.clinicKey(a).localeCompare(helpers.clinicKey(b), "ru"));
  const stats = clinics.map((clinic) => {
    const dayStats = days.map((day) => {
      const daySurveys = surveys.filter((row) => row.clinic === clinic && helpers.dateKey(row.createdAt) === day);
      const dayVisits = visits.filter((row) => row.clinic === clinic && helpers.dateKey(row.createdAt) === day);
      return {
        day,
        surveys: daySurveys.length,
        needsDoctor: daySurveys.filter((row) => row.needsDoctor).length,
        views: views.filter((row) => row.clinic === clinic && helpers.dateKey(row.createdAt) === day).length,
        visits: dayVisits.length,
        actions: dayVisits.filter((row) => row.hasAction).length
      };
    });
    const sum = (key) => dayStats.reduce((total, row) => total + row[key], 0);
    return { clinic, dayStats, surveys: sum("surveys"), needsDoctor: sum("needsDoctor"), views: sum("views"), visits: sum("visits"), actions: sum("actions") };
  });
  const total = (key) => stats.reduce((sum, row) => sum + row[key], 0);
  const nurseStatsMap = new Map();
  for (const row of surveys) {
    const day = helpers.dateKey(row.createdAt);
    const key = `${day}||${row.clinic}||${row.nurseName}`;
    const item = nurseStatsMap.get(key) || { day, clinic: row.clinic, nurseName: row.nurseName, surveys: 0, needsDoctor: 0 };
    item.surveys += 1;
    if (row.needsDoctor) item.needsDoctor += 1;
    nurseStatsMap.set(key, item);
  }
  const nurseStats = [...nurseStatsMap.values()].sort((a, b) =>
    a.day.localeCompare(b.day) || helpers.clinicKey(a.clinic).localeCompare(helpers.clinicKey(b.clinic), "ru") || a.nurseName.localeCompare(b.nurseName, "ru")
  );
  const children = [
    paragraph("Недельный отчет по работе поликлиник", { heading: HeadingLevel.TITLE, size: 34, bold: true, color: GREEN, after: 100 }),
    paragraph(`Период: ${dateLabel(period.from)} - ${dateLabel(period.to)}`, { bold: true, color: "31524D" }),
    paragraph(`Источник: приложение №7 «Экран наблюдения». Сформировано: ${new Date().toLocaleString("ru-RU")}.`, { size: 19, color: "64748B", after: 220 }),
    paragraph("Краткая сводка", { heading: HeadingLevel.HEADING_1, size: 28, bold: true, color: GREEN, before: 120 }),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [4680, 4680],
      rows: [
        new TableRow({ children: [metric("Анкет зарегистрировано", total("surveys")), metric("Направлено к врачу", total("needsDoctor"))] }),
        new TableRow({ children: [metric("Карт открыли врачи", total("views")), metric("Осмотров с действиями", total("actions"))] })
      ]
    }),
    paragraph("Сводка по поликлиникам", { heading: HeadingLevel.HEADING_1, size: 28, bold: true, color: GREEN, before: 240 }),
    paragraph("Нажмите на название поликлиники, чтобы перейти к детализации по дням.", { size: 20, color: "64748B" }),
    table(
      ["Поликлиника", "Анкет", "Открыто карт", "С действиями"],
      stats.map((row) => [[new Paragraph({ spacing: { before: 0, after: 0 }, children: [new InternalHyperlink({ anchor: anchorFor(row.clinic), children: [new TextRun({ text: row.clinic, font: "Arial", size: 19, bold: true, color: "0F766E", underline: {} })] })] })], row.surveys, row.views, row.actions]),
      [3600, 1800, 1980, 1980]
    ),
    paragraph("Работа медсестёр по дням", { heading: HeadingLevel.HEADING_1, size: 28, bold: true, color: GREEN, before: 240 }),
    paragraph("Количество заполненных анкет и направлений к врачу по каждой медсестре.", { size: 20, color: "64748B" }),
    table(
      ["Дата", "Поликлиника", "Медсестра", "Осмотрено", "К врачу"],
      nurseStats.map((row) => [dateLabel(row.day), row.clinic, row.nurseName, row.surveys, row.needsDoctor]),
      [1500, 2000, 2860, 1500, 1500]
    ),
    paragraph("Детализация по дням", { heading: HeadingLevel.HEADING_1, size: 28, bold: true, color: GREEN, before: 280 })
  ];
  for (const [index, row] of stats.entries()) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      pageBreakBefore: index > 0,
      spacing: { before: 160, after: 110 },
      children: [new Bookmark({ id: anchorFor(row.clinic), children: [new TextRun({ text: row.clinic, font: "Arial", size: 27, bold: true, color: GREEN })] })]
    }));
    children.push(paragraph(`За период: ${row.surveys} анкет, ${row.views} открытий карт врачами, ${row.visits} сохраненных осмотров, ${row.actions} осмотров с действиями.`, { size: 20, bold: true, color: "31524D" }));
    children.push(table(["Дата", "Анкет", "Открыто карт", "С действиями"], row.dayStats.map((day) => [dateLabel(day.day), day.surveys, day.views, day.actions]), [3600, 1800, 1980, 1980]));
  }
  if (!stats.length) children.push(paragraph("За выбранный период в системе нет анкет, просмотров карт или сохраненных осмотров.", { bold: true, color: "9B1C1C" }));
  children.push(paragraph("Примечание", { heading: HeadingLevel.HEADING_1, size: 28, bold: true, color: GREEN, before: 260 }));
  children.push(paragraph("Раздел «Работа медсестёр по дням» формируется по ФИО, указанному при заполнении анкеты. «Открыто карт» показывает зафиксированные открытия анкет врачами, а «С действиями» - осмотры с назначением, планом лечения, лабораторией, направлением или повторным обследованием."));
  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22, color: INK }, paragraph: { spacing: { after: 120, line: 264, lineRule: "auto" } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 34, bold: true, color: GREEN }, paragraph: { spacing: { before: 0, after: 100 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 28, bold: true, color: GREEN }, paragraph: { spacing: { before: 240, after: 110 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 27, bold: true, color: GREEN }, paragraph: { spacing: { before: 160, after: 110 }, keepNext: true } }
      ]
    },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080, header: 708, footer: 708 } } }, children }]
  });
  return Packer.toBuffer(doc);
}
