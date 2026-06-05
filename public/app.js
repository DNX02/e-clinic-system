const app = document.querySelector("#app");
let state = { me: null, admin: null, doctor: null, tab: "stats", selectedSurvey: null, lastDoctorKey: null, surveyClinicFilter: "all" };
const ADMIN_APP_PATH = "/app-1-admin-panel";
const DOCTOR_APP_PATH = "/app-2-doctor";
const SURVEY_APP_PATH = "/app-3-patient-survey";
const TRAINING_APP_PATH = "/app-4-doctor-knowledge";
const NURSE_TRAINING_APP_PATH = "/app-5-nurse-knowledge";

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
};

const html = (strings, ...values) => strings.map((part, i) => part + (values[i] ?? "")).join("");
const money = (value) => Number(value || 0).toLocaleString("ru-RU");
const fullName = (p) => [p?.lastName, p?.firstName, p?.middleName].filter(Boolean).join(" ");
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
const surveyClinic = (survey) => survey.patient?.clinic || survey.clinic || "Без поликлиники";
const clinicSortKey = (value = "") => {
  const text = String(value);
  const number = text.match(/\d+/)?.[0];
  return number ? String(number).padStart(4, "0") : text.toLowerCase();
};
const clinicNumbers = [1, 2, 4, 7, 9, 10, 11, 12, 14, 15];
const clinicOptions = clinicNumbers.map((number) => [`Поликлиника №${number}`, `Поликлиника №${number}`]);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

async function boot() {
  const { user } = await api("/api/me");
  state.me = user;
  route();
}

function route() {
  const path = window.location.pathname;
  const appMode = document.body.dataset.app;
  if (appMode === "survey" || path === SURVEY_APP_PATH) return renderNurseSurvey();
  if (appMode === "training" || path === TRAINING_APP_PATH) return loadTrainingPretest();
  if (appMode === "nurse-training" || path === NURSE_TRAINING_APP_PATH) return loadNurseTraining();
  if (appMode === "doctor" || path === DOCTOR_APP_PATH) return state.me?.type === "doctor" ? loadDoctor() : renderDoctorLogin();
  if (appMode === "admin" || path === ADMIN_APP_PATH) return state.me?.type === "admin" ? loadAdmin() : renderAdminLogin();
  renderHome();
}

function setPage(content) {
  app.innerHTML = content;
}

function topbar(title, nav = "") {
  return html`
    <header class="topbar">
      <div>
        <div class="brand">${title}</div>
        <div class="muted">${state.me?.name || ""}</div>
      </div>
      <div class="nav">${nav}<button class="secondary" data-action="logout">Выйти</button></div>
    </header>
  `;
}

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "logout") {
    await api("/api/logout", { method: "POST", body: "{}" });
    state = { me: null, admin: null, doctor: null, tab: "stats", selectedSurvey: null, lastDoctorKey: null, surveyClinicFilter: "all" };
    window.location.href = "/";
  }
  if (action === "admin-tab") {
    state.tab = event.target.dataset.tab;
    renderAdmin();
  }
  if (action === "delete-doctor") {
    if (!confirm("Удалить профиль врача?")) return;
    await api(`/api/admin/doctors/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    state.lastDoctorKey = null;
    await loadAdmin();
  }
  if (action === "delete-training-participant") {
    if (!confirm("Удалить участника обучения и его результат пре-теста?")) return;
    await api(`/api/admin/training-participants/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "delete-nurse-training-participant") {
    if (!confirm("Удалить медсестру и результаты тестов?")) return;
    await api(`/api/admin/nurse-training-participants/${event.target.dataset.id}`, { method: "DELETE", body: "{}" });
    await loadAdmin();
  }
  if (action === "select-survey") {
    state.selectedSurvey = state.doctor.surveys.find((item) => item.id === event.target.dataset.id);
    renderDoctor();
  }
  if (action === "select-training-participant") {
    await renderTrainingWorkspace(event.target.dataset.id);
  }
  if (action === "start-pretest") {
    await renderTrainingPretest(event.target.dataset.id);
  }
  if (action === "start-posttest") {
    await renderTrainingPosttest(event.target.dataset.id);
  }
  if (action === "start-task") {
    await renderTrainingTask(event.target.dataset.participantId, event.target.dataset.taskId);
  }
  if (action === "start-post-training-tests") {
    await renderPostTrainingTests(event.target.dataset.id);
  }
  if (action === "select-nurse-training-participant") {
    await renderNurseTrainingWorkspace(event.target.dataset.id);
  }
  if (action === "start-nurse-test") {
    await renderNurseTest(event.target.dataset.id, event.target.dataset.testType);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "surveyClinicFilter") {
    state.surveyClinicFilter = event.target.value;
    renderAdmin();
  }
});

function renderHome() {
  const doctorUrl = `${location.origin}${DOCTOR_APP_PATH}`;
  const surveyUrl = `${location.origin}${SURVEY_APP_PATH}`;
  const trainingUrl = `${location.origin}${TRAINING_APP_PATH}`;
  const nurseTrainingUrl = `${location.origin}${NURSE_TRAINING_APP_PATH}`;
  setPage(html`
    <main class="login">
      <section class="panel">
        <h1>Медицинская web-система</h1>
        <div class="grid">
          <a href="${DOCTOR_APP_PATH}"><button>№2 Врач</button></a>
          <input id="homeDoctorUrl" readonly value="${doctorUrl}" />
          <a href="${SURVEY_APP_PATH}"><button>№3 Опросник больного</button></a>
          <input id="homeSurveyUrl" readonly value="${surveyUrl}" />
          <a href="${TRAINING_APP_PATH}"><button>№4 Проверка знаний</button></a>
          <input id="homeTrainingUrl" readonly value="${trainingUrl}" />
          <a href="${NURSE_TRAINING_APP_PATH}"><button>№5 Тесты медсестер</button></a>
          <input id="homeNurseTrainingUrl" readonly value="${nurseTrainingUrl}" />
        </div>
        <p class="muted">Ссылка №1 администратора не показывается здесь, чтобы врачи случайно не открывали админку.</p>
      </section>
    </main>
  `);
  api("/api/server-info").then(({ apps }) => {
    document.querySelector("#homeDoctorUrl").value = apps.doctor;
    document.querySelector("#homeSurveyUrl").value = apps.survey;
    if (apps.training) document.querySelector("#homeTrainingUrl").value = apps.training;
    if (apps.nurseTraining) document.querySelector("#homeNurseTrainingUrl").value = apps.nurseTraining;
  }).catch(() => {});
}

function renderAdminLogin() {
  setPage(html`
    <main class="login">
      <form class="panel form" id="adminLogin">
        <h1>Вход администратора</h1>
        <div class="form-row"><label>Логин</label><input name="username" autocomplete="username" required /></div>
        <div class="form-row"><label>Пароль</label><input type="password" name="password" autocomplete="current-password" required /></div>
        <button>Войти</button>
        <p class="muted">Первый вход: admin / Admin123!</p>
      </form>
    </main>
  `);
  document.querySelector("#adminLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login/admin", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      window.location.href = ADMIN_APP_PATH;
    } catch (error) {
      alert(error.message);
    }
  });
}

