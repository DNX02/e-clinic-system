import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, readdir, unlink } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { labHasResult, patientChanges, waitingPatients, verifyBackupRestore } from './care-workflow.js';
import PDFDocument from "pdfkit";
import { buildWeeklyMonitorReportDocx, monitorReportPeriod } from "./weekly-monitor-report.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(__dirname, "data");
const dbPath = join(dataDir, "db.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PG_TIMEOUT_MS = Number(process.env.PG_TIMEOUT_MS || 8000);
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "";
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_REPORT_CHAT_ID = process.env.TELEGRAM_REPORT_CHAT_ID || "";
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || "";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 1024 * 1024);
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 60 * 1000;
const ADMIN_APP_PATH = "/app-1-admin-panel";
const DOCTOR_APP_PATH = "/app-2-doctor";
const SURVEY_APP_PATH = "/app-3-patient-survey";
const TRAINING_APP_PATH = "/app-4-doctor-knowledge";
const NURSE_TRAINING_APP_PATH = "/app-5-nurse-knowledge";
const INVESTOR_APP_PATH = "/app-6-investor-dashboard";
const MONITOR_APP_PATH = "/app-7-operations-monitor";
const DIABETES_APP_PATH = "/app-8-diabetes-risk";
let dbCache = null;
let dbLoadPromise = null;
let dbWritePromise = Promise.resolve();
let dbReadyPromise = null;
let pgPoolPromise = null;
const rateLimits = new Map();
let googleAccessToken = "";
let googleAccessTokenExpiresAt = 0;
const normalizedCollectionTables = {
  admins: "app_admins",
  doctors: "app_doctors",
  nurseSurveys: "app_nurse_surveys",
  doctorVisits: "app_doctor_visits",
  trainingParticipants: "app_training_participants",
  trainingAttempts: "app_training_attempts",
  nurseTrainingParticipants: "app_nurse_training_participants",
  nurseTrainingAttempts: "app_nurse_training_attempts",
  patientTasks: "app_patient_tasks",
  appointments: "app_appointments",
  reminderQueue: "app_reminder_queue",
  messageEvents: "app_message_events",
  activityEvents: "app_activity_events"
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".mp4": "video/mp4"
};

const seedAdmins = [
  { id: "admin-main", name: "Главный администратор", username: "admin", role: "owner" }
];

const adminRoles = {
  owner: "Главный администратор",
  manager: "Администратор",
  head_nurse: "Старшая медсестра",
  observer: "Наблюдатель"
};

const diabetesDrugs = [
  "Метформин 500 мг 1 раз в день",
  "Метформин 500 мг 2 раза в день",
  "Метформин 850 мг 2 раза в день",
  "Метформин 1000 мг 2 раза в день",
  "Гликлазид МВ 30 мг",
  "Гликлазид МВ 60 мг",
  "Глимепирид 1 мг",
  "Глимепирид 2 мг",
  "Глимепирид 4 мг",
  "Ситаглиптин 100 мг",
  "Вилдаглиптин 50 мг 2 раза в день",
  "Линаглиптин 5 мг",
  "Саксаглиптин 5 мг"
];

const hypertensionDrugs = [
  "Эналаприл 5 мг 2 раза в день",
  "Эналаприл 10 мг 2 раза в день",
  "Периндоприл 5 мг",
  "Периндоприл 10 мг",
  "Лозартан 50 мг",
  "Лозартан 100 мг",
  "Валсартан 80 мг",
  "Валсартан 160 мг",
  "Амлодипин 5 мг",
  "Амлодипин 10 мг",
  "Индапамид 1,5 мг",
  "Гидрохлортиазид 12,5 мг",
  "Бисопролол 2,5 мг",
  "Бисопролол 5 мг"
];

const preTestQuestions = [
  {
    id: 1,
    text: "Основной механизм развития СД2 включает:",
    options: { A: "Абсолютный дефицит инсулина с первого дня заболевания", B: "Инсулинорезистентность и прогрессирующую дисфункцию бета-клеток", C: "Только аутоиммунное разрушение бета-клеток", D: "Только повышение глюкагона без роли инсулина" },
    answer: "B"
  },
  { id: 2, text: "Кардиометаболический риск у пациента с СД2 и АГ обычно:", options: { A: "Ниже, чем у пациента без диабета", B: "Не зависит от уровня АД", C: "Выше и требует активного выявления факторов риска", D: "Оценивается только после инфаркта" }, answer: "C" },
  { id: 3, text: "FINDRISC применяется для:", options: { A: "Диагностики диабетической нефропатии", B: "Оценки риска развития СД2", C: "Подбора дозы инсулина", D: "Диагностики тиреотоксикоза" }, answer: "B" },
  { id: 4, text: "При высоком риске по FINDRISC врач ПМСП должен:", options: { A: "Сразу назначить инсулин", B: "Направить на лабораторное подтверждение нарушений углеводного обмена и провести профилактическое консультирование", C: "Ничего не делать без жалоб", D: "Повторить FINDRISC через 5 лет" }, answer: "B" },
  { id: 5, text: "К диагностическому уровню глюкозы плазмы натощак для СД относится:", options: { A: ">=5,0 ммоль/л", B: ">=5,6 ммоль/л", C: ">=6,1 ммоль/л", D: ">=7,0 ммоль/л" }, answer: "D" },
  { id: 6, text: "HbA1c, соответствующий диагностическому порогу СД, обычно составляет:", options: { A: ">=5,0%", B: ">=5,7%", C: ">=6,5%", D: ">=8,5%" }, answer: "C" },
  { id: 7, text: "Офисное АД, требующее подтверждения диагноза АГ при повторных измерениях:", options: { A: ">=120/80 мм рт.ст.", B: ">=130/80 мм рт.ст.", C: ">=140/90 мм рт.ст.", D: ">=160/100 мм рт.ст. только при жалобах" }, answer: "C" },
  { id: 8, text: "Предиабет важен для семейного врача, потому что:", options: { A: "Не требует наблюдения", B: "Является стадией повышенного риска СД2 и сердечно-сосудистых осложнений", C: "Всегда требует немедленного инсулина", D: "Не связан с ожирением" }, answer: "B" },
  { id: 9, text: "К микрососудистым осложнениям СД относятся:", options: { A: "Ретинопатия, нефропатия, нейропатия", B: "Инфаркт миокарда и инсульт", C: "Только ожирение", D: "Только артериальная гипертензия" }, answer: "A" },
  { id: 10, text: "К макрососудистым осложнениям СД относятся:", options: { A: "Катаракта и анемия", B: "Инфаркт миокарда, инсульт, поражение периферических артерий", C: "Только нейропатия", D: "Только гипогликемия" }, answer: "B" },
  { id: 11, text: "При каждом визите пациента с СД2 и АГ врач ПМСП должен оценивать:", options: { A: "Только температуру тела", B: "АД, приверженность, побочные эффекты, симптомы осложнений", C: "Только массу тела один раз в 5 лет", D: "Только жалобы на жажду" }, answer: "B" },
  { id: 12, text: "Индивидуальный план ведения пациента должен включать:", options: { A: "Только диагноз", B: "Цели, лечение, мониторинг, сроки контроля, маршрутизацию", C: "Только список лекарств", D: "Только рекомендацию соблюдать диету" }, answer: "B" },
  { id: 13, text: "Немедикаментозная тактика при СД2 и АГ включает:", options: { A: "Отмену физической активности", B: "Контроль массы тела, питание, физическую активность, ограничение соли, отказ от курения", C: "Только постельный режим", D: "Исключение всех углеводов без оценки состояния" }, answer: "B" },
  { id: 14, text: "Срочного направления требует:", options: { A: "Стабильное АД 130/80 без жалоб", B: "Симптомы гипертонического криза/острого поражения органов-мишеней", C: "FINDRISC 7 баллов без жалоб", D: "Плановый контроль HbA1c" }, answer: "B" },
  { id: 15, text: "Пациент с СД2 должен наблюдаться на уровне ПМСП:", options: { A: "Только при наличии осложнений", B: "Регулярно, с контролем факторов риска и осложнений", C: "Только один раз после постановки диагноза", D: "Только у эндокринолога без участия семейного врача" }, answer: "B" },
  { id: 16, text: "Коммуникация врача с пациентом при НИЗ должна быть:", options: { A: "Приказной без объяснений", B: "Понятной, уважительной, с вовлечением пациента в план лечения", C: "Только письменной", D: "Направленной только на родственников" }, answer: "B" },
  { id: 17, text: "При подозрении на впервые выявленный СД2 врач должен:", options: { A: "Игнорировать результат при отсутствии жалоб", B: "Подтвердить диагноз лабораторно и оценить сопутствующие риски", C: "Назначить антибиотики", D: "Отменить все лекарства от АГ" }, answer: "B" },
  { id: 18, text: "При СД2 и АГ особенно важно:", options: { A: "Лечить только сахар", B: "Одновременно контролировать гликемию, АД, липиды, массу тела и образ жизни", C: "Исключить мониторинг почек", D: "Не оценивать риск ССЗ" }, answer: "B" },
  { id: 19, text: "Правильная маршрутизация означает:", options: { A: "Направлять всех пациентов только в стационар", B: "Определять уровень помощи, срочность и обратную связь с ПМСП", C: "Не фиксировать направление в карте", D: "Не объяснять пациенту дальнейшие шаги" }, answer: "B" },
  { id: 20, text: "Практический разбор клинического случая нужен для оценки:", options: { A: "Только памяти участника", B: "Умения применять знания к реальному пациенту и принимать решения", C: "Только скорости письма", D: "Только посещаемости" }, answer: "B" }
];

const practicalTasks = [
  {
    id: "findrisc",
    instrument: "Инструмент 4",
    title: "Практическая задача по FINDRISC",
    maxScore: 10,
    description: "Мужчина 52 лет, ИМТ 31 кг/м2, окружность талии 104 см, физическая активность менее 30 минут в день, овощи/фрукты ежедневно не употребляет, получает препараты от АГ, ранее повышенная глюкоза не выявлялась, у матери был СД2.",
    fields: [
      ["age", "Баллы за возраст"],
      ["bmi", "Баллы за ИМТ"],
      ["waist", "Баллы за окружность талии"],
      ["activity", "Баллы за физическую активность"],
      ["vegetables", "Баллы за овощи/фрукты"],
      ["bpTherapy", "Баллы за антигипертензивную терапию"],
      ["highGlucose", "Баллы за повышение глюкозы ранее"],
      ["family", "Баллы за семейный анамнез"],
      ["total", "Итоговая сумма баллов"],
      ["riskAction", "Категория риска и дальнейшее действие"]
    ],
    criteria: [
      "Правильно указаны баллы по возрасту - 1",
      "Правильно указаны баллы по ИМТ - 1",
      "Правильно указаны баллы по окружности талии - 1",
      "Правильно учтена физическая активность - 1",
      "Правильно учтено питание - 1",
      "Правильно учтена антигипертензивная терапия - 1",
      "Правильно учтен анамнез повышенной глюкозы - 1",
      "Правильно учтен семейный анамнез - 1",
      "Правильно рассчитана сумма - 1",
      "Правильно указаны категория риска и дальнейшее действие - 1"
    ],
    key: "Ожидаемый общий балл FINDRISC: 19 баллов; категория: высокий риск; действие: лабораторное обследование гликемии/HbA1c, консультирование по образу жизни, контроль факторов риска и план наблюдения."
  },
  {
    id: "diagnostics",
    instrument: "Инструмент 5",
    title: "Диагностические мини-задачи: СД2, предиабет и АГ",
    maxScore: 20,
    cases: [
      "Женщина 48 лет, ИМТ 32. Глюкоза плазмы натощак 7,2 ммоль/л при повторном анализе. Жалоб нет.",
      "Мужчина 55 лет. Глюкоза натощак 6,4 ммоль/л, HbA1c 6,0%.",
      "Женщина 61 год. HbA1c 6,8%, АД на приеме 152/94 мм рт.ст., повторно 148/92.",
      "Мужчина 45 лет. Разовое АД 145/90 после стресса, повторных измерений нет.",
      "Женщина 58 лет, жажда, полиурия. Случайная глюкоза 12,4 ммоль/л."
    ],
    fields: [["conclusion", "Заключение врача"], ["criterion", "Критерий/основание"], ["action", "Дальнейшее действие"]],
    criteria: ["Правильно определена категория/диагноз - 2 балла за ситуацию", "Правильно указан диагностический критерий - 1 балл за ситуацию", "Правильно указано дальнейшее действие - 1 балл за ситуацию"]
  },
  {
    id: "plan",
    instrument: "Инструмент 6",
    title: "Индивидуальный план ведения пациента",
    maxScore: 30,
    description: "Женщина 56 лет, впервые выявленный СД2. HbA1c 8,1%, глюкоза натощак 8,5 ммоль/л, АД 150/95 мм рт.ст. при повторных измерениях, ИМТ 33 кг/м2, окружность талии 102 см. Курит. Жалуется на утомляемость. Креатинин и общий анализ мочи без критических отклонений. Ретинопатия не оценивалась. Лекарств от СД ранее не получала.",
    fields: [
      ["diagnosis", "Основной диагноз и сопутствующие состояния"],
      ["risks", "Факторы риска и уровень кардиометаболического риска"],
      ["goals", "Индивидуальные цели лечения"],
      ["lifestyle", "Немедикаментозные рекомендации"],
      ["diabetesTreatment", "Медикаментозная тактика по СД2"],
      ["hypertensionTreatment", "Медикаментозная тактика по АГ"],
      ["monitoring", "Мониторинг гликемии, АД, массы тела"],
      ["screening", "Скрининг осложнений СД"],
      ["followUp", "Сроки повторного визита"],
      ["referral", "Показания к направлению к специалисту"]
    ],
    criteria: ["Диагноз и сопутствующие состояния - 3", "Факторы риска/кардиометаболический риск - 3", "Цели лечения - 3", "Немедикаментозные рекомендации - 4", "Тактика по СД2 - 4", "Тактика по АГ - 4", "Мониторинг гликемии/АД/массы тела - 3", "Скрининг осложнений - 3", "Сроки повторного визита - 1", "Показания к направлению - 2"]
  },
  {
    id: "routing",
    instrument: "Инструмент 7",
    title: "Маршрутизация пациента",
    maxScore: 20,
    cases: [
      "АД 185/115 мм рт.ст. + боль в груди/одышка/неврологические симптомы",
      "Впервые выявленный СД2 без кетоза, стабильное состояние, HbA1c 7,8%",
      "СД2 + язва стопы/признаки инфекции стопы",
      "СД2 + снижение функции почек или выраженная альбуминурия по доступным данным",
      "АГ 150/95 мм рт.ст. повторно, без признаков острого поражения органов-мишеней",
      "Высокий FINDRISC, но глюкоза натощак пока не определялась"
    ],
    fields: [["route", "Куда направить/где вести"], ["urgency", "Срочность"], ["reason", "Обоснование"], ["responsible", "Ответственный за наблюдение"]],
    criteria: ["Верно определен уровень помощи/направления по каждой ситуации - 6", "Верно указана срочность - 4", "Дано клиническое обоснование - 4", "Указана обратная связь с ПМСП и ответственный - 3", "Отмечены ситуации, требующие экстренной помощи - 3"]
  },
  {
    id: "clinical-case",
    instrument: "Инструмент 8",
    title: "Комплексный клинический случай",
    maxScore: 20,
    description: "Мужчина 59 лет, водитель. ИМТ 30 кг/м2, окружность талии 106 см. Курит. АД на двух визитах 158/96 и 154/94 мм рт.ст. Глюкоза натощак 7,4 ммоль/л повторно, HbA1c 7,2%. Жалобы: быстрая утомляемость, периодическое онемение стоп. Ранее регулярно не наблюдался. Семейный анамнез: отец умер от инсульта. При осмотре выраженных острых симптомов нет.",
    fields: [
      ["diagnosis", "Предварительный/клинический диагноз"],
      ["risks", "Основные факторы риска"],
      ["additional", "Какие показатели надо дополнительно оценить"],
      ["treatment", "Первичный план лечения и профилактики"],
      ["monitoring", "План мониторинга в ПМСП"],
      ["screening", "Скрининг осложнений"],
      ["routing", "Маршрутизация и показания к специалистам"],
      ["communication", "Как объяснить пациенту дальнейшие шаги"]
    ],
    criteria: ["Диагноз: СД2 + АГ + ожирение/факторы риска - 3", "Оценка сердечно-сосудистого риска и факторов риска - 3", "План дообследования - 3", "План лечения и профилактики - 4", "Мониторинг и диспансерное наблюдение - 3", "Скрининг осложнений и маршрутизация - 3", "Коммуникация с пациентом - 1"]
  }
];

