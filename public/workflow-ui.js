const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prefix = 'eclinic-draft-v1:';
export function clearDraft(form) {
  if (form?.dataset.draftKey) localStorage.removeItem(form.dataset.draftKey);
}
export function clearUserDrafts(userId) {
  for (const key of Object.keys(localStorage)) if (key.startsWith(`${prefix}${userId}:`)) localStorage.removeItem(key);
}
export function bindDraft(form, { userId = 'nurse', language = 'ru', collectLabs, restoreLabs } = {}) {
  if (!form || form.dataset.draftKey) return;
  const key = `${prefix}${userId}:${form.id}:${form.elements.surveyId?.value || 'new'}`;
  form.dataset.draftKey = key;
  const tg = language === 'tg';
  const banner = document.createElement('div');
  banner.className = 'notice draft-notice';
  form.prepend(banner);
  let pending = null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && Date.now() - saved.savedAt < 7 * 86400000) pending = saved;
    else localStorage.removeItem(key);
  } catch { localStorage.removeItem(key); }
  const save = () => {
    if (pending) return;
    const values = [...form.querySelectorAll('input[name], select[name], textarea[name]')]
      .filter(input => !['password', 'hidden', 'file', 'submit'].includes(input.type))
      .map(input => ({ name: input.name, value: input.value, checked: input.checked, type: input.type }));
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), values, labs: collectLabs?.() || [] }));
      banner.textContent = tg ? 'Сиёҳнавис дар ин дастгоҳ нигоҳ дошта шуд.' : 'Черновик сохранён на этом устройстве.';
    } catch { banner.textContent = tg ? 'Сиёҳнавис нигоҳ дошта нашуд.' : 'Не удалось сохранить черновик: проверьте свободное место.'; }
  };
  if (pending) {
    banner.innerHTML = `<span>${tg ? 'Сиёҳнависи нотамом ёфт шуд.' : 'Найден незаконченный черновик.'}</span> <button type="button" data-draft-restore>${tg ? 'Барқарор кардан' : 'Восстановить'}</button> <button type="button" class="secondary" data-draft-discard>${tg ? 'Нест кардан' : 'Удалить черновик'}</button>`;
    banner.querySelector('[data-draft-restore]').onclick = () => {
      for (const saved of pending.values) {
        for (const input of form.elements) {
          if (input.name !== saved.name || input.type === 'password' || input.type === 'hidden') continue;
          if (['checkbox', 'radio'].includes(input.type)) { if (input.value === saved.value) input.checked = saved.checked; }
          else input.value = saved.value;
        }
      }
      restoreLabs?.(pending.labs || []);
      pending = null;
      form.dispatchEvent(new Event('draft-restored'));
      save();
    };
    banner.querySelector('[data-draft-discard]').onclick = () => { pending = null; clearDraft(form); banner.textContent = tg ? 'Сиёҳнавис нест карда шуд.' : 'Черновик удалён.'; };
  } else banner.textContent = tg ? 'Сиёҳнавис ба таври худкор нигоҳ дошта мешавад.' : 'Форма сохраняется автоматически. Черновик хранится 7 дней на этом устройстве.';
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  form.addEventListener('draft-change', save);
  form.addEventListener('reset', () => { pending = null; clearDraft(form); banner.textContent = ''; });
}

export function helpPanel(role, language = 'ru') {
  const tg = language === 'tg';
  const steps = role === 'doctor'
    ? (tg ? ['Беморро аз рӯи ном ёбед.', 'Саволнома ва сабаби роҳхатро кушоед.', 'Муоина ва таҳлилҳоро ворид кунед.', 'Муоинаро нигоҳ доред.'] : ['Найдите пациента по фамилии.', 'Откройте анкету и причину направления.', 'Запишите осмотр и анализы.', 'Нажмите «Сохранить осмотр».'])
    : (tg ? ['Дар бораи бемор маълумот ворид кунед.', 'Андозагирӣ ва ҷавобҳоро пур кунед.', 'Номи худ ва дармонгоҳро санҷед.', 'Саволномаро фиристед.'] : ['Введите данные пациента.', 'Заполните измерения и ответы.', 'Проверьте свою фамилию и поликлинику.', 'Отправьте анкету.']);
  return `<details class="panel workflow-help"><summary>${tg ? 'Чӣ тавр истифода бурдан' : 'Как пользоваться'}</summary><ol>${steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><label>${tg ? 'Забони видео' : 'Язык видео'} <select data-help-language><option value="ru" ${!tg ? 'selected' : ''}>Русский</option><option value="tg" ${tg ? 'selected' : ''}>Тоҷикӣ</option></select></label><video controls playsinline preload="none" data-help-role="${role}" src="/help/${role}-${tg ? 'tg' : 'ru'}.mp4"></video></details>`;
}
export function historyPanel(history = []) {
  const labels = { firstName: 'Имя', lastName: 'Фамилия', middleName: 'Отчество', birthDate: 'Дата рождения', phone: 'Телефон', address: 'Адрес', clinic: 'Поликлиника', outreach: 'Контакт', pending: 'Ожидает контакта', called: 'Позвонили', scheduled: 'Записан', declined: 'Отказался' };
  const display = value => labels[value] || String(value ?? '—');
  return `<details class="change-history"><summary>История исправлений (${history.length})</summary>${[...history].reverse().map(event => `<article><strong>${escape(event.actorName)}</strong> · ${escape(new Date(event.createdAt).toLocaleString('ru-RU'))}<ul>${event.changes.map(change => `<li>${escape(labels[change.field] || change.field)}: ${escape(display(change.before))} → ${escape(display(change.after))}</li>`).join('')}</ul></article>`).join('') || '<p>Исправлений пока нет.</p>'}</details>`;
}

export function waitingPanel(rows, canEdit = true) {
  const labels = { pending: 'Ожидает контакта', called: 'Позвонили', scheduled: 'Записан', declined: 'Отказался' };
  return `<section class="panel waiting-panel"><h2>Направлен, но не пришёл</h2><p>Пациенты с направлением, для которых ещё не сохранён осмотр врача. «Записан» отмечает результат контакта; дату приёма укажите в календаре.</p><input type="search" data-waiting-search placeholder="Фамилия, поликлиника или статус" aria-label="Поиск ожидающих пациентов"/><div class="table-wrap"><table><thead><tr><th>Пациент</th><th>Поликлиника</th><th>Телефон</th><th>Дней ожидания</th><th>Контакт</th></tr></thead><tbody>${rows.map(row => `<tr data-waiting-row><td>${escape(row.patientName)}</td><td>${escape(row.clinic)}</td><td>${escape(row.phone)}</td><td>${row.waitingDays}</td><td>${canEdit ? `<select data-outreach-id="${escape(row.id)}" aria-label="Контакт с пациентом">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${row.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` : escape(labels[row.status])}</td></tr>`).join('') || '<tr><td colspan="5">Все направленные пациенты осмотрены.</td></tr>'}</tbody></table></div></section>`;
}
