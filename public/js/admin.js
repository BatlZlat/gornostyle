// Глобальные переменные
let currentPage = 'schedule';
let currentDate = new Date();
let datePicker;
let allClients = []; // Глобальная переменная для хранения всех клиентов
let dismissedTrainers = [];

// Глобальные переменные для заявок
let allApplications = [];
let currentApplicationsFilter = 'all';
let currentApplicationsDate = '';
let currentApplicationsSearch = '';

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    initializeDatePicker();
    loadPageContent(currentPage);
    initializeEventListeners();
    
    // Инициализируем функционал пополнения кошелька
    initializeWalletRefill();
});

// Инициализация навигации
function initializeNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const pages = document.querySelectorAll('.page-content');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.dataset.page;
            
            // Обновляем активный пункт меню
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');
            
            // Показываем нужную страницу
            pages.forEach(page => {
                page.style.display = page.id === `${targetPage}-page` ? 'block' : 'none';
            });

            // Загружаем контент страницы
            loadPageContent(targetPage);
        });
    });

    // Загружаем начальную страницу
    const activeMenuItem = document.querySelector('.menu-item.active');
    if (activeMenuItem) {
        const targetPage = activeMenuItem.dataset.page;
        loadPageContent(targetPage);
    }
}

// Инициализация выбора даты
function initializeDatePicker() {
    const datePicker = document.getElementById('schedule-date');
    if (datePicker) {
        datePicker.valueAsDate = currentDate;
        datePicker.addEventListener('change', () => {
            currentDate = datePicker.valueAsDate;
            loadPageContent(currentPage);
        });
    }

    const prevDateBtn = document.getElementById('prev-date');
    const nextDateBtn = document.getElementById('next-date');
    
    if (prevDateBtn && nextDateBtn && datePicker) {
        prevDateBtn.addEventListener('click', () => {
            const currentDate = new Date(datePicker.value);
            currentDate.setDate(currentDate.getDate() - 1);
            datePicker.value = currentDate.toISOString().split('T')[0];
            loadSchedule();
        });

        nextDateBtn.addEventListener('click', () => {
            const currentDate = new Date(datePicker.value);
            currentDate.setDate(currentDate.getDate() + 1);
            datePicker.value = currentDate.toISOString().split('T')[0];
            loadSchedule();
        });

        datePicker.addEventListener('change', loadSchedule);
    }
}

// Инициализация обработчиков событий
function initializeEventListeners() {
    // Обработчики для страницы тренировок
    const createTrainingBtn = document.getElementById('create-training');
    if (createTrainingBtn) {
        createTrainingBtn.addEventListener('click', () => {
            showModal('create-training-modal');
        });
    }

    // Обработчики для страницы тренеров
    const createTrainerBtn = document.getElementById('create-trainer');
    if (createTrainerBtn) {
        createTrainerBtn.addEventListener('click', () => {
            window.location.href = 'create-trainer.html';
        });
    }

    // Обработчики для страницы расписания
    const createScheduleBtn = document.getElementById('create-schedule');
    if (createScheduleBtn) {
        createScheduleBtn.addEventListener('click', () => {
            showModal('create-schedule-modal');
        });
    }

    // Обработчики для страницы прайса
    const savePricesBtn = document.getElementById('save-prices');
    if (savePricesBtn) {
        savePricesBtn.addEventListener('click', savePrices);
    }

    // Обработчики для страницы тренажеров
    const simulatorStatuses = document.querySelectorAll('.status-select');
    simulatorStatuses.forEach(select => {
        select.addEventListener('change', (e) => {
            updateSimulatorStatus(e.target.id, e.target.value);
        });
    });

    // Обработчики для страницы клиентов
    const sortClientsSelect = document.getElementById('sort-clients');
    if (sortClientsSelect) {
        sortClientsSelect.addEventListener('change', () => {
            loadClients(sortClientsSelect.value);
        });
    }

    // Обработчики для форм
    const createTrainingForm = document.getElementById('create-training-form');
    if (createTrainingForm) {
        createTrainingForm.addEventListener('submit', handleCreateTraining);
    }

    const createTrainerForm = document.getElementById('create-trainer-form');
    if (createTrainerForm) {
        createTrainerForm.addEventListener('submit', handleCreateTrainer);
    }

    const createScheduleForm = document.getElementById('create-schedule-form');
    if (createScheduleForm) {
        createScheduleForm.addEventListener('submit', handleCreateSchedule);
    }

    // Обработчики для страницы тренировок
    const manageGroupsBtn = document.getElementById('manage-groups');
    if (manageGroupsBtn) {
        manageGroupsBtn.addEventListener('click', async () => {
            try {
                await loadGroups();
                showModal('groups-modal');
            } catch (error) {
                console.error('Ошибка при загрузке групп:', error);
                showError('Не удалось загрузить группы');
            }
        });
    }

    const createGroupBtn = document.getElementById('create-group-btn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            closeModal('groups-modal');
            showModal('create-group-modal');
        });
    }

    // Обработчики для форм
    const createGroupForm = document.getElementById('create-group-form');
    if (createGroupForm) {
        createGroupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {
                name: document.getElementById('group-name').value,
                description: document.getElementById('group-description').value
            };

            try {
                await createGroup(formData);
                createGroupForm.reset();
                showModal('groups-modal');
                await loadGroups();
                showNotification('Группа успешно создана', 'success');
            } catch (error) {
                showNotification('Ошибка при создании группы', 'error');
            }
        });
    }

    // Обработчик автоматического создания расписания
    const autoScheduleCheckbox = document.getElementById('auto-schedule');
    const autoScheduleSettings = document.querySelector('.auto-schedule-settings');
    
    if (autoScheduleCheckbox && autoScheduleSettings) {
        autoScheduleCheckbox.addEventListener('change', (e) => {
            autoScheduleSettings.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    // Обработчики для страницы тренировок
    const viewArchiveBtn = document.getElementById('view-archive');
    if (viewArchiveBtn) {
        viewArchiveBtn.addEventListener('click', () => {
            showModal('archive-modal');
            loadArchiveTrainings();
        });
    }

    // Обработчики для страницы финансов
    const createPaymentLinkBtn = document.getElementById('create-payment-link');
    if (createPaymentLinkBtn) {
        createPaymentLinkBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/payment-link');
                const data = await response.json();
                
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-content">
                        <h3>Управление ссылкой оплаты</h3>
                        <div class="form-group">
                            <label for="payment-link">Ссылка для оплаты:</label>
                            <input type="text" id="payment-link" value="${data.link || ''}" class="form-control">
                        </div>
                        <div class="modal-actions">
                            <button class="btn-primary" onclick="savePaymentLink()">Сохранить</button>
                            <button class="btn-secondary" onclick="closeModal('payment-link-modal')">Отмена</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            } catch (error) {
                console.error('Ошибка при загрузке ссылки оплаты:', error);
                showError('Не удалось загрузить ссылку оплаты');
            }
        });
    }

    const dismissedTrainersBtn = document.getElementById('dismissed-trainers');
    if (dismissedTrainersBtn) {
        dismissedTrainersBtn.addEventListener('click', () => {
            window.location.href = 'dismissed-trainers.html';
        });
    }

    // === Уведомление клиентов ===
    const notifyBtn = document.getElementById('notify-clients-btn');
    const notifyModal = document.getElementById('notify-clients-modal');
    const closeNotifyModal = document.getElementById('close-notify-modal');
    const notifyForm = document.getElementById('notify-clients-form');
    const notifyMessage = document.getElementById('notify-message');
    const notifyPreview = document.getElementById('notify-preview');

    if (notifyBtn && notifyModal) {
        notifyBtn.addEventListener('click', () => {
            notifyModal.style.display = 'block';
            
            // Обновляем HTML модального окна
            notifyModal.innerHTML = `
                <div class="modal-content">
                    <h3>Отправка сообщения</h3>
                    <form id="notify-clients-form">
                        <div class="form-group">
                            <label for="recipient-type">Тип получателей:</label>
                            <select id="recipient-type" class="form-control">
                                <option value="all">Все пользователи</option>
                                <option value="client">Конкретный пользователь</option>
                                <option value="group">Групповая тренировка</option>
                            </select>
                        </div>
                        
                        <div id="client-select-container" class="form-group" style="display: none;">
                            <label for="client-select">Выберите пользователя:</label>
                            <select id="client-select" class="form-control">
                                <option value="">Загрузка...</option>
                            </select>
                        </div>
                        
                        <div id="group-select-container" class="form-group" style="display: none;">
                            <label for="group-select">Выберите тренировку:</label>
                            <select id="group-select" class="form-control">
                                <option value="">Загрузка...</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="notify-message">Сообщение:</label>
                            <textarea id="notify-message" class="form-control" rows="4" placeholder="Введите сообщение..."></textarea>
                            <div id="emoji-panel" class="emoji-panel">
                                <!-- Существующие смайлики -->
                                <button type="button" class="emoji-btn">👋</button>
                                <button type="button" class="emoji-btn">🎿</button>
                                <button type="button" class="emoji-btn">⛷️</button>
                                <button type="button" class="emoji-btn">❄️</button>
                                <button type="button" class="emoji-btn">🎯</button>
                                <button type="button" class="emoji-btn">✅</button>
                                <button type="button" class="emoji-btn">❌</button>
                                <button type="button" class="emoji-btn">💰</button>
                                <button type="button" class="emoji-btn">📅</button>
                                <button type="button" class="emoji-btn">⏰</button>
                                
                                <!-- Новые эмоции -->
                                <button type="button" class="emoji-btn">😊</button>
                                <button type="button" class="emoji-btn">😄</button>
                                <button type="button" class="emoji-btn">👍</button>
                                <button type="button" class="emoji-btn">👎</button>
                                <button type="button" class="emoji-btn">😍</button>
                                <button type="button" class="emoji-btn">😢</button>
                                <button type="button" class="emoji-btn">😤</button>
                                <button type="button" class="emoji-btn">🤔</button>
                                
                                <!-- Спортивные -->
                                <button type="button" class="emoji-btn">🏂</button>
                                <button type="button" class="emoji-btn">🏆</button>
                                <button type="button" class="emoji-btn">🥇</button>
                                <button type="button" class="emoji-btn">💪</button>
                                <button type="button" class="emoji-btn">🔥</button>
                                
                                <!-- Рукопожатия и жесты -->
                                <button type="button" class="emoji-btn">🤝</button>
                                <button type="button" class="emoji-btn">🙏</button>
                                <button type="button" class="emoji-btn">✋</button>
                                <button type="button" class="emoji-btn">👌</button>
                                <button type="button" class="emoji-btn">🤙</button>
                                
                                <!-- Погода -->
                                <button type="button" class="emoji-btn">🌞</button>
                                <button type="button" class="emoji-btn">🌨️</button>
                                <button type="button" class="emoji-btn">🌪️</button>
                                
                                <!-- Уведомления -->
                                <button type="button" class="emoji-btn">🔔</button>
                                <button type="button" class="emoji-btn">📢</button>
                                <button type="button" class="emoji-btn">⚠️</button>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Предпросмотр:</label>
                            <div id="notify-preview" class="preview-box"></div>
                        </div>
                        
                        <div class="modal-actions">
                            <button type="submit" class="btn-primary">Отправить</button>
                            <button type="button" class="btn-secondary" id="close-notify-modal">Отмена</button>
                        </div>
                    </form>
                </div>
            `;

            // Инициализируем обработчики после обновления HTML
            initializeNotifyModalHandlers();
        });
    }

    // Функция инициализации обработчиков модального окна
    function initializeNotifyModalHandlers() {
        const modal = document.getElementById('notify-clients-modal');
        if (!modal) return;

        const form = modal.querySelector('#notify-clients-form');
        const recipientTypeSelect = modal.querySelector('#recipient-type');
        const clientSelectContainer = modal.querySelector('#client-select-container');
        const groupSelectContainer = modal.querySelector('#group-select-container');
        const clientSelect = modal.querySelector('#client-select');
        const groupSelect = modal.querySelector('#group-select');
        const messageInput = modal.querySelector('#notify-message');
        const previewBox = modal.querySelector('#notify-preview');
        const emojiPanel = modal.querySelector('#emoji-panel');
        const closeButton = modal.querySelector('#close-notify-modal');

        if (!form || !recipientTypeSelect || !messageInput || !previewBox || !emojiPanel) {
            console.error('Не найдены необходимые элементы формы');
            return;
        }

        // Обработчик изменения типа получателей
        recipientTypeSelect.addEventListener('change', () => {
            const type = recipientTypeSelect.value;
            if (clientSelectContainer) {
                clientSelectContainer.style.display = type === 'client' ? 'block' : 'none';
            }
            if (groupSelectContainer) {
                groupSelectContainer.style.display = type === 'group' ? 'block' : 'none';
            }

            // Загружаем списки при первом выборе
            if (type === 'client' && clientSelect && clientSelect.options.length <= 1) {
                loadClientsForSelect();
            } else if (type === 'group' && groupSelect && groupSelect.options.length <= 1) {
                loadGroupsForSelect();
            }
        });

        // Обработчик отправки формы
        form.addEventListener('submit', handleNotifyFormSubmit);

        // Обработчик закрытия модального окна
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                modal.style.display = 'none';
                form.reset();
                if (previewBox) previewBox.textContent = '';
            });
        }

        // Обработчик ввода текста сообщения
        messageInput.addEventListener('input', () => {
            previewBox.textContent = messageInput.value;
        });

        // Обработчики эмодзи
        emojiPanel.addEventListener('click', (event) => {
            if (event.target.classList.contains('emoji-btn')) {
                const emoji = event.target.textContent;
                const cursorPos = messageInput.selectionStart;
                const text = messageInput.value;
                messageInput.value = text.slice(0, cursorPos) + emoji + text.slice(cursorPos);
                messageInput.focus();
                messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
                previewBox.textContent = messageInput.value;
            }
        });

        // Закрытие по клику вне окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                form.reset();
                if (previewBox) previewBox.textContent = '';
            }
        });
    }

    // Функция загрузки списка клиентов для выпадающего списка
    async function loadClientsForSelect() {
        try {
            const response = await fetch('/api/clients');
            const clients = await response.json();
            const clientSelect = document.getElementById('client-select');
            // Фильтруем только уникальных клиентов без parent_id
            const filteredClients = [];
            const seenIds = new Set();
            for (const client of clients) {
                if (!client.parent_id && !seenIds.has(client.id)) {
                    filteredClients.push(client);
                    seenIds.add(client.id);
                }
            }
            clientSelect.innerHTML = filteredClients.map(client =>
                `<option value="${client.id}">${client.full_name} (${client.phone})</option>`
            ).join('');
        } catch (error) {
            console.error('Ошибка при загрузке списка клиентов:', error);
            showError('Не удалось загрузить список клиентов');
        }
    }

    // Функция загрузки списка групповых тренировок для выпадающего списка
    async function loadGroupsForSelect() {
        const select = document.getElementById('group-select');
        if (!select) {
            console.error('Элемент select для групп не найден');
            return;
        }

        try {
            showLoading('Загрузка списка групповых тренировок...');
            const response = await fetch('/api/trainings/active-groups');
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.details || 'Ошибка при загрузке списка тренировок');
            }

            const groups = await response.json();
            
            if (!Array.isArray(groups)) {
                throw new Error('Неверный формат данных от сервера');
            }

            // Очищаем текущие опции
            select.innerHTML = '<option value="">Выберите групповую тренировку</option>';

            if (groups.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Нет доступных групповых тренировок';
                option.disabled = true;
                select.appendChild(option);
                return;
            }

            // Добавляем новые опции
            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id;
                
                // Форматируем дату и время
                const date = group.session_date ? new Date(group.session_date).toLocaleDateString('ru-RU') : 'Дата не указана';
                const time = group.start_time ? group.start_time.split(':').slice(0, 2).join(':') : 'Время не указано';
                
                // Формируем текст опции
                const participants = `${group.current_participants || 0}/${group.max_participants}`;
                const skillLevel = group.skill_level ? ` (Уровень: ${group.skill_level})` : '';
                
                option.textContent = `${group.group_name} - ${date} ${time} - ${participants} участников${skillLevel}`;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Ошибка при загрузке списка тренировок:', error);
            showError(error.message || 'Ошибка при загрузке списка тренировок');
            
            // Добавляем опцию с ошибкой
            select.innerHTML = '<option value="">Ошибка загрузки списка тренировок</option>';
        } finally {
            hideLoading();
        }
    }

    if (closeNotifyModal && notifyModal) {
        closeNotifyModal.addEventListener('click', () => {
            notifyModal.style.display = 'none';
        });
    }
    if (notifyMessage && notifyPreview) {
        notifyMessage.addEventListener('input', () => {
            notifyPreview.textContent = notifyMessage.value;
        });
    }
    if (notifyForm) {
        notifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = notifyMessage.value.trim();
            if (!text) return;
            try {
                const resp = await fetch('/api/trainings/notify-clients', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                const data = await resp.json();
                if (resp.ok) {
                    alert(data.message || 'Сообщение отправлено!');
                    notifyModal.style.display = 'none';
                } else {
                    alert(data.error || 'Ошибка при отправке сообщения');
                }
            } catch (err) {
                alert('Ошибка при отправке сообщения');
            }
        });
    }
    // Закрытие по клику вне окна
    if (notifyModal) {
        notifyModal.onclick = (e) => {
            if (e.target === notifyModal) notifyModal.style.display = 'none';
        };
    }

    // Обработчики для страницы заявок
    const createApplicationBtn = document.getElementById('create-application');
    if (createApplicationBtn) {
        createApplicationBtn.addEventListener('click', () => {
            showCreateApplicationModal();
        });
    }

    const exportApplicationsBtn = document.getElementById('export-applications');
    if (exportApplicationsBtn) {
        exportApplicationsBtn.addEventListener('click', () => {
            exportApplications();
        });
    }

    // Обработчики фильтров заявок
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            currentApplicationsFilter = e.target.value;
            displayApplications();
        });
    }

    const dateFilter = document.getElementById('date-filter');
    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => {
            currentApplicationsDate = e.target.value;
            displayApplications();
        });
    }

    const applicationSearch = document.getElementById('application-search');
    if (applicationSearch) {
        applicationSearch.addEventListener('input', (e) => {
            currentApplicationsSearch = e.target.value.toLowerCase();
            displayApplications();
        });
    }
}