const postTrainingTasks = [
  {
    id: "findrisc-new",
    instrument: "Тест 1",
    title: "Практическая задача по FINDRISC",
    maxScore: 9,
    mode: "findrisc",
    description: "Мужчина 52 лет, ИМТ 31 кг/м2, окружность талии 104 см, физическая активность менее 30 минут в день, овощи/фрукты ежедневно не употребляет, получает препараты от АГ, ранее повышенная глюкоза не выявлялась, у матери был СД2.",
    fields: [
      ["age", "Возраст, 52 года", "2"],
      ["bmi", "ИМТ 31 кг/м2", "3"],
      ["waist", "Окружность талии 104 см, мужчина", "4"],
      ["activity", "Физическая активность <30 мин/день", "2"],
      ["vegetables", "Овощи/фрукты не ежедневно", "1"],
      ["bpTherapy", "Антигипертензивная терапия: да", "2"],
      ["highGlucose", "Повышение глюкозы ранее: нет", "0"],
      ["family", "Семейный анамнез СД: мать с СД2", "5"],
      ["risk", "ИТОГО: категория риска", "Высокий риск"]
    ],
    criteria: ["1 балл за каждый правильно заполненный компонент FINDRISC и итоговую категорию риска."],
    key: "Правильные баллы: возраст 2, ИМТ 3, талия 4, физическая активность 2, овощи/фрукты 1, АГ-терапия 2, глюкоза ранее 0, семейный анамнез 5. Итог: высокий риск."
  },
  {
    id: "diagnostics-new",
    instrument: "Тест 2",
    title: "Диагностические мини-задачи: СД2, предиабет и АГ",
    maxScore: 5,
    mode: "singleCases",
    options: ["Сахарный диабет 2 типа", "Нарушенная гликемия натощак", "Повышение артериального давления"],
    cases: [
      ["Женщина 48 лет, ИМТ 32. Глюкоза плазмы натощак 7,2 ммоль/л при повторном анализе. Жалоб нет.", "Сахарный диабет 2 типа"],
      ["Мужчина 55 лет. Глюкоза натощак 6,4 ммоль/л, HbA1c 6,0%.", "Нарушенная гликемия натощак"],
      ["Женщина 61 год. HbA1c 6,8%, АД на приеме 152/94 мм рт.ст., повторно 148/92.", "Сахарный диабет 2 типа"],
      ["Мужчина 45 лет. Разовое АД 145/90 после стресса, повторных измерений нет.", "Повышение артериального давления"],
      ["Женщина 58 лет, жажда, полиурия. Случайная глюкоза 12,4 ммоль/л.", "Сахарный диабет 2 типа"]
    ],
    criteria: ["1 балл за каждый правильный вариант ответа."]
  },
  {
    id: "plan-new",
    instrument: "Тест 3",
    title: "Клиническая задача и индивидуальный план ведения пациента",
    maxScore: 10,
    mode: "mcq",
    description: "Женщина 56 лет, впервые выявленный СД2. HbA1c 8,1%, глюкоза натощак 8,5 ммоль/л, АД 150/95 мм рт.ст. при повторных измерениях, ИМТ 33 кг/м2, окружность талии 102 см. Курит. Жалуется на утомляемость. Ретинопатия не оценивалась. Лекарств от СД ранее не получала.",
    questions: [
      { text: "Основной диагноз и сопутствующие состояния", options: { A: "Сахарный диабет 2 типа, ожирение", B: "Сахарный диабет 2 типа, впервые выявленный, декомпенсированный. Ожирение 1 степени (абдоминальное). Артериальная гипертензия 2 степени.", C: "Метаболический синдром, преддиабет", D: "Сахарный диабет 2 типа, артериальная гипертензия", E: "Ожирение, никотиновая зависимость" }, answer: "B" },
      { text: "Факторы риска и уровень кардиометаболического риска", options: { A: "Средний риск", B: "Очень высокий кардиометаболический риск (СД2 + АГ + ожирение + курение + возраст)", C: "Низкий риск", D: "Только высокий риск по ожирению", E: "Риск не определяется на ПМСП" }, answer: "B" },
      { text: "Индивидуальные цели лечения", options: { A: "HbA1c < 8,0%, АД < 140/90", B: "HbA1c < 7,0%, АД < 130/80 мм рт.ст., снижение веса >= 5-10%", C: "HbA1c < 6,5%, АД < 120/70", D: "Только нормализация глюкозы натощак", E: "Нет четких целей на старте" }, answer: "B" },
      { text: "Немедикаментозные рекомендации", options: { A: "Только отказ от курения", B: "Снижение массы тела, низкоуглеводная диета, увеличение физической активности до 150 мин/нед, полный отказ от курения", C: "Только диета", D: "Лечебная физкультура 2 раза в неделю", E: "Ничего не назначать до эндокринолога" }, answer: "B" },
      { text: "Медикаментозная тактика по СД2", options: { A: "Сразу инсулин", B: "Метформин (начать с 500 мг 2 раза в день, титровать до 2000 мг/сут)", C: "Гликлазид", D: "Только изменение образа жизни в течение 3 месяцев", E: "SGLT2-ингибитор в качестве монотерапии" }, answer: "B" },
      { text: "Медикаментозная тактика по АГ", options: { A: "Только амлодипин", B: "Ингибитор АПФ (периндоприл) или БРА + амлодипин (комбинированная терапия)", C: "Бета-блокатор", D: "Только диуретик", E: "Начинать монотерапию" }, answer: "B" },
      { text: "Мониторинг гликемии, АД, массы тела", options: { A: "1 раз в 3 месяца", B: "Самоконтроль глюкозы 2-3 раза в неделю, АД ежедневно, вес 1 раз в неделю. Контроль в ПМСП через 2 недели", C: "Только HbA1c через 3 месяца", D: "Контроль только на приеме", E: "Мониторинг не требуется" }, answer: "B" },
      { text: "Скрининг осложнений СД", options: { A: "Только через год", B: "Осмотр глазного дна (офтальмолог), ACR, eGFR, оценка стоп и неврологический статус - в ближайшее время", C: "Только ЭКГ", D: "Только УЗИ почек", E: "Скрининг не нужен при впервые выявленном СД" }, answer: "B" },
      { text: "Сроки повторного визита", options: { A: "Через 1 месяц", B: "Через 10-14 дней", C: "Через 3 месяца", D: "Через 6 месяцев", E: "Только после консультации эндокринолога" }, answer: "B" },
      { text: "Показания к направлению к специалисту", options: { A: "Направление не требуется", B: "Эндокринолог - в течение 7-14 дней, офтальмолог - в течение 1 месяца, кардиолог - по показаниям", C: "Только к кардиологу", E: "Только к нефрологу" }, answer: "B" }
    ],
    criteria: ["1 балл за каждый правильный ответ. Правильные ответы в файле отмечены черным."]
  },
  {
    id: "routing-new",
    instrument: "Тест 4",
    title: "Маршрутизация пациента",
    maxScore: 12,
    mode: "routing",
    specialistOptions: ["кардиолог", "эндокринолог", "хирург", "нефролог"],
    urgencyOptions: ["экстренно", "неотложно"],
    cases: [
      ["АД 185/115 мм рт.ст. + боль в груди/одышка/неврологические симптомы", "кардиолог", "экстренно"],
      ["Впервые выявленный СД2 без кетоза, стабильное состояние, HbA1c 7,8%", "эндокринолог", "неотложно"],
      ["СД2 + язва стопы/признаки инфекции стопы", "хирург", "экстренно"],
      ["СД2 + снижение функции почек или выраженная альбуминурия по доступным данным", "нефролог", "неотложно"],
      ["АГ 150/95 мм рт.ст. повторно, без признаков острого поражения органов-мишеней", "кардиолог", "неотложно"],
      ["Высокий FINDRISC, но глюкоза натощак пока не определялась", "эндокринолог", "неотложно"]
    ],
    criteria: ["1 балл за правильного специалиста и 1 балл за правильную срочность в каждой ситуации."]
  },
  {
    id: "clinical-case-new",
    instrument: "Тест 5",
    title: "Комплексный клинический случай для оценки принятия решений",
    maxScore: 8,
    mode: "mcq",
    description: "Мужчина 59 лет, водитель. ИМТ 30 кг/м2, окружность талии 106 см. Курит. АД на двух визитах 158/96 и 154/94 мм рт.ст. Глюкоза натощак 7,4 ммоль/л повторно, HbA1c 7,2%. Жалобы: быстрая утомляемость, периодическое онемение стоп. Семейный анамнез: отец умер от инсульта.",
    questions: [
      { text: "Предварительный клинический диагноз", options: { A: "Нарушение гликемии натощак", B: "Сахарный диабет 2 типа, впервые выявленный", C: "Преддиабет", D: "Сахарный диабет 1 типа", E: "Метаболический синдром" }, answer: "B" },
      { text: "Основные факторы риска у данного пациента", options: { A: "Только возраст и курение", B: "Ожирение, абдоминальное ожирение, АГ, курение, возраст, отягощенная наследственность", C: "Только наследственность", D: "Только гипергликемия", E: "Только артериальная гипертензия" }, answer: "B" },
      { text: "Какие показатели необходимо дополнительно оценить в первую очередь?", options: { A: "Только общий анализ крови", B: "eGFR, ACR (альбумин/креатинин), липидный профиль, осмотр глазного дна, ЛПИ", C: "Только УЗИ органов брюшной полости", D: "Только С-пептид", E: "Только коагулограмма" }, answer: "B" },
      { text: "Первичный план лечения и профилактики", options: { A: "Только диета", B: "Метформин + изменение образа жизни + ИАПФ/БРА + амлодипин + статин + отказ от курения", C: "Инсулин короткого действия", D: "Только препараты от давления", E: "Метформин + гликлазид" }, answer: "B" },
      { text: "План мониторинга в ПМСП", options: { A: "Контроль 1 раз в 6 месяцев", B: "Контроль АД, глюкозы, веса каждые 2 недели первые 1-2 месяца, затем 1 раз в 3 месяца", C: "Контроль только 1 раз в год", D: "Еженедельный контроль", E: "Только контроль HbA1c 1 раз в год" }, answer: "B" },
      { text: "Скрининг осложнений сахарного диабета", options: { A: "Только ЭКГ", B: "Офтальмолог, ACR + eGFR, оценка стоп и неврологический статус, ЭКГ/ЭхоКГ", C: "Только МРТ головного мозга", D: "Только УЗИ почек", E: "Только допплерография сосудов шеи" }, answer: "B" },
      { text: "Маршрутизация и показания к специалистам", options: { A: "Наблюдение только терапевтом", B: "Эндокринолог - в течение 7-10 дней; кардиолог - в течение 14 дней; офтальмолог - в течение 2 недель", C: "Направление в стационар", D: "Только к хирургу", E: "Направление к неврологу через 3 месяца" }, answer: "B" },
      { text: "Как лучше объяснить пациенту дальнейшие шаги", options: { A: "У вас диабет, будете колоть инсулин", B: "У вас выявился сахарный диабет 2 типа. Сейчас важно быстро нормализовать сахар и давление, чтобы не развились осложнения на глаза, почки и ноги. Начнем с таблеток, диеты и отказа от курения. Нужно пройти обследование у специалистов в ближайшие 2 недели", C: "Это не страшно, просто похудейте", E: "Ничего не объяснять, только выписать рецепты" }, answer: "B" }
    ],
    criteria: ["1 балл за каждый правильный ответ. Правильные ответы в файле отмечены черным."]
  }
];

const nursePreQuestions = [
  { id: 1, text: "Почему СД2 и АГ часто называют «тихими» заболеваниями?", options: { A: "Всегда протекают с болью", B: "Могут долго не давать жалоб", C: "Не требуют контроля" }, answer: "B" },
  { id: 2, text: "Что является первым действием медсестры у пациента 50 лет с ожирением и АД 148/92?", options: { A: "Назначить таблетки", B: "Измерить повторно/оценить риск/направить к врачу", C: "Ничего не делать" }, answer: "B" },
  { id: 3, text: "Какое значение АД соответствует АГ 1 степени?", options: { A: "120/80", B: "130/85", C: "140-159 и/или 90-99 мм рт. ст." }, answer: "C" },
  { id: 4, text: "FINDRISK используется для:", options: { A: "Постановки диагноза СД", B: "Оценки риска и отбора на лабораторный этап", C: "Подбора дозы метформина" }, answer: "B" },
  { id: 5, text: "Что нужно сделать перед измерением АД?", options: { A: "Дать пациенту отдохнуть 5 минут", B: "Измерять сразу после подъема по лестнице", C: "Попросить говорить во время измерения" }, answer: "A" },
  { id: 6, text: "Диагноз диабета ставится:", options: { A: "По жалобам", B: "Только по лабораторным критериям и подтверждению врачом", C: "По внешнему виду пациента" }, answer: "B" },
  { id: 7, text: "При АД 210/120 и боли за грудиной медсестра должна:", options: { A: "Записать на плановый прием", B: "Срочно организовать помощь/маршрутизацию", C: "Дать совет пить воду" }, answer: "B" },
  { id: 8, text: "К чему относится окружность талии?", options: { A: "К оценке абдоминального ожирения", B: "К диагностике анемии", C: "К оценке зрения" }, answer: "A" },
  { id: 9, text: "Что помогает повысить приверженность лечению?", options: { A: "Обвинять пациента", B: "Простой письменный план и уважительный разговор", C: "Отменить контроль" }, answer: "B" },
  { id: 10, text: "Что должна фиксировать медсестра в регистре скрининга?", options: { A: "Только имя", B: "Дату, АД, ИМТ/талию, FINDRISK/глюкозу, направление и дату возврата", C: "Ничего" }, answer: "B" }
];

const nursePostQuestions = [
  { id: 1, text: "Назовите 4 основных фактора риска СД2/АГ, которые должна активно выявлять медсестра.", options: { A: "Только курение и питание", B: "Возраст, ИМТ/окружность талии, семейный анамнез по СД2, повышенное АД", C: "Только уровень холестерина и гемоглобин", D: "Только физическая активность и стресс" }, answer: "B" },
  { id: 2, text: "Что такое FINDRISK?", options: { A: "Метод постановки окончательного диагноза СД2", B: "Инструмент (анкета) для оценки риска развития СД2 в ближайшие 10 лет", C: "Шкала для расчета дозы инсулина", D: "Метод определения стадии артериальной гипертензии" }, answer: "B" },
  { id: 3, text: "Назовите 3 важных правила правильного измерения артериального давления.", options: { A: "Измерять сразу после ходьбы, манжета любого размера, пациент может разговаривать", B: "Пациент отдыхает 5 минут, рука на уровне сердца, манжета соответствует размеру руки", C: "Измерять только на обеих руках одновременно, ноги скрещены", D: "Измерять сразу после приема пищи" }, answer: "B" },
  { id: 4, text: "При каком уровне офисного АД начинается диапазон артериальной гипертензии?", options: { A: ">=130/80 мм рт. ст.", B: ">=140 и/или >=90 мм рт. ст. (при подтверждении)", C: ">=160/100 мм рт. ст.", D: ">=120/80 мм рт. ст." }, answer: "B" },
  { id: 5, text: "Какой порог глюкозы плазмы натощак соответствует диабетическому диапазону?", options: { A: ">=5,6 ммоль/л", B: ">=7,0 ммоль/л (при подтверждении на повторном анализе)", C: ">=6,1 ммоль/л", D: ">=8,5 ммоль/л" }, answer: "B" },
  { id: 6, text: "Что должна сделать медсестра при выявлении АД 210/120 мм рт.ст. и боли за грудиной?", options: { A: "Записать пациента на плановый прием через неделю", B: "Организовать срочную маршрутизацию (вызвать врача или скорую помощь)", C: "Посоветовать пациенту выпить воды и отдохнуть", D: "Измерить АД еще раз через час" }, answer: "B" },
  { id: 7, text: "Почему медсестра не должна самостоятельно отменять препарат пациенту?", options: { A: "Потому что препараты дорогие", B: "Назначение и отмена терапии — зона ответственности врача", C: "Потому что пациенту всегда нужно продолжать лечение", D: "Потому что отмена препаратов запрещена законом" }, answer: "B" },
  { id: 8, text: "Какие 3 важных пункта обязательно должны быть в направлении к врачу?", options: { A: "Только ФИО и дата рождения", B: "Причина направления, объективные данные (АД, глюкоза, ИМТ, ОТ), дата возврата", C: "Только жалобы пациента", D: "Только список всех принимаемых лекарств" }, answer: "B" },
  { id: 9, text: "Как лучше спросить пациента о пропусках приема лекарств (без обвинения)?", options: { A: "Почему вы не принимаете таблетки как положено?", B: "Многие пациенты иногда пропускают таблетки. Как часто это бывает у вас?", C: "Вы вообще пьете то, что назначили?", D: "Вы понимаете, что без таблеток будет плохо?" }, answer: "B" },
  { id: 10, text: "Что означает термин «непрерывность наблюдения» в работе медсестры?", options: { A: "Пациент наблюдается только у узких специалистов", B: "Пациент не теряется после направления: есть контроль выполнения, дата возврата и фиксация результатов", C: "Наблюдение пациента только 1 раз в год", D: "Непрерывный прием всех назначенных препаратов" }, answer: "B" }
];

const remappedNursePostQuestions = nursePostQuestions.map((question, index) => {
  const orders = [
    ["B", "A", "C", "D"],
    ["A", "C", "B", "D"],
    ["A", "B", "D", "C"],
    ["C", "A", "D", "B"],
    ["D", "B", "A", "C"]
  ];
  return remapQuestionOptions(question, orders[index % orders.length]);
});

function createDefaultDb() {
  if (!INITIAL_ADMIN_PASSWORD) {
    throw new Error("INITIAL_ADMIN_PASSWORD is required when creating a new database");
  }
  const now = new Date().toISOString();
  const admins = seedAdmins.map((user) => ({
    ...user,
    passwordHash: hashPassword(INITIAL_ADMIN_PASSWORD),
    createdAt: now
  }));
  return {
    admins,
    doctors: [],
    nurseSurveys: [],
    doctorVisits: [],
    trainingParticipants: [],
    trainingAttempts: [],
    nurseTrainingParticipants: [],
    nurseTrainingAttempts: [],
    patientTasks: [],
    appointments: [],
    reminderQueue: [],
    messageEvents: [],
    activityEvents: [],
    sessions: {},
    settings: { createdAt: now }
  };
}

function createEmptyDb() {
  return {
    admins: [], doctors: [], nurseSurveys: [], doctorVisits: [],
    trainingParticipants: [], trainingAttempts: [],
    nurseTrainingParticipants: [], nurseTrainingAttempts: [],
    patientTasks: [], appointments: [], reminderQueue: [], messageEvents: [],
    activityEvents: [], sessions: {}, settings: {}
  };
}

async function pgPool() {
  if (!pgPoolPromise) {
    pgPoolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 5),
      connectionTimeoutMillis: PG_TIMEOUT_MS,
      idleTimeoutMillis: 30000,
      query_timeout: PG_TIMEOUT_MS,
      statement_timeout: PG_TIMEOUT_MS
    }));
  }
  return pgPoolPromise;
}

async function ensureDb() {
  if (!dbReadyPromise) {
    dbReadyPromise = (DATABASE_URL ? ensureCloudDb() : ensureFileDb()).catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}

async function ensureFileDb() {
  await mkdir(dataDir, { recursive: true });
  if (existsSync(dbPath)) return;
  await writeFile(dbPath, JSON.stringify(createDefaultDb(), null, 2), "utf8");
}

async function ensureCloudDb() {
  const pool = await pgPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`create table if not exists app_state (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists app_meta (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists app_settings (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists app_sessions (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    for (const table of Object.values(normalizedCollectionTables)) {
      await client.query(`create table if not exists ${table} (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    }
    const schema = await client.query("select data from app_meta where id = $1", ["schema"]);
    if (!schema.rowCount) {
      const legacy = await client.query("select data from app_state where id = $1", ["main"]);
      let initialDb = legacy.rowCount ? legacy.rows[0].data : createDefaultDb();
      if (!legacy.rowCount && existsSync(dbPath)) {
        try {
          initialDb = JSON.parse(await readFile(dbPath, "utf8"));
        } catch {
          initialDb = createDefaultDb();
        }
      }
      await syncNormalizedCloudDb(client, initialDb);
      await client.query(
        "insert into app_state (id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
        ["main", JSON.stringify(initialDb)]
      );
      await client.query("insert into app_meta (id, data) values ($1, $2::jsonb)", ["schema", JSON.stringify({ version: 2, migratedAt: new Date().toISOString() })]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function syncCloudCollection(client, table, values, dataSelector = (item) => item) {
  const rows = (Array.isArray(values) ? values : []).filter((item) => item?.id).map((item) => ({ id: String(item.id), data: dataSelector(item) }));
  if (rows.length) {
    await client.query(`
      insert into ${table} (id, data, updated_at)
      select item.id, item.data, now()
      from jsonb_to_recordset($1::jsonb) as item(id text, data jsonb)
      on conflict (id) do update set data = excluded.data, updated_at = now()
      where ${table}.data is distinct from excluded.data
    `, [JSON.stringify(rows)]);
    await client.query(`delete from ${table} where not (id = any($1::text[]))`, [rows.map((row) => row.id)]);
  } else {
    await client.query(`delete from ${table}`);
  }
}

async function syncNormalizedCloudDb(client, db) {
  for (const [key, table] of Object.entries(normalizedCollectionTables)) await syncCloudCollection(client, table, db[key]);
  const sessions = Object.entries(db.sessions || {}).map(([id, data]) => ({ id, data }));
  await syncCloudCollection(client, "app_sessions", sessions, (item) => item.data);
  await client.query(`
    insert into app_settings (id, data, updated_at) values ('main', $1::jsonb, now())
    on conflict (id) do update set data = excluded.data, updated_at = now()
    where app_settings.data is distinct from excluded.data
  `, [JSON.stringify(db.settings || {})]);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashPassword(password, salt).split(":")[1], "hex"));
}

async function readDb() {
  await ensureDb();
  if (dbCache) return dbCache;
  if (!dbLoadPromise) {
    dbLoadPromise = (async () => {
      const db = DATABASE_URL ? await readCloudDb() : JSON.parse(await readFile(dbPath, "utf8"));
      let changed = false;
      for (const key of ["trainingParticipants", "trainingAttempts", "nurseTrainingParticipants", "nurseTrainingAttempts", "patientTasks", "appointments", "reminderQueue", "messageEvents", "activityEvents"]) {
        if (!Array.isArray(db[key])) {
          db[key] = [];
          changed = true;
        }
      }
      if (!Array.isArray(db.admins) || !db.admins.length) {
        db.admins = createDefaultDb().admins;
        changed = true;
      }
      for (const seeded of seedAdmins) {
        const admin = db.admins.find((item) => item.id === seeded.id || item.username === seeded.username);
        if (!admin) continue;
        if (!admin.role) {
          admin.role = seeded.role;
          changed = true;
        }
        if (!admin.createdAt) {
          admin.createdAt = new Date().toISOString();
          changed = true;
        }
      }
      for (const admin of db.admins) {
        if (Object.hasOwn(admin, "passwordVisible")) {
          delete admin.passwordVisible;
          changed = true;
        }
      }
      for (const doctor of db.doctors || []) {
        if (Object.hasOwn(doctor, "accessKeyVisible")) {
          delete doctor.accessKeyVisible;
          changed = true;
        }
      }
      dbCache = db;
      if (changed) await writeDb(db);
      return dbCache;
    })().finally(() => {
      dbLoadPromise = null;
    });
  }
  return dbLoadPromise;
}

async function writeDb(db) {
  dbCache = db;
  const body = JSON.stringify(db, null, 2);
  if (DATABASE_URL) {
    const writeTask = dbWritePromise.catch(() => {}).then(async () => {
      const pool = await pgPool();
      const client = await pool.connect();
      try {
        await client.query("begin");
        await syncNormalizedCloudDb(client, db);
        await client.query(
          "insert into app_state (id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
          ["main", body]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
    dbWritePromise = writeTask;
    await writeTask;
    return;
  }
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  const writeTask = dbWritePromise.catch(() => {}).then(async () => {
    await writeFile(tmpPath, body, "utf8");
    await rename(tmpPath, dbPath);
  });
  dbWritePromise = writeTask;
  await writeTask;
}

async function readCloudDb() {
  const pool = await pgPool();
  const db = createEmptyDb();
  for (const [key, table] of Object.entries(normalizedCollectionTables)) {
    const result = await pool.query(`select data from ${table} order by id`);
    db[key] = result.rows.map((row) => row.data);
  }
  const sessions = await pool.query("select id, data from app_sessions");
  db.sessions = Object.fromEntries(sessions.rows.map((row) => [row.id, row.data]));
  const settings = await pool.query("select data from app_settings where id = 'main'");
  db.settings = settings.rowCount ? settings.rows[0].data : {};
  return db;
}

async function databaseHealth() {
  if (!DATABASE_URL) return { mode: "file", ok: true };
  const startedAt = Date.now();
  const pool = await pgPool();
  await pool.query("select 1");
  return { mode: "postgres", ok: true, latencyMs: Date.now() - startedAt };
}

function isDatabaseError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "timeout",
    "database",
    "postgres",
    "connection",
    "econn",
    "enotfound",
    "authentication",
    "remaining connection slots",
    "terminating connection",
    "neon"
  ].some((part) => message.includes(part));
}

function send(res, status, payload, headers = {}) {
  const isBinary = Buffer.isBuffer(payload) || payload instanceof Uint8Array;
  const isJson = typeof payload !== "string" && !isBinary;
  let body = typeof payload === "string" || isBinary ? payload : JSON.stringify(payload);
  const acceptsGzip = String(res.req?.headers?.["accept-encoding"] || "").includes("gzip");
  const shouldCompress = isJson && acceptsGzip && Buffer.byteLength(body) >= 1024;
  if (shouldCompress) body = gzipSync(body);
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...(shouldCompress ? { "Content-Encoding": "gzip", "Vary": "Accept-Encoding" } : {}),
    ...securityHeaders(),
    ...headers
  });
  res.end(body);
}

function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    const error = new Error("Размер запроса превышает допустимый лимит");
    error.statusCode = 413;
    throw error;
  }
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("Размер запроса превышает допустимый лимит");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Некорректный JSON");
    error.statusCode = 400;
    throw error;
  }
}

function clientIp(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown").trim();
}

