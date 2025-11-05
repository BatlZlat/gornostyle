/**
 * Управление ЗП Инструкторов
 * Этот файл содержит всю логику для страницы управления зарплатами тренеров
 */

// Переход на страницу ЗП Инструктора
document.getElementById('trainer-salary-btn')?.addEventListener('click', () => {
    loadTrainerSalaryPage();
});

// Возврат к финансам
document.getElementById('back-to-finances-btn')?.addEventListener('click', () => {
    document.getElementById('trainer-salary-page').style.display = 'none';
    document.getElementById('finances-page').style.display = 'block';
});

// Загрузка страницы ЗП Инструктора
async function loadTrainerSalaryPage() {
    try {
        // Скрываем страницу финансов и показываем страницу ЗП
        document.getElementById('finances-page').style.display = 'none';
        document.getElementById('trainer-salary-page').style.display = 'block';
        
        // Загружаем данные
        await loadSalaryStats();
        await loadTrainersSalaryList();
        await loadSalaryPaymentsHistory();
        
    } catch (error) {
        console.error('Ошибка при загрузке страницы ЗП Инструктора:', error);
        alert('Ошибка при загрузке данных');
    }
}

// Загрузка статистики
async function loadSalaryStats() {
    try {
        const response = await fetch('/api/trainer-salary/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to load stats');
        
        const stats = await response.json();
        
        document.getElementById('total-trainers-count').textContent = stats.totalTrainers || 0;
        document.getElementById('total-salary-paid').textContent = `${formatMoney(stats.totalPaid || 0)}₽`;
        document.getElementById('pending-salary').textContent = `${formatMoney(stats.pending || 0)}₽`;
        
    } catch (error) {
        console.error('Ошибка при загрузке статистики:', error);
    }
}

