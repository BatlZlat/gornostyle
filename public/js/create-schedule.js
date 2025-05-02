document.addEventListener('DOMContentLoaded', function() {
    const createScheduleForm = document.getElementById('create-schedule-form');
    const autoScheduleCheckbox = document.getElementById('auto-schedule');
    const autoScheduleSettings = document.querySelector('.auto-schedule-settings');

    // Обработчик изменения состояния чекбокса автоматического расписания
    if (autoScheduleCheckbox && autoScheduleSettings) {
        autoScheduleCheckbox.addEventListener('change', function() {
            autoScheduleSettings.style.display = this.checked ? 'block' : 'none';
        });
    }

    // Обработчик отправки формы
    if (createScheduleForm) {
        createScheduleForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            // Собираем данные о рабочих днях
            const weekdays = Array.from(document.querySelectorAll('.weekdays-select input[type="checkbox"]'))
                .filter(checkbox => checkbox.checked)
                .map(checkbox => parseInt(checkbox.value));

            // Получаем ID тренажеров из базы данных
            const simulatorsResponse = await fetch('/api/simulators');
            const simulators = await simulatorsResponse.json();

            const formData = {
                start_date: document.getElementById('schedule-start-date').value,
                end_date: document.getElementById('schedule-end-date').value,
                weekdays: weekdays,
                simulator1: {
                    id: simulators[0].id,
                    start_time: document.getElementById('simulator1-start').value,
                    end_time: document.getElementById('simulator1-end').value
                },
                simulator2: {
                    id: simulators[1].id,
                    start_time: document.getElementById('simulator2-start').value,
                    end_time: document.getElementById('simulator2-end').value
                },
                auto_schedule: autoScheduleCheckbox.checked,
                auto_schedule_settings: autoScheduleCheckbox.checked ? {
                    day: parseInt(document.getElementById('schedule-day').value),
                    time: document.getElementById('schedule-time').value,
                    timezone: document.getElementById('timezone').value
                } : null
            };

            try {
                const response = await fetch('/api/schedule', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();

                if (result.success) {
                    showSuccess('Расписание успешно создано');
                    setTimeout(() => {
                        window.location.href = 'admin.html';
                    }, 1500);
                } else {
                    throw new Error(result.error || 'Ошибка при создании расписания');
                }
            } catch (error) {
                console.error('Ошибка при создании расписания:', error);
                showError(error.message || 'Не удалось создать расписание');
            }
        });
    }

    // Функция отображения успешного сообщения
    function showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success';
        successDiv.textContent = message;
        createScheduleForm.insertBefore(successDiv, createScheduleForm.firstChild);
    }

    // Функция отображения ошибок
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;
        createScheduleForm.insertBefore(errorDiv, createScheduleForm.firstChild);
    }

    // Загрузка существующих настроек автоматического расписания
    async function loadScheduleSettings() {
        try {
            const response = await fetch('/api/schedule/settings');
            const settings = await response.json();

            if (settings.length > 0) {
                autoScheduleCheckbox.checked = true;
                autoScheduleSettings.style.display = 'block';

                // Заполняем поля настройками первого тренажера
                const firstSetting = settings[0];
                document.getElementById('schedule-day').value = firstSetting.day_of_month;
                document.getElementById('schedule-time').value = 
                    `${String(firstSetting.hour).padStart(2, '0')}:${String(firstSetting.minute).padStart(2, '0')}`;
            }
        } catch (error) {
            console.error('Ошибка при загрузке настроек расписания:', error);
        }
    }

    // Загружаем настройки при загрузке страницы
    loadScheduleSettings();
}); 