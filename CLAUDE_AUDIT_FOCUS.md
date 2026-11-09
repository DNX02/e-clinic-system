# МАТЕРИАЛЫ ДЛЯ АУДИТА И ПОИСКА БАГОВ В E-CLINIC (MEDICAL QR SYSTEM)
**Дата:** 9 ноября 2026 г.  
**Проект:** E-Clinic (Система скрининга НИЗ, диабета 2 типа и сердечно-сосудистого риска)  
**Контекст:** Ответы на вопросы эксперта (Claude) + критический код ядра для глубокого аудита.

---

## 1. ОТВЕТЫ НА ВОПРОСЫ ЭКСПЕРТА

### Вопрос 1: В какой стране работают поликлиники? Требования к хранению медданных
* **Страна:** Республика Таджикистан (г. Душанбе).
* **Медицинские учреждения:** Городские поликлиники г. Душанбе (ГЦЗ №1 — №15).
* **Законодательная база:**
  - Закон РТ № 1564 «О защите персональных данных» от 3 августа 2018 г.
  - Закон РТ «Об охране здоровья граждан».
  - Нормативные акты и стандарты Минздрава РТ по врачебной тайне и первичной медико-санитарной помощи (ПМСП).
* **Оператор и согласие:**
  - Оператор персональных данных — Минздрав РТ / Управление здравоохранения г. Душанбе.
  - Согласие пациента — информированное добровольное согласие при обращении в поликлинику или при подворовом скрининге участковой медсестрой.
