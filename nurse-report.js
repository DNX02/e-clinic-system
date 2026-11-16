// Nurse activity report: how many screening surveys each nurse sent, per clinic and period.
// Nurses type their own name on every survey, so one person shows up in several spellings
// ("Гулмаҳмадова Шодигул" / "Гулмахмадова Шодигул", "Кодирова Озода Бегмуродовна" / "Кодирова Озода",
// "Увайтова Г" / "Увайтова Гулчехра"). Spellings are merged by a normalised surname + first name;
// a bare initial is merged only when exactly one full name in the same clinic matches it.
// Real typos ("Мирзова" for "Мирзоева") are not guessed: every row lists its spellings so the admin sees them.

const TAJIK_TO_RUSSIAN = { "ҳ": "х", "ҷ": "ч", "қ": "к", "ғ": "г", "ӣ": "и", "ӯ": "у", "ё": "е" };
const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;
export const NO_NURSE_NAME = "ФИО медсестры не указано";
export const ADDED_BY_DOCTOR = "Добавлено врачом";

export function dushanbeDate(iso) {
  const time = Date.parse(iso || "");
  return Number.isFinite(time) ? new Date(time + DUSHANBE_OFFSET_MS).toISOString().slice(0, 10) : "";
}

function tokens(name) {
  return String(name || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[ҳҷқғӣӯё]/g, (ch) => TAJIK_TO_RUSSIAN[ch])
    .replace(/[^a-zа-я\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function nurseNameKey(name) {
  return tokens(name).slice(0, 2).join(" ");
}

const tidy = (name) => String(name || "").trim().replace(/\s+/g, " ");

export function buildNurseReport(surveys, { clinic = "all", from = "", to = "", clinicKey = (value) => String(value || "") } = {}) {
  const inScope = (surveys || []).filter((survey) => !survey.archivedAt);
  const clinicOf = (survey) => survey.patient?.clinic || survey.clinic || "";
  const clinics = [...new Set(inScope.map(clinicOf).filter(Boolean))]
    .sort((a, b) => clinicKey(a).localeCompare(clinicKey(b), "ru", { numeric: true }));
  const selected = inScope.filter((survey) => {
    if (clinic !== "all" && clinicKey(clinicOf(survey)) !== clinicKey(clinic)) return false;
    const day = dushanbeDate(survey.createdAt);
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    return true;
  });

  // 1. Group by clinic + normalised name.
  const groups = new Map();
  for (const survey of selected) {
    const raw = tidy(survey.nurse?.fullName);
    const label = raw || (survey.createdByDoctorId ? ADDED_BY_DOCTOR : NO_NURSE_NAME);
    const key = raw ? nurseNameKey(raw) || label : `special:${label}`;
    const groupKey = `${clinicKey(clinicOf(survey))}|${key}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { key, clinicKey: clinicKey(clinicOf(survey)), clinic: clinicOf(survey), special: !raw, surveys: [] };
      groups.set(groupKey, group);
    }
    group.surveys.push({ survey, label });
  }

  // 2. Merge "Фамилия И" / "Фамилия" into the single full name in the same clinic that matches.
  for (const [groupKey, group] of [...groups]) {
    if (group.special) continue;
    const [surname, first = ""] = group.key.split(" ");
    if (first.length > 1) continue;
    const candidates = [...groups.values()].filter((other) => other !== group && !other.special && other.clinicKey === group.clinicKey
      && other.key.split(" ")[0] === surname && (other.key.split(" ")[1] || "").length > 1 && (other.key.split(" ")[1] || "").startsWith(first));
    if (candidates.length === 1) {
      candidates[0].surveys.push(...group.surveys);
      groups.delete(groupKey);
    }
  }

  const rows = [];
  const byDay = new Map();
  for (const group of groups.values()) {
    const spellings = new Map();
    for (const { label } of group.surveys) spellings.set(label, (spellings.get(label) || 0) + 1);
    const variants = [...spellings.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([name, count]) => ({ name, count }));
    const name = variants[0].name;
    const days = group.surveys.map(({ survey }) => dushanbeDate(survey.createdAt)).filter(Boolean).sort();
    rows.push({
      name,
      special: group.special,
      clinic: group.clinic,
      surveys: group.surveys.length,
      needsDoctor: group.surveys.filter(({ survey }) => survey.needsDoctor).length,
      activeDays: new Set(days).size,
      firstDate: days[0] || "",
      lastDate: days.at(-1) || "",
      variants: variants.length > 1 ? variants : []
    });
    for (const { survey } of group.surveys) {
      const day = dushanbeDate(survey.createdAt);
      const key = `${day}|${group.clinic}|${name}`;
      const item = byDay.get(key) || { date: day, clinic: group.clinic, name, surveys: 0, needsDoctor: 0 };
      item.surveys += 1;
      if (survey.needsDoctor) item.needsDoctor += 1;
      byDay.set(key, item);
    }
  }
  rows.sort((a, b) => Number(a.special) - Number(b.special) || b.surveys - a.surveys || a.name.localeCompare(b.name, "ru"));

  return {
    filters: { clinic, from, to },
    clinics,
    totals: {
      surveys: selected.length,
      needsDoctor: selected.filter((survey) => survey.needsDoctor).length,
      nurses: rows.filter((row) => !row.special).length,
      withoutName: rows.filter((row) => row.special).reduce((sum, row) => sum + row.surveys, 0)
    },
    rows,
    byDay: [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date) || b.surveys - a.surveys)
  };
}
