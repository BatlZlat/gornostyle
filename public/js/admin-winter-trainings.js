/**
 * Управление зимними тренировками (естественный склон)
 */

// Инициализация страницы зимних тренировок
function initWinterTrainingsPage() {
    const dateInput = document.getElementById('winter-trainings-date');
    const prevBtn = document.getElementById('winter-prev-date');
    const nextBtn = document.getElementById('winter-next-date');
    const typeFilter = document.getElementById('winter-type-filter');
    const statusFilter = document.getElementById('winter-status-filter');
    
    // Установить текущую дату
    if (dateInput && !dateInput.value) {
        dateInput.valueAsDate = new Date();
    }
    
    // Обработчики событий
    if (dateInput) {
        dateInput.addEventListener('change', loadWinterTrainings);
    }
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            const currentDate = new Date(dateInput.value);
            currentDate.setDate(currentDate.getDate() - 1);
            dateInput.valueAsDate = currentDate;
            loadWinterTrainings();
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const currentDate = new Date(dateInput.value);
            currentDate.setDate(currentDate.getDate() + 1);
            dateInput.valueAsDate = currentDate;
            loadWinterTrainings();
        });
    }
    
    if (typeFilter) {
        typeFilter.addEventListener('change', loadWinterTrainings);
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', loadWinterTrainings);
    }
    
    // Делегирование событий для кнопок (устанавливается один раз при инициализации)
    // Используем делегирование на уровне документа, чтобы оно работало всегда
    if (!window.winterTrainingsEventsAttached) {
        console.log('🔧 Устанавливаем обработчики событий для зимних тренировок...');
        document.addEventListener('click', function(e) {
            console.log('🔍 Обработчик клика сработал:', {
                target: e.target,
                targetClass: e.target.className,
                targetTag: e.target.tagName,
                closestEdit: e.target.closest('.edit-winter-btn'),
                closestDelete: e.target.closest('.delete-winter-btn')
            });
            
            // Обработка кнопки "Редактировать"
            const editBtn = e.target.closest('.edit-winter-btn');
            if (editBtn) {
                console.log('✅ Кнопка "Редактировать" найдена:', {
                    element: editBtn,
                    dataset: editBtn.dataset,
                    className: editBtn.className
                });
                e.preventDefault();
                e.stopPropagation();
                const trainingId = parseInt(editBtn.dataset.trainingId);
                const trainingSource = editBtn.dataset.trainingSource || '';
                const kuligaType = editBtn.dataset.kuligaType || '';
                console.log('🚀 Вызываем editWinterTraining:', { trainingId, trainingSource, kuligaType });
                
                if (typeof editWinterTraining === 'function') {
                    editWinterTraining(trainingId, trainingSource, kuligaType);
                } else {
                    console.error('❌ editWinterTraining не является функцией:', typeof editWinterTraining);
                    alert('Ошибка: функция editWinterTraining не найдена');
                }
                return;
            }
            
            // Обработка кнопки "Удалить"
            const deleteBtn = e.target.closest('.delete-winter-btn');
            if (deleteBtn) {
                console.log('✅ Кнопка "Удалить" найдена:', {
                    element: deleteBtn,
                    dataset: deleteBtn.dataset,
                    className: deleteBtn.className
                });
                e.preventDefault();
                e.stopPropagation();
                const trainingId = parseInt(deleteBtn.dataset.trainingId);
                const trainingSource = deleteBtn.dataset.trainingSource || '';
                const kuligaType = deleteBtn.dataset.kuligaType || '';
                console.log('🚀 Вызываем deleteWinterTraining:', { trainingId, trainingSource, kuligaType });
                
                if (typeof deleteWinterTraining === 'function') {
                    deleteWinterTraining(trainingId, trainingSource, kuligaType);
                } else {
                    console.error('❌ deleteWinterTraining не является функцией:', typeof deleteWinterTraining);
                    alert('Ошибка: функция deleteWinterTraining не найдена');
                }
                return;
            }
            
            console.log('ℹ️ Клик не на кнопках редактирования/удаления');
        }, true); // Используем capture phase для более раннего перехвата
        window.winterTrainingsEventsAttached = true;
        console.log('✅ Обработчики событий для зимних тренировок установлены');
    } else {
        console.log('⚠️ Обработчики событий для зимних тренировок уже установлены');
    }
    
    loadWinterTrainings();
}

