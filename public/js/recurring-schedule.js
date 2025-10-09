// API Base URL
const API_URL = '';

// Получение токена из localStorage или cookies
function getAuthToken() {
    // Сначала проверяем localStorage
    let token = localStorage.getItem('authToken');
    
    // Если токена нет в localStorage, проверяем cookies
    if (!token) {
        function getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }
        
        token = getCookie('adminToken');
        
        // Если токен найден в cookies, сохраняем его в localStorage для удобства
        if (token) {
            localStorage.setItem('authToken', token);
        }
    }
    
    return token;
}

// Глобальные переменные
let templates = [];
let simulators = [];
let groups = [];
let trainers = [];
let currentEditingId = null;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    // Проверка авторизации
    const token = getAuthToken();
    if (!token) {
        // Если токена нет, попробуем получить его из родительского окна
        if (window.opener && window.opener.localStorage) {
            const parentToken = window.opener.localStorage.getItem('authToken');
            if (parentToken) {
                localStorage.setItem('authToken', parentToken);
                console.log('Токен получен из родительского окна');
            } else {
                window.location.href = 'login.html';
                return;
            }
        } else {
            window.location.href = 'login.html';
            return;
        }
    }

    // Загрузка данных
    await loadInitialData();

    // Установка обработчиков событий
    setupEventListeners();
});

// Загрузка начальных данных
async function loadInitialData() {
    try {
        await Promise.all([
            loadTemplates(),
            loadSimulators(),
            loadGroups(),
            loadTrainers(),
            loadScheduleRange()
        ]);
    } catch (error) {
        console.error('Ошибка при загрузке данных:', error);
        showError('Не удалось загрузить данные');
    }
}

// Загрузка диапазона расписания
async function loadScheduleRange() {
    try {
        const response = await fetch(`${API_URL}/api/schedule/range`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Ошибка при загрузке диапазона расписания');
        }

        const data = await response.json();
        
        if (data.min_date && data.max_date) {
            const minDate = new Date(data.min_date).toLocaleDateString('ru-RU');
            const maxDate = new Date(data.max_date).toLocaleDateString('ru-RU');
            document.getElementById('stat-range').textContent = `${minDate} - ${maxDate}`;
        } else {
            document.getElementById('stat-range').textContent = 'Нет расписания';
        }
        
    } catch (error) {
        console.error('Ошибка при загрузке диапазона расписания:', error);
        document.getElementById('stat-range').textContent = 'Ошибка';
    }
}

// Загрузка шаблонов
async function loadTemplates() {
    try {
        const response = await fetch(`${API_URL}/api/recurring-templates`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Неавторизован - перенаправляем на логин
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Ошибка при загрузке шаблонов');
        }

        templates = await response.json();
        renderTemplates();
        updateStatistics();
    } catch (error) {
        console.error('Ошибка:', error);
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            window.location.href = 'login.html';
            return;
        }
        document.getElementById('templates-container').innerHTML = 
            '<div class="empty-state"><p>Ошибка при загрузке шаблонов</p></div>';
    }
}

