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
            if (!data.slots || data.slots.length === 0) {
                daySlots.innerHTML = '<div>Слотов нет</div>';
                return;
            }
            daySlots.innerHTML = '<ul>' + data.slots.map(s => `<li>${s.time_slot.substring(0,5)} — ${s.is_available ? 'свободен' : 'занят'}</li>`).join('') + '</ul>';
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


