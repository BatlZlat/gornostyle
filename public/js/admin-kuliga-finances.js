// ========================================
// АДМИНСКАЯ СТРАНИЦА ФИНАНСОВ КУЛИГИ
// ========================================

let currentPeriod = 'current_month';
let currentPeriodFrom = null;
let currentPeriodTo = null;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Обработчик кнопки "Финансы Кулига" на странице Финансы
    const kuligaFinancesBtn = document.getElementById('kuliga-finances-btn');
    if (kuligaFinancesBtn) {
        kuligaFinancesBtn.addEventListener('click', () => {
            showPage('kuliga-finances-page');
            loadFinancesData();
        });
    }

    // Обработчик кнопки "Назад к финансам"
    const backToFinancesBtn = document.getElementById('back-to-finances-btn');
    if (backToFinancesBtn) {
        backToFinancesBtn.addEventListener('click', () => {
            showPage('finances-page');
        });
    }

    // Обработчики кнопок периода
    const periodButtons = document.querySelectorAll('.period-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;
            currentPeriodFrom = null;
            currentPeriodTo = null;
            document.getElementById('period-from').value = '';
            document.getElementById('period-to').value = '';
            loadFinancesData();
        });
    });

    // Обработчик кнопки "Применить" для кастомного периода
    const applyPeriodBtn = document.getElementById('apply-period-btn');
    if (applyPeriodBtn) {
        applyPeriodBtn.addEventListener('click', () => {
            const from = document.getElementById('period-from').value;
            const to = document.getElementById('period-to').value;
            if (from && to) {
                currentPeriod = 'custom';
                currentPeriodFrom = from;
                currentPeriodTo = to;
                periodButtons.forEach(b => b.classList.remove('active'));
                loadFinancesData();
            } else {
                alert('Выберите обе даты для периода');
            }
        });
    }

    // Обработчики фильтров истории выплат
    const payoutInstructorFilter = document.getElementById('payout-instructor-filter');
    const payoutStatusFilter = document.getElementById('payout-status-filter');
    
    if (payoutInstructorFilter) {
        payoutInstructorFilter.addEventListener('change', loadPayoutsHistory);
    }
    if (payoutStatusFilter) {
        payoutStatusFilter.addEventListener('change', loadPayoutsHistory);
    }

    // Обработчик кнопки экспорта
    const exportBtn = document.getElementById('export-finances-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', showExportModal);
    }
});

// Функция для переключения страниц (используется из admin.js)
function showPage(pageId) {
    const pages = document.querySelectorAll('.page-content');
    pages.forEach(page => {
        page.style.display = 'none';
    });
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.style.display = 'block';
    }
}

// Загрузка всех данных страницы
async function loadFinancesData() {
    await Promise.all([
        loadFinancesStats(),
        loadInstructorsEarnings(),
        loadPayoutsHistory()
    ]);
}

// Загрузка статистики
async function loadFinancesStats() {
    try {
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && currentPeriodFrom && currentPeriodTo) {
            params.append('from', currentPeriodFrom);
            params.append('to', currentPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/kuliga/admin/finances/stats?${params}`);

        if (!response.ok) {
            throw new Error('Ошибка загрузки статистики');
        }

        const data = await response.json();
        if (data.success) {
            displayFinancesStats(data.stats);
        }
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        showError('Не удалось загрузить статистику');
    }
}

// Отображение статистики
function displayFinancesStats(stats) {
    document.getElementById('total-revenue-stat').textContent = formatCurrency(stats.total_revenue || 0) + ' ₽';
    document.getElementById('admin-commission-stat').textContent = formatCurrency(stats.admin_commission || 0) + ' ₽';
    document.getElementById('total-earnings-stat').textContent = formatCurrency(stats.total_earnings || 0) + ' ₽';
    document.getElementById('instructors-with-debt-stat').textContent = stats.instructors_with_debt || 0;
}

// Загрузка списка инструкторов с заработком
async function loadInstructorsEarnings() {
    try {
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && currentPeriodFrom && currentPeriodTo) {
            params.append('from', currentPeriodFrom);
            params.append('to', currentPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/kuliga/admin/instructors/earnings?${params}`);

        if (!response.ok) {
            throw new Error('Ошибка загрузки списка инструкторов');
        }

        const data = await response.json();
        if (data.success) {
            displayInstructorsEarnings(data.instructors);
        }
    } catch (error) {
        console.error('Ошибка загрузки списка инструкторов:', error);
        showError('Не удалось загрузить список инструкторов');
    }
}