const securityAlertState = new Map();
function queueSecurityAlert(req, event, details = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = securityAlertState.get(ip) || { count: 0, windowStartedAt: now, lastSentAt: 0 };
  if (now - current.windowStartedAt > 10 * 60 * 1000) { current.count = 0; current.windowStartedAt = now; }
  current.count += 1;
  securityAlertState.set(ip, current);
  if (current.count < 5 || now - current.lastSentAt < 30 * 60 * 1000) return;
  current.lastSentAt = now;
  Promise.resolve().then(async () => {
    if (!TELEGRAM_BOT_TOKEN) return;
    const db = await readDb();
    const chatId = String(db.settings?.dailyReports?.chatId || TELEGRAM_REPORT_CHAT_ID || "").trim();
    if (!chatId) return;
    const text = [`E-Clinic — предупреждение безопасности`, `Событие: ${event}`, `IP: ${ip}`, `Попыток за 10 минут: ${current.count}`, `Путь: ${String(req.url || "").split("?", 1)[0]}`, details.scope ? `Раздел: ${details.scope}` : ""].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
  }).catch((error) => console.error("Security alert failed:", error.message || error));
}

function securityEvent(event, req, details = {}) {
  const pathname = String(req.url || "").split("?", 1)[0] || "/";
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "warning",
    category: "security",
    event,
    requestId: req.requestId || "unknown",
    ip: clientIp(req),
    method: req.method || "GET",
    path: pathname,
    ...details
  }));
  if (["rate_limited", "login_failed"].includes(event)) queueSecurityAlert(req, event, details);
}

function consumeRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count <= limit) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

function clearRateLimit(key) {
  rateLimits.delete(key);
}

function enforceLoginRateLimit(req, res, loginType) {
  const key = `login:${loginType}:${clientIp(req)}`;
  const result = consumeRateLimit(key, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (result.allowed) return key;
  securityEvent("rate_limited", req, { scope: "login", accountType: loginType, retryAfter: result.retryAfter });
  send(res, 429, { error: "Слишком много попыток входа. Повторите через минуту." }, { "Retry-After": String(result.retryAfter) });
  return "";
}

function enforceUserRateLimit(req, res, session, action, limit, windowMs) {
  const identity = session ? `${session.userType}:${session.userId}` : clientIp(req);
  const result = consumeRateLimit(`${action}:${identity}`, limit, windowMs);
  if (result.allowed) return true;
  securityEvent("rate_limited", req, { scope: action, accountType: session?.userType || "anonymous", retryAfter: result.retryAfter });
  send(res, 429, { error: "Слишком много запросов. Повторите позже." }, { "Retry-After": String(result.retryAfter) });
  return false;
}

function isTrustedStateChangingRequest(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) return true;
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host.toLowerCase();
    const originHostname = originUrl.hostname.toLowerCase();
    if (originUrl.protocol === "https:" && (originHostname === "e-clinic-control.ru" || originHostname.endsWith(".e-clinic-control.ru"))) return true;
    const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
    return Boolean(originHost && requestHost && originHost === requestHost);
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const cookies = req.headers.cookie?.split(";").map((item) => item.trim()) || [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwardedProto === "https") return true;
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = String(forwardedHost && forwardedHost !== "_" ? forwardedHost : req.headers.host || "")
    .split(":")[0]
    .toLowerCase();
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}

function sessionCookie(req, sid, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

async function getSession(req) {
  const sid = getCookie(req, "sid");
  if (!sid) return null;
  const db = await readDb();
  const session = db.sessions[sid];
  if (!session) return null;
  const createdAt = Date.parse(session.createdAt || "");
  const userExists = session.userType === "admin"
    ? db.admins.some((item) => item.id === session.userId)
    : session.userType === "doctor" && db.doctors.some((item) => item.id === session.userId);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= SESSION_TTL_MS || !userExists) {
    delete db.sessions[sid];
    await writeDb(db);
    return null;
  }
  return session;
}

async function createSession(userType, userId) {
  const db = await readDb();
  const sid = crypto.randomUUID();
  db.sessions[sid] = { userType, userId, createdAt: new Date().toISOString() };
  await writeDb(db);
  return sid;
}

async function clearSession(req) {
  const sid = getCookie(req, "sid");
  if (!sid) return;
  const db = await readDb();
  delete db.sessions[sid];
  await writeDb(db);
}

function invalidateUserSessions(db, userType, userId) {
  for (const [sid, session] of Object.entries(db.sessions || {})) {
    if (session.userType === userType && session.userId === userId) delete db.sessions[sid];
  }
}

function publicDoctor(doctor) {
  const { accessKeyHash, accessKeyVisible, ...safe } = doctor;
  return safe;
}

function publicAdmin(admin) {
  const { passwordHash, passwordVisible, ...safe } = admin;
  safe.roleLabel = adminRoles[safe.role] || safe.role || "";
  return safe;
}

function clinicKey(value = "") {
  const text = String(value).trim().toLowerCase();
  const number = text.match(/\d+/)?.[0];
  return number || text.replace(/\s+/g, "");
}

function isExcludedClinic(value = "") {
  return ["6", "13"].includes(clinicKey(value));
}

function allowedClinic(value, label = "Поликлиника") {
  const clinic = cleanText(value, label, { required: true, max: 100 });
  if (isExcludedClinic(clinic)) invalidInput(`${label}: поликлиника исключена из системы`);
  return clinic;
}

function doctorCanAccessSurvey(doctor, survey) {
  const doctorClinic = clinicKey(doctor?.clinic);
  const surveyClinic = clinicKey(survey?.patient?.clinic || survey?.clinic);
  return Boolean(doctorClinic && surveyClinic && doctorClinic === surveyClinic);
}

function adminRole(session, db) {
  if (!session || session.userType !== "admin") return "";
  const admin = db.admins.find((item) => item.id === session.userId);
  if (!admin) return "";
  // Older installations may have a single administrator without a role.
  // A sole administrator must retain owner access after the role migration.
  if (db.admins.length === 1) return "owner";
  return admin.role || "";
}

function canMutateAdmin(session, db) {
  return ["owner", "manager"].includes(adminRole(session, db));
}

function canManageAdmins(session, db) {
  return adminRole(session, db) === "owner";
}

function canCorrectSurvey(session, db, survey) {
  const role = adminRole(session, db);
  if (["owner", "manager"].includes(role)) return true;
  return role === "head_nurse" && adminCanAccessClinic(session, db, survey?.patient?.clinic || survey?.clinic);
}

function requireAdmin(session) {
  return session?.userType === "admin";
}

function compactCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function assistantAppName(app = "") {
  return {
    admin: "приложение администратора",
    doctor: "приложение врача",
    survey: "опросник пациента",
    training: "проверка знаний врачей",
    "nurse-training": "проверка знаний медсестер",
    investor: "панель инвесторов",
    monitor: "экран наблюдения"
  }[app] || "медицинская платформа";
}

function buildAssistantSystemPrompt(db, session, appName) {
  const stats = [
    `врачей зарегистрировано: ${compactCount(db.doctors)}`,
    `анкет пациентов: ${compactCount(db.nurseSurveys)}`,
    `осмотров врачей: ${compactCount(db.doctorVisits)}`,
    `участников обучения врачей: ${compactCount(db.trainingParticipants)}`,
    `участников обучения медсестер: ${compactCount(db.nurseTrainingParticipants)}`
  ].join("; ");
  const userType = session?.userType === "admin" ? "администратор" : session?.userType === "doctor" ? "врач" : "пользователь без входа";
  return [
    "Ты AI-консультант платформы E-Clinic Control.",
    `Текущий раздел: ${appName}. Тип пользователя: ${userType}.`,
    `Общая статистика без персональных данных: ${stats}.`,
    "Помогай пользователю пользоваться платформой: где найти пациентов, обучение, статистику, мониторинг, отчеты, фильтры и синхронизацию.",
    "Можешь кратко объяснять FINDRISC, сердечно-сосудистый риск, индекс массы тела, формулу Rabito, пре-тесты и пост-тесты.",
    "Не раскрывай персональные данные пациентов, врачей, медсестер, пароли, ключи доступа и скрытые настройки.",
    "Не ставь окончательный диагноз, не назначай лечение и не заменяй врача. Для медицинских решений говори, что решение принимает врач по клиническим данным и локальным протоколам.",
    "Отвечай на русском языке, простыми короткими абзацами. Если пользователь просит на таджикском, отвечай на таджикском."
  ].join("\n");
}

function extractGeminiText(payload) {
  const parts = [];
  for (const candidate of payload?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n").trim() || "Не удалось получить ответ консультанта.";
}

function adminAccount(session, db) {
  if (!session || session.userType !== "admin") return null;
  return db.admins.find((admin) => admin.id === session.userId) || null;
}

function adminClinicScope(session, db) {
  const admin = adminAccount(session, db);
  return admin?.role === "head_nurse" ? clinicKey(admin.clinic) : "";
}

function adminCanAccessClinic(session, db, clinic) {
  const scope = adminClinicScope(session, db);
  return !scope || scope === clinicKey(clinic);
}

function scopedDbForAdmin(db, session) {
  const scope = adminClinicScope(session, db);
  if (!scope) return db;
  const surveys = (db.nurseSurveys || []).filter((survey) => clinicKey(survey.patient?.clinic || survey.clinic) === scope);
  const surveyIds = new Set(surveys.map((survey) => survey.id));
  const doctors = (db.doctors || []).filter((doctor) => clinicKey(doctor.clinic) === scope);
  const doctorIds = new Set(doctors.map((doctor) => doctor.id));
  const trainingParticipants = (db.trainingParticipants || []).filter((item) => clinicKey(item.clinic) === scope);
  const trainingIds = new Set(trainingParticipants.map((item) => item.id));
  const nurseTrainingParticipants = (db.nurseTrainingParticipants || []).filter((item) => clinicKey(item.clinic) === scope);
  const nurseTrainingIds = new Set(nurseTrainingParticipants.map((item) => item.id));
  return {
    ...db,
    doctors,
    nurseSurveys: surveys,
    doctorVisits: (db.doctorVisits || []).filter((visit) => surveyIds.has(visit.surveyId) || doctorIds.has(visit.doctorId)),
    patientTasks: (db.patientTasks || []).filter((item) => surveyIds.has(item.surveyId)),
    appointments: (db.appointments || []).filter((item) => surveyIds.has(item.surveyId)),
    reminderQueue: (db.reminderQueue || []).filter((item) => !item.surveyId || surveyIds.has(item.surveyId)),
    activityEvents: (db.activityEvents || []).filter((event) => clinicKey(event.clinic) === scope || (event.surveyId && surveyIds.has(event.surveyId))),
    trainingParticipants,
    trainingAttempts: (db.trainingAttempts || []).filter((item) => trainingIds.has(item.participantId)),
    nurseTrainingParticipants,
    nurseTrainingAttempts: (db.nurseTrainingAttempts || []).filter((item) => nurseTrainingIds.has(item.participantId)),
    admins: (db.admins || []).filter((admin) => admin.id === session.userId)
  };
}

async function getGoogleAccessToken() {
  if (googleAccessToken && Date.now() < googleAccessTokenExpiresAt - 60_000) return googleAccessToken;
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!response.ok) throw new Error(`Не удалось получить токен Google Cloud: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.access_token) throw new Error("Google Cloud не вернул токен доступа");
  googleAccessToken = payload.access_token;
  googleAccessTokenExpiresAt = Date.now() + Number(payload.expires_in || 300) * 1000;
  return googleAccessToken;
}

async function askGeminiAssistant({ messages, prompt }) {
  const accessToken = await getGoogleAccessToken();
  const endpoint = [
    "https://aiplatform.googleapis.com/v1/projects",
    encodeURIComponent(GOOGLE_CLOUD_PROJECT),
    "locations",
    encodeURIComponent(GOOGLE_CLOUD_LOCATION),
    "publishers/google/models",
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent`
  ].join("/");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: prompt }]
      },
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: String(message.content || "").slice(0, 2000) }]
      })),
      generationConfig: {
        maxOutputTokens: 700,
        temperature: 0.3
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "Vertex AI временно недоступен";
    throw new Error(message);
  }
  return extractGeminiText(payload);
}

function requestBaseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host || "").includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function calculateFindrisc(input) {
  const age = Number(input.age || 0);
  const bmi = Number(input.bmi || 0);
  const waist = Number(input.rabitoWaist || input.waist || 0);
  const sex = input.sex;
  let score = 0;
  if (age >= 45 && age <= 54) score += 2;
  if (age >= 55 && age <= 64) score += 3;
  if (age > 64) score += 4;
  if (bmi >= 25 && bmi < 30) score += 1;
  if (bmi >= 30) score += 3;
  if ((sex === "male" && waist >= 94 && waist <= 102) || (sex === "female" && waist >= 80 && waist <= 88)) score += 3;
  if ((sex === "male" && waist > 102) || (sex === "female" && waist > 88)) score += 4;
  if (input.activity === "no") score += 2;
  if (input.vegetables === "no") score += 1;
  if (input.bpMeds === "yes") score += 2;
  if (input.highGlucose === "yes") score += 5;
  if (input.familyDiabetes === "second") score += 3;
  if (input.familyDiabetes === "first") score += 5;
  const level = score < 7 ? "Низкий" : score < 12 ? "Слегка повышенный" : score < 15 ? "Умеренный" : score < 20 ? "Высокий" : "Очень высокий";
  return { score, level, highRisk: score >= 12 };
}

function calculateRabito(input) {
  const arm = Number(input.arm || 0);
  const waist = Number(input.rabitoWaist || input.waist || 0);
  const calf = Number(input.calf || 0);
  const sexCoef = input.sex === "male" ? 1 : 2;
  if (![arm, waist, calf].every((value) => Number.isFinite(value) && value > 0)) return null;
  return Number((0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241).toFixed(1));
}

function invalidInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function cleanText(value, label, { required = false, max = 200 } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) invalidInput(`${label}: поле обязательно`);
  if (text.length > max) invalidInput(`${label}: превышена допустимая длина`);
  return text;
}

function cleanNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) invalidInput(`${label}: недопустимое значение`);
  return number;
}

function cleanEnum(value, label, allowed, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text && fallback) return fallback;
  if (!allowed.includes(text)) invalidInput(`${label}: недопустимое значение`);
  return text;
}

function cleanTextArray(value, label, { allowed = null, maxItems = 20, maxLength = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) invalidInput(`${label}: слишком много значений`);
  return value.map((item) => {
    const text = cleanText(item, label, { max: maxLength });
    if (allowed && !allowed.includes(text)) invalidInput(`${label}: недопустимое значение`);
    return text;
  });
}

function cleanPhone(value) {
  const phone = cleanText(value, "Телефон", { max: 30 });
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) invalidInput("Телефон: укажите от 7 до 15 цифр");
  if (!/^[+\d][\d\s()+-]*$/.test(phone)) invalidInput("Телефон: недопустимые символы");
  return phone;
}

function validateBloodPressure(systolic, diastolic) {
  if (!systolic && !diastolic) return;
  if (systolic < 70 || systolic > 260) invalidInput("Систолическое давление: допустимый диапазон 70–260");
  if (diastolic < 40 || diastolic > 160) invalidInput("Диастолическое давление: допустимый диапазон 40–160");
  if (systolic <= diastolic) invalidInput("Артериальное давление: верхнее значение должно быть больше нижнего");
}

function normalizePatientIdentity(patient = {}) {
  return [patient.lastName, patient.firstName, patient.middleName, patient.birthDate]
    .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function normalizePatientPhone(patient = {}) {
  return String(patient.phone || "").replace(/\D/g, "");
}

function findDuplicateSurvey(db, input) {
  const identity = normalizePatientIdentity(input);
  const clinic = clinicKey(input.clinic);
  const phone = normalizePatientPhone(input);
  if (!phone) return null;
  return (db.nurseSurveys || []).find((survey) =>
    clinicKey(survey.patient?.clinic || survey.clinic) === clinic &&
    normalizePatientIdentity(survey.patient) === identity &&
    normalizePatientPhone(survey.patient) === phone
  );
}

function patientReportPdf(survey, visits, tasks) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 46, size: "A4", info: { Title: `Медицинский отчет: ${patientNameFromSurvey(survey)}` } });
    const fontCandidates = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
    const font = fontCandidates.find(existsSync);
    if (font) doc.font(font);
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const line = (label, value) => doc.fontSize(10).text(`${label}: ${value ?? "—"}`, { paragraphGap: 4 });
    doc.fontSize(18).text("Медицинский отчет пациента", { align: "center" }).moveDown();
    line("Пациент", patientNameFromSurvey(survey));
    line("Дата рождения", survey.patient?.birthDate);
    line("Поликлиника", survey.patient?.clinic || survey.clinic);
    line("Телефон", survey.patient?.phone);
    doc.moveDown().fontSize(14).text("Последняя анкета").moveDown(0.4);
    line("Рост, см", survey.measurements?.height || "—");
    if (survey.measurements?.weight > 0) line("Измеренный вес, кг", survey.measurements.weight);
    if (survey.measurements?.rabitoWeight > 0) line("Расчётный вес Rabito, кг", survey.measurements.rabitoWeight);
    line("Индекс массы тела", survey.measurements?.bmi || "—");
    line("Артериальное давление", `${survey.measurements?.systolic || "—"}/${survey.measurements?.diastolic || "—"}`);
    line("Уровень сахара", survey.measurements?.glucoseLevel);
    line("FINDRISC", `${survey.findrisc?.score ?? "—"} — ${survey.findrisc?.level || "—"}`);
    line("Сердечно-сосудистый риск", `${survey.score2?.percent ?? "—"}% — ${survey.score2?.level || "—"}`);
    doc.moveDown().fontSize(14).text("Осмотры врача").moveDown(0.4);
    if (!visits.length) doc.fontSize(10).text("Осмотров пока нет.");
    for (const visit of visits.slice(-20).reverse()) {
      doc.fontSize(11).text(new Date(visit.createdAt).toLocaleDateString("ru-RU"), { continued: true }).text(` — ${visit.diagnosis || "Диагноз не указан"}`);
      if (visit.notes) doc.fontSize(9).fillColor("#444").text(visit.notes).fillColor("black");
    }
    doc.moveDown().fontSize(14).text("Повторные визиты").moveDown(0.4);
    if (!tasks.length) doc.fontSize(10).text("Назначенных повторных визитов нет.");
    for (const task of tasks.slice(-20).reverse()) line(new Date(task.dueAt).toLocaleDateString("ru-RU"), task.status === "completed" ? "Выполнено" : task.title || "Запланировано");
    doc.moveDown().fontSize(8).fillColor("#666").text(`Сформировано ${new Date().toLocaleString("ru-RU")}. Документ предназначен для медицинского работника.`);
    doc.end();
  });
}

function validatePatientProfileInput(body, existing = {}) {
  const birthDate = cleanText(body.birthDate ?? existing.birthDate, "Дата рождения", { required: true, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(`${birthDate}T00:00:00Z`)) || birthDate > new Date().toISOString().slice(0, 10)) invalidInput("Дата рождения: недопустимое значение");
  return {
    ...existing,
    lastName: cleanText(body.lastName ?? existing.lastName, "Фамилия", { required: true, max: 100 }),
    firstName: cleanText(body.firstName ?? existing.firstName, "Имя", { required: true, max: 100 }),
    middleName: cleanText(body.middleName ?? existing.middleName, "Отчество", { max: 100 }),
    birthDate,
    phone: cleanPhone(body.phone ?? existing.phone),
    address: cleanText(body.address ?? existing.address, "Адрес", { max: 300 }),
    clinic: allowedClinic(body.clinic ?? existing.clinic),
    sex: cleanEnum(body.sex ?? existing.sex, "Пол", ["male", "female"]),
    reminderConsent: body.reminderConsent === true || body.reminderConsent === "true",
    reminderChannel: cleanEnum(body.reminderChannel ?? existing.reminderChannel ?? "none", "Канал напоминаний", ["none", "sms", "telegram"], "none"),
    telegramChatId: cleanText(body.telegramChatId ?? existing.telegramChatId, "Telegram Chat ID", { max: 50 })
  };
}

function validateNewPassword(value, label = "Новый пароль") {
  const password = cleanText(value, label, { required: true, max: 200 });
  if (password.length < 5) invalidInput(`${label}: минимум 5 символов`);
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) invalidInput(`${label}: добавьте буквы и цифры`);
  return password;
}

