// Глобальные переменные
let currentPage = 'schedule';
let currentDate = new Date();
let datePicker;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    initializeDatePicker();
    loadPageContent(currentPage);
    initializeEventListeners();
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
                            <button class="btn-secondary" onclick="closeModal(this.parentElement.parentElement.parentElement)">Отмена</button>
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
}

// Загрузка тренировок
async function loadTrainings() {
    try {
        // Определяем первый и последний день текущего месяца
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const dateFrom = firstDay.toISOString().split('T')[0];
        const dateTo = lastDay.toISOString().split('T')[0];

        // Запрашиваем тренировки за месяц с информацией о тренере
        const response = await fetch(`/api/trainings?date_from=${dateFrom}&date_to=${dateTo}`);
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
            trainingList.innerHTML = '<div class="alert alert-info">Нет доступных тренировок за этот месяц</div>';
            return;
        }

        // Группируем тренировки по дате
        const grouped = {};
        data.forEach(training => {
            const date = new Date(training.session_date).toLocaleDateString('ru-RU');
            if (!grouped[date]) grouped[date] = [];
            grouped[date].push(training);
        });
        const sortedDates = Object.keys(grouped).sort((a, b) => {
            const [da, ma, ya] = a.split('.');
            const [db, mb, yb] = b.split('.');
            return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
        });

        // Формируем HTML
        let html = '';
        sortedDates.forEach(date => {
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
                                    <td>${training.trainer_full_name || 'Не указан'}</td>
                                    <td>Тренажёр ${training.simulator_id}</td>
                                    <td>${training.max_participants}</td>
                                    <td>${training.skill_level}</td>
                                    <td>${training.price} ₽</td>
                                    <td class="training-actions">
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
        const date = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];
        const response = await fetch(`/api/schedule?date=${date}`);
        const schedule = await response.json();
        
        const scheduleList = document.querySelector('.schedule-list');
        if (scheduleList) {
            scheduleList.innerHTML = schedule.map(slot => `
                <div class="schedule-slot">
                    <div class="slot-time">${slot.start_time} - ${slot.end_time}</div>
                    <div class="slot-simulator">Тренажер ${slot.simulator_id}</div>
                    <div class="slot-status">${slot.is_available ? 'Свободен' : 'Занят'}</div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        showError('Не удалось загрузить расписание');
    }
}

// Загрузка тренажеров
async function loadSimulators() {
    try {
        const response = await fetch('/api/simulators');
        const simulators = await response.json();
        
        const simulatorsList = document.querySelector('.simulators-list');
        if (simulatorsList) {
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
                                       value="${simulator.working_hours_start}"
                                       onchange="updateSimulatorHours(${simulator.id})">
                            </div>
                            <div class="hours-group">
                                <label>Окончание работы:</label>
                                <input type="time" 
                                       id="simulator${simulator.id}-end" 
                                       value="${simulator.working_hours_end}"
                                       onchange="updateSimulatorHours(${simulator.id})">
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренажеров:', error);
        showError('Не удалось загрузить тренажеры');
    }
}

// Загрузка тренеров
async function loadTrainers() {
    try {
        const response = await fetch('/api/trainers');
        const trainers = await response.json();
        
        const trainersList = document.querySelector('.trainers-list');
        if (trainersList) {
            trainersList.innerHTML = trainers.map(trainer => `
                <div class="trainer-item">
                    <div class="trainer-info">
                        <h3>${trainer.full_name}</h3>
                        <p>Вид спорта: ${trainer.sport_type}</p>
                        <p>Телефон: ${trainer.phone}</p>
                        <p>Статус: ${trainer.is_active ? 'Работает' : 'Уволен'}</p>
                    </div>
                    <div class="trainer-actions">
                        <button class="btn-secondary" onclick="viewTrainer(${trainer.id})">Просмотр</button>
                        <button class="btn-secondary" onclick="editTrainer(${trainer.id})">Редактировать</button>
                        ${trainer.is_active ? 
                            `<button class="btn-danger" onclick="dismissTrainer(${trainer.id})">Уволить</button>` :
                            `<button class="btn-primary" onclick="rehireTrainer(${trainer.id})">Восстановить</button>`
                        }
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренеров:', error);
        showError('Не удалось загрузить тренеров');
    }
}

// Загрузка клиентов
async function loadClients(sortBy = 'created') {
    try {
        const response = await fetch(`/api/clients?sort=${sortBy}`);
        const clients = await response.json();
        
        const clientsList = document.querySelector('.clients-list');
        if (clientsList) {
            clientsList.innerHTML = clients.map(client => `
                <div class="client-item">
                    <div class="client-info">
                        <h3>${client.full_name}</h3>
                        <p>Телефон: ${client.phone}</p>
                        <p>Дата рождения: ${formatDate(client.birth_date)}</p>
                        ${client.has_child ? `
                            <p>Ребенок: ${client.child_name}</p>
                            <p>Возраст ребенка: ${client.child_birth_date}</p>
                        ` : ''}
                    </div>
                    <div class="client-actions">
                        <button class="btn-secondary" onclick="viewClient(${client.id})">Просмотр</button>
                        <button class="btn-secondary" onclick="editClient(${client.id})">Редактировать</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке клиентов:', error);
        showError('Не удалось загрузить клиентов');
    }
}

// Загрузка прайса
async function loadPrices() {
    try {
        const response = await fetch('/api/prices');
        const prices = await response.json();
        
        // Обновляем значения в полях ввода
        Object.entries(prices).forEach(([key, value]) => {
            const input = document.querySelector(`[data-price="${key}"]`);
            if (input) {
                input.value = value;
            }
        });
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

// Загрузка финансов
async function loadFinances() {
    try {
        const response = await fetch('/api/finances');
        const finances = await response.json();
        
        const financesList = document.querySelector('.finances-list');
        if (financesList) {
            financesList.innerHTML = finances.map(transaction => `
                <div class="finance-item">
                    <div class="finance-info">
                        <h3>Транзакция #${transaction.id}</h3>
                        <p>Сумма: ${transaction.amount} ₽</p>
                        <p>Тип: ${transaction.type}</p>
                        <p>Дата: ${formatDate(transaction.created_at)}</p>
                        <p>Описание: ${transaction.description}</p>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке финансов:', error);
        showError('Не удалось загрузить финансовые данные');
    }
}

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
        const training = await response.json();
        
        const trainingDetails = document.querySelector('.training-details');
        if (trainingDetails) {
            trainingDetails.innerHTML = `
                <div class="detail-item">
                    <strong>Дата:</strong> ${formatDate(training.date)}
                </div>
                <div class="detail-item">
                    <strong>Начало:</strong> ${training.start_time}
                </div>
                <div class="detail-item">
                    <strong>Окончание:</strong> ${training.end_time}
                </div>
                <div class="detail-item">
                    <strong>Группа:</strong> ${training.group_name}
                </div>
                <div class="detail-item">
                    <strong>Уровень:</strong> ${training.skill_level}
                </div>
                <div class="detail-item">
                    <strong>Максимальное количество участников:</strong> ${training.max_participants}
                </div>
                <div class="detail-item">
                    <strong>Участники:</strong>
                    <ul>
                        ${training.participants.map(participant => `
                            <li>${participant.full_name}</li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }
        showModal('view-training-modal');
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
        modal.style.display = 'none';
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
    // Удаляем старое модальное окно, если есть
    const oldModal = document.getElementById('edit-training-modal');
    if (oldModal) oldModal.remove();

    // Загружаем данные для выпадающих списков
    Promise.all([
        fetch('/api/trainers').then(res => res.json()),
        fetch('/api/groups').then(res => res.json()),
        fetch('/api/simulators').then(res => res.json())
    ]).then(([trainers, groups, simulators]) => {
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
                            <option value="1" ${training.skill_level === 1 ? 'selected' : ''}>Начальный</option>
                            <option value="2" ${training.skill_level === 2 ? 'selected' : ''}>Базовый</option>
                            <option value="3" ${training.skill_level === 3 ? 'selected' : ''}>Средний</option>
                            <option value="4" ${training.skill_level === 4 ? 'selected' : ''}>Продвинутый</option>
                            <option value="5" ${training.skill_level === 5 ? 'selected' : ''}>Профессиональный</option>
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
    // Найти тренировку в текущем списке (или запросить с сервера)
    const allTrainings = document.querySelectorAll('.training-item');
    let trainingData = null;
    // Можно хранить данные в JS, но для простоты — запросим с сервера
    fetch(`/api/trainings/${id}`)
        .then(res => res.json())
        .then(training => showEditTrainingModal(training))
        .catch(() => showError('Не удалось загрузить данные тренировки'));
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