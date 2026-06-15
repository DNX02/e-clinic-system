import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const dbPath = join(dataDir, "db.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_APP_PATH = "/app-1-admin-panel";
const DOCTOR_APP_PATH = "/app-2-doctor";
const SURVEY_APP_PATH = "/app-3-patient-survey";
const TRAINING_APP_PATH = "/app-4-doctor-knowledge";
const NURSE_TRAINING_APP_PATH = "/app-5-nurse-knowledge";
let dbCache = null;
let dbLoadPromise = null;
let dbWritePromise = Promise.resolve();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const seedAdmins = [
  { id: "admin-main", name: "Главный администратор", username: "admin", role: "owner", password: "Admin123!" },
  { id: "admin-view-1", name: "Администратор 2", username: "admin2", role: "observer", password: "View123!" },
  { id: "admin-view-2", name: "Администратор 3", username: "admin3", role: "observer", password: "View123!" }
];

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
      ["age", "Возраст, 52 года", "3"],
      ["bmi", "ИМТ 31 кг/м2", "3"],
      ["waist", "Окружность талии 104 см, мужчина", "4"],
      ["activity", "Физическая активность <30 мин/день", "2"],
      ["vegetables", "Овощи/фрукты не ежедневно", "0"],
      ["bpTherapy", "Антигипертензивная терапия: да", "2"],
      ["highGlucose", "Повышение глюкозы ранее: нет", "0"],
      ["family", "Семейный анамнез СД: мать с СД2", "5"],
      ["risk", "ИТОГО: категория риска", "Высокий риск"]
    ],
    criteria: ["1 балл за каждый правильно заполненный компонент FINDRISC и итоговую категорию риска."],
    key: "Правильные баллы: возраст 3, ИМТ 3, талия 4, физическая активность 2, овощи/фрукты 0, АГ-терапия 2, глюкоза ранее 0, семейный анамнез 5. Итог: высокий риск."
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
      ["Женщина 58 лет, жажда, полиурия. Случайная глюкоза 12,4 ммоль/л.", "Повышение артериального давления"]
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
      { text: "Показания к направлению к специалисту", options: { A: "Направление не требуется", B: "Эндокринолог - в течение 7-14 дней, офтальмолог - в течение 1 месяца, кардиолог - по показаниям", C: "Только к кардиологу", D: "Экстренная госпитализация", E: "Только к нефрологу" }, answer: "B" }
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
      { text: "Как лучше объяснить пациенту дальнейшие шаги", options: { A: "У вас диабет, будете колоть инсулин", B: "У вас выявился сахарный диабет 2 типа. Сейчас важно быстро нормализовать сахар и давление, чтобы не развились осложнения на глаза, почки и ноги. Начнем с таблеток, диеты и отказа от курения. Нужно пройти обследование у специалистов в ближайшие 2 недели", C: "Это не страшно, просто похудейте", D: "Нужно немедленно лечь в больницу", E: "Ничего не объяснять, только выписать рецепты" }, answer: "B" }
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