// Переключение страниц
function switchPage(page) {
    // Скрыть все страницы
    document.querySelectorAll('.page-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // Показать выбранную страницу
    const selectedPage = document.getElementById(`${page}-page`);
    if (selectedPage) {
        selectedPage.style.display = 'block';
    }
    
    // Обновить активный пункт меню
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });
    
    currentPage = page;
    loadPageContent(page);
}

// Загрузка контента страницы
async function loadPageContent(page) {
    switch (page) {
        case 'training':
            await loadTrainings();
            break;
        case 'schedule':
            await loadSchedule();
            break;
        case 'applications':
            await loadApplications();
            break;
        case 'simulators':
            await loadSimulators();
            break;
        case 'trainers':
            await loadTrainers();
            break;
        case 'clients':
            await loadClients();
            break;
        case 'prices':
            await loadPrices();
            break;
        case 'certificates':
            await loadCertificates();
            break;
        case 'finances':
            await loadFinances();
            break;
    }
    
    if (page === 'finances') {
        // Переинициализируем пополнение кошелька после загрузки страницы
        setTimeout(initializeWalletRefill, 100);
    }
}

// Загрузка тренировок
async function loadTrainings() {
    try {
        // Получаем текущую дату
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        
        // Устанавливаем дату окончания на 30 дней вперед
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);
        const dateTo = endDate.toISOString().split('T')[0];

        // Запрашиваем тренировки с текущей даты
        const response = await fetch(`/api/trainings?date_from=${today}&date_to=${dateTo}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Полученные данные:', data);
        
        if (!data || !Array.isArray(data)) {
            console.error('Получены некорректные данные:', data);
            throw new Error('Получены некорректные данные от сервера');
        }

        const trainingList = document.querySelector('.training-list');
        if (!trainingList) {
            console.error('Элемент .training-list не найден на странице');
            return;
        }

        if (data.length === 0) {
            trainingList.innerHTML = '<div class="alert alert-info">Нет доступных тренировок</div>';
            return;
        }

        // Сортируем тренировки по дате (от ближайшей к дальней)
        data.sort((a, b) => new Date(a.session_date) - new Date(b.session_date));

        // Группируем тренировки по дате
        const grouped = {};
        data.forEach(training => {
            const date = training.session_date;
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
                                    <td>${training.training_type ? 'Групповая' : 'Индивидуальная'}</td>
                                    <td>${training.group_name || '-'}</td>
                                    <td>${training.trainer_full_name || 'Не указан'}</td>
                                    <td>Тренажёр ${training.simulator_id}</td>
                                    <td>${training.current_participants || 0}/${training.max_participants}</td>
                                    <td>${training.skill_level || '-'}</td>
                                    <td>${training.price != null ? training.price : '-'} ₽</td>
                                    <td class="training-actions">
                                        <button class="btn-secondary" onclick="viewTrainingDetails(${training.id})">
                                            Подробнее
                                        </button>
                                        <button class="btn-secondary" onclick="editTraining(${training.id})">
                                            Редактировать
                                        </button>
                                        <button class="btn-danger" onclick="deleteTraining(${training.id})">
                                            Удалить
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
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

// Загрузка расписания
async function loadSchedule() {
    try {
        const response = await fetch('/api/schedule/admin');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Полученные данные:', data);
        
        if (!data || !Array.isArray(data)) {
            console.error('Получены некорректные данные:', data);
            throw new Error('Получены некорректные данные от сервера');
        }

        const scheduleList = document.querySelector('.schedule-list');
        if (!scheduleList) {
            console.error('Элемент .schedule-list не найден на странице');
            return;
        }

        if (data.length === 0) {
            scheduleList.innerHTML = '<div class="alert alert-info">Нет доступных тренировок на ближайшие 7 дней</div>';
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
                                <th>Тренажёр</th>
                                <th>Участников</th>
                                <th>Уровень</th>
                                <th>Цена</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${grouped[date].map(training => `
                                <tr class="training-row ${training.simulator_id === 2 ? 'simulator-2' : ''}">
                                    <td>${training.start_time.slice(0,5)} - ${training.end_time.slice(0,5)}</td>
                                    <td>${training.is_individual ? 'Индивидуальная' : 'Групповая'}</td>
                                    <td>${training.group_name || '-'}</td>
                                    <td>${training.trainer_name || 'Не указан'}</td>
                                    <td>${training.simulator_name}</td>
                                    <td>${training.is_individual ? '1/1' : `${training.current_participants}/${training.max_participants}`}</td>
                                    <td>${training.skill_level || '-'}</td>
                                    <td>${training.price} ₽</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        scheduleList.innerHTML = html;
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        showError('Не удалось загрузить расписание');
    }
}

