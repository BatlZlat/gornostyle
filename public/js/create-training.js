document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('createTrainingForm');
    const simulatorSelect = document.getElementById('simulator');
    const dateInput = document.getElementById('date');
    const timeSlotSelect = document.getElementById('timeSlot');
    const trainerSelect = document.getElementById('trainer');
    const groupSelect = document.getElementById('group');
    const maxParticipantsInput = document.getElementById('maxParticipants');

    // Загрузка тренажеров
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
            console.error('Ошибка при загрузке тренажеров:', error);
            showError('Не удалось загрузить список тренажеров');
        }
    }

    // Загрузка тренеров
    async function loadTrainers() {
        try {
            const response = await fetch('/api/trainers');
            const trainers = await response.json();
            
            trainerSelect.innerHTML = '<option value="">Выберите тренера</option>';
            trainers
                .filter(trainer => trainer.is_active)
                .forEach(trainer => {
                    const option = document.createElement('option');
                    option.value = trainer.id;
                    option.textContent = `${trainer.full_name} (${trainer.sport_type})`;
                    trainerSelect.appendChild(option);
                });
        } catch (error) {
            console.error('Ошибка при загрузке тренеров:', error);
            showError('Не удалось загрузить список тренеров');
        }
    }

    // Загрузка групп
    async function loadGroups() {
        try {
            const response = await fetch('/api/groups');
            const groups = await response.json();
            
            groupSelect.innerHTML = '<option value="">Выберите группу (необязательно)</option>';
            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                groupSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Ошибка при загрузке групп:', error);
            showError('Не удалось загрузить список групп');
        }
    }

    // Загрузка временных слотов
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
                    option.textContent += slot.is_booked ? ' (занято)' : ' (выходной)';
                }
                timeSlotSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Ошибка при загрузке временных слотов:', error);
            showError('Не удалось загрузить временные слоты');
        }
    }

    // Форматирование времени
    function formatTime(timeString) {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
    }

    // Обработка изменения группы
    groupSelect.addEventListener('change', function() {
        // Если выбрана группа, устанавливаем training_type в true
        if (this.value) {
            maxParticipantsInput.min = 2;
            maxParticipantsInput.value = Math.max(2, maxParticipantsInput.value);
        } else {
            maxParticipantsInput.min = 1;
            maxParticipantsInput.value = Math.max(1, maxParticipantsInput.value);
        }
    });

    // Обработчики событий
    simulatorSelect.addEventListener('change', loadTimeSlots);
    dateInput.addEventListener('change', loadTimeSlots);

    // Обработка отправки формы
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = new FormData(form);
        const data = {
            simulator_id: formData.get('simulator_id'),
            trainer_id: formData.get('trainer_id'),
            group_id: formData.get('group_id') || null,
            date: formData.get('date'),
            time_slot_id: formData.get('time_slot_id'),
            skill_level: formData.get('skill_level') || null,
            max_participants: formData.get('max_participants'),
            training_type: !!formData.get('group_id') // true если выбрана группа, false если нет
        };

        try {
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

            const result = await response.json();
            showSuccess('Тренировка успешно создана');
            setTimeout(() => {
                window.location.href = 'admin.html';
            }, 2000);
        } catch (error) {
            console.error('Ошибка при создании тренировки:', error);
            showError(error.message);
        }
    });

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
    loadGroups();
}); 