function renderDoctorLogin() {
  setPage(html`
    <main class="login">
      <form class="panel form" id="doctorLogin">
        <h1>Вход врача</h1>
        <div class="form-row"><label>Логин врача</label><input name="login" required /></div>
        <div class="form-row"><label>Специальный ключ</label><input type="password" name="accessKey" required /></div>
        <button>Войти</button>
      </form>
    </main>
  `);
  document.querySelector("#doctorLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login/doctor", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      window.location.href = DOCTOR_APP_PATH;
    } catch (error) {
      alert(error.message);
    }
  });
}

async function loadAdmin() {
  state.admin = await api("/api/admin/dashboard");
  renderAdmin();
}

function renderAdmin() {
  const nav = ["stats", "doctors", "training", "nurseTraining", "surveys", "visits", "qr"].map((tab) => {
    const names = { stats: "Статистика", doctors: "Врачи", training: "Обучение №4", nurseTraining: "Медсестры №5", surveys: "Анкеты", visits: "Назначения", qr: "QR" };
    return `<button data-action="admin-tab" data-tab="${tab}" class="${state.tab === tab ? "active" : ""}">${names[tab]}</button>`;
  }).join("");
  setPage(html`
    <div class="layout">
      ${topbar("Панель администратора", nav)}
      <main class="container admin-container">${adminTab()}</main>
    </div>
  `);
  bindAdminForms();
}

function adminTab() {
  if (state.tab === "doctors") return renderDoctorsAdmin();
  if (state.tab === "training") return renderTrainingAdmin();
  if (state.tab === "nurseTraining") return renderNurseTrainingAdmin();
  if (state.tab === "surveys") return renderSurveyTable(filteredAdminSurveys());
  if (state.tab === "visits") return renderVisitsAdmin();
  if (state.tab === "qr") return renderQrAdmin();
  return renderStatsAdmin();
}

function adminSurveyClinics() {
  return [...new Set(state.admin.surveys.map(surveyClinic))]
    .filter(Boolean)
    .sort((a, b) => clinicSortKey(a).localeCompare(clinicSortKey(b), "ru"));
}

