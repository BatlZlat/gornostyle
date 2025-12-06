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
            
            // По умолчанию показываем за текущий месяц
            if (!dateFrom.value) {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                params.append('date_from', startOfMonth.toISOString().split('T')[0]);
                // Устанавливаем значения в поля для отображения
                dateFrom.valueAsDate = startOfMonth;
            } else {
                params.append('date_from', dateFrom.value);
            }
            
            if (!dateTo.value) {
                const now = new Date();
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                params.append('date_to', endOfMonth.toISOString().split('T')[0]);
                // Устанавливаем значения в поля для отображения
                dateTo.valueAsDate = endOfMonth;
            } else {
                params.append('date_to', dateTo.value);
            }
            
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
                                        // Определяем тип тренировки на основе is_individual или winter_training_type
                                        // is_individual может быть boolean или undefined
                                        let isIndividual = false;
                                        if (training.is_individual !== undefined) {
                                            isIndividual = training.is_individual === true || training.is_individual === 'true';
                                        } else if (training.winter_training_type === 'individual') {
                                            isIndividual = true;
                                        }
                                        
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
                                        
                                        // Расширенные метки статусов для всех типов тренировок
                                        const statusLabels = {
                                            scheduled: 'Запланирована',
                                            completed: 'Завершена',
                                            cancelled: 'Отменена',
                                            pending: 'Ожидание',
                                            confirmed: 'Подтверждено',
                                            refunded: 'Возврат',
                                            open: 'Открыта'
                                        };
                                        
                                        const statusColors = {
                                            scheduled: '#2196F3',
                                            completed: '#4CAF50',
                                            cancelled: '#f44336',
                                            pending: '#FF9800',
                                            confirmed: '#4CAF50',
                                            refunded: '#9E9E9E',
                                            open: '#2196F3'
                                        };
                                        
                                        const status = statusLabels[training.status] || training.status || '—';
                                        const statusColor = statusColors[training.status] || '#666';
                                        
                                        // Цена за человека
                                        let pricePerPerson = '—';
                                        if (training.price != null && maxParticipants > 0) {
                                            const totalPrice = parseFloat(training.price);
                                            pricePerPerson = `${(totalPrice / maxParticipants).toFixed(2)} ₽`;
                                        }
                                        
                                        // Для тренировок Кулиги используем специальные функции просмотра/удаления
                                        const isKuliga = training.training_source === 'kuliga';
                                        const viewFunction = isKuliga 
                                            ? `viewKuligaArchiveTrainingDetails(${training.id}, '${training.kuliga_type || 'group'}')`
                                            : `viewWinterTrainingDetails(${training.id})`;
                                        const deleteFunction = isKuliga
                                            ? `deleteKuligaArchiveTraining(${training.id}, '${training.kuliga_type || 'group'}')`
                                            : `deleteArchiveWinterTraining(${training.id})`;
                                        
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
                                                    <button class="btn-secondary" onclick="${viewFunction}">
                                                        Подробнее
                                                    </button>
                                                    <button class="btn-danger" onclick="${deleteFunction}" style="margin-left: 5px;">
                                                        Удалить
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

    // Функция просмотра деталей тренировки Кулиги из архива
    window.viewKuligaArchiveTrainingDetails = async function(trainingId, kuligaType) {
        try {
            const token = getAuthToken();
            const response = await authFetch(`/api/kuliga/admin/training/${trainingId}?type=${kuligaType || 'group'}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Ошибка получения данных');
            }
            
            // Используем функцию из admin.js для отображения
            if (typeof window.viewKuligaTrainingDetails === 'function') {
                window.viewKuligaTrainingDetails(trainingId, kuligaType);
            } else {
                alert('Детали тренировки Кулиги загружены, но функция отображения не найдена');
            }
        } catch (error) {
            console.error('Ошибка при загрузке деталей тренировки Кулиги:', error);
            alert('Ошибка при загрузке деталей тренировки: ' + error.message);
        }
    };
    
    // Функция удаления тренировки Кулиги из архива
    window.deleteKuligaArchiveTraining = async function(trainingId, kuligaType) {
        if (!confirm('Вы уверены, что хотите удалить эту тренировку Кулиги? Это действие нельзя отменить.')) {
            return;
        }
        
        try {
            const response = await authFetch(`/api/kuliga/admin/training/${trainingId}?type=${kuligaType || 'group'}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка при удалении тренировки');
            }
            
            const result = await response.json();
            if (result.success) {
                alert(`✅ Тренировка успешно удалена${result.refund ? `\n\n💰 Возвращено средств: ${Number(result.refund).toFixed(2)} руб.` : ''}`);
                loadArchiveTrainings();
            } else {
                throw new Error(result.error || 'Ошибка при удалении тренировки');
            }
        } catch (error) {
            console.error('Ошибка удаления тренировки Кулиги:', error);
            alert('❌ Ошибка при удалении тренировки: ' + error.message);
        }
    };

    // Функция просмотра деталей тренировки
    window.viewWinterTrainingDetails = async function(trainingId) {
        try {
            const response = await authFetch(`/api/winter-trainings/${trainingId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const training = await response.json();
            
            // Форматируем дату
            function formatDate(dateString) {
                if (!dateString) return '—';
                const date = new Date(dateString);
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                return `${day}.${month}.${year}`;
            }
            
            const startTime = training.start_time ? training.start_time.slice(0, 5) : '—';
            const endTime = training.end_time ? training.end_time.slice(0, 5) : '—';
            
            const typeLabels = {
                individual: 'Индивидуальное',
                sport_group: 'Спортивная группа',
                group: 'Групповая'
            };
            const type = typeLabels[training.winter_training_type] || 'Групповая';
            
            const statusLabels = {
                scheduled: 'Запланирована',
                completed: 'Завершена',
                cancelled: 'Отменена'
            };
            const status = statusLabels[training.status] || training.status || '—';
            
            // Цена за человека
            let pricePerPerson = '—';
            let totalPrice = '—';
            if (training.price != null && training.max_participants > 0) {
                const price = parseFloat(training.price);
                pricePerPerson = `${(price / training.max_participants).toFixed(2)} ₽`;
                totalPrice = `${price.toFixed(2)} ₽`;
            }
            
            // Создаем модальное окно
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'block';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 800px;">
                    <h3>Детали зимней тренировки</h3>
                    <div class="training-details">
                        <div class="detail-group">
                            <h4>Основная информация</h4>
                            <p><strong>Дата:</strong> ${formatDate(training.session_date)}</p>
                            <p><strong>Время:</strong> ${startTime} - ${endTime}</p>
                            <p><strong>Тип:</strong> ${type}</p>
                            <p><strong>Название:</strong> ${training.group_name || '—'}</p>
                            <p><strong>Тренер:</strong> ${training.trainer_name || 'Не назначен'}</p>
                            <p><strong>Уровень подготовки:</strong> ${training.skill_level || '—'}</p>
                            <p><strong>Участников:</strong> ${training.current_participants || 0}/${training.max_participants || 0}</p>
                            <p><strong>Цена за человека:</strong> ${pricePerPerson}</p>
                            <p><strong>Цена общая:</strong> ${totalPrice}</p>
                            <p><strong>Статус:</strong> <span style="font-weight: bold;">${status}</span></p>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                        <button class="btn-danger" onclick="deleteArchiveWinterTraining(${trainingId}); this.closest('.modal').remove();" style="margin-left: 10px;">
                            Удалить тренировку
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Закрытие по клику вне окна
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            };
        } catch (error) {
            console.error('Ошибка при загрузке деталей тренировки:', error);
            alert('Ошибка при загрузке деталей тренировки: ' + error.message);
        }
    };
    
    // Функция удаления архивной зимней тренировки
    window.deleteArchiveWinterTraining = async function(trainingId) {
        if (!confirm('Вы уверены, что хотите удалить эту архивную тренировку? Это действие нельзя отменить.')) {
            return;
        }
        
        try {
            const response = await authFetch(`/api/winter-trainings/${trainingId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка при удалении тренировки');
            }
            
            alert('✅ Тренировка успешно удалена');
            loadArchiveTrainings(); // Перезагружаем список
        } catch (error) {
            console.error('Ошибка удаления тренировки:', error);
            alert('❌ Ошибка при удалении тренировки: ' + error.message);
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

