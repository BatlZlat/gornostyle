/**
 * Управление зимними тренировками (естественный склон)
 */

// Инициализация страницы зимних тренировок
function initWinterTrainingsPage() {
    const dateInput = document.getElementById('winter-trainings-date');
    const prevBtn = document.getElementById('winter-prev-date');
    const nextBtn = document.getElementById('winter-next-date');
    const typeFilter = document.getElementById('winter-type-filter');
    const statusFilter = document.getElementById('winter-status-filter');
    
    // Установить текущую дату
    if (dateInput && !dateInput.value) {
        dateInput.valueAsDate = new Date();
    }
    
    // Обработчики событий
    if (dateInput) {
        dateInput.addEventListener('change', loadWinterTrainings);
    }
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            const currentDate = new Date(dateInput.value);
            currentDate.setDate(currentDate.getDate() - 1);
            dateInput.valueAsDate = currentDate;
            loadWinterTrainings();
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const currentDate = new Date(dateInput.value);
            currentDate.setDate(currentDate.getDate() + 1);
            dateInput.valueAsDate = currentDate;
            loadWinterTrainings();
        });
    }
    
    if (typeFilter) {
        typeFilter.addEventListener('change', loadWinterTrainings);
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', loadWinterTrainings);
    }
    
    loadWinterTrainings();
}

// Загрузить список зимних тренировок
async function loadWinterTrainings() {
    const dateInput = document.getElementById('winter-trainings-date');
    const typeFilter = document.getElementById('winter-type-filter');
    const statusFilter = document.getElementById('winter-status-filter');
    const container = document.getElementById('winter-trainings-list');
    
    if (!dateInput || !container) {
        console.error('Элементы страницы не найдены');
        return;
    }
    
    const date = dateInput.value;
    const type = typeFilter ? typeFilter.value : '';
    const status = statusFilter ? statusFilter.value : '';
    
    try {
        let url = `/api/schedule/admin?date=${date}&slope_type=natural_slope`;
        if (type) url += `&winter_training_type=${type}`;
        if (status) url += `&status=${status}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки тренировок');
        }
        
        const trainings = await response.json();
        displayWinterTrainings(trainings);
    } catch (error) {
        console.error('Ошибка:', error);
        container.innerHTML = '<p style="text-align:center;color:red;">Ошибка загрузки тренировок</p>';
    }
}

// Отобразить список зимних тренировок
function displayWinterTrainings(trainings) {
    const container = document.getElementById('winter-trainings-list');
    
    if (trainings.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">Нет запланированных тренировок на эту дату</p>';
        return;
    }
    
    // Сортируем по времени
    trainings.sort((a, b) => {
        const timeA = a.start_time || '';
        const timeB = b.start_time || '';
        return timeA.localeCompare(timeB);
    });
    
    let html = '<div class="trainings-table-container"><table class="trainings-table"><thead><tr>';
    html += '<th>Время</th>';
    html += '<th>Тип</th>';
    html += '<th>Участников</th>';
    html += '<th>Тренер</th>';
    html += '<th>Цена</th>';
    html += '<th>Статус</th>';
    html += '<th>Действия</th>';
    html += '</tr></thead><tbody>';
    
    trainings.forEach(training => {
        html += renderWinterTrainingRow(training);
    });
    
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// Отрисовать строку тренировки
function renderWinterTrainingRow(training) {
    const typeLabels = {
        individual: 'Индивидуальное',
        sport_group: 'Спортивная группа',
        group: 'Обычная группа'
    };
    
    const statusLabels = {
        scheduled: 'Запланирована',
        completed: 'Завершена',
        cancelled: 'Отменена'
    };
    
    const statusColors = {
        scheduled: '#2196F3',
        completed: '#4CAF50',
        cancelled: '#f44336'
    };
    
    const type = typeLabels[training.winter_training_type] || training.winter_training_type || '—';
    const participants = training.participants || 0;
    const maxParticipants = training.max_participants || 0;
    const trainer = training.trainer_name || 'Не назначен';
    const price = training.price ? `${parseFloat(training.price).toFixed(2)} ₽` : '—';
    const status = statusLabels[training.status] || training.status;
    const statusColor = statusColors[training.status] || '#666';
    
    return `
        <tr>
            <td>${training.start_time || '—'} - ${training.end_time || '—'}</td>
            <td>${type}</td>
            <td>${participants}/${maxParticipants}</td>
            <td>${trainer}</td>
            <td>${price}</td>
            <td><span style="color:${statusColor};font-weight:bold;">${status}</span></td>
            <td>
                <button class="btn-secondary btn-sm" onclick="viewWinterTrainingDetails(${training.id})">Подробнее</button>
            </td>
        </tr>
    `;
}

// Открыть модальное окно создания зимней тренировки
function openCreateWinterTraining() {
    alert('Функция создания зимней тренировки будет добавлена в следующей версии.\n\nСейчас зимние тренировки можно создавать через общее расписание с типом "natural_slope".');
}

// Просмотр деталей зимней тренировки
function viewWinterTrainingDetails(id) {
    alert(`Просмотр тренировки #${id}\n\nДетальный просмотр будет добавлен в следующей версии.`);
}

console.log('✅ admin-winter-trainings.js загружен');

