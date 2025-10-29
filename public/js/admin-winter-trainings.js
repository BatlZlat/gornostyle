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
    const container = document.getElementById('winter-trainings-list');
    
    if (!container) {
        console.error('Элемент winter-trainings-list не найден');
        return;
    }
    
    try {
        // Получаем текущую дату
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        
        // Устанавливаем дату окончания на 30 дней вперед
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);
        const dateTo = endDate.toISOString().split('T')[0];
        
        // Запрашиваем тренировки за диапазон дат
        const response = await fetch(`/api/schedule/admin?slope_type=natural_slope`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token') || localStorage.getItem('authToken')}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const trainings = await response.json();
        
        if (!Array.isArray(trainings)) {
            console.error('Получены некорректные данные:', trainings);
            throw new Error('Получены некорректные данные от сервера');
        }
        
        // Фильтруем по типу и статусу, если указаны
        const typeFilter = document.getElementById('winter-type-filter');
        const statusFilter = document.getElementById('winter-status-filter');
        
        let filteredTrainings = trainings;
        
        if (typeFilter && typeFilter.value) {
            filteredTrainings = filteredTrainings.filter(t => t.winter_training_type === typeFilter.value);
        }
        
        if (statusFilter && statusFilter.value) {
            filteredTrainings = filteredTrainings.filter(t => t.status === statusFilter.value);
        }
        
        displayWinterTrainings(filteredTrainings);
    } catch (error) {
        console.error('Ошибка загрузки тренировок:', error);
        container.innerHTML = '<div class="alert alert-info">Ошибка загрузки тренировок. Попробуйте обновить страницу.</div>';
    }
}

// Функция для форматирования даты с днем недели
function formatDateWithWeekday(dateString) {
    const date = new Date(dateString);
    const weekdays = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
    const weekday = weekdays[date.getDay()];
    const dateFormatted = date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    return `${dateFormatted} (${weekday})`;
}

