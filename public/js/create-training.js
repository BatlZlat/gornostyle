document.addEventListener('DOMContentLoaded', function() {
    const createTrainingForm = document.getElementById('create-training-form');
    const trainingDate = document.getElementById('training-date');
    const simulatorSelect = document.getElementById('simulator');
    const timeSlotSelect = document.getElementById('time-slot');
    const trainerSelect = document.getElementById('trainer');

    // Загрузка списка тренажеров
    async function loadSimulators() {
        try {
            const response = await fetch('/api/simulators');
            const simulators = await response.json();
            
            simulatorSelect.innerHTML = '<option value="">Выберите тренажер</option>' + 
                simulators.map(simulator => 
                    `<option value="${simulator.id}" ${!simulator.is_working ? 'disabled' : ''}>
                        ${simulator.name} ${!simulator.is_working ? '(не активен)' : ''}
                    </option>`
                ).join('');
        } catch (error) {
            console.error('Ошибка при загрузке тренажеров:', error);
            showError('Не удалось загрузить список тренажеров');
        }
    }

    // Загрузка временных слотов
    async function loadTimeSlots() {
        const date = trainingDate.value;
        const simulatorId = simulatorSelect.value;

        if (!date || !simulatorId) {
            timeSlotSelect.innerHTML = '<option value="">Сначала выберите дату и тренажер</option>';
            return;
        }

        try {
            const response = await fetch(`/api/schedule?date=${date}&simulator_id=${simulatorId}`);
            const slots = await response.json();
            
            if (!slots || slots.length === 0) {
                timeSlotSelect.innerHTML = '<option value="">Нет доступных временных слотов</option>';
                return;
            }

            timeSlotSelect.innerHTML = '<option value="">Выберите время</option>' + 
                slots.map(slot => {
                    const isDisabled = slot.is_booked || slot.is_holiday;
                    const statusText = slot.is_booked ? '(занято)' : slot.is_holiday ? '(выходной)' : '';
                    return `
                        <option value="${slot.id}" ${isDisabled ? 'disabled' : ''}>
                            ${formatTime(slot.start_time)} ${statusText}
                        </option>
                    `;
                }).join('');
        } catch (error) {
            console.error('Ошибка при загрузке временных слотов:', error);
            showError('Не удалось загрузить временные слоты');
        }
    }

    // Загрузка списка тренеров
    async function loadTrainers() {
        try {
            const response = await fetch('/api/trainers');
            const trainers = await response.json();
            
            trainerSelect.innerHTML = '<option value="">Выберите тренера</option>' + 
                trainers
                    .filter(trainer => trainer.is_active)
                    .map(trainer => 
                        `<option value="${trainer.id}">${trainer.full_name} (${trainer.sport_type})</option>`
                    ).join('');
        } catch (error) {
            console.error('Ошибка при загрузке тренеров:', error);
            showError('Не удалось загрузить список тренеров');
        }
    }

    // Форматирование времени
    function formatTime(timeString) {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
    }

    // Обработчики событий
    if (trainingDate) {
        trainingDate.addEventListener('change', loadTimeSlots);
    }

    if (simulatorSelect) {
        simulatorSelect.addEventListener('change', loadTimeSlots);
    }

    // Обработчик отправки формы
    if (createTrainingForm) {
        createTrainingForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = {
                date: trainingDate.value,
                simulator_id: simulatorSelect.value,
                time_slot_id: timeSlotSelect.value,
                skill_level: document.getElementById('skill-level').value,
                trainer_id: trainerSelect.value,
                max_participants: document.getElementById('max-participants').value,
                is_group_session: true
            };

            try {
                const response = await fetch('/api/trainings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    showSuccess('Групповая тренировка успешно создана');
                    setTimeout(() => {
                        window.location.href = 'admin.html';
                    }, 2000);
                } else {
                    const error = await response.json();
                    throw new Error(error.message || 'Ошибка при создании тренировки');
                }
            } catch (error) {
                console.error('Ошибка при создании тренировки:', error);
                showError(error.message || 'Не удалось создать тренировку');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;
        document.querySelector('.form-container').insertBefore(errorDiv, document.querySelector('.form-actions'));
        setTimeout(() => errorDiv.remove(), 3000);
    }

    // Функция отображения успешного сообщения
    function showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success';
        successDiv.textContent = message;
        document.querySelector('.form-container').insertBefore(successDiv, document.querySelector('.form-actions'));
    }

    // Инициализация
    loadSimulators();
    loadTrainers();
}); 