// Загрузка списка инструкторов с настройками ЗП
async function loadTrainersSalaryList() {
    try {
        const response = await fetch('/api/trainer-salary/trainers', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to load trainers');
        
        const trainers = await response.json();
        
        const container = document.getElementById('trainers-salary-list');
        
        if (trainers.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #999;">Нет инструкторов</p>';
            return;
        }
        
        container.innerHTML = trainers.map(trainer => `
            <div class="trainer-salary-card" style="background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h4 style="margin: 0 0 10px 0;">${trainer.full_name}</h4>
                        <p style="margin: 0; color: #666;">${trainer.sport_type_display || 'Не указано'}</p>
                    </div>
                    <div style="text-align: right;">
                        <div style="margin-bottom: 10px;">
                            <strong>Тип выплаты:</strong>
                            <select class="payment-type-select form-control" data-trainer-id="${trainer.id}" 
                                    style="display: inline-block; width: auto; margin-left: 10px;">
                                <option value="percentage" ${trainer.default_payment_type === 'percentage' ? 'selected' : ''}>Процент от тренировки</option>
                                <option value="fixed" ${trainer.default_payment_type === 'fixed' ? 'selected' : ''}>Фиксированная сумма</option>
                            </select>
                        </div>
                        <div class="payment-amount-container">
                            ${trainer.default_payment_type === 'percentage' ? `
                                <strong>Процент:</strong>
                                <input type="number" class="payment-value-input form-control" data-trainer-id="${trainer.id}" 
                                       value="${trainer.default_percentage || 50}" min="0" max="100" step="1"
                                       style="display: inline-block; width: 80px; margin-left: 10px;"> %
                            ` : `
                                <strong>Сумма:</strong>
                                <input type="number" class="payment-value-input form-control" data-trainer-id="${trainer.id}" 
                                       value="${trainer.default_fixed_amount || 500}" min="0" step="50"
                                       style="display: inline-block; width: 120px; margin-left: 10px;"> ₽
                            `}
                            <button class="btn-primary save-trainer-salary-btn" data-trainer-id="${trainer.id}" 
                                    style="margin-left: 10px;">Сохранить</button>
                        </div>
                    </div>
                </div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                    <div style="display: flex; justify-content: space-between;">
                        <div>
                            <small style="color: #666;">Тренировок проведено:</small>
                            <strong style="display: block; font-size: 18px;">${trainer.total_sessions || 0}</strong>
                        </div>
                        <div>
                            <small style="color: #666;">Заработано всего:</small>
                            <strong style="display: block; font-size: 18px; color: #4caf50;">${formatMoney(trainer.total_earned || 0)}₽</strong>
                        </div>
                        <div>
                            <small style="color: #666;">Ожидает выплаты:</small>
                            <strong style="display: block; font-size: 18px; color: #ff9800;">${formatMoney(trainer.pending_amount || 0)}₽</strong>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
        
        // Добавляем обработчики событий
        attachTrainerSalaryHandlers();
        
    } catch (error) {
        console.error('Ошибка при загрузке списка инструкторов:', error);
    }
}

// Обработчики для изменения типа выплаты
function attachTrainerSalaryHandlers() {
    // Изменение типа выплаты
    document.querySelectorAll('.payment-type-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const trainerId = e.target.dataset.trainerId;
            const card = e.target.closest('.trainer-salary-card');
            const container = card.querySelector('.payment-amount-container');
            
            const paymentType = e.target.value;
            
            // Обновляем интерфейс
            if (paymentType === 'percentage') {
                container.innerHTML = `
                    <strong>Процент:</strong>
                    <input type="number" class="payment-value-input form-control" data-trainer-id="${trainerId}" 
                           value="50" min="0" max="100" step="1"
                           style="display: inline-block; width: 80px; margin-left: 10px;"> %
                    <button class="btn-primary save-trainer-salary-btn" data-trainer-id="${trainerId}" 
                            style="margin-left: 10px;">Сохранить</button>
                `;
            } else {
                container.innerHTML = `
                    <strong>Сумма:</strong>
                    <input type="number" class="payment-value-input form-control" data-trainer-id="${trainerId}" 
                           value="500" min="0" step="50"
                           style="display: inline-block; width: 120px; margin-left: 10px;"> ₽
                    <button class="btn-primary save-trainer-salary-btn" data-trainer-id="${trainerId}" 
                            style="margin-left: 10px;">Сохранить</button>
                `;
            }
            
            // Переподключаем обработчики
            attachSaveHandlers();
        });
    });
    
    attachSaveHandlers();
}

function attachSaveHandlers() {
    // Сохранение настроек
    document.querySelectorAll('.save-trainer-salary-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const trainerId = e.target.dataset.trainerId;
            const card = e.target.closest('.trainer-salary-card');
            const paymentType = card.querySelector('.payment-type-select').value;
            const valueInput = card.querySelector('.payment-value-input');
            const value = parseFloat(valueInput.value);
            
            if (isNaN(value) || value < 0) {
                alert('Введите корректное значение');
                return;
            }
            
            try {
                const response = await fetch(`/api/trainer-salary/trainers/${trainerId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        paymentType,
                        value
                    })
                });
                
                if (!response.ok) throw new Error('Failed to save');
                
                showMessage('Настройки сохранены!', 'success');
                await loadTrainersSalaryList(); // Перезагружаем список
                
            } catch (error) {
                console.error('Ошибка при сохранении:', error);
                alert('Ошибка при сохранении настроек');
            }
        });
    });
}