// Отображение списка инструкторов
function displayInstructorsEarnings(instructors) {
    const container = document.getElementById('instructors-earnings-list');
    if (!container) return;

    if (instructors.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Нет инструкторов с неоплаченным заработком</div>';
        return;
    }

    const html = instructors.map(instructor => `
        <div class="instructor-earnings-card" style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                <div>
                    <h4 style="margin: 0 0 5px 0;">${escapeHtml(instructor.full_name || 'Инструктор')}</h4>
                    <div style="color: #666; font-size: 0.9em;">
                        Телефон: ${instructor.phone || 'Не указан'} | 
                        Процент админа: ${instructor.admin_percentage || 20}%
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 24px; font-weight: bold; color: #27ae60;">
                        ${formatCurrency(instructor.unpaid_earnings || 0)} ₽
                    </div>
                    <div style="color: #666; font-size: 0.9em;">
                        ${instructor.trainings_count || 0} тренировок
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="btn-primary" onclick="showCreatePayoutModal(${instructor.id}, '${escapeHtml(instructor.full_name || 'Инструктор')}')">
                    💰 Сформировать выплату
                </button>
                <button class="btn-secondary" onclick="viewInstructorDetails(${instructor.id})">
                    📊 Детализация
                </button>
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

// Загрузка истории выплат
async function loadPayoutsHistory() {
    try {
        const params = new URLSearchParams();
        const instructorFilter = document.getElementById('payout-instructor-filter')?.value;
        const statusFilter = document.getElementById('payout-status-filter')?.value;

        if (instructorFilter) {
            params.append('instructor_id', instructorFilter);
        }
        if (statusFilter) {
            params.append('status', statusFilter);
        }

        const response = await authFetch(`/api/kuliga/admin/payouts?${params}`);

        if (!response.ok) {
            throw new Error('Ошибка загрузки истории выплат');
        }

        const data = await response.json();
        if (data.success) {
            displayPayoutsHistory(data.payouts);
            updateInstructorFilter(data.instructors || []);
        }
    } catch (error) {
        console.error('Ошибка загрузки истории выплат:', error);
        showError('Не удалось загрузить историю выплат');
    }
}

// Отображение истории выплат
function displayPayoutsHistory(payouts) {
    const container = document.getElementById('payouts-history-list');
    if (!container) return;

    if (payouts.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Нет выплат</div>';
        return;
    }

    const html = `
        <table class="data-table" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">ID</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Инструктор</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Период</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Тренировок</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Выручка</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Комиссия</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">К выплате</th>
                    <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Статус</th>
                    <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Действия</th>
                </tr>
            </thead>
            <tbody>
                ${payouts.map(payout => `
                    <tr style="border-bottom: 1px solid #dee2e6;">
                        <td style="padding: 12px;">${payout.id}</td>
                        <td style="padding: 12px;">${escapeHtml(payout.instructor_name || 'Неизвестно')}</td>
                        <td style="padding: 12px;">${formatDate(payout.period_start)} - ${formatDate(payout.period_end)}</td>
                        <td style="padding: 12px; text-align: right;">${payout.trainings_count || 0}</td>
                        <td style="padding: 12px; text-align: right;">${formatCurrency(payout.total_revenue || 0)} ₽</td>
                        <td style="padding: 12px; text-align: right;">${formatCurrency(payout.admin_commission || 0)} ₽</td>
                        <td style="padding: 12px; text-align: right; font-weight: 600;">${formatCurrency(payout.instructor_earnings || 0)} ₽</td>
                        <td style="padding: 12px; text-align: center;">
                            <span class="status-badge status-${payout.status}" style="padding: 4px 12px; border-radius: 12px; font-size: 0.85em; font-weight: 600;">
                                ${getStatusLabel(payout.status)}
                            </span>
                        </td>
                        <td style="padding: 12px; text-align: center;">
                            <div style="display: flex; gap: 5px; justify-content: center;">
                                <button class="btn-icon" onclick="viewPayoutDetails(${payout.id})" title="Просмотр">👁️</button>
                                <button class="btn-icon" onclick="editPayoutStatus(${payout.id})" title="Изменить статус">✏️</button>
                                <button class="btn-icon" onclick="downloadPayoutPdf(${payout.id})" title="Скачать PDF">📄</button>
                                <button class="btn-icon" onclick="sendPayoutToTelegram(${payout.id})" title="Отправить в Telegram">📱</button>
                                <button class="btn-icon" onclick="sendPayoutToEmail(${payout.id})" title="Отправить на Email">📧</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

// Обновление фильтра инструкторов
function updateInstructorFilter(instructors) {
    const filter = document.getElementById('payout-instructor-filter');
    if (!filter) return;

    const currentValue = filter.value;
    filter.innerHTML = '<option value="">Все инструкторы</option>' +
        instructors.map(inst => 
            `<option value="${inst.id}">${escapeHtml(inst.full_name || 'Инструктор')}</option>`
        ).join('');

    if (currentValue) {
        filter.value = currentValue;
    }
}

// Модальное окно создания выплаты
function showCreatePayoutModal(instructorId, instructorName) {
    // TODO: Реализовать модальное окно
    console.log('Создание выплаты для инструктора:', instructorId, instructorName);
    alert('Функция создания выплаты будет реализована');
}

// Вспомогательные функции
function formatCurrency(amount) {
    return parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function getStatusLabel(status) {
    const labels = {
        'pending': '⏳ В ожидании',
        'paid': '✅ Выплачено',
        'cancelled': '❌ Отменено'
    };
    return labels[status] || status;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Получить токен авторизации
function getAuthToken() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'adminToken') {
            return decodeURIComponent(value);
        }
    }
    return localStorage.getItem('adminToken') || localStorage.getItem('authToken') || localStorage.getItem('token');
}

// Сделать авторизованный запрос
async function authFetch(url, options = {}) {
    const token = getAuthToken();
    if (!token) {
        throw new Error('Токен авторизации не найден');
    }
    
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${token}`;
    
    return fetch(url, options);
}

function showError(message) {
    // Используем функцию из admin.js или создаем простой alert
    if (typeof window.showError === 'function') {
        window.showError(message);
    } else {
        alert(message);
    }
}

// Заглушки для функций действий (будут реализованы позже)
function viewInstructorDetails(instructorId) {
    console.log('Просмотр детализации инструктора:', instructorId);
    alert('Функция детализации будет реализована');
}

function viewPayoutDetails(payoutId) {
    console.log('Просмотр деталей выплаты:', payoutId);
    alert('Функция просмотра деталей будет реализована');
}

function editPayoutStatus(payoutId) {
    console.log('Изменение статуса выплаты:', payoutId);
    alert('Функция изменения статуса будет реализована');
}

function downloadPayoutPdf(payoutId) {
    console.log('Скачивание PDF выплаты:', payoutId);
    alert('Функция скачивания PDF будет реализована');
}

function sendPayoutToTelegram(payoutId) {
    console.log('Отправка выплаты в Telegram:', payoutId);
    alert('Функция отправки в Telegram будет реализована');
}

function sendPayoutToEmail(payoutId) {
    console.log('Отправка выплаты на Email:', payoutId);
    alert('Функция отправки на Email будет реализована');
}

function showExportModal() {
    console.log('Показ модального окна экспорта');
    alert('Функция экспорта будет реализована');
}