// Загрузка тренажеров
async function loadSimulators() {
    console.log('Начало загрузки тренажеров');
    try {
        console.log('Отправка запроса к /api/simulators');
        const response = await fetch('/api/simulators');
        console.log('Получен ответ от сервера:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const simulators = await response.json();
        console.log('Получены данные тренажеров:', simulators);
        
        const simulatorsList = document.querySelector('.simulators-list');
        console.log('Найден элемент .simulators-list:', !!simulatorsList);
        
        if (simulatorsList) {
            if (!Array.isArray(simulators)) {
                throw new Error('Получены некорректные данные от сервера: ожидался массив');
            }
            
            if (simulators.length === 0) {
                simulatorsList.innerHTML = '<div class="alert alert-info">Нет доступных тренажеров</div>';
                return;
            }
            
            simulatorsList.innerHTML = simulators.map(simulator => `
                <div class="simulator-item">
                    <h3>${simulator.name}</h3>
                    <div class="simulator-details">
                        <div class="simulator-status">
                            <span class="status-label">Статус:</span>
                            <select id="simulator${simulator.id}-status" class="status-select" 
                                    onchange="updateSimulatorStatus(${simulator.id}, this.value)">
                                <option value="true" ${simulator.is_working ? 'selected' : ''}>В работе</option>
                                <option value="false" ${!simulator.is_working ? 'selected' : ''}>Не работает</option>
                            </select>
                        </div>
                        <div class="simulator-hours">
                            <div class="hours-group">
                                <label>Начало работы:</label>
                                <input type="time" 
                                       id="simulator${simulator.id}-start" 
                                       value="${simulator.working_hours_start || '09:00'}"
                                       onchange="updateSimulatorHours(${simulator.id})">
                            </div>
                            <div class="hours-group">
                                <label>Окончание работы:</label>
                                <input type="time" 
                                       id="simulator${simulator.id}-end" 
                                       value="${simulator.working_hours_end || '21:00'}"
                                       onchange="updateSimulatorHours(${simulator.id})">
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
            console.log('HTML тренажеров успешно сформирован и вставлен');
        } else {
            console.error('Элемент .simulators-list не найден на странице');
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренажеров:', error);
        const simulatorsList = document.querySelector('.simulators-list');
        if (simulatorsList) {
            simulatorsList.innerHTML = `
                <div class="alert alert-danger">
                    Ошибка при загрузке тренажеров: ${error.message}
                </div>
            `;
        }
        showError('Не удалось загрузить тренажеры');
    }
}

// Загрузка тренеров
async function loadTrainers() {
    try {
        const response = await fetch('/api/trainers');
        const trainers = await response.json();
        
        // Маппинг значений для вида спорта
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд'
        };
        
        // Разделяем тренеров на активных и уволенных
        const activeTrainers = trainers.filter(trainer => trainer.is_active);
        const dismissedTrainers = trainers.filter(trainer => !trainer.is_active);
        
        const trainersList = document.querySelector('.trainers-list');
        if (trainersList) {
            // Добавляем кнопку для просмотра уволенных тренеров
            const dismissedButton = document.createElement('button');
            dismissedButton.className = 'btn-secondary';
            dismissedButton.style.marginBottom = '20px';
            dismissedButton.innerHTML = `Уволенные тренеры (${dismissedTrainers.length})`;
            console.log('[loadTrainers] Кнопка "Уволенные тренеры" создана, dismissedTrainers:', dismissedTrainers);
            dismissedButton.onclick = () => {
                console.log('[loadTrainers] Кнопка "Уволенные тренеры" нажата');
                showDismissedTrainersModal(dismissedTrainers);
            };
            
            // Очищаем список и добавляем кнопку
            trainersList.innerHTML = '';
            trainersList.appendChild(dismissedButton);
            
            // Отображаем только активных тренеров
            if (activeTrainers.length === 0) {
                trainersList.innerHTML += '<div class="alert alert-info">Нет активных тренеров</div>';
            } else {
                trainersList.innerHTML += activeTrainers.map(trainer => `
                    <div class="trainer-item">
                        <div class="trainer-photo">
                            ${trainer.photo_url ? 
                                `<img src="${trainer.photo_url}" alt="${trainer.full_name}" style="width: 100px; height: 150px; object-fit: cover; border-radius: 8px;">` :
                                `<div class="no-photo" style="width: 100px; height: 150px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px; text-align: center;">Нет фото</div>`
                            }
                        </div>
                        <div class="trainer-info">
                            <h3>${trainer.full_name}</h3>
                            <p>Вид спорта: ${sportTypeMapping[trainer.sport_type] || trainer.sport_type}</p>
                            <p>Телефон: ${trainer.phone}</p>
                            <p>Статус: Работает</p>
                        </div>
                        <div class="trainer-actions">
                            <button class="btn-secondary" onclick="viewTrainer(${trainer.id})">Просмотр</button>
                            <button class="btn-secondary" onclick="editTrainer(${trainer.id})">Редактировать</button>
                            <button class="btn-danger" onclick="dismissTrainer(${trainer.id})">Уволить</button>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренеров:', error);
        showError('Не удалось загрузить тренеров');
    }

    // В loadTrainers сохраняем dismissedTrainers глобально для диагностики
    window.lastDismissedTrainers = dismissedTrainers;
}

// Функция для отображения модального окна с уволенными тренерами
function showDismissedTrainersModal(dismissedTrainers) {
    console.log('[showDismissedTrainersModal] вызвана, dismissedTrainers:', dismissedTrainers);
    // Маппинг значений для вида спорта
    const sportTypeMapping = {
        'ski': 'Горные лыжи',
        'snowboard': 'Сноуборд'
    };
    try {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <h3>Уволенные тренеры</h3>
                <div class="dismissed-trainers-list">
                    ${dismissedTrainers.length === 0 ? 
                        '<div class="alert alert-info">Нет уволенных тренеров</div>' :
                        dismissedTrainers.map(trainer => `
                            <div class="trainer-item">
                                <div class="trainer-info">
                                    <h3>${trainer.full_name}</h3>
                                    <p>Вид спорта: ${sportTypeMapping[trainer.sport_type] || trainer.sport_type}</p>
                                    <p>Телефон: ${trainer.phone}</p>
                                    <p>Дата увольнения: ${formatDate(trainer.dismissed_at)}</p>
                                </div>
                                <div class="trainer-actions">
                                    <button class="btn-secondary" onclick="viewTrainer(${trainer.id})">Просмотр</button>
                                    <button class="btn-primary" onclick="rehireTrainer(${trainer.id})">Восстановить</button>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
                <div class="modal-actions">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';
        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        console.log('[showDismissedTrainersModal] Модальное окно создано и показано');
    } catch (err) {
        console.error('[showDismissedTrainersModal] Ошибка:', err);
    }
}

// Функция для редактирования тренера
async function editTrainer(trainerId) {
    try {
        const response = await fetch(`/api/trainers/${trainerId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const trainer = await response.json();
        
        // Маппинг значений для вида спорта
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд'
        };
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Редактирование тренера</h3>
                <form id="editTrainerForm">
                    <input type="hidden" name="hire_date" value="${trainer.hire_date}">
                    <input type="hidden" name="is_active" value="${trainer.is_active}">
                    <input type="hidden" name="dismissal_date" value="${trainer.dismissal_date || ''}">
                    <div class="trainer-current-info" style="margin-bottom: 20px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">
                        <p><strong>Текущая информация:</strong></p>
                        <p>Дата рождения: ${new Date(trainer.birth_date).toLocaleDateString('ru-RU')}</p>
                        <p>Дата приема: ${new Date(trainer.hire_date).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <div class="form-group">
                        <label for="full_name">ФИО:</label>
                        <input type="text" id="full_name" name="full_name" value="${trainer.full_name}" required>
                    </div>
                    <div class="form-group">
                        <label for="birth_date">Дата рождения:</label>
                        <input type="date" id="birth_date" name="birth_date" value="${formatDateForInput(trainer.birth_date)}" required>
                    </div>
                    <div class="form-group">
                        <label for="sport_type">Вид спорта:</label>
                        <select id="sport_type" name="sport_type" required>
                            <option value="">Выберите вид спорта</option>
                            ${Object.entries(sportTypeMapping).map(([value, label]) => 
                                `<option value="${value}" ${trainer.sport_type === value ? 'selected' : ''}>${label}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="phone">Телефон:</label>
                        <input type="tel" id="phone" name="phone" value="${trainer.phone}" required>
                    </div>
                    <div class="form-group">
                        <label for="email">Email:</label>
                        <input type="email" id="email" name="email" value="${trainer.email || ''}">
                    </div>
                    <div class="form-group">
                        <label for="trainer_photo">Фото тренера:</label>
                        <div class="current-photo" style="margin-bottom: 10px;">
                            ${trainer.photo_url ? 
                                `<img id="current-trainer-photo" src="${trainer.photo_url}" alt="${trainer.full_name}" style="max-width: 150px; height: auto; max-height: 200px; border-radius: 8px; margin-bottom: 10px;">` :
                                `<div class="no-photo" style="width: 150px; height: 100px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; margin-bottom: 10px;">Нет фото</div>`
                            }
                        </div>
                        <input type="file" id="trainer_photo" name="trainer_photo" accept="image/*" onchange="previewTrainerPhoto(this)">
                        <small style="color: #666; display: block; margin-top: 5px;">Фото будет автоматически сжато до высоты 200px и конвертировано в WebP формат</small>
                    </div>
                    <div class="form-group">
                        <label for="description">Описание:</label>
                        <textarea id="description" name="description">${trainer.description || ''}</textarea>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        
        // Обработка сохранения
        document.getElementById('editTrainerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);
            
            // Проверяем, есть ли загруженное фото
            const photoFile = form.querySelector('#trainer_photo').files[0];
            
            try {
                let currentTrainer = { ...trainer };
                
                // Если есть новое фото, сначала загружаем его
                if (photoFile) {
                    const photoFormData = new FormData();
                    photoFormData.append('photo', photoFile);
                    
                    const photoResponse = await fetch(`/api/trainers/${trainerId}/upload-photo`, {
                        method: 'POST',
                        body: photoFormData
                    });
                    
                    if (!photoResponse.ok) {
                        const photoError = await photoResponse.json();
                        throw new Error(photoError.error || 'Ошибка при загрузке фото');
                    }
                    
                    const photoResult = await photoResponse.json();
                    currentTrainer.photo_url = photoResult.photo_url;
                }
                
                // Обновляем остальные данные тренера
            const data = {
                    ...currentTrainer,  // Сохраняем все существующие данные тренера
                    full_name: formData.get('full_name'),
                    phone: formData.get('phone'),
                    birth_date: formData.get('birth_date'),
                    sport_type: formData.get('sport_type'),
                    description: formData.get('description'),
                    hire_date: formData.get('hire_date'),
                    is_active: formData.get('is_active'),
                id: trainerId // Убеждаемся, что ID не изменился
            };
            
                const response = await fetch(`/api/trainers/${trainerId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Ошибка при обновлении тренера');
                }
                
                modal.remove();
                await loadTrainers();
                showSuccess('Данные тренера успешно обновлены');
            } catch (error) {
                console.error('Ошибка при обновлении тренера:', error);
                showError(error.message || 'Не удалось обновить данные тренера');
            }
        });
    } catch (error) {
        console.error('Ошибка при загрузке данных тренера:', error);
        showError('Не удалось загрузить данные тренера');
    }
}

// Загрузка клиентов
async function loadClients() {
    try {
        console.log('Начало загрузки клиентов');
        const response = await fetch('/api/clients');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allClients = await response.json();
        console.log('Получены данные клиентов:', allClients);
        
        const clientsContainer = document.getElementById('clientsContainer');
        if (!clientsContainer) {
            throw new Error('Элемент clientsContainer не найден');
        }

        // Применяем текущие фильтры и сортировку
        displayClients();
        
        console.log('Таблица клиентов успешно отрендерена');
    } catch (error) {
        console.error('Ошибка при загрузке клиентов:', error);
        const clientsContainer = document.getElementById('clientsContainer');
        if (clientsContainer) {
            clientsContainer.innerHTML = `<div class="error-message">Ошибка при загрузке клиентов: ${error.message}</div>`;
        }
    }
}

// Функция для определения дней рождения в текущем месяце
function isBirthdayInCurrentMonth(birthDate) {
    const today = new Date();
    const birthDateObj = new Date(birthDate);
    return birthDateObj.getMonth() === today.getMonth();
}

// Функция для определения ближайших дней рождения (10 дней)
function isBirthdayUpcoming(birthDate) {
    const today = new Date();
    const birthDateObj = new Date(birthDate);
    const currentYear = today.getFullYear();
    
    // Устанавливаем год рождения на текущий год
    birthDateObj.setFullYear(currentYear);
    
    // Если день рождения уже прошел в этом году, берем следующий год
    if (birthDateObj < today) {
        birthDateObj.setFullYear(currentYear + 1);
    }
    
    // Вычисляем разницу в днях
    const diffTime = birthDateObj - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays <= 10 && diffDays > 0;
}

// Функция для определения дня рождения сегодня
function isBirthdayToday(birthDate) {
    const today = new Date();
    const birthDateObj = new Date(birthDate);
    return birthDateObj.getDate() === today.getDate() && 
           birthDateObj.getMonth() === today.getMonth();
}

// Функция для получения класса подсветки дня рождения
function getBirthdayClass(birthDate) {
    if (!birthDate) return '';
    const today = new Date();
    const date = new Date(birthDate);
    const currentYear = today.getFullYear();
    date.setFullYear(currentYear);

    // Разница в днях относительно сегодняшнего дня
    const diffDays = Math.floor((date - today) / (1000 * 60 * 60 * 24));

    // Если день рождения уже прошёл в этом году, считаем до следующего года
    if (diffDays < -3) {
        date.setFullYear(currentYear + 1);
    }
    const realDiffDays = Math.floor((date - today) / (1000 * 60 * 60 * 24));

    // Жёлтый фон и обычный 🎂 — только если сегодня день рождения
    if (date.getDate() === today.getDate() && date.getMonth() === today.getMonth()) {
        return 'birthday-today';
    }
    // Голубой фон и мигающий 🎂 — 3 дня до дня рождения (строго до)
    if (realDiffDays > 0 && realDiffDays <= 3) {
        return 'birthday-upcoming';
    }
    // Серый фон и мигающий 🎂 — 3 дня после дня рождения (строго после)
    if (realDiffDays < 0 && realDiffDays >= -3) {
        return 'birthday-after';
    }
    // Фиолетовый фон и мигающий 🎂 — за 10 дней до дня рождения (но не попадает в голубой/жёлтый)
    if (realDiffDays > 3 && realDiffDays <= 10) {
        return 'birthday-current-month';
    }
    return '';
}

// Функция для форматирования даты дня рождения
function formatBirthday(birthDate) {
    const date = new Date(birthDate);
    return `${date.getDate()} ${date.toLocaleString('ru', { month: 'long' })}`;
}

// Обновленная функция отображения клиентов
function displayClients() {
    const clientsContainer = document.getElementById('clientsContainer');
    const searchInput = document.getElementById('clientSearch');
    const sortSelect = document.getElementById('clientSort');
    
    if (!clientsContainer || !searchInput || !sortSelect) return;

    // Получаем значения фильтров
    const searchTerm = searchInput.value.toLowerCase();
    const sortValue = sortSelect.value;

    // Фильтруем клиентов
    let filteredClients = allClients.filter(client => {
        const fullNameMatch = client.full_name.toLowerCase().includes(searchTerm);
        const phoneMatch = client.phone.toLowerCase().includes(searchTerm);
        const childNameMatch = client.child_name ? client.child_name.toLowerCase().includes(searchTerm) : false;
        return fullNameMatch || phoneMatch || childNameMatch;
    });

    // Сортируем клиентов
    filteredClients.sort((a, b) => {
        switch (sortValue) {
            case 'created_desc':
                return new Date(b.created_at) - new Date(a.created_at);
            case 'created_asc':
                return new Date(a.created_at) - new Date(b.created_at);
            case 'name_asc':
                return a.full_name.localeCompare(b.full_name);
            case 'name_desc':
                return b.full_name.localeCompare(a.full_name);
            case 'child_name_asc':
                return (a.child_name || '').localeCompare(b.child_name || '');
            case 'child_name_desc':
                return (b.child_name || '').localeCompare(a.child_name || '');
            case 'birthday_closest': {
                // Сортируем по ближайшему дню рождения (клиент или ребёнок)
                return (
                    Math.min(daysToNextBirthday(a.birth_date), daysToNextBirthday(a.child_birth_date))
                    - Math.min(daysToNextBirthday(b.birth_date), daysToNextBirthday(b.child_birth_date))
                );
            }
            default:
                return 0;
        }
    });

    // Формируем HTML таблицы
    const tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>№</th>
                    <th>ФИО</th>
                    <th>Возраст</th>
                    <th>Телефон</th>
                    <th>Уровень</th>
                    <th>Ребенок</th>
                    <th>Возраст</th>
                    <th>Уровень</th>
                    <th>Баланс</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${filteredClients.map((client, index) => {
                    const birthDate = new Date(client.birth_date);
                    const childBirthDate = client.child_birth_date ? new Date(client.child_birth_date) : null;
                    const today = new Date();
                    
                    const clientBirthdayClass = getBirthdayClass(client.birth_date);
                    const childBirthdayClass = childBirthDate ? getBirthdayClass(childBirthDate) : '';
                    
                    const clientAge = Math.floor((today - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
                    const childAge = childBirthDate ? 
                        Math.floor((today - childBirthDate) / (365.25 * 24 * 60 * 60 * 1000)) : null;
                    
                    let clientBirthdayText = '';
                    if (clientBirthdayClass === 'birthday-today') {
                        clientBirthdayText = `<span class="birthday-text">🎂<span class='birthday-date-red'>${formatBirthdayShort(client.birth_date)}</span></span>`;
                    } else if (
                        clientBirthdayClass === 'birthday-upcoming' ||
                        clientBirthdayClass === 'birthday-after' ||
                        clientBirthdayClass === 'birthday-current-month') {
                        clientBirthdayText = `<span class="birthday-text birthday-cake-blink">🎂<span class='birthday-date-red'>${formatBirthdayShort(client.birth_date)}</span></span>`;
                    }
                    let childBirthdayText = '';
                    if (childBirthdayClass === 'birthday-today') {
                        childBirthdayText = `<span class="birthday-text">🎂<span class='birthday-date-red'>${formatBirthdayShort(childBirthDate)}</span></span>`;
                    } else if (
                        childBirthdayClass === 'birthday-upcoming' ||
                        childBirthdayClass === 'birthday-after' ||
                        childBirthdayClass === 'birthday-current-month') {
                        childBirthdayText = `<span class="birthday-text birthday-cake-blink">🎂<span class='birthday-date-red'>${formatBirthdayShort(childBirthDate)}</span></span>`;
                    }
                    
                    return `
                        <tr class="${clientBirthdayClass || childBirthdayClass}">
                            <td>${index + 1}</td>
                            <td>${client.full_name} ${clientBirthdayText}</td>
                            <td>${clientAge} лет</td>
                            <td>${client.phone}</td>
                            <td>${client.skill_level || '-'}</td>
                            <td>${client.child_name ? client.child_name + childBirthdayText : '-'}</td>
                            <td>${childAge ? `${childAge} лет` : '-'}</td>
                            <td>${client.child_skill_level || '-'}</td>
                            <td>${client.balance || 0} ₽</td>
                            <td>
                                <button onclick="editClient(${client.id})" class="edit-button">✏️</button>
                                ${client.child_id ? `<button onclick="editChild(${client.child_id})" class="edit-button">✏️👶</button>` : ''}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    const legendHtml = `<div style="margin-bottom:8px;font-size:0.98em;">
      <span style="background:#ffeb3b;padding:2px 8px;border-radius:4px;">Сегодня 🎂</span>
      <span style="background:#e3f2fd;padding:2px 8px;border-radius:4px;">3 дня до <span class='birthday-text birthday-cake-blink'>🎂</span></span>
      <span style="background:#bdbdbd;padding:2px 8px;border-radius:4px;">3 дня после <span class='birthday-text birthday-cake-blink'>🎂</span></span>
      <span style="background:#f3e5f5;padding:2px 8px;border-radius:4px;">10 дней до <span class='birthday-text birthday-cake-blink'>🎂</span></span>
    </div>`;

    clientsContainer.innerHTML = legendHtml + tableHtml;
}

// Добавляем обработчики событий для поиска и сортировки
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('clientSearch');
    const sortSelect = document.getElementById('clientSort');

    if (searchInput) {
        searchInput.addEventListener('input', displayClients);
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', displayClients);
    }
});

// Загрузка прайса
async function loadPrices() {
    try {
        const response = await fetch('/api/prices');
        const prices = await response.json();
        let missing = 0;
        document.querySelectorAll('.price-input').forEach(input => {
            const key = input.dataset.price;
            if (prices.hasOwnProperty(key)) {
                input.value = prices[key];
                input.classList.remove('price-missing');
            } else {
                input.value = '';
                input.classList.add('price-missing');
                missing++;
            }
        });
        if (missing > 0) {
            showError(`В базе отсутствует ${missing} цен(ы) для некоторых комбинаций. Проверьте таблицу prices!`);
        }
    } catch (error) {
        console.error('Ошибка при загрузке прайса:', error);
        showError('Не удалось загрузить прайс');
    }
}

// Загрузка сертификатов
async function loadCertificates() {
    try {
        const response = await fetch('/api/certificates');
        const certificates = await response.json();
        
        const certificatesList = document.querySelector('.certificates-list');
        if (certificatesList) {
            certificatesList.innerHTML = certificates.map(cert => `
                <div class="certificate-item">
                    <div class="certificate-info">
                        <h3>Сертификат #${cert.certificate_number}</h3>
                        <p>Сумма: ${cert.amount} ₽</p>
                        <p>Статус: ${cert.status}</p>
                        <p>Срок действия: ${formatDate(cert.expiry_date)}</p>
                    </div>
                    <div class="certificate-actions">
                        <button class="btn-secondary" onclick="viewCertificate(${cert.id})">Просмотр</button>
                        <button class="btn-secondary" onclick="editCertificate(${cert.id})">Редактировать</button>
                        <button class="btn-danger" onclick="deleteCertificate(${cert.id})">Удалить</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке сертификатов:', error);
        showError('Не удалось загрузить сертификаты');
    }
}

// === ФИНАНСЫ: UI и логика ===

// Вставка фильтра по датам и кнопок экспорта (если их нет)
function renderFinancesControls() {
    let controls = document.getElementById('finances-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'finances-controls';
        controls.style.display = 'flex';
        controls.style.gap = '16px';
        controls.style.alignItems = 'center';
        controls.style.marginBottom = '24px';
        controls.innerHTML = `
            <input type="date" id="finances-start-date" style="padding:6px;">
            <input type="date" id="finances-end-date" style="padding:6px;">
            <button id="finances-apply-btn" class="btn-primary">Применить</button>
            <button id="finances-export-full" class="btn-secondary">Экспорт полного отчёта</button>
            <button id="finances-export-summary" class="btn-secondary">Экспорт итогов</button>
        `;
        const financesPage = document.querySelector('.finances-list')?.parentElement || document.querySelector('.finances-list');
        if (financesPage) financesPage.prepend(controls);
        
        // Установить значения по умолчанию ТОЛЬКО при первом создании контролов
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        document.getElementById('finances-start-date').value = firstDay.toISOString().split('T')[0];
        document.getElementById('finances-end-date').value = lastDay.toISOString().split('T')[0];
    }
}

// --- Индикатор загрузки ---
function showLoading(message = 'Загрузка...') {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        overlay.style.cssText = `
            position: fixed; top:0; left:0; width:100vw; height:100vh;
            background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 9999;`;
        const box = document.createElement('div');
        box.style.cssText = 'background:white;padding:24px 32px;border-radius:8px;font-size:18px;box-shadow:0 2px 8px #0002;';
        box.innerText = message;
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }
}
function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
}

// --- Форма для редактирования стоимости аренды ---
function renderRentalCostForm() {
    let form = document.getElementById('rental-cost-form');
    if (!form) {
        form = document.createElement('form');
        form.id = 'rental-cost-form';
        form.style = 'margin-bottom:24px;display:flex;gap:16px;align-items:center;';
        form.innerHTML = `
            <label>Стоимость аренды 30 мин: <input type="number" id="rental-cost-30" min="0" style="width:90px;"></label>
            <label>Стоимость аренды 60 мин: <input type="number" id="rental-cost-60" min="0" style="width:90px;"></label>
            <button type="submit" class="btn-primary">Сохранить</button>
        `;
        const controls = document.getElementById('finances-controls');
        if (controls) controls.parentElement.insertBefore(form, controls.nextSibling);
    }
    // Загрузка текущих значений
    fetch('/api/finances/rental-cost').then(r=>r.json()).then(data=>{
        document.getElementById('rental-cost-30').value = data.cost_30;
        document.getElementById('rental-cost-60').value = data.cost_60;
    });
    // Обработчик сохранения
    form.onsubmit = async function(e) {
        e.preventDefault();
        const cost_30 = parseInt(document.getElementById('rental-cost-30').value);
        const cost_60 = parseInt(document.getElementById('rental-cost-60').value);
        try {
            showLoading('Сохраняю...');
            const resp = await fetch('/api/finances/rental-cost', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cost_30, cost_60 })
            });
            if (!resp.ok) throw new Error('Ошибка при сохранении');
            showSuccess('Стоимость аренды сохранена');
            hideLoading();
            await loadFinances();
        } catch (e) {
            hideLoading();
            showError('Ошибка при сохранении');
        }
    };
}

// Основная функция загрузки и отображения финансов
async function loadFinances() {
    // Сохраняем текущие значения дат перед переинициализацией контролов
    const currentStartDate = document.getElementById('finances-start-date')?.value;
    const currentEndDate = document.getElementById('finances-end-date')?.value;
    
    renderFinancesControls();
    renderRentalCostForm();
    setupFinancesEvents(); // Переустанавливаем обработчики событий каждый раз
    
    // Восстанавливаем сохранённые даты, если они были
    if (currentStartDate) {
        document.getElementById('finances-start-date').value = currentStartDate;
    }
    if (currentEndDate) {
        document.getElementById('finances-end-date').value = currentEndDate;
    }
    
    const startDate = document.getElementById('finances-start-date').value;
    const endDate = document.getElementById('finances-end-date').value;
    try {
        showLoading('Загрузка финансов...');
        const response = await fetch(`/api/finances/statistics?start_date=${startDate}&end_date=${endDate}`);
        if (!response.ok) throw new Error('Ошибка при загрузке статистики');
        const data = await response.json();
        const financesList = document.querySelector('.finances-list');
        let html = `
            <div class="finance-summary">
                <div class="summary-section">
                    <h3>Доходы</h3>
                    <div class="summary-item">
                        <span>Поступившие средства:</span>
                        <span class="amount income">${formatCurrency(data.refill_income)}</span>
                    </div>
                    <div class="summary-item">
                        <span>От групповых тренировок:</span>
                        <span class="amount income">${formatCurrency(data.group_income)}</span>
                    </div>
                    <div class="summary-item">
                        <span>От индивидуальных тренировок:</span>
                        <span class="amount income">${formatCurrency(data.individual_income)}</span>
                    </div>
                    <div class="summary-item total">
                        <span>Общий доход:</span>
                        <span class="amount income">${formatCurrency(data.total_income)}</span>
                    </div>
                </div>

                <div class="summary-section">
                    <h3>Расходы</h3>
                    <div class="summary-item">
                        <span>Групповые тренировки:</span>
                        <span class="amount expense">${formatCurrency(data.group_expenses)}</span>
                    </div>
                    <div class="summary-item">
                        <span>Индивидуальные тренировки:</span>
                        <span class="amount expense">${formatCurrency(data.individual_expenses)}</span>
                    </div>
                    <div class="summary-item total">
                        <span>Общие расходы:</span>
                        <span class="amount expense">${formatCurrency(data.total_expenses)}</span>
                    </div>
                </div>

                <div class="summary-section">
                    <h3>Прибыль</h3>
                    <div class="summary-item">
                        <span>С групповых тренировок:</span>
                        <span class="amount ${data.group_profit >= 0 ? 'profit' : 'loss'}">${formatCurrency(data.group_profit)}</span>
                    </div>
                    <div class="summary-item">
                        <span>С индивидуальных тренировок:</span>
                        <span class="amount ${data.individual_profit >= 0 ? 'profit' : 'loss'}">${formatCurrency(data.individual_profit)}</span>
                    </div>
                    <div class="summary-item total">
                        <span>Общая прибыль:</span>
                        <span class="amount ${data.total_profit >= 0 ? 'profit' : 'loss'}">${formatCurrency(data.total_profit)}</span>
                    </div>
                </div>
            </div>

            <div class="finance-details">
                <div class="details-section">
                    <h3>Статистика тренировок</h3>
                    <ul>
                        <li>Групповых тренировок: ${data.stats.group_sessions}</li>
                        <li>Индивидуальных 30-минутных: ${data.stats.individual_sessions_30}</li>
                        <li>Индивидуальных 60-минутных: ${data.stats.individual_sessions_60}</li>
                    </ul>
                </div>
            </div>
        `;

        // --- Выводим список транзакций ---
        const txResponse = await fetch(`/api/finances?start_date=${startDate}&end_date=${endDate}`);
        const txList = await txResponse.json();
        if (Array.isArray(txList) && txList.length) {
            html += `
                <h3 style="margin-top:32px;">Транзакции</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Тип</th>
                            <th>Сумма</th>
                            <th>Дата</th>
                            <th>Описание</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${txList.map(tx => `
                            <tr>
                                <td>${tx.id}</td>
                                <td>${getTransactionTypeRu(tx.type)}</td>
                                <td>${formatCurrency(tx.amount)}</td>
                                <td>${formatDate(tx.created_at)}</td>
                                <td>${tx.description || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            html += `<div style="margin-top:32px;color:#888;">Нет транзакций за выбранный период</div>`;
        }
        if (financesList) financesList.innerHTML = html;
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Не удалось загрузить финансовые данные');
    }
}

// Слушатели для фильтра и экспорта
function setupFinancesEvents() {
    document.addEventListener('click', async (e) => {
        if (e.target.id === 'finances-apply-btn') {
            await loadFinances();
        }
        if (e.target.id === 'finances-export-full') {
            await exportFinancesExcel('full');
        }
        if (e.target.id === 'finances-export-summary') {
            await exportFinancesExcel('summary');
        }
    });
}

// Экспорт в Excel
async function exportFinancesExcel(type) {
    const startDate = document.getElementById('finances-start-date').value;
    const endDate = document.getElementById('finances-end-date').value;
    try {
        showLoading('Подготовка файла...');
        const url = new URL('/api/finances/export', window.location.origin);
        url.searchParams.append('start_date', startDate);
        url.searchParams.append('end_date', endDate);
        url.searchParams.append('type', type);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Ошибка при экспорте');
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `finance-report-${startDate}-${endDate}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        showSuccess('Отчет успешно экспортирован');
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Ошибка при экспорте отчета');
    }
}

// Форматирование валюты
function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    }).format(amount);
}

// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
}

// Переинициализация событий при загрузке страницы
(function () {
    setupFinancesEvents();
})();

// Обработчики форм
async function handleCreateTraining(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    
    try {
        const response = await fetch('/api/trainings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            closeModal('create-training-modal');
            loadTrainings();
            showSuccess('Тренировка успешно создана');
        } else {
            throw new Error('Ошибка при создании тренировки');
        }
    } catch (error) {
        console.error('Ошибка при создании тренировки:', error);
        showError('Не удалось создать тренировку');
    }
}

async function handleCreateTrainer(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    
    try {
        const response = await fetch('/api/trainers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            closeModal('create-trainer-modal');
            loadTrainers();
            showSuccess('Тренер успешно создан');
        } else {
            throw new Error('Ошибка при создании тренера');
        }
    } catch (error) {
        console.error('Ошибка при создании тренера:', error);
        showError('Не удалось создать тренера');
    }
}

async function handleCreateSchedule(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = {
        start_date: formData.get('schedule-start-date'),
        end_date: formData.get('schedule-end-date'),
        weekdays: Array.from(document.querySelectorAll('.weekdays-select input:checked'))
            .map(input => input.value),
        simulator1: {
            start_time: formData.get('simulator1-start'),
            end_time: formData.get('simulator1-end')
        },
        simulator2: {
            start_time: formData.get('simulator2-start'),
            end_time: formData.get('simulator2-end')
        },
        auto_schedule: {
            enabled: formData.get('auto-schedule') === 'on',
            day: formData.get('schedule-day'),
            time: formData.get('schedule-time'),
            timezone: 'Asia/Yekaterinburg'
        }
    };
    
    try {
        const response = await fetch('/api/schedule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            closeModal('create-schedule-modal');
            loadSchedule();
            showSuccess('Расписание успешно создано');
        } else {
            throw new Error('Ошибка при создании расписания');
        }
    } catch (error) {
        console.error('Ошибка при создании расписания:', error);
        showError('Не удалось создать расписание');
    }
}

// Загрузка архивных тренировок
async function loadArchiveTrainings() {
    try {
        const response = await fetch('/api/trainings/archive');
        const trainings = await response.json();
        
        const archiveList = document.querySelector('.archive-list');
        if (archiveList) {
            archiveList.innerHTML = trainings.map(training => `
                <div class="training-item">
                    <div class="training-info">
                        <h3>${training.name}</h3>
                        <p>Дата: ${formatDate(training.date)}</p>
                        <p>Время: ${training.start_time} - ${training.end_time}</p>
                        <p>Группа: ${training.group_name}</p>
                        <p>Участники: ${training.participants_count}/${training.max_participants}</p>
                    </div>
                    <div class="training-actions">
                        <button class="btn-secondary" onclick="viewTrainingDetails(${training.id})">Посмотреть тренировку</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке архивных тренировок:', error);
        showError('Не удалось загрузить архивные тренировки');
    }
}

// Просмотр деталей тренировки
async function viewTrainingDetails(trainingId) {
    try {
        const response = await fetch(`/api/trainings/${trainingId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const training = await response.json();
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Детали тренировки</h3>
                <div class="training-details">
                    <div class="detail-group">
                        <h4>Основная информация</h4>
                        <p><strong>Дата:</strong> ${formatDate(training.session_date)}</p>
                        <p><strong>Время:</strong> ${training.start_time.slice(0,5)} - ${training.end_time.slice(0,5)}</p>
                        <p><strong>Тренажёр:</strong> ${training.simulator_id}</p>
                        <p><strong>Группа:</strong> ${training.group_name || 'Не указана'}</p>
                        <p><strong>Тренер:</strong> ${training.trainer_name || 'Не указан'}</p>
                        <p><strong>Уровень:</strong> ${training.skill_level}</p>
                        <p><strong>Цена:</strong> ${training.price != null ? training.price : '-'} ₽</p>
                    </div>
                    <div class="detail-group">
                        <h4>Участники (${training.participants_count || 0}/${training.max_participants})</h4>
                        <table class="participants-table">
                            <thead>
                                <tr>
                                    <th>ФИО</th>
                                    <th>Возраст</th>
                                    <th>Уровень</th>
                                    <th>Контактный телефон</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${training.participants ? training.participants.map(participant => {
                                    const birthDate = new Date(participant.birth_date);
                                    const age = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
                                    return `
                                        <tr>
                                            <td>${participant.full_name}</td>
                                            <td>${age} лет</td>
                                            <td>${participant.skill_level || '-'}</td>
                                            <td>${participant.phone || '-'}</td>
                                        </tr>
                                    `;
                                }).join('') : '<tr><td colspan="4">Нет участников</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
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
        showError('Не удалось загрузить детали тренировки');
    }
}

// Загрузка групп
async function loadGroups() {
    try {
        const response = await fetch('/api/groups');
        const groups = await response.json();
        
        const groupsList = document.querySelector('.groups-list');
        if (groupsList) {
            if (groups.length === 0) {
                groupsList.innerHTML = `
                    <div class="no-groups-message">
                        <p>Группы не найдены</p>
                        <button class="btn-primary" onclick="showModal('create-group-modal')">Создать группу</button>
                    </div>`;
            } else {
                groupsList.innerHTML = groups.map(group => `
                    <div class="group-item">
                        <div class="group-info">
                            <h3>${group.name}</h3>
                            <p>${group.description || ''}</p>
                        </div>
                        <div class="group-actions">
                            <button class="btn-secondary" onclick="editGroup(${group.id})">Редактировать</button>
                            <button class="btn-danger" onclick="deleteGroup(${group.id})">Удалить</button>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Ошибка при загрузке групп:', error);
        showError('Не удалось загрузить группы');
    }
}

// Редактирование группы
async function editGroup(groupId) {
    try {
        const response = await fetch(`/api/groups/${groupId}`);
        const group = await response.json();
        
        document.getElementById('group-name').value = group.name;
        document.getElementById('group-description').value = group.description || '';
        
        // Изменяем заголовок и текст кнопки
        const modalTitle = document.querySelector('#create-group-modal h3');
        const submitButton = document.querySelector('#create-group-form button[type="submit"]');
        
        modalTitle.textContent = 'Редактировать группу';
        submitButton.textContent = 'Сохранить';
        
        showModal('create-group-modal');
    } catch (error) {
        console.error('Ошибка при загрузке данных группы:', error);
        showError('Не удалось загрузить данные группы');
    }
}

// Удаление группы
async function deleteGroup(groupId) {
    if (confirm('Вы уверены, что хотите удалить эту группу?')) {
        try {
            const response = await fetch(`/api/groups/${groupId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                loadGroups();
                showSuccess('Группа успешно удалена');
            } else {
                throw new Error('Ошибка при удалении группы');
            }
        } catch (error) {
            console.error('Ошибка при удалении группы:', error);
            showError('Не удалось удалить группу');
        }
    }
}

// Вспомогательные функции
function formatDate(date) {
    return new Date(date).toLocaleDateString('ru-RU');
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.remove();
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger';
    errorDiv.textContent = message;
    document.querySelector('.admin-content').insertBefore(errorDiv, document.querySelector('.admin-content').firstChild);
    setTimeout(() => errorDiv.remove(), 3000);
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'alert alert-success';
    successDiv.textContent = message;
    document.querySelector('.admin-content').insertBefore(successDiv, document.querySelector('.admin-content').firstChild);
    setTimeout(() => successDiv.remove(), 3000);
}

// Закрытие модальных окон при клике вне их области
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

// Закрытие модальных окон при клике вне их области
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// Обновление статуса тренажера
async function updateSimulatorStatus(simulatorId, isWorking) {
    try {
        const response = await fetch(`/api/simulators/${simulatorId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_working: isWorking === 'true' })
        });

        if (!response.ok) {
            throw new Error('Ошибка при обновлении статуса');
        }

        const updatedSimulator = await response.json();
        showSuccess('Статус тренажера обновлен');
        
        // Обновляем отображение статуса
        const statusSelect = document.getElementById(`simulator${simulatorId}-status`);
        if (statusSelect) {
            statusSelect.value = updatedSimulator.is_working.toString();
        }
    } catch (error) {
        console.error('Ошибка при обновлении статуса тренажера:', error);
        showError('Не удалось обновить статус тренажера');
    }
}

// Обновление рабочих часов тренажера
async function updateSimulatorHours(simulatorId) {
    const startTime = document.getElementById(`simulator${simulatorId}-start`).value;
    const endTime = document.getElementById(`simulator${simulatorId}-end`).value;

    try {
        const response = await fetch(`/api/simulators/${simulatorId}/hours`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                working_hours_start: startTime,
                working_hours_end: endTime
            })
        });

        if (!response.ok) {
            throw new Error('Ошибка при обновлении рабочих часов');
        }

        const updatedSimulator = await response.json();
        showSuccess('Рабочие часы обновлены');
    } catch (error) {
        console.error('Ошибка при обновлении рабочих часов:', error);
        showError('Не удалось обновить рабочие часы');
    }
}

// Сохранение прайса
async function savePrices() {
    try {
        const prices = {};
        document.querySelectorAll('.price-input').forEach(input => {
            prices[input.dataset.price] = parseInt(input.value);
        });

        const response = await fetch('/api/prices', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(prices)
        });

        if (response.ok) {
            showSuccess('Прайс успешно обновлен');
        } else {
            throw new Error('Ошибка при обновлении прайса');
        }
    } catch (error) {
        console.error('Ошибка при сохранении прайса:', error);
        showError('Не удалось сохранить прайс');
    }
}

// Функция сохранения ссылки оплаты
async function savePaymentLink() {
    const link = document.getElementById('payment-link').value;
    try {
        const response = await fetch('/api/payment-link', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ link })
        });

        if (response.ok) {
            showSuccess('Ссылка оплаты успешно обновлена');
            closeModal(document.querySelector('.modal'));
        } else {
            throw new Error('Ошибка при обновлении ссылки оплаты');
        }
    } catch (error) {
        console.error('Ошибка при сохранении ссылки оплаты:', error);
        showError('Не удалось сохранить ссылку оплаты');
    }
}

