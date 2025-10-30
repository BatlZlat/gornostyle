/**
 * Создание зимних тренировок на естественном склоне
 */

let trainers = [];
let groups = [];
let prices = [];

// Получить токен авторизации
function getAuthToken() {
    // Пробуем из cookie
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'adminToken') {
            return value;
        }
    }
    // Пробуем из localStorage
    return localStorage.getItem('authToken') || localStorage.getItem('adminToken') || localStorage.getItem('token');
}

// Сделать авторизованный запрос
async function authFetch(url, options = {}) {
    const token = getAuthToken();
    if (!token) {
        throw new Error('Требуется авторизация');
    }
    
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    
    return fetch(url, { ...options, headers });
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    // Проверяем авторизацию (опционально, т.к. можем заходить из админ-панели)
    const token = getAuthToken();
    if (!token) {
        console.warn('⚠️ Токен авторизации не найден');
        alert('Требуется авторизация. Перейдите в админ-панель и войдите в систему.');
        window.location.href = 'login.html';
        return;
    }
    
    console.log('🚀 Инициализация страницы создания зимней тренировки...');
    
    try {
        await Promise.all([
            loadTrainers(),
            loadGroups(),
            loadPrices()
        ]);
        setupDateInput();
        setupFormHandlers();
        setupTimeSlotsLoader();
        console.log('✅ Инициализация завершена');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        alert('Ошибка загрузки данных. Проверьте консоль браузера.');
    }
});

// Установить дату по умолчанию
function setupDateInput() {
    const dateInput = document.getElementById('date');
    if (dateInput && !dateInput.value) {
        dateInput.valueAsDate = new Date();
    }
}

// Загрузка свободных слотов на выбранную дату из winter_schedule
function setupTimeSlotsLoader() {
    const dateInput = document.getElementById('date');
    const timeSelect = document.getElementById('timeSlot');
    if (!dateInput || !timeSelect) return;

    async function loadTimes(dateStr) {
        // Очищаем список и ставим placeholder
        while (timeSelect.options.length) timeSelect.remove(0);
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Выберите время';
        timeSelect.appendChild(placeholder);

        if (!dateStr) return;
        try {
            const res = await authFetch(`/api/winter-schedule/${dateStr}`);
            if (!res.ok) throw new Error('Ошибка загрузки расписания');
            const data = await res.json();
            const slots = (data.slots || []).filter(s => s.is_available === true);
            if (slots.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'Свободных слотов нет';
                timeSelect.appendChild(opt);
                return;
            }
            // Сортировка по времени
            slots.sort((a, b) => String(a.time_slot).localeCompare(String(b.time_slot)));
            for (const s of slots) {
                const t = String(s.time_slot).substring(0, 5);
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                timeSelect.appendChild(opt);
            }
        } catch (e) {
            console.error('Ошибка загрузки слотов:', e);
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Ошибка загрузки слотов';
            timeSelect.appendChild(opt);
        }
    }

    // Смена даты => загрузка слотов
    dateInput.addEventListener('change', () => loadTimes(dateInput.value));
    // Первичная загрузка
    if (dateInput.value) loadTimes(dateInput.value);
}

// Загрузить список тренеров
async function loadTrainers() {
    try {
        const response = await authFetch('/api/trainers');
        if (!response.ok) throw new Error('Ошибка загрузки тренеров');
        const data = await response.json();
        
        // API возвращает массив напрямую
        trainers = Array.isArray(data) ? data : data.trainers || [];
        const trainerSelect = document.getElementById('trainer');
        
        // Очищаем существующие опции (кроме первой пустой)
        while (trainerSelect.options.length > 1) {
            trainerSelect.remove(1);
        }
        
        // Фильтруем только активных тренеров
        trainers.filter(t => t.is_active !== false).forEach(trainer => {
            const option = document.createElement('option');
            option.value = trainer.id;
            option.textContent = trainer.full_name;
            trainerSelect.appendChild(option);
        });
        
        console.log(`✅ Загружено тренеров: ${trainers.filter(t => t.is_active !== false).length}`);
    } catch (error) {
        console.error('Ошибка загрузки тренеров:', error);
    }
}

// Загрузить список групп
async function loadGroups() {
    try {
        const response = await authFetch('/api/groups');
        if (!response.ok) throw new Error('Ошибка загрузки групп');
        const data = await response.json();
        
        // API возвращает массив напрямую
        groups = Array.isArray(data) ? data : data.groups || [];
        
        if (!Array.isArray(groups)) {
            console.error('❌ Неверный формат данных групп:', data);
            throw new Error('Неверный формат ответа API групп');
        }
        
        const groupSelect = document.getElementById('group');
        if (!groupSelect) {
            throw new Error('Элемент #group не найден в DOM');
        }
        
        // Очищаем существующие опции (кроме первой пустой)
        while (groupSelect.options.length > 1) {
            groupSelect.remove(1);
        }
        
        if (groups.length === 0) {
            console.warn('⚠️ Группы не найдены. Убедитесь, что группы созданы в админ-панели.');
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Группы не найдены. Создайте группы на странице "Группы"';
            option.disabled = true;
            groupSelect.appendChild(option);
        } else {
            groups.forEach(group => {
                if (!group.id || !group.name) {
                    console.warn('⚠️ Пропущена группа с неполными данными:', group);
                    return;
                }
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                groupSelect.appendChild(option);
            });
        }
        
        console.log(`✅ Загружено групп: ${groups.length}`);
    } catch (error) {
        console.error('❌ Ошибка загрузки групп:', error);
        console.error('Детали:', {
            message: error.message,
            stack: error.stack
        });
        alert(`Ошибка загрузки списка групп: ${error.message}\n\nПроверьте консоль браузера для деталей.`);
    }
}

