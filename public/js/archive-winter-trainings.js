document.addEventListener('DOMContentLoaded', function() {
    const archiveList = document.querySelector('.archive-list');
    const applyFiltersBtn = document.getElementById('apply-filters');
    const dateFrom = document.getElementById('archive-date-from');
    const dateTo = document.getElementById('archive-date-to');
    const trainerSelect = document.getElementById('archive-trainer');

    // Функция для получения токена
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

    // Обертка для fetch с авторизацией
    async function authFetch(url, options = {}) {
        const token = getAuthToken();
        if (!token) {
            throw new Error('Требуется авторизация');
        }
        
        options.headers = options.headers || {};
        options.headers['Authorization'] = `Bearer ${token}`;
        
        return fetch(url, options);
    }

    // Функция для форматирования даты с днем недели
    function formatDateWithWeekday(dateString) {
        const date = new Date(dateString);
        const weekdays = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
        const weekday = weekdays[date.getDay()];
        const dateFormatted = date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        return `${dateFormatted} (${weekday})`;
    }

    // Загрузка списка тренеров
    async function loadTrainers() {
        try {
            const response = await authFetch('/api/trainers');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const trainers = await response.json();
            
            const trainersArray = Array.isArray(trainers) ? trainers : (trainers.trainers || []);
            
            if (trainerSelect) {
                trainerSelect.innerHTML = '<option value="">Все тренеры</option>' +
                    trainersArray
                        .filter(tr => tr.is_active !== false)
                        .map(trainer => 
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

            console.log('Запрос архивных зимних тренировок с параметрами:', params.toString());
            const response = await authFetch(`/api/winter-trainings/archive?${params.toString()}`);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Ошибка сервера:', errorData);
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Полученные данные архива:', data);
            
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

                // Группируем тренировки по дате
                const grouped = {};
                data.forEach(training => {
                    const date = training.date;
                    if (!grouped[date]) grouped[date] = [];
                    grouped[date].push(training);
                });

                // Формируем HTML
                let html = '';
                Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a)).forEach(date => {
                    html += `
                        <div class="training-date-header">${formatDateWithWeekday(date)}</div>
                        <div class="training-table-container">
                            <table class="training-table">
                                <thead>
                                    <tr>
                                        <th>Время</th>
                                        <th>Тип</th>
                                        <th>Название</th>
                                        <th>Тренер</th>
                                        <th>Участников</th>
                                        <th>Уровень</th>
                                        <th>Цена (за чел.)</th>
                                        <th>Статус</th>
                                        <th>Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${grouped[date].map(training => {
                                        const isIndividual = !training.is_group;
                                        const typeLabels = {
                                            individual: 'Индивидуальное',
                                            sport_group: 'Спортивная группа',
                                            group: 'Групповая'
                                        };
                                        const type = isIndividual ? 'Индивидуальная' : (typeLabels[training.winter_training_type] || 'Групповая');
                                        
                                        // Для индивидуальных тренировок показываем имя участника
                                        let name;
                                        if (isIndividual) {
                                            name = training.participant_names || 'Естественный склон';
                                        } else {
                                            name = training.group_name || 'Групповая тренировка';
                                        }
                                        
                                        const startTime = training.start_time ? training.start_time.slice(0, 5) : '—';
                                        const endTime = training.end_time ? training.end_time.slice(0, 5) : '—';
                                        
                                        const currentParticipants = training.current_participants || (isIndividual ? 1 : 0);
                                        const maxParticipants = training.max_participants || (isIndividual ? 1 : 1);
                                        
                                        const statusLabels = {
                                            scheduled: 'Запланирована',
                                            completed: 'Завершена',
                                            cancelled: 'Отменена'
                                        };
                                        
                                        const statusColors = {
                                            scheduled: '#2196F3',
                                            completed: '#4CAF50',
                                            cancelled: '#f44336'
                                        };
                                        
                                        const status = statusLabels[training.status] || training.status || '—';
                                        const statusColor = statusColors[training.status] || '#666';
                                        
                                        // Цена за человека
                                        let pricePerPerson = '—';
                                        if (training.price != null && maxParticipants > 0) {
                                            const totalPrice = parseFloat(training.price);
                                            pricePerPerson = `${(totalPrice / maxParticipants).toFixed(2)} ₽`;
                                        }
                                        
                                        return `
                                            <tr class="training-row">
                                                <td>${startTime} - ${endTime}</td>
                                                <td>${type}</td>
                                                <td>${name}</td>
                                                <td>${training.trainer_name || 'Не назначен'}</td>
                                                <td>${currentParticipants}/${maxParticipants}</td>
                                                <td>${training.skill_level || '—'}</td>
                                                <td>${pricePerPerson}</td>
                                                <td><span style="color:${statusColor};font-weight:bold;">${status}</span></td>
                                                <td class="training-actions">
                                                    <button class="btn-secondary" onclick="viewWinterTrainingDetails(${training.id})">
                                                        Подробнее
                                                    </button>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                });

                archiveList.innerHTML = html;
            }
        } catch (error) {
            console.error('Ошибка при загрузке архивных тренировок:', error);
            if (archiveList) {
                archiveList.innerHTML = `<div class="alert alert-danger">Ошибка: ${error.message}</div>`;
            }
        }
    }

    // Функция просмотра деталей тренировки
    window.viewWinterTrainingDetails = function(trainingId) {
        // Используем функцию из admin.js если доступна
        if (typeof viewScheduleDetails === 'function') {
            viewScheduleDetails(trainingId, false, 'natural_slope');
        } else {
            // Открываем в новой вкладке или показываем модальное окно
            window.open(`admin.html?view_training=${trainingId}`, '_blank');
        }
    };

    // Обработчик применения фильтров
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', loadArchiveTrainings);
    }

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
            const mainContent = document.querySelector('.admin-main') || document.querySelector('main');
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

