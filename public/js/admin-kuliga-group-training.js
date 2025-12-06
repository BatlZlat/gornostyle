/**
 * Логика создания групповых тренировок Кулиги через админ-панель
 */

let winterPrices = [];
let availableDates = [];
let availableSlots = [];
let selectedInstructorId = null;

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
        throw new Error('Требуется авторизация');
    }
    
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    
    return fetch(url, { ...options, headers });
}

// Загрузить цены зимних тренировок
async function loadWinterPrices() {
    try {
        const response = await authFetch('/api/winter-prices?is_active=true&type=group');
        if (!response.ok) throw new Error('Ошибка загрузки цен');
        winterPrices = await response.json();
        console.log('✅ Цены загружены:', winterPrices.length);
    } catch (error) {
        console.error('❌ Ошибка загрузки цен:', error);
    }
}

// Загрузить доступные даты для выбранного вида спорта
async function loadAvailableDates(sportType) {
    if (!sportType) {
        availableDates = [];
        return;
    }

    try {
        const fromDate = new Date().toISOString().split('T')[0];
        const toDate = new Date();
        toDate.setMonth(toDate.getMonth() + 2);
        const toDateStr = toDate.toISOString().split('T')[0];

        const response = await authFetch(
            `/api/kuliga/admin/available-dates?sport_type=${sportType}&from_date=${fromDate}&to_date=${toDateStr}`
        );
        
        if (!response.ok) throw new Error('Ошибка загрузки дат');
        const data = await response.json();
        availableDates = data.data || [];
        
        console.log(`✅ Загружено дат для ${sportType}:`, availableDates.length);
        updateDatePicker();
    } catch (error) {
        console.error('❌ Ошибка загрузки дат:', error);
        availableDates = [];
    }
}

// Обновить календарь с подсветкой дат
function updateDatePicker() {
    const dateInput = document.getElementById('kgt-date');
    if (!dateInput) return;

    // Инициализируем flatpickr если еще не инициализирован
    if (!window.kgtDatePicker) {
        // Используем русскую локализацию напрямую из window.flatpickr
        const ruLocale = window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.ru 
            ? window.flatpickr.l10ns.ru 
            : null;

        const fpOptions = {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'd.m.Y',
            allowInput: true,
            minDate: 'today',
            firstDayOfWeek: 1, // Понедельник - первый день недели
            locale: ruLocale || {
                firstDayOfWeek: 1,
                weekdays: {
                    shorthand: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
                    longhand: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
                },
                months: {
                    shorthand: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
                    longhand: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
                }
            },
            onChange: function(selectedDates, dateStr) {
                if (dateStr) {
                    loadSlotsForDate(dateStr);
                    loadInstructorsForDate(dateStr);
                }
            },
            onMonthChange: function(selectedDates, dateStr, instance) {
                highlightAvailableDates(instance);
            },
            onOpen: function(selectedDates, dateStr, instance) {
                highlightAvailableDates(instance);
            },
            onReady: function(selectedDates, dateStr, instance) {
                highlightAvailableDates(instance);
            },
            disable: [
                function(date) {
                    // Отключаем все даты, которых нет в availableDates
                    const dateStr = date.toISOString().split('T')[0];
                    return !availableDates.includes(dateStr);
                }
            ]
        };

        window.kgtDatePicker = flatpickr(dateInput, fpOptions);
        
        // Убеждаемся, что локаль и первый день недели применены
        if (ruLocale && window.kgtDatePicker.config) {
            window.kgtDatePicker.set('locale', ruLocale);
            window.kgtDatePicker.set('firstDayOfWeek', 1);
        }
    } else {
        // Обновляем список отключенных дат
        window.kgtDatePicker.set('disable', [
            function(date) {
                const dateStr = date.toISOString().split('T')[0];
                return !availableDates.includes(dateStr);
            }
        ]);
        // Убеждаемся, что локаль и первый день недели сохранены
        const ruLocale = window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.ru 
            ? window.flatpickr.l10ns.ru 
            : null;
        if (ruLocale) {
            window.kgtDatePicker.set('locale', ruLocale);
        }
        window.kgtDatePicker.set('firstDayOfWeek', 1);
        window.kgtDatePicker.redraw();
    }
}

// Подсветить доступные даты в календаре
function highlightAvailableDates(instance) {
    if (!instance || !instance.calendarContainer) return;
    
    setTimeout(() => {
        const days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
        days.forEach(day => {
            if (day.classList.contains('flatpickr-disabled')) {
                day.classList.remove('has-schedule');
            } else {
                const dateStr = day.dateObj.toISOString().split('T')[0];
                if (availableDates.includes(dateStr)) {
                    day.classList.add('has-schedule');
                    day.title = 'Есть расписание инструкторов';
                }
            }
        });
    }, 100);
}

