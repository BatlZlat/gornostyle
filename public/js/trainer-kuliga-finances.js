// Финансы инструктора Кулиги

let earningsChart = null;
let currentPeriod = 'current_month';
let currentFrom = null;
let currentTo = null;

// Функции для работы с cookies (из kuliga-instructor-schedule.js)
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

function getToken() {
    return getCookie('kuligaInstructorToken');
}

// Проверка авторизации
async function checkAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = '/kuliga-instructor-login.html';
        return null;
    }

    try {
        const response = await fetch('/api/kuliga/instructor/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Недействительный токен');
        }

        const data = await response.json();
        if (!data.valid) {
            throw new Error('Токен недействителен');
        }

        return data.instructorId;
    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
        deleteCookie('kuligaInstructorToken');
        localStorage.removeItem('kuligaInstructorData');
        window.location.href = '/kuliga-instructor-login.html';
        return null;
    }
}

// Показать ошибку
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger';
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 300px;
        max-width: min(500px, calc(100vw - 40px));
        font-weight: 500;
        opacity: 0;
        transform: translateY(-20px);
        transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    errorDiv.textContent = '❌ ' + message;
    document.body.appendChild(errorDiv);
    setTimeout(() => {
        errorDiv.style.opacity = '1';
        errorDiv.style.transform = 'translateY(0)';
    }, 10);
    setTimeout(() => {
        errorDiv.style.opacity = '0';
        errorDiv.style.transform = 'translateY(-20px)';
        setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
}

// Загрузка статистики заработка
async function loadEarnings() {
    const token = getToken();
    if (!token) return;

    try {
        let url = '/api/kuliga/instructor/earnings?';
        if (currentPeriod === 'current_month') {
            url += 'period=current_month';
        } else if (currentPeriod === 'last_month') {
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            const from = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1).toISOString().split('T')[0];
            const to = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).toISOString().split('T')[0];
            url += `from=${from}&to=${to}`;
        } else if (currentPeriod === 'all_time') {
            url += 'period=all_time';
        } else if (currentPeriod === 'custom' && currentFrom && currentTo) {
            url += `from=${currentFrom}&to=${currentTo}`;
        } else {
            url += 'period=current_month';
        }

        console.log('[Finances] fetch earnings', url);
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось загрузить статистику');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Ошибка загрузки данных');
        }

        displayStats(data.statistics, data.period_start, data.period_end);
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        showError('Не удалось загрузить статистику: ' + error.message);
    }
}

