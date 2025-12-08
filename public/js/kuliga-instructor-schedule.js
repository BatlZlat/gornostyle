// Управление расписанием инструктора Кулиги

// Глобальные переменные
let instructorData = null; // Полные данные инструктора (sport_type, admin_percentage)
let pricesData = null; // Данные прайса

function formatCurrency(amount) {
    const value = parseFloat(amount || 0);
    return isNaN(value) ? '0.00' : value.toFixed(2);
}

function getAdminPercentageValue() {
    const value = parseFloat(instructorData?.admin_percentage);
    return isNaN(value) ? 0 : value;
}

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
        window.location.href = '/winter-instructor-login.html';
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
        window.location.href = '/winter-instructor-login.html';
        return null;
    }
}

// Загрузка информации об инструкторе
async function loadInstructorInfo() {
    const token = getToken();
    if (!token) {
        return;
    }

    try {
        // Сначала загружаем актуальные данные из API
        let instructor = null;
        try {
            const response = await fetch('/api/kuliga/instructor/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const apiData = await response.json();
                // Преобразуем данные из API в формат, совместимый с localStorage
                instructor = {
                    id: apiData.id,
                    fullName: apiData.full_name,
                    sportType: apiData.sport_type,
                    phone: apiData.phone,
                    email: apiData.email,
                    location: apiData.location // Актуальное значение location из БД
                };
                // Обновляем localStorage актуальными данными
                localStorage.setItem('kuligaInstructorData', JSON.stringify(instructor));
                console.log('✅ Актуальные данные инструктора загружены из API, location:', instructor.location);
            } else {
                throw new Error('Не удалось загрузить данные из API');
            }
        } catch (apiError) {
            console.warn('⚠️ Не удалось загрузить данные из API, используем данные из localStorage:', apiError);
            // Fallback: используем данные из localStorage
            const instructorData = localStorage.getItem('kuligaInstructorData');
            if (instructorData) {
                instructor = JSON.parse(instructorData);
            } else {
                return;
            }
        }

        if (!instructor) {
            return;
        }
        
        // Формируем название места работы для отображения
        const locationDisplayName = instructor.location === 'vorona' 
            ? 'Воронинские горки' 
            : (instructor.location === 'kuliga' || !instructor.location) 
                ? 'Кулига' 
                : instructor.location;
        
        // Обновляем заголовок страницы на основе места работы
        const pageTitleElement = document.getElementById('page-title');
        if (pageTitleElement) {
            if (instructor.location === 'vorona') {
                pageTitleElement.textContent = '🏔️ Личный кабинет инструктора (Воронинские горки)';
            } else {
                pageTitleElement.textContent = '🏔️ Личный кабинет инструктора (Кулига)';
            }
        }
        
        // Обновляем title страницы
        if (instructor.location === 'vorona') {
            document.title = 'Личный кабинет инструктора - Воронинские горки';
        } else {
            document.title = 'Личный кабинет инструктора - Кулига';
        }
        
        // Отображаем имя инструктора с местом работы в скобках
        document.getElementById('instructor-name').textContent = `${instructor.fullName} (${locationDisplayName})`;
        
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Лыжи и сноуборд'
        };
        
        document.getElementById('instructor-details').textContent = 
            `Вид спорта: ${sportTypeMapping[instructor.sportType] || instructor.sportType} • Телефон: ${instructor.phone}`;
        
        // Получаем имя бота из API и формируем Deep Link
        if (token) {
            try {
                const botInfoResponse = await fetch('/api/kuliga/instructor/bot-info', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (botInfoResponse.ok) {
                    const botInfo = await botInfoResponse.json();
                    // Нормализуем username: убираем @ и приводим к нижнему регистру
                    let botUsername = botInfo.botUsername || 'gornostyle72_Instructor_bot';
                    botUsername = botUsername.replace(/^@/, '').trim().toLowerCase();
                    const deepLink = `https://t.me/${botUsername}?start=instructor_${instructor.id}`;
                    const telegramBotLink = document.getElementById('telegram-bot-link');
                    if (telegramBotLink) {
                        telegramBotLink.href = deepLink;
                    }
                }
            } catch (error) {
                console.error('Ошибка при получении информации о боте:', error);
                // Используем fallback значение
                const deepLink = `https://t.me/gornostyle72_Instructor_bot?start=instructor_${instructor.id}`;
                const telegramBotLink = document.getElementById('telegram-bot-link');
                if (telegramBotLink) {
                    telegramBotLink.href = deepLink;
                }
            }
        }
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
        
        // Обновляем статистику и расписание
        await loadStats();
        await loadSchedule();
        
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
        
        // Форматируем дату в формат д.м.г. (день недели)
        const dateObj = new Date(date + 'T00:00:00');
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        const formattedDate = `${day}.${month}.${year} (${dayOfWeek})`;
        
        document.getElementById('selected-date').textContent = formattedDate;
        slotsSection.style.display = 'block';

        if (slots.length === 0) {
            slotsContainer.innerHTML = '<div class="alert alert-info">Нет расписания на эту дату</div>';
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
                            `<button class="btn-primary" onclick="openGroupTrainingModal(${slot.id})" style="background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600; margin-right: 5px;">👥 Создать групповую тренировку</button>
                             <button class="btn-secondary" onclick="toggleSlotStatus(${slot.id}, 'blocked')">Заблокировать</button>` : ''}
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
    if (!token) {
        console.error('Токен не найден');
        showError('Ошибка: Требуется авторизация');
        return;
    }

    console.log(`🔄 Изменение статуса слота ${slotId} на ${newStatus}`);

    try {
        const response = await fetch(`/api/kuliga/instructor/slots/${slotId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Ошибка API:', data);
            throw new Error(data.error || 'Ошибка изменения статуса');
        }

        console.log(`✅ Статус слота ${slotId} успешно изменен на ${newStatus}`);

        // Перезагружаем слоты, расписание и статистику
        await Promise.all([
            loadSlotsForDay(),
            loadSchedule(),
            loadStats()
        ]);
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

        // Показываем сообщение об успехе
        showSuccess('Слот успешно удален');
        
        // Перезагружаем слоты, расписание и статистику
        await loadSlotsForDay();
        await loadSchedule();
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
        
        // Обновляем статистику и расписание
        await loadStats();
        await loadSchedule();
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
    window.location.href = '/winter-instructor-login.html';
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
    document.getElementById('delete-from').value = today;
    
    // Устанавливаем дату +30 дней для массового создания и удаления
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    document.getElementById('bulk-to').value = endDate.toISOString().split('T')[0];
    document.getElementById('delete-to').value = endDate.toISOString().split('T')[0];
    document.getElementById('delete-trainings-from').value = today;
    document.getElementById('delete-trainings-to').value = endDate.toISOString().split('T')[0];

    // Обработчики событий
    document.getElementById('create-slots-btn').addEventListener('click', createSlotsForDay);
    document.getElementById('load-slots-btn').addEventListener('click', loadSlotsForDay);
    document.getElementById('create-bulk-btn').addEventListener('click', createBulkSlots);
    document.getElementById('delete-bulk-btn').addEventListener('click', deleteBulkSlots);
    document.getElementById('create-regular-training-btn').addEventListener('click', createRegularGroupTrainings);
    document.getElementById('delete-trainings-btn').addEventListener('click', deleteBulkGroupTrainings);
    document.getElementById('logout-btn').addEventListener('click', logout);
    
    // Загружаем полную информацию об инструкторе и прайс
    await loadFullInstructorInfo();
    await loadPrices();
    
    // Инициализируем форму регулярных тренировок после загрузки данных
    // (расчет цены будет вызван внутри initRegularTrainingForm после установки значения по умолчанию)
    initRegularTrainingForm();
    
    // Загружаем расписание (слоты + групповые тренировки)
    await loadSchedule();
    
    // Обработчик формы создания групповой тренировки
    const groupTrainingForm = document.getElementById('group-training-form');
    if (groupTrainingForm) {
        groupTrainingForm.addEventListener('submit', createGroupTraining);
        
        // Обработчики изменения количества участников для расчета цены
        const maxParticipantsInput = document.getElementById('gt-max-participants');
        const minParticipantsInput = document.getElementById('gt-min-participants');
        
        if (maxParticipantsInput) {
            maxParticipantsInput.addEventListener('input', calculatePrice);
        }
        if (minParticipantsInput) {
            minParticipantsInput.addEventListener('input', () => {
                const min = parseInt(minParticipantsInput.value) || 0;
                const max = parseInt(maxParticipantsInput?.value) || 0;
                if (min > max && max > 0) {
                    maxParticipantsInput.value = min;
                }
                calculatePrice();
            });
        }
    }
    
    // Закрытие модального окна только по кнопке "Отмена"
    // Убрали закрытие по клику вне окна для удобства заполнения формы
});

// Открытие модального окна для создания групповой тренировки
function openGroupTrainingModal(slotId) {
    const modal = document.getElementById('group-training-modal');
    const slotIdInput = document.getElementById('gt-slot-id');
    slotIdInput.value = slotId;
    
    // Очищаем форму
    const form = document.getElementById('group-training-form');
    form.reset();
    slotIdInput.value = slotId;
    
    // Заполняем вид спорта в зависимости от возможностей инструктора
    const sportTypeSelect = document.getElementById('gt-sport-type');
    sportTypeSelect.innerHTML = '<option value="">Выберите вид спорта</option>';
    
    if (instructorData) {
        if (instructorData.sport_type === 'both') {
            sportTypeSelect.innerHTML += '<option value="ski">⛷️ Горные лыжи</option>';
            sportTypeSelect.innerHTML += '<option value="snowboard">🏂 Сноуборд</option>';
        } else if (instructorData.sport_type === 'ski') {
            sportTypeSelect.innerHTML += '<option value="ski">⛷️ Горные лыжи</option>';
        } else if (instructorData.sport_type === 'snowboard') {
            sportTypeSelect.innerHTML += '<option value="snowboard">🏂 Сноуборд</option>';
        }
    }
    
    // Заполняем уровни от 1 до 10
    const levelSelect = document.getElementById('gt-level');
    levelSelect.innerHTML = '<option value="">Выберите уровень</option>';
    for (let i = 1; i <= 10; i++) {
        levelSelect.innerHTML += `<option value="${i}">${i} уровень</option>`;
    }
    
    // Устанавливаем значение по умолчанию 4 участника и сразу делаем расчет
    const maxParticipantsInput = document.getElementById('gt-max-participants');
    if (maxParticipantsInput) {
        maxParticipantsInput.value = 4;
        // Вызываем расчет цены сразу
        calculatePrice();
    }
    
    modal.style.display = 'flex';
}

// Закрытие модального окна
function closeGroupTrainingModal() {
    const modal = document.getElementById('group-training-modal');
    modal.style.display = 'none';
}

// Расчет цены групповой тренировки
function calculatePrice() {
    const maxParticipants = parseInt(document.getElementById('gt-max-participants')?.value) || 0;
    const priceInfo = document.getElementById('price-info');
    
    if (!priceInfo) return;
    
    if (!maxParticipants || !pricesData || pricesData.length === 0) {
        priceInfo.innerHTML = 'Выберите максимум участников для расчета';
        return;
    }
    
    // Ищем цену в прайсе для групповых тренировок
    // Для групповых тренировок инструктора используем type='group' с participants=maxParticipants
    // В прайсе type='group' означает общую цену группы, делим на количество для получения цены за человека
    const groupPrice = pricesData.find(p => 
        p.type === 'group' && 
        parseInt(p.participants) === maxParticipants &&
        parseInt(p.duration) === 60
    );
    
    if (!groupPrice) {
        priceInfo.innerHTML = `⚠️ Цена для ${maxParticipants} участников не найдена в прайсе`;
        return;
    }
    
    // Для типа 'group' цена - это общая стоимость группы
    const totalPrice = parseFloat(groupPrice.price);
    const pricePerPerson = totalPrice / maxParticipants;
    
    const adminPercentage = instructorData?.admin_percentage || 20;
    const instructorEarnings = totalPrice * (1 - adminPercentage / 100);
    const instructorPerPerson = instructorEarnings / maxParticipants;
    
    priceInfo.innerHTML = `
        <div style="margin-top: 5px;">
            <div><strong>Цена за участника:</strong> ${pricePerPerson.toFixed(2)} ₽</div>
            <div><strong>Ваш заработок за участника:</strong> ${instructorPerPerson.toFixed(2)} ₽</div>
            <div><strong>Ваш общий заработок при полном заполнении:</strong> ${instructorEarnings.toFixed(2)} ₽</div>
        </div>
    `;
}

// Создание групповой тренировки из слота
async function createGroupTraining(event) {
    event.preventDefault();
    
    const token = getToken();
    if (!token) return;
    
    const slotId = document.getElementById('gt-slot-id').value;
    const sportType = document.getElementById('gt-sport-type').value;
    const level = document.getElementById('gt-level').value;
    const description = document.getElementById('gt-description').value;
    const minParticipants = parseInt(document.getElementById('gt-min-participants').value, 10);
    const maxParticipants = parseInt(document.getElementById('gt-max-participants').value, 10);
    
    // Валидация
    if (!slotId || !sportType || !level || !maxParticipants) {
        showError('Заполните все обязательные поля');
        return;
    }
    
    if (minParticipants > maxParticipants) {
        showError('Минимум участников не может быть больше максимума');
        return;
    }
    
    // Получаем цену из прайса
    // Для групповых тренировок инструктора используем type='group' с participants=maxParticipants
    // В прайсе type='group' означает общую цену группы, делим на количество для получения цены за человека
    const groupPrice = pricesData?.find(p => 
        p.type === 'group' && 
        parseInt(p.participants) === maxParticipants &&
        parseInt(p.duration) === 60
    );
    
    if (!groupPrice) {
        showError(`Цена для ${maxParticipants} участников не найдена в прайсе`);
        return;
    }
    
    // Для типа 'group' цена - это общая стоимость группы, делим на количество участников
    const totalPrice = parseFloat(groupPrice.price);
    const pricePerPerson = totalPrice / maxParticipants;
    
    try {
        const response = await fetch('/api/kuliga/instructor/group-trainings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                slot_id: parseInt(slotId, 10),
                sport_type: sportType,
                level: level.toString(), // Сохраняем как строку
                description: description || null,
                price_per_person: pricePerPerson,
                min_participants: minParticipants,
                max_participants: maxParticipants
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка создания групповой тренировки');
        }
        
        showSuccess('Групповая тренировка успешно создана');
        closeGroupTrainingModal();
        
        // Перезагружаем расписание и статистику
        await loadSchedule();
        await loadStats();
    } catch (error) {
        console.error('Ошибка создания групповой тренировки:', error);
        showError(`Ошибка создания групповой тренировки: ${error.message}`);
    }
}

// Массовое удаление слотов
async function deleteBulkSlots() {
    const token = getToken();
    if (!token) return;

    const fromDate = document.getElementById('delete-from').value;
    const toDate = document.getElementById('delete-to').value;

    // Получаем выбранные дни недели
    const weekdaysCheckboxes = document.querySelectorAll('.delete-weekday:checked');
    const weekdays = Array.from(weekdaysCheckboxes).map(cb => parseInt(cb.value));

    if (!fromDate || !toDate) {
        showError('Укажите диапазон дат для удаления');
        return;
    }

    const confirmMessage = weekdays.length > 0
        ? `Вы уверены, что хотите удалить все свободные и заблокированные слоты с ${fromDate} по ${toDate} в выбранные дни недели?`
        : `Вы уверены, что хотите удалить все свободные и заблокированные слоты с ${fromDate} по ${toDate}?`;

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        const response = await fetch('/api/kuliga/instructor/slots/delete-bulk', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromDate,
                toDate,
                weekdays: weekdays.length > 0 ? weekdays : null
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка удаления слотов');
        }

        showSuccess(`Удалено слотов: ${result.deleted}`);
        
        // Обновляем статистику, расписание и слоты на выбранную дату
        await loadStats();
        await loadSchedule();
        
        // Если показаны слоты на дату из диапазона, обновляем их
        const selectedDate = document.getElementById('selected-date').textContent;
        if (selectedDate) {
            const selectedDateISO = selectedDate.split('.').reverse().join('-').split(' ')[0];
            if (selectedDateISO >= fromDate && selectedDateISO <= toDate) {
                await loadSlotsForDay();
            }
        }
    } catch (error) {
        console.error('Ошибка удаления слотов:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Загрузка полной информации об инструкторе
async function loadFullInstructorInfo() {
    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch('/api/kuliga/instructor/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            instructorData = await response.json();
            console.log('Данные инструктора загружены:', instructorData);
        }
    } catch (error) {
        console.error('Ошибка загрузки информации об инструкторе:', error);
    }
}

// Загрузка прайса
async function loadPrices() {
    try {
        const response = await fetch('/api/kuliga/prices');

        if (response.ok) {
            const result = await response.json();
            // Проверяем разные форматы ответа
            if (Array.isArray(result)) {
                pricesData = result;
            } else if (result.data && Array.isArray(result.data)) {
                pricesData = result.data;
            } else if (result.prices && Array.isArray(result.prices)) {
                pricesData = result.prices;
            } else {
                pricesData = [];
            }
            console.log('Прайс загружен:', pricesData);
        }
    } catch (error) {
        console.error('Ошибка загрузки прайса:', error);
        pricesData = [];
    }
}

// Загрузка расписания (слоты + групповые тренировки)
async function loadSchedule() {
    const container = document.getElementById('schedule-list');
    if (!container) return;

    const token = getToken();
    if (!token) return;

    try {
        // Загружаем слоты и групповые тренировки на 2 недели вперед
        // ВАЖНО: Используем текущую дату в часовом поясе Екатеринбурга
        // Получаем текущую дату в формате YYYY-MM-DD (локальная дата без учета времени)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const today = `${year}-${month}-${day}`;
        
        // Добавляем 14 дней для конечной даты
        const endDateObj = new Date(now);
        endDateObj.setDate(endDateObj.getDate() + 14);
        const endYear = endDateObj.getFullYear();
        const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
        const endDay = String(endDateObj.getDate()).padStart(2, '0');
        const endDateStr = `${endYear}-${endMonth}-${endDay}`;
        
        console.log(`📅 Загрузка расписания: сегодня=${today}, конец=${endDateStr} (2 недели вперед)`);

        const [slotsResponse, trainingsResponse] = await Promise.all([
            fetch(`/api/kuliga/instructor/slots?start_date=${today}&end_date=${endDateStr}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/kuliga/instructor/group-trainings?start_date=${today}&end_date=${endDateStr}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
        ]);

        if (!slotsResponse.ok || !trainingsResponse.ok) {
            throw new Error('Ошибка загрузки расписания');
        }

        const slots = await slotsResponse.json();
        const trainings = await trainingsResponse.json();

        console.log('📅 Загружено слотов:', slots.length);
        console.log('📅 Загружено тренировок:', trainings.length);
        console.log('📅 Слоты:', slots);
        console.log('📅 Тренировки:', trainings);

        // Группируем по датам
        const scheduleByDate = {};
        
        slots.forEach(slot => {
            // Нормализуем дату (может быть в формате YYYY-MM-DD или объект Date)
            let dateKey = slot.date;
            if (typeof dateKey === 'object' && dateKey !== null) {
                dateKey = dateKey.toISOString().split('T')[0];
            } else if (typeof dateKey === 'string' && dateKey.includes('T')) {
                dateKey = dateKey.split('T')[0];
            }
            
            if (!scheduleByDate[dateKey]) {
                scheduleByDate[dateKey] = { slots: [], trainings: [] };
            }
            scheduleByDate[dateKey].slots.push(slot);
        });

        trainings.forEach(training => {
            // Нормализуем дату
            let dateKey = training.date;
            if (typeof dateKey === 'object' && dateKey !== null) {
                dateKey = dateKey.toISOString().split('T')[0];
            } else if (typeof dateKey === 'string' && dateKey.includes('T')) {
                dateKey = dateKey.split('T')[0];
            }
            
            if (!scheduleByDate[dateKey]) {
                scheduleByDate[dateKey] = { slots: [], trainings: [] };
            }
            scheduleByDate[dateKey].trainings.push(training);
        });

        console.log('📅 Расписание по датам:', scheduleByDate);
        displaySchedule(scheduleByDate);
    } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
        container.innerHTML = '<div style="color: #666;">Ошибка загрузки расписания</div>';
    }
}

