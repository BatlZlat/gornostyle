// Переменные для фильтрации
let allApplications = [];
let currentApplicationsFilter = 'all';
let currentApplicationsDate = '';
let currentApplicationsSearch = '';

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    loadApplications();
});

// Настройка обработчиков событий
function setupEventListeners() {
    // Фильтр по статусу
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', function() {
            currentApplicationsFilter = this.value;
            displayApplications();
        });
    }
    
    // Фильтр по дате
    const dateFilter = document.getElementById('date-filter');
    if (dateFilter) {
        dateFilter.addEventListener('change', function() {
            currentApplicationsDate = this.value;
            displayApplications();
        });
    }
    
    // Поиск
    const searchInput = document.getElementById('application-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            currentApplicationsSearch = this.value.toLowerCase();
            displayApplications();
        });
    }
}

// Загрузка заявок с сервера
async function loadApplications() {
    try {
        showLoading('Загрузка архива заявок...');
        
        const response = await fetch('/api/applications/archive', {
            headers: {
                'Authorization': `Bearer ${getCookie('adminToken')}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allApplications = await response.json();
        console.log('Загружены заявки архива:', allApplications);
        
        displayApplications();
        hideLoading();
    } catch (error) {
        console.error('Ошибка при загрузке архива заявок:', error);
        showError('Не удалось загрузить архив заявок');
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
        if (currentApplicationsFilter !== 'all' && application.group_status !== currentApplicationsFilter) {
            return false;
        }
        
        // Фильтр по дате
        if (currentApplicationsDate) {
            const applicationDate = new Date(application.preferred_date).toISOString().split('T')[0];
            if (applicationDate !== currentApplicationsDate) {
                return false;
            }
        }
        
        // Фильтр по поиску
        if (currentApplicationsSearch) {
            const searchTerm = currentApplicationsSearch;
            const clientName = application.client_name ? application.client_name.toLowerCase() : '';
            const childName = application.child_name ? application.child_name.toLowerCase() : '';
            
            if (!clientName.includes(searchTerm) && !childName.includes(searchTerm)) {
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
                    <th>Оборудование</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${filteredApplications.map((application, index) => `
                    <tr class="application-row application-status-${application.group_status}">
                        <td>${index + 1}</td>
                        <td>${formatDate(application.preferred_date)} ${application.preferred_time}</td>
                        <td>${application.client_name || application.child_name || 'Не указан'}</td>
                        <td>${application.has_group ? 'Групповая' : 'Индивидуальная'}</td>
                        <td>${application.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд'}</td>
                        <td>
                            <select class="status-select" onchange="updateApplicationStatus(${application.id}, this.value)">
                                <option value="ungrouped" ${application.group_status === 'ungrouped' ? 'selected' : ''}>Не выполнена</option>
                                <option value="completed" ${application.group_status === 'completed' ? 'selected' : ''}>Выполнена</option>
                                <option value="cancelled" ${application.group_status === 'cancelled' ? 'selected' : ''}>Отменена</option>
                            </select>
                        </td>
                        <td class="application-actions">
                            <button class="btn-secondary" onclick="viewApplication(${application.id})">
                                Просмотр
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

// Обновление статуса заявки
async function updateApplicationStatus(applicationId, newStatus) {
    try {
        const response = await fetch(`/api/applications/${applicationId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getCookie('adminToken')}`
            },
            body: JSON.stringify({ group_status: newStatus })
        });
        
        if (!response.ok) {
            throw new Error('Ошибка при обновлении статуса заявки');
        }
        
        showSuccess('Статус заявки обновлен');
        loadApplications(); // Перезагружаем список
    } catch (error) {
        console.error('Ошибка при обновлении статуса заявки:', error);
        showError('Не удалось обновить статус заявки');
    }
}

// Просмотр заявки
async function viewApplication(applicationId) {
    try {
        const response = await fetch(`/api/applications/${applicationId}`, {
            headers: {
                'Authorization': `Bearer ${getCookie('adminToken')}`
            }
        });
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
                        <p><strong>Клиент:</strong> ${application.client_name || application.child_name || 'Не указан'}</p>
                        <p><strong>Тип заявки:</strong> ${application.has_group ? 'Групповая' : 'Индивидуальная'}</p>
                        <p><strong>Оборудование:</strong> ${application.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд'}</p>
                        <p><strong>Дата тренировки:</strong> ${application.preferred_date} ${application.preferred_time}</p>
                        <p><strong>Длительность:</strong> ${application.duration} мин</p>
                        <p><strong>Уровень:</strong> ${application.skill_level}/10</p>
                        <p><strong>Статус:</strong> ${application.group_status === 'ungrouped' ? 'Не выполнена' : application.group_status === 'completed' ? 'Выполнена' : 'Отменена'}</p>
                    </div>
                    ${application.training_frequency ? `
                        <div class="detail-group">
                            <h4>Дополнительная информация</h4>
                            <p><strong>Частота:</strong> ${application.training_frequency === 'regular' ? 'Регулярные' : 'Разовые'}</p>
                            ${application.has_group ? `<p><strong>Размер группы:</strong> ${application.group_size} чел.</p>` : ''}
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

// Удаление заявки
async function deleteApplication(applicationId) {
    if (!confirm('Вы уверены, что хотите удалить эту заявку?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/applications/${applicationId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getCookie('adminToken')}`
            }
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

// Вспомогательные функции
function formatDate(dateString) {
    if (!dateString) return 'Не указано';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function showLoading(message) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-overlay';
    loadingDiv.innerHTML = `
        <div class="loading-content">
            <div class="spinner"></div>
            <p>${message}</p>
        </div>
    `;
    document.body.appendChild(loadingDiv);
}

function hideLoading() {
    const loadingDiv = document.querySelector('.loading-overlay');
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'alert alert-success';
    successDiv.textContent = message;
    document.querySelector('.admin-container').insertBefore(successDiv, document.querySelector('.applications-controls'));
    setTimeout(() => successDiv.remove(), 3000);
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger';
    errorDiv.textContent = message;
    document.querySelector('.admin-container').insertBefore(errorDiv, document.querySelector('.applications-controls'));
    setTimeout(() => errorDiv.remove(), 5000);
}