// Загрузить инструкторов для выбранной даты и вида спорта
async function loadInstructorsForDate(date) {
    const sportType = document.getElementById('kgt-sport-type').value;
    if (!sportType || !date) {
        document.getElementById('kgt-instructor').innerHTML = '<option value="">Все инструкторы с расписанием</option>';
        return;
    }

    try {
        const response = await authFetch(
            `/api/kuliga/admin/instructors?date=${date}&sport_type=${sportType}`
        );
        
        if (!response.ok) throw new Error('Ошибка загрузки инструкторов');
        const data = await response.json();
        const instructors = data.data || [];

        const select = document.getElementById('kgt-instructor');
        select.innerHTML = '<option value="">Все инструкторы с расписанием</option>';
        
        // Фильтруем инструкторов по виду спорта на клиенте (дополнительная проверка)
        const filteredInstructors = instructors.filter(instructor => 
            instructor.sport_type === sportType || instructor.sport_type === 'both'
        );

        filteredInstructors.forEach(instructor => {
            const option = document.createElement('option');
            option.value = instructor.id;
            option.textContent = instructor.full_name;
            select.appendChild(option);
        });

        // При изменении фильтра инструктора обновляем список слотов
        select.onchange = () => {
            selectedInstructorId = select.value || null;
            loadSlotsForDate(date);
        };

        console.log(`✅ Отфильтровано инструкторов для ${sportType} на ${date}:`, filteredInstructors.length, 'из', instructors.length);
    } catch (error) {
        console.error('❌ Ошибка загрузки инструкторов:', error);
    }
}

// Загрузить свободные слоты для выбранной даты
async function loadSlotsForDate(date) {
    const sportType = document.getElementById('kgt-sport-type').value;
    const instructorId = document.getElementById('kgt-instructor').value;
    
    if (!sportType || !date) {
        document.getElementById('kgt-slot').innerHTML = '<option value="">Выберите время</option>';
        return;
    }

    try {
        const response = await authFetch(
            `/api/kuliga/admin/available-slots?date=${date}&sport_type=${sportType}`
        );
        
        if (!response.ok) throw new Error('Ошибка загрузки слотов');
        const data = await response.json();
        availableSlots = data.data || [];

        // Фильтруем по инструктору, если выбран
        // Также дополнительно фильтруем по виду спорта инструктора на клиенте
        let filteredSlots = availableSlots;
        if (instructorId) {
            filteredSlots = availableSlots.filter(slot => slot.instructor_id == instructorId);
        }
        
        // Дополнительная фильтрация по виду спорта инструктора (на случай если API не отфильтровал)
        filteredSlots = filteredSlots.filter(slot => {
            // Инструктор должен иметь sport_type равный выбранному виду спорта или 'both'
            return slot.instructor_sport_type === sportType || slot.instructor_sport_type === 'both';
        });

        // Сортируем по времени и имени инструктора
        filteredSlots.sort((a, b) => {
            const timeCompare = a.start_time.localeCompare(b.start_time);
            if (timeCompare !== 0) return timeCompare;
            return a.instructor_name.localeCompare(b.instructor_name);
        });

        const select = document.getElementById('kgt-slot');
        select.innerHTML = '<option value="">Выберите время</option>';
        
        if (filteredSlots.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Свободных слотов нет';
            option.disabled = true;
            select.appendChild(option);
        } else {
            filteredSlots.forEach(slot => {
                const option = document.createElement('option');
                const timeStr = slot.start_time.substring(0, 5); // HH:MM
                option.value = slot.slot_id;
                option.textContent = `${timeStr} (${slot.instructor_name})`;
                option.dataset.instructorId = slot.instructor_id;
                option.dataset.slotDate = slot.date; // Сохраняем дату слота из базы данных
                select.appendChild(option);
            });
        }

        console.log(`✅ Загружено слотов для ${date}:`, filteredSlots.length);
        updatePrice(); // Обновляем цену при загрузке слотов
    } catch (error) {
        console.error('❌ Ошибка загрузки слотов:', error);
        document.getElementById('kgt-slot').innerHTML = '<option value="">Ошибка загрузки слотов</option>';
    }
}

// Обновить цену на основе количества участников
function updatePrice() {
    const maxParticipants = parseInt(document.getElementById('kgt-max-participants').value);
    const priceDisplay = document.getElementById('kgt-price-display');
    
    if (!maxParticipants || maxParticipants < 2) {
        priceDisplay.textContent = '—';
        return;
    }

    // Ищем цену для групповых тренировок с данным количеством участников
    const priceObj = winterPrices.find(p => 
        p.type === 'group' && 
        p.participants === maxParticipants &&
        p.is_active === true
    );

    if (priceObj) {
        // Цена в базе - это общая цена за всю группу
        const totalPrice = parseFloat(priceObj.price);
        // Цена за человека = общая цена / количество участников
        const pricePerPerson = totalPrice / maxParticipants;
        
        priceDisplay.innerHTML = `
            <div>За человека: <strong>${pricePerPerson.toFixed(2)} ₽</strong></div>
            <div>Всего (${maxParticipants} чел.): <strong>${totalPrice.toFixed(2)} ₽</strong></div>
        `;
    } else {
        priceDisplay.textContent = `⚠️ Цена не найдена для группы из ${maxParticipants} человек`;
        priceDisplay.style.color = '#e74c3c';
    }
}

