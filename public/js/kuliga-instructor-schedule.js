// Управление расписанием инструктора Кулиги

// Функции для показа уведомлений (аналогично showSuccess из admin.js)
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
        max-width: 90%;
        max-width: min(500px, calc(100vw - 40px));
        font-weight: 500;
        opacity: 0;
        transform: translateY(-20px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        word-wrap: break-word;
        line-height: 1.5;
    `;
    
    // Поддержка HTML в сообщении (для многострочных ошибок)
    if (message.includes('<br/>') || message.includes('<strong>')) {
        errorDiv.innerHTML = '❌ ' + message;
    } else {
        errorDiv.textContent = '❌ ' + message;
    }
    
    // Добавить на страницу
    document.body.appendChild(errorDiv);
    
    // Анимация появления
    setTimeout(() => {
        errorDiv.style.opacity = '1';
        errorDiv.style.transform = 'translateY(0)';
    }, 10);
    
    // Автоматическое удаление через 8 секунд (чтобы пользователь успел прочитать)
    setTimeout(() => {
        errorDiv.style.opacity = '0';
        errorDiv.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 300);
    }, 8000);
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'alert alert-success';
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 300px;
        max-width: 90%;
        max-width: min(500px, calc(100vw - 40px));
        font-weight: 500;
        opacity: 0;
        transform: translateY(-20px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        word-wrap: break-word;
    `;
    successDiv.textContent = '✅ ' + message;
    
    // Добавить на страницу
    document.body.appendChild(successDiv);
    
    // Анимация появления
    setTimeout(() => {
        successDiv.style.opacity = '1';
        successDiv.style.transform = 'translateY(0)';
    }, 10);
    
    // Автоматическое удаление через 5 секунд
    setTimeout(() => {
        successDiv.style.opacity = '0';
        successDiv.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 300);
    }, 5000);
}

// Функции для работы с cookies
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

// Получение токена из cookie
function getToken() {
    return getCookie('kuligaInstructorToken');
}

// Проверка авторизации при загрузке страницы
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

// Загрузка информации об инструкторе
async function loadInstructorInfo() {
    const instructorData = localStorage.getItem('kuligaInstructorData');
    if (!instructorData) {
        return;
    }

    try {
        const instructor = JSON.parse(instructorData);
        document.getElementById('instructor-name').textContent = instructor.fullName;
        
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Лыжи и сноуборд'
        };
        
        document.getElementById('instructor-details').textContent = 
            `Вид спорта: ${sportTypeMapping[instructor.sportType] || instructor.sportType} • Телефон: ${instructor.phone}`;
    } catch (error) {
        console.error('Ошибка загрузки данных инструктора:', error);
    }
}

