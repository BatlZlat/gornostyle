// Глобальные переменные
const API_URL = window.location.origin;
let currentWeekStart = new Date();
let allBlocks = [];
let currentSimulatorFilter = '';

// Установить начало текущей недели (понедельник)
function setWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

currentWeekStart = setWeekStart(new Date());

// Получить токен авторизации
function getAuthToken() {
    let token = localStorage.getItem('authToken');
    
    if (!token) {
        function getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }
        
        token = getCookie('adminToken');
        
        if (token) {
            localStorage.setItem('authToken', token);
        }
    }
    
    return token;
}

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    const token = getAuthToken();
    if (!token) {
        if (window.opener && window.opener.localStorage) {
            const parentToken = window.opener.localStorage.getItem('authToken');
            if (parentToken) {
                localStorage.setItem('authToken', parentToken);
            } else {
                window.location.href = 'login.html';
                return;
            }
        } else {
            window.location.href = 'login.html';
            return;
        }
    }

    await loadInitialData();
    setupEventListeners();
});

// Загрузка начальных данных
async function loadInitialData() {
    await Promise.all([
        loadBlocks(),
        loadCalendar(),
        updateStatistics()
    ]);
}

// Установка обработчиков событий
function setupEventListeners() {
    // Навигация по неделям
    document.getElementById('prev-week-btn').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        loadCalendar();
    });
    
    document.getElementById('next-week-btn').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        loadCalendar();
    });
    
    // Фильтр тренажеров
    document.getElementById('simulator-filter').addEventListener('change', (e) => {
        currentSimulatorFilter = e.target.value;
        loadCalendar();
    });
    
    // Кнопки
    document.getElementById('create-block-btn').addEventListener('click', () => openCreateModal());
    document.getElementById('templates-btn').addEventListener('click', () => openTemplatesModal());
    document.getElementById('apply-all-btn').addEventListener('click', () => applyAllBlocks());
    
    // Модальные окна
    setupModalHandlers();
}

// Настройка обработчиков модальных окон
function setupModalHandlers() {
    const blockModal = document.getElementById('block-modal');
    const templatesModal = document.getElementById('templates-modal');
    
    // Закрытие модальных окон
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', () => {
            blockModal.classList.remove('show');
            templatesModal.classList.remove('show');
        });
    });
    
    document.getElementById('cancel-btn').addEventListener('click', () => {
        blockModal.classList.remove('show');
    });
    
    document.querySelector('.close-templates-btn').addEventListener('click', () => {
        templatesModal.classList.remove('show');
    });
    
    // Закрытие при клике вне модального окна
    window.addEventListener('click', (e) => {
        if (e.target === blockModal) {
            blockModal.classList.remove('show');
        }
        if (e.target === templatesModal) {
            templatesModal.classList.remove('show');
        }
    });
    
    // Переключение типа блокировки
    document.querySelectorAll('input[name="block-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const isSpecific = e.target.value === 'specific';
            document.getElementById('specific-dates-group').style.display = isSpecific ? 'block' : 'none';
            document.getElementById('recurring-group').style.display = isSpecific ? 'none' : 'block';
        });
    });
    
    // Отправка формы
    document.getElementById('block-form').addEventListener('submit', handleBlockFormSubmit);
    
    // Применение шаблонов
    document.querySelectorAll('.apply-template-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const template = e.target.dataset.template;
            applyTemplate(template);
        });
    });
}

// Загрузка блокировок
async function loadBlocks() {
    try {
        const response = await fetch(`${API_URL}/api/schedule-blocks?is_active=true`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Ошибка при загрузке блокировок');
        }

        allBlocks = await response.json();
        renderBlocksList();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при загрузке блокировок');
    }
}