// Отображение статистики
function displayStats(stats, periodStart, periodEnd) {
    const container = document.getElementById('stats-container');
    
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card primary">
                <div class="stat-label">Общий заработок</div>
                <div class="stat-value">${parseFloat(stats.instructor_earnings).toLocaleString('ru-RU')} ₽</div>
                <div class="stat-subvalue">Период: ${formatDate(periodStart)} - ${formatDate(periodEnd)}</div>
            </div>
            <div class="stat-card info">
                <div class="stat-label">Выплачено</div>
                <div class="stat-value">${parseFloat(stats.total_paid).toLocaleString('ru-RU')} ₽</div>
                <div class="stat-subvalue">За выбранный период</div>
            </div>
            <div class="stat-card ${parseFloat(stats.debt) > 0 ? 'warning' : 'primary'}">
                <div class="stat-label">Долг</div>
                <div class="stat-value">${parseFloat(stats.debt).toLocaleString('ru-RU')} ₽</div>
                <div class="stat-subvalue">${parseFloat(stats.debt) > 0 ? 'Ожидает выплаты' : 'Нет долга'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Тренировок проведено</div>
                <div class="stat-value">${stats.total_trainings}</div>
                <div class="stat-subvalue">Индивидуальных: ${stats.individual_trainings}, Групповых: ${stats.group_trainings}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Общая выручка</div>
                <div class="stat-value">${parseFloat(stats.total_revenue).toLocaleString('ru-RU')} ₽</div>
                <div class="stat-subvalue">Комиссия админа: ${stats.admin_percentage}% (${parseFloat(stats.admin_commission).toLocaleString('ru-RU')} ₽)</div>
            </div>
        </div>
    `;
}

// Загрузка графика
async function loadChart() {
    const token = getToken();
    if (!token) return;

    try {
        console.log('[Finances] fetch monthly earnings');
        const response = await fetch('/api/kuliga/instructor/earnings/monthly?months=12', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось загрузить данные для графика');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Ошибка загрузки данных');
        }

        displayChart(data.monthly_data);
    } catch (error) {
        console.error('Ошибка загрузки графика:', error);
        showError('Не удалось загрузить график: ' + error.message);
    }
}

// Отображение графика
function displayChart(monthlyData) {
    const ctx = document.getElementById('earnings-chart').getContext('2d');
    
    if (earningsChart) {
        earningsChart.destroy();
    }

    earningsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthlyData.map(d => d.month_label),
            datasets: [{
                label: 'Заработок (₽)',
                data: monthlyData.map(d => parseFloat(d.instructor_earnings)),
                borderColor: '#27ae60',
                backgroundColor: 'rgba(39, 174, 96, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Заработок: ' + parseFloat(context.parsed.y).toLocaleString('ru-RU') + ' ₽';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('ru-RU') + ' ₽';
                        }
                    }
                }
            }
        }
    });
}

// Загрузка истории выплат
async function loadPayouts() {
    const token = getToken();
    if (!token) return;

    try {
        console.log('[Finances] fetch payouts');
        const response = await fetch('/api/kuliga/instructor/payouts', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось загрузить историю выплат');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Ошибка загрузки данных');
        }

        displayPayouts(data.payouts);
    } catch (error) {
        console.error('Ошибка загрузки истории выплат:', error);
        showError('Не удалось загрузить историю выплат: ' + error.message);
    }
}

// Отображение истории выплат
function displayPayouts(payouts) {
    const container = document.getElementById('payouts-container');
    
    if (payouts.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Нет выплат</p>';
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Период</th>
                    <th>Тренировок</th>
                    <th>Выручка</th>
                    <th>Заработок</th>
                    <th>Комиссия</th>
                    <th>Статус</th>
                    <th>Дата выплаты</th>
                    <th>Способ</th>
                </tr>
            </thead>
            <tbody>
    `;

    payouts.forEach(payout => {
        const statusClass = payout.status === 'paid' ? 'status-paid' : 
                           payout.status === 'pending' ? 'status-pending' : 'status-cancelled';
        const statusText = payout.status === 'paid' ? 'Выплачено' : 
                          payout.status === 'pending' ? 'Ожидает' : 'Отменено';

        html += `
            <tr>
                <td>${formatDate(payout.period_start)} - ${formatDate(payout.period_end)}</td>
                <td>${payout.trainings_count}</td>
                <td>${parseFloat(payout.total_revenue).toLocaleString('ru-RU')} ₽</td>
                <td><strong>${parseFloat(payout.instructor_earnings).toLocaleString('ru-RU')} ₽</strong></td>
                <td>${parseFloat(payout.admin_commission).toLocaleString('ru-RU')} ₽</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${payout.payment_date ? formatDate(payout.payment_date) : '-'}</td>
                <td>${payout.payment_method || '-'}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

// Загрузка детализации тренировок
async function loadTrainings() {
    const token = getToken();
    if (!token) return;

    try {
        let url = '/api/kuliga/instructor/trainings?';
        if (currentPeriod === 'current_month') {
            const now = new Date();
            const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
            url += `from=${from}&to=${to}`;
        } else if (currentPeriod === 'last_month') {
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            const from = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1).toISOString().split('T')[0];
            const to = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).toISOString().split('T')[0];
            url += `from=${from}&to=${to}`;
        } else if (currentPeriod === 'all_time') {
            // Без фильтра по датам
        } else if (currentPeriod === 'custom' && currentFrom && currentTo) {
            url += `from=${currentFrom}&to=${currentTo}`;
        } else {
            const now = new Date();
            const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
            url += `from=${from}&to=${to}`;
        }
        console.log('[Finances] fetch trainings', url);
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось загрузить детализацию');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Ошибка загрузки данных');
        }

        displayTrainings(data.trainings);
    } catch (error) {
        console.error('Ошибка загрузки детализации:', error);
        showError('Не удалось загрузить детализацию: ' + error.message);
    }
}

// Отображение детализации тренировок
function displayTrainings(trainings) {
    const container = document.getElementById('trainings-container');
    
    if (trainings.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Нет тренировок за выбранный период</p>';
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Дата</th>
                    <th>Время</th>
                    <th>Тип</th>
                    <th>Вид спорта</th>
                    <th>Участники</th>
                    <th>Стоимость</th>
                    <th>Заработок</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
    `;

    trainings.forEach(training => {
        // Формируем текст типа тренировки с указанием максимального количества участников для групповых
        let typeText;
        if (training.booking_type === 'individual') {
            typeText = 'Индивидуальная';
        } else {
            // Групповая тренировка - добавляем максимальное количество участников в скобках
            const maxParticipants = training.max_participants || training.participants_count;
            typeText = maxParticipants ? `Групповая (${maxParticipants})` : 'Групповая';
        }
        
        const sportText = training.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
        
        let participantsText;
        if (training.booking_type === 'group') {
            participantsText = `${training.participants_count || 0} чел.`;
        } else {
            participantsText = training.participants_names && Array.isArray(training.participants_names) 
                ? training.participants_names.join(', ') 
                : training.participants_count || 1;
        }

        html += `
            <tr>
                <td>${formatDate(training.date)}</td>
                <td>${formatTime(training.start_time)}</td>
                <td>${typeText}</td>
                <td>${sportText}</td>
                <td>${participantsText}</td>
                <td>${parseFloat(training.price_total).toLocaleString('ru-RU')} ₽</td>
                <td><strong>${parseFloat(training.instructor_earnings).toLocaleString('ru-RU')} ₽</strong></td>
                <td>
                    <button class="btn-secondary" data-training='${JSON.stringify(training)}' onclick="showTrainingDetails(this)" style="padding: 5px 10px; font-size: 0.9em;">
                        Детализация
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

// Показать детали тренировки
function showTrainingDetails(button) {
    // Получаем данные из data-атрибута
    let training;
    if (button && button.dataset && button.dataset.training) {
        try {
            training = JSON.parse(button.dataset.training);
        } catch (e) {
            console.error('Ошибка парсинга данных тренировки:', e);
            return;
        }
    } else {
        console.error('Данные тренировки не найдены');
        return;
    }
    
    const modal = document.createElement('div');
    modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
    
    let detailsHtml = '';
    
    if (training.booking_type === 'group' && training.bookings && training.bookings.length > 0) {
        // Групповая тренировка - показываем всех участников
        detailsHtml = `
            <h3 style="margin-top: 0;">Детализация групповой тренировки</h3>
            <div style="margin-bottom: 15px;">
                <div><strong>Дата:</strong> ${formatDate(training.date)}</div>
                <div><strong>Время:</strong> ${formatTime(training.start_time)} - ${formatTime(training.end_time)}</div>
                <div><strong>Вид спорта:</strong> ${training.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд'}</div>
                <div><strong>Участников:</strong> ${training.participants_count}</div>
                <div><strong>Общая стоимость:</strong> ${parseFloat(training.price_total).toLocaleString('ru-RU')} ₽</div>
                <div><strong>Ваш заработок:</strong> ${parseFloat(training.instructor_earnings).toLocaleString('ru-RU')} ₽</div>
            </div>
            <h4>Участники:</h4>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #dee2e6;">Клиент</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #dee2e6;">Участники</th>
                        <th style="padding: 10px; text-align: right; border-bottom: 1px solid #dee2e6;">Стоимость</th>
                        <th style="padding: 10px; text-align: right; border-bottom: 1px solid #dee2e6;">Заработок</th>
                    </tr>
                </thead>
                <tbody>
                    ${training.bookings.map(booking => `
                        <tr style="border-bottom: 1px solid #dee2e6;">
                            <td style="padding: 10px;">
                                ${escapeHtml(booking.client_name || '-')}
                            </td>
                            <td style="padding: 10px;">
                                ${booking.participants_names && Array.isArray(booking.participants_names) 
                                    ? booking.participants_names.join(', ') 
                                    : booking.participants_count || 1}
                            </td>
                            <td style="padding: 10px; text-align: right;">
                                ${parseFloat(booking.price_total).toLocaleString('ru-RU')} ₽
                            </td>
                            <td style="padding: 10px; text-align: right;">
                                ${parseFloat(booking.instructor_earnings).toLocaleString('ru-RU')} ₽
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        // Индивидуальная тренировка
        detailsHtml = `
            <h3 style="margin-top: 0;">Детализация индивидуальной тренировки</h3>
            <div style="margin-bottom: 15px;">
                <div><strong>Дата:</strong> ${formatDate(training.date)}</div>
                <div><strong>Время:</strong> ${formatTime(training.start_time)} - ${formatTime(training.end_time)}</div>
                <div><strong>Вид спорта:</strong> ${training.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд'}</div>
                <div><strong>Клиент:</strong> ${escapeHtml(training.client_name || '-')}</div>
                <div><strong>Участники:</strong> ${training.participants_names && Array.isArray(training.participants_names) 
                    ? training.participants_names.join(', ') 
                    : training.participants_count || 1}</div>
                <div><strong>Стоимость:</strong> ${parseFloat(training.price_total).toLocaleString('ru-RU')} ₽</div>
                <div><strong>Ваш заработок:</strong> ${parseFloat(training.instructor_earnings).toLocaleString('ru-RU')} ₽</div>
            </div>
        `;
    }
    
    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; max-width: 700px; width: 90%; max-height: 90vh; overflow-y: auto;">
            ${detailsHtml}
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button class="btn-secondary" onclick="this.closest('div[style*=\\'position: fixed\\']').remove()">Закрыть</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// Экранирование HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Экспортируем функцию в глобальную область видимости
window.showTrainingDetails = showTrainingDetails;

// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Форматирование времени
function formatTime(timeString) {
    if (!timeString) return '-';
    return String(timeString).substring(0, 5);
}

// Обработка выбора периода
function handlePeriodChange(period) {
    currentPeriod = period;
    
    // Обновление активной кнопки
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-period="${period}"]`).classList.add('active');
    
    // Показать/скрыть кастомный период
    const customPeriodDiv = document.getElementById('custom-period');
    if (period === 'custom') {
        customPeriodDiv.style.display = 'block';
    } else {
        customPeriodDiv.style.display = 'none';
        loadAllData();
    }
}

// Применение кастомного периода
function applyCustomPeriod() {
    const from = document.getElementById('period-from').value;
    const to = document.getElementById('period-to').value;
    
    if (!from || !to) {
        showError('Необходимо указать обе даты');
        return;
    }
    
    if (new Date(from) > new Date(to)) {
        showError('Дата начала не может быть позже даты окончания');
        return;
    }
    
    currentFrom = from;
    currentTo = to;
    loadAllData();
}

// Загрузка всех данных
function loadAllData() {
    loadEarnings();
    loadPayouts();
    loadTrainings();
}

// Выход
function logout() {
    deleteCookie('kuligaInstructorToken');
    localStorage.removeItem('kuligaInstructorData');
    window.location.href = '/kuliga-instructor-login.html';
}

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Finances] init start');
    // Проверка авторизации
    const instructorId = await checkAuth();
    if (!instructorId) return;
    console.log('[Finances] auth OK', instructorId);

    // Обработчики событий
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handlePeriodChange(btn.dataset.period);
        });
    });

    document.getElementById('apply-period-btn').addEventListener('click', applyCustomPeriod);
    document.getElementById('logout-btn').addEventListener('click', logout);

    // Загрузка данных
    console.log('[Finances] load data');
    loadAllData();
    loadChart();
});