async function ensureDb() {
  await mkdir(dataDir, { recursive: true });
  if (existsSync(dbPath)) return;
  const now = new Date().toISOString();
  const admins = seedAdmins.map(({ password, ...user }) => ({
    ...user,
    passwordHash: hashPassword(password),
    createdAt: now
  }));
  await writeDb({
    admins,
    doctors: [],
    nurseSurveys: [],
    doctorVisits: [],
    trainingParticipants: [],
    trainingAttempts: [],
    nurseTrainingParticipants: [],
    nurseTrainingAttempts: [],
    sessions: {},
    settings: { createdAt: now }
  });
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
      const db = JSON.parse(await readFile(dbPath, "utf8"));
      let changed = false;
      for (const key of ["trainingParticipants", "trainingAttempts", "nurseTrainingParticipants", "nurseTrainingAttempts"]) {
        if (!Array.isArray(db[key])) {
          db[key] = [];
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
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  const writeTask = dbWritePromise.catch(() => {}).then(async () => {
    await writeFile(tmpPath, body, "utf8");
    await rename(tmpPath, dbPath);
  });
  dbWritePromise = writeTask;
  await writeTask;
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers
  });
  res.end(body);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getCookie(req, name) {
  const cookies = req.headers.cookie?.split(";").map((item) => item.trim()) || [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

async function getSession(req) {
  const sid = getCookie(req, "sid");
  if (!sid) return null;
  const db = await readDb();
  return db.sessions[sid] || null;
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

function publicDoctor(doctor) {
  const { accessKeyHash, ...safe } = doctor;
  return safe;
}

function clinicKey(value = "") {
  const text = String(value).trim().toLowerCase();
  const number = text.match(/\d+/)?.[0];
  return number || text.replace(/\s+/g, "");
}

function canMutateAdmin(session, db) {
  if (!session || session.userType !== "admin") return false;
  return db.admins.find((admin) => admin.id === session.userId)?.role === "owner";
}

function requireAdmin(session) {
  return session?.userType === "admin";
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
  if (!arm || !waist || !calf) return null;
  return Number((0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241).toFixed(1));
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
  const session = await getSession(req);
  const db = await readDb();

  if (req.method === "GET" && url.pathname === "/api/server-info") {
    const urls = getLanUrls();
    const currentBaseUrl = requestBaseUrl(req);
    const preferredBaseUrl = currentBaseUrl.includes("trycloudflare.com")
      ? currentBaseUrl
      : urls.find((item) => !item.includes("localhost")) || urls[0];
    return send(res, 200, {
      urls,
      apps: {
        admin: `${preferredBaseUrl}${ADMIN_APP_PATH}`,
        doctor: `${preferredBaseUrl}${DOCTOR_APP_PATH}`,
        survey: `${preferredBaseUrl}${SURVEY_APP_PATH}`
        , training: `${preferredBaseUrl}${TRAINING_APP_PATH}`,
        nurseTraining: `${preferredBaseUrl}${NURSE_TRAINING_APP_PATH}`
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/login/admin") {
    const body = await parseBody(req);
    const admin = db.admins.find((item) => item.username === body.username);
    if (!admin || !verifyPassword(body.password || "", admin.passwordHash)) return send(res, 401, { error: "Неверный логин или пароль" });
    const sid = await createSession("admin", admin.id);
    return send(res, 200, { ok: true }, { "Set-Cookie": `sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Lax` });
  }

  if (req.method === "POST" && url.pathname === "/api/login/doctor") {
    const body = await parseBody(req);
    const doctor = db.doctors.find((item) => item.login === body.login);
    if (!doctor || !verifyPassword(body.accessKey || "", doctor.accessKeyHash)) return send(res, 401, { error: "Неверный логин или ключ" });
    const sid = await createSession("doctor", doctor.id);
    return send(res, 200, { ok: true }, { "Set-Cookie": `sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Lax` });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    await clearSession(req);
    return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; Max-Age=0; Path=/" });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    if (!session) return send(res, 200, { user: null });
    if (session.userType === "admin") {
      const admin = db.admins.find((item) => item.id === session.userId);
      return send(res, 200, { user: { type: "admin", id: admin.id, name: admin.name, role: admin.role } });
    }
    const doctor = db.doctors.find((item) => item.id === session.userId);
    return send(res, 200, { user: { type: "doctor", id: doctor.id, name: doctor.fullName, specialty: doctor.specialty, clinic: doctor.clinic } });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
    if (!requireAdmin(session)) return send(res, 403, { error: "Нет доступа" });
    const diabetesDrugCounts = countSelected(db.doctorVisits.flatMap((visit) => visit.diabetesDrugs || []));
    const hypertensionDrugCounts = countSelected(db.doctorVisits.flatMap((visit) => visit.hypertensionDrugs || []));
    return send(res, 200, {
      doctors: db.doctors.map(publicDoctor),
      surveys: db.nurseSurveys,
      visits: db.doctorVisits,
      stats: buildStats(db),
      canEdit: canMutateAdmin(session, db),
      dictionaries: { diabetesDrugs, hypertensionDrugs },
      drugStats: { diabetesDrugCounts, hypertensionDrugCounts },
      trainingParticipants: db.trainingParticipants.map(publicParticipant),
      trainingAttempts: db.trainingAttempts.map(enrichTrainingAttempt),
      trainingStats: buildTrainingStats(db),
      nurseTrainingParticipants: db.nurseTrainingParticipants.map(publicNurseParticipant),
      nurseTrainingAttempts: db.nurseTrainingAttempts,
      nurseTrainingStats: buildNurseTrainingStats(db)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/training-participants") {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const body = await parseBody(req);
    const participant = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      clinic: body.clinic,
      specialty: body.specialty || "",
      phone: body.phone || "",
      createdAt: new Date().toISOString()
    };
    db.trainingParticipants.push(participant);
    await writeDb(db);
    return send(res, 201, { participant: publicParticipant(participant) });
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
      clinic: body.clinic,
      position: body.position || "Медсестра",
      phone: body.phone || "",
      createdAt: new Date().toISOString()
    };
    db.nurseTrainingParticipants.push(participant);
    await writeDb(db);
    return send(res, 201, { participant: publicNurseParticipant(participant) });
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
    const accessKey = body.accessKey || crypto.randomBytes(9).toString("base64url");
    const doctor = {
      id: crypto.randomUUID(),
      fullName: body.fullName,
      login: body.login,
      accessKeyHash: hashPassword(accessKey),
      passport: body.passport,
      clinic: body.clinic,
      specialty: body.specialty,
      experienceYears: Number(body.experienceYears || 0),
      createdAt: new Date().toISOString()
    };
    db.doctors.push(doctor);
    await writeDb(db);
    return send(res, 201, { doctor: publicDoctor(doctor), accessKey });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/doctors/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для изменения данных" });
    const id = url.pathname.split("/").pop();
    const doctor = db.doctors.find((item) => item.id === id);
    if (!doctor) return send(res, 404, { error: "Врач не найден" });
    const body = await parseBody(req);
    Object.assign(doctor, {
      fullName: body.fullName,
      login: body.login,
      passport: body.passport,
      clinic: body.clinic,
      specialty: body.specialty,
      experienceYears: Number(body.experienceYears || 0)
    });
    if (body.accessKey) doctor.accessKeyHash = hashPassword(body.accessKey);
    await writeDb(db);
    return send(res, 200, { doctor: publicDoctor(doctor) });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/doctors/")) {
    if (!canMutateAdmin(session, db)) return send(res, 403, { error: "Недостаточно прав для удаления данных" });
    const id = url.pathname.split("/").pop();
    db.doctors = db.doctors.filter((doctor) => doctor.id !== id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/nurse-surveys") {
    const body = await parseBody(req);
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
      measurements: {
        age: Number(body.age || 0),
        height: Number(body.height || 0),
        bmi: Number(body.bmi || 0),
        systolic: Number(body.systolic || 0),
        diastolic: Number(body.diastolic || 0),
        arm: Number(body.arm || 0),
        waist: Number(body.rabitoWaist || body.waist || 0),
        rabitoWaist: Number(body.rabitoWaist || body.waist || 0),
        calf: Number(body.calf || 0),
        rabitoWeight
      },
      answers: body,
      findrisc,
      score2,
      referralReasons: reasons,
      needsDoctor: reasons.length > 0,
      createdAt: new Date().toISOString()
    };
    db.nurseSurveys.push(survey);
    await writeDb(db);
    return send(res, 201, { survey });
  }

  if (req.method === "GET" && url.pathname === "/api/doctor/workspace") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const doctor = db.doctors.find((item) => item.id === session.userId);
    const doctorClinicKey = clinicKey(doctor?.clinic);
    return send(res, 200, {
      doctor: doctor ? publicDoctor(doctor) : null,
      surveys: db.nurseSurveys.filter((survey) => clinicKey(survey.patient?.clinic || survey.clinic) === doctorClinicKey),
      visits: db.doctorVisits.filter((visit) => visit.doctorId === session.userId),
      dictionaries: { diabetesDrugs, hypertensionDrugs }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/doctor/visits") {
    if (session?.userType !== "doctor") return send(res, 403, { error: "Нет доступа" });
    const body = await parseBody(req);
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
      systolic: Number(body.systolic || 0),
      diastolic: Number(body.diastolic || 0),
      referrals: body.referrals || [],
      treatmentPlan: body.treatmentPlan || "",
      diabetesDrugs: body.diabetesDrugs || [],
      hypertensionDrugs: body.hypertensionDrugs || [],
      lifestyleRecommendations: {
        diabetesDiet: Array.isArray(body.lifestyleRecommendations) && body.lifestyleRecommendations.includes("diabetesDiet"),
        physicalActivity: Array.isArray(body.lifestyleRecommendations) && body.lifestyleRecommendations.includes("physicalActivity")
      },
      createdAt: new Date().toISOString()
    };
    db.doctorVisits.push(visit);
    await writeDb(db);
    return send(res, 201, { visit });
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

async function serveStatic(req, res, url) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(":")[0].toLowerCase();
  const appRoutes = {
    "/": "/index.html",
    [ADMIN_APP_PATH]: "/admin.html",
    [DOCTOR_APP_PATH]: "/doctor.html",
    [SURVEY_APP_PATH]: "/survey.html",
    [TRAINING_APP_PATH]: "/training.html",
    [NURSE_TRAINING_APP_PATH]: "/nurse-training.html"
  };
  const hostHomeRoutes = {
    "admin.e-clinic-control.ru": "/admin.html",
    "doctor.e-clinic-control.ru": "/doctor.html",
    "survey.e-clinic-control.ru": "/survey.html",
    "training.e-clinic-control.ru": "/training.html",
    "nurse.e-clinic-control.ru": "/nurse-training.html"
  };
  const route = url.pathname === "/" && hostHomeRoutes[host] ? hostHomeRoutes[host] : appRoutes[url.pathname] || url.pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Нет доступа");
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    const content = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": mime[".html"] });
    res.end(content);
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

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
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
  }
  console.log("Admin: admin / Admin123!");
  console.log("View only: admin2 / View123!, admin3 / View123!");
});
