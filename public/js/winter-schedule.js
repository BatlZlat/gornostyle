// Auth helpers (локальные для страницы)
function getAuthToken() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'adminToken') return value;
    }
    return localStorage.getItem('authToken') || localStorage.getItem('adminToken') || localStorage.getItem('token');
}

async function authFetch(url, options = {}) {
    const token = getAuthToken();
    if (!token) throw new Error('Требуется авторизация');
    const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    return fetch(url, { ...options, headers });
}

function parseTimes(input) {
    return String(input || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function showMessage(el, text, ok = true) {
    el.innerHTML = `<div style="padding:10px;border:1px solid ${ok ? '#28a745' : '#dc3545'};background:${ok ? '#e9f7ef' : '#fdecea'};border-radius:6px;">${text}</div>`;
}

async function loadDaySlots(date) {
    const res = await authFetch(`/api/winter-schedule/${date}`);
    if (!res.ok) throw new Error('Ошибка загрузки слотов');
    return res.json();
}

async function deleteSlot(date, time) {
    const res = await authFetch(`/api/winter-schedule/${date}/slots/${time}`, { method: 'DELETE' });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Не удалось удалить слот');
    }
}

async function addSlots(date, times) {
    const res = await authFetch(`/api/winter-schedule/${date}/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ times })
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Не удалось добавить слот');
    }
}

async function editSlot(date, oldTime, newTime) {
    // Стратегия: сначала пытаемся добавить новый, затем удалить старый
    await addSlots(date, [newTime]);
    try {
        await deleteSlot(date, oldTime);
    } catch (e) {
        // Откат: удалим добавленный, если не смогли удалить старый
        try { await deleteSlot(date, newTime); } catch (_) {}
        throw e;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dayDate = document.getElementById('day-date');
    const dayTimes = document.getElementById('day-times');
    const btnCreateDay = document.getElementById('create-day');
    const btnLoadDay = document.getElementById('load-day');
    const dayResult = document.getElementById('day-result');
    const daySlots = document.getElementById('day-slots');

    const bulkFrom = document.getElementById('bulk-from');
    const bulkTo = document.getElementById('bulk-to');
    const bulkTimes = document.getElementById('bulk-times');
    const btnCreateBulk = document.getElementById('create-bulk');
    const bulkResult = document.getElementById('bulk-result');

    btnCreateDay.addEventListener('click', async () => {
        try {
            const date = dayDate.value;
            const times = parseTimes(dayTimes.value);
            if (!date || times.length === 0) {
                showMessage(dayResult, 'Укажите дату и хотя бы одно время', false);
                return;
            }
            const res = await authFetch('/api/winter-schedule/day', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, times })
            });
            if (res.status === 409) {
                showMessage(dayResult, 'Расписание на эту дату уже существует', false);
                return;
            }
            if (!res.ok) throw new Error('Ошибка создания расписания');
            showMessage(dayResult, 'Расписание создано');
        } catch (e) {
            showMessage(dayResult, e.message || 'Ошибка', false);
        }
    });

    btnLoadDay.addEventListener('click', async () => {
        try {
            const date = dayDate.value;
            if (!date) {
                showMessage(dayResult, 'Укажите дату', false);
                return;
            }
            const data = await loadDaySlots(date);
            const slots = data.slots || [];
            if (slots.length === 0) {
                daySlots.innerHTML = '<div>Слотов нет</div>';
                return;
            }
            // Рендер таблицей с индикатором статуса и действиями
            const rows = slots.map(s => {
                const time = String(s.time_slot).substring(0,5);
                const statusBadge = s.is_available ? '<span style="color:#28a745;">свободен</span>' : '<span style="color:#dc3545;">занят</span>';
                const actions = s.is_available
                    ? `<button class="btn-secondary" data-action="edit" data-time="${time}">✏️</button>
                       <button class="btn-secondary" data-action="delete" data-time="${time}">🗑️</button>`
                    : '<span style="color:#999;">—</span>';
                return `<tr>
                    <td style="padding:6px 8px;">${time}</td>
                    <td style="padding:6px 8px;">${statusBadge}</td>
                    <td style="padding:6px 8px;">${actions}</td>
                </tr>`;
            }).join('');
            daySlots.innerHTML = `
                <table class="admin-table" style="min-width:360px;">
                    <thead><tr><th>Время</th><th>Статус</th><th>Действия</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
                    <input type="text" id="add-slot-time" class="form-control" placeholder="HH:MM" style="max-width:120px;" />
                    <button class="btn-primary" id="add-slot-btn">Добавить слот</button>
                </div>
            `;

            // Навесим обработчики на действия
            daySlots.querySelectorAll('button[data-action="delete"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const t = btn.getAttribute('data-time');
                    try {
                        await deleteSlot(date, t);
                        showMessage(dayResult, `Слот ${t} удалён`);
                        btnLoadDay.click();
                    } catch (e) {
                        showMessage(dayResult, e.message || 'Ошибка удаления', false);
                    }
                });
            });

            daySlots.querySelectorAll('button[data-action="edit"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const oldTime = btn.getAttribute('data-time');
                    const newTime = prompt('Новое время (HH:MM):', oldTime);
                    if (!newTime) return;
                    try {
                        await editSlot(date, oldTime, newTime.trim());
                        showMessage(dayResult, `Слот ${oldTime} → ${newTime} обновлён`);
                        btnLoadDay.click();
                    } catch (e) {
                        showMessage(dayResult, e.message || 'Ошибка редактирования', false);
                    }
                });
            });

            const addBtn = document.getElementById('add-slot-btn');
            if (addBtn) {
                addBtn.addEventListener('click', async () => {
                    const t = (document.getElementById('add-slot-time').value || '').trim();
                    if (!t) return;
                    try {
                        await addSlots(date, [t]);
                        showMessage(dayResult, `Слот ${t} добавлен`);
                        btnLoadDay.click();
                    } catch (e) {
                        showMessage(dayResult, e.message || 'Ошибка добавления', false);
                    }
                });
            }
        } catch (e) {
            showMessage(dayResult, e.message || 'Ошибка', false);
        }
    });

    btnCreateBulk.addEventListener('click', async () => {
        try {
            const date_from = bulkFrom.value;
            const date_to = bulkTo.value;
            const times = parseTimes(bulkTimes.value);
            const weekdays = Array.from(document.querySelectorAll('.weekday:checked')).map(cb => parseInt(cb.value, 10));
            if (!date_from || !date_to || times.length === 0 || weekdays.length === 0) {
                showMessage(bulkResult, 'Заполните диапазон дат, дни недели и времена', false);
                return;
            }
            const res = await authFetch('/api/winter-schedule/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date_from, date_to, weekdays, times })
            });
            if (!res.ok) throw new Error('Ошибка массового создания');
            const data = await res.json();
            const skipped = (data.skipped || []).join(', ');
            showMessage(bulkResult, `Создано. Пропущено дат: ${data.skipped?.length || 0}${skipped ? ' (' + skipped + ')' : ''}`);
        } catch (e) {
            showMessage(bulkResult, e.message || 'Ошибка', false);
        }
    });
});


