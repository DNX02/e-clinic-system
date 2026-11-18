// Checks one row of a patient CSV import before it becomes a survey.
// The old import silently filled gaps (sex "female", every FINDRISC answer "no", nurse "Импорт из файла",
// any text as a clinic), which produced wrong risk scores. Now a missing or unreadable answer is an error
// for that row, and every problem of the row is listed at once so the file can be fixed in one pass.

const YES = new Set(["yes", "y", "да", "д", "ҳа", "ха", "ha", "+", "1", "true", "есть", "имеется"]);
const NO = new Set(["no", "n", "нет", "н", "не", "-", "—", "–", "0", "false", "отсутствует"]);
const VALID_CLINICS = Array.from({ length: 15 }, (_, i) => i + 1).filter((n) => ![3, 5, 6, 8, 13].includes(n));

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

function yesNo(value) {
  const v = lower(value);
  if (YES.has(v)) return "yes";
  if (NO.has(v)) return "no";
  return null;
}

function sexOf(value) {
  const v = lower(value);
  if (["male", "m", "м", "муж", "мужской", "мард"].includes(v)) return "male";
  if (["female", "f", "ж", "жен", "женский", "зан"].includes(v)) return "female";
  return null;
}

function familyOf(value) {
  const v = lower(value);
  if (["none", ...NO].includes(v)) return "none";
  if (["first", "1", "1 линия", "первая", "первая линия", "да, 1 линия", "родители", "родители/дети"].includes(v)) return "first";
  if (["second", "2", "2 линия", "вторая", "вторая линия", "да, 2 линия", "дальние", "дальние родственники"].includes(v)) return "second";
  return null;
}

function clinicOf(value) {
  const number = Number(text(value).match(/\d+/)?.[0] || 0);
  return VALID_CLINICS.includes(number) ? `Поликлиника №${number}` : null;
}

function ageFrom(birthDate, today = new Date()) {
  const match = text(birthDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const [year, month, day] = match.slice(1).map(Number);
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age -= 1;
  return age;
}

// "05.11.1964" and "5/11/1964" are what Excel usually writes; the form needs 1964-11-05.
function isoDate(value) {
  const v = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const match = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : v;
}

const ANSWERS = [
  ["activity", "Физическая активность"],
  ["vegetables", "Овощи/фрукты ежедневно"],
  ["bpMeds", "Препараты от давления"],
  ["highGlucose", "Высокий сахар когда-либо"],
  ["smoker", "Курение"]
];

export function normalizeImportRow(row, { today = new Date() } = {}) {
  const problems = [];
  const out = { ...row };
  out.birthDate = isoDate(row.birthDate);

  const sex = sexOf(row.sex);
  if (!sex) problems.push(`Пол: ${text(row.sex) ? `«${text(row.sex)}» не понят` : "не указан"} (м/ж)`);
  out.sex = sex;

  const clinic = clinicOf(row.clinic);
  if (!clinic) problems.push(`Поликлиника: ${text(row.clinic) ? `«${text(row.clinic)}» нет в системе` : "не указана"}`);
  out.clinic = clinic;

  if (text(row.nurseName).split(/\s+/).filter(Boolean).length < 2) problems.push("Медсестра: укажите фамилию и имя");
  out.nurseName = text(row.nurseName);

  for (const [field, label] of ANSWERS) {
    const answer = yesNo(row[field]);
    if (!answer) problems.push(`${label}: ${text(row[field]) ? `«${text(row[field])}» не понято` : "не указано"} (да/нет)`);
    out[field] = answer;
  }
  const family = familyOf(row.familyDiabetes);
  if (!family) problems.push(`Диабет у родственников: ${text(row.familyDiabetes) ? `«${text(row.familyDiabetes)}» не понято` : "не указано"} (нет / 1 линия / 2 линия)`);
  out.familyDiabetes = family;

  out.age = Number(text(row.age).replace(",", ".")) || ageFrom(out.birthDate, today);
  for (const field of ["weight", "height", "rabitoWaist", "arm", "calf", "systolic", "diastolic", "glucoseLevel"]) {
    out[field] = text(row[field]) === "" ? undefined : text(row[field]).replace(",", ".");
  }
  if (problems.length) {
    const error = new Error(problems.join("; "));
    error.statusCode = 400;
    throw error;
  }
  return out;
}
