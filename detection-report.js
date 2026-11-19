// How many people were found with (suspected or diagnosed) type 2 diabetes and arterial hypertension.
// Doctor counts come from the diagnosis text of saved exams, in Russian or Tajik. Every count is of
// distinct patients.
//
// Screening thresholds for THIS REPORT ONLY, decided by the owner on 19.11.2026 after the clinic doctor:
//   - glucose >= 7.0 mmol/l = suspected diabetes (the clinics' glucometers are calibrated to plasma;
//     6.1-6.9 is shown separately as impaired glycaemia);
//   - blood pressure strictly above 130/80 (systolic > 130 or diastolic > 80) = suspected hypertension;
//   - FINDRISC is not used.
// Referral to a doctor in the survey itself still follows CLAUDE.md §4 and was NOT changed.
import { dushanbeDate } from "./nurse-report.js";

export const THRESHOLDS = { glucose: 7.0, glucoseImpaired: 6.1, systolicAbove: 130, diastolicAbove: 80 };

const NOT_LETTER = "[^a-zа-яёҳҷқғӣӯ]";
const PREDIABETES = /пред+иабет|пешдиабет|нарушени\S* толерантност|\bнтг\b/i;
const HYPERTENSION = new RegExp(`гипертенз|гипертони|фишорбаланд|фишори\\s+баланд|(^|${NOT_LETTER})аг(${NOT_LETTER}|$)`, "i");

export function diagnosisFlags(text) {
  const value = String(text || "").toLocaleLowerCase("ru-RU");
  const prediabetes = PREDIABETES.test(value);
  const withoutPre = value.replace(new RegExp(PREDIABETES.source, "gi"), " ");
  const diabetes = /диабет/.test(withoutPre) || new RegExp(`(^|${NOT_LETTER})сд(${NOT_LETTER}|\\d|$)`).test(withoutPre);
  return { diabetes, prediabetes: prediabetes && !diabetes, hypertension: HYPERTENSION.test(value) };
}

export function buildDetectionReport(surveys, visits, { clinic = "all", from = "", to = "", clinicKey = (value) => String(value || "") } = {}) {
  const clinicOf = (survey) => survey?.patient?.clinic || survey?.clinic || "";
  const active = (surveys || []).filter((survey) => !survey.archivedAt);
  const surveysById = new Map(active.map((survey) => [survey.id, survey]));
  const inClinic = (survey) => clinic === "all" || clinicKey(clinicOf(survey)) === clinicKey(clinic);
  const inPeriod = (iso) => {
    const day = dushanbeDate(iso);
    return (!from || (day && day >= from)) && (!to || (day && day <= to));
  };
  const clinics = [...new Set(active.map(clinicOf).filter(Boolean))].sort((a, b) => clinicKey(a).localeCompare(clinicKey(b), "ru", { numeric: true }));

  const rows = new Map();
  const row = (name) => {
    if (!rows.has(name)) rows.set(name, {
      clinic: name, screened: new Set(), glucose: new Set(), glucoseImpaired: new Set(), pressure: new Set(), both: new Set(),
      dxDiabetes: new Set(), dxPrediabetes: new Set(), dxHypertension: new Set(), diabetesDrugs: new Set(), hypertensionDrugs: new Set()
    });
    return rows.get(name);
  };

  // 1. Screening by nurses (date of the survey).
  for (const survey of active) {
    if (!inClinic(survey) || !inPeriod(survey.createdAt)) continue;
    const r = row(clinicOf(survey) || "Не указано");
    const m = survey.measurements || {};
    r.screened.add(survey.id);
    const glucose = Number(m.glucoseLevel || 0);
    const sugar = glucose >= THRESHOLDS.glucose;
    const pressure = Number(m.systolic || 0) > THRESHOLDS.systolicAbove || Number(m.diastolic || 0) > THRESHOLDS.diastolicAbove;
    if (sugar) r.glucose.add(survey.id);
    if (glucose >= THRESHOLDS.glucoseImpaired && !sugar) r.glucoseImpaired.add(survey.id);
    if (pressure) r.pressure.add(survey.id);
    if (sugar && pressure) r.both.add(survey.id);
  }

  // 2. Doctors' exams (date of the exam), counted per patient.
  for (const visit of visits || []) {
    const survey = surveysById.get(visit.surveyId);
    if (!survey || !inClinic(survey) || !inPeriod(visit.createdAt)) continue;
    const r = row(clinicOf(survey) || "Не указано");
    const flags = diagnosisFlags(visit.diagnosis);
    if (flags.diabetes) r.dxDiabetes.add(survey.id);
    if (flags.prediabetes) r.dxPrediabetes.add(survey.id);
    if (flags.hypertension) r.dxHypertension.add(survey.id);
    if ((visit.diabetesDrugs || []).length) r.diabetesDrugs.add(survey.id);
    if ((visit.hypertensionDrugs || []).length) r.hypertensionDrugs.add(survey.id);
  }
  // A patient diagnosed with diabetes in one exam and prediabetes in another counts as diabetes.
  for (const r of rows.values()) for (const id of r.dxDiabetes) r.dxPrediabetes.delete(id);

  const KEYS = ["screened", "glucose", "glucoseImpaired", "pressure", "both", "dxDiabetes", "dxPrediabetes", "dxHypertension", "diabetesDrugs", "hypertensionDrugs"];
  const list = [...rows.values()]
    .sort((a, b) => clinicKey(a.clinic).localeCompare(clinicKey(b.clinic), "ru", { numeric: true }))
    .map((r) => ({ clinic: r.clinic, ...Object.fromEntries(KEYS.map((key) => [key, r[key].size])) }));
  const totals = { clinic: "Итого", ...Object.fromEntries(KEYS.map((key) => [key, list.reduce((sum, r) => sum + r[key], 0)])) };
  return {
    filters: { clinic, from, to },
    thresholds: THRESHOLDS,
    clinics,
    totals,
    rows: list
  };
}
