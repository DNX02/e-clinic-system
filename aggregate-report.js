// Aggregate numbers for the owner's reporting assistant (GET /api/reports/aggregate, token-protected).
// Only counts: no patient names, phones, birth dates or ids ever leave this module. Nurse names (staff)
// appear in the per-nurse activity, as in the admin "Медсёстры" report.
import { buildDetectionReport } from "./detection-report.js";
import { buildNurseReport, dushanbeDate } from "./nurse-report.js";

export function buildAggregateReport(db, { clinic = "all", from = "", to = "", clinicKey, isExcludedClinic, patientIdentity }) {
  const clinicOf = (survey) => survey.patient?.clinic || survey.clinic || "";
  const active = (db.nurseSurveys || []).filter((survey) => !survey.archivedAt);
  const excluded = active.filter((survey) => isExcludedClinic(clinicOf(survey)));
  const surveys = active.filter((survey) => !isExcludedClinic(clinicOf(survey)));
  const inClinic = (survey) => clinic === "all" || clinicKey(clinicOf(survey)) === clinicKey(clinic);
  const inPeriod = (iso) => {
    const day = dushanbeDate(iso);
    return (!from || (day && day >= from)) && (!to || (day && day <= to));
  };
  const selected = surveys.filter((survey) => inClinic(survey) && inPeriod(survey.createdAt));
  const selectedIds = new Set(selected.map((survey) => survey.id));
  const surveysById = new Map(surveys.map((survey) => [survey.id, survey]));
  const visits = (db.doctorVisits || []).filter((visit) => {
    const survey = surveysById.get(visit.surveyId);
    return survey && inClinic(survey) && inPeriod(visit.createdAt);
  });
  const hasDrugs = (visit) => (visit.diabetesDrugs || []).length + (visit.hypertensionDrugs || []).length > 0;
  const unique = (list) => new Set(list.map((survey) => patientIdentity(survey.patient || {}))).size;
  const referred = selected.filter((survey) => survey.needsDoctor);
  const visitedPatients = new Set(visits.map((visit) => visit.surveyId));
  const treatedPatients = new Set(visits.filter(hasDrugs).map((visit) => visit.surveyId));

  const byDay = new Map();
  for (const survey of selected) {
    const day = dushanbeDate(survey.createdAt);
    const row = byDay.get(day) || { date: day, surveys: 0, referred: 0 };
    row.surveys += 1;
    if (survey.needsDoctor) row.referred += 1;
    byDay.set(day, row);
  }
  const perClinic = new Map();
  for (const survey of selected) {
    const name = clinicOf(survey) || "Не указано";
    const row = perClinic.get(name) || { clinic: name, surveys: 0, referred: 0, list: [] };
    row.surveys += 1;
    if (survey.needsDoctor) row.referred += 1;
    row.list.push(survey);
    perClinic.set(name, row);
  }
  const detection = buildDetectionReport(surveys, db.doctorVisits || [], { clinic, from, to, clinicKey });
  const nurses = buildNurseReport(surveys, { clinic, from, to, clinicKey });

  return {
    generatedAt: new Date().toISOString(),
    filters: { clinic, from, to, timezone: "Asia/Dushanbe" },
    screening: {
      surveys: selected.length,
      uniquePatients: unique(selected),
      referredSurveys: referred.length,
      referredPatients: unique(referred),
      referredWithDoctorVisit: referred.filter((survey) => visitedPatients.has(survey.id)).length
    },
    doctors: {
      visits: visits.length,
      patientsWithVisit: visitedPatients.size,
      patientsWithDrugs: treatedPatients.size,
      visitsOfPatientsScreenedInPeriod: visits.filter((visit) => selectedIds.has(visit.surveyId)).length
    },
    detection: { thresholds: detection.thresholds, totals: detection.totals, byClinic: detection.rows },
    byClinic: [...perClinic.values()]
      .sort((a, b) => clinicKey(a.clinic).localeCompare(clinicKey(b.clinic), "ru", { numeric: true }))
      .map(({ list, ...row }) => ({ ...row, uniquePatients: unique(list) })),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    nurses: nurses.rows.map(({ name, clinic: nurseClinic, surveys: count, needsDoctor, activeDays, firstDate, lastDate }) => ({ name, clinic: nurseClinic, surveys: count, needsDoctor, activeDays, firstDate, lastDate })),
    excludedClinics: { surveys: excluded.length, note: "Поликлиники №3, 5, 6, 8, 13 исключены из системы и не входят в цифры выше" }
  };
}
