// "Поиск медсестры" admin tab: find a nurse by any part of her name, then list the patients she added, newest
// first. Spellings of one nurse (х/ҳ, with or without patronymic) are merged with nurseNameKey, as in the
// nurse report; a search matches every spelling, so typos ("Мирзова") still come up for "мирз".
import { dushanbeDate, nurseNameKey } from "./nurse-report.js";

const tidy = (name) => String(name || "").trim().replace(/\s+/g, " ");
const clinicOf = (survey) => survey.patient?.clinic || survey.clinic || "";
const fold = (value) => String(value || "").toLocaleLowerCase("ru-RU").replace(/[ҳҷқғӣӯё]/g, (ch) => ({ "ҳ": "х", "ҷ": "ч", "қ": "к", "ғ": "г", "ӣ": "и", "ӯ": "у", "ё": "е" })[ch]);

function groupsOf(surveys) {
  const groups = new Map();
  for (const survey of surveys) {
    if (survey.archivedAt) continue;
    const name = tidy(survey.nurse?.fullName);
    if (!name) continue;
    const key = nurseNameKey(name) || fold(name);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key, spellings: new Map(), clinics: new Map(), surveys: [] }));
    group.spellings.set(name, (group.spellings.get(name) || 0) + 1);
    group.clinics.set(clinicOf(survey), (group.clinics.get(clinicOf(survey)) || 0) + 1);
    group.surveys.push(survey);
  }
  return groups;
}

const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

export function searchNurses(surveys, query, { limit = 50 } = {}) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const result = [];
  for (const group of groupsOf(surveys).values()) {
    const spellings = [...group.spellings.keys()].map(fold);
    if (!terms.every((term) => spellings.some((name) => name.includes(term)))) continue;
    const days = group.surveys.map((survey) => dushanbeDate(survey.createdAt)).filter(Boolean).sort();
    result.push({
      key: group.key,
      name: top(group.spellings)[0][0],
      spellings: top(group.spellings).map(([name, count]) => ({ name, count })),
      clinics: top(group.clinics).map(([clinic, count]) => ({ clinic, count })),
      surveys: group.surveys.length,
      needsDoctor: group.surveys.filter((survey) => survey.needsDoctor).length,
      activeDays: new Set(days).size,
      firstDate: days[0] || "",
      lastDate: days.at(-1) || ""
    });
  }
  return result.sort((a, b) => b.surveys - a.surveys).slice(0, limit);
}

// The nurse's patients, newest first. Only what the admin's own "Пациенты" tab already shows.
export function nurseHistory(surveys, key, { limit = 2000 } = {}) {
  const group = groupsOf(surveys).get(String(key || ""));
  if (!group) return null;
  const rows = [...group.surveys]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, limit)
    .map((survey) => {
      const patient = survey.patient || {};
      const m = survey.measurements || {};
      return {
        id: survey.id,
        createdAt: survey.createdAt || "",
        day: dushanbeDate(survey.createdAt),
        patientName: [patient.lastName, patient.firstName, patient.middleName].filter(Boolean).join(" "),
        birthDate: patient.birthDate || "",
        clinic: clinicOf(survey),
        nurseNameAsTyped: tidy(survey.nurse?.fullName),
        needsDoctor: Boolean(survey.needsDoctor),
        referralReasons: survey.referralReasons || [],
        systolic: m.systolic ?? null,
        diastolic: m.diastolic ?? null,
        glucose: m.glucoseLevel ?? null,
        findrisc: survey.findrisc?.score ?? null
      };
    });
  return {
    key: group.key,
    name: top(group.spellings)[0][0],
    spellings: top(group.spellings).map(([name, count]) => ({ name, count })),
    clinics: top(group.clinics).map(([clinic, count]) => ({ clinic, count })),
    total: group.surveys.length,
    needsDoctor: group.surveys.filter((survey) => survey.needsDoctor).length,
    rows
  };
}
