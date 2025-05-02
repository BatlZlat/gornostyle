document.addEventListener('DOMContentLoaded', function() {
    const createTrainingForm = document.getElementById('create-training-form');
    const trainingGroup = document.getElementById('training-group');
    const timeSlot = document.getElementById('time-slot');

    // Загрузка списка групп
    async function loadGroups() {
        try {
            const response = await fetch('/api/groups');
            const groups = await response.json();
            
            if (trainingGroup) {
                trainingGroup.innerHTML = groups.map(group => 
                    `<option value="${group.id}">${group.name}</option>`
                ).join('');
            }
        } catch (error) {
            console.error('Ошибка при загрузке групп:', error);
            showError('Не удалось загрузить список групп');
        }
    }

    // Загрузка временных слотов
    async function loadTimeSlots() {
        try {
            const date = document.getElementById('training-date').value;
            const simulator = document.getElementById('simulator').value;
            
            const response = await fetch(`/api/time-slots?date=${date}&simulator=${simulator}`);
            const slots = await response.json();
            
            if (timeSlot) {
                timeSlot.innerHTML = slots.map(slot => 
                    `<option value="${slot.id}">${slot.start_time} - ${slot.end_time}</option>`
                ).join('');
            }
        } catch (error) {
            console.error('Ошибка при загрузке временных слотов:', error);
            showError('Не удалось загрузить временные слоты');
        }
    }

    // Обработчик изменения даты или тренажера
    const trainingDate = document.getElementById('training-date');
    const simulator = document.getElementById('simulator');

    if (trainingDate) {
        trainingDate.addEventListener('change', loadTimeSlots);
    }

    if (simulator) {
        simulator.addEventListener('change', loadTimeSlots);
    }

    // Обработчик отправки формы
    if (createTrainingForm) {
        createTrainingForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = {
                date: document.getElementById('training-date').value,
                group_id: document.getElementById('training-group').value,
                max_participants: document.getElementById('max-participants').value,
                skill_level: document.getElementById('skill-level').value,
                simulator_id: document.getElementById('simulator').value,
                time_slot_id: document.getElementById('time-slot').value
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
                    // Перенаправляем на страницу тренировок после успешного создания
                    window.location.href = 'admin.html';
                } else {
                    throw new Error('Ошибка при создании тренировки');
                }
            } catch (error) {
                console.error('Ошибка при создании тренировки:', error);
                showError('Не удалось создать тренировку');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }

    // Инициализация
    loadGroups();
    loadTimeSlots();
}); 