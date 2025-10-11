// Глобальные переменные
const API_URL = window.location.origin;
let currentMonth = new Date();
let scheduleData = [];
let trainerData = null;
let currentDaySlots = [];

// Функция для получения cookie
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Функция для удаления cookie
function deleteCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
}

// Функция для получения токена
function getAuthToken() {
    return getCookie('trainerToken');
}

// Функция выхода
function logout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        deleteCookie('trainerToken');
        localStorage.removeItem('trainerData');
        window.location.href = '/trainer-login.html';
    }
}

// Функция для выполнения API запроса
async function apiRequest(endpoint, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
        window.location.href = '/trainer-login.html';
        return null;
    }

    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        });

        if (response.status === 401) {
            // Токен недействителен
            deleteCookie('trainerToken');
            window.location.href = '/trainer-login.html';
            return null;
        }

        return response;
    } catch (error) {
        console.error('Ошибка API запроса:', error);
        throw error;
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    // Проверяем авторизацию
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/trainer-login.html';
        return;
    }

    // Загружаем данные тренера
    await loadTrainerData();

    // Загружаем календарь
    await loadCalendar();

    // Устанавливаем обработчики
    setupEventListeners();
});

// Загрузка данных тренера
async function loadTrainerData() {
    try {
        // Сначала пробуем из localStorage
        const cachedData = localStorage.getItem('trainerData');
        if (cachedData) {
            trainerData = JSON.parse(cachedData);
            document.getElementById('trainer-name').textContent = trainerData.fullName;
        }

        // Затем проверяем актуальность через API
        const response = await apiRequest('/api/trainer/verify');
        if (response && response.ok) {
            const data = await response.json();
            if (data.valid && data.trainer) {
                trainerData = data.trainer;
                localStorage.setItem('trainerData', JSON.stringify(data.trainer));
                document.getElementById('trainer-name').textContent = data.trainer.fullName;
            }
        }
    } catch (error) {
        console.error('Ошибка при загрузке данных тренера:', error);
    }
}

// Загрузка календаря
async function loadCalendar() {
    try {
        const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 2, 0); // +2 месяца

        // Форматируем даты для API
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // Загружаем расписание
        const response = await apiRequest(`/api/trainer/schedule?start_date=${startDateStr}&end_date=${endDateStr}`);
        
        if (!response || !response.ok) {
            throw new Error('Ошибка при загрузке расписания');
        }

        scheduleData = await response.json();

        // Отрисовываем календарь
        renderCalendar();

    } catch (error) {
        console.error('Ошибка при загрузке календаря:', error);
        document.getElementById('calendar-grid').innerHTML = '<div class="loading">Ошибка загрузки календаря</div>';
    }
}