// Загрузить цены
async function loadPrices() {
    try {
        const response = await authFetch('/api/winter-prices');
        if (!response.ok) throw new Error('Ошибка загрузки цен');
        const data = await response.json();
        
        prices = Array.isArray(data) ? data : data.prices || [];
    } catch (error) {
        console.error('Ошибка загрузки цен:', error);
    }
}

// Настроить обработчики формы
function setupFormHandlers() {
    const maxParticipantsSelect = document.getElementById('maxParticipants');
    
    // Обновление цены при изменении количества участников
    maxParticipantsSelect.addEventListener('change', updatePrice);
    
    // Обновление цены при изменении параметров
    const form = document.getElementById('createWinterTrainingForm');
    form.addEventListener('change', updatePrice);
    
    // Отправка формы
    form.addEventListener('submit', handleSubmit);
}

// Обновить отображение цены
async function updatePrice() {
    const maxParticipants = document.getElementById('maxParticipants').value;
    const priceDisplay = document.getElementById('trainingPrice');
    
    if (!maxParticipants) {
        priceDisplay.textContent = '';
        return;
    }
    
    try {
        // Ищем цену для групповых тренировок с данным количеством участников
        // Цена в базе хранится за одного человека
        const priceObj = prices.find(p => 
            p.type === 'group' && 
            p.participants === parseInt(maxParticipants) &&
            p.is_active === true
        );
        
        if (priceObj) {
            // Цена в базе - это общая цена за всю группу
            const totalPrice = parseFloat(priceObj.price);
            // Цена за человека = общая цена / количество участников
            const pricePerPerson = totalPrice / parseInt(maxParticipants);
            priceDisplay.innerHTML = `
                <div style="margin-top: 10px;">
                    <div><strong>💰 Цена за человека:</strong> ${pricePerPerson.toFixed(2)} руб.</div>
                    <div><strong>💰 Общая цена (${maxParticipants} чел.):</strong> ${totalPrice.toFixed(2)} руб.</div>
                </div>
            `;
            priceDisplay.style.color = '#2ecc71';
        } else {
            priceDisplay.textContent = `⚠️ Цена не найдена для группы из ${maxParticipants} человек`;
            priceDisplay.style.color = '#e74c3c';
        }
    } catch (error) {
        console.error('Ошибка расчета цены:', error);
        priceDisplay.textContent = '⚠️ Ошибка расчета цены';
        priceDisplay.style.color = '#e74c3c';
    }
}

// Обработка отправки формы
async function handleSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    
    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Создание тренировки...';
        
        const formData = new FormData(form);
        const timeSlot = formData.get('time_slot');
        const groupId = formData.get('group_id');
        const maxParticipants = parseInt(formData.get('max_participants'));
        
        // Валидация
        if (!groupId) {
            throw new Error('Необходимо выбрать группу');
        }
        if (!maxParticipants || maxParticipants < 2) {
            throw new Error('Необходимо выбрать количество участников (минимум 2)');
        }
        
        // Преобразуем время в формат для backend
        const [hours, minutes] = timeSlot.split(':');
        const startTime = `${hours}:${minutes}:00`;
        
        // Рассчитываем endTime (длительность 60 минут)
        const endTimeHours = (parseInt(hours) + 1).toString().padStart(2, '0');
        const endTime = `${endTimeHours}:${minutes}:00`;
        
        // Получаем цену из базы: цена в базе - это общая цена за всю группу
        const priceObj = prices.find(p => 
            p.type === 'group' && 
            p.participants === maxParticipants &&
            p.is_active === true
        );
        
        if (!priceObj) {
            throw new Error(`Цена не найдена для группы из ${maxParticipants} человек. Проверьте прайс зимних тренировок.`);
        }
        
        // Цена в базе уже содержит общую цену за всю группу
        const totalPrice = parseFloat(priceObj.price);
        
        const data = {
            training_type: true, // Всегда групповая тренировка
            group_id: groupId,
            session_date: formData.get('date'),
            start_time: startTime,
            end_time: endTime,
            duration: 60,
            trainer_id: formData.get('trainer_id') || null,
            skill_level: parseInt(formData.get('skill_level')) || null,
            max_participants: maxParticipants,
            slope_type: 'natural_slope',
            winter_training_type: 'group',
            price: totalPrice // Общая цена для всей группы
        };
        
        const response = await authFetch('/api/winter-trainings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при создании тренировки');
        }
        
        alert('✅ Тренировка успешно создана');
        setTimeout(() => {
            window.location.href = 'admin.html';
        }, 1000);
        
    } catch (error) {
        console.error('Ошибка создания тренировки:', error);
        alert('❌ Ошибка: ' + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
}