// --- Модальное окно для редактирования тренировки ---
function showEditTrainingModal(training) {
    console.log('Вызов showEditTrainingModal с данными:', training);
    // Удаляем старое модальное окно, если есть
    const oldModal = document.getElementById('edit-training-modal');
    if (oldModal) {
        console.log('Удаляем старое модальное окно');
        oldModal.remove();
    }

    // Загружаем данные для выпадающих списков
    console.log('Загружаем данные для выпадающих списков');
    Promise.all([
        fetch('/api/trainers').then(res => res.json()),
        fetch('/api/groups').then(res => res.json()),
        fetch('/api/simulators').then(res => res.json())
    ]).then(([trainers, groups, simulators]) => {
        console.log('Получены данные для списков:', { trainers, groups, simulators });
        // Формируем options для select
        const trainerOptions = trainers.map(tr =>
            `<option value="${tr.id}" ${tr.id === training.trainer_id ? 'selected' : ''}>${tr.full_name}</option>`
        ).join('');

        const groupOptions = groups.map(gr =>
            `<option value="${gr.id}" ${gr.id === training.group_id ? 'selected' : ''}>${gr.name}</option>`
        ).join('');

        const simulatorOptions = simulators.map(sim =>
            `<option value="${sim.id}" ${sim.id === training.simulator_id ? 'selected' : ''}>${sim.name}</option>`
        ).join('');

        // Формируем HTML модального окна
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'edit-training-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Редактировать тренировку</h3>
                <form id="edit-training-form">
                    <div class="form-group">
                        <label>Время начала</label>
                        <input type="time" name="start_time" value="${training.start_time.slice(0,5)}" required />
                    </div>
                    <div class="form-group">
                        <label>Время окончания</label>
                        <input type="time" name="end_time" value="${training.end_time.slice(0,5)}" required />
                    </div>
                    <div class="form-group">
                        <label>Группа</label>
                        <select name="group_id" required>
                            <option value="">Выберите группу</option>
                            ${groupOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Тренер</label>
                        <select name="trainer_id">
                            <option value="">Выберите тренера</option>
                            ${trainerOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Тренажёр</label>
                        <select name="simulator_id" required>
                            <option value="">Выберите тренажёр</option>
                            ${simulatorOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Участников</label>
                        <input type="number" name="max_participants" value="${training.max_participants}" min="1" required />
                    </div>
                    <div class="form-group">
                        <label>Уровень</label>
                        <select name="skill_level" required>
                            ${Array.from({length: 10}, (_, i) => i + 1).map(level => 
                                `<option value="${level}" ${training.skill_level === level ? 'selected' : ''}>${level}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Цена (₽)</label>
                        <input type="number" name="price" value="${training.price}" min="0" required />
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" id="close-edit-modal">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        // Закрытие по кнопке
        document.getElementById('close-edit-modal').onclick = () => modal.remove();
        // Закрытие по клику вне окна
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        // Обработка сохранения
        document.getElementById('edit-training-form').onsubmit = async function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());
            
            // Преобразуем числовые поля
            data.simulator_id = Number(data.simulator_id);
            data.max_participants = Number(data.max_participants);
            data.skill_level = Number(data.skill_level);
            data.price = Number(data.price);
            data.trainer_id = data.trainer_id ? Number(data.trainer_id) : null;
            data.group_id = Number(data.group_id);

            // Отправляем PUT-запрос
            try {
                const response = await fetch(`/api/trainings/${training.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Ошибка при сохранении');
                }
                showSuccess('Тренировка обновлена');
                modal.remove();
                loadTrainings();
            } catch (error) {
                showError(error.message);
            }
        };
    }).catch(error => {
        console.error('Ошибка при загрузке данных:', error);
        showError('Не удалось загрузить данные для редактирования');
    });
}

// --- Обработчик кнопки "Редактировать тренировку" ---
window.editTraining = function(id) {
    console.log('Вызов editTraining с id:', id);
    // Найти тренировку в текущем списке (или запросим с сервера)
    const allTrainings = document.querySelectorAll('.training-item');
    let trainingData = null;
    // Можно хранить данные в JS, но для простоты — запросим с сервера
    fetch(`/api/trainings/${id}`)
        .then(res => {
            console.log('Ответ сервера:', res);
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(training => {
            console.log('Полученные данные тренировки:', training);
            showEditTrainingModal(training);
        })
        .catch(error => {
            console.error('Ошибка при загрузке данных тренировки:', error);
            showError('Не удалось загрузить данные тренировки');
        });
};

// Функция удаления тренировки
async function deleteTraining(trainingId) {
    if (!confirm('Вы уверены, что хотите удалить эту тренировку?')) {
        return;
    }

    try {
        const response = await fetch(`/api/trainings/${trainingId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при удалении тренировки');
        }

        showSuccess('Тренировка успешно удалена');
        loadTrainings(); // Перезагружаем список тренировок
    } catch (error) {
        console.error('Ошибка при удалении тренировки:', error);
        showError(error.message || 'Не удалось удалить тренировку');
    }
}

// Функция для просмотра клиента
async function viewClient(id) {
    console.log('Просмотр клиента:', id); // Добавляем логирование
    try {
        const response = await fetch(`/api/clients/${id}`);
        const client = await response.json();
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Информация о клиенте</h2>
                <div class="client-details">
                    <div class="detail-group">
                        <h3>Основная информация</h3>
                        <p><strong>ФИО:</strong> ${client.full_name || '-'}</p>
                        <p><strong>Дата рождения:</strong> ${client.birth_date ? new Date(client.birth_date).toLocaleDateString('ru-RU') : '-'}</p>
                        <p><strong>Возраст:</strong> ${client.birth_date ? Math.floor((new Date() - new Date(client.birth_date)) / (365.25 * 24 * 60 * 60 * 1000)) : '-'}</p>
                        <p><strong>Телефон:</strong> ${client.phone || '-'}</p>
                        <p><strong>Уровень:</strong> ${client.skill_level || '-'}</p>
                    </div>
                    ${client.child_name ? `
                        <div class="detail-group">
                            <h3>Информация о ребёнке</h3>
                            <p><strong>ФИО:</strong> ${client.child_name}</p>
                            <p><strong>Дата рождения:</strong> ${client.child_birth_date ? new Date(client.child_birth_date).toLocaleDateString('ru-RU') : '-'}</p>
                            <p><strong>Возраст:</strong> ${client.child_birth_date ? Math.floor((new Date() - new Date(client.child_birth_date)) / (365.25 * 24 * 60 * 60 * 1000)) : '-'}</p>
                            <p><strong>Уровень:</strong> ${client.child_skill_level || '-'}</p>
                        </div>
                    ` : ''}
                    <div class="detail-group">
                        <h3>Финансовая информация</h3>
                        <p><strong>Баланс:</strong> ${client.balance ? `${client.balance} ₽` : '0 ₽'}</p>
                    </div>
                </div>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
    } catch (error) {
        console.error('Ошибка при загрузке данных клиента:', error);
        showError('Не удалось загрузить данные клиента');
    }
}

// Функция для редактирования клиента
async function editClient(id) {
    console.log('Редактирование клиента:', id);
    try {
        const response = await fetch(`/api/clients/${id}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const client = await response.json();
        console.log('Получены данные клиента:', client);
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Редактирование клиента</h2>
                <form id="editClientForm">
                    <div class="form-group">
                        <label for="full_name">ФИО:</label>
                        <input type="text" id="full_name" name="full_name" value="${client.full_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label for="birth_date">Дата рождения:</label>
                        <input type="date" id="birth_date" name="birth_date" value="${formatDateForInput(client.birth_date)}" required>
                    </div>
                    <div class="form-group">
                        <label for="phone">Телефон:</label>
                        <input type="tel" id="phone" name="phone" value="${client.phone || ''}" required>
                    </div>
                    <div class="form-group">
                        <label for="skill_level">Уровень:</label>
                        <select id="skill_level" name="skill_level" required>
                            ${Array.from({length: 10}, (_, i) => `<option value="${i+1}"${client.skill_level == i+1 ? ' selected' : ''}>${i+1}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="balance">Баланс (₽):</label>
                        <input type="number" id="balance" name="balance" value="${client.balance || 0}" min="0" step="100">
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Сохранить</button>
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';

        // Обработка сохранения
        document.getElementById('editClientForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // Преобразуем числовые поля
            data.balance = parseFloat(data.balance) || 0;
            
            try {
                console.log('Отправка данных на сервер:', data);
                const response = await fetch(`/api/clients/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Ошибка при обновлении клиента');
                }
                
                const updatedClient = await response.json();
                console.log('Клиент успешно обновлен:', updatedClient);
                
                modal.remove();
                loadClients();
                showSuccess('Клиент успешно обновлен');
            } catch (error) {
                console.error('Ошибка при обновлении клиента:', error);
                showError(error.message || 'Не удалось обновить данные клиента');
            }
        });
    } catch (error) {
        console.error('Ошибка при загрузке данных клиента:', error);
        showError('Не удалось загрузить данные клиента');
    }
}

// Функция для экспорта контактов
async function exportContacts() {
    try {
        // Получаем всех клиентов
        const clientsResp = await fetch('/api/clients');
        const clients = await clientsResp.json();
        // Получаем всех детей
        const childrenResp = await fetch('/api/children');
        const children = await childrenResp.json();
        // Создаём карту родителей для быстрого поиска
        const parentMap = {};
        clients.forEach(c => { parentMap[c.id] = c; });
        // --- Первый лист: Клиенты ---
        const clientSheetData = [
            ['ФИО', 'Возраст', 'Дата рождения', 'Телефон', 'Уровень катания', 'telegram_id']
        ];
        const today = new Date();
        // Оставляем только первую строку для каждого уникального client.id
        const uniqueClients = [];
        const seenIds = new Set();
        clients.forEach(client => {
            if (!seenIds.has(client.id) && !client.parent_id) {
                uniqueClients.push(client);
                seenIds.add(client.id);
            }
        });
        uniqueClients.forEach(client => {
            const birth = new Date(client.birth_date);
            const age = today.getFullYear() - birth.getFullYear() - (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
            clientSheetData.push([
                client.full_name,
                age,
                formatDateDMY(client.birth_date),
                client.phone,
                client.skill_level || '',
                client.telegram_id || ''
            ]);
        });
        // --- Второй лист: Дети ---
        const childSheetData = [
            ['ФИО ребёнка', 'Возраст', 'Дата рождения', 'Уровень катания', 'Родитель', 'Телефон родителя']
        ];
        children.forEach(child => {
            const birth = new Date(child.birth_date);
            const age = today.getFullYear() - birth.getFullYear() - (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
            const parent = parentMap[child.parent_id] || {};
            childSheetData.push([
                child.full_name,
                age,
                formatDateDMY(child.birth_date),
                child.skill_level || '',
                parent.full_name || '',
                parent.phone || ''
            ]);
        });
        // --- Формируем Excel-файл ---
        const wb = XLSX.utils.book_new();
        const wsClients = XLSX.utils.aoa_to_sheet(clientSheetData);
        const wsChildren = XLSX.utils.aoa_to_sheet(childSheetData);
        XLSX.utils.book_append_sheet(wb, wsClients, 'Клиенты');
        XLSX.utils.book_append_sheet(wb, wsChildren, 'Дети');
        const date = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `contacts_${date}.xlsx`);
        showSuccess('Контакты успешно экспортированы');
    } catch (error) {
        console.error('Ошибка при экспорте контактов:', error);
        showError('Не удалось экспортировать контакты');
    }
}

// В конец файла добавляю функцию editChild
window.editChild = async function(childId) {
    try {
        const response = await fetch(`/api/children/${childId}`);
        if (!response.ok) throw new Error('Ошибка загрузки данных ребенка');
        const child = await response.json();
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Редактирование ребенка</h2>
                <form id="editChildForm">
                    <div class="form-group">
                        <label for="child_full_name">ФИО:</label>
                        <input type="text" id="child_full_name" name="full_name" value="${child.full_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label for="child_birth_date">Дата рождения:</label>
                        <input type="date" id="child_birth_date" name="birth_date" value="${formatDateForInput(child.birth_date)}" required>
                    </div>
                    <div class="form-group">
                        <label for="child_skill_level">Уровень:</label>
                        <select id="child_skill_level" name="skill_level" required>
                            ${Array.from({length: 10}, (_, i) => `<option value="${i+1}"${child.skill_level == i+1 ? ' selected' : ''}>${i+1}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Сохранить</button>
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';
        document.getElementById('editChildForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            try {
                const resp = await fetch(`/api/children/${childId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!resp.ok) throw new Error('Ошибка при сохранении');
                modal.remove();
                loadClients();
                showSuccess('Данные ребенка успешно обновлены');
            } catch (err) {
                showError('Не удалось обновить данные ребенка');
            }
        });
    } catch (err) {
        showError('Не удалось загрузить данные ребенка');
    }
} 

function getTransactionTypeRu(type) {
    switch (type) {
        case 'payment': return 'Оплата';
        case 'refill': return 'Пополнение';
        case 'amount': return 'Возврат';
        default: return type;
    }
} 

// Функция для увольнения тренера
async function dismissTrainer(trainerId) {
    if (!confirm('Вы уверены, что хотите уволить этого тренера?')) {
        return;
    }

    try {
        console.log('Отправка запроса на увольнение тренера:', trainerId);
        const response = await fetch(`/api/trainers/${trainerId}/dismiss`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при увольнении тренера');
        }

        showSuccess('Тренер успешно уволен');
        await loadTrainers(); // Перезагружаем список тренеров
    } catch (error) {
        console.error('Ошибка при увольнении тренера:', error);
        showError(error.message || 'Не удалось уволить тренера');
    }
}

// Функция для восстановления тренера
async function rehireTrainer(trainerId) {
    if (!confirm('Вы уверены, что хотите восстановить этого тренера?')) {
        return;
    }

    try {
        console.log('Отправка запроса на восстановление тренера:', trainerId);
        const response = await fetch(`/api/trainers/${trainerId}/rehire`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при восстановлении тренера');
        }

        showSuccess('Тренер успешно восстановлен');
        await loadTrainers(); // Перезагружаем список тренеров
    } catch (error) {
        console.error('Ошибка при восстановлении тренера:', error);
        showError(error.message || 'Не удалось восстановить тренера');
    }
}

// Функция для просмотра информации о тренере
async function viewTrainer(trainerId) {
    try {
        const response = await fetch(`/api/trainers/${trainerId}`);
        if (!response.ok) throw new Error('Ошибка загрузки данных тренера');
        const trainer = await response.json();
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд'
        };
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Информация о тренере</h3>
                <div class="trainer-photo-view" style="text-align: center; margin-bottom: 20px;">
                    ${trainer.photo_url ? 
                        `<img src="${trainer.photo_url}" alt="${trainer.full_name}" style="max-width: 200px; height: auto; max-height: 300px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">` :
                        `<div class="no-photo" style="width: 200px; height: 150px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; margin: 0 auto;">Нет фото</div>`
                    }
                </div>
                <div class="trainer-details">
                    <p><strong>ФИО:</strong> ${trainer.full_name}</p>
                    <p><strong>Дата рождения:</strong> ${trainer.birth_date ? new Date(trainer.birth_date).toLocaleDateString('ru-RU') : '-'}</p>
                    <p><strong>Вид спорта:</strong> ${sportTypeMapping[trainer.sport_type] || trainer.sport_type}</p>
                    <p><strong>Телефон:</strong> ${trainer.phone}</p>
                    <p><strong>Email:</strong> ${trainer.email || '-'}</p>
                    <p><strong>Описание:</strong> ${trainer.description || '-'}</p>
                    <p><strong>Дата приема:</strong> ${trainer.hire_date ? new Date(trainer.hire_date).toLocaleDateString('ru-RU') : '-'}</p>
                    <p><strong>Статус:</strong> ${trainer.is_active ? 'Работает' : 'Уволен'}</p>
                </div>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    } catch (error) {
        showError('Не удалось загрузить данные тренера');
    }
}

// Диагностика наличия контейнера и кнопки
setTimeout(() => {
    const trainersList = document.querySelector('.trainers-list');
    console.log('[diagnostic] .trainers-list найден:', !!trainersList, trainersList);
    const dismissedBtn = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Уволенные тренеры'));
    console.log('[diagnostic] Кнопка "Уволенные тренеры" найдена:', !!dismissedBtn, dismissedBtn);
}, 1000);

// Глобальный обработчик для всех кнопок "Уволенные тренеры"
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'BUTTON' && e.target.textContent.includes('Уволенные тренеры')) {
        console.log('[global handler] Кнопка "Уволенные тренеры" нажата через глобальный обработчик');
        // Попробуем найти dismissedTrainers в глобальной области (или пересобрать)
        if (window.lastDismissedTrainers) {
            showDismissedTrainersModal(window.lastDismissedTrainers);
        } else {
            // Попробуем получить через API
            fetch('/api/trainers').then(r => r.json()).then(trainers => {
                const dismissed = trainers.filter(tr => !tr.is_active);
                window.lastDismissedTrainers = dismissed;
                showDismissedTrainersModal(dismissed);
            });
        }
    }
});