function validateSurveyInput(body, clinicOverride = "") {
  const birthDate = cleanText(body.birthDate, "Дата рождения", { required: true, max: 10 });
  const parsedBirthDate = Date.parse(`${birthDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(parsedBirthDate) || parsedBirthDate > Date.now() || birthDate < "1900-01-01") {
    invalidInput("Дата рождения: недопустимое значение");
  }
  if (body.weight !== undefined && body.weight !== null && typeof body.weight !== "number" && typeof body.weight !== "string") {
    invalidInput("Вес: недопустимое значение");
  }
  const rawWeight = typeof body.weight === "string" ? body.weight.trim().replace(",", ".") : body.weight;
  const hasMeasuredWeight = rawWeight !== undefined && rawWeight !== null && rawWeight !== "";
  const weight = hasMeasuredWeight ? cleanNumber(rawWeight, "Вес", { min: 0, max: 500 }) : 0;
  if (hasMeasuredWeight && weight <= 0) {
    invalidInput("Вес: укажите значение больше 0 и не больше 500 кг");
  }
  const height = hasMeasuredWeight && typeof body.height === "string" ? body.height.trim().replace(",", ".") : body.height;
  const input = {
    lastName: cleanText(body.lastName, "Фамилия", { required: true, max: 100 }),
    firstName: cleanText(body.firstName, "Имя", { required: true, max: 100 }),
    middleName: cleanText(body.middleName, "Отчество", { max: 100 }),
    birthDate,
    phone: cleanPhone(body.phone),
    address: cleanText(body.address, "Адрес", { max: 300 }),
    clinic: allowedClinic(clinicOverride || body.clinic),
    nurseName: cleanText(body.nurseName || body.nurseFullName, "ФИО медсестры", { max: 100 }),
    sex: cleanEnum(body.sex, "Пол", ["male", "female"]),
    age: cleanNumber(body.age, "Возраст", { min: 0, max: 120 }),
    weight,
    height: cleanNumber(height, "Рост", { min: 0, max: 250 }),
    bmi: hasMeasuredWeight ? 0 : cleanNumber(body.bmi, "Индекс массы тела", { min: 0, max: 100 }),
    systolic: cleanNumber(body.systolic, "Систолическое давление", { min: 0, max: 300 }),
    diastolic: cleanNumber(body.diastolic, "Диастолическое давление", { min: 0, max: 200 }),
    arm: cleanNumber(body.arm, "Окружность плеча", { min: 0, max: 200 }),
    rabitoWaist: cleanNumber(body.rabitoWaist || body.waist, "Окружность талии", { min: 0, max: 300 }),
    calf: cleanNumber(body.calf, "Окружность голени", { min: 0, max: 200 }),
    glucoseLevel: cleanNumber(body.glucoseLevel, "Уровень сахара", { min: 0, max: 50 }),
    activity: cleanEnum(body.activity, "Физическая активность", ["yes", "no"]),
    vegetables: cleanEnum(body.vegetables, "Овощи и фрукты", ["yes", "no"]),
    bpMeds: cleanEnum(body.bpMeds, "Препараты от давления", ["yes", "no"]),
    highGlucose: cleanEnum(body.highGlucose, "Высокий сахар", ["yes", "no"]),
    familyDiabetes: cleanEnum(body.familyDiabetes, "Диабет у родственников", ["none", "second", "first"]),
    smoker: cleanEnum(body.smoker, "Курение", ["yes", "no"])
  };
  if (hasMeasuredWeight) {
    if (input.height <= 0) invalidInput("Рост: укажите значение больше 0 для расчёта индекса массы тела");
    if (input.rabitoWaist <= 0) invalidInput("Окружность талии: укажите значение больше 0 для расчёта FINDRISC");
    input.bmi = cleanNumber(Number((weight / ((input.height / 100) ** 2)).toFixed(1)), "Индекс массы тела", { min: 0, max: 100 });
  }
  validateBloodPressure(input.systolic, input.diastolic);
  if (input.glucoseLevel && (input.glucoseLevel < 1.5 || input.glucoseLevel > 35)) invalidInput("Уровень сахара: допустимый диапазон 1,5–35");
  return input;
}

function validateNurseSurveyInput(body) {
  const input = validateSurveyInput(body);
  if (input.nurseName.trim().split(/\s+/).filter(Boolean).length < 2) {
    invalidInput("ФИО медсестры: обязательно укажите фамилию и имя");
  }
  if (!input.phone) invalidInput("Телефон пациента: обязательное поле");
  return input;
}

function cleanLabDate(value, label, required = false) {
  const text = cleanText(value, label, { required, max: 10 });
  if (text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text || text > dushanbeClock().date)) invalidInput(`${label}: недопустимая дата`);
  return text;
}

function validateVisitInput(body) {
  const laboratoryTests = Array.isArray(body.laboratoryTests) ? body.laboratoryTests : [];
  if (laboratoryTests.length > 20) invalidInput("Лабораторные анализы: слишком много значений");
  const input = {
    surveyId: cleanText(body.surveyId, "Пациент", { required: true, max: 100 }),
    weight: cleanNumber(body.weight, "Вес", { min: 0, max: 500 }),
    height: cleanNumber(body.height, "Рост", { min: 0, max: 250 }),
    bmi: cleanNumber(body.bmi, "Индекс массы тела", { min: 0, max: 100 }),
    glucose: cleanNumber(body.glucose, "Уровень сахара", { min: 0, max: 50 }),
    glucoseType: cleanEnum(body.glucoseType, "Тип измерения сахара", ["fasting", "random", "postMeal", "hba1c"], "fasting"),
    diagnosis: cleanText(body.diagnosis, "Диагноз", { max: 500 }),
    systolic: cleanNumber(body.systolic, "Систолическое давление", { min: 0, max: 300 }),
    diastolic: cleanNumber(body.diastolic, "Диастолическое давление", { min: 0, max: 200 }),
    followUpDays: cleanNumber(body.followUpDays, "Срок повторного осмотра", { min: 0, max: 3650 }),
    laboratoryTests: laboratoryTests.map((item) => ({
      test: cleanText(item?.test || item?.name, "Название анализа", { required: true, max: 100 }),
      status: item?.status === 'ordered' ? 'ordered' : labHasResult(item || {}) ? 'received' : 'ordered',
      orderedDate: cleanLabDate(item?.orderedDate || dushanbeClock().date, 'Дата назначения'),
      resultDate: cleanLabDate(item?.resultDate, 'Дата результата'),
      result: cleanText(item?.result, "Результат анализа", { max: 200 }),
      fields: Object.fromEntries(Object.entries(item?.fields && typeof item.fields === "object" ? item.fields : {}).slice(0, 20).map(([key, value]) => [
        cleanText(key, "Поле анализа", { required: true, max: 100 }),
        cleanText(value, "Значение анализа", { max: 200 })
      ]))
    })),
    referrals: cleanTextArray(body.referrals, "Направления", { maxItems: 20 }),
    treatmentPlan: cleanText(body.treatmentPlan, "План лечения", { max: 3000 }),
    diabetesDrugs: cleanTextArray(body.diabetesDrugs, "Препараты от диабета", { allowed: diabetesDrugs, maxItems: 20 }),
    hypertensionDrugs: cleanTextArray(body.hypertensionDrugs, "Препараты от давления", { allowed: hypertensionDrugs, maxItems: 20 }),
    lifestyleRecommendations: cleanTextArray(body.lifestyleRecommendations, "Рекомендации", { allowed: ["diabetesDiet", "physicalActivity"], maxItems: 2 })
  };
  validateBloodPressure(input.systolic, input.diastolic);
  if (input.glucose && (input.glucose < 1.5 || input.glucose > 35)) invalidInput("Уровень сахара: допустимый диапазон 1,5–35");
  for (const lab of input.laboratoryTests) {
    if (lab.status === 'ordered' && labHasResult(lab)) invalidInput('Для анализа с результатом выберите «Результат получен»');
    if (lab.status === 'received' && !lab.resultDate) invalidInput('Укажите дату полученного результата анализа');
  }
  return input;
}

function calculateScore2Lite(input) {
  const age = Number(input.age || 0);
  const systolic = Number(input.systolic || 0);
  const sex = input.sex;
  const smoker = input.smoker === "yes";
  let points = 0;
  if (age >= 50) points += 1;
  if (age >= 60) points += 2;
  if (age >= 70) points += 2;
  if (systolic >= 140) points += 1;
  if (systolic >= 160) points += 1;
  if (systolic >= 180) points += 1;
  if (smoker) points += 2;
  if (sex === "male") points += 1;
  const percent = Math.min(30, Math.max(1, points * 2));
  const level = percent < 5 ? "Низкий" : percent < 10 ? "Умеренный" : "Высокий";
  return { percent, level, highRisk: percent >= 10, note: "Упрощенная оценка без холестерина, не заменяет клиническую шкалу SCORE2." };
}

function referralReasons(input, findrisc, score2) {
  const reasons = [];
  const systolic = Number(input.systolic || 0);
  const score2Factors = [];
  if (Number(input.age || 0) >= 50) score2Factors.push("возраст");
  if (input.sex === "male") score2Factors.push("мужской пол");
  if (input.smoker === "yes") score2Factors.push("курение");
  if (systolic >= 140) score2Factors.push("повышенное САД");
  if (findrisc.highRisk) reasons.push(`FINDRISC: ${findrisc.score} баллов (${findrisc.level})`);
  if (score2.highRisk) reasons.push(`Сердечно-сосудистый риск: ${score2.percent}% (${score2.level})${score2Factors.length ? `; факторы: ${score2Factors.join(", ")}` : ""}`);
  if (systolic >= 140) reasons.push(`Систолическое АД: ${systolic} мм рт.ст.`);
  return reasons;
}

function buildNurseSurvey(body) {
  const findrisc = calculateFindrisc(body);
  const rabitoWeight = calculateRabito(body);
  const score2 = calculateScore2Lite(body);
  const reasons = referralReasons(body, findrisc, score2);
  const survey = {
    id: crypto.randomUUID(),
    patient: {
      lastName: body.lastName,
      firstName: body.firstName,
      middleName: body.middleName,
      birthDate: body.birthDate,
      phone: body.phone,
      address: body.address,
      clinic: body.clinic,
      sex: body.sex
    },
    nurse: {
      fullName: body.nurseName || body.nurseFullName || "",
      source: body.nurseName || body.nurseFullName ? "survey" : ""
    },
    measurements: {
      age: Number(body.age || 0),
      weight: Number(body.weight || 0),
      weightSource: Number(body.weight || 0) > 0 ? "measured" : rabitoWeight > 0 ? "rabito" : "",
      height: Number(body.height || 0),
      bmi: Number(body.bmi || 0),
      systolic: Number(body.systolic || 0),
      diastolic: Number(body.diastolic || 0),
      arm: Number(body.arm || 0),
      waist: Number(body.rabitoWaist || body.waist || 0),
      rabitoWaist: Number(body.rabitoWaist || body.waist || 0),
      calf: Number(body.calf || 0),
      rabitoWeight,
      glucoseLevel: Number(body.glucoseLevel || 0)
    },
    answers: body,
    findrisc,
    score2,
    referralReasons: reasons,
    needsDoctor: reasons.length > 0,
    createdAt: new Date().toISOString()
  };
  survey.qualityWarnings = qualityFlagsForSurvey(survey);
  return survey;
}

function appendActivity(db, event) {
  db.activityEvents ||= [];
  db.activityEvents.push({
    id: crypto.randomUUID(),
    type: event.type,
    actorRole: event.actorRole || "",
    actorId: event.actorId || "",
    actorName: event.actorName || "",
    clinic: event.clinic || "",
    surveyId: event.surveyId || "",
    visitId: event.visitId || "",
    patientName: event.patientName || "",
    details: event.details || "",
    createdAt: new Date().toISOString()
  });
  if (db.activityEvents.length > 5000) db.activityEvents = db.activityEvents.slice(-5000);
}

function patientNameFromSurvey(survey) {
  return [survey?.patient?.lastName, survey?.patient?.firstName, survey?.patient?.middleName].filter(Boolean).join(" ");
}

function publicParticipant(participant) {
  return {
    id: participant.id,
    fullName: participant.fullName,
    clinic: participant.clinic,
    specialty: participant.specialty,
    createdAt: participant.createdAt || null,
    preCompletedAt: participant.preCompletedAt || null,
    postCompletedAt: participant.postCompletedAt || null
  };
}

function shuffle(values) {
  return [...values].sort(() => crypto.randomInt(0, 1000000) - 500000);
}

function preQuestionsForParticipant(participant) {
  if (!Array.isArray(participant.preQuestionIds) || participant.preQuestionIds.length !== 10) {
    participant.preQuestionIds = shuffle(preTestQuestions.map((question) => question.id)).slice(0, 10);
  }
  return participant.preQuestionIds
    .map((id) => preTestQuestions.find((question) => question.id === id))
    .filter(Boolean)
    .map(({ answer, ...question }) => question);
}

function publicQuestions(questions = preTestQuestions) {
  return questions.map(({ answer, ...question }) => question);
}

function scoreTest(questionIds, answers = {}) {
  let correct = 0;
  const details = questionIds.map((id) => {
    const question = preTestQuestions.find((item) => item.id === Number(id));
    const selected = answers[id] || answers[String(id)] || "";
    const isCorrect = question?.answer === selected;
    if (isCorrect) correct += 1;
    return {
      questionId: Number(id),
      questionText: question?.text || "",
      options: question?.options || {},
      selected,
      selectedText: question?.options?.[selected] || "",
      correctAnswer: question?.answer,
      correctText: question?.options?.[question?.answer] || "",
      isCorrect
    };
  });
  return { correct, total: questionIds.length, percent: Math.round((correct / questionIds.length) * 100), details };
}

function scoreQuestionSet(questions, answers = {}) {
  let correct = 0;
  const details = questions.map((question) => {
    const selected = answers[question.id] || answers[String(question.id)] || "";
    const isCorrect = selected === question.answer;
    if (isCorrect) correct += 1;
    return {
      questionId: question.id,
      questionText: question.text,
      options: question.options,
      selected,
      selectedText: question.options?.[selected] || "",
      correctAnswer: question.answer,
      correctText: question.options?.[question.answer] || "",
      isCorrect
    };
  });
  const total = questions.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, percent, passed: percent >= 70, details };
}

function remapQuestionOptions(question, order) {
  const letters = ["A", "B", "C", "D"];
  const entries = order.map((oldLetter, index) => [letters[index], question.options[oldLetter]]).filter(([, text]) => text);
  return {
    ...question,
    options: Object.fromEntries(entries),
    answer: entries.find(([newLetter, text]) => text === question.options[question.answer])?.[0] || question.answer
  };
}

function publicNurseParticipant(participant) {
  return {
    id: participant.id,
    fullName: participant.fullName,
    clinic: participant.clinic,
    position: participant.position || "",
    createdAt: participant.createdAt || null,
    preCompletedAt: participant.preCompletedAt || null,
    postCompletedAt: participant.postCompletedAt || null
  };
}

function publicNurseQuestions(type) {
  const questions = type === "post" ? remappedNursePostQuestions : nursePreQuestions;
  return questions.map(({ answer, ...question }) => question);
}

function enrichTrainingAttempt(attempt) {
  if (!attempt) return attempt;
  if (attempt.type === "task") return {
    ...attempt,
    task: postTrainingTasks.find((task) => task.id === attempt.taskId) || null
  };
  const instrument = attempt.type === "post" ? "Инструмент 3" : "Инструмент 2";
  const title = attempt.type === "post" ? "Тест после обучения для оценки итогового уровня знаний" : "Тест до обучения для оценки исходного уровня знаний";
  return {
    ...attempt,
    instrument,
    title,
    details: (attempt.details || []).map((detail) => {
      const question = preTestQuestions.find((item) => item.id === Number(detail.questionId));
      return {
        ...detail,
        questionText: detail.questionText || question?.text || "",
        options: detail.options || question?.options || {},
        selectedText: detail.selectedText || question?.options?.[detail.selected] || "",
        correctText: detail.correctText || question?.options?.[detail.correctAnswer || question?.answer] || "",
        correctAnswer: detail.correctAnswer || question?.answer || ""
      };
    })
  };
}

function attemptsForParticipant(db, participantId) {
  return db.trainingAttempts
    .filter((attempt) => attempt.participantId === participantId)
    .map(enrichTrainingAttempt);
}

function publicPostTasks() {
  return postTrainingTasks.map((task) => ({
    ...task,
    fields: task.fields?.map(([name, label]) => [name, label]),
    cases: task.cases?.map((item) => Array.isArray(item) ? item[0] : item),
    questions: task.questions?.map(({ answer, ...question }) => question)
  }));
}

function scorePostTask(task, answers = {}) {
  let correct = 0;
  const details = [];
  if (task.mode === "findrisc") {
    for (const [name, label, expected] of task.fields || []) {
      const selected = String(answers[name] || "").trim();
      const isCorrect = selected.toLowerCase() === String(expected).trim().toLowerCase();
      if (isCorrect) correct += 1;
      details.push({ label, selected, correctAnswer: expected, isCorrect });
    }
  } else if (task.mode === "singleCases") {
    for (const [index, item] of (task.cases || []).entries()) {
      const [caseText, expected] = item;
      const selected = answers[`case${index}`] || "";
      const isCorrect = selected === expected;
      if (isCorrect) correct += 1;
      details.push({ label: caseText, selected, correctAnswer: expected, isCorrect });
    }
  } else if (task.mode === "routing") {
    for (const [index, item] of (task.cases || []).entries()) {
      const [caseText, specialist, urgency] = item;
      const selectedSpecialist = answers[`case${index}`]?.specialist || "";
      const selectedUrgency = answers[`case${index}`]?.urgency || "";
      const specialistCorrect = selectedSpecialist === specialist;
      const urgencyCorrect = selectedUrgency === urgency;
      if (specialistCorrect) correct += 1;
      if (urgencyCorrect) correct += 1;
      details.push({ label: caseText, selected: `${selectedSpecialist}, ${selectedUrgency}`, correctAnswer: `${specialist}, ${urgency}`, isCorrect: specialistCorrect && urgencyCorrect });
    }
  } else if (task.mode === "mcq") {
    for (const [index, question] of (task.questions || []).entries()) {
      const selected = answers[`q${index}`] || "";
      const isCorrect = selected === question.answer;
      if (isCorrect) correct += 1;
      details.push({
        label: question.text,
        selected,
        selectedText: question.options?.[selected] || "",
        correctAnswer: question.answer,
        correctText: question.options?.[question.answer] || "",
        isCorrect
      });
    }
  }
  return { correct, total: task.maxScore, percent: Math.round((correct / task.maxScore) * 100), details };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      return send(res, 200, {
        ok: true,
        server: true,
        database: await databaseHealth()
      });
    } catch (error) {
      console.error("Health check failed:", error);
      return send(res, 503, {
        ok: false,
        server: true,
        database: {
          mode: DATABASE_URL ? "postgres" : "file",
          ok: false,
          error: error.message || "Database unavailable"
        }
      });
    }
  }

  const session = await getSession(req);
  const db = await readDb();

  if (req.method === "POST" && url.pathname === "/api/assistant") {
    if (!session || !["admin", "doctor"].includes(session.userType)) return send(res, 403, { error: "Требуется вход в систему" });
    if (!enforceUserRateLimit(req, res, session, "assistant", 20, 60 * 1000)) return;
    if (!GOOGLE_CLOUD_PROJECT) return send(res, 503, { error: "AI-консультант еще не подключен: на сервере не задан GOOGLE_CLOUD_PROJECT." });
    const body = await parseBody(req);
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages = rawMessages
      .slice(-8)
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.content || "").trim()
      }))
      .filter((message) => message.content);
    if (!messages.length) return send(res, 400, { error: "Напишите вопрос консультанту." });
    try {
      const appName = assistantAppName(body.app || "");
      const answer = await askGeminiAssistant({
        messages,
        prompt: buildAssistantSystemPrompt(db, session, appName)
      });
      return send(res, 200, { answer, model: GEMINI_MODEL });
    } catch (error) {
      console.error("Assistant failed:", error);
      return send(res, 502, { error: "AI-консультант временно недоступен. Попробуйте позже." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/server-info") {
    const urls = getLanUrls();
    const currentBaseUrl = requestBaseUrl(req);
    const isLocalRequest = /(^https?:\/\/localhost\b)|(^https?:\/\/127\.0\.0\.1\b)|(^https?:\/\/\[::1\])/.test(currentBaseUrl);
    const preferredBaseUrl = isLocalRequest
      ? urls.find((item) => !item.includes("localhost")) || urls[0]
      : currentBaseUrl;
    return send(res, 200, {
      urls,
      apps: {
        admin: `${preferredBaseUrl}${ADMIN_APP_PATH}`,
        doctor: `${preferredBaseUrl}${DOCTOR_APP_PATH}`,
        survey: `${preferredBaseUrl}${SURVEY_APP_PATH}`
        , training: `${preferredBaseUrl}${TRAINING_APP_PATH}`,
        nurseTraining: `${preferredBaseUrl}${NURSE_TRAINING_APP_PATH}`,
        investor: `${preferredBaseUrl}${INVESTOR_APP_PATH}`,
        monitor: `${preferredBaseUrl}${MONITOR_APP_PATH}`
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/login/admin") {
    const rateLimitKey = enforceLoginRateLimit(req, res, "admin");
    if (!rateLimitKey) return;
    const body = await parseBody(req);
    const admin = db.admins.find((item) => item.username === body.username);
    if (!admin || !verifyPassword(body.password || "", admin.passwordHash)) {
      securityEvent("login_failed", req, { accountType: "admin" });
      return send(res, 401, { error: "Неверный логин или пароль" });
    }
    clearRateLimit(rateLimitKey);
    const sid = await createSession("admin", admin.id);
    securityEvent("login_succeeded", req, { accountType: "admin", actorId: admin.id });
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, sid) });
  }

  if (req.method === "POST" && url.pathname === "/api/login/doctor") {
    const rateLimitKey = enforceLoginRateLimit(req, res, "doctor");
    if (!rateLimitKey) return;
    const body = await parseBody(req);
    const doctor = db.doctors.find((item) => item.login === body.login);
    if (!doctor || !verifyPassword(body.accessKey || "", doctor.accessKeyHash)) {
      securityEvent("login_failed", req, { accountType: "doctor" });
      return send(res, 401, { error: "Неверный логин или ключ" });
    }
    clearRateLimit(rateLimitKey);
    const sid = await createSession("doctor", doctor.id);
    securityEvent("login_succeeded", req, { accountType: "doctor", actorId: doctor.id });
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, sid) });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    securityEvent("logout", req, { accountType: session?.userType || "anonymous", actorId: session?.userId || null });
    await clearSession(req);
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    if (!session) return send(res, 200, { user: null });
    if (session.userType === "admin") {
      const admin = db.admins.find((item) => item.id === session.userId);
      return send(res, 200, { user: { type: "admin", id: admin.id, name: admin.name, role: admin.role, clinic: admin.clinic || "" } });
    }
    const doctor = db.doctors.find((item) => item.id === session.userId);
    return send(res, 200, { user: { type: "doctor", id: doctor.id, name: doctor.fullName, specialty: doctor.specialty, clinic: doctor.clinic } });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const tab = url.searchParams.get("tab") || "stats";
    const viewDb = scopedDbForAdmin(db, session);
    const diabetesDrugCounts = countSelected(viewDb.doctorVisits.flatMap((visit) => visit.diabetesDrugs || []));
    const hypertensionDrugCounts = countSelected(viewDb.doctorVisits.flatMap((visit) => visit.hypertensionDrugs || []));
    const dashboard = {
      stats: buildStats(viewDb),
      canEdit: canMutateAdmin(session, db),
      canCorrectSurveys: ["owner", "manager", "head_nurse"].includes(adminRole(session, db)),
      canManageAdmins: canManageAdmins(session, db),
      adminRoles,
      drugStats: { diabetesDrugCounts, hypertensionDrugCounts },
      trainingStats: buildTrainingStats(viewDb),
      nurseTrainingStats: buildNurseTrainingStats(viewDb),
      clinicScope: adminClinicScope(session, db)
    };
    if (tab === "control" || tab === "center") {
      dashboard.careControl = buildCareControl(viewDb);
      if (!canManageAdmins(session, db)) dashboard.careControl.dailyReports.chatId = "";
    }
    if (tab === "doctors") dashboard.doctors = viewDb.doctors.map(publicDoctor);
    if (tab === "training") {
      dashboard.trainingParticipants = viewDb.trainingParticipants.map(publicParticipant);
      dashboard.trainingAttempts = viewDb.trainingAttempts.map(enrichTrainingAttempt);
    }
    if (tab === "nurseTraining") {
      dashboard.nurseTrainingParticipants = viewDb.nurseTrainingParticipants.map(publicNurseParticipant);
      dashboard.nurseTrainingAttempts = viewDb.nurseTrainingAttempts;
    }
    if (tab === "surveys") dashboard.surveys = viewDb.nurseSurveys;
    if (tab === "visits") {
      dashboard.visits = viewDb.doctorVisits;
      dashboard.doctors = viewDb.doctors.map(({ id, fullName, clinic }) => ({ id, fullName, clinic }));
      dashboard.surveys = viewDb.nurseSurveys.map(({ id, patient }) => ({
        id,
        patient: { lastName: patient?.lastName, firstName: patient?.firstName, middleName: patient?.middleName, clinic: patient?.clinic }
      }));
    }
    if (tab === "operations") {
      dashboard.surveyClinics = [...new Set(viewDb.nurseSurveys.map((survey) => survey.patient?.clinic || survey.clinic).filter(Boolean))];
      dashboard.reminderQueue = viewDb.reminderQueue || [];
      dashboard.clinicTargets = db.settings?.clinicTargets || {};
    }
    if (tab === "audit") dashboard.activityEvents = [...(viewDb.activityEvents || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 1000);
    if (tab === "access") dashboard.admins = (canManageAdmins(session, db) ? db.admins : viewDb.admins).map(publicAdmin);
    return send(res, 200, dashboard);
  }

  if (req.method === "GET" && url.pathname === "/api/admin/care-control.xls") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const report = buildCareControlExcel(scopedDbForAdmin(db, session));
    return send(res, 200, report, {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-control-${dateKey(new Date().toISOString())}.xls"`
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/backup") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может создавать резервные копии" });
    const status = await createSecureBackup(db, "manual");
    return send(res, 201, { status });
  }

  if (req.method === 'GET' && url.pathname === '/api/doctor/waiting-patients') {
    if (session?.userType !== 'doctor') return send(res, 403, { error: 'Нет доступа' });
    const doctor = db.doctors.find(item => item.id === session.userId);
    return send(res, 200, { patients: waitingPatients(db).filter(row => clinicKey(row.clinic) === clinicKey(doctor?.clinic)) });
  }

  if (req.method === 'PUT' && url.pathname === '/api/patient-outreach') {
    if (!session) return send(res, 403, { error: 'Нет доступа' });
    const body = await parseBody(req);
    const survey = db.nurseSurveys.find(item => item.id === body.surveyId);
    if (!survey) return send(res, 404, { error: 'Пациент не найден' });
    const actor = session.userType === 'doctor' ? db.doctors.find(item => item.id === session.userId) : adminAccount(session, db);
    const allowed = session.userType === 'doctor' ? doctorCanAccessSurvey(actor, survey)
      : canMutateAdmin(session, db) || (actor?.role === 'head_nurse' && adminCanAccessClinic(session, db, survey.patient?.clinic || survey.clinic));
    if (!allowed) return send(res, 403, { error: 'Нет доступа' });
    const status = cleanEnum(body.status, 'Статус контакта', ['pending', 'called', 'scheduled', 'declined']);
    const before = survey.outreach?.status || 'pending';
    survey.outreach = { status, updatedAt: new Date().toISOString(), actorId: session.userId };
    survey.changeHistory ||= [];
    survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: survey.outreach.updatedAt, actorId: session.userId,
      actorName: actor?.fullName || actor?.name || '', changes: [{ field: 'outreach', before, after: status }] });
    appendActivity(db, { type: 'patient_outreach', actorRole: session.userType, actorId: session.userId, actorName: actor?.fullName || actor?.name || '',
      surveyId: survey.id, patientName: patientNameFromSurvey(survey), clinic: survey.patient?.clinic || survey.clinic, details: `Контакт с пациентом: ${status}` });
    await writeDb(db);
    return send(res, 200, { outreach: survey.outreach });
  }

  if (req.method === 'PUT' && url.pathname === '/api/doctor/lab-result') {
    if (session?.userType !== 'doctor') return send(res, 403, { error: 'Нет доступа' });
    const body = await parseBody(req);
    const visit = db.doctorVisits.find(item => item.id === body.visitId);
    const survey = db.nurseSurveys.find(item => item.id === visit?.surveyId);
    const actor = db.doctors.find(item => item.id === session.userId);
    if (!visit || !survey || !doctorCanAccessSurvey(actor, survey)) return send(res, 403, { error: 'Нет доступа к анализу' });
    const index = Number(body.index);
    const previous = Number.isInteger(index) && index >= 0 ? visit.laboratoryTests?.[index] : null;
    if (!previous) return send(res, 404, { error: 'Анализ не найден' });
    const result = cleanText(body.result, 'Результат', { required: true, max: 200 });
    const resultDate = cleanLabDate(body.resultDate, 'Дата результата', true);
    const updated = { ...previous, result, resultDate, status: 'received' };
    visit.laboratoryTests[index] = updated;
    survey.changeHistory ||= [];
    survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId: actor.id, actorName: actor.fullName,
      changes: patientChanges(previous, updated).map(change => ({ ...change, field: `${previous.test}: ${change.field}` })) });
    await writeDb(db);
    return send(res, 200, { visit });
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/daily-reports") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может настраивать отчёты" });
    const body = await parseBody(req);
    db.settings ||= {};
    db.settings.dailyReports = {
      enabled: Boolean(body.enabled),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time || "")) ? String(body.time) : "18:00",
      chatId: cleanText(body.chatId, "Telegram Chat ID", { max: 50 }),
      timezone: "Asia/Dushanbe",
      lastSentDate: db.settings.dailyReports?.lastSentDate || ""
    };
    await writeDb(db);
    return send(res, 200, { settings: { ...db.settings.dailyReports, tokenConfigured: Boolean(TELEGRAM_BOT_TOKEN) } });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/daily-reports/test") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может отправлять тестовый отчёт" });
    const body = await parseBody(req);
    const result = await sendTelegramReport(scopedDbForAdmin(db, session), body.chatId);
    return send(res, 200, result);
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/account") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const admin = db.admins.find((item) => item.id === session.userId);
    if (!admin) return send(res, 404, { error: "Администратор не найден" });
    const body = await parseBody(req);
    const currentPassword = cleanText(body.currentPassword, "Текущий пароль", { required: true, max: 200 });
    if (!verifyPassword(currentPassword, admin.passwordHash)) return send(res, 401, { error: "Текущий пароль указан неверно" });
    const newPassword = validateNewPassword(body.newPassword);
    if (verifyPassword(newPassword, admin.passwordHash)) return send(res, 400, { error: "Новый пароль должен отличаться от текущего" });
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    invalidateUserSessions(db, "admin", admin.id);
    appendActivity(db, {
      type: "admin_password_changed",
      actorRole: "admin",
      actorId: admin.id,
      actorName: admin.name,
      details: "Администратор изменил свой пароль; старые сеансы завершены"
    });
    await writeDb(db);
    return send(res, 200, { ok: true, currentSessionEnded: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/clinic-targets") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав" });
    const body = await parseBody(req);
    const clinic = allowedClinic(body.clinic);
    db.settings.clinicTargets ||= {};
    db.settings.clinicTargets[clinic] = {
      monthlyPatients: Math.max(0, Number(body.monthlyPatients || 0)),
      monthlyVisits: Math.max(0, Number(body.monthlyVisits || 0)),
      followUpCompletionPercent: Math.min(100, Math.max(0, Number(body.followUpCompletionPercent || 0)))
    };
    await writeDb(db);
    return send(res, 200, { targets: db.settings.clinicTargets });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/admin/patients/")) {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!survey) return send(res, 404, { error: "Анкета пациента не найдена" });
    if (!adminCanAccessClinic(session, db, survey.patient?.clinic || survey.clinic)) return send(res, 403, { error: "Нет доступа к этой поликлинике" });
    return send(res, 200, {
      survey,
      visits: (db.doctorVisits || []).filter((item) => item.surveyId === id),
      tasks: (db.patientTasks || []).filter((item) => item.surveyId === id),
      events: (db.activityEvents || []).filter((item) => item.surveyId === id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      nextAction: buildCareControl(db).registry.find((item) => item.id === id)?.nextAction || "Наблюдение по плану"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/patients/import") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для импорта" });
    const body = await parseBody(req);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    if (!rows.length) return send(res, 400, { error: "Передайте строки CSV/Excel" });
    const imported = [], skipped = [], errors = [];
    for (const [index, row] of rows.entries()) {
      try {
        const input = validateSurveyInput({
          ...row,
          sex: row.sex === "male" || row.sex === "Мужской" ? "male" : "female",
          age: Number(row.age || 0), weight: row.weight === "" ? undefined : Number(row.weight || 0), height: row.height === "" ? undefined : Number(row.height || 0),
          clinic: allowedClinic(row.clinic), nurseName: row.nurseName || "Импорт из файла", activity: row.activity || "no", vegetables: row.vegetables || "no", bpMeds: row.bpMeds || "no", highGlucose: row.highGlucose || "no", familyDiabetes: row.familyDiabetes || "none", smoker: row.smoker || "no"
        });
        const duplicate = findDuplicateSurvey(db, input);
        if (duplicate) { skipped.push({ row: index + 2, reason: "Дубликат", duplicateId: duplicate.id }); continue; }
        const survey = buildNurseSurvey(input);
        db.nurseSurveys.push(survey);
        imported.push({ row: index + 2, id: survey.id, patientName: patientNameFromSurvey(survey) });
      } catch (error) { errors.push({ row: index + 2, error: String(error.message || error) }); }
    }
    if (imported.length) { appendActivity(db, { type: "patients_imported", actorRole: "admin", actorId: session.userId, actorName: adminAccount(session, db)?.name || "", details: `Импортировано пациентов: ${imported.length}` }); await writeDb(db); }
    return send(res, 200, { imported, skipped, errors });
  }

  if (req.method === "PUT" && /^\/api\/admin\/patients\/[^/]+\/answers$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').at(-2));
    const survey = db.nurseSurveys.find(item => item.id === id);
    if (!survey) return send(res, 404, { error: "Анкета не найдена" });
    if (!canCorrectSurvey(session, db, survey)) return send(res, 403, { error: "Можно исправлять только анкеты своей поликлиники" });
    const body = await parseBody(req);
    const input = { ...survey.answers, ...survey.measurements, ...survey.patient };
    const changes = [];
    for (const field of ['activity', 'vegetables', 'bpMeds', 'highGlucose', 'familyDiabetes', 'smoker', 'systolic', 'diastolic']) {
      if (body[field] === undefined) continue;
      const value = ['systolic', 'diastolic'].includes(field)
        ? cleanNumber(body[field], field, { min: 1, max: field === 'systolic' ? 300 : 200 })
        : cleanEnum(body[field], field, field === 'familyDiabetes' ? ['none', 'second', 'first'] : ['yes', 'no']);
      if (input[field] !== value) changes.push({ field, before: input[field] ?? '', after: value });
      input[field] = value;
    }
    validateBloodPressure(input.systolic, input.diastolic);
    if (changes.length) {
      survey.answers = { ...survey.answers, ...Object.fromEntries(changes.map(item => [item.field, item.after])) };
      survey.measurements.systolic = input.systolic;
      survey.measurements.diastolic = input.diastolic;
      survey.findrisc = calculateFindrisc(input);
      survey.score2 = calculateScore2Lite(input);
      survey.referralReasons = referralReasons(input, survey.findrisc, survey.score2);
      survey.needsDoctor = survey.referralReasons.length > 0;
      survey.qualityWarnings = qualityFlagsForSurvey(survey);
      survey.updatedAt = new Date().toISOString();
      survey.changeHistory ||= [];
      survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: survey.updatedAt, actorId: session.userId, actorName: adminAccount(session, db)?.name || '', changes });
      appendActivity(db, { type: 'survey_answers_corrected', actorRole: 'admin', actorId: session.userId, actorName: adminAccount(session, db)?.name || '', surveyId: id, clinic: survey.patient.clinic, patientName: patientNameFromSurvey(survey), details: 'Исправлены ответы анкеты, риск пересчитан' });
      await writeDb(db);
    }
    return send(res, 200, { survey });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/patients/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    const body = await parseBody(req);
    const updatedPatient = validatePatientProfileInput(body, survey.patient || {});
    const changes = patientChanges(survey.patient || {}, updatedPatient);
    survey.patient = updatedPatient;
    if (changes.length) {
      survey.changeHistory ||= [];
      survey.changeHistory.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId: session.userId,
        actorName: adminAccount(session, db)?.name || '', changes });
    }
    survey.updatedAt = new Date().toISOString();
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "patient_updated", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: survey.patient.clinic, surveyId: survey.id, patientName: patientNameFromSurvey(survey), details: "Обновлена карточка пациента" });
    await writeDb(db);
    return send(res, 200, { survey });
  }

  if (req.method === "POST" && url.pathname.endsWith("/archive") && url.pathname.startsWith("/api/admin/patients/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = decodeURIComponent(url.pathname.split("/").at(-2));
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    const body = await parseBody(req);
    survey.archivedAt = body.archived ? new Date().toISOString() : null;
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: survey.archivedAt ? "patient_archived" : "patient_restored", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: survey.patient?.clinic || "", surveyId: survey.id, patientName: patientNameFromSurvey(survey), details: survey.archivedAt ? "Карточка пациента архивирована" : "Карточка пациента восстановлена" });
    await writeDb(db);
    return send(res, 200, { survey });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/patients/merge") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const sourceId = cleanText(body.sourceId, "Дубликат", { required: true, max: 100 });
    const targetId = cleanText(body.targetId, "Основная карточка", { required: true, max: 100 });
    if (sourceId === targetId) return send(res, 400, { error: "Выберите две разные карточки" });
    const source = db.nurseSurveys.find((item) => item.id === sourceId);
    const target = db.nurseSurveys.find((item) => item.id === targetId);
    if (!source || !target) return send(res, 404, { error: "Одна из карточек не найдена" });
    if (clinicKey(source.patient?.clinic) !== clinicKey(target.patient?.clinic)) return send(res, 400, { error: "Объединять можно только пациентов одной поликлиники" });
    for (const collection of [db.doctorVisits, db.patientTasks, db.appointments, db.reminderQueue]) {
      for (const item of collection || []) if (item.surveyId === sourceId) item.surveyId = targetId;
    }
    source.archivedAt = new Date().toISOString();
    source.mergedIntoId = targetId;
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "patient_merged", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: target.patient?.clinic || "", surveyId: targetId, patientName: patientNameFromSurvey(target), details: `Объединена карточка-дубликат ${sourceId}` });
    await writeDb(db);
    return send(res, 200, { source, target });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/admins") {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может управлять доступами" });
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const password = validateNewPassword(body.password, "Пароль");
    const role = adminRoles[body.role] ? body.role : "observer";
    const clinic = role === "head_nurse" ? allowedClinic(body.clinic) : "";
    if (!name || !username || !password) return send(res, 400, { error: "ФИО, логин и пароль обязательны" });
    if (db.admins.some((admin) => admin.username === username)) return send(res, 409, { error: "Такой логин уже используется" });
    const admin = {
      id: crypto.randomUUID(),
      name,
      username,
      role,
      clinic,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    db.admins.push(admin);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "admin_created", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", details: `Создан администратор: ${admin.name}; роль: ${admin.role}` });
    await writeDb(db);
    return send(res, 201, { admin: publicAdmin(admin) });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/admins/")) {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может управлять доступами" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const admin = db.admins.find((item) => item.id === id);
    if (!admin) return send(res, 404, { error: "Администратор не найден" });
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const role = adminRoles[body.role] ? body.role : admin.role;
    const clinic = role === "head_nurse" ? allowedClinic(body.clinic || admin.clinic) : "";
    if (!name || !username) return send(res, 400, { error: "ФИО и логин обязательны" });
    if (db.admins.some((item) => item.id !== admin.id && item.username === username)) return send(res, 409, { error: "Такой логин уже используется" });
    const ownerCount = db.admins.filter((item) => item.role === "owner").length;
    if (admin.role === "owner" && role !== "owner" && ownerCount <= 1) return send(res, 400, { error: "Нельзя оставить систему без главного администратора" });
    admin.name = name;
    admin.username = username;
    admin.role = role;
    admin.clinic = clinic;
    if (password) {
      admin.passwordHash = hashPassword(validateNewPassword(password, "Новый пароль"));
      invalidateUserSessions(db, "admin", admin.id);
    }
    admin.updatedAt = new Date().toISOString();
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "admin_updated", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", details: `Изменён администратор: ${admin.name}; роль: ${admin.role}${password ? "; пароль сброшен" : ""}` });
    await writeDb(db);
    return send(res, 200, { admin: publicAdmin(admin), currentSessionEnded: Boolean(password && admin.id === session.userId) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/admins/")) {
    if (!canManageAdmins(session, db)) return send(res, 403, { error: "Только главный администратор может управлять доступами" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    if (id === session.userId) return send(res, 400, { error: "Нельзя удалить свой текущий доступ" });
    const admin = db.admins.find((item) => item.id === id);
    if (!admin) return send(res, 404, { error: "Администратор не найден" });
    const ownerCount = db.admins.filter((item) => item.role === "owner").length;
    if (admin.role === "owner" && ownerCount <= 1) return send(res, 400, { error: "Нельзя удалить последнего главного администратора" });
    db.admins = db.admins.filter((item) => item.id !== id);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "admin_deleted", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", details: `Удалён администратор: ${admin.name}` });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/training-answer-keys.csv") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    return send(res, 200, buildTrainingAnswerKeysCsv(), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="doctor-training-answer-keys-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/investor/dashboard") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Требуется вход администратора" });
    return send(res, 200, buildInvestorDashboard(db));
  }

  if (req.method === "GET" && url.pathname === "/api/investor/report.csv") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Требуется вход администратора" });
    return send(res, 200, buildInvestorReportCsv(db), {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-investor-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/monitor/dashboard") {
    return send(res, 200, buildOperationsMonitor(db, Object.fromEntries(url.searchParams)));
  }

  if (req.method === "GET" && url.pathname === "/api/monitor/report.csv") {
    const report = buildOperationsReportCsv(db, Object.fromEntries(url.searchParams));
    return send(res, 200, report, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-clinic-monitor-${new Date().toISOString().slice(0, 10)}.csv"`
    });
  }

  if (req.method === "GET" && url.pathname === "/api/monitor/weekly-report.docx") {
    const period = monitorReportPeriod(Object.fromEntries(url.searchParams));
    const report = await buildWeeklyMonitorReportDocx(db, period, {
      buildRows: buildPublicOperationsMonitorRows,
      dateKey,
      clinicKey
    });
    return send(res, 200, report, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="e-clinic-weekly-${period.from}-${period.to}.docx"`,
      "Cache-Control": "no-store"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/training-participants") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const participant = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      clinic: allowedClinic(body.clinic),
      specialty: body.specialty || "",
      phone: body.phone || "",
      createdAt: new Date().toISOString()
    };
    db.trainingParticipants.push(participant);
    await writeDb(db);
    return send(res, 201, { participant: publicParticipant(participant) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/training-participants/") && url.pathname.includes("/attempts/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const [, , , , participantId, , phase] = url.pathname.split("/");
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    if (!["pre", "post"].includes(phase)) return send(res, 400, { error: "Неверный тип теста" });
    db.trainingAttempts = db.trainingAttempts.filter((attempt) => {
      if (attempt.participantId !== participantId) return true;
      if (phase === "pre") return attempt.type !== "pre";
      return attempt.type !== "task" && attempt.type !== "post";
    });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/training-participants/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    db.trainingParticipants = db.trainingParticipants.filter((participant) => participant.id !== id);
    db.trainingAttempts = db.trainingAttempts.filter((attempt) => attempt.participantId !== id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/nurse-training-participants") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const participant = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      clinic: allowedClinic(body.clinic),
      position: body.position || "Медсестра",
      phone: body.phone || "",
      createdAt: new Date().toISOString()
    };
    db.nurseTrainingParticipants.push(participant);
    await writeDb(db);
    return send(res, 201, { participant: publicNurseParticipant(participant) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/nurse-training-participants/") && url.pathname.includes("/attempts/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const [, , , , participantId, , phase] = url.pathname.split("/");
    const participant = db.nurseTrainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    if (!["pre", "post"].includes(phase)) return send(res, 400, { error: "Неверный тип теста" });
    db.nurseTrainingAttempts = db.nurseTrainingAttempts.filter((attempt) =>
      attempt.participantId !== participantId || attempt.type !== phase
    );
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/nurse-training-participants/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    db.nurseTrainingParticipants = db.nurseTrainingParticipants.filter((participant) => participant.id !== id);
    db.nurseTrainingAttempts = db.nurseTrainingAttempts.filter((attempt) => attempt.participantId !== id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/doctors") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    if (db.doctors.some((item) => item.login === String(body.login || "").trim())) return send(res, 409, { error: "Такой логин уже используется" });
    const accessKey = body.accessKey ? validateNewPassword(body.accessKey, "Пароль врача") : `${crypto.randomBytes(6).toString("base64url")}7a`;
    const doctor = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      login: body.login,
      accessKeyHash: hashPassword(accessKey),
      passport: body.passport,
      clinic: allowedClinic(body.clinic),
      specialty: body.specialty,
      experienceYears: Number(body.experienceYears || 0),
      createdAt: new Date().toISOString()
    };
    db.doctors.push(doctor);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "doctor_created", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: doctor.clinic, details: `Создан профиль врача: ${doctor.fullName}` });
    await writeDb(db);
    return send(res, 201, { doctor: publicDoctor(doctor), accessKey });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/doctors/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = url.pathname.split("/").pop();
    const doctor = db.doctors.find((item) => item.id === id);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    if (db.doctors.some((item) => item.id !== doctor.id && item.login === String(body.login || "").trim())) return send(res, 409, { error: "Такой логин уже используется" });
    Object.assign(doctor, {
      fullName: body.fullName,
      login: body.login,
      passport: body.passport,
      clinic: allowedClinic(body.clinic),
      specialty: body.specialty,
      experienceYears: Number(body.experienceYears || 0)
    });
    if (body.accessKey) {
      doctor.accessKeyHash = hashPassword(validateNewPassword(body.accessKey, "Новый пароль врача"));
      invalidateUserSessions(db, "doctor", doctor.id);
    }
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "doctor_updated", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: doctor.clinic, details: `Изменён профиль врача: ${doctor.fullName}${body.accessKey ? "; пароль сброшен" : ""}` });
    await writeDb(db);
    return send(res, 200, { doctor: publicDoctor(doctor) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/doctors/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    const doctor = db.doctors.find((item) => item.id === id);
    db.doctors = db.doctors.filter((item) => item.id !== id);
    invalidateUserSessions(db, "doctor", id);
    const actor = db.admins.find((item) => item.id === session.userId);
    appendActivity(db, { type: "doctor_deleted", actorRole: "admin", actorId: session.userId, actorName: actor?.name || "", clinic: doctor?.clinic || "", details: `Удалён профиль врача: ${doctor?.fullName || id}` });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/nurse-surveys") {
    const body = validateNurseSurveyInput(await parseBody(req));
    const duplicate = findDuplicateSurvey(db, body);
    if (duplicate) return send(res, 409, { error: "Пациент с такими ФИО, датой рождения и телефоном уже существует в этой поликлинике", duplicateId: duplicate.id });
    const survey = buildNurseSurvey(body);
    db.nurseSurveys.push(survey);
    appendActivity(db, {
      type: "nurse_survey_created",
      actorRole: "nurse",
      actorName: survey.nurse?.fullName || "Медсестра не указана",
      clinic: survey.patient?.clinic || survey.clinic || "",
      surveyId: survey.id,
      patientName: patientNameFromSurvey(survey),
      details: survey.needsDoctor ? "Анкета отправлена, нужен врач" : "Анкета отправлена"
    });
    await writeDb(db);
    return send(res, 201, { survey });
  }

  if (req.method === "GET" && url.pathname === "/api/doctor/workspace") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const doctorClinicKey = clinicKey(doctor?.clinic);
    return send(res, 200, {
      doctor: doctor ? publicDoctor(doctor) : null,
      surveys: db.nurseSurveys.filter((survey) => !survey.archivedAt && clinicKey(survey.patient?.clinic || survey.clinic) === doctorClinicKey),
      visits: db.doctorVisits.filter((visit) => visit.doctorId === session.userId),
      tasks: (db.patientTasks || []).filter((task) => task.doctorId === session.userId),
      appointments: (db.appointments || []).filter((item) => item.doctorId === session.userId),
      dictionaries: { diabetesDrugs, hypertensionDrugs }
  });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/appointments") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const body = await parseBody(req);
    const survey = db.nurseSurveys.find((item) => item.id === body.surveyId);
    if (!doctor || !survey || survey.archivedAt) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    const startsAt = new Date(body.startsAt);
    if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date()) return send(res, 400, { error: "Укажите будущую дату и время" });
    const appointment = { id: crypto.randomUUID(), surveyId: survey.id, doctorId: doctor.id, startsAt: startsAt.toISOString(), status: "scheduled", note: cleanText(body.note, "Комментарий", { max: 500 }), createdAt: new Date().toISOString() };
    db.appointments.push(appointment);
    const patient = survey.patient || {};
    const channel = patient.reminderConsent ? patient.reminderChannel : "none";
    const recipient = channel === "telegram" ? patient.telegramChatId : patient.phone;
    const reminder = { id: crypto.randomUUID(), surveyId: survey.id, appointmentId: appointment.id, channel, recipientMasked: recipient ? `***${String(recipient).slice(-4)}` : "", message: `Напоминание о приеме ${startsAt.toLocaleString("ru-RU")}`, scheduledAt: new Date(startsAt.getTime() - 86400000).toISOString(), status: channel !== "none" && recipient ? "queued" : "blocked", reason: channel !== "none" && recipient ? "Ожидает подключения поставщика сообщений" : "Нет согласия или контакта", createdAt: new Date().toISOString() };
    db.reminderQueue.push(reminder);
    appendActivity(db, { type: "appointment_created", actorRole: "doctor", actorId: doctor.id, actorName: doctor.fullName, clinic: doctor.clinic, surveyId: survey.id, patientName: patientNameFromSurvey(survey), details: `Прием назначен на ${startsAt.toISOString()}` });
    await writeDb(db);
    return send(res, 201, { appointment, reminder });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/doctor/appointments/")) {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const appointment = db.appointments.find((item) => item.id === id && item.doctorId === session.userId);
    if (!appointment) return send(res, 404, { error: "Запись не найдена" });
    const body = await parseBody(req);
    if (!["scheduled", "arrived", "completed", "no_show", "cancelled"].includes(body.status)) return send(res, 400, { error: "Некорректный статус" });
    appointment.status = body.status;
    appointment.updatedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { appointment });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/doctor/patients/") && url.pathname.endsWith("/report.pdf")) {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const id = decodeURIComponent(url.pathname.split("/").at(-2));
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const survey = db.nurseSurveys.find((item) => item.id === id);
    if (!doctor || !survey || !doctorCanAccessSurvey(doctor, survey)) return send(res, 404, { error: "Пациент не найден" });
    const pdf = await patientReportPdf(survey, db.doctorVisits.filter((item) => item.surveyId === id), db.patientTasks.filter((item) => item.surveyId === id));
    return send(res, 200, pdf, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="patient-${id}.pdf"` });
  }

  if (req.method === "PUT" && url.pathname === "/api/doctor/account") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const login = cleanText(body.login, "Логин", { required: true, max: 100 });
    const currentAccessKey = cleanText(body.currentAccessKey, "Текущий пароль", { required: true, max: 200 });
    const accessKey = String(body.accessKey || "").trim();
    if (!verifyPassword(currentAccessKey, doctor.accessKeyHash)) return send(res, 401, { error: "Текущий пароль указан неверно" });
    if (!login) return send(res, 400, { error: "Логин обязателен" });
    const loginTaken = db.doctors.some((item) => item.id !== doctor.id && item.login === login);
    if (loginTaken) return send(res, 409, { error: "Такой логин уже используется" });
    doctor.login = login;
    if (accessKey) {
      const validatedAccessKey = validateNewPassword(accessKey, "Новый пароль");
      if (verifyPassword(validatedAccessKey, doctor.accessKeyHash)) return send(res, 400, { error: "Новый пароль должен отличаться от текущего" });
      doctor.accessKeyHash = hashPassword(validatedAccessKey);
      invalidateUserSessions(db, "doctor", doctor.id);
    }
    appendActivity(db, { type: "doctor_account_updated", actorRole: "doctor", actorId: doctor.id, actorName: doctor.fullName, clinic: doctor.clinic, details: accessKey ? "Врач изменил логин и пароль; старые сеансы завершены" : "Врач изменил логин" });
    await writeDb(db);
    return send(res, 200, { doctor: publicDoctor(doctor), currentSessionEnded: Boolean(accessKey) });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/surveys") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = validateSurveyInput(await parseBody(req), doctor.clinic);
    const duplicate = findDuplicateSurvey(db, body);
    if (duplicate) return send(res, 409, { error: "Пациент с такими ФИО, датой рождения и телефоном уже существует в этой поликлинике", duplicateId: duplicate.id });
    const survey = buildNurseSurvey(body);
    survey.createdByDoctorId = doctor.id;
    db.nurseSurveys.push(survey);
    appendActivity(db, {
      type: "doctor_patient_created",
      actorRole: "doctor",
      actorId: doctor.id,
      actorName: doctor.fullName,
      clinic: doctor.clinic,
      surveyId: survey.id,
      patientName: patientNameFromSurvey(survey),
      details: "Врач добавил пациента"
    });
    await writeDb(db);
    return send(res, 201, { survey });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/survey-view") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const survey = db.nurseSurveys.find((item) => item.id === body.surveyId);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    appendActivity(db, {
      type: "doctor_survey_viewed",
      actorRole: "doctor",
      actorId: doctor.id,
      actorName: doctor.fullName,
      clinic: doctor.clinic,
      surveyId: body.surveyId,
      patientName: patientNameFromSurvey(survey),
      details: "Врач открыл карту пациента"
    });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/visits") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const body = validateVisitInput(await parseBody(req));
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const survey = db.nurseSurveys.find((item) => item.id === body.surveyId);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    const weight = Number(body.weight || 0);
    const height = Number(body.height || 0);
    const heightM = height / 100;
    const bmi = Number(body.bmi || 0) || (weight > 0 && heightM > 0 ? Number((weight / (heightM * heightM)).toFixed(1)) : 0);
    const visit = {
      id: crypto.randomUUID(),
      surveyId: body.surveyId,
      doctorId: session.userId,
      weight,
      height,
      bmi,
      glucose: Number(body.glucose || 0),
      glucoseType: body.glucoseType || "fasting",
      diagnosis: String(body.diagnosis || ""),
      systolic: Number(body.systolic || 0),
      diastolic: Number(body.diastolic || 0),
      followUpDays: Number(body.followUpDays || 0),
      laboratoryTests: body.laboratoryTests,
      referrals: body.referrals,
      treatmentPlan: body.treatmentPlan,
      diabetesDrugs: body.diabetesDrugs,
      hypertensionDrugs: body.hypertensionDrugs,
      lifestyleRecommendations: {
        diabetesDiet: body.lifestyleRecommendations.includes("diabetesDiet"),
        physicalActivity: body.lifestyleRecommendations.includes("physicalActivity")
      },
      createdAt: new Date().toISOString()
    };
    visit.qualityWarnings = qualityFlagsForVisit(visit);
    db.doctorVisits.push(visit);
    let followUpTask = null;
    if (visit.followUpDays > 0) {
      const dueAt = new Date(Date.now() + visit.followUpDays * 86400000).toISOString();
      const task = {
        id: crypto.randomUUID(),
        surveyId: visit.surveyId,
        visitId: visit.id,
        doctorId: session.userId,
        title: "Повторный приём",
        dueAt,
        status: "open",
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      db.patientTasks.push(task);
      followUpTask = task;
    }
    const drugsCount = (visit.diabetesDrugs || []).length + (visit.hypertensionDrugs || []).length;
    appendActivity(db, {
      type: "doctor_visit_created",
      actorRole: "doctor",
      actorId: session.userId,
      actorName: doctor?.fullName || "",
      clinic: doctor?.clinic || survey?.patient?.clinic || "",
      surveyId: visit.surveyId,
      visitId: visit.id,
      patientName: patientNameFromSurvey(survey),
      details: drugsCount ? `Осмотр сохранен, назначено препаратов: ${drugsCount}` : "Осмотр сохранен без препаратов"
    });
    await writeDb(db);
    return send(res, 201, { visit, task: followUpTask });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/tasks") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    const surveyId = cleanText(body.surveyId, "Пациент", { required: true, max: 100 });
    const survey = db.nurseSurveys.find((item) => item.id === surveyId);
    if (!survey) return send(res, 404, { error: "Пациент не найден" });
    if (!doctorCanAccessSurvey(doctor, survey)) return send(res, 403, { error: "Нет доступа к пациенту другой поликлиники" });
    const dueDate = cleanText(body.dueDate, "Дата выполнения", { required: true, max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T12:00:00Z`))) return send(res, 400, { error: "Дата выполнения указана неверно" });
    const task = {
      id: crypto.randomUUID(), surveyId, doctorId: doctor.id,
      title: cleanText(body.title, "Задача", { required: true, max: 200 }),
      dueAt: `${dueDate}T12:00:00.000Z`, status: "open", createdAt: new Date().toISOString(), completedAt: null
    };
    db.patientTasks.push(task);
    appendActivity(db, { type: "patient_task_created", actorRole: "doctor", actorId: doctor.id, actorName: doctor.fullName, clinic: doctor.clinic, surveyId, patientName: patientNameFromSurvey(survey), details: `Создана задача: ${task.title}` });
    await writeDb(db);
    return send(res, 201, { task });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/doctor/tasks/")) {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const task = (db.patientTasks || []).find((item) => item.id === id && item.doctorId === session.userId);
    if (!task) return send(res, 404, { error: "Задача не найдена" });
    const body = await parseBody(req);
    task.status = body.status === "completed" ? "completed" : "open";
    task.completedAt = task.status === "completed" ? new Date().toISOString() : null;
    const survey = db.nurseSurveys.find((item) => item.id === task.surveyId);
    appendActivity(db, { type: "patient_task_updated", actorRole: "doctor", actorId: doctor?.id || "", actorName: doctor?.fullName || "", clinic: doctor?.clinic || "", surveyId: task.surveyId, patientName: patientNameFromSurvey(survey), details: task.status === "completed" ? `Задача выполнена: ${task.title}` : `Задача возвращена в работу: ${task.title}` });
    await writeDb(db);
    return send(res, 200, { task });
  }

  if (req.method === "GET" && url.pathname === "/api/training/pretest") {
    return send(res, 200, {
      participants: db.trainingParticipants.map(publicParticipant),
      attempts: db.trainingAttempts.map(enrichTrainingAttempt),
      tasks: publicPostTasks()
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/training/pretest/")) {
    const participantId = url.pathname.split("/").pop();
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const questions = preQuestionsForParticipant(participant);
    await writeDb(db);
    return send(res, 200, {
      participant: publicParticipant(participant),
      questions,
      attempt: enrichTrainingAttempt(db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "pre")) || null
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/training/pretest/")) {
    const participantId = url.pathname.split("/").at(-2);
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const existing = db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "pre");
    if (existing) return send(res, 409, { error: "Пре-тест уже сдан" });
    const body = await parseBody(req);
    const questions = preQuestionsForParticipant(participant);
    const questionIds = questions.map((question) => question.id);
    const result = scoreTest(questionIds, body.answers || {});
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type: "pre",
      instrument: "Инструмент 2",
      title: "Тест до обучения для оценки исходного уровня знаний",
      questionIds,
      answers: body.answers || {},
      ...result,
      createdAt: new Date().toISOString()
    };
    participant.preCompletedAt = attempt.createdAt;
    db.trainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/training/participant/")) {
    const participantId = url.pathname.split("/").pop();
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    return send(res, 200, {
      participant: publicParticipant(participant),
      attempts: attemptsForParticipant(db, participant.id),
      postQuestions: publicQuestions(preTestQuestions),
      tasks: publicPostTasks()
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/training/posttest/")) {
    const participantId = url.pathname.split("/").at(-2);
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const existing = db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "post");
    if (existing) return send(res, 409, { error: "Пост-тест уже сдан" });
    const body = await parseBody(req);
    const questionIds = preTestQuestions.map((question) => question.id);
    const result = scoreTest(questionIds, body.answers || {});
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type: "post",
      instrument: "Инструмент 3",
      title: "Тест после обучения для оценки итогового уровня знаний",
      questionIds,
      answers: body.answers || {},
      ...result,
      createdAt: new Date().toISOString()
    };
    participant.postCompletedAt = attempt.createdAt;
    db.trainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt: enrichTrainingAttempt(attempt) });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/training/tasks/")) {
    const parts = url.pathname.split("/");
    const participantId = parts.at(-3);
    const taskId = parts.at(-2);
    const participant = db.trainingParticipants.find((item) => item.id === participantId);
    const task = postTrainingTasks.find((item) => item.id === taskId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    if (!task) return send(res, 404, { error: "Задание не найдено" });
    const existing = db.trainingAttempts.find((item) => item.participantId === participant.id && item.type === "task" && item.taskId === task.id);
    if (existing) return send(res, 409, { error: "Это задание уже отправлено" });
    const body = await parseBody(req);
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type: "task",
      taskId: task.id,
      title: task.title,
      instrument: task.instrument,
      maxScore: task.maxScore,
      answers: body.answers || {},
      ...scorePostTask(task, body.answers || {}),
      manualScore: null,
      trainerComment: "",
      createdAt: new Date().toISOString()
    };
    db.trainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt: enrichTrainingAttempt(attempt) });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/training-attempts/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = url.pathname.split("/").pop();
    const attempt = db.trainingAttempts.find((item) => item.id === id);
    if (!attempt) return send(res, 404, { error: "Результат не найден" });
    const body = await parseBody(req);
    attempt.manualScore = body.manualScore === "" || body.manualScore === null ? null : Number(body.manualScore);
    attempt.trainerComment = body.trainerComment || "";
    attempt.reviewedAt = new Date().toISOString();
    await writeDb(db);
    return send(res, 200, { attempt: enrichTrainingAttempt(attempt) });
  }

  if (req.method === "GET" && url.pathname === "/api/nurse-training") {
    return send(res, 200, {
      participants: db.nurseTrainingParticipants.map(publicNurseParticipant),
      attempts: db.nurseTrainingAttempts
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/nurse-training/participant/")) {
    const participantId = url.pathname.split("/").pop();
    const participant = db.nurseTrainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    return send(res, 200, {
      participant: publicNurseParticipant(participant),
      attempts: db.nurseTrainingAttempts.filter((attempt) => attempt.participantId === participant.id),
      preQuestions: publicNurseQuestions("pre"),
      postQuestions: publicNurseQuestions("post")
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/submit") && url.pathname.startsWith("/api/nurse-training/")) {
    const parts = url.pathname.split("/");
    const type = parts.at(-3);
    const participantId = parts.at(-2);
    if (!["pre", "post"].includes(type)) return send(res, 404, { error: "Тест не найден" });
    const participant = db.nurseTrainingParticipants.find((item) => item.id === participantId);
    if (!participant) return send(res, 404, { error: "Участник не найден" });
    const existing = db.nurseTrainingAttempts.find((attempt) => attempt.participantId === participant.id && attempt.type === type);
    if (existing) return send(res, 409, { error: "Этот тест уже сдан" });
    const body = await parseBody(req);
    const questions = type === "post" ? remappedNursePostQuestions : nursePreQuestions;
    const result = scoreQuestionSet(questions, body.answers || {});
    const attempt = {
      id: crypto.randomUUID(),
      participantId: participant.id,
      type,
      title: type === "post" ? "Тест после обучения" : "Тест до обучения",
      answers: body.answers || {},
      ...result,
      passed: type === "post" ? result.passed : null,
      createdAt: new Date().toISOString()
    };
    if (type === "post") participant.postCompletedAt = attempt.createdAt;
    else participant.preCompletedAt = attempt.createdAt;
    db.nurseTrainingAttempts.push(attempt);
    await writeDb(db);
    return send(res, 201, { attempt });
  }

  return send(res, 404, { error: "API не найден" });
}

function countSelected(values) {
  return values.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function buildStats(db) {
  const total = db.nurseSurveys.length || 1;
  const highFindrisc = db.nurseSurveys.filter((item) => item.findrisc.highRisk).length;
  const highScore2 = db.nurseSurveys.filter((item) => item.score2.highRisk).length;
  const needsDoctor = db.nurseSurveys.filter((item) => item.needsDoctor).length;
  return {
    doctorsTotal: db.doctors.length,
    surveysTotal: db.nurseSurveys.length,
    visitsTotal: db.doctorVisits.length,
    needsDoctor,
    highFindrisc,
    highScore2,
    needsDoctorPercent: Math.round((needsDoctor / total) * 100),
    highFindriscPercent: Math.round((highFindrisc / total) * 100),
    highScore2Percent: Math.round((highScore2 / total) * 100)
  };
}

function buildTrainingStats(db) {
  const preAttempts = db.trainingAttempts.filter((attempt) => attempt.type === "pre");
  const postAttempts = db.trainingAttempts.filter((attempt) => attempt.type === "post");
  const taskAttempts = db.trainingAttempts.filter((attempt) => attempt.type === "task");
  const preTotal = preAttempts.length || 1;
  const postTotal = postAttempts.length || 1;
  const avgPrePercent = Math.round(preAttempts.reduce((sum, attempt) => sum + Number(attempt.percent || 0), 0) / preTotal);
  const avgPostPercent = Math.round(postAttempts.reduce((sum, attempt) => sum + Number(attempt.percent || 0), 0) / postTotal);
  return {
    participantsTotal: db.trainingParticipants.length,
    preCompleted: preAttempts.length,
    preAveragePercent: preAttempts.length ? avgPrePercent : 0,
    postCompleted: postAttempts.length,
    postAveragePercent: postAttempts.length ? avgPostPercent : 0,
    taskCompleted: taskAttempts.length
  };
}

function buildNurseTrainingStats(db) {
  const preAttempts = db.nurseTrainingAttempts.filter((attempt) => attempt.type === "pre");
  const postAttempts = db.nurseTrainingAttempts.filter((attempt) => attempt.type === "post");
  const avg = (items) => items.length ? Math.round(items.reduce((sum, attempt) => sum + Number(attempt.percent || 0), 0) / items.length) : 0;
  return {
    participantsTotal: db.nurseTrainingParticipants.length,
    preCompleted: preAttempts.length,
    postCompleted: postAttempts.length,
    preAveragePercent: avg(preAttempts),
    postAveragePercent: avg(postAttempts),
    postPassed: postAttempts.filter((attempt) => attempt.passed === true).length
  };
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : "Не указано";
}

function percentAverage(items) {
  return items.length ? Math.round(items.reduce((sum, item) => sum + Number(item.percent || 0), 0) / items.length) : 0;
}

function objectToSeries(data) {
  return Object.entries(data)
    .sort(([a], [b]) => clinicKey(a).localeCompare(clinicKey(b), "ru"))
    .map(([label, value]) => ({ label, value }));
}

function doctorPostPercent(attempts) {
  const taskAttempts = attempts.filter((attempt) => attempt.type === "task");
  const correct = taskAttempts.reduce((sum, attempt) => sum + Number(attempt.correct || 0), 0);
  const total = taskAttempts.reduce((sum, attempt) => sum + Number(attempt.total || attempt.maxScore || 0), 0);
  return total ? Math.round((correct / total) * 100) : 0;
}

function buildEducationInvestorStats(participants, attempts, postMode) {
  const attemptsByParticipant = attempts.reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const rows = participants.filter((participant) => !isExcludedClinic(participant.clinic)).map((participant) => {
    const participantAttempts = attemptsByParticipant[participant.id] || [];
    const pre = participantAttempts.find((attempt) => attempt.type === "pre");
    const post = postMode === "task"
      ? doctorPostPercent(participantAttempts)
      : Number(participantAttempts.find((attempt) => attempt.type === "post")?.percent || 0);
    return {
      clinic: participant.clinic || "Не указано",
      registeredAt: participant.createdAt,
      prePercent: pre ? Number(pre.percent || 0) : 0,
      postPercent: post,
      hasPre: Boolean(pre),
      hasPost: post > 0
    };
  });
  const byClinic = {};
  for (const row of rows) {
    byClinic[row.clinic] ||= { label: row.clinic, registered: 0, preCompleted: 0, postCompleted: 0, preSum: 0, postSum: 0 };
    byClinic[row.clinic].registered += 1;
    if (row.hasPre) {
      byClinic[row.clinic].preCompleted += 1;
      byClinic[row.clinic].preSum += row.prePercent;
    }
    if (row.hasPost) {
      byClinic[row.clinic].postCompleted += 1;
      byClinic[row.clinic].postSum += row.postPercent;
    }
  }
  const byDate = countSelected(rows.map((row) => dateKey(row.registeredAt)));
  const preRows = rows.filter((row) => row.hasPre).map((row) => ({ percent: row.prePercent }));
  const postRows = rows.filter((row) => row.hasPost).map((row) => ({ percent: row.postPercent }));
  return {
    total: participants.length,
    preCompleted: preRows.length,
    postCompleted: postRows.length,
    preAverage: percentAverage(preRows),
    postAverage: percentAverage(postRows),
    passed70: postRows.filter((row) => row.percent >= 70).length,
    byDate: objectToSeries(byDate),
    byClinic: Object.values(byClinic)
      .sort((a, b) => clinicKey(a.label).localeCompare(clinicKey(b.label), "ru"))
      .map((item) => ({
        label: item.label,
        registered: item.registered,
        preCompleted: item.preCompleted,
        postCompleted: item.postCompleted,
        preAverage: item.preCompleted ? Math.round(item.preSum / item.preCompleted) : 0,
        postAverage: item.postCompleted ? Math.round(item.postSum / item.postCompleted) : 0
      }))
  };
}

function buildInvestorDashboard(db) {
  const stats = buildStats(db);
  const doctorEducation = buildEducationInvestorStats(db.trainingParticipants, db.trainingAttempts, "task");
  const nurseEducation = buildEducationInvestorStats(db.nurseTrainingParticipants, db.nurseTrainingAttempts, "post");
  const visibleSurveys = db.nurseSurveys.filter((survey) => !isExcludedClinic(survey.patient?.clinic || survey.clinic));
  const visibleDoctors = db.doctors.filter((doctor) => !isExcludedClinic(doctor.clinic));
  const surveysByClinic = countSelected(visibleSurveys.map((survey) => survey.patient?.clinic || survey.clinic || "Не указано"));
  const visitsByDate = countSelected(db.doctorVisits.map((visit) => dateKey(visit.createdAt)));
  const surveyByDate = countSelected(db.nurseSurveys.map((survey) => dateKey(survey.createdAt)));
  const diagnoses = countSelected(db.doctorVisits.map((visit) => visit.diagnosis || "Без диагноза"));
  const cutoff30 = Date.now() - 30 * 86400000;
  const highGlucose = db.nurseSurveys.filter((survey) => Number(survey.measurements?.glucoseLevel || 0) >= 6.1).length;
  const highPressure = db.nurseSurveys.filter((survey) => Number(survey.measurements?.systolic || 0) >= 140 || Number(survey.measurements?.diastolic || 0) >= 90).length;
  const clinicNames = [...new Set([
    ...visibleDoctors.map((doctor) => doctor.clinic || "Не указано"),
    ...visibleSurveys.map((survey) => survey.patient?.clinic || survey.clinic || "Не указано")
  ])].filter((clinic) => !isExcludedClinic(clinic)).sort((a, b) => a.localeCompare(b, "ru"));
  const clinicPerformance = clinicNames.map((clinic) => {
    const surveys = db.nurseSurveys.filter((survey) => (survey.patient?.clinic || survey.clinic || "Не указано") === clinic);
    const surveyIds = new Set(surveys.map((survey) => survey.id));
    const visits = db.doctorVisits.filter((visit) => surveyIds.has(visit.surveyId));
    const tasks = (db.patientTasks || []).filter((task) => surveyIds.has(task.surveyId));
    const target = db.settings?.clinicTargets?.[clinic] || {};
    const completedTasks = tasks.filter((task) => task.status === "completed").length;
    return {
      label: clinic,
      doctors: db.doctors.filter((doctor) => (doctor.clinic || "Не указано") === clinic).length,
      surveys: surveys.length,
      visits: visits.length,
      highRisk: surveys.filter((survey) => survey.needsDoctor).length,
      targets: target,
      patientTargetPercent: target.monthlyPatients ? Math.min(100, Math.round((surveys.length / target.monthlyPatients) * 100)) : null,
      visitTargetPercent: target.monthlyVisits ? Math.min(100, Math.round((visits.length / target.monthlyVisits) * 100)) : null,
      followUpCompletionPercent: tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      doctorsTotal: stats.doctorsTotal,
      surveysTotal: stats.surveysTotal,
      visitsTotal: stats.visitsTotal,
      riskNeedsDoctorPercent: stats.needsDoctorPercent,
      highFindriscPercent: stats.highFindriscPercent,
      highScore2Percent: stats.highScore2Percent,
      doctorTrainingPostAverage: doctorEducation.postAverage,
      nurseTrainingPostAverage: nurseEducation.postAverage,
      newPatients30Days: db.nurseSurveys.filter((survey) => Date.parse(survey.createdAt || "") >= cutoff30).length,
      highGlucosePercent: Math.round((highGlucose / Math.max(1, db.nurseSurveys.length)) * 100),
      highPressurePercent: Math.round((highPressure / Math.max(1, db.nurseSurveys.length)) * 100),
      openFollowUps: (db.patientTasks || []).filter((task) => task.status !== "completed").length
    },
    doctors: {
      registeredByClinic: objectToSeries(countSelected(visibleDoctors.map((doctor) => doctor.clinic || "Не указано"))),
      registeredByDate: objectToSeries(countSelected(db.doctors.map((doctor) => dateKey(doctor.createdAt))))
    },
    nurses: {
      surveyByClinic: objectToSeries(surveysByClinic),
      surveyByDate: objectToSeries(surveyByDate)
    },
    clinical: {
      visitsByDate: objectToSeries(visitsByDate),
      diagnoses: objectToSeries(diagnoses),
      clinicPerformance,
      risk: [
        { label: "Нужно к врачу", value: stats.needsDoctorPercent },
        { label: "FINDRISC повышен", value: stats.highFindriscPercent },
        { label: "СС риск высок", value: stats.highScore2Percent }
      ]
    },
    education: {
      doctors: doctorEducation,
      nurses: nurseEducation
    }
  };
}

function buildInvestorReportCsv(db) {
  const data = buildInvestorDashboard(db);
  const lines = [["Показатель", "Значение"]];
  const summaryLabels = {
    doctorsTotal: "Врачи в системе",
    surveysTotal: "Анкеты пациентов",
    visitsTotal: "Осмотры врачей",
    newPatients30Days: "Новые пациенты за 30 дней",
    highGlucosePercent: "Повышенный сахар, %",
    highPressurePercent: "Повышенное давление, %",
    openFollowUps: "Открытые повторные визиты",
    riskNeedsDoctorPercent: "Требуют врача, %",
    doctorTrainingPostAverage: "Пост-тест врачей, %",
    nurseTrainingPostAverage: "Пост-тест медсестер, %"
  };
  for (const [key, label] of Object.entries(summaryLabels)) lines.push([label, data.summary[key] ?? 0]);
  lines.push([], ["Поликлиника", "Врачи", "Анкеты", "Осмотры", "Высокий риск"]);
  for (const clinic of data.clinical.clinicPerformance) lines.push([clinic.label, clinic.doctors, clinic.surveys, clinic.visits, clinic.highRisk]);
  return `\uFEFF${lines.map((row) => row.map(csvCell).join(";")).join("\n")}`;
}

function hasDoctorAction(visit) {
  return Boolean(
    (visit.referrals || []).length ||
    String(visit.treatmentPlan || "").trim() ||
    (visit.diabetesDrugs || []).length ||
    (visit.hypertensionDrugs || []).length ||
    (visit.laboratoryTests || []).length ||
    Number(visit.followUpDays || 0) > 0
  );
}

function monitorDateTime(value) {
  return value ? new Date(value).toISOString() : "";
}

function matchesMonitorFilters(item, filters = {}) {
  const clinic = filters.clinic || "all";
  const nurse = filters.nurse || "all";
  const doctor = filters.doctor || "all";
  const date = filters.date || "";
  if (clinic !== "all" && item.clinic !== clinic) return false;
  if (nurse !== "all" && item.nurseName !== nurse) return false;
  if (doctor !== "all" && item.doctorName !== doctor) return false;
  if (date && dateKey(item.createdAt) !== date) return false;
  return true;
}

function buildOperationsMonitorRows(db) {
  const doctorsById = Object.fromEntries((db.doctors || []).map((doctor) => [doctor.id, doctor]));
  const visitsBySurvey = {};
  for (const visit of db.doctorVisits || []) {
    (visitsBySurvey[visit.surveyId] ||= []).push(visit);
  }
  const surveyRows = (db.nurseSurveys || []).map((survey) => {
    const visits = visitsBySurvey[survey.id] || [];
    const createdByDoctor = survey.createdByDoctorId ? doctorsById[survey.createdByDoctorId] : null;
    return {
      id: survey.id,
      createdAt: survey.createdAt,
      clinic: survey.patient?.clinic || survey.clinic || "Не указано",
      patientName: patientNameFromSurvey(survey) || "Пациент",
      nurseName: survey.nurse?.fullName || (createdByDoctor ? "Добавил врач" : "Медсестра не указана"),
      doctorName: createdByDoctor?.fullName || "",
      needsDoctor: Boolean(survey.needsDoctor),
      findrisc: survey.findrisc?.score || 0,
      score2: survey.score2?.percent || 0,
      viewedByDoctors: new Set((db.activityEvents || []).filter((event) => event.type === "doctor_survey_viewed" && event.surveyId === survey.id).map((event) => event.actorId || event.actorName)).size,
      visits: visits.length,
      visitsWithActions: visits.filter(hasDoctorAction).length,
      drugs: visits.reduce((sum, visit) => sum + (visit.diabetesDrugs || []).length + (visit.hypertensionDrugs || []).length, 0)
    };
  });
  const visitRows = (db.doctorVisits || []).map((visit) => {
    const doctor = doctorsById[visit.doctorId];
    const survey = (db.nurseSurveys || []).find((item) => item.id === visit.surveyId);
    return {
      id: visit.id,
      createdAt: visit.createdAt,
      clinic: doctor?.clinic || survey?.patient?.clinic || "Не указано",
      doctorName: doctor?.fullName || "Врач не указан",
      nurseName: survey?.nurse?.fullName || "Медсестра не указана",
      patientName: patientNameFromSurvey(survey) || "Пациент",
      diagnosis: visit.diagnosis || "",
      hasAction: hasDoctorAction(visit),
      referrals: (visit.referrals || []).join(", "),
      drugs: [...(visit.diabetesDrugs || []), ...(visit.hypertensionDrugs || [])].join("; "),
      labs: (visit.laboratoryTests || []).map((item) => `${item.name || ""}: ${item.result || ""}`).filter(Boolean).join("; "),
      followUpDays: visit.followUpDays || 0
    };
  });
  const eventRows = (db.activityEvents || []).map((event) => ({
    id: event.id,
    createdAt: event.createdAt,
    type: event.type,
    clinic: event.clinic || "Не указано",
    actorRole: event.actorRole,
    actorName: event.actorName || "",
    nurseName: event.actorRole === "nurse" ? event.actorName : "all",
    doctorName: event.actorRole === "doctor" ? event.actorName : "all",
    patientName: event.patientName || "",
    details: event.details || ""
  }));
  return { surveyRows, visitRows, eventRows };
}

function groupMonitor(items, keyFn, seed = {}) {
  const map = {};
  for (const item of items) {
    const key = keyFn(item) || "Не указано";
    map[key] ||= { label: key, ...seed };
  }
  return map;
}

function buildOperationsMonitor(db, filters = {}) {
  const { surveyRows, visitRows, eventRows } = buildPublicOperationsMonitorRows(db);
  const filteredSurveys = surveyRows.filter((row) => matchesMonitorFilters(row, filters));
  const filteredVisits = visitRows.filter((row) => matchesMonitorFilters(row, filters));
  const filteredEvents = eventRows.filter((row) => matchesMonitorFilters(row, filters));
  const clinicMap = groupMonitor([...filteredSurveys, ...filteredVisits], (row) => row.clinic, { surveys: 0, visits: 0, visitsWithActions: 0, needsDoctor: 0 });
  for (const row of filteredSurveys) {
    clinicMap[row.clinic].surveys += 1;
    if (row.needsDoctor) clinicMap[row.clinic].needsDoctor += 1;
  }
  for (const row of filteredVisits) {
    clinicMap[row.clinic].visits += 1;
    if (row.hasAction) clinicMap[row.clinic].visitsWithActions += 1;
  }
  const clinicSurveyDayMap = {};
  const nurseSurveyDayMap = {};
  for (const row of filteredSurveys) {
    const day = dateKey(row.createdAt) || "Не указано";
    const key = `${row.clinic}||${day}`;
    clinicSurveyDayMap[key] ||= { label: `${row.clinic} / ${day}`, clinic: row.clinic, date: day, surveys: 0, needsDoctor: 0 };
    clinicSurveyDayMap[key].surveys += 1;
    if (row.needsDoctor) clinicSurveyDayMap[key].needsDoctor += 1;
    const nurseKey = `${row.clinic}||${row.nurseName}||${day}`;
    nurseSurveyDayMap[nurseKey] ||= {
      label: `${row.nurseName} / ${day}`,
      clinic: row.clinic,
      nurseName: row.nurseName,
      date: day,
      surveys: 0,
      needsDoctor: 0
    };
    nurseSurveyDayMap[nurseKey].surveys += 1;
    if (row.needsDoctor) nurseSurveyDayMap[nurseKey].needsDoctor += 1;
  }
  const doctorMap = groupMonitor(filteredVisits, (row) => row.doctorName, { views: 0, visits: 0, visitsWithActions: 0, drugs: 0, lastAction: "" });
  for (const event of filteredEvents.filter((event) => event.type === "doctor_survey_viewed")) {
    doctorMap[event.actorName] ||= { label: event.actorName, views: 0, visits: 0, visitsWithActions: 0, drugs: 0, lastAction: "" };
    doctorMap[event.actorName].views += 1;
    doctorMap[event.actorName].lastAction = [doctorMap[event.actorName].lastAction, event.createdAt].filter(Boolean).sort().at(-1) || "";
  }
  for (const row of filteredVisits) {
    doctorMap[row.doctorName].visits += 1;
    if (row.hasAction) doctorMap[row.doctorName].visitsWithActions += 1;
    doctorMap[row.doctorName].drugs += row.drugs ? row.drugs.split(";").filter(Boolean).length : 0;
    doctorMap[row.doctorName].lastAction = [doctorMap[row.doctorName].lastAction, row.createdAt].filter(Boolean).sort().at(-1) || "";
  }
  const byDate = {};
  for (const row of filteredSurveys) {
    const key = dateKey(row.createdAt);
    byDate[key] ||= { label: key, surveys: 0, doctorViews: 0, visits: 0, actions: 0 };
    byDate[key].surveys += 1;
  }
  for (const event of filteredEvents.filter((event) => event.type === "doctor_survey_viewed")) {
    const key = dateKey(event.createdAt);
    byDate[key] ||= { label: key, surveys: 0, doctorViews: 0, visits: 0, actions: 0 };
    byDate[key].doctorViews += 1;
  }
  for (const row of filteredVisits) {
    const key = dateKey(row.createdAt);
    byDate[key] ||= { label: key, surveys: 0, doctorViews: 0, visits: 0, actions: 0 };
    byDate[key].visits += 1;
    if (row.hasAction) byDate[key].actions += 1;
  }
  const clinics = [...new Set([...surveyRows.map((row) => row.clinic), ...visitRows.map((row) => row.clinic)])].sort((a, b) => clinicKey(a).localeCompare(clinicKey(b), "ru"));
  const nurses = [...new Set(surveyRows.map((row) => row.nurseName))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  const doctors = [...new Set([...(db.doctors || []).map((doctor) => doctor.fullName), ...visitRows.map((row) => row.doctorName)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  const publicEvents = filteredEvents
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 200)
    .map((event) => event.actorRole === "nurse" ? { ...event, actorName: "Медсестра", nurseName: "" } : event);
  const publicSurveys = filteredSurveys
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 300)
    .map(({ nurseName, ...row }) => row);
  return {
    generatedAt: new Date().toISOString(),
    filters: { clinics, nurses, doctors },
    summary: {
      surveys: filteredSurveys.length,
      nursesActive: new Set(filteredSurveys.map((row) => row.nurseName)).size,
      doctorViews: filteredEvents.filter((event) => event.type === "doctor_survey_viewed").length,
      visits: filteredVisits.length,
      visitsWithActions: filteredVisits.filter((row) => row.hasAction).length,
      needsDoctor: filteredSurveys.filter((row) => row.needsDoctor).length
    },
    clinics: Object.values(clinicMap).sort((a, b) => clinicKey(a.label).localeCompare(clinicKey(b.label), "ru")),
    nurses: Object.values(nurseSurveyDayMap).sort((a, b) =>
      b.date.localeCompare(a.date) || clinicKey(a.clinic).localeCompare(clinicKey(b.clinic), "ru") || a.nurseName.localeCompare(b.nurseName, "ru")
    ),
    clinicSurveyDays: Object.values(clinicSurveyDayMap).sort((a, b) =>
      clinicKey(a.clinic).localeCompare(clinicKey(b.clinic), "ru") || a.date.localeCompare(b.date)
    ),
    doctors: Object.values(doctorMap).sort((a, b) => (b.visits + b.views) - (a.visits + a.views)),
    byDate: Object.values(byDate).sort((a, b) => a.label.localeCompare(b.label)),
    events: publicEvents,
    surveys: publicSurveys,
    visits: filteredVisits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 300)
  };
}

function qualityFlagsForSurvey(survey) {
  const flags = [];
  const m = survey.measurements || {};
  if (!m.weight && !m.rabitoWeight) flags.push("Не указан вес");
  if (!m.height) flags.push("Не указан рост");
  if (!m.systolic || !m.diastolic) flags.push("Не указано артериальное давление");
  if (m.bmi && (m.bmi < 15 || m.bmi > 60)) flags.push("Проверьте индекс массы тела");
  if (m.systolic >= 180 || m.diastolic >= 120) flags.push("Очень высокое артериальное давление");
  if (!survey.nurse?.fullName && !survey.createdByDoctorId) flags.push("Не указана медсестра");
  return flags;
}

function qualityFlagsForVisit(visit) {
  const flags = [];
  if (!visit.systolic || !visit.diastolic) flags.push("В осмотре не указано давление");
  if (!visit.weight) flags.push("В осмотре не указан вес");
  if (!visit.glucose) flags.push("Не указан уровень сахара в крови");
  if (!visit.diagnosis && !(visit.referrals || []).length && !visit.treatmentPlan) flags.push("Нет решения врача");
  return flags;
}

function duplicatePatientSuggestions(db) {
  const groups = new Map();
  for (const survey of (db.nurseSurveys || []).filter((item) => !item.archivedAt)) {
    const patient = survey.patient || {};
    const identity = normalizePatientIdentity(patient);
    const phone = String(patient.phone || "").replace(/\D/g, "");
    const keys = [`identity:${clinicKey(patient.clinic || survey.clinic)}:${identity}`];
    if (phone.length >= 7) keys.push(`phone:${clinicKey(patient.clinic || survey.clinic)}:${phone}`);
    for (const key of keys) (groups.get(key) || groups.set(key, []).get(key)).push(survey);
  }
  const seen = new Set();
  const suggestions = [];
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    const ids = items.map((item) => item.id).sort();
    const signature = ids.join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    suggestions.push({
      reason: key.startsWith("phone:") ? "Одинаковый телефон" : "Совпадают ФИО и дата рождения",
      clinic: items[0].patient?.clinic || items[0].clinic || "",
      patients: items.map((item) => ({ id: item.id, name: patientNameFromSurvey(item), birthDate: item.patient?.birthDate || "", phone: item.patient?.phone || "", createdAt: item.createdAt }))
    });
  }
  return suggestions.slice(0, 100);
}

function careChecklist(visits = []) {
  const text = visits.flatMap((visit) => [
    ...(visit.laboratoryTests || []).filter(lab => lab.status !== 'ordered' && labHasResult(lab)).flatMap((lab) => [lab.test, lab.name]),
    ...(visit.completedExaminations || [])
  ]).filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
  return {
    hba1c: /hba1c|гликир|гликирован/.test(text),
    kidney: /креатинин|скф|почек|альбумин/.test(text),
    lipids: /лпнп|холестерин|липид/.test(text),
    eyes: /офтальм|глаз|сетчат/.test(text),
    feet: /стоп|подолог|нейропат/.test(text)
  };
}

function buildCareControl(db) {
  const doctorsById = Object.fromEntries((db.doctors || []).map((doctor) => [doctor.id, doctor]));
  const eventsBySurvey = {};
  for (const event of db.activityEvents || []) (eventsBySurvey[event.surveyId] ||= []).push(event);
  const visitsBySurvey = {};
  for (const visit of db.doctorVisits || []) (visitsBySurvey[visit.surveyId] ||= []).push(visit);
  const tasksBySurvey = {};
  for (const task of db.patientTasks || []) (tasksBySurvey[task.surveyId] ||= []).push(task);
  const registry = (db.nurseSurveys || []).filter((survey) => !survey.archivedAt).map((survey) => {
    const visits = (visitsBySurvey[survey.id] || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const lastVisit = visits.at(-1) || null;
    const checklist = careChecklist(visits);
    const missingChecklist = Object.entries(checklist).filter(([, ok]) => !ok).map(([key]) => ({ hba1c: "HbA1c", kidney: "Почки", lipids: "Липиды", eyes: "Глаза", feet: "Стопы" }[key]));
    const tasks = tasksBySurvey[survey.id] || [];
    const viewed = (eventsBySurvey[survey.id] || []).some((event) => event.type === "doctor_survey_viewed");
    const followUpPlanned = Boolean(lastVisit?.followUpDays || tasks.length);
    const followUpCompleted = visits.length > 1;
    const stage = followUpCompleted ? "Повторный контроль выполнен" : followUpPlanned ? "Повторный контроль запланирован" : visits.length ? "Осмотр врача выполнен" : viewed ? "Карточка открыта врачом" : survey.needsDoctor ? "Ожидает врача" : "Первичный скрининг";
    const nextAction = stage === "Ожидает врача" ? "Назначить врача" : missingChecklist.length ? `Назначить: ${missingChecklist.join(", ")}` : followUpPlanned && !followUpCompleted ? "Проверить повторный визит" : !visits.length ? "Провести осмотр" : "Наблюдение по плану";
    const surveyFlags = qualityFlagsForSurvey(survey);
    const visitFlags = lastVisit ? qualityFlagsForVisit(lastVisit) : [];
    return {
      id: survey.id,
      patientName: patientNameFromSurvey(survey),
      birthDate: survey.patient?.birthDate || "",
      clinic: survey.patient?.clinic || survey.clinic || "",
      nurseName: survey.nurse?.fullName || (survey.createdByDoctorId ? "Добавил врач" : "Не указана"),
      doctorName: doctorsById[lastVisit?.doctorId]?.fullName || "",
      createdAt: survey.createdAt,
      lastVisitAt: lastVisit?.createdAt || "",
      findrisc: survey.findrisc?.score || 0,
      glucose: lastVisit?.glucose || survey.measurements?.glucoseLevel || 0,
      bloodPressure: `${lastVisit?.systolic || survey.measurements?.systolic || "—"}/${lastVisit?.diastolic || survey.measurements?.diastolic || "—"}`,
      stage,
      nextAction,
      needsDoctor: Boolean(survey.needsDoctor),
      visits: visits.length,
      checklist,
      missingChecklist,
      qualityFlags: [...surveyFlags, ...visitFlags]
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const nurseDailyMap = {};
  for (const row of buildOperationsMonitorRows(db).surveyRows) {
    const day = dateKey(row.createdAt);
    const key = `${row.clinic}|${row.nurseName}|${day}`;
    nurseDailyMap[key] ||= { clinic: row.clinic, nurseName: row.nurseName, date: day, screened: 0, needsDoctor: 0 };
    nurseDailyMap[key].screened += 1;
    if (row.needsDoctor) nurseDailyMap[key].needsDoctor += 1;
  }
  const quality = registry.filter((row) => row.qualityFlags.length).map((row) => ({ id: row.id, patientName: row.patientName, clinic: row.clinic, flags: row.qualityFlags }));
  const duplicates = duplicatePatientSuggestions(db);
  const summary = {
    patients: registry.length,
    awaitingDoctor: registry.filter((row) => row.stage === "Ожидает врача").length,
    withDoctorVisit: registry.filter((row) => row.visits > 0).length,
    followUpPlanned: registry.filter((row) => row.stage.includes("запланирован")).length,
    followUpCompleted: registry.filter((row) => row.stage === 'Повторный контроль выполнен').length,
    qualityWarnings: quality.length,
    duplicateGroups: duplicates.length
  };
  return {
    summary,
    registry,
    waitingPatients: waitingPatients(db),
    nurseDaily: Object.values(nurseDailyMap).sort((a, b) => b.date.localeCompare(a.date) || a.clinic.localeCompare(b.clinic, "ru")),
    quality,
    duplicates,
    backupStatus: db.settings?.backupStatus || null,
    dailyReports: { ...(db.settings?.dailyReports || {}), tokenConfigured: Boolean(TELEGRAM_BOT_TOKEN), defaultChatConfigured: Boolean(TELEGRAM_REPORT_CHAT_ID) }
  };
}

function excelXmlCell(value, type = "String") {
  const escaped = String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return `<Cell><Data ss:Type="${type}">${escaped}</Data></Cell>`;
}

function excelXmlSheet(name, headers, rows) {
  const header = `<Row ss:StyleID="Header">${headers.map((item) => excelXmlCell(item)).join("")}</Row>`;
  const body = rows.map((row) => `<Row>${row.map((item) => excelXmlCell(item, typeof item === "number" ? "Number" : "String")).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${name}"><Table>${header}${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
}

function buildCareControlExcel(db) {
  const control = buildCareControl(db);
  const sheets = [
    excelXmlSheet("Регистр", ["Пациент", "Дата рождения", "Поликлиника", "Медсестра", "Врач", "Этап", "FINDRISC", "Сахар", "АД", "Осмотров", "Не выполнено"], control.registry.map((row) => [row.patientName, row.birthDate, row.clinic, row.nurseName, row.doctorName, row.stage, row.findrisc, row.glucose || "", row.bloodPressure, row.visits, row.missingChecklist.join(", ")])),
    excelXmlSheet("Медсестры", ["Дата", "Поликлиника", "Медсестра", "Осмотрено", "К врачу"], control.nurseDaily.map((row) => [row.date, row.clinic, row.nurseName, row.screened, row.needsDoctor])),
    excelXmlSheet("Качество", ["Пациент", "Поликлиника", "Предупреждения"], control.quality.map((row) => [row.patientName, row.clinic, row.flags.join("; ")])),
    excelXmlSheet("Дубликаты", ["Причина", "Поликлиника", "Карточки"], control.duplicates.map((group) => [group.reason, group.clinic, group.patients.map((item) => `${item.name} (${item.birthDate})`).join("; ")]))
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EDE8" ss:Pattern="Solid"/></Style></Styles>${sheets}</Workbook>`;
}

async function createSecureBackup(db, reason = "manual") {
  const backupDir = join(dataDir, "backups");
  await mkdir(backupDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const filename = `e-clinic-${createdAt.replace(/[:.]/g, "-")}.json`;
  const path = join(backupDir, filename);
  const tempPath = `${path}.tmp`;
  const snapshot = { ...db, sessions: {} };
  const serialized = JSON.stringify(snapshot);
  await writeFile(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
  const verification = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(verification.nurseSurveys) || !Array.isArray(verification.doctorVisits)) throw new Error("Проверка резервной копии не пройдена");
  const checksum = crypto.createHash("sha256").update(serialized).digest("hex");
  const restoreCheck = await verifyBackupRestore(verification, { pool: DATABASE_URL ? await pgPool() : null, directory: backupDir, collections: Object.keys(normalizedCollectionTables) });
  const files = (await readdir(backupDir)).filter((item) => /^e-clinic-.*\.json$/.test(item)).sort().reverse();
  for (const old of files.slice(14)) await unlink(join(backupDir, old)).catch(() => {});
  db.settings ||= {};
  db.settings.backupStatus = { createdAt, verifiedAt: new Date().toISOString(), verified: true, restoreCheck, checksum, filename, reason, retained: Math.min(files.length, 14) };
  await writeDb(db);
  return db.settings.backupStatus;
}

function dailyReportText(db) {
  const control = buildCareControl(db);
  const today = dateKey(new Date().toISOString());
  const nurses = control.nurseDaily.filter((row) => row.date === today);
  const screened = nurses.reduce((sum, row) => sum + row.screened, 0);
  const referred = nurses.reduce((sum, row) => sum + row.needsDoctor, 0);
  return [`E-Clinic — отчёт за ${today}`, `Осмотрено пациентов: ${screened}`, `Направлено к врачу: ${referred}`, `Ожидают врача всего: ${control.summary.awaitingDoctor}`, `Предупреждений по качеству данных: ${control.summary.qualityWarnings}`].join("\n");
}

async function sendTelegramReport(db, overrideChatId = "") {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN не настроен на сервере");
  const chatId = String(overrideChatId || db.settings?.dailyReports?.chatId || TELEGRAM_REPORT_CHAT_ID || "").trim();
  if (!chatId) throw new Error("Telegram Chat ID не указан");
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: dailyReportText(db) })
  });
  if (!response.ok) throw new Error("Telegram не принял отчёт");
  return { sentAt: new Date().toISOString(), chatIdMasked: chatId.length > 4 ? `***${chatId.slice(-4)}` : "***" };
}

async function sendDueTelegramReminders(db) {
  if (!TELEGRAM_BOT_TOKEN) return 0;
  const now = Date.now();
  let sentCount = 0;
  for (const reminder of db.reminderQueue || []) {
    if (reminder.status !== "queued" || reminder.channel !== "telegram" || !reminder.scheduledAt || new Date(reminder.scheduledAt).getTime() > now) continue;
    const survey = (db.nurseSurveys || []).find((item) => item.id === reminder.surveyId);
    const chatId = String(survey?.patient?.telegramChatId || "").trim();
    if (!survey?.patient?.reminderConsent || !chatId) { reminder.status = "blocked"; reminder.reason = "Нет согласия или Telegram Chat ID"; continue; }
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: reminder.message }) });
      if (!response.ok) throw new Error("Telegram не принял напоминание");
      reminder.status = "sent"; reminder.sentAt = new Date().toISOString(); reminder.reason = "Отправлено"; sentCount += 1;
    } catch (error) { reminder.status = "error"; reminder.reason = String(error.message || error).slice(0, 300); }
  }
  if (sentCount || (db.reminderQueue || []).some((item) => item.status === "error")) await writeDb(db);
  return sentCount;
}