// Загрузка статистики
async function loadStats() {
    const token = getToken();
    if (!token) return;

    try {
        const today = new Date().toISOString().split('T')[0];
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        const endDateStr = endDate.toISOString().split('T')[0];

        const response = await fetch(`/api/kuliga/instructor/slots?start_date=${today}&end_date=${endDateStr}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки статистики');
        }

        const slots = await response.json();
        
        const totalSlots = slots.length;
        const availableSlots = slots.filter(s => s.status === 'available').length;
        const bookedSlots = slots.filter(s => s.status === 'booked').length;

        document.getElementById('stat-total-slots').textContent = totalSlots;
        document.getElementById('stat-available-slots').textContent = availableSlots;
        document.getElementById('stat-booked-slots').textContent = bookedSlots;
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

// Вспомогательная функция для проверки минимального времени (10:15)
function isValidMinTime(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    const minMinutes = 10 * 60 + 15; // 10:15
    return totalMinutes >= minMinutes;
}

// Вспомогательная функция для вычисления разницы между временами в минутах
function getTimeDifferenceInMinutes(time1, time2) {
    const [h1, m1] = time1.split(':').map(Number);
    const [h2, m2] = time2.split(':').map(Number);
    const minutes1 = h1 * 60 + m1;
    const minutes2 = h2 * 60 + m2;
    return Math.abs(minutes2 - minutes1);
}

// Вспомогательная функция для проверки минимального интервала между слотами (1.5 часа = 90 минут)
// Учитывает, что слот длится 1 час: если слот начинается в 10:00 (заканчивается в 11:00),
// следующий должен начинаться не раньше 11:30 (10:00 + 1 час тренировки + 30 минут перерыва)
function checkMinimumInterval(times) {
    // Сортируем времена
    const sortedTimes = [...times].sort();
    
    for (let i = 0; i < sortedTimes.length - 1; i++) {
        const [h1, m1] = sortedTimes[i].split(':').map(Number);
        const [h2, m2] = sortedTimes[i + 1].split(':').map(Number);
        
        // Время начала первого слота в минутах
        const start1 = h1 * 60 + m1;
        // Время окончания первого слота (длится 1 час) в минутах
        const end1 = start1 + 60;
        // Время начала второго слота в минутах
        const start2 = h2 * 60 + m2;
        
        // Разница между окончанием первого и началом второго (перерыв)
        const breakTime = start2 - end1;
        
        // Минимальный перерыв должен быть 30 минут (1.5 часа интервал - 1 час тренировки = 30 минут)
        if (breakTime < 30) {
            return {
                valid: false,
                error: `Минимальный интервал между слотами - 1.5 часа. Между ${sortedTimes[i]} и ${sortedTimes[i + 1]} недостаточно времени (нужно минимум 30 минут перерыва после окончания предыдущей тренировки).`
            };
        }
    }
    
    return { valid: true };
}

// Создание слотов на дату
async function createSlotsForDay() {
    const token = getToken();
    if (!token) return;

    const date = document.getElementById('day-date').value;
    const timesInput = document.getElementById('day-times').value;
    const resultDiv = document.getElementById('day-result');

    if (!date || !timesInput) {
        showError('Заполните дату и время');
        return;
    }

    // Парсим временные слоты
    const times = timesInput.split(',').map(t => t.trim()).filter(t => t);
    
    if (times.length === 0) {
        showError('Введите хотя бы один временной слот');
        return;
    }

    // Валидация формата времени и минимального времени (10:15)
    const invalidTimes = [];
    const tooEarlyTimes = [];
    const validTimes = [];
    
    for (const time of times) {
        // Проверяем формат времени (HH:MM)
        if (!/^\d{2}:\d{2}$/.test(time)) {
            invalidTimes.push(time);
            continue;
        }

        // Проверяем, что время не раньше 10:15
        if (!isValidMinTime(time)) {
            tooEarlyTimes.push(time);
            continue;
        }

        validTimes.push(time);
    }

    // Формируем детальное сообщение об ошибках
    const errorMessages = [];
    
    if (invalidTimes.length > 0) {
        errorMessages.push(`Неверный формат времени (требуется HH:MM): ${invalidTimes.join(', ')}`);
    }
    
    if (tooEarlyTimes.length > 0) {
        errorMessages.push(`Время слишком рано (первая тренировка начинается не раньше 10:15): ${tooEarlyTimes.join(', ')}`);
    }

    if (errorMessages.length > 0) {
        showError(`<strong>Ошибка валидации:</strong><br/>${errorMessages.join('<br/>')}`);
        return;
    }

    if (validTimes.length === 0) {
        showError('<strong>Ошибка валидации:</strong><br/>Не найдено ни одного валидного времени. Проверьте формат (HH:MM) и убедитесь, что время не раньше 10:15.');
        return;
    }

    // Проверяем минимальный интервал между слотами (1.5 часа)
    const intervalCheck = checkMinimumInterval(validTimes);
    if (!intervalCheck.valid) {
        showError(`<strong>Ошибка интервала между слотами:</strong><br/>${intervalCheck.error}`);
        return;
    }

    try {
        const response = await fetch('/api/kuliga/instructor/slots/create', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date,
                times: validTimes
            })
        });

        const result = await response.json();

        if (!response.ok) {
            // Детализируем ошибку от сервера
            const errorMessage = result.error || 'Ошибка создания слотов';
            throw new Error(errorMessage);
        }

        showSuccess(`Создано слотов: ${result.created}`);
        
        // Очищаем поле ввода временных слотов
        document.getElementById('day-times').value = '';
        
        // Обновляем статистику
        await loadStats();
        
        // Если показаны слоты на эту дату, обновляем их
        const selectedDate = document.getElementById('selected-date').textContent;
        if (selectedDate === date) {
            await loadSlotsForDay();
        }
    } catch (error) {
        console.error('Ошибка создания слотов:', error);
        // Показываем детальное сообщение об ошибке
        showError(`<strong>Ошибка создания слотов:</strong><br/>${error.message}`);
    }
}

// Загрузка слотов на дату
async function loadSlotsForDay() {
    const token = getToken();
    if (!token) return;

    const date = document.getElementById('day-date').value;
    const resultDiv = document.getElementById('day-result');
    const slotsSection = document.getElementById('slots-section');
    const slotsContainer = document.getElementById('day-slots');

    if (!date) {
        showError('Выберите дату');
        return;
    }

    try {
        const response = await fetch(`/api/kuliga/instructor/slots?date=${date}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки слотов');
        }

        const slots = await response.json();
        
        document.getElementById('selected-date').textContent = date;
        slotsSection.style.display = 'block';

        if (slots.length === 0) {
            slotsContainer.innerHTML = '<div class="alert alert-info">Нет слотов на эту дату</div>';
            return;
        }

        // Сортируем слоты по времени
        slots.sort((a, b) => a.start_time.localeCompare(b.start_time));

        // Функция для форматирования времени из формата HH:MM:SS в HH:MM
        const formatTime = (timeStr) => {
            if (!timeStr) return '';
            // Если время в формате HH:MM:SS, берем только HH:MM
            if (timeStr.includes(':')) {
                const parts = timeStr.split(':');
                return `${parts[0]}:${parts[1]}`;
            }
            return timeStr;
        };

        // Отображаем слоты
        slotsContainer.innerHTML = slots.map(slot => {
            const statusText = {
                'available': 'Свободен',
                'booked': 'Забронирован',
                'blocked': 'Заблокирован',
                'group': 'Групповая тренировка'
            }[slot.status] || slot.status;

            const canDelete = slot.status === 'available' || slot.status === 'blocked';

            const startTime = formatTime(slot.start_time);
            const endTime = formatTime(slot.end_time);

            return `
                <div class="schedule-slot ${slot.status}">
                    <div class="slot-info">
                        <div class="slot-time">${startTime} - ${endTime}</div>
                        <div class="slot-status">${statusText}</div>
                    </div>
                    <div class="slot-actions">
                        ${slot.status === 'available' ? 
                            `<button class="btn-secondary" onclick="toggleSlotStatus(${slot.id}, 'blocked')">Заблокировать</button>` : ''}
                        ${slot.status === 'blocked' ? 
                            `<button class="btn-primary" onclick="toggleSlotStatus(${slot.id}, 'available')">Разблокировать</button>` : ''}
                        ${canDelete ? 
                            `<button class="btn-danger" onclick="deleteSlot(${slot.id})">Удалить</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        resultDiv.innerHTML = '';
    } catch (error) {
        console.error('Ошибка загрузки слотов:', error);
        showError(`Ошибка загрузки слотов: ${error.message}`);
    }
}

// Изменение статуса слота
async function toggleSlotStatus(slotId, newStatus) {
    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch(`/api/kuliga/instructor/slots/${slotId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка изменения статуса');
        }

        // Перезагружаем слоты
        await loadSlotsForDay();
        await loadStats();
    } catch (error) {
        console.error('Ошибка изменения статуса слота:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Удаление слота
async function deleteSlot(slotId) {
    if (!confirm('Вы уверены, что хотите удалить этот слот?')) {
        return;
    }

    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch(`/api/kuliga/instructor/slots/${slotId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка удаления слота');
        }

        // Перезагружаем слоты
        await loadSlotsForDay();
        await loadStats();
    } catch (error) {
        console.error('Ошибка удаления слота:', error);
        showError(`Ошибка удаления слота: ${error.message}`);
    }
}

// Массовое создание слотов
async function createBulkSlots() {
    const token = getToken();
    if (!token) return;

    const fromDate = document.getElementById('bulk-from').value;
    const toDate = document.getElementById('bulk-to').value;
    const timesInput = document.getElementById('bulk-times').value;
    const resultDiv = document.getElementById('bulk-result');

    // Получаем выбранные дни недели
    const weekdaysCheckboxes = document.querySelectorAll('.weekday:checked');
    const weekdays = Array.from(weekdaysCheckboxes).map(cb => parseInt(cb.value));

    if (!fromDate || !toDate || !timesInput || weekdays.length === 0) {
        showError('Заполните все поля');
        return;
    }

    // Парсим временные слоты
    const times = timesInput.split(',').map(t => t.trim()).filter(t => t);
    
    if (times.length === 0) {
        showError('Введите хотя бы один временной слот');
        return;
    }

    // Валидация формата времени и минимального времени (10:15)
    const invalidTimes = [];
    const tooEarlyTimes = [];
    const validTimes = [];
    
    for (const time of times) {
        // Проверяем формат времени (HH:MM)
        if (!/^\d{2}:\d{2}$/.test(time)) {
            invalidTimes.push(time);
            continue;
        }

        // Проверяем, что время не раньше 10:15
        if (!isValidMinTime(time)) {
            tooEarlyTimes.push(time);
            continue;
        }

        validTimes.push(time);
    }

    // Формируем детальное сообщение об ошибках
    const errorMessages = [];
    
    if (invalidTimes.length > 0) {
        errorMessages.push(`Неверный формат времени (требуется HH:MM): ${invalidTimes.join(', ')}`);
    }
    
    if (tooEarlyTimes.length > 0) {
        errorMessages.push(`Время слишком рано (первая тренировка начинается не раньше 10:15): ${tooEarlyTimes.join(', ')}`);
    }

    if (errorMessages.length > 0) {
        showError(`<strong>Ошибка валидации:</strong><br/>${errorMessages.join('<br/>')}`);
        return;
    }

    if (validTimes.length === 0) {
        showError('<strong>Ошибка валидации:</strong><br/>Не найдено ни одного валидного времени. Проверьте формат (HH:MM) и убедитесь, что время не раньше 10:15.');
        return;
    }

    // Проверяем минимальный интервал между слотами (1.5 часа)
    const intervalCheck = checkMinimumInterval(validTimes);
    if (!intervalCheck.valid) {
        showError(`<strong>Ошибка интервала между слотами:</strong><br/>${intervalCheck.error}`);
        return;
    }

    try {
        // Показываем информационное сообщение о процессе
        const infoDiv = document.createElement('div');
        infoDiv.className = 'alert alert-info';
        infoDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #17a2b8;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            min-width: 300px;
            max-width: min(500px, calc(100vw - 40px));
            font-weight: 500;
        `;
        infoDiv.textContent = '⏳ Создание слотов... Пожалуйста, подождите.';
        document.body.appendChild(infoDiv);
        
        // Удалим информационное сообщение после завершения
        const removeInfo = () => {
            if (infoDiv.parentNode) {
                infoDiv.remove();
            }
        };

        const response = await fetch('/api/kuliga/instructor/slots/create-bulk', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromDate,
                toDate,
                weekdays,
                times: validTimes
            })
        });

        const result = await response.json();

        if (!response.ok) {
            // Детализируем ошибку от сервера
            const errorMessage = result.error || 'Ошибка массового создания слотов';
            throw new Error(errorMessage);
        }

        removeInfo();
        showSuccess(`Создано слотов: ${result.created}`);
        
        // Очищаем поле ввода временных слотов
        document.getElementById('bulk-times').value = '';
        
        // Обновляем статистику
        await loadStats();
    } catch (error) {
        removeInfo();
        console.error('Ошибка массового создания слотов:', error);
        // Показываем детальное сообщение об ошибке
        showError(`<strong>Ошибка массового создания слотов:</strong><br/>${error.message}`);
    }
}

// Выход из системы
function logout() {
    deleteCookie('kuligaInstructorToken');
    localStorage.removeItem('kuligaInstructorData');
    window.location.href = '/kuliga-instructor-login.html';
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    const instructorId = await checkAuth();
    if (!instructorId) return;

    await loadInstructorInfo();
    await loadStats();

    // Устанавливаем сегодняшнюю дату по умолчанию
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('day-date').value = today;
    document.getElementById('bulk-from').value = today;
    
    // Устанавливаем дату +30 дней для массового создания
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    document.getElementById('bulk-to').value = endDate.toISOString().split('T')[0];

    // Обработчики событий
    document.getElementById('create-slots-btn').addEventListener('click', createSlotsForDay);
    document.getElementById('load-slots-btn').addEventListener('click', loadSlotsForDay);
    document.getElementById('create-bulk-btn').addEventListener('click', createBulkSlots);
    document.getElementById('logout-btn').addEventListener('click', logout);
});

// Глобальные функции (вызываются из inline onclick)
window.toggleSlotStatus = toggleSlotStatus;
window.deleteSlot = deleteSlot;

