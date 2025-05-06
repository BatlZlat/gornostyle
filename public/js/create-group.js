document.addEventListener('DOMContentLoaded', function() {
    const createGroupForm = document.getElementById('create-group-form');
    const errorContainer = document.createElement('div');
    errorContainer.className = 'alert alert-danger';
    errorContainer.style.display = 'none';
    createGroupForm.parentNode.insertBefore(errorContainer, createGroupForm);

    if (createGroupForm) {
        createGroupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            hideError();

            const nameInput = document.getElementById('group-name');
            const descriptionInput = document.getElementById('group-description');

            // Валидация формы
            if (!nameInput.value.trim()) {
                showError('Название группы обязательно');
                nameInput.focus();
                return;
            }

            const formData = {
                name: nameInput.value.trim(),
                description: descriptionInput.value.trim()
            };

            try {
                console.log('Отправка данных:', formData);
                const response = await fetch('/api/groups', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                console.log('Получен ответ:', response.status);
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error('Сервер вернул неверный формат данных');
                }

                const data = await response.json();
                console.log('Данные ответа:', data);

                if (response.ok) {
                    // Перенаправляем на страницу списка групп после успешного создания
                    window.location.href = 'groups.html';
                } else {
                    throw new Error(data.error || 'Ошибка при создании группы');
                }
            } catch (error) {
                console.error('Ошибка при создании группы:', error);
                showError(error.message || 'Не удалось создать группу');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }

    // Функция скрытия ошибок
    function hideError() {
        errorContainer.style.display = 'none';
    }

    loadTrainings();
});

async function loadTrainings() {
    try {
        const response = await fetch('/api/trainings');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Проверяем, что data существует и является массивом
        if (!data || !Array.isArray(data)) {
            console.error('Получены некорректные данные:', data);
            throw new Error('Получены некорректные данные от сервера');
        }

        const trainingList = document.querySelector('.training-list');
        if (!trainingList) {
            console.error('Элемент .training-list не найден на странице');
            return;
        }

        // Фильтруем только текущие и будущие тренировки
        const currentDate = new Date();
        const validTrainings = data.filter(training => {
            const trainingDate = new Date(training.session_date);
            return trainingDate >= currentDate;
        });

        if (validTrainings.length === 0) {
            trainingList.innerHTML = '<div class="alert alert-info">Нет доступных тренировок</div>';
            return;
        }

        // Группируем тренировки по датам
        const groupedTrainings = validTrainings.reduce((acc, training) => {
            const date = new Date(training.session_date).toLocaleDateString('ru-RU');
            if (!acc[date]) {
                acc[date] = [];
            }
            acc[date].push(training);
            return acc;
        }, {});

        // Сортируем даты
        const sortedDates = Object.keys(groupedTrainings).sort((a, b) => {
            return new Date(a.split('.').reverse().join('-')) - new Date(b.split('.').reverse().join('-'));
        });

        // Формируем HTML
        let html = '';
        sortedDates.forEach(date => {
            html += `
                <div class="training-date-group">
                    <h3 class="date-header">${date}</h3>
                    <div class="trainings-for-date">
                        ${groupedTrainings[date].map(training => `
                            <div class="training-item">
                                <div class="training-info">
                                    <div class="time">${training.start_time} - ${training.end_time}</div>
                                    <div class="details">
                                        <span>Группа: ${training.group_name || 'Не указана'}</span>
                                        <span>Тренер: ${training.trainer_name || 'Не указан'}</span>
                                        <span>Тренажер: ${training.simulator_id}</span>
                                        <span>Участников: ${training.max_participants}</span>
                                        <span>Уровень: ${training.skill_level}</span>
                                        <span>Цена: ${training.price} ₽</span>
                                    </div>
                                </div>
                                <div class="training-actions">
                                    <button class="btn-secondary" onclick="editTraining(${training.id})">
                                        Редактировать тренировку
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        trainingList.innerHTML = html;
    } catch (error) {
        console.error('Ошибка при загрузке тренировок:', error);
        const trainingList = document.querySelector('.training-list');
        if (trainingList) {
            trainingList.innerHTML = `
                <div class="alert alert-danger">
                    Ошибка при загрузке тренировок: ${error.message}
                </div>
            `;
        }
    }
}

// Добавляем стили для нового отображения
const style = document.createElement('style');
style.textContent = `
    .training-date-group {
        margin-bottom: 2rem;
    }

    .date-header {
        text-align: center;
        padding: 1rem;
        background-color: #f8f9fa;
        border-radius: 4px;
        margin-bottom: 1rem;
    }

    .trainings-for-date {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .training-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        border: 1px solid #dee2e6;
        border-radius: 4px;
    }

    .training-info {
        display: flex;
        gap: 2rem;
        align-items: center;
    }

    .time {
        font-weight: bold;
        min-width: 100px;
    }

    .details {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .details span {
        background-color: #e9ecef;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.9rem;
    }

    .training-actions {
        display: flex;
        gap: 0.5rem;
    }
`;
document.head.appendChild(style); 