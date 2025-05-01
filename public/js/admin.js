// Глобальные переменные
let currentPage = 'schedule';
let currentDate = new Date();

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    initializeDatePicker();
    loadPageContent(currentPage);
});

// Инициализация навигации
function initializeNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            switchPage(page);
        });
    });
}

// Инициализация выбора даты
function initializeDatePicker() {
    const datePicker = document.getElementById('schedule-date');
    const prevDateBtn = document.getElementById('prev-date');
    const nextDateBtn = document.getElementById('next-date');

    // Установка текущей даты
    datePicker.valueAsDate = currentDate;

    // Обработчики событий
    datePicker.addEventListener('change', (e) => {
        currentDate = new Date(e.target.value);
        loadSchedule();
    });

    prevDateBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 1);
        datePicker.valueAsDate = currentDate;
        loadSchedule();
    });

    nextDateBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 1);
        datePicker.valueAsDate = currentDate;
        loadSchedule();
    });
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
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Загрузить контент страницы
    loadPageContent(page);
}

// Загрузка контента страницы
function loadPageContent(page) {
    switch (page) {
        case 'training':
            loadTrainings();
            break;
        case 'schedule':
            loadSchedule();
            break;
        case 'simulators':
            loadSimulators();
            break;
        case 'trainers':
            loadTrainers();
            break;
        case 'clients':
            loadClients();
            break;
        case 'prices':
            loadPrices();
            break;
        case 'certificates':
            loadCertificates();
            break;
        case 'finances':
            loadFinances();
            break;
    }
}

// Загрузка тренировок
async function loadTrainings() {
    try {
        const response = await fetch('/api/trainings');
        const trainings = await response.json();
        
        const trainingList = document.querySelector('.training-list');
        trainingList.innerHTML = trainings.map(training => `
            <div class="training-item">
                <div class="training-info">
                    <h3>${training.group_name}</h3>
                    <p>Дата: ${formatDate(training.date)}</p>
                    <p>Время: ${training.start_time}</p>
                    <p>Участников: ${training.participants_count}/${training.max_participants}</p>
                </div>
                <div class="training-actions">
                    <button class="btn-secondary" onclick="viewTraining(${training.id})">Посмотреть</button>
                    <button class="btn-secondary" onclick="deleteTraining(${training.id})">Удалить</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Ошибка при загрузке тренировок:', error);
    }
}

// Загрузка расписания
async function loadSchedule() {
    try {
        const date = formatDate(currentDate);
        const response = await fetch(`/api/schedule?date=${date}`);
        const schedule = await response.json();
        
        const scheduleList = document.querySelector('.schedule-list');
        scheduleList.innerHTML = schedule.map(booking => `
            <div class="schedule-item">
                <div class="schedule-info">
                    <p>${booking.client_name}</p>
                    <p>${booking.phone}</p>
                    <p>${booking.start_time}</p>
                    <p>${booking.training_type}</p>
                    <p>${booking.equipment}</p>
                    <p>${booking.trainer_name || 'Без тренера'}</p>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
    }
}

// Создание тренировки
async function createTraining(formData) {
    try {
        const response = await fetch('/api/trainings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            closeModal('create-training-modal');
            loadTrainings();
        } else {
            throw new Error('Ошибка при создании тренировки');
        }
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

// Просмотр тренировки
async function viewTraining(id) {
    try {
        const response = await fetch(`/api/trainings/${id}`);
        const training = await response.json();
        
        // Показать модальное окно с информацией о тренировке
        // TODO: Реализовать отображение информации о тренировке
    } catch (error) {
        console.error('Ошибка при загрузке информации о тренировке:', error);
    }
}

// Удаление тренировки
async function deleteTraining(id) {
    if (confirm('Вы уверены, что хотите удалить эту тренировку?')) {
        try {
            const response = await fetch(`/api/trainings/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadTrainings();
            } else {
                throw new Error('Ошибка при удалении тренировки');
            }
        } catch (error) {
            console.error('Ошибка:', error);
        }
    }
}

// Вспомогательные функции
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Обработчики событий для модальных окон
document.getElementById('create-training')?.addEventListener('click', () => {
    const modal = document.getElementById('create-training-modal');
    if (modal) {
        modal.style.display = 'block';
    }
});

document.getElementById('create-training-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    createTraining(data);
}); 