// Отобразить список зимних тренировок
function displayWinterTrainings(trainings) {
    const container = document.getElementById('winter-trainings-list');
    
    if (trainings.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Нет запланированных тренировок на естественном склоне</div>';
        return;
    }
    
    // Сортируем тренировки по дате (от ближайшей к дальней)
    trainings.sort((a, b) => {
        const dateA = new Date(a.date || a.session_date);
        const dateB = new Date(b.date || b.session_date);
        if (dateA.getTime() !== dateB.getTime()) {
            return dateA - dateB;
        }
        const timeA = (a.start_time || '').toString();
        const timeB = (b.start_time || '').toString();
        return timeA.localeCompare(timeB);
    });
    
    // Группируем тренировки по дате
    const grouped = {};
    trainings.forEach(training => {
        const date = training.date || training.session_date;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(training);
    });
    
    // Формируем HTML
    let html = '';
    Object.keys(grouped).forEach(date => {
        html += `
            <div class="training-date-header">${formatDateWithWeekday(date)}</div>
            <div class="training-table-container">
                <table class="training-table">
                    <thead>
                        <tr>
                            <th>Время</th>
                            <th>Тип</th>
                            <th>Название</th>
                            <th>Тренер</th>
                            <th>Участников</th>
                            <th>Уровень</th>
                            <th>Цена (за чел.)</th>
                            <th>Статус</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${grouped[date].map(training => renderWinterTrainingRow(training)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Отрисовать строку тренировки
function renderWinterTrainingRow(training) {
    const typeLabels = {
        individual: 'Индивидуальное',
        sport_group: 'Спортивная группа',
        group: 'Групповая'
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
    
    // Форматируем время (убираем секунды, если есть)
    const startTime = training.start_time ? training.start_time.slice(0, 5) : '—';
    const endTime = training.end_time ? training.end_time.slice(0, 5) : '—';
    
    // Определяем тип тренировки
    const isIndividual = training.is_individual || training.winter_training_type === 'individual';
    const type = isIndividual ? 'Индивидуальная' : (typeLabels[training.winter_training_type] || 'Групповая');
    
    // Название: для индивидуальных - участники, для групповых - название группы
    let name = '—';
    if (isIndividual) {
        // Для индивидуальных тренировок название - это имя участника
        // Если есть participant_names в данных, используем его
        if (training.participant_names && Array.isArray(training.participant_names)) {
            name = training.participant_names.join(', ');
        } else if (typeof training.participant_names === 'string') {
            name = training.participant_names;
        } else {
            name = 'Естественный склон';
        }
    } else {
        name = training.group_name || 'Групповая тренировка';
    }
    
    // Участники
    const currentParticipants = training.current_participants || (isIndividual ? 1 : 0);
    const maxParticipants = training.max_participants || (isIndividual ? 1 : 1);
    
    // Тренер
    const trainer = training.trainer_name || 'Не назначен';
    
    // Цена за человека
    let price = '—';
    if (training.price != null && maxParticipants > 0) {
        // Для групповых тренировок делим общую цену на количество участников
        // Для индивидуальных цена уже за одного человека
        const totalPrice = parseFloat(training.price);
        const pricePerPerson = isIndividual ? totalPrice : (totalPrice / maxParticipants);
        price = `${pricePerPerson.toFixed(2)} ₽`;
    }
    
    // Статус
    const status = statusLabels[training.status] || training.status || '—';
    const statusColor = statusColors[training.status] || '#666';
    
    // Уровень подготовки
    const skillLevel = training.skill_level || '—';
    
    return `
        <tr class="training-row">
            <td>${startTime} - ${endTime}</td>
            <td>${type}</td>
            <td>${name}</td>
            <td>${trainer}</td>
            <td>${currentParticipants}/${maxParticipants}</td>
            <td>${skillLevel}</td>
            <td>${price}</td>
            <td><span style="color:${statusColor};font-weight:bold;">${status}</span></td>
            <td class="training-actions">
                <button class="btn-secondary" onclick="viewWinterTrainingDetails(${training.id})">
                    Подробнее
                </button>
                <button class="btn-secondary" onclick="editWinterTraining(${training.id})">
                    Редактировать
                </button>
                <button class="btn-danger" onclick="deleteWinterTraining(${training.id})">
                    Удалить
                </button>
            </td>
        </tr>
    `;
}

// Открыть модальное окно создания зимней тренировки
function openCreateWinterTraining() {
    window.location.href = 'winter-training.html';
}

// Просмотр деталей зимней тренировки
function viewWinterTrainingDetails(id) {
    // Используем ту же функцию, что и для обычных тренировок, но с указанием slope_type
    if (typeof viewScheduleDetails === 'function') {
        // Определяем, индивидуальная ли это тренировка (нужно будет проверить)
        viewScheduleDetails(id, false, 'natural_slope');
    } else {
        alert(`Просмотр тренировки #${id}\n\nФункция просмотра будет добавлена.`);
    }
}

// Редактирование зимней тренировки
async function editWinterTraining(id) {
    try {
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        
        // Загружаем данные тренировки
        const trainingResponse = await fetch(`/api/winter-trainings/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!trainingResponse.ok) {
            throw new Error('Не удалось загрузить данные тренировки');
        }
        
        const training = await trainingResponse.json();
        
        // Загружаем данные для выпадающих списков
        const [trainersResponse, groupsResponse] = await Promise.all([
            fetch('/api/trainers', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }).then(res => res.json()),
            fetch('/api/groups', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }).then(res => res.json())
        ]);
        
        const trainers = Array.isArray(trainersResponse) ? trainersResponse : (trainersResponse.trainers || []);
        const groups = Array.isArray(groupsResponse) ? groupsResponse : (groupsResponse.groups || []);
        
        // Формируем options для select
        const trainerOptions = trainers
            .filter(tr => tr.is_active !== false)
            .map(tr => 
                `<option value="${tr.id}" ${tr.id === training.trainer_id ? 'selected' : ''}>${tr.full_name}</option>`
            ).join('');
        
        const groupOptions = groups.map(gr => 
            `<option value="${gr.id}" ${gr.id === training.group_id ? 'selected' : ''}>${gr.name}</option>`
        ).join('');
        
        // Удаляем старое модальное окно, если есть
        const oldModal = document.getElementById('edit-winter-training-modal');
        if (oldModal) {
            oldModal.remove();
        }
        
        // Формируем HTML модального окна
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'edit-winter-training-modal';
        
        // Форматируем дату для input type="date"
        const dateValue = training.session_date ? training.session_date.split('T')[0] : '';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <h3>Редактировать тренировку на естественном склоне</h3>
                <form id="edit-winter-training-form">
                    <div class="form-group">
                        <label>Дата (только СБ и ВС)</label>
                        <input type="date" name="session_date" id="edit-session-date" value="${dateValue}" required />
                        <small id="date-warning" style="color: #e74c3c; display: none; margin-top: 5px;">
                            ⚠️ Тренировки возможны только на выходные дни (Суббота и Воскресенье)
                        </small>
                    </div>
                    <div class="form-group">
                        <label>Время начала</label>
                        <input type="time" name="start_time" value="${training.start_time ? training.start_time.slice(0,5) : ''}" required />
                    </div>
                    <div class="form-group">
                        <label>Время окончания</label>
                        <input type="time" name="end_time" value="${training.end_time ? training.end_time.slice(0,5) : ''}" required />
                    </div>
                    <div class="form-group">
                        <label>Группа</label>
                        <select name="group_id" required>
                            <option value="">Выберите группу</option>
                            ${groupOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Тренер</label>
                        <select name="trainer_id">
                            <option value="">Выберите тренера (опционально)</option>
                            ${trainerOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Уровень подготовки</label>
                        <select name="skill_level" required>
                            <option value="">Выберите уровень</option>
                            ${Array.from({length: 10}, (_, i) => i + 1).map(level => 
                                `<option value="${level}" ${training.skill_level === level ? 'selected' : ''}>Уровень ${level}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Максимальное количество участников</label>
                        <select name="max_participants" required>
                            <option value="">Выберите количество</option>
                            <option value="2" ${training.max_participants === 2 ? 'selected' : ''}>2 человека</option>
                            <option value="3" ${training.max_participants === 3 ? 'selected' : ''}>3 человека</option>
                            <option value="4" ${training.max_participants === 4 ? 'selected' : ''}>4 человека</option>
                            <option value="6" ${training.max_participants === 6 ? 'selected' : ''}>6 человек</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Цена общая (₽)</label>
                        <input type="number" name="price" value="${training.price ? parseFloat(training.price).toFixed(2) : ''}" min="0" step="0.01" required />
                        <small style="color: #666; display: block; margin-top: 5px;">
                            Цена за человека будет рассчитана автоматически: ${training.max_participants > 0 && training.price ? (parseFloat(training.price) / training.max_participants).toFixed(2) : '-'} ₽
                        </small>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" id="close-edit-winter-modal">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Валидация даты - только выходные дни
        const dateInput = document.getElementById('edit-session-date');
        const dateWarning = document.getElementById('date-warning');
        
        function validateDate() {
            if (!dateInput.value) {
                dateWarning.style.display = 'none';
                dateInput.style.borderColor = '';
                return true;
            }
            
            // Правильно определяем день недели (без учета timezone)
            const [year, month, day] = dateInput.value.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day); // Месяц в JS: 0-11
            const dayOfWeek = selectedDate.getDay(); // 0 = ВС, 6 = СБ
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            
            if (!isWeekend) {
                dateWarning.style.display = 'block';
                dateInput.style.borderColor = '#e74c3c';
                return false;
            } else {
                dateWarning.style.display = 'none';
                dateInput.style.borderColor = '';
                return true;
            }
        }
        
        dateInput.addEventListener('change', validateDate);
        
        // Закрытие по кнопке
        document.getElementById('close-edit-winter-modal').onclick = () => modal.remove();
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => { 
            if (e.target === modal) modal.remove(); 
        };
        
        // Обработка сохранения
        document.getElementById('edit-winter-training-form').onsubmit = async function(e) {
            e.preventDefault();
            
            // Валидация даты перед отправкой
            const dateValue = document.getElementById('edit-session-date').value;
            if (!dateValue) {
                alert('⚠️ Пожалуйста, выберите дату тренировки.');
                return;
            }
            
            // Правильно определяем день недели (без учета timezone)
            const [year, month, day] = dateValue.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day); // Месяц в JS: 0-11
            const dayOfWeek = selectedDate.getDay(); // 0 = ВС, 6 = СБ
            
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                alert('⚠️ Тренировки возможны только на выходные дни (Суббота и Воскресенье). Пожалуйста, выберите другую дату.');
                dateWarning.style.display = 'block';
                return;
            }
            
            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());
            
            // Преобразуем числовые поля
            data.max_participants = parseInt(data.max_participants);
            data.skill_level = parseInt(data.skill_level);
            data.price = parseFloat(data.price);
            data.trainer_id = data.trainer_id ? parseInt(data.trainer_id) : null;
            data.group_id = parseInt(data.group_id);
            
            // Добавляем duration (по умолчанию 60 минут)
            const startTime = new Date(`2000-01-01T${data.start_time}`);
            const endTime = new Date(`2000-01-01T${data.end_time}`);
            data.duration = Math.round((endTime - startTime) / (1000 * 60)) || 60;
            
            // Отправляем PUT-запрос
            try {
                const response = await fetch(`/api/winter-trainings/${id}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Ошибка при сохранении');
                }
                
                // Показываем успешное сообщение
                if (typeof showSuccess === 'function') {
                    showSuccess('Тренировка успешно обновлена');
                } else {
                    alert('✅ Тренировка успешно обновлена');
                }
                
                modal.remove();
                loadWinterTrainings(); // Перезагружаем список
            } catch (error) {
                console.error('Ошибка при сохранении:', error);
                if (typeof showError === 'function') {
                    showError(error.message);
                } else {
                    alert('❌ Ошибка: ' + error.message);
                }
            }
        };
    } catch (error) {
        console.error('Ошибка при загрузке данных для редактирования:', error);
        alert('❌ Ошибка: ' + error.message);
    }
}

// Удаление зимней тренировки
async function deleteWinterTraining(id) {
    if (!confirm('Вы уверены, что хотите удалить эту тренировку?')) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        const response = await fetch(`/api/individual-trainings/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при удалении тренировки');
        }
        
        alert('✅ Тренировка успешно удалена');
        loadWinterTrainings(); // Перезагружаем список
    } catch (error) {
        console.error('Ошибка удаления тренировки:', error);
        alert('❌ Ошибка при удалении тренировки: ' + error.message);
    }
}

// Делаем функции глобально доступными
window.editWinterTraining = editWinterTraining;
window.deleteWinterTraining = deleteWinterTraining;
window.viewWinterTrainingDetails = viewWinterTrainingDetails;

console.log('✅ admin-winter-trainings.js загружен');

