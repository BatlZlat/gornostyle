document.addEventListener('DOMContentLoaded', function() {
    const archiveList = document.querySelector('.archive-list');
    const applyFiltersBtn = document.getElementById('apply-filters');
    const dateFrom = document.getElementById('archive-date-from');
    const dateTo = document.getElementById('archive-date-to');
    const trainerSelect = document.getElementById('archive-trainer');

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

    // Загрузка списка тренеров
    async function loadTrainers() {
        try {
            const response = await fetch('/api/trainers');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const trainers = await response.json();
            
            if (trainerSelect) {
                trainerSelect.innerHTML = '<option value="">Все тренеры</option>' +
                    trainers.map(trainer => 
                        `<option value="${trainer.id}">${trainer.full_name}</option>`
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
            
            // Если не выбрана дата начала, используем дату 30 дней назад
            if (!dateFrom.value) {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                params.append('date_from', thirtyDaysAgo.toISOString().split('T')[0]);
            } else {
                params.append('date_from', dateFrom.value);
            }
            
            if (dateTo.value) params.append('date_to', dateTo.value);
            if (trainerSelect.value) params.append('trainer_id', trainerSelect.value);

            console.log('Запрос архивных тренировок с параметрами:', params.toString());
            const response = await fetch(`/api/trainings/archive?${params.toString()}`);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Ошибка сервера:', errorData);
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Полученные данные:', data);
            
            // Проверяем, что data является массивом
            if (!Array.isArray(data)) {
                console.error('Получены некорректные данные:', data);
                throw new Error('Получены некорректные данные от сервера');
            }
            
            if (archiveList) {
                if (data.length === 0) {
                    archiveList.innerHTML = '<div class="alert alert-info">Нет архивных тренировок за выбранный период</div>';
                    return;
                }

                // Сортируем тренировки по дате (от новых к старым)
                data.sort((a, b) => new Date(b.session_date) - new Date(a.session_date));

                // Группируем тренировки по дате
                const grouped = {};
                data.forEach(training => {
                    const date = new Date(training.session_date).toLocaleDateString('ru-RU');
                    if (!grouped[date]) grouped[date] = [];
                    grouped[date].push(training);
                });

                // Формируем HTML
                let html = '';
                Object.keys(grouped).forEach(date => {
                    html += `
                        <div class="training-date-header">${date}</div>
                        <div class="training-table-container">
                            <table class="training-table">
                                <thead>
                                    <tr>
                                        <th>Время</th>
                                        <th>Группа</th>
                                        <th>Тренер</th>
                                        <th>Тренажёр</th>
                                        <th>Участников</th>
                                        <th>Уровень</th>
                                        <th>Цена</th>
                                        <th>Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${grouped[date].map(training => `
                                        <tr class="training-row ${training.simulator_id === 2 ? 'simulator-2' : ''}">
                                            <td>${training.start_time.slice(0,5)} - ${training.end_time.slice(0,5)}</td>
                                            <td>${training.group_name || 'Не указана'}</td>
                                            <td>${training.trainer_name || 'Не указан'}</td>
                                            <td>Тренажёр ${training.simulator_id}</td>
                                            <td>${training.participants_count || 0}/${training.max_participants || 0}</td>
                                            <td>${training.skill_level}</td>
                                            <td>${training.price} ₽</td>
                                            <td class="training-actions">
                                                <button class="btn-secondary" onclick="viewTrainingDetails(${training.id})">
                                                    Подробнее
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                });

                archiveList.innerHTML = html;
            }
        } catch (error) {
            console.error('Ошибка при загрузке архивных тренировок:', error);
            showError(error.message || 'Не удалось загрузить архив тренировок');
        }
    }

    // Форматирование даты
    function formatDate(dateString) {
        if (!dateString) return 'Дата не указана';
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
        // Создаем элемент для ошибки
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;

        // Находим контейнер для ошибок или создаем его
        let errorContainer = document.querySelector('.error-container');
        if (!errorContainer) {
            errorContainer = document.createElement('div');
            errorContainer.className = 'error-container';
            const mainContent = document.querySelector('.archive-content') || document.querySelector('main');
            if (mainContent) {
                mainContent.insertBefore(errorContainer, mainContent.firstChild);
            } else {
                document.body.insertBefore(errorContainer, document.body.firstChild);
            }
        }

        // Добавляем ошибку в контейнер
        errorContainer.appendChild(errorDiv);

        // Удаляем ошибку через 3 секунды
        setTimeout(() => {
            errorDiv.remove();
            // Если контейнер пуст, удаляем его
            if (errorContainer.children.length === 0) {
                errorContainer.remove();
            }
        }, 3000);
    }

    // Инициализация
    loadTrainers();
    loadArchiveTrainings();
}); 