// Загрузка тренажеров
async function loadSimulators() {
    try {
        const response = await fetch(`${API_URL}/api/simulators`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (response.ok) {
            simulators = await response.json();
            populateSimulatorSelect();
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренажеров:', error);
    }
}

// Загрузка групп
async function loadGroups() {
    try {
        const response = await fetch(`${API_URL}/api/groups`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (response.ok) {
            groups = await response.json();
            populateGroupSelect();
        }
    } catch (error) {
        console.error('Ошибка при загрузке групп:', error);
    }
}

// Загрузка тренеров
async function loadTrainers() {
    try {
        const response = await fetch(`${API_URL}/api/trainers`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (response.ok) {
            const allTrainers = await response.json();
            trainers = allTrainers.filter(t => t.is_active);
            populateTrainerSelect();
        }
    } catch (error) {
        console.error('Ошибка при загрузке тренеров:', error);
    }
}

// Отображение шаблонов
function renderTemplates() {
    const container = document.getElementById('templates-container');

    if (templates.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📅</div>
                <h3>Нет шаблонов</h3>
                <p>Создайте первый шаблон постоянного расписания</p>
            </div>
        `;
        return;
    }

    container.innerHTML = templates.map(template => `
        <div class="template-card ${template.is_active ? 'active' : 'inactive'}">
            <div class="template-header">
                <h3 class="template-title">${template.name}</h3>
                <span class="template-status ${template.is_active ? 'active' : 'inactive'}">
                    ${template.is_active ? 'Активен' : 'Неактивен'}
                </span>
            </div>

            <div class="template-info">
                <div class="template-info-row">
                    <span class="template-info-label">📅 День недели:</span>
                    <span>${template.day_name}</span>
                </div>
                <div class="template-info-row">
                    <span class="template-info-label">⏰ Время:</span>
                    <span>${formatTime(template.start_time)}</span>
                </div>
                <div class="template-info-row">
                    <span class="template-info-label">🏂 Тренажер:</span>
                    <span>${template.simulator_name || 'Не указан'}</span>
                </div>
                <div class="template-info-row">
                    <span class="template-info-label">👥 Группа:</span>
                    <span>${template.group_name || 'Не указана'}</span>
                </div>
                <div class="template-info-row">
                    <span class="template-info-label">👨‍🏫 Тренер:</span>
                    <span>${template.trainer_name || 'Без тренера'}</span>
                </div>
                <div class="template-info-row">
                    <span class="template-info-label">👤 Макс. участников:</span>
                    <span>${template.max_participants}</span>
                </div>
                <div class="template-info-row">
                    <span class="template-info-label">📊 Будущих тренировок:</span>
                    <span>${template.future_trainings_count || 0}</span>
                </div>
            </div>

            <div class="template-actions">
                <button class="btn-edit" onclick="editTemplate(${template.id})">✏️ Редактировать</button>
                <button class="btn-toggle" onclick="toggleTemplate(${template.id})">
                    ${template.is_active ? '⏸ Деактивировать' : '▶️ Активировать'}
                </button>
                <button class="btn-preview" onclick="previewTemplate(${template.id})">👁 Предпросмотр</button>
                <button class="btn-delete" onclick="deleteTemplate(${template.id}, '${template.name}')">🗑 Удалить</button>
            </div>
        </div>
    `).join('');
}

// Обновление статистики
function updateStatistics() {
    const totalCount = templates.length;
    const activeCount = templates.filter(t => t.is_active).length;
    const trainingsCount = templates.reduce((sum, t) => sum + (t.future_trainings_count || 0), 0);

    document.getElementById('stat-total').textContent = totalCount;
    document.getElementById('stat-active').textContent = activeCount;
    document.getElementById('stat-trainings').textContent = trainingsCount;
}

// Заполнение select'ов в форме
function populateSimulatorSelect() {
    const select = document.getElementById('template-simulator');
    select.innerHTML = '<option value="">Выберите тренажер</option>' +
        simulators.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function populateGroupSelect() {
    const select = document.getElementById('template-group');
    select.innerHTML = '<option value="">Выберите группу</option>' +
        groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

function populateTrainerSelect() {
    const select = document.getElementById('template-trainer');
    select.innerHTML = '<option value="">Без тренера</option>' +
        trainers.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('');
}

// Установка обработчиков событий
function setupEventListeners() {
    // Кнопка создания шаблона
    document.getElementById('create-template-btn').addEventListener('click', openCreateModal);

    // Кнопка применения к текущему месяцу
    document.getElementById('apply-current-month-btn').addEventListener('click', applyToCurrentMonth);

    // Кнопки экспорта/импорта
    document.getElementById('export-templates-btn').addEventListener('click', exportTemplates);
    document.getElementById('import-templates-btn').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = importTemplates;
        input.click();
    });

    // Модальное окно
    const modal = document.getElementById('template-modal');
    const closeBtn = modal.querySelector('.close');
    const cancelBtn = document.getElementById('cancel-btn');

    closeBtn.onclick = () => modal.style.display = 'none';
    cancelBtn.onclick = () => modal.style.display = 'none';

    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
        const previewModal = document.getElementById('preview-modal');
        if (event.target === previewModal) {
            previewModal.style.display = 'none';
        }
    };

    // Форма
    document.getElementById('template-form').addEventListener('submit', handleFormSubmit);

    // Закрытие модального окна предпросмотра
    document.querySelectorAll('#preview-modal .close').forEach(btn => {
        btn.onclick = () => document.getElementById('preview-modal').style.display = 'none';
    });
}

// Открытие модального окна создания
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modal-title').textContent = 'Создать шаблон';
    document.getElementById('template-form').reset();
    document.getElementById('template-id').value = '';
    document.getElementById('template-modal').style.display = 'block';
}

// Редактирование шаблона
async function editTemplate(id) {
    currentEditingId = id;
    const template = templates.find(t => t.id === id);

    if (!template) {
        showError('Шаблон не найден');
        return;
    }

    document.getElementById('modal-title').textContent = 'Редактировать шаблон';
    document.getElementById('template-id').value = template.id;
    document.getElementById('template-name').value = template.name;
    document.getElementById('template-day').value = template.day_of_week;
    document.getElementById('template-time').value = template.start_time.substring(0, 5);
    document.getElementById('template-simulator').value = template.simulator_id;
    document.getElementById('template-group').value = template.group_id;
    document.getElementById('template-trainer').value = template.trainer_id || '';
    document.getElementById('template-equipment').value = template.equipment_type;
    document.getElementById('template-skill').value = template.skill_level || 3;
    document.getElementById('template-max-participants').value = template.max_participants;

    document.getElementById('template-modal').style.display = 'block';
}

// Обработка отправки формы
async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = {
        name: document.getElementById('template-name').value,
        day_of_week: parseInt(document.getElementById('template-day').value),
        start_time: document.getElementById('template-time').value + ':00',
        simulator_id: parseInt(document.getElementById('template-simulator').value),
        group_id: parseInt(document.getElementById('template-group').value),
        trainer_id: document.getElementById('template-trainer').value ? parseInt(document.getElementById('template-trainer').value) : null,
        equipment_type: document.getElementById('template-equipment').value,
        skill_level: parseInt(document.getElementById('template-skill').value),
        max_participants: parseInt(document.getElementById('template-max-participants').value)
    };

    try {
        const url = currentEditingId
            ? `${API_URL}/api/recurring-templates/${currentEditingId}`
            : `${API_URL}/api/recurring-templates`;

        const method = currentEditingId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при сохранении');
        }

        showSuccess(currentEditingId ? 'Шаблон обновлён' : 'Шаблон создан');
        document.getElementById('template-modal').style.display = 'none';
        await loadTemplates();
    } catch (error) {
        console.error('Ошибка:', error);
        showError(error.message);
    }
}

// Активация/деактивация шаблона
async function toggleTemplate(id) {
    try {
        const response = await fetch(`${API_URL}/api/recurring-templates/${id}/toggle`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка при изменении статуса');
        }

        const result = await response.json();
        showSuccess(result.message);
        await loadTemplates();
    } catch (error) {
        console.error('Ошибка:', error);
        showError(error.message);
    }
}

// Удаление шаблона
async function deleteTemplate(id, name) {
    if (!confirm(`Вы уверены, что хотите удалить шаблон "${name}"?\n\nВсе будущие тренировки, созданные по этому шаблону, также будут удалены.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/recurring-templates/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка при удалении');
        }

        const result = await response.json();
        showSuccess(`${result.message}. Удалено тренировок: ${result.deleted_trainings_count}`);
        await loadTemplates();
    } catch (error) {
        console.error('Ошибка:', error);
        showError(error.message);
    }
}

// Предпросмотр будущих тренировок
async function previewTemplate(id) {
    try {
        const response = await fetch(`${API_URL}/api/recurring-templates/${id}/preview`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка при получении предпросмотра');
        }

        const data = await response.json();
        showPreview(data);
    } catch (error) {
        console.error('Ошибка:', error);
        showError(error.message);
    }
}

// Отображение предпросмотра
function showPreview(data) {
    const content = document.getElementById('preview-content');
    const title = document.getElementById('preview-title');

    title.textContent = `Предпросмотр: ${data.template_name}`;

    content.innerHTML = `
        <div style="margin-bottom: 20px;">
            <p><strong>Месяц:</strong> ${data.month}</p>
            <p><strong>Будет создано тренировок:</strong> ${data.trainings_count}</p>
            <p><strong>Конфликтов:</strong> ${data.conflicts_count}</p>
        </div>

        <div class="preview-list">
            ${data.preview.map(item => `
                <div class="preview-item ${item.has_conflict ? 'conflict' : ''}">
                    <div>
                        <strong>${formatDate(item.date)}</strong> - ${formatTime(item.start_time)}
                        ${item.has_conflict ? `<br><small style="color: #FF9800;">⚠️ Конфликт с: ${item.conflict_with}</small>` : ''}
                    </div>
                    <div>
                        ${item.has_conflict ? '❌' : '✅'}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    document.getElementById('preview-modal').style.display = 'block';
}

// Применение шаблонов к существующему расписанию
async function applyToCurrentMonth() {
    if (!confirm('Применить все активные шаблоны к существующему расписанию? Это создаст тренировки для всех подходящих дат в созданном расписании.')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/recurring-templates/apply-current-month`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            if (response.status === 400) {
                const errorData = await response.json();
                alert(`❌ ${errorData.message}`);
                return;
            }
            throw new Error('Ошибка при применении шаблонов');
        }

        const result = await response.json();
        
        const dateRange = result.date_range ? 
            `\nПериод: ${result.date_range.from} - ${result.date_range.to}` : '';
        
        alert(`✅ Успешно применено!${dateRange}\n\nСоздано тренировок: ${result.created}\nКонфликтов: ${result.conflicts}\n\n${result.conflicts > 0 ? 'Проверьте логи для деталей о конфликтах.' : ''}`);
        
        // Обновляем статистику
        updateStatistics();
        
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Ошибка при применении шаблонов к существующему расписанию');
    }
}

// Экспорт шаблонов
function exportTemplates() {
    const dataStr = JSON.stringify(templates, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recurring-templates-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showSuccess('Шаблоны экспортированы');
}

// Импорт шаблонов
async function importTemplates(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const importedTemplates = JSON.parse(text);

        if (!Array.isArray(importedTemplates)) {
            throw new Error('Неверный формат файла');
        }

        let successCount = 0;
        let errorCount = 0;

        for (const template of importedTemplates) {
            try {
                const response = await fetch(`${API_URL}/api/recurring-templates`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({
                        name: template.name,
                        day_of_week: template.day_of_week,
                        start_time: template.start_time,
                        simulator_id: template.simulator_id,
                        trainer_id: template.trainer_id,
                        group_id: template.group_id,
                        skill_level: template.skill_level,
                        max_participants: template.max_participants,
                        equipment_type: template.equipment_type
                    })
                });

                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                errorCount++;
            }
        }

        showSuccess(`Импортировано: ${successCount}, ошибок: ${errorCount}`);
        await loadTemplates();
    } catch (error) {
        console.error('Ошибка при импорте:', error);
        showError('Ошибка при импорте шаблонов');
    }
}

// Вспомогательные функции форматирования
function formatTime(time) {
    return time ? time.substring(0, 5) : '';
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return `${days[date.getDay()]}, ${date.toLocaleDateString('ru-RU')}`;
}

// Уведомления
function showSuccess(message) {
    // Простое alert, можно заменить на toast
    alert('✅ ' + message);
}

function showError(message) {
    alert('❌ ' + message);
}