// Загрузка истории выплат
async function loadSalaryPaymentsHistory() {
    try {
        const trainerFilter = document.getElementById('trainer-filter').value;
        const statusFilter = document.getElementById('status-filter').value;
        
        let url = '/api/trainer-salary/payments?';
        if (trainerFilter) url += `trainer_id=${trainerFilter}&`;
        if (statusFilter) url += `status=${statusFilter}&`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to load payments');
        
        const payments = await response.json();
        
        const container = document.getElementById('salary-payments-list');
        
        if (payments.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #999;">Нет записей о выплатах</p>';
            return;
        }
        
        container.innerHTML = `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>Инструктор</th>
                        <th>Тренировка</th>
                        <th>Тип</th>
                        <th>Сумма</th>
                        <th>Статус</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.map(payment => `
                        <tr>
                            <td>${formatDate(payment.created_at)}</td>
                            <td>${payment.trainer_name}</td>
                            <td>${payment.session_date || 'N/A'}</td>
                            <td>${payment.payment_type === 'percentage' ? `${payment.percentage}%` : 'Фикс.'}</td>
                            <td><strong>${formatMoney(payment.amount)}₽</strong></td>
                            <td>
                                <span class="status-badge ${payment.status}">
                                    ${payment.status === 'pending' ? 'В ожидании' : 
                                      payment.status === 'approved' ? 'Одобрено' : 'Выплачено'}
                                </span>
                            </td>
                            <td>
                                ${payment.status === 'pending' ? `
                                    <button class="btn-small btn-success approve-payment-btn" data-payment-id="${payment.id}">✓ Одобрить</button>
                                ` : ''}
                                ${payment.status === 'approved' ? `
                                    <button class="btn-small btn-primary mark-paid-btn" data-payment-id="${payment.id}">💰 Выплачено</button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        // Добавляем обработчики для кнопок
        attachPaymentActionHandlers();
        
        // Заполняем фильтр тренеров
        await populateTrainerFilter();
        
    } catch (error) {
        console.error('Ошибка при загрузке истории выплат:', error);
    }
}

// Заполнение фильтра тренеров
async function populateTrainerFilter() {
    try {
        const response = await fetch('/api/trainer-salary/trainers', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) return;
        
        const trainers = await response.json();
        const select = document.getElementById('trainer-filter');
        const currentValue = select.value;
        
        select.innerHTML = '<option value="">Все инструкторы</option>' +
            trainers.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('');
        
        select.value = currentValue;
        
    } catch (error) {
        console.error('Ошибка при загрузке списка тренеров:', error);
    }
}

// Обработчики действий с выплатами
function attachPaymentActionHandlers() {
    // Одобрение выплаты
    document.querySelectorAll('.approve-payment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const paymentId = e.target.dataset.paymentId;
            
            if (!confirm('Одобрить эту выплату?')) return;
            
            try {
                const response = await fetch(`/api/trainer-salary/payments/${paymentId}/approve`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });
                
                if (!response.ok) throw new Error('Failed to approve');
                
                showMessage('Выплата одобрена!', 'success');
                await loadSalaryPaymentsHistory();
                await loadSalaryStats();
                
            } catch (error) {
                console.error('Ошибка при одобрении выплаты:', error);
                alert('Ошибка при одобрении выплаты');
            }
        });
    });
    
    // Отметка о выплате
    document.querySelectorAll('.mark-paid-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const paymentId = e.target.dataset.paymentId;
            
            if (!confirm('Отметить как выплаченную?')) return;
            
            try {
                const response = await fetch(`/api/trainer-salary/payments/${paymentId}/paid`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });
                
                if (!response.ok) throw new Error('Failed to mark as paid');
                
                showMessage('Выплата отмечена как оплаченная!', 'success');
                await loadSalaryPaymentsHistory();
                await loadSalaryStats();
                
            } catch (error) {
                console.error('Ошибка при отметке выплаты:', error);
                alert('Ошибка при отметке выплаты');
            }
        });
    });
}

// Обработчики фильтров
document.getElementById('trainer-filter')?.addEventListener('change', loadSalaryPaymentsHistory);
document.getElementById('status-filter')?.addEventListener('change', loadSalaryPaymentsHistory);

// Вспомогательные функции
function formatMoney(amount) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(amount));
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function showMessage(text, type = 'success') {
    // Используем существующую функцию showNotification если она есть
    if (typeof showNotification === 'function') {
        showNotification(text, type);
    } else {
        alert(text);
    }
}