function buildPublicOperationsMonitorRows(db) {
  const rows = buildOperationsMonitorRows(db);
  return {
    surveyRows: rows.surveyRows.filter((row) => !isExcludedClinic(row.clinic)).map((row) => ({ ...row, patientName: "Пациент" })),
    visitRows: rows.visitRows.filter((row) => !isExcludedClinic(row.clinic)).map((row) => ({ ...row, patientName: "Пациент" })),
    eventRows: rows.eventRows.filter((row) => !isExcludedClinic(row.clinic)).map((row) => ({ ...row, patientName: row.patientName ? "Пациент" : "" }))
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildOperationsReportCsv(db, filters = {}) {
  const data = buildOperationsMonitor(db, filters);
  const lines = [];
  lines.push(["Раздел", "Дата", "Поликлиника", "Сотрудник", "Пациент", "Действие", "Детали"].map(csvCell).join(";"));
  for (const event of data.events) {
    lines.push(["Журнал", monitorDateTime(event.createdAt), event.clinic, event.actorName, event.patientName, event.type, event.details].map(csvCell).join(";"));
  }
  for (const survey of data.surveys) {
    lines.push(["Анкета", monitorDateTime(survey.createdAt), survey.clinic, survey.nurseName, survey.patientName, "Анкета пациента", `FINDRISC ${survey.findrisc}; СС риск ${survey.score2}%; нужен врач: ${survey.needsDoctor ? "да" : "нет"}`].map(csvCell).join(";"));
  }
  for (const visit of data.visits) {
    lines.push(["Осмотр", monitorDateTime(visit.createdAt), visit.clinic, visit.doctorName, visit.patientName, visit.hasAction ? "Осмотр с действиями" : "Осмотр без назначений", `Диагноз: ${visit.diagnosis}; направления: ${visit.referrals}; препараты: ${visit.drugs}; лаборатория: ${visit.labs}; повтор: ${visit.followUpDays}`].map(csvCell).join(";"));
  }
  return `\uFEFF${lines.join("\n")}`;
}

function buildTrainingAnswerKeysCsv() {
  const lines = [];
  lines.push(["Раздел", "Тест/задача", "Вопрос/ситуация", "Правильный ответ", "Текст правильного ответа", "Критерии"].map(csvCell).join(";"));
  for (const question of preTestQuestions) {
    lines.push([
      "До обучения",
      "Пре-тест",
      `${question.id}. ${question.text}`,
      question.answer,
      question.options?.[question.answer] || "",
      "1 балл за правильный ответ"
    ].map(csvCell).join(";"));
  }
  for (const task of postTrainingTasks) {
    const criteria = (task.criteria || []).join(" | ");
    if (task.mode === "findrisc") {
      for (const [field, label, expected] of task.fields || []) {
        lines.push(["После обучения", task.title, `${field}: ${label}`, expected, expected, criteria].map(csvCell).join(";"));
      }
      if (task.key) lines.push(["После обучения", task.title, "Ключ/разбор", "", task.key, criteria].map(csvCell).join(";"));
    } else if (task.mode === "singleCases") {
      for (const [index, item] of (task.cases || []).entries()) {
        const [caseText, expected] = item;
        lines.push(["После обучения", task.title, `${index + 1}. ${caseText}`, expected, expected, criteria].map(csvCell).join(";"));
      }
    } else if (task.mode === "routing") {
      for (const [index, item] of (task.cases || []).entries()) {
        const [caseText, specialist, urgency] = item;
        lines.push(["После обучения", task.title, `${index + 1}. ${caseText}`, `${specialist}; ${urgency}`, `Специалист: ${specialist}; срочность: ${urgency}`, criteria].map(csvCell).join(";"));
      }
    } else if (task.mode === "mcq") {
      for (const [index, question] of (task.questions || []).entries()) {
        lines.push([
          "После обучения",
          task.title,
          `${index + 1}. ${question.text}`,
          question.answer,
          question.options?.[question.answer] || "",
          criteria
        ].map(csvCell).join(";"));
      }
    } else {
      lines.push(["После обучения", task.title, task.description || "", "", task.key || "", criteria].map(csvCell).join(";"));
    }
  }
  return `\uFEFF${lines.join("\n")}`;
}

async function serveStatic(req, res, url) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const appRoutes = {
    "/": "/index.html",
    [ADMIN_APP_PATH]: "/admin.html",
    [DOCTOR_APP_PATH]: "/doctor.html",
    [SURVEY_APP_PATH]: "/survey.html",
    [TRAINING_APP_PATH]: "/training.html",
    [NURSE_TRAINING_APP_PATH]: "/nurse-training.html",
    [INVESTOR_APP_PATH]: "/investor.html",
    [MONITOR_APP_PATH]: "/monitor.html",
    [DIABETES_APP_PATH]: "/diabetes.html"
  };
  const hostHomeRoutes = {
    "admin.e-clinic-control.ru": "/admin.html",
    "doctor.e-clinic-control.ru": "/doctor.html",
    "survey.e-clinic-control.ru": "/survey.html",
    "training.e-clinic-control.ru": "/training.html",
    "nurse.e-clinic-control.ru": "/nurse-training.html",
    "investor.e-clinic-control.ru": "/investor.html",
    "monitor.e-clinic-control.ru": "/monitor.html",
    "diabetes.e-clinic-control.ru": "/diabetes.html"
  };
  const route = url.pathname === "/" && hostHomeRoutes[host] ? hostHomeRoutes[host] : appRoutes[url.pathname] || url.pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Нет доступа");
  try {
    if (route.startsWith('/help/') && extname(filePath) === '.mp4') {
      const { size } = await stat(filePath);
      const headers = { ...securityHeaders(), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) return send(res, 416, '', { 'Content-Range': `bytes */${size}` });
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return send(res, 416, '', { 'Content-Range': `bytes */${size}` });
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
      res.writeHead(req.headers.range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(filePath, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      return stream.pipe(res);
    }
    const content = await readFile(filePath);
    const privatePages = new Set([
      "/admin.html",
      "/doctor.html",
      "/survey.html",
      "/training.html",
      "/nurse-training.html",
      "/investor.html",
      "/monitor.html",
      "/privacy-admin.html"
    ]);
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      ...(privatePages.has(route) ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
      ...securityHeaders()
    });
    res.end(content);
  } catch {
    return send(res, 404, "Страница не найдена", { "X-Robots-Tag": "noindex, nofollow" });
  }
}

function getLanUrls() {
  const urls = [`http://localhost:${PORT}`];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`http://${entry.address}:${PORT}`);
    }
  }
  return urls;
}

function dushanbeClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dushanbe", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

let maintenanceRunning = false;
async function runScheduledMaintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const db = await readDb();
    const clock = dushanbeClock();
    if (db.settings?.backupStatus?.createdAt?.slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
      await createSecureBackup(db, "daily");
    }
    const reports = db.settings?.dailyReports;
    await sendDueTelegramReminders(db);
    if (reports?.enabled && reports.time === clock.time && reports.lastSentDate !== clock.date) {
      const sent = await sendTelegramReport(db);
      reports.lastSentDate = clock.date;
      reports.lastSentAt = sent.sentAt;
      reports.lastError = "";
      await writeDb(db);
    }
  } catch (error) {
    console.error("Scheduled maintenance failed:", error.message || error);
    try {
      const db = await readDb();
      if (db.settings?.dailyReports) {
        db.settings.dailyReports.lastError = String(error.message || error).slice(0, 300);
        await writeDb(db);
      }
    } catch {}
  } finally {
    maintenanceRunning = false;
  }
}

createServer(async (req, res) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const startedAt = Date.now();
  res.once("finish", () => {
    if (res.statusCode >= 400) {
      securityEvent("http_error_response", req, { statusCode: res.statusCode, durationMs: Date.now() - startedAt });
    }
  });
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!isTrustedStateChangingRequest(req)) {
      securityEvent("cross_site_request_blocked", req);
      return send(res, 403, { error: "Межсайтовый запрос заблокирован" });
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    securityEvent("application_error", req, { errorName: error?.name || "Error" });
    console.error(error);
    if ([400, 413].includes(error.statusCode)) {
      return send(res, error.statusCode, { error: error.message });
    }
    if (isDatabaseError(error)) {
      return send(res, 503, { error: "База данных временно недоступна", details: error.message || String(error) });
    }
    return send(res, 500, { error: "Ошибка сервера" });
  }
}).listen(PORT, HOST, () => {
  console.log("Medical QR system:");
  for (const baseUrl of getLanUrls()) {
    console.log(`  Admin:        ${baseUrl}${ADMIN_APP_PATH}`);
    console.log(`  Doctor:       ${baseUrl}${DOCTOR_APP_PATH}`);
    console.log(`  Patient form: ${baseUrl}${SURVEY_APP_PATH}`);
    console.log(`  Training:     ${baseUrl}${TRAINING_APP_PATH}`);
    console.log(`  Nurse test:   ${baseUrl}${NURSE_TRAINING_APP_PATH}`);
    console.log(`  Investor:     ${baseUrl}${INVESTOR_APP_PATH}`);
    console.log(`  Monitor:      ${baseUrl}${MONITOR_APP_PATH}`);
  }
  setTimeout(() => runScheduledMaintenance(), 5000);
  setInterval(() => runScheduledMaintenance(), 60 * 1000).unref();
});