// Открыть модальное окно
function openKuligaGroupTrainingModal() {
    const modal = document.getElementById('kuliga-group-training-modal');
    if (!modal) return;

    // Загружаем цены при открытии модального окна
    loadWinterPrices();

    // Сбрасываем форму
    document.getElementById('kuliga-group-training-form').reset();
    document.getElementById('kgt-level').value = 'beginner';
    document.getElementById('kgt-min-participants').value = '2';
    document.getElementById('kgt-price-display').textContent = '—';
    document.getElementById('kgt-price-display').style.color = '';
    availableDates = [];
    availableSlots = [];
    selectedInstructorId = null;

    // Сбрасываем date picker
    if (window.kgtDatePicker) {
        window.kgtDatePicker.clear();
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Обработчик изменения вида спорта
    document.getElementById('kgt-sport-type').onchange = async function() {
        const sportType = this.value;
        if (sportType) {
            await loadAvailableDates(sportType);
            // Очищаем выбранную дату и слоты
            if (window.kgtDatePicker) {
                window.kgtDatePicker.clear();
            }
            document.getElementById('kgt-slot').innerHTML = '<option value="">Выберите время</option>';
            document.getElementById('kgt-instructor').innerHTML = '<option value="">Все инструкторы с расписанием</option>';
            selectedInstructorId = null;
        } else {
            availableDates = [];
            if (window.kgtDatePicker) {
                window.kgtDatePicker.set('disable', []);
                window.kgtDatePicker.redraw();
            }
        }
    };

    // Обработчик изменения количества участников
    document.getElementById('kgt-max-participants').onchange = updatePrice;
}

// Закрыть модальное окно
function closeKuligaGroupTrainingModal() {
    const modal = document.getElementById('kuliga-group-training-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// Обработка отправки формы
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('kuliga-group-training-form');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = document.getElementById('kgt-submit-btn');
        const originalText = submitBtn.textContent;
        
        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Создание...';

            const sportType = document.getElementById('kgt-sport-type').value;
            const date = document.getElementById('kgt-date').value;
            const slotId = document.getElementById('kgt-slot').value;
            const level = document.getElementById('kgt-level').value;
            const description = document.getElementById('kgt-description').value;
            const maxParticipants = parseInt(document.getElementById('kgt-max-participants').value);
            const minParticipants = parseInt(document.getElementById('kgt-min-participants').value);

            // Получаем instructor_id и дату слота из выбранного слота
            const slotSelect = document.getElementById('kgt-slot');
            const selectedOption = slotSelect.options[slotSelect.selectedIndex];
            const instructorId = selectedOption.dataset.instructorId;
            const slotDate = selectedOption.dataset.slotDate; // Используем дату из слота (источник истины)

            if (!instructorId || !slotId) {
                throw new Error('Необходимо выбрать время');
            }

            // Получаем цену за человека
            const priceObj = winterPrices.find(p => 
                p.type === 'group' && 
                p.participants === maxParticipants &&
                p.is_active === true
            );

            if (!priceObj) {
                throw new Error(`Цена не найдена для группы из ${maxParticipants} человек`);
            }

            const totalPrice = parseFloat(priceObj.price);
            const pricePerPerson = totalPrice / maxParticipants;

            // Используем дату из слота, так как это источник истины
            // Если дата слота не указана, используем дату из формы
            const normalizedDate = slotDate 
                ? slotDate.split('T')[0].split(' ')[0] 
                : date.split('T')[0].split(' ')[0];
            
            console.log('Отправка данных для создания тренировки:', {
                instructor_id: parseInt(instructorId),
                slot_id: parseInt(slotId),
                date: normalizedDate,
                slotDateFromData: slotDate,
                formDate: date
            });

            const data = {
                instructor_id: parseInt(instructorId),
                slot_id: parseInt(slotId),
                date: normalizedDate,
                sport_type: sportType,
                level: level,
                description: description || null,
                price_per_person: pricePerPerson,
                min_participants: minParticipants,
                max_participants: maxParticipants
            };

            const response = await authFetch('/api/kuliga/admin/group-trainings', {
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

            alert('✅ Групповая тренировка успешно создана');
            closeKuligaGroupTrainingModal();
            
            // Перезагружаем список тренировок, если функция существует
            if (typeof loadWinterTrainings === 'function') {
                loadWinterTrainings();
            }

        } catch (error) {
            console.error('❌ Ошибка создания тренировки:', error);
            alert('❌ Ошибка: ' + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });

    // Закрытие по клику вне модального окна
    const modal = document.getElementById('kuliga-group-training-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeKuligaGroupTrainingModal();
            }
        });
    }
});

// Экспортируем функции глобально
window.openKuligaGroupTrainingModal = openKuligaGroupTrainingModal;
window.closeKuligaGroupTrainingModal = closeKuligaGroupTrainingModal;

console.log('✅ admin-kuliga-group-training.js загружен');
