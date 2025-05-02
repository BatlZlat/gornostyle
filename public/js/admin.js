// Глобальные переменные
let currentPage = 'schedule';
let currentDate = new Date();

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
        });
    });
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
        createPaymentLinkBtn.addEventListener('click', () => {
            window.location.href = 'payment-link.html';
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
        const response = await fetch('/api/trainings');
        const trainings = await response.json();
        
        const trainingList = document.querySelector('.training-list');
        if (trainingList) {
            trainingList.innerHTML = trainings.map(training => `
                <div class="training-item">
                    <div class="training-info">
                        <h3>${training.name}</h3>
                        <p>Дата: ${formatDate(training.date)}</p>
                        <p>Время: ${training.start_time} - ${training.end_time}</p>
                        <p>Тренер: ${training.trainer_name}</p>
                        <p>Участники: ${training.participants_count}/${training.max_participants}</p>
                    </div>
                    <div class="training-actions">
                        <button class="btn-secondary" onclick="viewTraining(${training.id})">Просмотр</button>
                        <button class="btn-secondary" onclick="editTraining(${training.id})">Редактировать</button>
                        <button class="btn-danger" onclick="deleteTraining(${training.id})">Удалить</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренировок:', error);
        showError('Не удалось загрузить тренировки');
    }
}

// Загрузка расписания
async function loadSchedule() {
    const date = datePicker.value;
    // Здесь будет код для загрузки расписания с сервера
    console.log('Loading schedule for date:', date);
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
                                <option value="available" ${simulator.status === 'available' ? 'selected' : ''}>В работе</option>
                                <option value="maintenance" ${simulator.status === 'maintenance' ? 'selected' : ''}>Не работает</option>
                                <option value="inactive" ${simulator.status === 'inactive' ? 'selected' : ''}>Неактивен</option>
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
async function updateSimulatorStatus(simulatorId, status) {
    try {
        const response = await fetch(`/api/simulators/${simulatorId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess(`Статус тренажера успешно обновлен`);
        } else {
            throw new Error(result.error || 'Ошибка при обновлении статуса');
        }
    } catch (error) {
        console.error('Ошибка при обновлении статуса тренажера:', error);
        showError(error.message || 'Не удалось обновить статус тренажера');
    }
}

// Обновление рабочего времени тренажера
async function updateSimulatorHours(simulatorId) {
    try {
        const startTime = document.getElementById(`simulator${simulatorId}-start`).value;
        const endTime = document.getElementById(`simulator${simulatorId}-end`).value;

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

        const result = await response.json();

        if (result.success) {
            showSuccess(`Рабочее время тренажера успешно обновлено`);
        } else {
            throw new Error(result.error || 'Ошибка при обновлении рабочего времени');
        }
    } catch (error) {
        console.error('Ошибка при обновлении рабочего времени тренажера:', error);
        showError(error.message || 'Не удалось обновить рабочее время тренажера');
    }
} 