// Отрисовка календаря
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    // Обновляем заголовок
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    document.getElementById('current-month-title').textContent = 
        `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

    // Получаем первый день месяца
    const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    // Находим день недели первого дня (понедельник = 0)
    let firstDayOfWeek = firstDay.getDay() - 1;
    if (firstDayOfWeek === -1) firstDayOfWeek = 6; // Воскресенье

    // Добавляем пустые ячейки
    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day empty';
        grid.appendChild(emptyDay);
    }

    // Добавляем дни месяца
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
        const dateStr = date.toISOString().split('T')[0];

        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        
        // Проверяем - прошедшая дата
        if (date < today) {
            dayElement.classList.add('past');
        }

        // Проверяем - сегодня
        if (date.toDateString() === today.toDateString()) {
            dayElement.classList.add('today');
        }

        // Проверяем статус дня (есть ли тренировки)
        const daySlots = scheduleData.filter(slot => slot.date === dateStr);
        const hasTraining = daySlots.some(slot => slot.has_training);

        if (hasTraining) {
            dayElement.classList.add('has-training');
        } else {
            dayElement.classList.add('free');
        }

        // Содержимое дня
        dayElement.innerHTML = `
            <div class="day-number">${day}</div>
        `;

        // Обработчик клика
        if (date >= today) {
            dayElement.addEventListener('click', () => openDayModal(dateStr));
        }

        grid.appendChild(dayElement);
    }
}

// Открытие модального окна с расписанием дня
async function openDayModal(dateStr) {
    const modal = document.getElementById('day-modal');
    const container = document.getElementById('simulators-container');
    
    // Форматируем дату для заголовка
    const date = new Date(dateStr + 'T00:00:00');
    const dateFormatted = date.toLocaleDateString('ru-RU', { 
        day: 'numeric', 
        month: 'long',
        year: 'numeric'
    });
    
    document.getElementById('modal-title').textContent = `Расписание на ${dateFormatted}`;
    
    // Показываем модальное окно
    modal.classList.add('show');
    container.innerHTML = '<div class="loading">Загрузка расписания</div>';

    try {
        // Загружаем слоты на этот день
        const daySlots = scheduleData.filter(slot => slot.date === dateStr);
        
        // Группируем по тренажерам
        const simulator1Slots = daySlots.filter(slot => slot.simulator_id === 1);
        const simulator2Slots = daySlots.filter(slot => slot.simulator_id === 2);

        // Отрисовываем расписание для обоих тренажеров
        container.innerHTML = '';

        // Тренажер 1
        renderSimulatorSlots(container, 1, simulator1Slots, dateStr);

        // Тренажер 2
        renderSimulatorSlots(container, 2, simulator2Slots, dateStr);

        currentDaySlots = daySlots;

    } catch (error) {
        console.error('Ошибка при загрузке расписания дня:', error);
        container.innerHTML = '<div class="loading">Ошибка загрузки расписания</div>';
    }
}

// Отрисовка слотов для тренажера
function renderSimulatorSlots(container, simulatorId, slots, dateStr) {
    const section = document.createElement('div');
    section.className = 'simulator-section';

    // Проверяем работает ли тренажер
    const isWorking = slots.length > 0 && slots[0].simulator_is_working;

    if (!isWorking) {
        section.classList.add('inactive');
    }

    section.innerHTML = `<h3>Тренажер ${simulatorId} ${!isWorking ? '(не работает)' : ''}</h3>`;

    const slotsGrid = document.createElement('div');
    slotsGrid.className = 'slots-grid';

    // Проверяем - можно ли бронировать (только на неделю вперед)
    const selectedDate = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneWeekLater = new Date(today);
    oneWeekLater.setDate(oneWeekLater.getDate() + 7);

    const canBook = selectedDate <= oneWeekLater && selectedDate >= today;

    if (slots.length === 0) {
        slotsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #666;">Нет доступных слотов</div>';
    } else {
        slots.forEach(slot => {
            const slotElement = document.createElement('div');
            slotElement.className = 'slot';

            // Определяем статус слота
            if (slot.has_training) {
                // Занято тренировкой
                slotElement.classList.add('booked-by-training');
                slotElement.innerHTML = `
                    <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                    <div class="slot-status">Занят 📅</div>
                `;
            } else if (slot.is_blocked) {
                // Заблокировано
                if (slot.blocked_by_trainer) {
                    // Проверяем - это наша блокировка?
                    const isMyBooking = slot.block_reason === trainerData.fullName;
                    
                    if (isMyBooking && canBook) {
                        slotElement.classList.add('my-booking');
                        slotElement.innerHTML = `
                            <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                            <div class="slot-status">Моя бронь</div>
                        `;
                        slotElement.addEventListener('click', () => cancelBooking(slot, dateStr, simulatorId));
                    } else {
                        slotElement.classList.add('blocked');
                        slotElement.innerHTML = `
                            <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                            <div class="slot-status">${slot.block_reason}</div>
                        `;
                    }
                } else {
                    // Блокировка администратора
                    slotElement.classList.add('blocked');
                    slotElement.innerHTML = `
                        <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                        <div class="slot-status">${slot.block_reason}</div>
                    `;
                }
            } else if (!isWorking) {
                // Тренажер не работает
                slotElement.classList.add('blocked');
                slotElement.innerHTML = `
                    <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                    <div class="slot-status">Не работает</div>
                `;
            } else {
                // Свободный слот
                if (canBook) {
                    slotElement.classList.add('free');
                    slotElement.innerHTML = `
                        <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                        <div class="slot-status">Свободно</div>
                    `;
                    slotElement.addEventListener('click', () => bookSlot(slot, dateStr, simulatorId));
                } else {
                    slotElement.classList.add('blocked');
                    slotElement.innerHTML = `
                        <div class="slot-time">${slot.start_time.slice(0, 5)}</div>
                        <div class="slot-status">Слишком далеко</div>
                    `;
                }
            }

            slotsGrid.appendChild(slotElement);
        });
    }

    section.appendChild(slotsGrid);
    container.appendChild(section);
}

// Бронирование слота
async function bookSlot(slot, dateStr, simulatorId) {
    if (!confirm(`Забронировать время ${slot.start_time.slice(0, 5)} на тренажере ${simulatorId}?`)) {
        return;
    }

    try {
        const response = await apiRequest('/api/trainer/bookings', {
            method: 'POST',
            body: JSON.stringify({
                simulator_id: simulatorId,
                date: dateStr,
                start_time: slot.start_time,
                end_time: slot.end_time
            })
        });

        if (!response) return;

        const data = await response.json();

        if (response.ok) {
            alert('✅ Время успешно забронировано!');
            // Перезагружаем календарь и модальное окно
            await loadCalendar();
            await openDayModal(dateStr);
        } else {
            alert(`❌ Ошибка: ${data.error || 'Не удалось забронировать время'}`);
        }
    } catch (error) {
        console.error('Ошибка при бронировании:', error);
        alert('❌ Ошибка при бронировании. Попробуйте позже.');
    }
}

// Отмена бронирования
async function cancelBooking(slot, dateStr, simulatorId) {
    if (!confirm(`Отменить бронирование ${slot.start_time.slice(0, 5)} на тренажере ${simulatorId}?`)) {
        return;
    }

    try {
        const response = await apiRequest(`/api/trainer/bookings/${slot.block_id}`, {
            method: 'DELETE'
        });

        if (!response) return;

        const data = await response.json();

        if (response.ok) {
            alert('✅ Бронирование отменено!');
            // Перезагружаем календарь и модальное окно
            await loadCalendar();
            await openDayModal(dateStr);
        } else {
            alert(`❌ Ошибка: ${data.error || 'Не удалось отменить бронирование'}`);
        }
    } catch (error) {
        console.error('Ошибка при отмене бронирования:', error);
        alert('❌ Ошибка при отмене бронирования. Попробуйте позже.');
    }
}

// Закрытие модального окна
function closeModal() {
    document.getElementById('day-modal').classList.remove('show');
}

// Закрытие модального окна при клике вне его
window.addEventListener('click', (e) => {
    const modal = document.getElementById('day-modal');
    if (e.target === modal) {
        closeModal();
    }
});

// Установка обработчиков событий
function setupEventListeners() {
    // Навигация по месяцам
    document.getElementById('prev-month-btn').addEventListener('click', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Не даем перейти на прошедшие месяцы
        const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
        if (prevMonth >= new Date(today.getFullYear(), today.getMonth(), 1)) {
            currentMonth = prevMonth;
            loadCalendar();
        }
    });

    document.getElementById('next-month-btn').addEventListener('click', () => {
        const today = new Date();
        const twoMonthsLater = new Date(today.getFullYear(), today.getMonth() + 2, 1);
        
        // Не даем перейти дальше 2 месяцев вперед
        const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
        if (nextMonth < twoMonthsLater) {
            currentMonth = nextMonth;
            loadCalendar();
        }
    });

    // Закрытие модального окна по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