// Отображение расписания
function displaySchedule(scheduleByDate) {
    const container = document.getElementById('schedule-list');
    if (!container) return;

    const dates = Object.keys(scheduleByDate).sort();
    
    if (dates.length === 0) {
        container.innerHTML = '<div style="color: #666;">Расписание пусто</div>';
        return;
    }

    let html = '';
    dates.forEach(date => {
        const { slots, trainings } = scheduleByDate[date];
        const dateObj = new Date(date + 'T00:00:00');
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        const formattedDate = `${day}.${month}.${year} (${dayOfWeek})`;

        // Создаем карту слотов по ID для быстрого поиска
        const slotsMap = new Map();
        slots.forEach(slot => {
            slotsMap.set(slot.id, slot);
        });

        // Объединяем слоты и тренировки по времени
        // Если на слоте есть групповая тренировка - показываем только тренировку
        // Если на слоте нет тренировки - показываем слот
        const processedSlotIds = new Set();
        const allItems = [];

        // Сначала добавляем все тренировки и отмечаем их слоты
        trainings.forEach(training => {
            if (training.slot_id) {
                processedSlotIds.add(training.slot_id);
            }
            allItems.push({ ...training, type: 'training' });
        });

        // Добавляем слоты, на которых нет тренировок
        slots.forEach(slot => {
            // Не добавляем слот, если на нем есть групповая тренировка (она уже добавлена выше)
            // Проверяем как processedSlotIds (из тренировок), так и has_group_training (из API)
            // Также проверяем статус слота - если он blocked и есть тренировка, не показываем слот
            const hasTraining = processedSlotIds.has(slot.id) || slot.has_group_training || slot.status === 'group';
            
            console.log(`🔍 Слот ${slot.id} (${slot.date} ${slot.start_time}): hasTraining=${hasTraining}, processedSlotIds.has=${processedSlotIds.has(slot.id)}, has_group_training=${slot.has_group_training}, status=${slot.status}`);
            
            if (!hasTraining) {
                allItems.push({ ...slot, type: 'slot' });
                console.log(`  ✅ Добавлен слот ${slot.id} в allItems`);
            } else {
                console.log(`  ❌ Слот ${slot.id} пропущен из-за групповой тренировки`);
            }
        });

        // Сортируем по времени
        allItems.sort((a, b) => {
            const timeA = String(a.start_time).substring(0, 5);
            const timeB = String(b.start_time).substring(0, 5);
            return timeA.localeCompare(timeB);
        });
        
        console.log(`📅 Дата ${formattedDate}: слотов=${slots.length}, тренировок=${trainings.length}, allItems=${allItems.length}`);
        
        // Показываем заголовок и элементы только если есть что показывать
        if (allItems.length === 0) {
            console.log(`⚠️ Пропускаем дату ${formattedDate}: нет элементов для отображения`);
            return; // Пропускаем эту дату, если нет элементов
        }

        html += `<div style="margin-bottom: 30px;">`;
        html += `<h3 style="margin-bottom: 15px;">${formattedDate}</h3>`;

        allItems.forEach(item => {
            if (item.type === 'slot') {
                // Не показываем слот, если на нем есть групповая тренировка (она показывается отдельно)
                if (item.has_group_training) {
                    return; // Пропускаем этот слот
                }
                
                const statusText = {
                    'available': 'Свободен',
                    'booked': 'Забронирован',
                    'blocked': 'Заблокирован',
                    'group': 'Групповая тренировка'
                }[item.status] || item.status;
                const startTime = String(item.start_time).substring(0, 5);
                const endTime = String(item.end_time).substring(0, 5);
                
                // Проверяем, можно ли удалить слот (нет групповой тренировки и нет бронирований)
                const canDelete = item.status === 'available' || 
                                 (item.status === 'blocked' && !item.has_group_training);
                const canBlock = item.status === 'available';
                const canUnblock = item.status === 'blocked' && !item.has_group_training;
                
                console.log(`  🎨 Рендеринг слота ${item.id}: status=${item.status}, startTime=${startTime}, endTime=${endTime}`);
                html += `
                    <div class="schedule-slot ${item.status}" style="margin-bottom: 10px;">
                        <div class="slot-info">
                            <div class="slot-time">${startTime} - ${endTime}</div>
                            <div class="slot-status">${statusText}</div>
                        </div>
                        <div class="slot-actions">
                            ${item.status === 'available' ? 
                                `<button class="btn-primary" onclick="openGroupTrainingModal(${item.id})">👥 Создать групповую</button>
                                 <button class="btn-secondary" onclick="toggleSlotStatus(${item.id}, 'blocked')">Заблокировать</button>
                                 ${canDelete ? `<button class="btn-danger" onclick="deleteSlot(${item.id})">Удалить</button>` : ''}` : ''}
                            ${item.status === 'blocked' && canUnblock ? 
                                `<button class="btn-primary" onclick="toggleSlotStatus(${item.id}, 'available')">Разблокировать</button>
                                 ${canDelete ? `<button class="btn-danger" onclick="deleteSlot(${item.id})">Удалить</button>` : ''}` : ''}
                            ${item.status === 'blocked' && !canUnblock ? 
                                `<span style="color: #666; font-size: 0.9em;">На этом слоте групповая тренировка. Для управления обратитесь к администратору.</span>` : ''}
                            ${item.status === 'booked' ? 
                                `<button class="btn-primary" onclick="showSlotDetails(${item.id})">Подробнее</button>` : ''}
                        </div>
                    </div>
                `;
            } else {
                // Групповая тренировка
                const startTime = String(item.start_time).substring(0, 5);
                const endTime = String(item.end_time).substring(0, 5);
                const sportType = item.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                // Проверяем количество участников - более надежная проверка
                const currentParticipants = parseInt(item.current_participants) || 0;
                const hasParticipants = currentParticipants > 0;
                
                console.log(`🔍 Тренировка ${item.id}: current_participants=${item.current_participants}, parsed=${currentParticipants}, hasParticipants=${hasParticipants}`);
                
                html += `
                    <div class="schedule-slot booked" style="margin-bottom: 10px;">
                        <div class="slot-info">
                            <div class="slot-time">${startTime} - ${endTime}</div>
                            <div class="slot-status">👥 Групповая тренировка</div>
                            <div style="margin-top: 5px; color: #666;">
                                ${sportType} | Уровень: ${item.level} | 
                                Участников: ${currentParticipants}/${item.max_participants}
                            </div>
                        </div>
                        <div class="slot-actions">
                            <button class="btn-primary" onclick="showGroupTrainingDetails(${item.id})">Подробнее</button>
                            ${!hasParticipants ? `
                                <button class="btn-primary" onclick="editGroupTraining(${item.id})" title="Редактировать">✏️ Редактировать</button>
                                <button class="btn-danger" onclick="deleteGroupTraining(${item.id})" title="Удалить">🗑️ Удалить</button>
                            ` : `
                                <span style="color: #666; font-size: 0.9em;">Для редактирования или удаления обратитесь к администратору</span>
                            `}
                        </div>
                    </div>
                `;
            }
        });

        html += `</div>`;
    });
    
    // Если после обработки нет контента, показываем сообщение
    if (html.trim() === '') {
        html = '<div style="color: #666;">Расписание пусто</div>';
    }

    container.innerHTML = html;
}

