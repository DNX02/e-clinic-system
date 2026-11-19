// How many people were found with (suspected or diagnosed) type 2 diabetes and arterial hypertension.
// Doctor counts come from the diagnosis text of saved exams, in Russian or Tajik. Every count is of
// distinct patients.
//
// Screening thresholds for THIS REPORT ONLY, decided by the owner (19-20.11.2026) after the clinic doctor:
//   - glucose >= 7.0 mmol/l = suspected diabetes (the clinics' glucometers are calibrated to plasma);
//     6.1-6.9 = prediabetes, counted separately;
//   - blood pressure in three bands that do not overlap: exactly 130/80; above 130/80 but below 140/90
//     ("high normal"); 140/90 and above (hypertension, grade 1 or higher);
//   - body mass index (WHO): overweight 25-29.9, obesity >= 30 (grades I 30-34.9, II 35-39.9, III >= 40);
//   - FINDRISC is not used.
// Referral to a doctor in the survey itself still follows CLAUDE.md §4 and was NOT changed.
import { dushanbeDate } from "./nurse-report.js";

export const THRESHOLDS = {
  glucose: 7.0, glucoseImpaired: 6.1,
  bpExact: [130, 80], bpHypertension: [140, 90],
  bmiOverweight: 25, bmiObesity: 30, bmiObesity2: 35, bmiObesity3: 40
};

// The form computes BMI for a weighed patient; with the Rabito estimate it may be missing, so derive it.
export function bmiOf(measurements = {}) {
  const stored = Number(measurements.bmi || 0);
  if (stored > 0) return stored;
  const height = Number(measurements.height || 0) / 100;
  const weight = Number(measurements.weight || 0) || Number(measurements.rabitoWeight || 0);
  const bmi = height > 0 && weight > 0 ? weight / (height * height) : 0;
  return bmi >= 10 && bmi <= 80 ? Number(bmi.toFixed(1)) : 0;
}

export function pressureBand(systolic, diastolic) {
  const s = Number(systolic || 0);
  const d = Number(diastolic || 0);
  if (!s && !d) return "";
  const [hs, hd] = THRESHOLDS.bpHypertension;
  const [es, ed] = THRESHOLDS.bpExact;
  if (s >= hs || d >= hd) return "hypertension";
  if (s > es || d > ed) return "highNormal";
  if (s === es && d === ed) return "exact";
  return "";
}

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
      clinic: name, screened: new Set(), glucose: new Set(), glucoseImpaired: new Set(),
      bpExact: new Set(), bpHighNormal: new Set(), bpHypertension: new Set(), both: new Set(),
      bmiKnown: new Set(), overweight: new Set(), obesity: new Set(), obesity1: new Set(), obesity2: new Set(), obesity3: new Set(),
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
    if (sugar) r.glucose.add(survey.id);
    if (glucose >= THRESHOLDS.glucoseImpaired && !sugar) r.glucoseImpaired.add(survey.id);
    const band = pressureBand(m.systolic, m.diastolic);
    if (band === "exact") r.bpExact.add(survey.id);
    if (band === "highNormal") r.bpHighNormal.add(survey.id);
    if (band === "hypertension") r.bpHypertension.add(survey.id);
    if (sugar && band === "hypertension") r.both.add(survey.id);
    const bmi = bmiOf(m);
    if (bmi > 0) r.bmiKnown.add(survey.id);
    if (bmi >= THRESHOLDS.bmiOverweight && bmi < THRESHOLDS.bmiObesity) r.overweight.add(survey.id);
    if (bmi >= THRESHOLDS.bmiObesity) {
      r.obesity.add(survey.id);
      r[bmi >= THRESHOLDS.bmiObesity3 ? "obesity3" : bmi >= THRESHOLDS.bmiObesity2 ? "obesity2" : "obesity1"].add(survey.id);
    }
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

  const KEYS = ["screened", "glucose", "glucoseImpaired", "bpExact", "bpHighNormal", "bpHypertension", "both",
    "bmiKnown", "overweight", "obesity", "obesity1", "obesity2", "obesity3", "dxDiabetes", "dxPrediabetes", "dxHypertension", "diabetesDrugs", "hypertensionDrugs"];
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