// Отображение списка блокировок
function renderBlocksList() {
    const container = document.getElementById('blocks-list');
    
    if (allBlocks.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">Нет активных блокировок</p>';
        return;
    }
    
    container.innerHTML = allBlocks.map(block => {
        const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
        let dateInfo = '';
        
        if (block.block_type === 'specific') {
            const startDate = new Date(block.start_date).toLocaleDateString('ru-RU');
            const endDate = new Date(block.end_date).toLocaleDateString('ru-RU');
            dateInfo = `${startDate} - ${endDate}`;
        } else {
            dateInfo = `Каждый ${days[block.day_of_week]}`;
        }
        
        const timeInfo = `${block.start_time.slice(0, 5)} - ${block.end_time.slice(0, 5)}`;
        const simulatorInfo = block.simulator_id ? block.simulator_name : 'Оба тренажера';
        
        // Определяем кто заблокировал
        let blockedByInfo = '';
        if (block.trainer_id && block.trainer_name) {
            blockedByInfo = `<div class="block-info"><strong>Заблокировал:</strong> 🎿 ${block.trainer_name} (тренер)</div>`;
        } else if (block.blocked_by_type === 'admin' || block.created_by_name) {
            blockedByInfo = `<div class="block-info"><strong>Заблокировал:</strong> 👤 Администратор</div>`;
        }
        
        return `
            <div class="block-item ${block.is_active ? '' : 'inactive'}">
                <div class="block-info">
                    <div class="block-title">
                        ${block.reason || 'Блокировка'}
                        <span class="block-type-badge ${block.block_type}">${block.block_type === 'specific' ? 'Конкретные даты' : 'Постоянно'}</span>
                    </div>
                    <div class="block-details">
                        📅 ${dateInfo} | ⏰ ${timeInfo} | 🎿 ${simulatorInfo}
                        ${blockedByInfo ? `<br>${blockedByInfo.replace('<div class="block-info">', '').replace('</div>', '')}` : ''}
                    </div>
                </div>
                <div class="block-actions">
                    <button class="btn-icon btn-edit" onclick="editBlock(${block.id})">✏️</button>
                    <button class="btn-icon btn-toggle" onclick="toggleBlock(${block.id})">${block.is_active ? '⏸️' : '▶️'}</button>
                    <button class="btn-icon btn-delete" onclick="deleteBlock(${block.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

// Загрузка календаря
async function loadCalendar() {
    try {
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        // ВАЖНО: формируем даты в локальном времени, а не UTC
        const startYear = currentWeekStart.getFullYear();
        const startMonth = String(currentWeekStart.getMonth() + 1).padStart(2, '0');
        const startDay = String(currentWeekStart.getDate()).padStart(2, '0');
        const startDate = `${startYear}-${startMonth}-${startDay}`;
        
        const endYear = weekEnd.getFullYear();
        const endMonth = String(weekEnd.getMonth() + 1).padStart(2, '0');
        const endDay = String(weekEnd.getDate()).padStart(2, '0');
        const endDate = `${endYear}-${endMonth}-${endDay}`;
        
        let url = `${API_URL}/api/schedule-blocks/slots?start_date=${startDate}&end_date=${endDate}`;
        if (currentSimulatorFilter) {
            url += `&simulator_id=${currentSimulatorFilter}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Ошибка при загрузке слотов');
        }

        const slots = await response.json();
        renderCalendar(slots);
        updateWeekTitle();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при загрузке календаря');
    }
}

// Отображение календаря
function renderCalendar(slots) {
    const container = document.getElementById('calendar-view');
    
    // Группируем слоты по тренажерам
    const simulators = {};
    slots.forEach(slot => {
        if (!simulators[slot.simulator_id]) {
            simulators[slot.simulator_id] = {
                name: slot.simulator_name,
                slots: []
            };
        }
        simulators[slot.simulator_id].slots.push(slot);
    });
    
    let html = '';
    
    for (const [simId, simData] of Object.entries(simulators)) {
        html += renderSimulatorCalendar(simId, simData.name, simData.slots);
    }
    
    container.innerHTML = html || '<div class="loading">Нет данных для отображения</div>';
}

