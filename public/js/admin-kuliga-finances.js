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
    const totalInstructorsEl = document.getElementById('total-instructors-stat');
    if (totalInstructorsEl) {
        totalInstructorsEl.textContent = stats.total_instructors || 0;
    }
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

        const response = await authFetch(`/api/kuliga/admin/finances/instructors?${params}`);

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
async function showCreatePayoutModal(instructorId, instructorName) {
    try {
        // Получаем данные инструктора для расчета периода
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && currentPeriodFrom && currentPeriodTo) {
            params.append('from', currentPeriodFrom);
            params.append('to', currentPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/kuliga/admin/finances/instructors?${params}`);
        if (!response.ok) {
            throw new Error('Не удалось загрузить данные инструктора');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error('Ошибка загрузки данных');
        }

        const instructor = data.instructors.find(i => i.id === instructorId);
        if (!instructor) {
            throw new Error('Инструктор не найден');
        }

        // Определяем период
        let periodStart, periodEnd;
        if (currentPeriod === 'custom' && currentPeriodFrom && currentPeriodTo) {
            periodStart = currentPeriodFrom;
            periodEnd = currentPeriodTo;
        } else if (currentPeriod === 'current_month') {
            const now = new Date();
            periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            periodEnd = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
        } else if (currentPeriod === 'last_month') {
            const now = new Date();
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            periodStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
            periodEnd = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
        } else {
            // all_time - используем дату первой тренировки и сегодня
            // Для упрощения используем текущий месяц
            const now = new Date();
            periodStart = `${now.getFullYear()}-01-01`;
            periodEnd = `${now.getFullYear()}-12-31`;
        }

        const modal = document.createElement('div');
        modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-top: 0;">Формирование выплаты</h2>
                <div style="margin-bottom: 20px;">
                    <div><strong>Инструктор:</strong> ${escapeHtml(instructorName)}</div>
                    <div><strong>Период:</strong> ${formatDate(periodStart)} - ${formatDate(periodEnd)}</div>
                    <div><strong>Неоплаченный заработок:</strong> ${formatCurrency(instructor.unpaid_earnings || 0)} ₽</div>
                    <div><strong>Тренировок:</strong> ${instructor.trainings_count || 0}</div>
                </div>
                <form id="create-payout-form">
                    <div class="form-group">
                        <label>Период начала *</label>
                        <input type="date" id="payout-period-start" class="form-control" value="${periodStart}" required />
                    </div>
                    <div class="form-group">
                        <label>Период окончания *</label>
                        <input type="date" id="payout-period-end" class="form-control" value="${periodEnd}" required />
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="payout-send-telegram" checked />
                            Отправить в Telegram
                        </label>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="payout-send-email" />
                            Отправить на Email
                        </label>
                    </div>
                    <div class="form-actions" style="display: flex; gap: 10px; margin-top: 20px;">
                        <button type="submit" class="btn-primary">Создать выплату</button>
                        <button type="button" class="btn-secondary" onclick="this.closest('div[style*=\\'position: fixed\\']').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Обработчик формы
        const form = modal.querySelector('#create-payout-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createPayout(instructorId, modal);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    } catch (error) {
        console.error('Ошибка создания модального окна выплаты:', error);
        showError('Не удалось загрузить данные для создания выплаты');
    }
}

// Создание выплаты
async function createPayout(instructorId, modal) {
    try {
        const periodStart = document.getElementById('payout-period-start').value;
        const periodEnd = document.getElementById('payout-period-end').value;
        const sendTelegram = document.getElementById('payout-send-telegram').checked;
        const sendEmail = document.getElementById('payout-send-email').checked;

        if (!periodStart || !periodEnd) {
            showError('Укажите период');
            return;
        }

        const response = await authFetch('/api/kuliga/admin/payouts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                instructor_id: instructorId,
                period_start: periodStart,
                period_end: periodEnd,
                send_telegram: sendTelegram,
                send_email: sendEmail
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = errorData.error || 'Ошибка создания выплаты';
            
            // Если выплата уже существует, показываем информацию о ней
            if (errorMessage.includes('уже существует')) {
                const existingPayout = await checkExistingPayout(instructorId, periodStart, periodEnd);
                if (existingPayout) {
                    showExistingPayoutInfo(existingPayout, modal);
                    return;
                }
            }
            
            throw new Error(errorMessage);
        }

        const data = await response.json();
        if (data.success) {
            modal.remove();
            showSuccess('Выплата успешно создана');
            // Обновляем данные
            loadFinancesData();
        }
    } catch (error) {
        console.error('Ошибка создания выплаты:', error);
        showError('Не удалось создать выплату: ' + error.message);
    }
}

function showSuccess(message) {
    // Используем функцию из admin.js или создаем простой alert
    // Проверяем, что это не наша собственная функция, чтобы избежать рекурсии
    if (typeof window.showSuccess === 'function' && window.showSuccess !== showSuccess) {
        window.showSuccess(message);
    } else {
        alert(message);
    }
}

// Проверка существующей выплаты
async function checkExistingPayout(instructorId, periodStart, periodEnd) {
    try {
        const response = await authFetch(`/api/kuliga/admin/payouts?instructor_id=${instructorId}`);
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data.success) return null;
        
        return data.payouts.find(p => 
            p.period_start === periodStart && 
            p.period_end === periodEnd
        ) || null;
    } catch (error) {
        console.error('Ошибка проверки существующей выплаты:', error);
        return null;
    }
}

// Показать информацию о существующей выплате
function showExistingPayoutInfo(payout, modal) {
    const existingInfo = modal.querySelector('.existing-payout-info');
    if (existingInfo) {
        existingInfo.remove();
    }
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'existing-payout-info';
    infoDiv.style.cssText = 'background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 15px; border-radius: 6px; margin-bottom: 20px;';
    infoDiv.innerHTML = `
        <h4 style="margin: 0 0 10px 0;">⚠️ Выплата за этот период уже существует</h4>
        <div style="margin-bottom: 10px;">
            <div><strong>ID выплаты:</strong> ${payout.id}</div>
            <div><strong>Период:</strong> ${formatDate(payout.period_start)} - ${formatDate(payout.period_end)}</div>
            <div><strong>Статус:</strong> ${getStatusLabel(payout.status)}</div>
            <div><strong>Сумма:</strong> ${formatCurrency(payout.instructor_earnings)} ₽</div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button class="btn-primary" onclick="viewPayoutDetails(${payout.id}); this.closest('div[style*=\\'position: fixed\\']').remove();">
                Просмотреть выплату
            </button>
            ${payout.status === 'pending' ? `
                <button class="btn-danger" onclick="deletePayout(${payout.id}, ${payout.instructor_id});">
                    Удалить выплату
                </button>
            ` : ''}
        </div>
    `;
    
    const form = modal.querySelector('#create-payout-form');
    if (form) {
        form.parentNode.insertBefore(infoDiv, form);
    }
}

// Удаление выплаты
async function deletePayout(payoutId, instructorId) {
    if (!confirm('Вы уверены, что хотите удалить эту выплату?')) {
        return;
    }
    
    try {
        const response = await authFetch(`/api/kuliga/admin/payouts/${payoutId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка удаления выплаты');
        }
        
        showSuccess('Выплата успешно удалена');
        loadFinancesData();
        
        // Закрываем модальное окно
        const modal = document.querySelector('div[style*="position: fixed"]');
        if (modal) modal.remove();
    } catch (error) {
        console.error('Ошибка удаления выплаты:', error);
        showError('Не удалось удалить выплату: ' + error.message);
    }
}

window.showCreatePayoutModal = showCreatePayoutModal;
window.deletePayout = deletePayout;

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

function formatTime(timeString) {
    if (!timeString) return '-';
    return String(timeString).substring(0, 5);
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
    if (typeof window.showError === 'function' && window.showError !== showError) {
        window.showError(message);
    } else {
        console.error(message);
        alert(message);
    }
}

// Просмотр детализации инструктора
async function viewInstructorDetails(instructorId) {
    try {
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && currentPeriodFrom && currentPeriodTo) {
            params.append('from', currentPeriodFrom);
            params.append('to', currentPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/kuliga/admin/finances/instructors/${instructorId}/trainings?${params}`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки детализации');
        }

        const data = await response.json();
        if (data.success) {
            showInstructorDetailsModal(instructorId, data.trainings);
        }
    } catch (error) {
        console.error('Ошибка загрузки детализации:', error);
        showError('Не удалось загрузить детализацию');
    }
}

// Просмотр деталей выплаты
async function viewPayoutDetails(payoutId) {
    try {
        const response = await authFetch(`/api/kuliga/admin/payouts/${payoutId}/trainings`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки деталей выплаты');
        }

        const data = await response.json();
        if (data.success) {
            showPayoutDetailsModal(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки деталей выплаты:', error);
        showError('Не удалось загрузить детали выплаты');
    }
}

// Модальное окно детализации инструктора
function showInstructorDetailsModal(instructorId, trainings) {
    const modal = document.createElement('div');
    modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
    
    // Подсчитываем статистику
    let individualCount = 0;
    let groupCount = 0;
    let totalRevenue = 0;
    let totalEarnings = 0;
    
    trainings.forEach(training => {
        if (training.booking_type === 'group') {
            groupCount++;
        } else {
            individualCount++;
        }
        totalRevenue += parseFloat(training.price_total || 0);
        totalEarnings += parseFloat(training.instructor_earnings || 0);
    });
    
    const statisticsHtml = `
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0;">Статистика:</h4>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                <div>
                    <div style="color: #666; font-size: 0.9em;">Всего тренировок</div>
                    <div style="font-size: 24px; font-weight: bold;">${trainings.length}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 0.9em;">Индивидуальных</div>
                    <div style="font-size: 24px; font-weight: bold; color: #3498db;">${individualCount}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 0.9em;">Групповых</div>
                    <div style="font-size: 24px; font-weight: bold; color: #27ae60;">${groupCount}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 0.9em;">Заработок</div>
                    <div style="font-size: 24px; font-weight: bold; color: #27ae60;">${formatCurrency(totalEarnings)} ₽</div>
                </div>
            </div>
        </div>
    `;
    
    const trainingsHtml = trainings.length > 0 ? `
        <table class="data-table" style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Дата</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Время</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Тип</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Вид спорта</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Участники</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Стоимость</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Заработок</th>
                    <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Действия</th>
                </tr>
            </thead>
            <tbody>
                ${trainings.map(t => {
                    const typeText = t.booking_type === 'group' ? '👥 Групповая' : '👤 Индивидуальная';
                    const sportText = t.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                    let participantsText = '';
                    if (t.booking_type === 'group' && t.bookings && t.bookings.length > 0) {
                        participantsText = `${t.participants_count} чел.`;
                    } else {
                        participantsText = t.participants_names && Array.isArray(t.participants_names) 
                            ? t.participants_names.join(', ') 
                            : t.participants_count || 1;
                    }
                    return `
                        <tr style="border-bottom: 1px solid #dee2e6;">
                            <td style="padding: 12px;">${formatDate(t.date)}</td>
                            <td style="padding: 12px;">${formatTime(t.start_time)} - ${formatTime(t.end_time)}</td>
                            <td style="padding: 12px;">${typeText}</td>
                            <td style="padding: 12px;">${sportText}</td>
                            <td style="padding: 12px;">${escapeHtml(participantsText)}</td>
                            <td style="padding: 12px; text-align: right;">${formatCurrency(t.price_total)} ₽</td>
                            <td style="padding: 12px; text-align: right; font-weight: 600;">${formatCurrency(t.instructor_earnings)} ₽</td>
                            <td style="padding: 12px; text-align: center;">
                                ${t.booking_type === 'group' && t.bookings ? 
                                    `<button class="btn-secondary" onclick="showTrainingParticipants(${JSON.stringify(t).replace(/"/g, '&quot;')})" style="padding: 5px 10px; font-size: 0.85em;">Детали</button>` 
                                    : ''}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    ` : '<div style="padding: 20px; text-align: center; color: #666;">Нет тренировок</div>';

    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; max-width: 1000px; width: 90%; max-height: 90vh; overflow-y: auto;">
            <h2 style="margin-top: 0;">Детализация тренировок инструктора</h2>
            ${statisticsHtml}
            <h3>Тренировки:</h3>
            ${trainingsHtml}
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

// Показать участников групповой тренировки
function showTrainingParticipants(training) {
    if (typeof training === 'string') {
        try {
            training = JSON.parse(training.replace(/&quot;/g, '"'));
        } catch (e) {
            console.error('Ошибка парсинга данных тренировки:', e);
            return;
        }
    }
    
    if (!training.bookings || training.bookings.length === 0) {
        alert('Нет участников');
        return;
    }
    
    const modal = document.createElement('div');
    modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center;';
    
    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; max-width: 700px; width: 90%; max-height: 90vh; overflow-y: auto;">
            <h3 style="margin-top: 0;">Участники групповой тренировки</h3>
            <div style="margin-bottom: 15px;">
                <div><strong>Дата:</strong> ${formatDate(training.date)}</div>
                <div><strong>Время:</strong> ${formatTime(training.start_time)} - ${formatTime(training.end_time)}</div>
                <div><strong>Всего участников:</strong> ${training.participants_count}</div>
            </div>
            <table class="data-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Клиент</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Участники</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Стоимость</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Заработок</th>
                    </tr>
                </thead>
                <tbody>
                    ${training.bookings.map(booking => `
                        <tr style="border-bottom: 1px solid #dee2e6;">
                            <td style="padding: 12px;">${escapeHtml(booking.client_name || '-')}</td>
                            <td style="padding: 12px;">
                                ${booking.participants_names && Array.isArray(booking.participants_names) 
                                    ? booking.participants_names.join(', ') 
                                    : booking.participants_count || 1}
                            </td>
                            <td style="padding: 12px; text-align: right;">${formatCurrency(booking.price_total)} ₽</td>
                            <td style="padding: 12px; text-align: right;">${formatCurrency(booking.instructor_earnings)} ₽</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
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

window.showTrainingParticipants = showTrainingParticipants;

// Модальное окно деталей выплаты
function showPayoutDetailsModal(data) {
    const { payout, statistics, trainings } = data;
    
    const modal = document.createElement('div');
    modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
    
    const statisticsHtml = statistics ? `
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0;">Статистика тренировок:</h4>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                <div>
                    <div style="color: #666; font-size: 0.9em;">Всего тренировок</div>
                    <div style="font-size: 24px; font-weight: bold;">${statistics.total_trainings || 0}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 0.9em;">Индивидуальных</div>
                    <div style="font-size: 24px; font-weight: bold; color: #3498db;">${statistics.individual_trainings || 0}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 0.9em;">Групповых</div>
                    <div style="font-size: 24px; font-weight: bold; color: #27ae60;">${statistics.group_trainings || 0}</div>
                </div>
            </div>
        </div>
    ` : '';

    const trainingsHtml = trainings.length > 0 ? `
        <table class="data-table" style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Дата</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Время</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Тип</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Клиент</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Стоимость за чел.</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Общая стоимость</th>
                    <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Заработок</th>
                </tr>
            </thead>
            <tbody>
                ${trainings.map(t => {
                    // Формируем текст типа тренировки
                    let typeText = '';
                    if (t.booking_type === 'group') {
                        const maxParticipants = t.max_participants || 0;
                        const actualParticipants = t.participants_count || 0;
                        typeText = `👥 Групповая (${maxParticipants}/${actualParticipants})`;
                    } else {
                        typeText = '👤 Индивидуальная';
                    }
                    
                    // Определяем стоимость за человека
                    let pricePerPersonText = '-';
                    if (t.booking_type === 'group' && t.price_per_person) {
                        pricePerPersonText = formatCurrency(t.price_per_person) + ' ₽';
                    } else if (t.booking_type === 'individual') {
                        pricePerPersonText = formatCurrency(t.price_total) + ' ₽';
                    }
                    
                    // Формируем информацию о клиентах
                    let clientsHtml = '';
                    if (t.booking_type === 'group' && t.bookings && Array.isArray(t.bookings) && t.bookings.length > 0) {
                        // Для групповых тренировок показываем всех клиентов
                        clientsHtml = t.bookings.map(booking => {
                            const names = booking.participants_names && Array.isArray(booking.participants_names) 
                                ? booking.participants_names.join(', ')
                                : '';
                            return `${escapeHtml(booking.client_name || 'Неизвестно')}${names ? `<br><small style="color: #666;">${escapeHtml(names)}</small>` : ''}`;
                        }).join('<br><br>');
                    } else {
                        // Для индивидуальных тренировок
                        clientsHtml = escapeHtml(t.client_name || 'Неизвестно');
                        if (t.participants_names && Array.isArray(t.participants_names) && t.participants_names.length > 0) {
                            clientsHtml += `<br><small style="color: #666;">${escapeHtml(t.participants_names.join(', '))}</small>`;
                        }
                    }
                    
                    return `
                    <tr style="border-bottom: 1px solid #dee2e6;">
                        <td style="padding: 12px;">${formatDate(t.date)}</td>
                        <td style="padding: 12px;">${String(t.start_time).substring(0, 5)} - ${String(t.end_time).substring(0, 5)}</td>
                        <td style="padding: 12px;">${typeText}</td>
                        <td style="padding: 12px;">${clientsHtml}</td>
                        <td style="padding: 12px; text-align: right;">${pricePerPersonText}</td>
                        <td style="padding: 12px; text-align: right;">${formatCurrency(t.price_total)} ₽</td>
                        <td style="padding: 12px; text-align: right; font-weight: 600;">${formatCurrency(t.instructor_earnings)} ₽</td>
                    </tr>
                `;
                }).join('')}
            </tbody>
        </table>
    ` : '<div style="padding: 20px; text-align: center; color: #666;">Нет тренировок</div>';

    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; max-width: 1200px; width: 95%; max-height: 90vh; overflow-y: auto;">
            <h2 style="margin-top: 0;">Детализация выплаты</h2>
            <div style="margin-bottom: 20px;">
                <div><strong>Период:</strong> ${formatDate(payout.period_start)} - ${formatDate(payout.period_end)}</div>
            </div>
            ${statisticsHtml}
            <h3>Тренировки:</h3>
            ${trainingsHtml}
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

async function editPayoutStatus(payoutId) {
    try {
        // Получаем данные выплаты
        const response = await authFetch(`/api/kuliga/admin/payouts/${payoutId}`);
        if (!response.ok) {
            throw new Error('Не удалось загрузить данные выплаты');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Ошибка загрузки данных');
        }

        const payout = data.payout;
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-top: 0;">Изменение статуса выплаты</h2>
                <div style="margin-bottom: 20px;">
                    <div><strong>ID выплаты:</strong> ${payout.id}</div>
                    <div><strong>Инструктор:</strong> ${escapeHtml(payout.instructor_name || 'Неизвестно')}</div>
                    <div><strong>Период:</strong> ${formatDate(payout.period_start)} - ${formatDate(payout.period_end)}</div>
                    <div><strong>Сумма:</strong> ${formatCurrency(payout.instructor_earnings)} ₽</div>
                    <div><strong>Текущий статус:</strong> ${getStatusLabel(payout.status)}</div>
                </div>
                <form id="edit-payout-status-form">
                    <div class="form-group">
                        <label>Статус *</label>
                        <select id="payout-status" class="form-control" required>
                            <option value="pending" ${payout.status === 'pending' ? 'selected' : ''}>⏳ В ожидании</option>
                            <option value="paid" ${payout.status === 'paid' ? 'selected' : ''}>✅ Выплачено</option>
                            <option value="cancelled" ${payout.status === 'cancelled' ? 'selected' : ''}>❌ Отменено</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Способ выплаты</label>
                        <input type="text" id="payout-method" class="form-control" 
                               value="${escapeHtml(payout.payment_method || '')}" 
                               placeholder="Например: наличные, банковская карта, перевод" />
                    </div>
                    <div class="form-group">
                        <label>Дата выплаты</label>
                        <input type="date" id="payout-date" class="form-control" 
                               value="${payout.payment_date || ''}" />
                    </div>
                    <div class="form-group">
                        <label>Комментарий</label>
                        <textarea id="payout-comment" class="form-control" rows="3" 
                                  placeholder="Дополнительная информация">${escapeHtml(payout.payment_comment || '')}</textarea>
                    </div>
                    <div class="form-actions" style="display: flex; gap: 10px; margin-top: 20px;">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" onclick="this.closest('div[style*=\\'position: fixed\\']').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Обработчик формы
        const form = modal.querySelector('#edit-payout-status-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await updatePayoutStatus(payoutId, modal);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    } catch (error) {
        console.error('Ошибка загрузки данных выплаты:', error);
        showError('Не удалось загрузить данные выплаты: ' + error.message);
    }
}

// Обновление статуса выплаты
async function updatePayoutStatus(payoutId, modal) {
    try {
        const status = document.getElementById('payout-status').value;
        const paymentMethod = document.getElementById('payout-method').value;
        const paymentDate = document.getElementById('payout-date').value;
        const paymentComment = document.getElementById('payout-comment').value;

        const response = await authFetch(`/api/kuliga/admin/payouts/${payoutId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: status,
                payment_method: paymentMethod || null,
                payment_date: paymentDate || null,
                payment_comment: paymentComment || null
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка обновления статуса');
        }

        const data = await response.json();
        if (data.success) {
            modal.remove();
            showSuccess('Статус выплаты успешно обновлен');
            loadFinancesData();
        }
    } catch (error) {
        console.error('Ошибка обновления статуса выплаты:', error);
        showError('Не удалось обновить статус: ' + error.message);
    }
}

window.editPayoutStatus = editPayoutStatus;

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