// Обработчик для верхней кнопки "Уволенные тренеры"
document.addEventListener('DOMContentLoaded', function() {
    const topDismissedBtn = document.getElementById('view-dismissed');
    if (topDismissedBtn) {
        topDismissedBtn.addEventListener('click', function() {
            console.log('[top button] Кнопка "Уволенные тренеры" (верхняя) нажата');
            // Получаем актуальный список уволенных тренеров
            fetch('/api/trainers').then(r => r.json()).then(trainers => {
                const dismissed = trainers.filter(tr => !tr.is_active);
                showDismissedTrainersModal(dismissed);
            });
        });
    }
});

function formatDateWithWeekday(dateString) {
    const date = new Date(dateString);
    const weekdays = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
    const weekday = weekdays[date.getDay()];
    return `${date.toLocaleDateString('ru-RU')} (${weekday})`;
}

// Функция для корректного форматирования даты для input type="date"
function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Для отображения даты рядом с тортиком:
function formatBirthdayShort(birthDate) {
    if (!birthDate) return '';
    const date = new Date(birthDate);
    return `${date.getDate()} ${date.toLocaleString('ru', { month: 'long' })}`;
}

// Функция для вычисления дней до ближайшего дня рождения
function daysToNextBirthday(birthDate) {
    if (!birthDate) return Infinity;
    const today = new Date();
    const date = new Date(birthDate);
    date.setFullYear(today.getFullYear());
    let diff = Math.floor((date - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) {
        date.setFullYear(today.getFullYear() + 1);
        diff = Math.floor((date - today) / (1000 * 60 * 60 * 24));
    }
    return diff;
}

async function handleNotifyFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const message = form.querySelector('#notify-message').value.trim();
    const recipientType = form.querySelector('#recipient-type').value;
    const clientSelect = form.querySelector('#client-select');
    const groupSelect = form.querySelector('#group-select');

    if (!message) {
        showError('Введите текст сообщения');
        return;
    }

    let endpoint;
    let data = { message };

    switch (recipientType) {
        case 'all':
            endpoint = '/api/trainings/notify-clients';
            break;
        case 'client':
            if (!clientSelect || !clientSelect.value) {
                showError('Выберите клиента');
                return;
            }
            endpoint = `/api/trainings/notify-client/${clientSelect.value}`;
            break;
        case 'group':
            if (!groupSelect || !groupSelect.value) {
                showError('Выберите групповую тренировку');
                return;
            }
            endpoint = `/api/trainings/notify-group/${groupSelect.value}`;
            break;
        default:
            showError('Неверный тип получателей');
            return;
    }

    try {
        showLoading('Отправка сообщения...');
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при отправке сообщения');
        }

        showSuccess(result.message);
        document.getElementById('notify-clients-modal').style.display = 'none';
        form.reset();
        if (form.querySelector('#notify-preview')) {
            form.querySelector('#notify-preview').textContent = '';
        }
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// === ДОБАВЛЯЮ ФУНКЦИЮ ДЛЯ ПОЛУЧЕНИЯ ТОКЕНА И ОБЕРТКУ ДЛЯ fetch ===
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
    // Проверяем, нужно ли добавлять токен (только для /api/)
    if (typeof url === 'string' && url.startsWith('/api/')) {
        const token = getCookie('adminToken');
        if (token) {
            options.headers = options.headers || {};
            // Если headers это Headers, преобразуем в объект
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

function formatDateDMY(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU');
}

// Добавляю CSS для подсветки
const style = document.createElement('style');
style.innerHTML = `.price-missing { border: 2px solid #e53935 !important; background: #fff3f3 !important; }`;
document.head.appendChild(style);

// === ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАЯВКАМИ ===

// Загрузка заявок с сервера
async function loadApplications() {
    try {
        showLoading('Загрузка заявок...');
        
        const response = await fetch('/api/applications');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allApplications = await response.json();
        console.log('Загружены заявки:', allApplications);
        
        displayApplications();
        hideLoading();
    } catch (error) {
        console.error('Ошибка при загрузке заявок:', error);
        showError('Не удалось загрузить заявки');
        hideLoading();
    }
}

// Отображение заявок с учетом фильтров
function displayApplications() {
    const applicationsList = document.querySelector('.applications-list');
    if (!applicationsList) return;

    // Фильтруем заявки
    let filteredApplications = allApplications.filter(application => {
        // Фильтр по статусу
        if (currentApplicationsFilter !== 'all' && application.status !== currentApplicationsFilter) {
            return false;
        }
        
        // Фильтр по дате
        if (currentApplicationsDate) {
            const applicationDate = new Date(application.created_at).toISOString().split('T')[0];
            if (applicationDate !== currentApplicationsDate) {
                return false;
            }
        }
        
        // Фильтр по поиску
        if (currentApplicationsSearch) {
            const searchTerm = currentApplicationsSearch;
            const clientName = application.client_name ? application.client_name.toLowerCase() : '';
            const description = application.description ? application.description.toLowerCase() : '';
            
            if (!clientName.includes(searchTerm) && !description.includes(searchTerm)) {
                return false;
            }
        }
        
        return true;
    });

    // Сортируем по дате создания (новые первые)
    filteredApplications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (filteredApplications.length === 0) {
        applicationsList.innerHTML = '<div class="alert alert-info">Заявки не найдены</div>';
        return;
    }

    // Формируем HTML таблицы
    const tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>№</th>
                    <th>Дата</th>
                    <th>Клиент</th>
                    <th>Тип заявки</th>
                    <th>Описание</th>
                    <th>Статус</th>
                    <th>Приоритет</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${filteredApplications.map((application, index) => `
                    <tr class="application-row application-status-${application.status}">
                        <td>${index + 1}</td>
                        <td>${formatDate(application.created_at)}</td>
                        <td>${application.client_name || 'Не указан'}</td>
                        <td>${getApplicationTypeRu(application.type)}</td>
                        <td>${application.description || '-'}</td>
                        <td>
                            <span class="status-badge status-${application.status}">
                                ${getStatusRu(application.status)}
                            </span>
                        </td>
                        <td>
                            <span class="priority-badge priority-${application.priority}">
                                ${getPriorityRu(application.priority)}
                            </span>
                        </td>
                        <td class="application-actions">
                            <button class="btn-secondary" onclick="viewApplication(${application.id})">
                                Просмотр
                            </button>
                            <button class="btn-secondary" onclick="editApplication(${application.id})">
                                Редактировать
                            </button>
                            <button class="btn-danger" onclick="deleteApplication(${application.id})">
                                Удалить
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    applicationsList.innerHTML = tableHtml;
}

// Модальное окно создания заявки
function showCreateApplicationModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Создать новую заявку</h3>
            <form id="create-application-form">
                <div class="form-group">
                    <label for="client-select">Клиент:</label>
                    <select id="client-select" name="client_id" required>
                        <option value="">Выберите клиента</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="application-type">Тип заявки:</label>
                    <select id="application-type" name="type" required>
                        <option value="">Выберите тип</option>
                        <option value="training">Запрос на тренировку</option>
                        <option value="equipment">Запрос на оборудование</option>
                        <option value="schedule">Запрос на изменение расписания</option>
                        <option value="payment">Вопрос по оплате</option>
                        <option value="other">Другое</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="application-priority">Приоритет:</label>
                    <select id="application-priority" name="priority" required>
                        <option value="low">Низкий</option>
                        <option value="medium" selected>Средний</option>
                        <option value="high">Высокий</option>
                        <option value="urgent">Срочный</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="application-description">Описание:</label>
                    <textarea id="application-description" name="description" rows="4" required 
                              placeholder="Опишите детали заявки..."></textarea>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">Создать заявку</button>
                    <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Загружаем список клиентов
    loadClientsForApplicationSelect();

    // Обработка отправки формы
    document.getElementById('create-application-form').addEventListener('submit', handleCreateApplication);

    // Закрытие по клику вне окна
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
}

// Загрузка клиентов для выпадающего списка
async function loadClientsForApplicationSelect() {
    try {
        const response = await fetch('/api/clients');
        const clients = await response.json();
        
        const clientSelect = document.getElementById('client-select');
        if (clientSelect) {
            // Фильтруем только уникальных клиентов без parent_id
            const filteredClients = [];
            const seenIds = new Set();
            for (const client of clients) {
                if (!client.parent_id && !seenIds.has(client.id)) {
                    filteredClients.push(client);
                    seenIds.add(client.id);
                }
            }
            
            clientSelect.innerHTML = '<option value="">Выберите клиента</option>' +
                filteredClients.map(client =>
                    `<option value="${client.id}">${client.full_name} (${client.phone})</option>`
                ).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке списка клиентов:', error);
        showError('Не удалось загрузить список клиентов');
    }
}

// Обработка создания заявки
async function handleCreateApplication(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    
    try {
        showLoading('Создание заявки...');
        
        const response = await fetch('/api/applications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при создании заявки');
        }
        
        showSuccess('Заявка успешно создана');
        event.target.closest('.modal').remove();
        loadApplications();
        hideLoading();
    } catch (error) {
        console.error('Ошибка при создании заявки:', error);
        showError(error.message || 'Не удалось создать заявку');
        hideLoading();
    }
}

// Просмотр заявки
async function viewApplication(applicationId) {
    try {
        const response = await fetch(`/api/applications/${applicationId}`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки данных заявки');
        }
        
        const application = await response.json();
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Детали заявки #${application.id}</h3>
                <div class="application-details">
                    <div class="detail-group">
                        <h4>Основная информация</h4>
                        <p><strong>Дата создания:</strong> ${formatDate(application.created_at)}</p>
                        <p><strong>Клиент:</strong> ${application.client_name || 'Не указан'}</p>
                        <p><strong>Тип заявки:</strong> ${getApplicationTypeRu(application.type)}</p>
                        <p><strong>Приоритет:</strong> ${getPriorityRu(application.priority)}</p>
                        <p><strong>Статус:</strong> ${getStatusRu(application.status)}</p>
                    </div>
                    <div class="detail-group">
                        <h4>Описание</h4>
                        <p>${application.description || 'Описание отсутствует'}</p>
                    </div>
                    ${application.comments ? `
                        <div class="detail-group">
                            <h4>Комментарии</h4>
                            <p>${application.comments}</p>
                        </div>
                    ` : ''}
                </div>
                <div class="form-actions">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    } catch (error) {
        console.error('Ошибка при загрузке заявки:', error);
        showError('Не удалось загрузить данные заявки');
    }
}

// Редактирование заявки
async function editApplication(applicationId) {
    try {
        const response = await fetch(`/api/applications/${applicationId}`);
        if (!response.ok) {
            throw new Error('Ошибка загрузки данных заявки');
        }
        
        const application = await response.json();
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Редактирование заявки #${application.id}</h3>
                <form id="edit-application-form">
                    <div class="form-group">
                        <label for="edit-status">Статус:</label>
                        <select id="edit-status" name="status" required>
                            <option value="new" ${application.status === 'new' ? 'selected' : ''}>Новая</option>
                            <option value="processing" ${application.status === 'processing' ? 'selected' : ''}>В обработке</option>
                            <option value="approved" ${application.status === 'approved' ? 'selected' : ''}>Одобренная</option>
                            <option value="rejected" ${application.status === 'rejected' ? 'selected' : ''}>Отклоненная</option>
                            <option value="completed" ${application.status === 'completed' ? 'selected' : ''}>Завершенная</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-priority">Приоритет:</label>
                        <select id="edit-priority" name="priority" required>
                            <option value="low" ${application.priority === 'low' ? 'selected' : ''}>Низкий</option>
                            <option value="medium" ${application.priority === 'medium' ? 'selected' : ''}>Средний</option>
                            <option value="high" ${application.priority === 'high' ? 'selected' : ''}>Высокий</option>
                            <option value="urgent" ${application.priority === 'urgent' ? 'selected' : ''}>Срочный</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="edit-description">Описание:</label>
                        <textarea id="edit-description" name="description" rows="4" required>${application.description || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label for="edit-comments">Комментарии:</label>
                        <textarea id="edit-comments" name="comments" rows="3">${application.comments || ''}</textarea>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Обработка сохранения
        document.getElementById('edit-application-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const response = await fetch(`/api/applications/${applicationId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.message || 'Ошибка при обновлении заявки');
                }
                
                showSuccess('Заявка успешно обновлена');
                modal.remove();
                loadApplications();
            } catch (error) {
                console.error('Ошибка при обновлении заявки:', error);
                showError(error.message || 'Не удалось обновить заявку');
            }
        });
        
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    } catch (error) {
        console.error('Ошибка при загрузке заявки:', error);
        showError('Не удалось загрузить данные заявки');
    }
}