// Загрузка списка групповых тренировок (старая функция, оставлена для совместимости)
async function loadGroupTrainings() {
    const token = getToken();
    if (!token) return;

    try {
        const today = new Date().toISOString().split('T')[0];
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 60);
        const endDateStr = endDate.toISOString().split('T')[0];

        const response = await fetch(`/api/kuliga/instructor/group-trainings?start_date=${today}&end_date=${endDateStr}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки групповых тренировок');
        }

        const trainings = await response.json();
        displayGroupTrainings(trainings);
    } catch (error) {
        console.error('Ошибка загрузки групповых тренировок:', error);
        const container = document.getElementById('group-trainings-list');
        if (container) {
            container.innerHTML = '<div style="color: #666;">Ошибка загрузки групповых тренировок</div>';
        }
    }
}

// Отображение групповых тренировок
function displayGroupTrainings(trainings) {
    const container = document.getElementById('group-trainings-list');
    if (!container) return;

    if (!trainings || trainings.length === 0) {
        container.innerHTML = '<div style="color: #666;">У вас пока нет созданных групповых тренировок</div>';
        return;
    }

    const trainingsHtml = trainings.map(training => {
        const date = new Date(training.date);
        const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
        const timeStr = String(training.start_time).substring(0, 5);
        const sportType = training.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
        const statusText = training.status === 'open' ? 'Открыта' : training.status === 'confirmed' ? 'Подтверждена' : 'Отменена';
        const statusColor = training.status === 'open' ? '#27ae60' : training.status === 'confirmed' ? '#3498db' : '#e74c3c';
        
        return `
            <div class="schedule-slot" style="margin-bottom: 10px;">
                <div class="slot-info">
                    <div class="slot-time">${dateStr} (${dayOfWeek}) ${timeStr}</div>
                    <div style="margin-top: 5px; color: #666;">
                        ${sportType} | Уровень: ${training.level} | 
                        Участников: ${training.current_participants || 0}/${training.max_participants} | 
                        ${training.price_per_person} ₽/чел
                    </div>
                    <div style="margin-top: 5px; color: ${statusColor}; font-weight: 600;">
                        ${statusText}
                    </div>
                </div>
                <div class="slot-actions">
                    <button class="btn-primary" onclick="editGroupTraining(${training.id})" title="Редактировать">✏️</button>
                    <button class="btn-danger" onclick="deleteGroupTraining(${training.id})" title="Удалить">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = trainingsHtml;
}

// Редактирование групповой тренировки
async function editGroupTraining(trainingId) {
    const token = getToken();
    if (!token) return;

    try {
        // Получаем данные тренировки
        const response = await fetch(`/api/kuliga/instructor/group-trainings/${trainingId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось загрузить данные тренировки');
        }

        const training = await response.json();
        
        // Проверяем, есть ли записи на тренировку
        const hasBookings = (parseInt(training.current_participants) || 0) > 0;
        
        // Вычисляем начальную цену за человека и заработок инструктора
        const adminPercentage = getAdminPercentageValue();
        let initialPricePerPerson = parseFloat(training.price_per_person || 0);
        
        // Если цена не установлена или нужно пересчитать, используем прайс
        if (!initialPricePerPerson && pricesData && pricesData.length > 0) {
            const priceInfo = getPriceFromPricelist(training.max_participants || 2);
            if (priceInfo) {
                initialPricePerPerson = priceInfo.price / (training.max_participants || 2);
            }
        }
        
        const initialNetPerPerson = initialPricePerPerson * (1 - adminPercentage / 100);
        
        // Создаем модальное окно для редактирования
        const modal = document.createElement('div');
        modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-top: 0;">Редактировать групповую тренировку</h2>
                ${hasBookings ? `<div style="background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 10px; border-radius: 6px; margin-bottom: 20px;">
                    ⚠️ На эту тренировку есть записи (${training.current_participants} участник${training.current_participants > 1 ? 'ов' : ''}). Количество участников изменить нельзя.
                </div>` : ''}
                <form id="edit-training-form">
                    <div class="form-group">
                        <label>Вид спорта *</label>
                        <select id="edit-sport-type" class="form-control" required>
                            ${instructorData && instructorData.sport_type === 'both' 
                                ? `<option value="ski" ${training.sport_type === 'ski' ? 'selected' : ''}>⛷️ Горные лыжи</option>
                                   <option value="snowboard" ${training.sport_type === 'snowboard' ? 'selected' : ''}>🏂 Сноуборд</option>`
                                : instructorData && instructorData.sport_type === 'ski'
                                    ? `<option value="ski" selected>⛷️ Горные лыжи</option>`
                                    : instructorData && instructorData.sport_type === 'snowboard'
                                        ? `<option value="snowboard" selected>🏂 Сноуборд</option>`
                                        : `<option value="${training.sport_type}">${training.sport_type === 'ski' ? '⛷️ Горные лыжи' : '🏂 Сноуборд'}</option>`}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Уровень (1-10) *</label>
                        <select id="edit-level" class="form-control" required>
                            ${Array.from({ length: 10 }, (_, i) => {
                                const levelNum = i + 1;
                                // Преобразуем старое значение уровня в число
                                let currentLevel = training.level;
                                if (currentLevel === 'beginner') currentLevel = '1';
                                else if (currentLevel === 'intermediate') currentLevel = '2';
                                else if (currentLevel === 'advanced') currentLevel = '3';
                                const isSelected = String(currentLevel) === String(levelNum);
                                return `<option value="${levelNum}" ${isSelected ? 'selected' : ''}>${levelNum} уровень</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Описание</label>
                        <textarea id="edit-description" class="form-control" rows="3">${training.description || ''}</textarea>
                    </div>
                    <div class="form-group" style="background: #f8f9fa; padding: 10px; border-radius: 6px;">
                        <label>Цена за человека</label>
                        <div id="edit-price-per-person" style="font-weight: 600; font-size: 16px; color: #27ae60;">
                            ${formatCurrency(initialPricePerPerson)} ₽
                        </div>
                        <div id="edit-price-per-person-net" style="font-size: 0.9em; color: #2c3e50; margin-top: 4px;">
                            ${adminPercentage > 0 ? `Инструктор получит: ${formatCurrency(initialNetPerPerson)} ₽ (админ ${adminPercentage}% )` : ''}
                        </div>
                        <small style="color: #666;">Цена устанавливается автоматически из прайса по количеству участников</small>
                    </div>
                    <div class="form-group">
                        <label>Минимум участников *</label>
                        <input type="number" id="edit-min-participants" class="form-control" min="1" value="${training.min_participants}" required ${hasBookings ? 'disabled' : ''} />
                        ${hasBookings ? '<small style="color: #666; display: block; margin-top: 5px;">Нельзя изменить: на тренировку есть записи</small>' : ''}
                    </div>
                    <div class="form-group">
                        <label>Максимум участников *</label>
                        <input type="number" id="edit-max-participants" class="form-control" min="2" value="${training.max_participants}" required ${hasBookings ? 'disabled' : ''} />
                        ${hasBookings ? '<small style="color: #666; display: block; margin-top: 5px;">Нельзя изменить: на тренировку есть записи</small>' : ''}
                    </div>
                    <div class="form-actions" style="display: flex; gap: 10px; margin-top: 20px;">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" onclick="this.closest('div[style*=\\'position: fixed\\']').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Функция для расчета цены при редактировании
        const calculateEditPrice = () => {
            const maxParticipantsInput = document.getElementById('edit-max-participants');
            const priceDisplay = document.getElementById('edit-price-per-person');
            const netDisplay = document.getElementById('edit-price-per-person-net');
            const adminPct = getAdminPercentageValue();

            if (!priceDisplay) {
                return;
            }

            let pricePerPerson = parseFloat(training.price_per_person || 0);
            let warningText = '';

            if (maxParticipantsInput && !maxParticipantsInput.disabled) {
                const maxParticipants = parseInt(maxParticipantsInput.value || '0', 10);

                if (!maxParticipants || !pricesData || pricesData.length === 0) {
                    warningText = 'Выберите максимум участников для расчета';
                } else {
                    const priceInfo = getPriceFromPricelist(maxParticipants);
                    if (!priceInfo) {
                        warningText = `⚠️ Цена для ${maxParticipants} участников не найдена`;
                    } else {
                        pricePerPerson = priceInfo.price / maxParticipants;
                    }
                }
            }

            if (warningText) {
                priceDisplay.textContent = warningText;
                if (netDisplay) netDisplay.textContent = '';
                return;
            }

            pricePerPerson = isNaN(pricePerPerson) ? 0 : pricePerPerson;
            priceDisplay.textContent = `${formatCurrency(pricePerPerson)} ₽`;

            if (netDisplay) {
                if (adminPct > 0) {
                    const netValue = pricePerPerson * (1 - adminPct / 100);
                    netDisplay.textContent = `Инструктор получит: ${formatCurrency(netValue)} ₽ (админ ${adminPct}% )`;
                } else {
                    netDisplay.textContent = '';
                }
            }
        };
        
        // Добавляем обработчики для динамического обновления цены
        const maxParticipantsInput = document.getElementById('edit-max-participants');
        const minParticipantsInput = document.getElementById('edit-min-participants');
        
        if (maxParticipantsInput && !maxParticipantsInput.disabled) {
            maxParticipantsInput.addEventListener('input', calculateEditPrice);
            // Вызываем расчет сразу при открытии формы
            calculateEditPrice();
        }
        
        if (minParticipantsInput && !minParticipantsInput.disabled) {
            minParticipantsInput.addEventListener('input', () => {
                const min = parseInt(minParticipantsInput.value) || 0;
                const max = parseInt(maxParticipantsInput?.value) || 0;
                if (min > max && max > 0) {
                    maxParticipantsInput.value = min;
                    calculateEditPrice();
                }
            });
        }
        
        // Обработчик сохранения
        document.getElementById('edit-training-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const sportType = document.getElementById('edit-sport-type').value;
            const level = document.getElementById('edit-level').value;
            const description = document.getElementById('edit-description').value;
            const minParticipantsInput = document.getElementById('edit-min-participants');
            const maxParticipantsInput = document.getElementById('edit-max-participants');
            // Если поля заблокированы (есть записи), используем текущие значения из training
            const minParticipants = minParticipantsInput.disabled 
                ? parseInt(training.min_participants, 10)
                : parseInt(minParticipantsInput.value, 10);
            const maxParticipants = maxParticipantsInput.disabled 
                ? parseInt(training.max_participants, 10)
                : parseInt(maxParticipantsInput.value, 10);
            
            if (minParticipants > maxParticipants) {
                showError('Минимум участников не может быть больше максимума');
                return;
            }
            
            // Получаем цену из прайса
            // Если поля заблокированы (есть записи), используем текущую цену
            let pricePerPerson;
            if (maxParticipantsInput.disabled) {
                // Поля заблокированы, используем текущую цену из training
                pricePerPerson = parseFloat(training.price_per_person || 0);
            } else {
                // Поля не заблокированы, пересчитываем цену
                const priceInfo = getPriceFromPricelist(maxParticipants);
                
                if (!priceInfo) {
                    showError(`Цена для ${maxParticipants} участников не найдена в прайсе`);
                    return;
                }
                
                // priceInfo.price - это общая цена группы, нужно разделить на количество участников
                // чтобы получить цену за человека
                pricePerPerson = priceInfo.price / maxParticipants;
                
                console.log(`💰 Расчет цены при сохранении: общая цена=${priceInfo.price}, участников=${maxParticipants}, цена за человека=${pricePerPerson.toFixed(2)}`);
            }
            
            try {
                const updateResponse = await fetch(`/api/kuliga/instructor/group-trainings/${trainingId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        sport_type: sportType,
                        level: level.toString(), // Сохраняем как строку
                        description: description || null,
                        price_per_person: pricePerPerson,
                        min_participants: minParticipants,
                        max_participants: maxParticipants
                    })
                });
                
                if (!updateResponse.ok) {
                    const error = await updateResponse.json();
                    throw new Error(error.error || 'Ошибка сохранения');
                }
                
                showSuccess('Групповая тренировка обновлена');
                modal.remove();
                
                // Перезагружаем расписание
                await loadSchedule();
            } catch (error) {
                console.error('Ошибка обновления тренировки:', error);
                showError(`Ошибка: ${error.message}`);
            }
        });
        
        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
    } catch (error) {
        console.error('Ошибка редактирования групповой тренировки:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Удаление групповой тренировки
async function deleteGroupTraining(trainingId) {
    if (!confirm('Вы уверены, что хотите удалить эту групповую тренировку? Все бронирования будут отменены.')) {
        return;
    }

    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch(`/api/kuliga/instructor/group-trainings/${trainingId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка удаления тренировки');
        }

        showSuccess('Групповая тренировка удалена');
        
        // Перезагружаем расписание и статистику
        await loadSchedule();
        await loadStats();
    } catch (error) {
        console.error('Ошибка удаления групповой тренировки:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Показать детали индивидуального бронирования (слота)
async function showSlotDetails(slotId) {
    const token = getToken();
    if (!token) return;

    try {
        // Получаем информацию о бронировании для этого слота
        const response = await fetch(`/api/kuliga/instructor/bookings/slot/${slotId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось загрузить информацию о бронировании');
        }

        const booking = await response.json();
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
        
        const dateObj = new Date(booking.date + 'T00:00:00');
        const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        
        // Проверяем, прошла ли тренировка
        const now = new Date();
        const trainingEnd = new Date(`${booking.date}T${booking.end_time}`);
        const isTrainingPassed = trainingEnd < now;
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-top: 0;">Индивидуальная тренировка</h2>
                <div style="margin-bottom: 20px;">
                    <div style="margin-bottom: 10px;"><strong>Дата:</strong> ${formattedDate} (${dayOfWeek})</div>
                    <div style="margin-bottom: 10px;"><strong>Время:</strong> ${String(booking.start_time).substring(0, 5)} - ${String(booking.end_time).substring(0, 5)}</div>
                    <div style="margin-bottom: 10px;"><strong>Клиент:</strong> ${booking.client_name || 'Не указан'}</div>
                    ${!isTrainingPassed ? `<div style="margin-bottom: 10px;"><strong>Телефон:</strong> ${booking.client_phone || 'Не указан'}</div>` : ''}
                    <div style="margin-bottom: 10px;"><strong>Вид спорта:</strong> ${booking.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд'}</div>
                    <div style="margin-bottom: 10px;"><strong>Стоимость:</strong> ${parseFloat(booking.price_total || 0).toFixed(2)} ₽</div>
                    <div style="margin-bottom: 10px;"><strong>Статус:</strong> ${booking.status === 'confirmed' ? 'Подтверждено' : booking.status === 'pending' ? 'Ожидание' : booking.status}</div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn-secondary" onclick="this.closest('div[style*=\\'position: fixed\\']').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    } catch (error) {
        console.error('Ошибка загрузки информации о слоте:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Показать детали групповой тренировки
async function showGroupTrainingDetails(trainingId) {
    const token = getToken();
    if (!token) return;

    try {
        // Получаем информацию о групповой тренировке
        const [trainingResponse, bookingsResponse] = await Promise.all([
            fetch(`/api/kuliga/instructor/group-trainings/${trainingId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/kuliga/instructor/bookings/group/${trainingId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
        ]);

        if (!trainingResponse.ok) {
            throw new Error('Не удалось загрузить информацию о тренировке');
        }

        const training = await trainingResponse.json();
        const bookings = bookingsResponse.ok ? await bookingsResponse.json() : [];
        
        // Нормализуем дату
        let dateStr = training.date;
        if (typeof dateStr === 'object' && dateStr !== null) {
            dateStr = dateStr.toISOString().split('T')[0];
        } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
            dateStr = dateStr.split('T')[0];
        }
        
        const dateObj = new Date(dateStr + 'T00:00:00');
        const day = dateObj.getDate();
        const month = dateObj.getMonth() + 1;
        const year = dateObj.getFullYear();
        const formattedDate = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`;
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
        
        const adminPercentage = getAdminPercentageValue();
        const pricePerPerson = parseFloat(training.price_per_person || 0);
        const netPerPerson = pricePerPerson * (1 - adminPercentage / 100);

        // Проверяем, прошла ли тренировка
        const now = new Date();
        const trainingEnd = new Date(`${dateStr}T${training.end_time}`);
        const isTrainingPassed = trainingEnd < now;

        const participantsList = bookings.length > 0 
            ? bookings.map((b, idx) => {
                const bookingTotal = parseFloat(b.price_total || 0);
                const bookingNet = bookingTotal * (1 - adminPercentage / 100);
                return `
                    <div style="padding: 10px; background: #f8f9fa; border-radius: 4px; margin-bottom: 5px;">
                        <div><strong>${idx + 1}. ${b.client_name || 'Клиент'}</strong></div>
                        <div style="font-size: 0.9em; color: #666;">
                            ${!isTrainingPassed ? `Телефон: ${b.client_phone || 'Не указан'} | ` : ''}
                            Участников: ${b.participants_count} | 
                            Стоимость: ${formatCurrency(bookingTotal)} ₽
                            ${adminPercentage > 0 ? `<br><span style="color:#2c3e50;">Инструктор получит: ${formatCurrency(bookingNet)} ₽</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('')
            : '<div style="color: #666;">Пока нет записавшихся</div>';
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-top: 0;">Групповая тренировка</h2>
                <div style="margin-bottom: 20px;">
                    <div style="margin-bottom: 10px;"><strong>Дата:</strong> ${formattedDate} (${dayOfWeek})</div>
                    <div style="margin-bottom: 10px;"><strong>Время:</strong> ${String(training.start_time).substring(0, 5)} - ${String(training.end_time).substring(0, 5)}</div>
                    <div style="margin-bottom: 10px;"><strong>Вид спорта:</strong> ${training.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд'}</div>
                    <div style="margin-bottom: 10px;"><strong>Уровень:</strong> ${training.level}</div>
                    <div style="margin-bottom: 10px;"><strong>Участников:</strong> ${training.current_participants || 0}/${training.max_participants}</div>
                    <div style="margin-bottom: 10px;">
                        <strong>Цена за участника:</strong> ${formatCurrency(pricePerPerson)} ₽
                        ${adminPercentage > 0 ? `<div style="font-size:0.9em;color:#2c3e50;margin-top:4px;">
                            Инструктор получит: ${formatCurrency(netPerPerson)} ₽ (админ ${adminPercentage}%)
                        </div>` : ''}
                    </div>
                    ${training.description ? `<div style="margin-bottom: 10px;"><strong>Описание:</strong> ${training.description}</div>` : ''}
                </div>
                <h3>Записавшиеся:</h3>
                <div style="margin-bottom: 20px; max-height: 300px; overflow-y: auto;">
                    ${participantsList}
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn-secondary" onclick="this.closest('div[style*=\\'position: fixed\\']').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    } catch (error) {
        console.error('Ошибка загрузки информации о групповой тренировке:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// ========================================
// РЕГУЛЯРНЫЕ ГРУППОВЫЕ ТРЕНИРОВКИ
// ========================================

// Инициализация формы регулярных групповых тренировок
function initRegularTrainingForm() {
    // Заполняем вид спорта в зависимости от возможностей инструктора
    const sportTypeSelect = document.getElementById('regular-sport-type');
    if (sportTypeSelect && instructorData) {
        sportTypeSelect.innerHTML = '<option value="">Выберите вид спорта</option>';
        
        if (instructorData.sport_type === 'both') {
            sportTypeSelect.innerHTML += '<option value="ski">⛷️ Горные лыжи</option>';
            sportTypeSelect.innerHTML += '<option value="snowboard">🏂 Сноуборд</option>';
        } else if (instructorData.sport_type === 'ski') {
            sportTypeSelect.innerHTML += '<option value="ski">⛷️ Горные лыжи</option>';
        } else if (instructorData.sport_type === 'snowboard') {
            sportTypeSelect.innerHTML += '<option value="snowboard">🏂 Сноуборд</option>';
        }
    }
    
    // Заполняем уровни от 1 до 10
    const levelSelect = document.getElementById('regular-level');
    if (levelSelect) {
        levelSelect.innerHTML = '<option value="">Выберите уровень</option>';
        for (let i = 1; i <= 10; i++) {
            levelSelect.innerHTML += `<option value="${i}">${i} уровень</option>`;
        }
    }
    
    // Устанавливаем даты по умолчанию
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 60); // 2 месяца вперед
    
    document.getElementById('regular-from').value = today.toISOString().split('T')[0];
    document.getElementById('regular-to').value = endDate.toISOString().split('T')[0];
    
    // Обработчики изменения количества участников для расчета цены
    const maxParticipantsInput = document.getElementById('regular-max-participants');
    const minParticipantsInput = document.getElementById('regular-min-participants');
    
    if (maxParticipantsInput) {
        maxParticipantsInput.addEventListener('input', calculateRegularPrice);
        // Устанавливаем значение по умолчанию
        maxParticipantsInput.value = 4;
        // Делаем расчет после небольшой задержки, чтобы прайс точно был загружен
        setTimeout(() => {
            calculateRegularPrice();
        }, 100);
    }
    
    if (minParticipantsInput) {
        minParticipantsInput.addEventListener('input', () => {
            const min = parseInt(minParticipantsInput.value) || 0;
            const max = parseInt(maxParticipantsInput?.value) || 0;
            if (min > max && max > 0) {
                maxParticipantsInput.value = min;
            }
            calculateRegularPrice();
        });
    }
}

// Получить цену из прайса по количеству участников (вспомогательная функция)
function getPriceFromPricelist(maxParticipants) {
    if (!pricesData || pricesData.length === 0) {
        console.log('Прайс не загружен или пуст');
        return null;
    }
    
    console.log('Поиск цены для', maxParticipants, 'участников. Прайс:', pricesData);
    
    // Ищем цену в прайсе для групповых тренировок
    const groupPrice = pricesData.find(p => {
        const pType = p.type;
        const pParticipants = parseInt(p.participants);
        const pDuration = parseInt(p.duration);
        
        return pType === 'group' && 
               pParticipants === maxParticipants &&
               pDuration === 60;
    });
    
    if (!groupPrice) {
        console.log('Цена не найдена для', maxParticipants, 'участников');
        return null;
    }
    
    console.log('Найдена цена:', groupPrice);
    
    // Возвращаем объект с общей стоимостью группы
    return {
        price: parseFloat(groupPrice.price),
        ...groupPrice
    };
}

// Расчет цены для регулярных групповых тренировок
function calculateRegularPrice() {
    const maxParticipants = parseInt(document.getElementById('regular-max-participants')?.value) || 0;
    const priceInfo = document.getElementById('regular-price-info');
    
    if (!priceInfo) {
        return;
    }
    
    if (maxParticipants === 0 || !pricesData || pricesData.length === 0) {
        priceInfo.innerHTML = 'Выберите максимум участников для расчета';
        return;
    }
    
    const priceInfoObj = getPriceFromPricelist(maxParticipants);
    if (!priceInfoObj) {
        priceInfo.innerHTML = `⚠️ Цена для ${maxParticipants} участников не найдена в прайсе`;
        return;
    }
    
    // priceInfoObj.price - это общая цена группы
    const totalPrice = priceInfoObj.price;
    const pricePerPerson = totalPrice / maxParticipants;
    
    const adminPercentage = instructorData?.admin_percentage || 20;
    const instructorEarnings = totalPrice * (1 - adminPercentage / 100);
    const instructorPerPerson = instructorEarnings / maxParticipants;
    
    priceInfo.innerHTML = `
        <div style="margin-top: 5px;">
            <div><strong>Цена за участника:</strong> ${pricePerPerson.toFixed(2)} ₽</div>
            <div><strong>Ваш заработок за участника:</strong> ${instructorPerPerson.toFixed(2)} ₽</div>
            <div><strong>Ваш общий заработок при полном заполнении:</strong> ${instructorEarnings.toFixed(2)} ₽</div>
        </div>
    `;
}

// Создание регулярных групповых тренировок
async function createRegularGroupTrainings() {
    const token = getToken();
    if (!token) return;
    
    const fromDate = document.getElementById('regular-from').value;
    const toDate = document.getElementById('regular-to').value;
    const time = document.getElementById('regular-time').value;
    const sportType = document.getElementById('regular-sport-type').value;
    const level = document.getElementById('regular-level').value;
    const description = document.getElementById('regular-description').value;
    const minParticipants = parseInt(document.getElementById('regular-min-participants').value);
    const maxParticipants = parseInt(document.getElementById('regular-max-participants').value);
    
    // Получаем выбранные дни недели
    const weekdaysCheckboxes = document.querySelectorAll('.regular-weekday:checked');
    const weekdays = Array.from(weekdaysCheckboxes).map(cb => parseInt(cb.value));
    
    // Валидация
    if (!fromDate || !toDate || !time || !sportType || !level || weekdays.length === 0) {
        showError('Заполните все обязательные поля и выберите хотя бы один день недели');
        return;
    }
    
    if (minParticipants > maxParticipants) {
        showError('Минимум участников не может быть больше максимума');
        return;
    }
    
    // Проверяем время (не раньше 10:15)
    const [hours, minutes] = time.split(':').map(Number);
    if (hours < 10 || (hours === 10 && minutes < 15)) {
        showError('Первая тренировка может начаться не раньше 10:15');
        return;
    }
    
    try {
        const response = await fetch('/api/kuliga/instructor/regular-group-trainings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromDate,
                toDate,
                weekdays,
                time,
                sportType,
                level,
                description,
                minParticipants,
                maxParticipants
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Ошибка создания регулярных тренировок');
        }
        
        showSuccess(`Создано: ${result.created} слотов и ${result.trainings} групповых тренировок`);
        
        // Очищаем форму
        document.getElementById('regular-description').value = '';
        document.querySelectorAll('.regular-weekday').forEach(cb => cb.checked = false);
        
        // Обновляем статистику и расписание
        await loadStats();
        await loadSchedule();
    } catch (error) {
        console.error('Ошибка создания регулярных тренировок:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Массовое удаление групповых тренировок
async function deleteBulkGroupTrainings() {
    if (!confirm('Вы уверены, что хотите удалить групповые тренировки? Тренировки с активными бронированиями будут пропущены.')) {
        return;
    }

    const token = getToken();
    if (!token) return;

    const fromDate = document.getElementById('delete-trainings-from').value;
    const toDate = document.getElementById('delete-trainings-to').value;
    const time = document.getElementById('delete-trainings-time').value;
    const resultDiv = document.getElementById('delete-trainings-result');

    // Получаем выбранные дни недели
    const weekdaysCheckboxes = document.querySelectorAll('.delete-trainings-weekday:checked');
    const weekdays = Array.from(weekdaysCheckboxes).map(cb => parseInt(cb.value));

    if (!fromDate || !toDate) {
        showError('Заполните диапазон дат');
        return;
    }

    try {
        const response = await fetch('/api/kuliga/instructor/group-trainings/delete-bulk', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromDate,
                toDate,
                weekdays: weekdays.length > 0 ? weekdays : undefined,
                time: time || undefined
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка удаления тренировок');
        }

        showSuccess(result.message || `Удалено тренировок: ${result.deleted}`);
        
        // Обновляем расписание и статистику
        await loadStats();
        await loadSchedule();
    } catch (error) {
        console.error('Ошибка массового удаления тренировок:', error);
        showError(`Ошибка: ${error.message}`);
    }
}

// Глобальные функции (вызываются из inline onclick)
window.toggleSlotStatus = toggleSlotStatus;
window.deleteSlot = deleteSlot;
window.openGroupTrainingModal = openGroupTrainingModal;
window.closeGroupTrainingModal = closeGroupTrainingModal;
window.editGroupTraining = editGroupTraining;
window.deleteGroupTraining = deleteGroupTraining;
window.showSlotDetails = showSlotDetails;
window.showGroupTrainingDetails = showGroupTrainingDetails;

