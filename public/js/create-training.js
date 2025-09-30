// === ДОБАВЛЯЮ ФУНКЦИЮ ДЛЯ ПОЛУЧЕНИЯ ТОКЕНА И ОБЕРТКУ ДЛЯ fetch ===
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
        const token = getCookie('adminToken');
        if (token) {
            options.headers = options.headers || {};
            if (options.headers instanceof Headers) {
                const headersObj = {};
                options.headers.forEach((v, k) => { headersObj[k] = v; });
                options.headers = headersObj;
            }
            options.headers['Authorization'] = `Bearer ${token}`;
        }
    }
    return originalFetch(url, options);
};

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('createTrainingForm');
    const simulatorSelect = document.getElementById('simulator');
    const dateInput = document.getElementById('date');
    const timeSlotSelect = document.getElementById('timeSlot');
    const trainerSelect = document.getElementById('trainer');
    const groupSelect = document.getElementById('group');
    const maxParticipantsSelect = document.getElementById('maxParticipants');
    const priceField = document.getElementById('trainingPrice');
    const skillLevelInput = document.getElementById('skillLevel');

    // --- Заполняем select для участников ---
    if (maxParticipantsSelect) {
        maxParticipantsSelect.innerHTML = '';
        for (let i = 2; i <= 6; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = i;
            if (i === 4) opt.selected = true;
            maxParticipantsSelect.appendChild(opt);
        }
    }

    // --- Группа обязательна ---
    groupSelect.required = true;

    // --- Загрузка тренажеров ---
    async function loadSimulators() {
        try {
            const response = await fetch('/api/simulators');
            const simulators = await response.json();
            simulatorSelect.innerHTML = '<option value="">Выберите тренажер</option>';
            simulators.forEach(simulator => {
                const option = document.createElement('option');
                option.value = simulator.id;
                option.textContent = simulator.name;
                if (!simulator.is_working) {
                    option.disabled = true;
                    option.textContent += ' (не активен)';
                }
                simulatorSelect.appendChild(option);
            });
        } catch (error) {
            showError('Не удалось загрузить список тренажеров');
        }
    }

    // --- Загрузка тренеров ---
    async function loadTrainers() {
        try {
            const response = await fetch('/api/trainers');
            const trainers = await response.json();
            trainerSelect.innerHTML = '<option value="">Без тренера</option>';
            trainers.filter(tr => tr.is_active).forEach(trainer => {
                const option = document.createElement('option');
                option.value = trainer.id;
                option.textContent = `${trainer.full_name} (${trainer.sport_type})`;
                trainerSelect.appendChild(option);
            });
        } catch (error) {
            showError('Не удалось загрузить список тренеров');
        }
    }

    // --- Загрузка групп ---
    async function loadGroups() {
        try {
            const response = await fetch('/api/groups');
            const groups = await response.json();
            groupSelect.innerHTML = '<option value="">Выберите группу</option>';
            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                groupSelect.appendChild(option);
            });
        } catch (error) {
            showError('Не удалось загрузить список групп');
        }
    }

    // --- Загрузка временных слотов ---
    async function loadTimeSlots() {
        const simulatorId = simulatorSelect.value;
        const date = dateInput.value;
        if (!simulatorId || !date) {
            timeSlotSelect.innerHTML = '<option value="">Сначала выберите тренажер и дату</option>';
            return;
        }
        try {
            const response = await fetch(`/api/schedule?date=${date}&simulator_id=${simulatorId}`);
            const slots = await response.json();
            if (!slots || slots.length === 0) {
                timeSlotSelect.innerHTML = '<option value="">Нет доступных временных слотов</option>';
                return;
            }
            timeSlotSelect.innerHTML = '<option value="">Выберите время</option>';
            slots.forEach(slot => {
                const option = document.createElement('option');
                option.value = slot.id;
                option.textContent = formatTime(slot.start_time);
                if (slot.is_booked || slot.is_holiday) {
                    option.disabled = true;
                    option.style.color = '#aaa';
                    option.textContent += slot.is_booked ? ' (занято)' : ' (выходной)';
                }
                timeSlotSelect.appendChild(option);
            });
        } catch (error) {
            showError('Не удалось загрузить временные слоты');
        }
    }

    // --- Форматирование времени ---
    function formatTime(timeString) {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
    }

    // --- Пересчет цены ---
    async function recalcPrice() {
        if (!priceField) return;
        const withTrainer = !!trainerSelect.value;
        const participants = Number(maxParticipantsSelect.value);
        try {
            const response = await fetch('/api/prices');
            const prices = await response.json();
            // Формируем ключ для поиска цены
            const key = `group_${withTrainer ? 'true' : 'false'}_60_${participants}`;
            const price = prices[key];
            if (price !== undefined) {
                priceField.textContent = `Стоимость: ${price} ₽`;
                priceField.dataset.price = price;
            } else {
                priceField.textContent = 'Нет цены для выбранных параметров';
                priceField.dataset.price = '';
            }
        } catch (e) {
            priceField.textContent = 'Ошибка загрузки цены';
            priceField.dataset.price = '';
        }
    }

    trainerSelect.addEventListener('change', recalcPrice);
    maxParticipantsSelect.addEventListener('change', recalcPrice);

    simulatorSelect.addEventListener('change', loadTimeSlots);
    dateInput.addEventListener('change', loadTimeSlots);

    // --- Отправка формы ---
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Защита от множественных отправок
        if (form.dataset.submitting === 'true') {
            console.log('Форма уже отправляется, игнорируем повторное нажатие');
            return;
        }
        
        // Устанавливаем флаг отправки
        form.dataset.submitting = 'true';
        
        // Получаем кнопку отправки и блокируем её
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Создание тренировки...';
        
        try {
            const formData = new FormData(form);
            const withTrainer = !!formData.get('trainer_id');
            const price = Number(priceField.dataset.price) || 0;
            const data = {
                simulator_id: formData.get('simulator_id'),
                trainer_id: formData.get('trainer_id') || null,
                group_id: formData.get('group_id'),
                date: formData.get('date'),
                time_slot_id: formData.get('time_slot_id'),
                skill_level: formData.get('skill_level') || null,
                max_participants: formData.get('max_participants'),
                training_type: true,
                with_trainer: withTrainer,
                price: price,
                duration: 60
            };
            
            const response = await fetch('/api/trainings', {
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
            
            showSuccess('Тренировка успешно создана');
            setTimeout(() => {
                window.location.href = 'admin.html';
            }, 2000);
            
        } catch (error) {
            showError(error.message);
        } finally {
            // Восстанавливаем кнопку (только если не произошло перенаправление)
            if (form.dataset.submitting === 'true') {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
                form.dataset.submitting = 'false';
            }
        }
    });

    // --- Функции отображения ошибок и успеха ---
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;
        document.querySelector('.form-container').insertBefore(errorDiv, document.querySelector('.form-actions'));
        setTimeout(() => errorDiv.remove(), 3000);
    }
    function showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success';
        successDiv.textContent = message;
        document.querySelector('.form-container').insertBefore(successDiv, document.querySelector('.form-actions'));
    }

    // --- Инициализация ---
    loadSimulators();
    loadTrainers();
    loadGroups();
    recalcPrice();
}); 