// Загрузить список зимних тренировок
async function loadWinterTrainings() {
    const container = document.getElementById('winter-trainings-list');
    
    if (!container) {
        console.error('Элемент winter-trainings-list не найден');
        return;
    }
    
    try {
        // Получаем текущую дату
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        
        // Устанавливаем дату окончания на 30 дней вперед
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);
        const dateTo = endDate.toISOString().split('T')[0];
        
        // Запрашиваем тренировки за диапазон дат
        const response = await fetch(`/api/schedule/admin?slope_type=natural_slope`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token') || localStorage.getItem('authToken')}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const trainings = await response.json();
        
        if (!Array.isArray(trainings)) {
            console.error('Получены некорректные данные:', trainings);
            throw new Error('Получены некорректные данные от сервера');
        }
        
        // Фильтруем по типу и статусу, если указаны
        const typeFilter = document.getElementById('winter-type-filter');
        const statusFilter = document.getElementById('winter-status-filter');
        
        let filteredTrainings = trainings;
        
        if (typeFilter && typeFilter.value) {
            filteredTrainings = filteredTrainings.filter(t => t.winter_training_type === typeFilter.value);
        }
        
        if (statusFilter && statusFilter.value) {
            filteredTrainings = filteredTrainings.filter(t => t.status === statusFilter.value);
        }
        
        displayWinterTrainings(filteredTrainings);
    } catch (error) {
        console.error('Ошибка загрузки тренировок:', error);
        container.innerHTML = '<div class="alert alert-info">Ошибка загрузки тренировок. Попробуйте обновить страницу.</div>';
    }
}

// Функция для форматирования даты
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
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