* **Инфраструктура хостинга:**
  - Текущий пилотный контур: AWS Lightsail Stockholm (`eu-north-1`), Ubuntu 24.04, Node.js v24, PostgreSQL 16, TLS 1.3 (Let's Encrypt), UFW firewall.
  - Для промышленного масштабирования подготовлен план миграции в государственный/национальный контур ЦОД в г. Душанбе.

---

### Вопрос 2: Текущее состояние исправлений (что уже сделано после вашего первого отчёта)
1. **Однофамильцы и год рождения (Ошибка 409):**  
   Ранее совпадение ФИО и телефона вызывало ошибку 409 («Пациент уже существует»). Добавлена функция `extractBirthYear`: теперь пациенты с одинаковыми именами, но разным годом рождения, сохраняются штатно без конфликтов.
2. **Идемпотентность и защита от потери данных (UUID `clientSurveyId`):**  
   Каждая анкета на телефоне генерирует уникальный UUID `clientSurveyId`. При повторной отправке сервер распознаёт UUID и возвращает `{ ok: true, alreadySaved: true, id }`.
3. **Устранение IDOR:**  
   Сервер больше не возвращает полную медицинскую анкету пациента при совпадении ID — возвращается только статус успешного подтверждения сохранения.
4. **Конкурентность синхронизации (Safari iOS & вкладки):**  
   Внедрён мьютекс `syncNurseInFlight` и Web Locks API (`navigator.locks.request("eclinic_sync_nurse")`). События `visibilitychange`, `pageshow`, `focus` и `online` больше не вызывают параллельных гонок отправки.
5. **Ошибки 4xx в офлайн-очереди:**  
   Клиентские ошибки валидации (400, 422) помечаются флагом `requiresEdit: true` и не зацикливают бесконечные сетевые повторы.
6. **Индексы PostgreSQL:**  
   Создано 5 B-tree индексов по JSONB полям (`clientSurveyId`, `clinic`, `birthDate`, `createdAt`, `surveyId`).
7. **Шкала риска ССЗ (ВОЗ):**  
   Самодельное название «SCORE2 Lite» с искусственными процентами заменено на «Упрощённый скрининговый индекс сердечно-сосудистого риска (ВОЗ)» без псевдо-процентов.
8. **Порог FINDRISC к врачу изменён на 14 баллов:**  
   Баллы 12 и 13 классифицируются как умеренный риск, но сами по себе не направляют к врачу (если АД < 140 и сахар в норме). Направление к врачу по FINDRISC срабатывает строго с **14 баллов**.

---

## 2. СХЕМА БАЗЫ ДАННЫХ POSTGRESQL (DDL И ИНДЕКСЫ)

```sql
-- 1. Основное состояние и метаданные
CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_meta (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sessions (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Нормализованные таблицы сущностей
-- (app_admins, app_doctors, app_nurse_surveys, app_doctor_visits, 
--  app_training_participants, app_training_attempts, app_nurse_training_participants,
--  app_nurse_training_attempts, app_patient_tasks, app_appointments, 
--  app_reminder_queue, app_message_events, app_activity_events)

CREATE TABLE IF NOT EXISTS app_nurse_surveys (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_doctor_visits (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Созданные индексы для быстрого поиска и идемпотентности:
CREATE INDEX IF NOT EXISTS idx_nurse_surveys_client_id 
    ON app_nurse_surveys ((data->>'clientSurveyId')) 
    WHERE (data->>'clientSurveyId') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nurse_surveys_clinic 
    ON app_nurse_surveys ((data->'patient'->>'clinic'));

CREATE INDEX IF NOT EXISTS idx_nurse_surveys_birth_date 
    ON app_nurse_surveys ((data->'patient'->>'birthDate'));

CREATE INDEX IF NOT EXISTS idx_nurse_surveys_created_at 
    ON app_nurse_surveys ((data->>'createdAt'));

CREATE INDEX IF NOT EXISTS idx_doctor_visits_survey_id 
    ON app_doctor_visits ((data->>'surveyId'));
```

### Структура документа анкеты (`app_nurse_surveys.data`):
```json
{
  "id": "uuid-v4",
  "clientSurveyId": "uuid-v4",
  "patient": {
    "lastName": "Алимов",
    "firstName": "Фарход",
    "middleName": "Саидович",
    "birthDate": "1978-04-12",
    "phone": "+992900112233",
    "address": "г. Душанбе, ул. Борбад 45",
    "clinic": "Поликлиника №1",
    "sex": "male"
  },
  "nurse": {
    "fullName": "Медсестра Рахимова",
    "source": "survey"
  },
  "measurements": {
    "age": 48,
    "weight": 85.5,
    "weightSource": "measured",
    "height": 174,
    "bmi": 28.2,
    "systolic": 135,
    "diastolic": 85,
    "arm": 30,
    "waist": 96,
    "calf": 36,
    "rabitoWeight": null,
    "glucoseLevel": 5.4
  },
  "answers": {
    "activity": "no",
    "vegetables": "yes",
    "bpMeds": "no",
    "highGlucose": "no",
    "familyDiabetes": "none",
    "smoker": "no"
  },
  "findrisc": {
    "score": 8,
    "level": "Слегка повышенный",
    "highRisk": false
  },
  "score2": {
    "score": 2,
    "percent": 4,
    "level": "Низкий",
    "highRisk": false,
    "note": "Упрощённый скрининговый индекс сердечно-сосудистого риска (ВОЗ)..."
  },
  "referralReasons": [],
  "needsDoctor": false,
  "createdAt": "2026-11-09T05:30:00.000Z"
}
```

---

## 3. КЛИЕНТСКИЙ КОД ОФЛАЙН-ОЧЕРЕДИ И СИНХРОНИЗАЦИИ (`public/app.js`)

```javascript
// Mutex против параллельных гонок синхронизации
let syncNurseInFlight = false;

// Сохранение анкеты локально при отсутствии сети или ответе 503
function saveOfflineSurvey(data) {
  const queue = offlineSurveyQueue();
  const id = data.clientSurveyId || data.id || crypto.randomUUID();
  const surveyData = { ...data, clientSurveyId: id };
  const item = { 
    id, 
    savedAt: new Date().toISOString(), 
    attempts: 0, 
    lastError: "", 
    data: surveyData,
    requiresEdit: false
  };
  queue.push(item);
  writeOfflineSurveyQueue(queue);
  persistToIdb("nurse_surveys", item, "put");
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && "SyncManager" in window) {
    navigator.serviceWorker.ready.then((reg) => reg.sync.register("sync-nurse-surveys")).catch(() => {});
  }
}

// Запуск синхронизации с защитой Web Locks API
async function syncOfflineSurveys() {
  if (syncNurseInFlight) return;
  if (typeof navigator !== "undefined" && navigator.locks) {
    try {
      return await navigator.locks.request("eclinic_sync_nurse", { ifAvailable: true }, async (lock) => {
        if (!lock) return; // Другая вкладка уже выполняет отправку
        await doSyncOfflineSurveys();
      });
    } catch {
      return doSyncOfflineSurveys();
    }
  }
  return doSyncOfflineSurveys();
}

// Процесс отправки элементов очереди
async function doSyncOfflineSurveys() {
  if (syncNurseInFlight) return;
  syncNurseInFlight = true;
  const button = document.querySelector("#syncSurveysButton");
  const result = document.querySelector("#surveyResult");
  try {
    let queue = offlineSurveyQueue();
    if (!queue.length) {
      updateOfflineSurveyStatus();
      return;
    }
    if (button) button.disabled = true;
    const remaining = [];
    let sent = 0;
    for (const item of queue) {
      // Пропускаем анкеты с ошибками валидации 4xx (требуют ручной правки)
      if (item.requiresEdit) {
        remaining.push(item);
        continue;
      }
      try {
        await sendNurseSurvey(item.data);
        await persistToIdb("nurse_surveys", item.id, "delete");
        sent += 1;
      } catch (error) {
        // Ошибки 400, 422 помечаем как требующие правки
        const isClientError = error?.status >= 400 && error.status < 500 && error.status !== 409;
        const updated = {
          ...item,
          attempts: Number(item.attempts || 0) + 1,
          lastTriedAt: new Date().toISOString(),
          lastError: String(error.message || "Ошибка сети").slice(0, 200),
          status: error?.status || 0,
          requiresEdit: isClientError
        };
        remaining.push(updated);
        await persistToIdb("nurse_surveys", updated, "put");
      }
    }
    writeOfflineSurveyQueue(remaining);
    updateOfflineSurveyStatus();
    if (result) {
      result.innerHTML = remaining.length
        ? `<div class="notice warn">Отправлено: ${sent}. Осталось без синхронизации: ${remaining.length}.</div>`
        : `<div class="notice ok">Синхронизация завершена. Отправлено анкет: ${sent}.</div>`;
    }
  } finally {
    syncNurseInFlight = false;
    if (button) button.disabled = offlineSurveyQueue().length === 0;
  }
}
```

---

## 4. СЕРВЕРНЫЙ КОД ПРОВЕРКИ ДУБЛИКАТОВ И СОХРАНЕНИЯ АНКЕТЫ (`server.js`)

```javascript
function extractBirthYear(raw) {
  if (!raw) return "";
  const match = String(raw).match(/(\d{4})/);
  return match ? match[1] : "";
}

function normalizePatientIdentity(patient) {
  const last = cleanText(patient?.lastName || "", "Фамилия").toLowerCase();
  const first = cleanText(patient?.firstName || "", "Имя").toLowerCase();
  const middle = cleanText(patient?.middleName || "", "Отчество").toLowerCase();
  return `${last} ${first} ${middle}`.trim().replace(/\s+/g, " ");
}

function normalizePatientPhone(patient) {
  const digits = String(patient?.phone || "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : "";
}

function findDuplicateSurvey(db, input) {
  if (input.allowDuplicate || input.force) return null;
  const inputBirthYear = extractBirthYear(input.birthDate);
  const identity = normalizePatientIdentity(input);
  const clinic = clinicKey(input.clinic);
  const phone = normalizePatientPhone(input);
  if (!phone) return null;
  return (db.nurseSurveys || []).find((survey) => {
    if (survey.archivedAt) return false;
    if (clinicKey(survey.patient?.clinic || survey.clinic) !== clinic) return false;
    
    // Если годы рождения указаны и различаются — это разные люди (однофамильцы)
    const existingBirthYear = extractBirthYear(survey.patient?.birthDate);
    if (inputBirthYear && existingBirthYear && inputBirthYear !== existingBirthYear) {
      return false;
    }
    return (
      normalizePatientIdentity(survey.patient) === identity &&
      normalizePatientPhone(survey.patient) === phone
    );
  });
}

// POST /api/nurse-surveys
if (req.method === "POST" && url.pathname === "/api/nurse-surveys") {
  const rawBody = await parseBody(req);
  const clientSurveyId = cleanText(rawBody.clientSurveyId, "ID анкеты", { max: 100 });
  
  // Идемпотентность по UUID: если анкета уже принята ранее, подтверждаем без дублирования
  if (clientSurveyId && isValidUuid(clientSurveyId)) {
    const existing = (db.nurseSurveys || []).find((s) => s.clientSurveyId === clientSurveyId || s.id === clientSurveyId);
    if (existing) {
      // Защита от IDOR: возвращаем только статус подтверждения, без чужих ПДН
      return send(res, 200, { ok: true, alreadySaved: true, id: existing.id });
    }
  }
  
  const body = validateNurseSurveyInput(rawBody);
  if (clientSurveyId && isValidUuid(clientSurveyId)) body.clientSurveyId = clientSurveyId;
  
  // Проверка дубликатов (с учётом года рождения и allowDuplicate)
  const duplicate = findDuplicateSurvey(db, body);
  if (duplicate) {
    return send(res, 409, { 
      error: "Пациент с такими ФИО, датой рождения и телефоном уже существует в этой поликлинике", 
      duplicateId: duplicate.id, 
      duplicate: true 
    });
  }
  
  const survey = buildNurseSurvey(body);
  if (clientSurveyId && isValidUuid(clientSurveyId)) {
    survey.id = clientSurveyId;
    survey.clientSurveyId = clientSurveyId;
  }
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
```

---

## 5. КЛИНИЧЕСКИЕ ШКАЛЫ РИСКА (`server.js`)

```javascript
// 1. FINDRISC (порог направления к врачу strictly >= 14 баллов)
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
  return { score, level, highRisk: score >= 14 };
}

// 2. Упрощённый скрининговый индекс сердечно-сосудистого риска (ВОЗ)
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
  const score = points;
  const percent = Math.min(30, Math.max(1, points * 2));
  const level = points <= 2 ? "Низкий" : points <= 4 ? "Умеренный" : "Высокий";
  return {
    score,
    percent,
    level,
    highRisk: points >= 5 || systolic >= 140,
    note: "Упрощённый скрининговый индекс сердечно-сосудистого риска (возраст, пол, САД, курение по нелабораторной шкале ВОЗ). Не заменяет лабораторную шкалу SCORE2 (без липидограммы)."
  };
}

// 3. Расчёт идеальной/расчётной массы тела по формуле Рабито (Rabito)
function calculateRabito(input) {
  const arm = Number(input.arm || 0);
  const waist = Number(input.rabitoWaist || input.waist || 0);
  const calf = Number(input.calf || 0);
  const sexCoef = input.sex === "male" ? 1 : 2;
  if (![arm, waist, calf].every((value) => Number.isFinite(value) && value > 0)) return null;
  return Number((0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241).toFixed(1));
}

// 4. Определение причин направления к врачу
function referralReasons(input, findrisc, score2) {
  const reasons = [];
  const systolic = Number(input.systolic || 0);
  const score2Factors = [];
  if (Number(input.age || 0) >= 50) score2Factors.push("возраст");
  if (input.sex === "male") score2Factors.push("мужской пол");
  if (input.smoker === "yes") score2Factors.push("курение");
  if (systolic >= 140) score2Factors.push("повышенное САД");
  if (findrisc.highRisk) reasons.push(`FINDRISC: ${findrisc.score} баллов (${findrisc.level})`);
  if (score2.highRisk) reasons.push(`Сердечно-сосудистый риск: ${score2.level} (индекс: ${score2.score ?? score2.percent})${score2Factors.length ? `; факторы: ${score2Factors.join(", ")}` : ""}`);
  if (systolic >= 140) reasons.push(`Систолическое АД: ${systolic} мм рт.ст.`);
  return reasons;
}
```

---

## 6. ВОПРОСЫ ДЛЯ АУДИТА И ПОИСКА СКРЫТЫХ БАГОВ (ДЛЯ CLAUDE)
Пожалуйста, проведи глубокий анализ представленного кода и архитектуры по следующим аспектам:

1. **Сетевые гонки и офлайн-очередь в PWA:**
   - Возможна ли ситуация, когда `sendNurseSurvey` завершился успешно на сервере (запись в БД создана), но HTTP-ответ потерян из-за обрыва соединения? При следующем вызове синхронизации анкета отправится повторно с тем же `clientSurveyId`. Корректно ли сервер вернёт `alreadySaved: true` и удалит ли клиент её из очереди?
   - Не останется ли висящих анкет в IndexedDB, если медсестра очистит кеш Safari или сработает эвикция хранилища iOS?
2. **Транзакционность и конкурентная запись в PostgreSQL:**
   - Текущий механизм `writeDb` использует `syncNormalizedCloudDb` с проверкой хеша записей. Если одновременно поступят 10 запросов на создание анкет от разных медсестёр, не перезапишут ли они состояние друг друга в памяти `dbCache`?
   - Как безопаснее перейти на изолированный `INSERT INTO app_nurse_surveys` без перезаписи полного состояния?
3. **Безопасность и контроль доступа (RBAC & ASVS Level 2):**
   - Есть ли уязвимости Broken Object Level Authorization (BOLA/IDOR) в эндпоинтах `/api/doctor/visits`, `/api/admin/patients/:id`, `/api/patient-outreach`?
   - Проверяется ли привязка врача к поликлинике при получении данных пациента?
4. **Клинические граничные условия:**
   - Есть ли краевые случаи в расчёте ИМТ, Рабито или окружности талии (деление на ноль, отрицательные числа, экстремальный возраст)?