// Удаление заявки
async function deleteApplication(applicationId) {
    if (!confirm('Вы уверены, что хотите удалить эту заявку?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/applications/${applicationId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при удалении заявки');
        }
        
        showSuccess('Заявка успешно удалена');
        loadApplications();
    } catch (error) {
        console.error('Ошибка при удалении заявки:', error);
        showError(error.message || 'Не удалось удалить заявку');
    }
}

// Экспорт заявок
async function exportApplications() {
    try {
        showLoading('Подготовка файла...');
        
        const response = await fetch('/api/applications/export');
        if (!response.ok) {
            throw new Error('Ошибка при экспорте');
        }
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `applications_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        
        showSuccess('Заявки успешно экспортированы');
        hideLoading();
    } catch (error) {
        console.error('Ошибка при экспорте заявок:', error);
        showError('Не удалось экспортировать заявки');
        hideLoading();
    }
}

// Вспомогательные функции для заявок
function getApplicationTypeRu(type) {
    const types = {
        'training': 'Запрос на тренировку',
        'equipment': 'Запрос на оборудование',
        'schedule': 'Запрос на изменение расписания',
        'payment': 'Вопрос по оплате',
        'other': 'Другое'
    };
    return types[type] || type;
}

function getStatusRu(status) {
    const statuses = {
        'new': 'Новая',
        'processing': 'В обработке',
        'approved': 'Одобренная',
        'rejected': 'Отклоненная',
        'completed': 'Завершенная'
    };
    return statuses[status] || status;
}

function getPriorityRu(priority) {
    const priorities = {
        'low': 'Низкий',
        'medium': 'Средний',
        'high': 'Высокий',
        'urgent': 'Срочный'
    };
    return priorities[priority] || priority;
}

// Функция предпросмотра фото тренера
function previewTrainerPhoto(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const currentPhoto = document.getElementById('current-trainer-photo');
            const noPhotoDiv = document.querySelector('.current-photo .no-photo');
            
            if (currentPhoto) {
                currentPhoto.src = e.target.result;
            } else if (noPhotoDiv) {
                // Заменяем div "Нет фото" на изображение
                noPhotoDiv.outerHTML = `<img id="current-trainer-photo" src="${e.target.result}" alt="Предпросмотр" style="max-width: 150px; height: auto; max-height: 200px; border-radius: 8px; margin-bottom: 10px;">`;
            }
        };
        reader.readAsDataURL(file);
    }
}

// === ФУНКЦИОНАЛ ПОПОЛНЕНИЯ КОШЕЛЬКА ===

// Инициализация функционала пополнения кошелька
function initializeWalletRefill() {
    const clientSearchInput = document.getElementById('client-search');
    const clientSearchResults = document.getElementById('client-search-results');
    const selectedClientIdInput = document.getElementById('selected-client-id');
    const walletRefillForm = document.getElementById('wallet-refill-form');

    if (!clientSearchInput || !clientSearchResults || !selectedClientIdInput || !walletRefillForm) {
        return; // Элементы не найдены, возможно мы не на странице финансов
    }

    let searchTimeout;
    let allClients = [];

    // Загружаем список всех клиентов при инициализации
    loadAllClientsForWallet();

    // Обработчик ввода в поле поиска
    clientSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Очищаем скрытое поле выбранного клиента при изменении поиска
        selectedClientIdInput.value = '';
        
        if (query.length < 2) {
            hideSearchResults();
            return;
        }

        // Дебаунс для поиска
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchClients(query);
        }, 300);
    });

    // Скрываем результаты при клике вне области поиска
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.client-search-container')) {
            hideSearchResults();
        }
    });

    // Обработчик отправки формы
    walletRefillForm.addEventListener('submit', handleWalletRefillSubmit);

    // Функция загрузки всех клиентов
    async function loadAllClientsForWallet() {
        try {
            const response = await fetch('/api/clients');
            if (!response.ok) throw new Error('Ошибка загрузки клиентов');
            
            const clients = await response.json();
            
            // Фильтруем только уникальных клиентов без parent_id
            allClients = [];
            const seenIds = new Set();
            for (const client of clients) {
                if (!client.parent_id && !seenIds.has(client.id)) {
                    allClients.push(client);
                    seenIds.add(client.id);
                }
            }
        } catch (error) {
            console.error('Ошибка при загрузке клиентов:', error);
            showError('Не удалось загрузить список клиентов');
        }
    }

    // Функция поиска клиентов
    function searchClients(query) {
        const queryLower = query.toLowerCase();
        
        const filteredClients = allClients.filter(client => {
            const fullNameMatch = client.full_name.toLowerCase().includes(queryLower);
            const phoneMatch = client.phone.toLowerCase().includes(queryLower);
            return fullNameMatch || phoneMatch;
        });

        displaySearchResults(filteredClients);
    }

    // Функция отображения результатов поиска
    function displaySearchResults(clients) {
        if (clients.length === 0) {
            clientSearchResults.innerHTML = '<div class="search-result-item">Клиенты не найдены</div>';
            clientSearchResults.style.display = 'block';
            return;
        }

        const resultsHtml = clients.map(client => `
            <div class="search-result-item" data-client-id="${client.id}" onclick="selectClient(${client.id}, '${client.full_name.replace(/'/g, "\\'")}')">
                <div class="search-result-name">${client.full_name}</div>
                <div class="search-result-details">Телефон: ${client.phone}</div>
            </div>
        `).join('');

        clientSearchResults.innerHTML = resultsHtml;
        clientSearchResults.style.display = 'block';
    }

    // Функция скрытия результатов поиска
    function hideSearchResults() {
        clientSearchResults.style.display = 'none';
    }

    // Глобальная функция выбора клиента
    window.selectClient = function(clientId, clientName) {
        clientSearchInput.value = clientName;
        selectedClientIdInput.value = clientId;
        hideSearchResults();
    };

    // Обработчик отправки формы пополнения
    async function handleWalletRefillSubmit(e) {
        e.preventDefault();
        
        // Защита от повторных отправок
        const submitButton = e.target.querySelector('button[type="submit"]');
        if (submitButton.disabled) {
            return; // Уже обрабатывается
        }
        
        const clientId = selectedClientIdInput.value;
        const amount = document.getElementById('refill-amount').value;
        const comment = document.getElementById('refill-comment').value.trim();

        if (!clientId) {
            showError('Выберите клиента из списка');
            return;
        }

        if (!amount || parseFloat(amount) <= 0 || parseFloat(amount) > 100000) {
            showError('Введите корректную сумму пополнения (от 1 до 100000 рублей)');
            return;
        }

        try {
            // Блокируем кнопку и показываем состояние загрузки
            submitButton.disabled = true;
            const originalText = submitButton.textContent;
            submitButton.textContent = 'Обработка...';
            showLoading('Пополнение кошелька...');
            
            const response = await fetch('/api/finances/refill-wallet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    client_id: parseInt(clientId),
                    amount: parseFloat(amount),
                    comment: comment || ''
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Ошибка при пополнении кошелька');
            }

            const result = await response.json();
            
            showSuccess(`Кошелек успешно пополнен! Новый баланс: ${result.new_balance} ₽`);
            
            // Очищаем форму
            walletRefillForm.reset();
            selectedClientIdInput.value = '';
            document.getElementById('refill-comment').value = '';
            hideSearchResults();
            
            // Перезагружаем финансовые данные
            await loadFinances();
            
        } catch (error) {
            console.error('Ошибка при пополнении кошелька:', error);
            showError(error.message || 'Не удалось пополнить кошелек');
        } finally {
            // Разблокируем кнопку и восстанавливаем текст
            submitButton.disabled = false;
            submitButton.textContent = 'Пополнить';
            hideLoading();
        }
    }
}

// Добавляем инициализацию пополнения кошелька в основную функцию инициализации
document.addEventListener('DOMContentLoaded', () => {
    // ... existing initialization code ...
    
    // Инициализируем функционал пополнения кошелька
    initializeWalletRefill();
});

// Также инициализируем при переключении на страницу финансов
const originalLoadPageContent = loadPageContent;
loadPageContent = async function(page) {
    await originalLoadPageContent(page);
    
    if (page === 'finances') {
        // Переинициализируем пополнение кошелька после загрузки страницы
        setTimeout(initializeWalletRefill, 100);
    }
};