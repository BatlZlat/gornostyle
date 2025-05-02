document.addEventListener('DOMContentLoaded', function() {
    const archiveList = document.querySelector('.archive-list');
    const applyFiltersBtn = document.getElementById('apply-filters');
    const dateFrom = document.getElementById('archive-date-from');
    const dateTo = document.getElementById('archive-date-to');
    const trainerSelect = document.getElementById('archive-trainer');

    // Загрузка списка тренеров
    async function loadTrainers() {
        try {
            const response = await fetch('/api/trainers');
            const trainers = await response.json();
            
            if (trainerSelect) {
                trainerSelect.innerHTML = '<option value="">Все тренеры</option>' +
                    trainers.map(trainer => 
                        `<option value="${trainer.id}">${trainer.name}</option>`
                    ).join('');
            }
        } catch (error) {
            console.error('Ошибка при загрузке тренеров:', error);
            showError('Не удалось загрузить список тренеров');
        }
    }

    // Загрузка архивных тренировок
    async function loadArchiveTrainings() {
        try {
            const params = new URLSearchParams();
            if (dateFrom.value) params.append('date_from', dateFrom.value);
            if (dateTo.value) params.append('date_to', dateTo.value);
            if (trainerSelect.value) params.append('trainer_id', trainerSelect.value);

            const response = await fetch(`/api/trainings/archive?${params.toString()}`);
            const trainings = await response.json();
            
            if (archiveList) {
                archiveList.innerHTML = trainings.map(training => `
                    <div class="archive-item">
                        <div class="training-info">
                            <h3>Тренировка от ${formatDate(training.date)}</h3>
                            <p>Время: ${training.start_time} - ${training.end_time}</p>
                            <p>Тренажер: ${training.simulator_name}</p>
                            <p>Группа: ${training.group_name}</p>
                            <p>Тренер: ${training.trainer_name}</p>
                            <p>Участников: ${training.participants_count}/${training.max_participants}</p>
                        </div>
                        <div class="training-actions">
                            <button class="btn-secondary" onclick="viewTrainingDetails(${training.id})">Подробнее</button>
                        </div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Ошибка при загрузке архивных тренировок:', error);
            showError('Не удалось загрузить архив тренировок');
        }
    }

    // Форматирование даты
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU');
    }

    // Обработчик применения фильтров
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', loadArchiveTrainings);
    }

    // Функция просмотра деталей тренировки
    window.viewTrainingDetails = function(trainingId) {
        window.location.href = `training-details.html?id=${trainingId}`;
    };

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }

    // Инициализация
    loadTrainers();
    loadArchiveTrainings();
}); 