// Отобразить список зимних тренировок
function displayWinterTrainings(trainings) {
    const container = document.getElementById('winter-trainings-list');
    
    if (trainings.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Нет запланированных тренировок на естественном склоне</div>';
        return;
    }
    
    // Сортируем тренировки по дате (от ближайшей к дальней)
    trainings.sort((a, b) => {
        const dateA = new Date(a.date || a.session_date);
        const dateB = new Date(b.date || b.session_date);
        if (dateA.getTime() !== dateB.getTime()) {
            return dateA - dateB;
        }
        const timeA = (a.start_time || '').toString();
        const timeB = (b.start_time || '').toString();
        return timeA.localeCompare(timeB);
    });
    
    // Группируем тренировки по дате
    const grouped = {};
    trainings.forEach(training => {
        const date = training.date || training.session_date;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(training);
    });
    
    // Формируем HTML
    let html = '';
    Object.keys(grouped).forEach(date => {
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
                        ${grouped[date].map(training => renderWinterTrainingRow(training)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Логируем количество созданных кнопок после рендеринга
    setTimeout(() => {
        const editButtons = container.querySelectorAll('.edit-winter-btn');
        const deleteButtons = container.querySelectorAll('.delete-winter-btn');
        console.log('📊 Рендеринг завершен:', {
            editButtons: editButtons.length,
            deleteButtons: deleteButtons.length,
            totalRows: trainings.length,
            containerExists: !!container
        });
        
        // Проверяем, что кнопки имеют правильные data-атрибуты
        if (editButtons.length > 0) {
            console.log('🔍 Первая кнопка "Редактировать":', {
                element: editButtons[0],
                dataset: editButtons[0].dataset,
                className: editButtons[0].className
            });
        }
        if (deleteButtons.length > 0) {
            console.log('🔍 Первая кнопка "Удалить":', {
                element: deleteButtons[0],
                dataset: deleteButtons[0].dataset,
                className: deleteButtons[0].className
            });
        }
    }, 100);
}

// Отрисовать строку тренировки
function renderWinterTrainingRow(training) {
    const typeLabels = {
        individual: 'Индивидуальное',
        sport_group: 'Спортивная группа',
        group: 'Групповая'
    };
    
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
    
    // Форматируем время (убираем секунды, если есть)
    const startTime = training.start_time ? training.start_time.slice(0, 5) : '—';
    const endTime = training.end_time ? training.end_time.slice(0, 5) : '—';
    
    // Определяем тип тренировки
    const isIndividual = training.is_individual || training.winter_training_type === 'individual';
    const type = isIndividual ? 'Индивидуальная' : (typeLabels[training.winter_training_type] || 'Групповая');
    
    // Название: для индивидуальных - участники, для групповых - название группы
    let name = '—';
    if (isIndividual) {
        // Для индивидуальных тренировок название - это имя участника
        // Если есть participant_names в данных, используем его
        if (training.participant_names && Array.isArray(training.participant_names)) {
            name = training.participant_names.join(', ');
        } else if (typeof training.participant_names === 'string') {
            name = training.participant_names;
        } else {
            name = 'Естественный склон';
        }
    } else {
        name = training.group_name || 'Групповая тренировка';
    }
    
    // Участники
    const currentParticipants = training.current_participants || (isIndividual ? 1 : 0);
    const maxParticipants = training.max_participants || (isIndividual ? 1 : 1);
    
    // Тренер
    const trainer = training.trainer_name || 'Не назначен';
    
    // Цена за человека
    let price = '—';
    if (training.price != null && maxParticipants > 0) {
        // Для групповых тренировок делим общую цену на количество участников
        // Для индивидуальных цена уже за одного человека
        const totalPrice = parseFloat(training.price);
        const pricePerPerson = isIndividual ? totalPrice : (totalPrice / maxParticipants);
        price = `${pricePerPerson.toFixed(2)} ₽`;
    }
    
    // Статус - используем правильные метки на русском
    let status = '—';
    let statusColor = '#666';
    
    // Расширенные метки статусов для всех типов тренировок
    const allStatusLabels = {
        // Обычные тренировки
        scheduled: 'Запланирована',
        completed: 'Завершена',
        cancelled: 'Отменена',
        // Тренировки Кулиги (бронирования)
        pending: 'Ожидание',      // Бронирование создано, но платеж не подтвержден
        confirmed: 'Подтверждено', // Платеж подтвержден
        refunded: 'Возврат',      // Средства возвращены
        // Тренировки Кулиги (групповые тренировки)
        open: 'Открыта',          // Групповая тренировка открыта для записи
        confirmed: 'Подтверждена' // Групповая тренировка подтверждена
    };
    
    const allStatusColors = {
        // Обычные тренировки
        scheduled: '#2196F3',
        completed: '#4CAF50',
        cancelled: '#f44336',
        // Тренировки Кулиги (бронирования)
        pending: '#FF9800',       // Оранжевый - ожидание оплаты
        confirmed: '#4CAF50',     // Зеленый - подтверждено
        refunded: '#9E9E9E',      // Серый - возврат
        // Тренировки Кулиги (групповые тренировки)
        open: '#2196F3',          // Синий - открыта для записи
        confirmed: '#4CAF50'      // Зеленый - подтверждена
    };
    
    // Определяем статус с учетом всех возможных значений
    const trainingStatus = training.status || '—';
    status = allStatusLabels[trainingStatus] || trainingStatus || '—';
    statusColor = allStatusColors[trainingStatus] || '#666';
    
    // Уровень подготовки
    const skillLevel = training.skill_level || '—';
    
    // Логируем информацию о тренировке для отладки
    const isKuliga = training.training_source === 'kuliga';
    console.log('🎨 Рендерим строку тренировки:', {
        id: training.id,
        training_source: training.training_source,
        isKuliga: isKuliga,
        type: training.winter_training_type || training.is_individual ? 'individual' : 'group'
    });
    
    // На странице "Тренировки на естественном склоне (ЗИМА)" 
    // разрешаем редактирование и удаление для ВСЕХ тренировок
    // В функциях editWinterTraining и deleteWinterTraining будем определять тип и использовать правильный API
    const editButton = `<button class="btn-secondary edit-winter-btn" 
                 data-training-id="${training.id}" 
                 data-training-source="${training.training_source || ''}"
                 data-kuliga-type="${training.kuliga_type || ''}">
            Редактировать
        </button>`;
    
    const deleteButton = `<button class="btn-danger delete-winter-btn" 
                 data-training-id="${training.id}" 
                 data-training-source="${training.training_source || ''}"
                 data-kuliga-type="${training.kuliga_type || ''}">
            Удалить
        </button>`;
    
    return `
        <tr class="training-row">
            <td>${startTime} - ${endTime}</td>
            <td>${type}</td>
            <td>${name}</td>
            <td>${trainer}</td>
            <td>${currentParticipants}/${maxParticipants}</td>
            <td>${skillLevel}</td>
            <td>${price}</td>
            <td><span style="color:${statusColor};font-weight:bold;">${status}</span></td>
            <td class="training-actions">
                <button class="btn-secondary" onclick="viewWinterTrainingDetails(${training.id}, '${training.training_source || ''}', '${training.kuliga_type || ''}')">
                    Подробнее
                </button>
                ${editButton}
                ${deleteButton}
            </td>
        </tr>
    `;
}

// Открыть модальное окно создания зимней тренировки
function openCreateWinterTraining() {
    // Открываем модальное окно создания групповой тренировки Кулиги
    if (typeof openKuligaGroupTrainingModal === 'function') {
        openKuligaGroupTrainingModal();
    } else {
        // Если функция еще не загружена, переходим на старую страницу
        window.location.href = 'winter-training.html';
    }
}

// Просмотр деталей зимней тренировки
async function viewWinterTrainingDetails(id, trainingSource, kuligaType) {
    try {
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        
        // Если это тренировка Кулиги, используем другой API
        if (trainingSource === 'kuliga') {
            if (typeof viewKuligaTrainingDetails === 'function') {
                viewKuligaTrainingDetails(id, kuligaType || 'group');
                return;
            } else {
                // Fallback: используем API Кулиги напрямую
                const response = await fetch(`/api/kuliga/admin/training/${id}?type=${kuligaType || 'group'}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || 'Ошибка получения данных');
                }
                
                // Используем функцию из admin.js для отображения
                if (typeof window.viewKuligaTrainingDetails === 'function') {
                    window.viewKuligaTrainingDetails(id, kuligaType || 'group');
                    return;
                }
                
                // Если функция не найдена, показываем базовую информацию
                alert('Детали тренировки Кулиги загружены, но функция отображения не найдена');
                return;
            }
        }
        
        // Для обычных тренировок используем стандартный API
        const response = await fetch(`/api/winter-trainings/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const training = await response.json();
        
        // Определяем тип тренировки: training_type === false означает индивидуальную
        const isIndividual = training.training_type === false || training.winter_training_type === 'individual';
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        
        const startTime = String(training.start_time).substring(0, 5); // Только время начала
        let trainingType = isIndividual ? 'Индивидуальная' : 'Групповая';
        // Для групповых тренировок добавляем название группы в скобках
        if (!isIndividual && training.group_name) {
            trainingType += ` (${training.group_name})`;
        }
        const modalTitle = isIndividual ? 'Детали индивидуальной тренировки в Кулига Парк' : 'Детали групповой тренировки в Кулига Парк';
        
        const totalPrice = training.price != null ? parseFloat(training.price) : null;
        const maxParticipants = training.max_participants || 1;
        const pricePerPerson = totalPrice && maxParticipants > 0 ? (totalPrice / maxParticipants).toFixed(2) : null;
        
        let modalContent = `
            <div class="modal-content">
                <h3>${modalTitle}</h3>
                <div class="training-details">
                    <div class="detail-group">
                        <h4>Основная информация</h4>
                        <p><strong>Дата:</strong> ${formatDate(training.session_date)}</p>
                        <p><strong>Время:</strong> ${startTime}</p>
                        <p><strong>Тип тренировки:</strong> ${trainingType}</p>
                        <p><strong>Тренер:</strong> ${training.trainer_name || 'Не указан'}</p>`;
        
        // Показываем уровень только для групповых тренировок
        if (!isIndividual) {
            modalContent += `<p><strong>Уровень:</strong> ${training.skill_level || '-'}</p>`;
        }
        
        // Для индивидуальных тренировок показываем просто "Цена", для групповых - "Цена общая" и "Цена за человека"
        if (isIndividual) {
            modalContent += `${totalPrice != null ? 
                            `<p><strong>Цена:</strong> ${totalPrice.toFixed(2)} ₽</p>` : 
                            '<p><strong>Цена:</strong> -</p>'
                        }`;
        } else {
            modalContent += `${totalPrice != null ? `
                            <p><strong>Цена общая:</strong> ${totalPrice.toFixed(2)} ₽</p>
                            ${pricePerPerson ? `<p><strong>Цена за человека:</strong> ${pricePerPerson} ₽</p>` : ''}
                        ` : '<p><strong>Цена:</strong> -</p>'
                    }`;
        }
        
        modalContent += `
                    </div>
                    <div class="detail-group">
                        <h4>Участники (${training.current_participants || 0}/${training.max_participants || 0})</h4>`;
        
        if (training.participants && training.participants.length > 0) {
            // Для индивидуальных тренировок убираем колонку "Действия"
            modalContent += `
                        <table class="participants-table">
                            <thead>
                                <tr>
                                    <th>ФИО</th>
                                    <th>Возраст</th>
                                    ${!isIndividual ? '<th>Уровень</th>' : ''}
                                    <th>Контактный телефон</th>
                                    ${!isIndividual ? '<th>Действия</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>`;
            
            training.participants.forEach(participant => {
                const birthDate = new Date(participant.birth_date);
                const age = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
                const levelCell = !isIndividual ? `<td>${participant.skill_level || '-'}</td>` : '';
                // Для индивидуальных тренировок убираем кнопку удаления
                const actionsCell = !isIndividual ? `
                                    <td>
                                        <button 
                                            class="btn-danger btn-small" 
                                            onclick="removeParticipantFromTraining(${training.id}, ${participant.id}, '${participant.full_name}')"
                                            title="Удалить участника с возвратом средств">
                                            ❌ Удалить
                                        </button>
                                    </td>` : '';
                
                modalContent += `
                                <tr>
                                    <td>${participant.full_name}</td>
                                    <td>${age} лет</td>
                                    ${levelCell}
                                    <td>${participant.phone || '-'}</td>
                                    ${actionsCell}
                                </tr>`;
            });
            
            modalContent += `
                            </tbody>
                        </table>`;
        } else {
            modalContent += '<p>Нет участников</p>';
        }
        
        modalContent += `
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>`;
        
        modal.innerHTML = modalContent;
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        };
    } catch (error) {
        console.error('Ошибка при загрузке деталей тренировки:', error);
        alert('Не удалось загрузить детали тренировки');
    }
}

// Редактирование зимней тренировки
async function editWinterTraining(id, trainingSource, kuligaType) {
    console.log('📝 editWinterTraining вызвана:', { id, trainingSource, kuligaType, typeofId: typeof id });
    try {
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        
        // Для тренировок Кулиги используем API Кулиги
        if (trainingSource === 'kuliga') {
            console.log('🔍 Тренировка Кулиги, используем API Кулиги');
            const kuligaResponse = await fetch(`/api/kuliga/admin/training/${id}?type=${kuligaType || 'individual'}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!kuligaResponse.ok) {
                throw new Error('Не удалось загрузить данные тренировки Кулиги');
            }
            
            const kuligaResult = await kuligaResponse.json();
            if (!kuligaResult.success) {
                throw new Error(kuligaResult.error || 'Ошибка получения данных');
            }
            
            const training = kuligaResult.data;
            console.log('📊 Данные тренировки Кулиги загружены:', training);
            
            // Показываем сообщение, что редактирование через другой интерфейс
            alert('Редактирование тренировок Кулиги выполняется через раздел "Служба инструкторов Кулига".\n\nВы можете использовать кнопку "Подробнее" для просмотра деталей.');
            return;
        }
        
        // Для обычных тренировок используем стандартный API
        console.log('🔍 Обычная тренировка, используем API winter-trainings');
        const trainingResponse = await fetch(`/api/winter-trainings/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!trainingResponse.ok) {
            throw new Error('Не удалось загрузить данные тренировки');
        }
        
        const training = await trainingResponse.json();
        
        console.log('Загружены данные тренировки для редактирования:', training);
        
        // Загружаем данные для выпадающих списков
        const [trainersResponse, groupsResponse] = await Promise.all([
            fetch('/api/trainers', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }).then(res => res.json()),
            fetch('/api/groups', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }).then(res => res.json())
        ]);
        
        const trainers = Array.isArray(trainersResponse) ? trainersResponse : (trainersResponse.trainers || []);
        const groups = Array.isArray(groupsResponse) ? groupsResponse : (groupsResponse.groups || []);
        
        // Формируем options для select
        const trainerOptions = trainers
            .filter(tr => tr.is_active !== false)
            .map(tr => 
                `<option value="${tr.id}" ${String(tr.id) === String(training.trainer_id) ? 'selected' : ''}>${tr.full_name}</option>`
            ).join('');
        
        const groupOptions = groups.map(gr => 
            `<option value="${gr.id}" ${String(gr.id) === String(training.group_id) ? 'selected' : ''}>${gr.name}</option>`
        ).join('');
        
        // Удаляем старое модальное окно, если есть
        const oldModal = document.getElementById('edit-winter-training-modal');
        if (oldModal) {
            oldModal.remove();
        }
        
        // Формируем HTML модального окна
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'edit-winter-training-modal';
        
        // Форматируем дату для input type="date"
        // Дата уже должна быть в формате YYYY-MM-DD благодаря форматированию на сервере
        const dateValue = training.session_date ? String(training.session_date).split('T')[0] : '';
        
        const isIndividualEdit = training.training_type === false || training.winter_training_type === 'individual';
        const editTitle = isIndividualEdit
            ? 'Редактировать индивидуальную тренировку в Кулига Парк'
            : `Редактировать групповую тренировку в Кулига Парк${training.group_name ? ` (${training.group_name})` : ''}`;

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <h3>${editTitle}</h3>
                <form id="edit-winter-training-form">
                    <div class="form-group">
                        <label>Дата (только СБ и ВС)</label>
                        <input type="date" name="session_date" id="edit-session-date" value="${dateValue}" required />
                        <small id="date-warning" style="color: #e74c3c; display: none; margin-top: 5px;">
                            ⚠️ Тренировки возможны только на выходные дни (Суббота и Воскресенье)
                        </small>
                    </div>
                    <div class="form-group">
                        <label>Время начала</label>
                        <input type="time" name="start_time" value="${training.start_time ? training.start_time.slice(0,5) : ''}" required />
                    </div>
                    ${!isIndividualEdit ? `
                    <div class="form-group">
                        <label>Группа</label>
                        <select name="group_id" required>
                            <option value="">Выберите группу</option>
                            ${groupOptions}
                        </select>
                    </div>
                    ` : ''}
                    <div class="form-group">
                        <label>Тренер</label>
                        <select name="trainer_id">
                            <option value="">Выберите тренера (опционально)</option>
                            ${trainerOptions}
                        </select>
                    </div>
                    ${!isIndividualEdit ? `
                    <div class="form-group">
                        <label>Уровень подготовки</label>
                        <select name="skill_level" required>
                            <option value="">Выберите уровень</option>
                            ${Array.from({length: 10}, (_, i) => i + 1).map(level => 
                                `<option value="${level}" ${String(training.skill_level) === String(level) ? 'selected' : ''}>Уровень ${level}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Максимальное количество участников</label>
                        <select name="max_participants" required>
                            <option value="">Выберите количество</option>
                            <option value="2" ${String(training.max_participants) === '2' ? 'selected' : ''}>2 человека</option>
                            <option value="3" ${String(training.max_participants) === '3' ? 'selected' : ''}>3 человека</option>
                            <option value="4" ${String(training.max_participants) === '4' ? 'selected' : ''}>4 человека</option>
                            <option value="6" ${String(training.max_participants) === '6' ? 'selected' : ''}>6 человек</option>
                        </select>
                    </div>
                    ` : ''}
                    <div class="form-group">
                        <label>${isIndividualEdit ? 'Цена' : 'Цена общая (₽)'}</label>
                        <input type="number" name="price" value="${training.price ? parseFloat(training.price).toFixed(2) : ''}" min="0" step="0.01" required />
                        ${!isIndividualEdit ? `
                        <small style="color: #666; display: block; margin-top: 5px;">
                            Цена за человека будет рассчитана автоматически: ${training.max_participants > 0 && training.price ? (parseFloat(training.price) / training.max_participants).toFixed(2) : '-'} ₽
                        </small>` : ''}
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" id="close-edit-winter-modal">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Валидация даты - только выходные дни
        const dateInput = document.getElementById('edit-session-date');
        const dateWarning = document.getElementById('date-warning');
        
        function validateDate() {
            if (!dateInput.value) {
                dateWarning.style.display = 'none';
                dateInput.style.borderColor = '';
                return true;
            }
            
            // Правильно определяем день недели (без учета timezone)
            const [year, month, day] = dateInput.value.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day); // Месяц в JS: 0-11
            const dayOfWeek = selectedDate.getDay(); // 0 = ВС, 6 = СБ
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            
            if (!isWeekend) {
                dateWarning.style.display = 'block';
                dateInput.style.borderColor = '#e74c3c';
                return false;
            } else {
                dateWarning.style.display = 'none';
                dateInput.style.borderColor = '';
                return true;
            }
        }
        
        dateInput.addEventListener('change', validateDate);
        
        // Закрытие по кнопке
        document.getElementById('close-edit-winter-modal').onclick = () => modal.remove();
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => { 
            if (e.target === modal) modal.remove(); 
        };
        
        // Обработка сохранения
        document.getElementById('edit-winter-training-form').onsubmit = async function(e) {
            e.preventDefault();
            
            // Валидация даты перед отправкой
            const dateValue = document.getElementById('edit-session-date').value;
            if (!dateValue) {
                alert('⚠️ Пожалуйста, выберите дату тренировки.');
                return;
            }
            
            // Правильно определяем день недели (без учета timezone)
            const [year, month, day] = dateValue.split('-').map(Number);
            const selectedDate = new Date(year, month - 1, day); // Месяц в JS: 0-11
            const dayOfWeek = selectedDate.getDay(); // 0 = ВС, 6 = СБ
            
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                alert('⚠️ Тренировки возможны только на выходные дни (Суббота и Воскресенье). Пожалуйста, выберите другую дату.');
                dateWarning.style.display = 'block';
                return;
            }
            
            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());

            // Для групповой тренировки скрыто поле end_time — подставляем его равным start_time (зимние тренировки 60 мин)
            if (!data.end_time && data.start_time) {
                data.end_time = data.start_time;
            }
            
            // Преобразуем числовые поля
            data.max_participants = parseInt(data.max_participants);
            data.skill_level = data.skill_level && data.skill_level !== '' ? parseInt(data.skill_level) : null;
            data.price = parseFloat(data.price);
            // Для trainer_id и group_id: если пустая строка - null, иначе число
            data.trainer_id = data.trainer_id && data.trainer_id !== '' ? parseInt(data.trainer_id) : null;
            // Для групповых тренировок group_id обязателен, для индивидуальных может быть null
            data.group_id = data.group_id && data.group_id !== '' ? parseInt(data.group_id) : null;
            
            // Добавляем duration (по умолчанию 60 минут)
            const startTime = new Date(`2000-01-01T${data.start_time}`);
            const endTime = new Date(`2000-01-01T${data.end_time}`);
            data.duration = Math.round((endTime - startTime) / (1000 * 60)) || 60;
            
            // Отправляем PUT-запрос
            try {
                const response = await fetch(`/api/winter-trainings/${id}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Ошибка при сохранении');
                }
                
                // Показываем успешное сообщение
                if (typeof showSuccess === 'function') {
                    showSuccess('Тренировка успешно обновлена');
                } else {
                    alert('✅ Тренировка успешно обновлена');
                }
                
                modal.remove();
                loadWinterTrainings(); // Перезагружаем список
            } catch (error) {
                console.error('Ошибка при сохранении:', error);
                if (typeof showError === 'function') {
                    showError(error.message);
                } else {
                    alert('❌ Ошибка: ' + error.message);
                }
            }
        };
    } catch (error) {
        console.error('Ошибка при загрузке данных для редактирования:', error);
        alert('❌ Ошибка: ' + error.message);
    }
}

// Удаление зимней тренировки
async function deleteWinterTraining(id, trainingSource, kuligaType) {
    console.log('🗑️ deleteWinterTraining вызвана:', { id, trainingSource, kuligaType, typeofId: typeof id });
    
    // Для тренировок Кулиги
    if (trainingSource === 'kuliga') {
        if (!confirm('Вы уверены, что хотите удалить эту тренировку Кулиги?\n\nВнимание: это действие нельзя отменить!')) {
            return;
        }
        
        console.log('🔍 Удаление тренировки Кулиги через API Кулиги');
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        
        // TODO: Добавить API endpoint для удаления тренировок Кулиги
        alert('Удаление тренировок Кулиги пока выполняется через раздел "Служба инструкторов Кулига".');
        return;
    }
    
    if (!confirm('Вы уверены, что хотите удалить эту тренировку?')) {
        return;
    }
    
    try {
        // Получаем токен из cookies или localStorage
        const getAuthToken = () => {
            const cookies = document.cookie.split(';');
            for (let cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'adminToken') {
                    return decodeURIComponent(value);
                }
            }
            return localStorage.getItem('adminToken') || localStorage.getItem('authToken') || localStorage.getItem('token');
        };
        
        const token = getAuthToken();
        const response = await fetch(`/api/winter-trainings/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при удалении тренировки');
        }
        
        alert('✅ Тренировка успешно удалена');
        loadWinterTrainings(); // Перезагружаем список
    } catch (error) {
        console.error('Ошибка удаления тренировки:', error);
        alert('❌ Ошибка при удалении тренировки: ' + error.message);
    }
}

// Делаем функции глобально доступными
window.editWinterTraining = editWinterTraining;
window.deleteWinterTraining = deleteWinterTraining;
window.viewWinterTrainingDetails = viewWinterTrainingDetails;

console.log('✅ admin-winter-trainings.js загружен');