function filteredAdminSurveys() {
  return state.admin.surveys
    .filter((survey) => state.surveyClinicFilter === "all" || surveyClinic(survey) === state.surveyClinicFilter)
    .sort((a, b) => {
      const clinicCompare = clinicSortKey(surveyClinic(a)).localeCompare(clinicSortKey(surveyClinic(b)), "ru");
      if (clinicCompare) return clinicCompare;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function renderStatsAdmin() {
  const s = state.admin.stats;
  return html`
    <section class="grid three">
      <div class="card metric">Врачей<strong>${money(s.doctorsTotal)}</strong></div>
      <div class="card metric">Анкет медсестры<strong>${money(s.surveysTotal)}</strong></div>
      <div class="card metric">Осмотров врача<strong>${money(s.visitsTotal)}</strong></div>
      <div class="card metric">Участников обучения<strong>${money(state.admin.trainingStats?.participantsTotal || 0)}</strong></div>
      <div class="card metric">Тест до обучения<strong>${money(state.admin.trainingStats?.preCompleted || 0)}</strong></div>
      <div class="card metric">Средний до обучения<strong>${money(state.admin.trainingStats?.preAveragePercent || 0)}%</strong></div>
      <div class="card metric">После обучения<strong>${money(state.admin.trainingStats?.taskCompleted || 0)} задач</strong></div>
      <div class="card metric">Медсестер №5<strong>${money(state.admin.nurseTrainingStats?.participantsTotal || 0)}</strong></div>
      <div class="card metric">№5 после обучения прошли<strong>${money(state.admin.nurseTrainingStats?.postPassed || 0)}</strong></div>
      <div class="card metric">Нужно к врачу<strong>${money(s.needsDoctor)} / ${s.needsDoctorPercent}%</strong></div>
      <div class="card metric">FINDRISC повышен<strong>${money(s.highFindrisc)} / ${s.highFindriscPercent}%</strong></div>
      <div class="card metric">SCORE2-lite высок<strong>${money(s.highScore2)} / ${s.highScore2Percent}%</strong></div>
    </section>
    <section class="grid two" style="margin-top:16px">
      ${drugStats("Препараты СД 2 типа", state.admin.drugStats.diabetesDrugCounts)}
      ${drugStats("Препараты АГ", state.admin.drugStats.hypertensionDrugCounts)}
    </section>
`;
}

function renderTrainingAdmin() {
  const attemptsByParticipant = (state.admin.trainingAttempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const rows = (state.admin.trainingParticipants || []).map((participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const tasks = attempts.filter((attempt) => attempt.type === "task");
    const postSummary = postTrainingSummary(tasks);
    return html`
      <tr>
        <td>${escapeHtml(participant.fullName)}</td>
        <td>${escapeHtml(participant.clinic || "")}</td>
        <td>${escapeHtml(participant.specialty || "")}</td>
        <td>${pre ? `${pre.correct}/${pre.total} (${pre.percent}%)` : "<span class='pill warn'>Не сдал</span>"}</td>
        <td>${postSummary.label}</td>
        <td><button class="danger" data-action="delete-training-participant" data-id="${participant.id}" ${state.admin.canEdit ? "" : "disabled"}>Удалить</button></td>
      </tr>
      ${attempts.length ? `<tr><td colspan="6">${trainingParticipantAdminDetails(attempts)}</td></tr>` : ""}
    `;
  }).join("");
  return html`
    <section class="grid two">
      <form class="panel form" id="trainingParticipantForm">
        <h2>Регистрация врача на обучение</h2>
        <div class="form-row"><label>ФИО врача</label><input name="fullName" required /></div>
        ${select("Поликлиника/ГЦЗ", "clinic", clinicOptions)}
        <div class="form-row"><label>Специальность/должность</label><input name="specialty" /></div>
        <div class="form-row"><label>Телефон</label><input name="phone" /></div>
        <button ${state.admin.canEdit ? "" : "disabled"}>Добавить в №4</button>
        <p class="muted">После добавления врач откроет ссылку №4, найдет свое имя и пройдет тест до обучения, а после семинара - тесты после обучения.</p>
      </form>
      <section class="panel">
        <h2>Результаты обучения</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Поликлиника</th><th>Специальность</th><th>До обучения</th><th>Тесты после обучения</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='6'>Пока нет участников обучения</td></tr>"}</tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function trainingParticipantAdminDetails(attempts) {
  return attempts.map((attempt) => {
    if (attempt.type === "task") return trainingTaskAdminDetails(attempt);
    return trainingAttemptDetails(attempt, `${attempt.instrument || ""}. ${attempt.title || "Тест до обучения"}`);
  }).join("");
}

function postTrainingSummary(tasks) {
  const correct = tasks.reduce((sum, attempt) => sum + Number(attempt.correct || 0), 0);
  const total = tasks.reduce((sum, attempt) => sum + Number(attempt.total || attempt.maxScore || 0), 0);
  const percent = total ? Math.round((correct / total) * 100) : 0;
  const completed = tasks.length >= 5;
  if (!completed) return { percent, passed: false, label: `${tasks.length}/5` };
  const passed = percent >= 70;
  return {
    percent,
    passed,
    label: `${percent}% ${passed ? '<span class="pill ok">Пройден</span>' : '<span class="pill danger">Не пройден</span>'}`
  };
}

function trainingAttemptDetails(attempt, title = "Тест") {
  const rows = (attempt.details || []).map((detail, index) => {
    const selected = detail.selected ? `${detail.selected}. ${detail.selectedText || ""}` : "Нет ответа";
    const correct = `${detail.correctAnswer}. ${detail.correctText || ""}`;
    return html`
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(detail.questionText || `Вопрос №${detail.questionId}`)}</td>
        <td>${escapeHtml(selected)}</td>
        <td>${escapeHtml(correct)}</td>
        <td>${detail.isCorrect ? '<span class="pill ok">Правильно</span>' : '<span class="pill danger">Неправильно</span>'}</td>
      </tr>
    `;
  }).join("");
  return html`
    <details class="answer-details">
      <summary>${title}: показать ответы врача (${attempt.correct}/${attempt.total}, ${attempt.percent}%)</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>№</th><th>Вопрос</th><th>Ответ врача</th><th>Правильный ответ</th><th>Оценка</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5'>Детали ответов не сохранены</td></tr>"}</tbody>
        </table>
      </div>
    </details>
  `;
}

function trainingTaskAdminDetails(attempt) {
  const task = attempt.task || {};
  const criteria = (task.criteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const answerRows = (attempt.details || []).map((detail, index) => {
    const selectedText = detail.selectedText ? `${detail.selected}. ${detail.selectedText}` : detail.selected;
    const correctText = detail.correctText ? `${detail.correctAnswer}. ${detail.correctText}` : detail.correctAnswer;
    return `<tr><td>${index + 1}. ${escapeHtml(detail.label || "")}</td><td>${escapeHtml(selectedText || "-")}</td><td>${escapeHtml(correctText || "-")}</td><td>${detail.isCorrect ? '<span class="pill ok">Правильно</span>' : '<span class="pill danger">Неправильно</span>'}</td></tr>`;
  }).join("");
  return html`
    <details class="answer-details">
      <summary>${escapeHtml(attempt.instrument || "")}: ${escapeHtml(attempt.title || "")} - ${attempt.correct ?? 0}/${attempt.total || attempt.maxScore} (${attempt.percent || 0}%)</summary>
      <div class="notice warn">
        <strong>Критерии:</strong>
        <ul>${criteria}</ul>
        ${task.key ? `<div><strong>Ориентировочный ключ:</strong> ${escapeHtml(task.key)}</div>` : ""}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Раздел</th><th>Ответ врача</th><th>Правильный ответ</th><th>Оценка</th></tr></thead>
          <tbody>${answerRows || "<tr><td colspan='4'>Ответов нет</td></tr>"}</tbody>
        </table>
      </div>
      <form class="score-form grid two" data-attempt-id="${attempt.id}">
        <div class="form-row"><label>Балл администратора, максимум ${attempt.maxScore}</label><input name="manualScore" inputmode="decimal" value="${attempt.manualScore ?? attempt.correct ?? ""}" /></div>
        <div class="form-row"><label>Комментарий</label><input name="trainerComment" value="${escapeHtml(attempt.trainerComment || "")}" /></div>
        <button ${state.admin.canEdit ? "" : "disabled"}>Сохранить оценку</button>
      </form>
    </details>
  `;
}

function renderNurseTrainingAdmin() {
  const attemptsByParticipant = (state.admin.nurseTrainingAttempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const rows = (state.admin.nurseTrainingParticipants || []).map((participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const post = attempts.find((attempt) => attempt.type === "post");
    return html`
      <tr>
        <td>${escapeHtml(participant.fullName)}</td>
        <td>${escapeHtml(participant.clinic || "")}</td>
        <td>${escapeHtml(participant.position || "")}</td>
        <td>${pre ? `${pre.percent}%` : "<span class='pill warn'>Не сдан</span>"}</td>
        <td>${post ? `${post.percent}% ${post.passed ? '<span class="pill ok">Пройден</span>' : '<span class="pill danger">Не пройден</span>'}` : "<span class='pill warn'>Не сдан</span>"}</td>
        <td><button class="danger" data-action="delete-nurse-training-participant" data-id="${participant.id}" ${state.admin.canEdit ? "" : "disabled"}>Удалить</button></td>
      </tr>
      ${attempts.length ? `<tr><td colspan="6">${nurseTrainingAttemptDetails(attempts)}</td></tr>` : ""}
    `;
  }).join("");
  return html`
    <section class="grid two">
      <form class="panel form" id="nurseTrainingParticipantForm">
        <h2>Регистрация медсестры на обучение</h2>
        <div class="form-row"><label>ФИО медсестры</label><input name="fullName" required /></div>
        ${select("Поликлиника/ГЦЗ", "clinic", clinicOptions)}
        <div class="form-row"><label>Должность</label><input name="position" value="Медсестра" /></div>
        <div class="form-row"><label>Телефон</label><input name="phone" /></div>
        <button ${state.admin.canEdit ? "" : "disabled"}>Добавить в №5</button>
      </form>
      <section class="panel">
        <h2>Результаты №5</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Поликлиника</th><th>Должность</th><th>До обучения</th><th>После обучения</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='6'>Пока нет медсестер</td></tr>"}</tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function nurseTrainingAttemptDetails(attempts) {
  return attempts.map((attempt) => {
    const rows = (attempt.details || []).map((detail, index) => html`
      <tr>
        <td>${index + 1}. ${escapeHtml(detail.questionText)}</td>
        <td>${escapeHtml(detail.selected ? `${detail.selected}. ${detail.selectedText}` : "-")}</td>
        <td>${escapeHtml(`${detail.correctAnswer}. ${detail.correctText}`)}</td>
        <td>${detail.isCorrect ? '<span class="pill ok">Правильно</span>' : '<span class="pill danger">Неправильно</span>'}</td>
      </tr>
    `).join("");
    return html`
      <details class="answer-details">
        <summary>${escapeHtml(attempt.title)}: ${attempt.correct}/${attempt.total} (${attempt.percent}%) ${attempt.type === "post" ? (attempt.passed ? "Пройден" : "Не пройден") : ""}</summary>
        <div class="table-wrap"><table><thead><tr><th>Вопрос</th><th>Ответ</th><th>Правильный ответ</th><th>Оценка</th></tr></thead><tbody>${rows}</tbody></table></div>
      </details>
    `;
  }).join("");
}

function drugStats(title, data) {
  const rows = Object.entries(data).map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`).join("");
  return html`<div class="panel"><h3>${title}</h3><div class="table-wrap"><table><tbody>${rows || "<tr><td>Пока нет данных</td><td></td></tr>"}</tbody></table></div></div>`;
}

function renderDoctorsAdmin() {
  const keyNotice = state.lastDoctorKey ? html`
    <div class="notice ok" id="newKey">
      <div>Специальный ключ врача при регистрации:</div>
      <strong>${escapeHtml(state.lastDoctorKey.fullName)}</strong>
      <input readonly value="${escapeHtml(state.lastDoctorKey.accessKey)}" style="margin-top:8px" />
    </div>
  ` : '<div id="newKey"></div>';
  const rows = state.admin.doctors.map((doctor) => html`
    <tr>
      <td>${escapeHtml(doctor.fullName)}</td>
      <td>${escapeHtml(doctor.login)}</td>
      <td>${escapeHtml(doctor.clinic)}</td>
      <td>${escapeHtml(doctor.specialty)}</td>
      <td>${doctor.experienceYears}</td>
      <td><button class="danger" data-action="delete-doctor" data-id="${doctor.id}" ${state.admin.canEdit ? "" : "disabled"}>Удалить</button></td>
    </tr>
  `).join("");
  return html`
    <section class="grid two">
      <form class="panel form" id="doctorForm">
        <h2>Создать профиль врача</h2>
        <div class="form-row"><label>ФИО</label><input name="fullName" required /></div>
        <div class="form-row"><label>Логин</label><input name="login" required /></div>
        <div class="form-row"><label>Паспортная часть</label><textarea name="passport" required></textarea></div>
        ${select("Поликлиника", "clinic", clinicOptions)}
        <div class="form-row"><label>Специальность</label><input name="specialty" required /></div>
        <div class="form-row"><label>Стаж работы</label><input name="experienceYears" inputmode="numeric" required /></div>
        <div class="form-row"><label>Специальный ключ, можно оставить пустым</label><input name="accessKey" /></div>
        <button ${state.admin.canEdit ? "" : "disabled"}>Создать</button>
        ${keyNotice}
      </form>
      <section class="panel">
        <h2>Список врачей</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ФИО</th><th>Логин</th><th>Поликлиника</th><th>Специальность</th><th>Стаж</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='6'>Пока нет врачей</td></tr>"}</tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderSurveyTable(surveys) {
  const clinics = adminSurveyClinics();
  const filterOptions = [
    `<option value="all"${state.surveyClinicFilter === "all" ? " selected" : ""}>Все поликлиники</option>`,
    ...clinics.map((clinic) => `<option value="${escapeHtml(clinic)}"${state.surveyClinicFilter === clinic ? " selected" : ""}>${escapeHtml(clinic)}</option>`)
  ].join("");
  const rows = surveys.map((survey) => html`
    <tr>
      <td>${escapeHtml(fullName(survey.patient))}<div class="muted">${escapeHtml(survey.patient?.clinic || "")}</div></td>
      <td>${survey.patient.birthDate || ""}</td>
      <td>${survey.measurements.systolic}/${survey.measurements.diastolic}</td>
      <td>${survey.findrisc.score} - ${survey.findrisc.level}</td>
      <td>${survey.score2.percent}% - ${survey.score2.level}</td>
      <td>${survey.measurements.rabitoWeight || "-"} кг</td>
      <td>${survey.needsDoctor ? '<span class="pill danger">К врачу</span>' : '<span class="pill ok">Обычный риск</span>'}</td>
      <td>${new Date(survey.createdAt).toLocaleString("ru-RU")}</td>
    </tr>
  `).join("");
  return html`
    <section class="panel">
      <h2>Анкеты медсестры</h2>
      <div class="filter-bar">
        <div class="form-row">
          <label>Сортировка пациентов по поликлиникам</label>
          <select id="surveyClinicFilter">${filterOptions}</select>
        </div>
        <div class="muted">Показано анкет: ${surveys.length} из ${state.admin.surveys.length}</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Пациент</th><th>Дата рождения</th><th>АД</th><th>FINDRISC</th><th>SCORE2-lite</th><th>Rabito</th><th>Статус</th><th>Дата</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='8'>Пока нет анкет</td></tr>"}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderVisitsAdmin() {
  const doctors = Object.fromEntries(state.admin.doctors.map((doctor) => [doctor.id, doctor.fullName]));
  const surveys = Object.fromEntries(state.admin.surveys.map((survey) => [survey.id, fullName(survey.patient)]));
  const rows = state.admin.visits.map((visit) => html`
    <tr>
      <td>${escapeHtml(doctors[visit.doctorId] || "Врач")}</td>
      <td>${escapeHtml(surveys[visit.surveyId] || "Пациент")}</td>
      <td>ИМТ ${visit.bmi || "-"} / АД ${visit.systolic}/${visit.diastolic} / сахар ${visit.glucose || "-"}</td>
      <td>${(visit.referrals || []).join(", ") || "-"}</td>
      <td>${escapeHtml((visit.diabetesDrugs || []).join("; "))}</td>
      <td>${escapeHtml((visit.hypertensionDrugs || []).join("; "))}</td>
      <td>${new Date(visit.createdAt).toLocaleString("ru-RU")}</td>
    </tr>
  `).join("");
  return html`
    <section class="panel">
      <h2>Действия врачей</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Врач</th><th>Пациент</th><th>ИМТ / АД</th><th>Направление</th><th>СД 2</th><th>АГ</th><th>Дата</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='7'>Пока нет записей</td></tr>"}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderQrAdmin() {
  const adminUrl = `${location.origin}${ADMIN_APP_PATH}`;
  const doctorUrl = `${location.origin}${DOCTOR_APP_PATH}`;
  const surveyUrl = `${location.origin}${SURVEY_APP_PATH}`;
  const trainingUrl = `${location.origin}${TRAINING_APP_PATH}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(surveyUrl)}`;
  const doctorQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(doctorUrl)}`;
  const trainingQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(trainingUrl)}`;
  const nurseTrainingQr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(nurseTrainingUrl)}`;
  return html`
    <section class="panel">
      <h2>Отдельные ссылки приложений</h2>
      <div class="grid two">
        <div class="qr-box">
          <h3>Опросник медсестры</h3>
          <img alt="QR-код анкеты медсестры" src="${qr}" />
          <input readonly value="${surveyUrl}" />
        </div>
        <div class="qr-box">
          <h3>Приложение врача</h3>
          <img alt="QR-код приложения врача" src="${doctorQr}" />
          <input readonly value="${doctorUrl}" />
        </div>
        <div class="qr-box">
          <h3>№4 Проверка знаний врачей</h3>
          <img alt="QR-код проверки знаний врачей" src="${trainingQr}" />
          <input readonly value="${trainingUrl}" />
        </div>
        <div class="qr-box">
          <h3>№5 Тесты медсестер</h3>
          <img alt="QR-код тестов медсестер" src="${nurseTrainingQr}" />
          <input readonly value="${nurseTrainingUrl}" />
        </div>
      </div>
      <div class="form-row" style="margin-top:16px">
        <label>Приложение администратора</label>
        <input readonly value="${adminUrl}" />
      </div>
      <p class="muted">Для других устройств используйте IP-адрес этого компьютера вместо localhost.</p>
    </section>
  `;
}

function bindAdminForms() {
  const form = document.querySelector("#doctorForm");
  if (form) form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api("/api/admin/doctors", { method: "POST", body: JSON.stringify(data) });
      state.lastDoctorKey = { doctorId: result.doctor.id, fullName: result.doctor.fullName, accessKey: result.accessKey };
      form.reset();
      state.admin.doctors.push(result.doctor);
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  const trainingForm = document.querySelector("#trainingParticipantForm");
  if (trainingForm) trainingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(trainingForm));
      const result = await api("/api/admin/training-participants", { method: "POST", body: JSON.stringify(data) });
      state.admin.trainingParticipants.push(result.participant);
      trainingForm.reset();
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  const nurseTrainingForm = document.querySelector("#nurseTrainingParticipantForm");
  if (nurseTrainingForm) nurseTrainingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(nurseTrainingForm));
      const result = await api("/api/admin/nurse-training-participants", { method: "POST", body: JSON.stringify(data) });
      state.admin.nurseTrainingParticipants.push(result.participant);
      nurseTrainingForm.reset();
      renderAdmin();
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelectorAll(".score-form").forEach((scoreForm) => {
    scoreForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(scoreForm));
        await api(`/api/admin/training-attempts/${scoreForm.dataset.attemptId}`, { method: "PUT", body: JSON.stringify(data) });
        await loadAdmin();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderNurseSurvey() {
  setPage(html`
    <main class="container">
      <form class="panel form" id="surveyForm">
        <h1>Опросник медсестры</h1>
        <h3>Паспортная часть</h3>
        <section class="grid two">
          ${input("Фамилия", "lastName", true)}
          ${input("Имя", "firstName", true)}
          ${input("Отчество", "middleName")}
          ${input("Дата рождения", "birthDate", true, "date")}
          ${select("Пол", "sex", [["female", "Женский"], ["male", "Мужской"]])}
          <div class="form-row"><label>Возраст</label><input name="age" inputmode="numeric" required readonly /></div>
          ${input("Телефон", "phone")}
          ${input("Адрес", "address")}
        </section>
        <div class="form-row">
          <label>Поликлиника пациента</label>
          <select name="clinic">${clinicOptions.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>
        </div>
        <h3>FINDRISC</h3>
        <section class="grid two">
          ${input("Рост, см", "height", true, "number")}
          ${input("ИМТ", "bmi", true, "number")}
          ${select("Физическая активность 30 минут в день", "activity", [["yes", "Да"], ["no", "Нет"]])}
          ${select("Овощи/фрукты ежедневно", "vegetables", [["yes", "Да"], ["no", "Нет"]])}
          ${select("Принимал препараты от давления", "bpMeds", [["no", "Нет"], ["yes", "Да"]])}
          ${select("Когда-либо был высокий сахар", "highGlucose", [["no", "Нет"], ["yes", "Да"]])}
          ${select("Диабет у родственников", "familyDiabetes", [["none", "Нет"], ["second", "Да, 2 линия"], ["first", "Да, 1 линия"]])}
        </section>
        <h3>Сердечно-сосудистый риск</h3>
        <section class="grid two">
          ${select("Курение", "smoker", [["no", "Нет"], ["yes", "Да"]])}
          ${input("Систолическое АД", "systolic", true, "number")}
          ${input("Диастолическое АД", "diastolic", true, "number")}
        </section>
        <h3>Формула Rabito</h3>
        <section class="grid three">
          ${input("Окружность плеча, см", "arm", true, "number")}
          ${input("Окружность живота/талия, см", "rabitoWaist", true, "number")}
          ${input("Окружность голени, см", "calf", true, "number")}
          <div class="form-row"><label>Расчётный вес Rabito, кг</label><input name="rabitoWeightPreview" inputmode="decimal" readonly /></div>
        </section>
        <button>Отправить анкету</button>
        <div id="surveyResult"></div>
      </form>
    </main>
  `);
  const form = document.querySelector("#surveyForm");
  bindNurseSurveyCalculations(form);
  bindBirthDateAge(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const { survey } = await api("/api/nurse-surveys", { method: "POST", body: JSON.stringify(data) });
      document.querySelector("#surveyResult").innerHTML = html`
        <div class="notice ${survey.needsDoctor ? "danger" : "ok"}">
          FINDRISC: ${survey.findrisc.score} (${survey.findrisc.level}). SCORE2-lite: ${survey.score2.percent}% (${survey.score2.level}).
          Расчётный вес Rabito: ${survey.measurements.rabitoWeight || "-"} кг.
          ${survey.needsDoctor ? "<strong>Повышенный риск: направить к врачу.</strong>" : "Повышенный риск не выявлен."}
        </div>
      `;
      form.reset();
    } catch (error) {
      alert(error.message);
    }
  });
}

function bindBirthDateAge(form) {
  const calculateAge = () => {
    const value = form.elements.birthDate.value;
    if (!value) {
      form.elements.age.value = "";
      return;
    }
    const birthDate = new Date(`${value}T00:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
    form.elements.age.value = age >= 0 && age < 130 ? String(age) : "";
  };
  form.elements.birthDate.addEventListener("input", calculateAge);
  calculateAge();
}

function bindNurseSurveyCalculations(form) {
  const numericValue = (name) => Number(String(form.elements[name]?.value || "").replace(",", "."));
  const calculate = () => {
    const arm = numericValue("arm");
    const waist = numericValue("rabitoWaist");
    const calf = numericValue("calf");
    const sexCoef = form.elements.sex.value === "male" ? 1 : 2;
    const rabitoWeight = arm > 0 && waist > 0 && calf > 0
      ? 0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241
      : 0;
    form.elements.rabitoWeightPreview.value = rabitoWeight > 0 ? rabitoWeight.toFixed(1) : "";

    const heightM = numericValue("height") / 100;
    form.elements.bmi.value = rabitoWeight > 0 && heightM > 0 ? (rabitoWeight / (heightM * heightM)).toFixed(1) : "";
  };
  ["height", "arm", "rabitoWaist", "calf"].forEach((name) => {
    form.elements[name].addEventListener("input", calculate);
  });
  form.elements.sex.addEventListener("change", calculate);
}

async function loadTrainingPretest() {
  const data = await api("/api/training/pretest");
  state.training = data;
  renderTrainingParticipantList();
}

function renderTrainingParticipantList() {
  const attemptsByParticipant = (state.training?.attempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const rows = (state.training?.participants || []).map((participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const taskCount = attempts.filter((attempt) => attempt.type === "task").length;
    return html`
    <div class="card training-person">
      <div>
        <strong>${escapeHtml(participant.fullName)}</strong>
        <div class="muted">${escapeHtml(participant.clinic || "")}${participant.specialty ? ` / ${escapeHtml(participant.specialty)}` : ""}</div>
        <div class="muted">Тест до обучения: ${pre ? `${pre.percent}%` : "не сдан"} / После обучения: ${taskCount}/5</div>
      </div>
      <button data-action="select-training-participant" data-id="${participant.id}">Открыть</button>
    </div>
  `}).join("");
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>№4 Проверка знаний врачей</h1>
        <h2>Пре-тест до обучения</h2>
        <p class="muted">Найдите свое имя в списке. Сначала сдайте тест до обучения, после семинара сдайте Инструменты 2-6.</p>
        <input id="trainingSearch" placeholder="Введите фамилию или имя" />
        <div id="trainingList" class="training-list">${rows || "<p class='muted'>Администратор еще не зарегистрировал участников обучения.</p>"}</div>
      </section>
    </main>
  `);
  document.querySelector("#trainingSearch")?.addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase();
    const participants = state.training.participants.filter((item) => item.fullName.toLowerCase().includes(query));
    document.querySelector("#trainingList").innerHTML = participants.map((participant) => html`
      <div class="card training-person">
        <div>
          <strong>${escapeHtml(participant.fullName)}</strong>
          <div class="muted">${escapeHtml(participant.clinic || "")}${participant.specialty ? ` / ${escapeHtml(participant.specialty)}` : ""}</div>
        </div>
        <button data-action="select-training-participant" data-id="${participant.id}">Открыть</button>
      </div>
    `).join("") || "<p class='muted'>Участник не найден</p>";
  });
}

async function renderTrainingWorkspace(participantId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const pre = data.attempts.find((attempt) => attempt.type === "pre");
  const taskAttempts = data.attempts.filter((attempt) => attempt.type === "task");
  const allPostDone = taskAttempts.length >= data.tasks.length;
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>№4 Проверка знаний</h1>
        <h2>${escapeHtml(data.participant.fullName)}</h2>
        <div class="actions">
          ${pre ? `<span class="pill ok">Тест до обучения: ${pre.percent}%</span>` : `<button data-action="start-pretest" data-id="${participantId}">Тест до обучения</button>`}
          ${allPostDone ? "<span class='pill ok'>Тесты после обучения отправлены</span>" : `<button data-action="start-post-training-tests" data-id="${participantId}">Тесты после обучения</button>`}
          <button type="button" class="secondary" onclick="location.href='${TRAINING_APP_PATH}'">К списку</button>
        </div>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Тесты после обучения</h2>
        <p class="muted">Все тесты после обучения объединены в одну форму. Пройдено: ${taskAttempts.length}/${data.tasks.length}.</p>
      </section>
    </main>
  `);
}

async function renderTrainingPretest(participantId) {
  const data = await api(`/api/training/pretest/${participantId}`);
  if (data.attempt) {
    setPage(html`
      <main class="container">
        <section class="panel">
          <h1>Инструмент 2 уже сдан</h1>
          <div class="notice ok">Результат: ${data.attempt.correct}/${data.attempt.total} (${data.attempt.percent}%).</div>
          <button onclick="location.href='${TRAINING_APP_PATH}'">Вернуться к списку</button>
        </section>
      </main>
    `);
    return;
  }
  const questions = data.questions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(question.text)}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label>
            <input type="radio" name="q${question.id}" value="${letter}" required />
            <span>${letter}. ${escapeHtml(text)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="pretestForm">
        <section class="panel">
          <h1>Тест до обучения</h1>
          <div class="notice warn">
            Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. Нужно ответить на все 10 вопросов.
          </div>
        </section>
        ${questions}
        <section class="panel actions">
          <button>Отправить ответы</button>
          <button type="button" class="secondary" onclick="location.href='${TRAINING_APP_PATH}'">Назад к списку</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#pretestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const answers = {};
    for (const [name, value] of formData.entries()) {
      if (name.startsWith("q")) answers[name.slice(1)] = value;
    }
    try {
      const result = await api(`/api/training/pretest/${participantId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Инструмент 2 отправлен</h1>
            <div class="notice ok">Ваш результат: ${result.attempt.correct}/${result.attempt.total} (${result.attempt.percent}%). Данные отправлены администратору.</div>
            <button onclick="location.href='${TRAINING_APP_PATH}'">Вернуться к списку</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderTrainingPosttest(participantId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const existing = data.attempts.find((attempt) => attempt.type === "post");
  if (existing) {
    alert("Пост-тест уже сдан");
    return renderTrainingWorkspace(participantId);
  }
  const questions = data.postQuestions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(question.text)}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label>
            <input type="radio" name="q${question.id}" value="${letter}" required />
            <span>${letter}. ${escapeHtml(text)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="posttestForm">
        <section class="panel">
          <h1>Инструмент 3. Тест после обучения для оценки итогового уровня знаний</h1>
          <div class="notice warn">Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. Нужно ответить на все 20 вопросов.</div>
        </section>
        ${questions}
        <section class="panel actions">
          <button>Отправить пост-тест</button>
          <button type="button" class="secondary" data-action="select-training-participant" data-id="${participantId}">Назад</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#posttestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = {};
    for (const [name, value] of new FormData(event.target).entries()) {
      if (name.startsWith("q")) answers[name.slice(1)] = value;
    }
    try {
      const result = await api(`/api/training/posttest/${participantId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Инструмент 3 отправлен</h1>
            <div class="notice ok">Ваш результат: ${result.attempt.correct}/${result.attempt.total} (${result.attempt.percent}%). Данные отправлены администратору.</div>
            <button data-action="select-training-participant" data-id="${participantId}">Вернуться к заданиям</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderTrainingTask(participantId, taskId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const task = data.tasks.find((item) => item.id === taskId);
  const existing = data.attempts.find((attempt) => attempt.type === "task" && attempt.taskId === taskId);
  if (!task) return alert("Задание не найдено");
  if (existing) {
    alert("Это задание уже отправлено");
    return renderTrainingWorkspace(participantId);
  }
  const criteria = (task.criteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const fields = renderPostTrainingTaskFields(task);
  setPage(html`
    <main class="container">
      <form class="form" id="taskForm">
        <section class="panel">
          <h1>${escapeHtml(task.instrument)}. ${escapeHtml(task.title)}</h1>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
          <div class="notice warn"><strong>Критерии оценки, максимум ${task.maxScore}:</strong><ul>${criteria}</ul></div>
        </section>
        ${fields}
        <section class="panel actions">
          <button>Отправить задание</button>
          <button type="button" class="secondary" data-action="select-training-participant" data-id="${participantId}">Назад</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const answers = {};
    if (task.mode === "findrisc") {
      task.fields.forEach(([name]) => answers[name] = formData.get(name) || "");
    } else if (task.mode === "singleCases") {
      task.cases.forEach((_, index) => answers[`case${index}`] = formData.get(`case${index}`) || "");
    } else if (task.mode === "routing") {
      task.cases.forEach((_, index) => {
        answers[`case${index}`] = {
          specialist: formData.get(`case${index}_specialist`) || "",
          urgency: formData.get(`case${index}_urgency`) || ""
        };
      });
    } else if (task.mode === "mcq") {
      task.questions.forEach((_, index) => answers[`q${index}`] = formData.get(`q${index}`) || "");
    } else {
      task.fields.forEach(([name]) => {
        answers[name] = formData.get(name) || "";
      });
    }
    try {
      await api(`/api/training/tasks/${participantId}/${taskId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Задание отправлено</h1>
            <div class="notice ok">Ответы отправлены администратору для проверки по критериям.</div>
            <button data-action="select-training-participant" data-id="${participantId}">Вернуться к заданиям</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderPostTrainingTests(participantId) {
  const data = await api(`/api/training/participant/${participantId}`);
  const completedTaskIds = new Set(data.attempts.filter((attempt) => attempt.type === "task").map((attempt) => attempt.taskId));
  const tasks = data.tasks.filter((task) => !completedTaskIds.has(task.id));
  if (!tasks.length) {
    alert("Тесты после обучения уже отправлены");
    return renderTrainingWorkspace(participantId);
  }
  const sections = tasks.map((task, index) => html`
    <section class="panel">
      <h2>Тест ${index + 1}. ${escapeHtml(task.title)}</h2>
      ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
      ${renderPostTrainingTaskFields(task, `task${index}_`)}
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="postTrainingTestsForm">
        <section class="panel">
          <h1>Тесты после обучения</h1>
          <div class="notice warn">Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. Нужно заполнить все разделы и отправить одним разом.</div>
        </section>
        ${sections}
        <section class="panel actions">
          <button>Отправить тесты после обучения</button>
          <button type="button" class="secondary" data-action="select-training-participant" data-id="${participantId}">Назад</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#postTrainingTestsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      const results = [];
      for (const [index, task] of tasks.entries()) {
        const answers = collectPostTrainingTaskAnswers(task, formData, `task${index}_`);
        const result = await api(`/api/training/tasks/${participantId}/${task.id}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
        results.push(result.attempt);
      }
      const correct = results.reduce((sum, attempt) => sum + Number(attempt.correct || 0), 0);
      const total = results.reduce((sum, attempt) => sum + Number(attempt.total || attempt.maxScore || 0), 0);
      const percent = total ? Math.round((correct / total) * 100) : 0;
      const passed = percent >= 70;
      const resultRows = results.map((attempt) => html`
        <tr>
          <td>${escapeHtml(attempt.instrument || "")}. ${escapeHtml(attempt.title || "")}</td>
          <td>${attempt.correct}/${attempt.total || attempt.maxScore}</td>
          <td>${attempt.percent}%</td>
        </tr>
      `).join("");
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Тесты после обучения отправлены</h1>
            <div class="notice ${passed ? "ok" : "danger"}">
              Ваш результат: <strong>${correct}/${total} (${percent}%)</strong>.
              ${passed ? "<strong>Тест пройден.</strong>" : "<strong>Тест не пройден. Нужно 70% и выше.</strong>"}
              Ответы сохранены и отправлены администратору.
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Тест</th><th>Баллы</th><th>Процент</th></tr></thead>
                <tbody>${resultRows}</tbody>
              </table>
            </div>
            <button data-action="select-training-participant" data-id="${participantId}">Вернуться</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

function collectPostTrainingTaskAnswers(task, formData, prefix = "") {
  const answers = {};
  if (task.mode === "findrisc") {
    task.fields.forEach(([name]) => answers[name] = formData.get(`${prefix}${name}`) || "");
  } else if (task.mode === "singleCases") {
    task.cases.forEach((_, index) => answers[`case${index}`] = formData.get(`${prefix}case${index}`) || "");
  } else if (task.mode === "routing") {
    task.cases.forEach((_, index) => {
      answers[`case${index}`] = {
        specialist: formData.get(`${prefix}case${index}_specialist`) || "",
        urgency: formData.get(`${prefix}case${index}_urgency`) || ""
      };
    });
  } else if (task.mode === "mcq") {
    task.questions.forEach((_, index) => answers[`q${index}`] = formData.get(`${prefix}q${index}`) || "");
  }
  return answers;
}

function renderPostTrainingTaskFields(task, prefix = "") {
  if (task.mode === "findrisc") return html`
    <section class="card">
      <div class="grid two">
        ${task.fields.map(([name, label]) => {
          const options = name === "risk" ? ["Высокий риск", "Низкий риск"] : ["0", "1", "2", "3", "4", "5"];
          return `<div class="form-row"><label>${escapeHtml(label)}</label><select name="${prefix}${name}" required>${options.map((item) => `<option value="${item}">${item}</option>`).join("")}</select></div>`;
        }).join("")}
      </div>
    </section>
  `;
  if (task.mode === "singleCases") return task.cases.map((caseText, index) => html`
    <section class="card">
      <h3>${index + 1}. ${escapeHtml(caseText)}</h3>
      <div class="form-row"><label>Выберите правильный вариант</label><select name="${prefix}case${index}" required>${task.options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></div>
    </section>
  `).join("");
  if (task.mode === "routing") return task.cases.map((caseText, index) => html`
    <section class="card">
      <h3>${index + 1}. ${escapeHtml(caseText)}</h3>
      <section class="grid two">
        <div class="form-row"><label>Куда направить</label><select name="${prefix}case${index}_specialist" required>${task.specialistOptions.map((item) => `<option value="${item}">${item}</option>`).join("")}</select></div>
        <div class="form-row"><label>Срочность</label><select name="${prefix}case${index}_urgency" required>${task.urgencyOptions.map((item) => `<option value="${item}">${item}</option>`).join("")}</select></div>
      </section>
    </section>
  `).join("");
  if (task.mode === "mcq") return task.questions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(question.text)}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label>
            <input type="radio" name="${prefix}q${index}" value="${letter}" required />
            <span>${letter}. ${escapeHtml(text)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `).join("");
  return renderTaskSimpleFields(task);
}

function renderTaskSimpleFields(task) {
  return (task.fields || []).map(([name, label]) => html`
    <section class="card">
      <div class="form-row"><label>${escapeHtml(label)}</label><textarea name="${name}" required></textarea></div>
    </section>
  `).join("");
}

function renderTaskCaseFields(task) {
  return task.cases.map((caseText, index) => html`
    <section class="card">
      <h3>${index + 1}. ${escapeHtml(caseText)}</h3>
      <section class="grid two">
        ${task.fields.map(([name, label]) => `<div class="form-row"><label>${escapeHtml(label)}</label><textarea name="case${index}_${name}" required></textarea></div>`).join("")}
      </section>
    </section>
  `).join("");
}

async function loadNurseTraining() {
  state.nurseTraining = await api("/api/nurse-training");
  renderNurseTrainingList();
}

function renderNurseTrainingList() {
  const attemptsByParticipant = (state.nurseTraining.attempts || []).reduce((acc, attempt) => {
    (acc[attempt.participantId] ||= []).push(attempt);
    return acc;
  }, {});
  const rows = (state.nurseTraining.participants || []).map((participant) => {
    const attempts = attemptsByParticipant[participant.id] || [];
    const pre = attempts.find((attempt) => attempt.type === "pre");
    const post = attempts.find((attempt) => attempt.type === "post");
    return html`
      <div class="card training-person">
        <div>
          <strong>${escapeHtml(participant.fullName)}</strong>
          <div class="muted">${escapeHtml(participant.clinic || "")} / ${escapeHtml(participant.position || "Медсестра")}</div>
          <div class="muted">До обучения: ${pre ? `${pre.percent}%` : "не сдан"} / После обучения: ${post ? `${post.percent}%` : "не сдан"}</div>
        </div>
        <button data-action="select-nurse-training-participant" data-id="${participant.id}">Открыть</button>
      </div>
    `;
  }).join("");
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>№5 Тесты медсестер</h1>
        <p class="muted">Найдите свое имя. Сначала пройдите тест до обучения, после семинара - тест после обучения. Порог 70% действует только для теста после обучения.</p>
        <input id="nurseTrainingSearch" placeholder="Введите фамилию или имя" />
        <div id="nurseTrainingList" class="training-list">${rows || "<p class='muted'>Администратор еще не зарегистрировал медсестер.</p>"}</div>
      </section>
    </main>
  `);
  document.querySelector("#nurseTrainingSearch")?.addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase();
    const participants = state.nurseTraining.participants.filter((item) => item.fullName.toLowerCase().includes(query));
    document.querySelector("#nurseTrainingList").innerHTML = participants.map((participant) => html`
      <div class="card training-person">
        <div><strong>${escapeHtml(participant.fullName)}</strong><div class="muted">${escapeHtml(participant.clinic || "")}</div></div>
        <button data-action="select-nurse-training-participant" data-id="${participant.id}">Открыть</button>
      </div>
    `).join("") || "<p class='muted'>Участник не найден</p>";
  });
}

async function renderNurseTrainingWorkspace(participantId) {
  const data = await api(`/api/nurse-training/participant/${participantId}`);
  const pre = data.attempts.find((attempt) => attempt.type === "pre");
  const post = data.attempts.find((attempt) => attempt.type === "post");
  setPage(html`
    <main class="container">
      <section class="panel">
        <h1>№5 Тесты медсестер</h1>
        <h2>${escapeHtml(data.participant.fullName)}</h2>
        <div class="actions">
          ${pre ? `<span class="pill ok">До обучения: ${pre.percent}%</span>` : `<button data-action="start-nurse-test" data-id="${participantId}" data-test-type="pre">Тест до обучения</button>`}
          ${post ? `<span class="pill ${post.passed ? "ok" : "danger"}">После обучения: ${post.percent}% ${post.passed ? "Пройден" : "Не пройден"}</span>` : `<button data-action="start-nurse-test" data-id="${participantId}" data-test-type="post">Тест после обучения</button>`}
          <button type="button" class="secondary" onclick="location.href='${NURSE_TRAINING_APP_PATH}'">К списку</button>
        </div>
      </section>
    </main>
  `);
}

async function renderNurseTest(participantId, type) {
  const data = await api(`/api/nurse-training/participant/${participantId}`);
  const existing = data.attempts.find((attempt) => attempt.type === type);
  if (existing) {
    alert("Этот тест уже сдан");
    return renderNurseTrainingWorkspace(participantId);
  }
  const questions = type === "post" ? data.postQuestions : data.preQuestions;
  const questionCards = questions.map((question, index) => html`
    <section class="card question-card">
      <h3>${index + 1}. ${escapeHtml(question.text)}</h3>
      <div class="radio-list">
        ${Object.entries(question.options).map(([letter, text]) => html`
          <label><input type="radio" name="q${question.id}" value="${letter}" required /><span>${letter}. ${escapeHtml(text)}</span></label>
        `).join("")}
      </div>
    </section>
  `).join("");
  setPage(html`
    <main class="container">
      <form class="form" id="nurseTestForm">
        <section class="panel">
          <h1>${type === "post" ? "Тест после обучения" : "Тест до обучения"}</h1>
          <div class="notice warn">Участник: <strong>${escapeHtml(data.participant.fullName)}</strong>. ${type === "post" ? "Для прохождения нужно набрать 70% или больше." : "Порог прохождения для теста до обучения не применяется."}</div>
        </section>
        ${questionCards}
        <section class="panel actions">
          <button>Отправить тест</button>
          <button type="button" class="secondary" data-action="select-nurse-training-participant" data-id="${participantId}">Назад</button>
        </section>
      </form>
    </main>
  `);
  document.querySelector("#nurseTestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = {};
    for (const [name, value] of new FormData(event.target).entries()) {
      if (name.startsWith("q")) answers[name.slice(1)] = value;
    }
    try {
      const result = await api(`/api/nurse-training/${type}/${participantId}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setPage(html`
        <main class="container">
          <section class="panel">
            <h1>Тест отправлен</h1>
            <div class="notice ${type === "post" ? (result.attempt.passed ? "ok" : "danger") : "ok"}">
              Ваш результат: <strong>${result.attempt.correct}/${result.attempt.total} (${result.attempt.percent}%)</strong>.
              ${type === "post" ? (result.attempt.passed ? "<strong>Тест пройден.</strong>" : "<strong>Тест не пройден. Нужно 70% и выше.</strong>") : ""}
            </div>
            <button data-action="select-nurse-training-participant" data-id="${participantId}">Вернуться</button>
          </section>
        </main>
      `);
    } catch (error) {
      alert(error.message);
    }
  });
}

function input(label, name, required = false, type = "text") {
  const numeric = type === "number";
  return `<div class="form-row"><label>${label}</label><input name="${name}" type="${numeric ? "text" : type}" ${numeric ? 'inputmode="decimal"' : ""} ${required ? "required" : ""} /></div>`;
}

function select(label, name, options) {
  return `<div class="form-row"><label>${label}</label><select name="${name}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></div>`;
}

async function loadDoctor() {
  state.doctor = await api("/api/doctor/workspace");
  renderDoctor();
}

function renderDoctor() {
  setPage(html`
    <div class="layout">
      ${topbar("Кабинет врача")}
      <main class="container grid two doctor-workspace">
        <section class="panel">
          <h2>Картотека больных</h2>
          <input id="patientSearch" placeholder="Введите имя или фамилию" />
          <div id="patientList" style="margin-top:12px">${doctorSurveyList(state.doctor.surveys)}</div>
        </section>
        <section class="panel">${state.selectedSurvey ? doctorVisitForm(state.selectedSurvey) : "<h2>Выберите пациента</h2><p class='muted'>После выбора откроется повторное измерение, направления и препараты.</p>"}</section>
      </main>
    </div>
  `);
  document.querySelector("#patientSearch")?.addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase();
    const list = state.doctor.surveys.filter((survey) => fullName(survey.patient).toLowerCase().includes(query));
    document.querySelector("#patientList").innerHTML = doctorSurveyList(list);
  });
  bindDoctorVisit();
}

function doctorSurveyList(surveys) {
  return surveys.map((survey) => html`
    <div class="card" style="margin-bottom:8px">
      <strong>${escapeHtml(fullName(survey.patient))}</strong>
      <div class="muted">${escapeHtml(survey.patient?.clinic || "")}</div>
      <div class="muted">АД ${survey.measurements.systolic}/${survey.measurements.diastolic}, FINDRISC ${survey.findrisc.score}, ${new Date(survey.createdAt).toLocaleDateString("ru-RU")}</div>
      <button data-action="select-survey" data-id="${survey.id}">Открыть</button>
    </div>
  `).join("") || "<p class='muted'>Анкет пока нет</p>";
}

function doctorVisitForm(survey) {
  return html`
    <form class="form" id="visitForm">
      <h2>${escapeHtml(fullName(survey.patient))}</h2>
      <input type="hidden" name="surveyId" value="${survey.id}" />
      <section class="grid two">
        ${input("Вес по весам, кг", "weight", true, "number")}
        ${input("Рост, см", "height", true, "number")}
        <div class="form-row"><label>ИМТ</label><input name="bmi" inputmode="decimal" readonly required /></div>
        ${input("Сахар крови, ммоль/л", "glucose", false, "number")}
        ${input("Повторное САД", "systolic", true, "number")}
        ${input("Повторное ДАД", "diastolic", true, "number")}
      </section>
      <h3>Направление</h3>
      <div class="checkbox-list">
        ${check("referrals", "Эндокринолог")}
        ${check("referrals", "Кардиолог")}
      </div>
      <div class="form-row"><label>План лечения</label><textarea name="treatmentPlan"></textarea></div>
      <h3>Препараты для СД 2 типа</h3>
      <div class="checkbox-list">${state.doctor.dictionaries.diabetesDrugs.map((item) => check("diabetesDrugs", item)).join("")}</div>
      <h3>Препараты для артериальной гипертензии</h3>
      <div class="checkbox-list">${state.doctor.dictionaries.hypertensionDrugs.map((item) => check("hypertensionDrugs", item)).join("")}</div>
      <button>Сохранить осмотр</button>
      <div id="visitResult"></div>
    </form>
  `;
}

function check(name, value) {
  return `<label><input type="checkbox" name="${name}" value="${escapeHtml(value)}" /> ${escapeHtml(value)}</label>`;
}

function bindDoctorVisit() {
  const form = document.querySelector("#visitForm");
  if (!form) return;
  const calculateBmi = () => {
    const weight = Number(String(form.elements.weight.value).replace(",", "."));
    const heightCm = Number(String(form.elements.height.value).replace(",", "."));
    const heightM = heightCm / 100;
    form.elements.bmi.value = weight > 0 && heightM > 0 ? (weight / (heightM * heightM)).toFixed(1) : "";
  };
  form.elements.weight.addEventListener("input", calculateBmi);
  form.elements.height.addEventListener("input", calculateBmi);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.referrals = new FormData(form).getAll("referrals");
    data.diabetesDrugs = new FormData(form).getAll("diabetesDrugs");
    data.hypertensionDrugs = new FormData(form).getAll("hypertensionDrugs");
    try {
      await api("/api/doctor/visits", { method: "POST", body: JSON.stringify(data) });
      document.querySelector("#visitResult").innerHTML = '<div class="notice ok">Осмотр сохранён и отправлен администратору.</div>';
      form.reset();
    } catch (error) {
      alert(error.message);
    }
  });
}

boot();