// Отображение календаря для одного тренажера
function renderSimulatorCalendar(simulatorId, simulatorName, slots) {
    const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Создаем структуру дней недели (ВС-СБ)
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(currentWeekStart);
        date.setDate(date.getDate() + i);
        weekDays.push(date);
    }
    
    // Группируем слоты по датам и времени
    const slotsByDateTime = {};
    slots.forEach(slot => {
        // PostgreSQL возвращает дату в формате "2025-10-05T19:00:00.000Z" (UTC)
        // Нужно преобразовать в локальное время
        const date = new Date(slot.date);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${day}`;
        
        const timeKey = slot.start_time;
        if (!slotsByDateTime[dateKey]) {
            slotsByDateTime[dateKey] = {};
        }
        slotsByDateTime[dateKey][timeKey] = slot;
    });
    
    // Получаем уникальные временные слоты (только рабочие часы 10:00-20:30)
    const timeSlots = new Set();
    Object.values(slotsByDateTime).forEach(daySlots => {
        Object.keys(daySlots).forEach(time => {
            const hour = parseInt(time.split(':')[0]);
            const minute = parseInt(time.split(':')[1]);
            // Показываем только слоты с 10:00 до 20:30
            if ((hour >= 10 && hour < 20) || (hour === 20 && minute <= 30)) {
                timeSlots.add(time);
            }
        });
    });
    const sortedTimeSlots = Array.from(timeSlots).sort();
    
    let html = `
        <div class="simulator-section">
            <div class="simulator-header">${simulatorName}</div>
            <div class="calendar-header">
                <div class="time-header">Время</div>
                ${weekDays.map((date, i) => {
                    const isToday = date.getTime() === today.getTime();
                    return `
                        <div class="calendar-day-header ${isToday ? 'today' : ''}">
                            <div class="day-name">${days[date.getDay()]}</div>
                            <div class="day-date">${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}</div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="calendar-body">
                ${sortedTimeSlots.map(timeSlot => {
                    const endTime = calculateEndTime(timeSlot);
                    return `
                        <div class="time-label">${timeSlot.slice(0, 5)}</div>
                        ${weekDays.map(date => {
                            // ВАЖНО: формируем dateKey в ЛОКАЛЬНОМ времени, а не UTC
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            const dateKey = `${year}-${month}-${day}`;
                            const slot = slotsByDateTime[dateKey]?.[timeSlot];
                            
                            if (!slot) {
                                return '<div class="slot empty"></div>';
                            }
                            
                            let slotClass = 'free';
                            let slotContent = '';
                            
                            if (slot.is_blocked) {
                                slotClass = 'blocked';
                                slotContent = `<div class="slot-icon">🔒</div><div class="slot-text">${slot.block_reason || 'Блок'}</div>`;
                            } else if (slot.is_booked && !slot.is_blocked) {
                                slotClass = 'booked';
                                slotContent = '<div class="slot-icon">📅</div><div class="slot-text">Занят</div>';
                            } else {
                                slotContent = '<div class="slot-icon">✅</div><div class="slot-text">Свободен</div>';
                            }
                            
                            return `<div class="slot ${slotClass}" data-slot='${JSON.stringify({
                                simulator_id: simulatorId,
                                date: dateKey,
                                start_time: slot.start_time,
                                end_time: slot.end_time,
                                is_blocked: slot.is_blocked,
                                is_booked: slot.is_booked,
                                block_id: slot.block_id || null
                            })}' onclick='handleSlotClick(this)'>${slotContent}</div>`;
                        }).join('')}
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    return html;
}

// Рассчитать время окончания (для отображения)
function calculateEndTime(startTime) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const endMinutes = minutes + 30;
    const endHours = hours + Math.floor(endMinutes / 60);
    const finalMinutes = endMinutes % 60;
    return `${endHours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}`;
}

// Обработка клика по слоту
function handleSlotClick(element) {
    const slotData = JSON.parse(element.getAttribute('data-slot'));
    
    if (slotData.is_booked && !slotData.is_blocked) {
        alert('Этот слот уже забронирован. Отмените бронирование перед блокировкой.');
        return;
    }
    
    if (slotData.is_blocked) {
        // Показываем модальное окно подтверждения снятия блокировки
        showUnblockConfirmation(slotData);
    } else if (slotData.block_id) {
        // Слот имеет block_id но не заблокирован - значит есть исключение
        // Предлагаем восстановить блокировку
        showRestoreBlockConfirmation(slotData);
    } else {
        // Открыть модальное окно для создания блокировки
        openCreateModalWithData(slotData);
    }
}

// Показать модальное окно подтверждения снятия блокировки
function showUnblockConfirmation(slotData) {
    const dateObj = new Date(slotData.date);
    const dateStr = dateObj.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = `${slotData.start_time.slice(0,5)} - ${slotData.end_time.slice(0,5)}`;
    const simulatorStr = `Тренажер ${slotData.simulator_id}`;
    
    const message = `⚠️ Снять блокировку?\n\nДата: ${dateStr}\nВремя: ${timeStr}\n${simulatorStr}\n\nБлокировка будет снята только для этого слота.\nДругие слоты останутся заблокированными.`;
    
    if (confirm(message)) {
        unblockSlot(slotData);
    }
}

// Показать модальное окно подтверждения восстановления блокировки
function showRestoreBlockConfirmation(slotData) {
    const dateObj = new Date(slotData.date);
    const dateStr = dateObj.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = `${slotData.start_time.slice(0,5)} - ${slotData.end_time.slice(0,5)}`;
    const simulatorStr = `Тренажер ${slotData.simulator_id}`;
    
    const message = `🔄 Восстановить блокировку?\n\nДата: ${dateStr}\nВремя: ${timeStr}\n${simulatorStr}\n\nБлокировка будет восстановлена для этого слота.`;
    
    if (confirm(message)) {
        restoreBlock(slotData);
    }
}

// Разблокировать слот (создать исключение)
async function unblockSlot(slotData) {
    try {
        if (!slotData.block_id) {
            alert('Не удалось определить ID блокировки');
            return;
        }
        
        // Создаём исключение из блокировки
        const response = await fetch(`${API_URL}/api/schedule-blocks/exceptions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                schedule_block_id: slotData.block_id,
                date: slotData.date,
                start_time: slotData.start_time,
                simulator_id: slotData.simulator_id
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при снятии блокировки');
        }
        
        const result = await response.json();
        console.log('Исключение создано:', result);
        
        // Обновляем календарь
        await loadCalendar();
        
    } catch (error) {
        console.error('Ошибка при разблокировке:', error);
        alert('Ошибка при снятии блокировки: ' + error.message);
    }
}

// Восстановить блокировку (удалить исключение)
async function restoreBlock(slotData) {
    try {
        if (!slotData.block_id) {
            alert('Не удалось определить ID блокировки');
            return;
        }
        
        // Удаляем исключение из блокировки
        const response = await fetch(`${API_URL}/api/schedule-blocks/exception`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                schedule_block_id: slotData.block_id,
                date: slotData.date,
                start_time: slotData.start_time,
                simulator_id: slotData.simulator_id
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при восстановлении блокировки');
        }
        
        const result = await response.json();
        console.log('Исключение удалено:', result);
        
        // Обновляем календарь
        await loadCalendar();
        
    } catch (error) {
        console.error('Ошибка при восстановлении блокировки:', error);
        alert('Ошибка при восстановлении блокировки: ' + error.message);
    }
}

// Обновить заголовок недели
function updateWeekTitle() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const startStr = `${currentWeekStart.getDate()}.${(currentWeekStart.getMonth() + 1).toString().padStart(2, '0')}`;
    const endStr = `${weekEnd.getDate()}.${(weekEnd.getMonth() + 1).toString().padStart(2, '0')}.${weekEnd.getFullYear()}`;
    
    document.getElementById('current-week-title').textContent = `Неделя: ${startStr} - ${endStr}`;
}

// Обновить статистику
async function updateStatistics() {
    try {
        const response = await fetch(`${API_URL}/api/schedule-blocks`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) throw new Error('Ошибка при загрузке статистики');

        const blocks = await response.json();
        
        const activeBlocks = blocks.filter(b => b.is_active).length;
        const recurringBlocks = blocks.filter(b => b.is_active && b.block_type === 'recurring').length;
        
        document.getElementById('stat-active-blocks').textContent = activeBlocks;
        document.getElementById('stat-recurring-blocks').textContent = recurringBlocks;
        
        // Подсчитываем заблокированные слоты на текущей неделе
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const startDate = currentWeekStart.toISOString().split('T')[0];
        const endDate = weekEnd.toISOString().split('T')[0];
        
        const slotsResponse = await fetch(`${API_URL}/api/schedule-blocks/slots?start_date=${startDate}&end_date=${endDate}`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (slotsResponse.ok) {
            const slots = await slotsResponse.json();
            const blockedSlots = slots.filter(s => s.is_blocked).length;
            document.getElementById('stat-blocked-slots').textContent = blockedSlots;
        }
    } catch (error) {
        console.error('Ошибка при обновлении статистики:', error);
    }
}

// Открыть модальное окно создания блокировки
function openCreateModal() {
    document.getElementById('modal-title').textContent = 'Создать блокировку';
    document.getElementById('block-form').reset();
    document.getElementById('block-id').value = '';
    
    // Установить дату по умолчанию
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('modal-start-date').value = today;
    document.getElementById('modal-end-date').value = today;
    
    document.getElementById('specific-dates-group').style.display = 'block';
    document.getElementById('recurring-group').style.display = 'none';
    
    document.getElementById('block-modal').classList.add('show');
}

// Открыть модальное окно с предзаполненными данными
function openCreateModalWithData(slotData) {
    openCreateModal();
    
    document.getElementById('modal-simulator').value = slotData.simulator_id;
    document.getElementById('modal-start-date').value = slotData.date;
    document.getElementById('modal-end-date').value = slotData.date;
    document.getElementById('modal-start-time').value = slotData.start_time;
    document.getElementById('modal-end-time').value = slotData.end_time;
}

// Открыть модальное окно шаблонов
function openTemplatesModal() {
    document.getElementById('templates-modal').classList.add('show');
}

// Редактировать блокировку
async function editBlock(id) {
    const block = allBlocks.find(b => b.id === id);
    if (!block) return;
    
    document.getElementById('modal-title').textContent = 'Редактировать блокировку';
    document.getElementById('block-id').value = block.id;
    document.getElementById('modal-simulator').value = block.simulator_id || '';
    document.getElementById('modal-start-time').value = block.start_time;
    document.getElementById('modal-end-time').value = block.end_time;
    document.getElementById('modal-reason').value = block.reason || '';
    
    if (block.block_type === 'specific') {
        document.querySelector('input[value="specific"]').checked = true;
        document.getElementById('modal-start-date').value = block.start_date;
        document.getElementById('modal-end-date').value = block.end_date;
        document.getElementById('specific-dates-group').style.display = 'block';
        document.getElementById('recurring-group').style.display = 'none';
    } else {
        document.querySelector('input[value="recurring"]').checked = true;
        document.getElementById('modal-day-of-week').value = block.day_of_week;
        document.getElementById('specific-dates-group').style.display = 'none';
        document.getElementById('recurring-group').style.display = 'block';
    }
    
    document.getElementById('block-modal').classList.add('show');
}

// Удалить блокировку
async function deleteBlock(id) {
    if (!confirm('Удалить эту блокировку?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/schedule-blocks/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка при удалении блокировки');
        }

        alert('Блокировка успешно удалена');
        await loadInitialData();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при удалении блокировки');
    }
}

// Переключить статус блокировки
async function toggleBlock(id) {
    try {
        const response = await fetch(`${API_URL}/api/schedule-blocks/${id}/toggle`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка при изменении статуса');
        }

        await loadInitialData();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при изменении статуса блокировки');
    }
}

// Обработка отправки формы блокировки
async function handleBlockFormSubmit(e) {
    e.preventDefault();
    
    const blockId = document.getElementById('block-id').value;
    const blockType = document.querySelector('input[name="block-type"]:checked').value;
    
    const data = {
        simulator_id: document.getElementById('modal-simulator').value || null,
        block_type: blockType,
        start_time: document.getElementById('modal-start-time').value,
        end_time: document.getElementById('modal-end-time').value,
        reason: document.getElementById('modal-reason').value
    };
    
    if (blockType === 'specific') {
        data.start_date = document.getElementById('modal-start-date').value;
        data.end_date = document.getElementById('modal-end-date').value;
    } else {
        data.day_of_week = parseInt(document.getElementById('modal-day-of-week').value);
    }
    
    try {
        const url = blockId 
            ? `${API_URL}/api/schedule-blocks/${blockId}`
            : `${API_URL}/api/schedule-blocks`;
        
        const method = blockId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при сохранении');
        }

        alert(blockId ? 'Блокировка обновлена' : 'Блокировка создана');
        document.getElementById('block-modal').classList.remove('show');
        await loadInitialData();
    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message);
    }
}

// Применить все блокировки к расписанию
async function applyAllBlocks() {
    if (!confirm('Применить все активные блокировки к существующему расписанию? Это обновит таблицу schedule.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/schedule-blocks/apply-all`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка при применении блокировок');
        }

        const result = await response.json();
        alert(`✅ Успешно применено!\n\nБлокировок: ${result.blocks_count}\nОбновлено слотов: ${result.applied_slots}`);
        
        await loadCalendar();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при применении блокировок к расписанию');
    }
}

// Применить шаблон блокировки
async function applyTemplate(templateName) {
    const templates = {
        'lunch': {
            simulator_id: null,
            block_type: 'recurring',
            start_time: '12:00:00',
            end_time: '13:00:00',
            reason: 'Обеденный перерыв',
            days: [1, 2, 3, 4, 5, 6, 0] // Все дни недели
        },
        'tech-monday': {
            simulator_id: null,
            block_type: 'recurring',
            start_time: '09:00:00',
            end_time: '10:00:00',
            reason: 'Технический перерыв',
            days: [1] // Только понедельник
        },
        'morning-break': {
            simulator_id: null,
            block_type: 'recurring',
            start_time: '10:30:00',
            end_time: '11:00:00',
            reason: 'Утренний перерыв',
            days: [1, 2, 3, 4, 5, 6, 0]
        },
        'evening-break': {
            simulator_id: null,
            block_type: 'recurring',
            start_time: '19:00:00',
            end_time: '19:30:00',
            reason: 'Вечерний перерыв',
            days: [1, 2, 3, 4, 5, 6, 0]
        }
    };
    
    const template = templates[templateName];
    if (!template) return;
    
    if (!confirm(`Применить шаблон "${template.reason}"?`)) return;
    
    try {
        const blocks = template.days.map(day => ({
            simulator_id: template.simulator_id,
            block_type: template.block_type,
            day_of_week: day,
            start_time: template.start_time,
            end_time: template.end_time,
            reason: template.reason
        }));
        
        const response = await fetch(`${API_URL}/api/schedule-blocks/bulk`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ blocks })
        });

        if (!response.ok) {
            throw new Error('Ошибка при применении шаблона');
        }

        const result = await response.json();
        alert(`Шаблон применен! Создано блокировок: ${result.created.length}`);
        document.getElementById('templates-modal').classList.remove('show');
        await loadInitialData();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при применении шаблона');
    }
}

