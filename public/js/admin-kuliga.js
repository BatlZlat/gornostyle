'use strict';

// Глобальные переменные
let kuligaInstructors = [];
let kuligaCurrentTab = 'instructors';
let kuligaPendingPhotoFile = null;
let kuligaRemovePhoto = false;

// API endpoints
const KULIGA_API = {
    instructors: '/api/kuliga/admin/instructors',
    settings: '/api/kuliga/admin/settings',
    finances: '/api/kuliga/admin/finances',
};

const KULIGA_PLACEHOLDER = '/images/gornosyle72_logo.webp';

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initKuligaAdminPage();
});

function initKuligaAdminPage() {
    document.querySelectorAll('.kuliga-tab').forEach((tab) => {
        tab.addEventListener('click', () => switchKuligaTab(tab.dataset.tab));
    });

    const addBtn = document.getElementById('kuliga-add-instructor');
    if (addBtn) {
        addBtn.addEventListener('click', () => openKuligaInstructorModal());
    }

    const form = document.getElementById('kuliga-instructor-form');
    if (form) {
        form.addEventListener('submit', handleKuligaInstructorSubmit);
    }

    const statusFilter = document.getElementById('kuliga-filter-status');
    const sportFilter = document.getElementById('kuliga-filter-sport');
    if (statusFilter) statusFilter.addEventListener('change', loadKuligaInstructors);
    if (sportFilter) sportFilter.addEventListener('change', loadKuligaInstructors);

    const saveSettingsBtn = document.getElementById('kuliga-save-settings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveKuligaSettings);
    }

    const financeRefreshBtn = document.getElementById('kuliga-finance-refresh');
    if (financeRefreshBtn) {
        financeRefreshBtn.addEventListener('click', loadKuligaFinances);
    }

    const kuligaMenuItem = document.querySelector('[data-page="kuliga-admin"]');
    if (kuligaMenuItem) {
        kuligaMenuItem.addEventListener('click', () => {
            setTimeout(() => {
                if (kuligaCurrentTab === 'instructors') {
                    loadKuligaInstructors();
                } else if (kuligaCurrentTab === 'settings') {
                    loadKuligaSettings();
                } else if (kuligaCurrentTab === 'finances') {
                    loadKuligaFinances();
                }
            }, 100);
        });
    }
}

function switchKuligaTab(tabName) {
    kuligaCurrentTab = tabName;

    document.querySelectorAll('.kuliga-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.kuliga-tab-content').forEach((content) => {
        const contentId = `kuliga-tab-${tabName}`;
        content.style.display = content.id === contentId ? 'block' : 'none';
    });

    if (tabName === 'instructors') {
        loadKuligaInstructors();
    } else if (tabName === 'settings') {
        loadKuligaSettings();
    } else if (tabName === 'finances') {
        loadKuligaFinances();
    }
}

const mapSportLabel = (type) => {
    const sportLabels = {
        ski: 'Горные лыжи',
        snowboard: 'Сноуборд',
        both: 'Лыжи и сноуборд',
    };
    return sportLabels[type] || type;
};

// ========== ИНСТРУКТОРЫ ==========

async function loadKuligaInstructors() {
    const container = document.getElementById('kuliga-instructors-list');
    if (!container) return;

    const statusFilter = document.getElementById('kuliga-filter-status')?.value || 'active';
    const sportFilter = document.getElementById('kuliga-filter-sport')?.value || 'all';

    try {
        container.innerHTML = '<p>Загрузка инструкторов...</p>';

        const response = await fetch(`${KULIGA_API.instructors}?status=${statusFilter}&sport=${sportFilter}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });

        if (!response.ok) {
            throw new Error(`Ошибка загрузки (${response.status})`);
        }

        const data = await response.json();
        kuligaInstructors = data.data || [];

        if (kuligaInstructors.length === 0) {
            container.innerHTML =
                '<p style="text-align:center;color:#999;padding:40px;">Инструкторы не найдены. Добавьте первого инструктора!</p>';
            return;
        }

        renderKuligaInstructors();
    } catch (error) {
        console.error('Ошибка загрузки инструкторов Кулиги:', error);
        container.innerHTML = '<p style="color:red;">Не удалось загрузить список инструкторов</p>';
    }
}

function renderKuligaInstructors() {
    const container = document.getElementById('kuliga-instructors-list');
    if (!container) return;

    container.innerHTML = kuligaInstructors
        .map((instructor) => {
            const statusClass = instructor.is_active ? 'success' : 'secondary';
            const statusText = instructor.is_active ? 'Активен' : 'Неактивен';
            const photoUrl = instructor.photo_url || KULIGA_PLACEHOLDER;
            const description = instructor.description || 'Описание отсутствует';

            return `
            <div class="kuliga-instructor-item" data-id="${instructor.id}">
                <div class="kuliga-instructor-photo">
                    <img src="${photoUrl}" alt="${instructor.full_name}" onerror="this.onerror=null;this.src='${KULIGA_PLACEHOLDER}';">
                </div>
                <div class="kuliga-instructor-info">
                    <h4>${instructor.full_name}</h4>
                    <p><strong>Вид спорта:</strong> ${mapSportLabel(instructor.sport_type)}</p>
                    <p><strong>Телефон:</strong> ${instructor.phone}</p>
                    ${instructor.email ? `<p><strong>Email:</strong> ${instructor.email}</p>` : ''}
                    <p><strong>Процент администратора:</strong> ${Number(instructor.admin_percentage).toFixed(2)}%</p>
                    <p class="kuliga-instructor-description">${description}</p>
                </div>
                <div class="kuliga-instructor-actions">
                    <span class="badge badge-${statusClass}">${statusText}</span>
                    <button class="btn-icon" onclick="editKuligaInstructor(${instructor.id})" title="Редактировать">✏️</button>
                    <button class="btn-icon" onclick="toggleKuligaInstructorStatus(${instructor.id}, ${!instructor.is_active})" title="${
                        instructor.is_active ? 'Деактивировать' : 'Активировать'
                    }">
                        ${instructor.is_active ? '🔒' : '🔓'}
                    </button>
                </div>
            </div>
        `;
        })
        .join('');
}

function resetKuligaPhotoState() {
    kuligaPendingPhotoFile = null;
    kuligaRemovePhoto = false;
}

function updateKuligaPhotoPreview(photoUrl, { persist = true } = {}) {
    const preview = document.getElementById('kuliga-instructor-photo-preview');
    const placeholder = document.getElementById('kuliga-instructor-photo-placeholder');
    const hiddenInput = document.getElementById('kuliga-instructor-photo-url');

    if (!preview || !placeholder || !hiddenInput) return;

    if (photoUrl) {
        preview.src = photoUrl;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        if (persist) {
            hiddenInput.value = photoUrl;
        }
    } else {
        preview.style.display = 'none';
        placeholder.style.display = 'flex';
        hiddenInput.value = '';
    }
}

function setupKuligaPhotoHandlers() {
    const uploadBtn = document.getElementById('kuliga-instructor-upload-btn');
    const removeBtn = document.getElementById('kuliga-instructor-remove-photo');
    const fileInput = document.getElementById('kuliga-instructor-photo-file');

    if (uploadBtn && fileInput) {
        uploadBtn.onclick = () => fileInput.click();
    }

    if (fileInput) {
        fileInput.onchange = (event) => {
            const [file] = event.target.files;
            if (!file) return;
            kuligaPendingPhotoFile = file;
            kuligaRemovePhoto = false;

            const reader = new FileReader();
            reader.onload = (e) => updateKuligaPhotoPreview(e.target.result, { persist: false });
            reader.readAsDataURL(file);
        };
    }

    if (removeBtn) {
        removeBtn.onclick = () => {
            kuligaPendingPhotoFile = null;
            kuligaRemovePhoto = true;
            updateKuligaPhotoPreview('');
        };
    }
}

function openKuligaInstructorModal(instructorId = null) {
    const modal = document.getElementById('kuliga-instructor-modal');
    const form = document.getElementById('kuliga-instructor-form');
    const title = document.getElementById('kuliga-instructor-modal-title');
    const submitBtn = document.getElementById('kuliga-instructor-submit');

    if (!modal || !form) return;

    form.reset();
    resetKuligaPhotoState();
    updateKuligaPhotoPreview('');

    if (instructorId) {
        const instructor = kuligaInstructors.find((i) => i.id === instructorId);
        if (!instructor) return;

        title.textContent = 'Редактировать инструктора';
        submitBtn.textContent = 'Сохранить';

        document.getElementById('kuliga-instructor-id').value = instructor.id;
        document.getElementById('kuliga-instructor-name').value = instructor.full_name;
        document.getElementById('kuliga-instructor-phone').value = instructor.phone;
        document.getElementById('kuliga-instructor-email').value = instructor.email || '';
        document.getElementById('kuliga-instructor-description').value = instructor.description || '';
        document.getElementById('kuliga-instructor-sport').value = instructor.sport_type;
        document.getElementById('kuliga-instructor-percentage').value = Number(instructor.admin_percentage).toFixed(2);
        document.getElementById('kuliga-instructor-hire-date').value = instructor.hire_date || '';
        document.getElementById('kuliga-instructor-active').checked = instructor.is_active;

        updateKuligaPhotoPreview(instructor.photo_url || '');
    } else {
        title.textContent = 'Добавить инструктора';
        submitBtn.textContent = 'Создать';
        document.getElementById('kuliga-instructor-id').value = '';

        const today = new Date().toISOString().split('T')[0];
        document.getElementById('kuliga-instructor-hire-date').value = today;
    }

    setupKuligaPhotoHandlers();
    modal.style.display = 'flex';
}

function closeKuligaInstructorModal() {
    const modal = document.getElementById('kuliga-instructor-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

window.openKuligaInstructorModal = openKuligaInstructorModal;
window.closeKuligaInstructorModal = closeKuligaInstructorModal;

async function uploadKuligaInstructorPhoto(instructorId) {
    if (!kuligaPendingPhotoFile) return null;

    const formData = new FormData();
    formData.append('photo', kuligaPendingPhotoFile);

    const response = await fetch(`${KULIGA_API.instructors}/${instructorId}/upload-photo`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Не удалось загрузить фото');
    }

    const data = await response.json();
    kuligaPendingPhotoFile = null;
    return data.photoUrl;
}

async function handleKuligaInstructorSubmit(event) {
    event.preventDefault();

    const instructorId = document.getElementById('kuliga-instructor-id').value;
    const isEdit = Boolean(instructorId);

    const percentageRaw = document.getElementById('kuliga-instructor-percentage').value;
    const percentageValue = Number.isFinite(parseFloat(percentageRaw)) ? parseFloat(percentageRaw) : 20.0;

    const payload = {
        fullName: document.getElementById('kuliga-instructor-name').value.trim(),
        phone: document.getElementById('kuliga-instructor-phone').value.trim(),
        email: document.getElementById('kuliga-instructor-email').value.trim() || null,
        photoUrl: kuligaRemovePhoto ? null : document.getElementById('kuliga-instructor-photo-url').value || null,
        description: document.getElementById('kuliga-instructor-description').value.trim() || null,
        sportType: document.getElementById('kuliga-instructor-sport').value,
        adminPercentage: percentageValue,
        hireDate: document.getElementById('kuliga-instructor-hire-date').value || null,
        isActive: document.getElementById('kuliga-instructor-active').checked,
    };

    if (!payload.fullName || !payload.phone || !payload.sportType) {
        alert('Пожалуйста, заполните обязательные поля');
        return;
    }

    try {
        const url = isEdit ? `${KULIGA_API.instructors}/${instructorId}` : KULIGA_API.instructors;
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Ошибка сохранения инструктора');
        }

        const savedInstructor = data.data;

        if (kuligaPendingPhotoFile) {
            try {
                const photoUrl = await uploadKuligaInstructorPhoto(savedInstructor.id);
                if (photoUrl) {
                    updateKuligaPhotoPreview(photoUrl);
                    kuligaRemovePhoto = false;
                }
            } catch (uploadError) {
                console.error(uploadError);
                alert(uploadError.message || 'Фото не загружено');
            }
        }

        alert(isEdit ? 'Инструктор успешно обновлён' : 'Инструктор успешно добавлен');
        closeKuligaInstructorModal();
        loadKuligaInstructors();
    } catch (error) {
        console.error('Ошибка сохранения инструктора:', error);
        alert(error.message || 'Не удалось сохранить инструктора');
    }
}

async function editKuligaInstructor(instructorId) {
    openKuligaInstructorModal(instructorId);
}

window.editKuligaInstructor = editKuligaInstructor;

async function toggleKuligaInstructorStatus(instructorId, newStatus) {
    const action = newStatus ? 'активировать' : 'деактивировать';
    if (!confirm(`Вы уверены, что хотите ${action} этого инструктора?`)) return;

    try {
        const response = await fetch(`${KULIGA_API.instructors}/${instructorId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
            },
            body: JSON.stringify({ isActive: Boolean(newStatus) }),
        });

        if (!response.ok) throw new Error('Ошибка изменения статуса');

        alert(`Инструктор успешно ${newStatus ? 'активирован' : 'деактивирован'}`);
        loadKuligaInstructors();
    } catch (error) {
        console.error('Ошибка изменения статуса инструктора:', error);
        alert('Не удалось изменить статус инструктора');
    }
}

window.toggleKuligaInstructorStatus = toggleKuligaInstructorStatus;

// ========== НАСТРОЙКИ ==========

async function loadKuligaSettings() {
    try {
        const response = await fetch(KULIGA_API.settings, {
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });

        if (!response.ok) throw new Error('Ошибка загрузки настроек');

        const data = await response.json();
        const settings = data.data || {};

        document.getElementById('kuliga-default-percentage').value = settings.default_admin_percentage || 20.0;
        document.getElementById('kuliga-check-time').value = settings.group_check_time || '22:00';
    } catch (error) {
        console.error('Ошибка загрузки настроек Кулиги:', error);
        alert('Не удалось загрузить настройки');
    }
}

async function saveKuligaSettings() {
    const payload = {
        defaultAdminPercentage: parseFloat(document.getElementById('kuliga-default-percentage').value) || 20.0,
        groupCheckTime: document.getElementById('kuliga-check-time').value || '22:00',
    };

    try {
        const response = await fetch(KULIGA_API.settings, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error('Ошибка сохранения настроек');

        alert('Настройки успешно сохранены');
    } catch (error) {
        console.error('Ошибка сохранения настроек Кулиги:', error);
        alert('Не удалось сохранить настройки');
    }
}

// ========== ФИНАНСЫ ==========

async function loadKuligaFinances() {
    const fromDate = document.getElementById('kuliga-finance-from')?.value;
    const toDate = document.getElementById('kuliga-finance-to')?.value;

    if (!fromDate || !toDate) {
        // Устанавливаем даты по умолчанию (текущий месяц)
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

        if (document.getElementById('kuliga-finance-from')) {
            document.getElementById('kuliga-finance-from').value = fromDate || firstDay;
        }
        if (document.getElementById('kuliga-finance-to')) {
            document.getElementById('kuliga-finance-to').value = toDate || lastDay;
        }

        if (!fromDate || !toDate) {
            return loadKuligaFinances();
        }
    }

    try {
        const summaryContainer = document.querySelector('.kuliga-finance-summary');
        const detailsContainer = document.getElementById('kuliga-finance-details');

        if (summaryContainer) summaryContainer.innerHTML = '<p>Загрузка...</p>';
        if (detailsContainer) detailsContainer.innerHTML = '';

        const response = await fetch(`${KULIGA_API.finances}?from=${fromDate}&to=${toDate}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });

        if (!response.ok) throw new Error('Ошибка загрузки финансов');

        const data = await response.json();
        renderKuligaFinances(data.data || {});
    } catch (error) {
        console.error('Ошибка загрузки финансов Кулиги:', error);
        const summaryContainer = document.querySelector('.kuliga-finance-summary');
        if (summaryContainer) {
            summaryContainer.innerHTML = '<p style="color:red;">Не удалось загрузить финансовую отчётность</p>';
        }
    }
}

function renderKuligaFinances(finances) {
    const summaryContainer = document.querySelector('.kuliga-finance-summary');
    const detailsContainer = document.getElementById('kuliga-finance-details');

    if (!summaryContainer || !detailsContainer) return;

    const { summary = {}, details = [] } = finances;

    // Сводка
    summaryContainer.innerHTML = `
        <div class="finance-summary-grid">
            <div class="finance-card">
                <h4>Общий доход</h4>
                <p class="finance-value">${Number(summary.totalRevenue || 0).toLocaleString('ru-RU')} ₽</p>
            </div>
            <div class="finance-card">
                <h4>Доход администратора</h4>
                <p class="finance-value">${Number(summary.adminRevenue || 0).toLocaleString('ru-RU')} ₽</p>
            </div>
            <div class="finance-card">
                <h4>Доход инструкторов</h4>
                <p class="finance-value">${Number(summary.instructorsRevenue || 0).toLocaleString('ru-RU')} ₽</p>
            </div>
            <div class="finance-card">
                <h4>Количество тренировок</h4>
                <p class="finance-value">${summary.totalTrainings || 0}</p>
            </div>
        </div>
    `;

    // Детали по инструкторам
    if (details.length > 0) {
        detailsContainer.innerHTML = `
            <h4 style="margin-top:24px;">Детализация по инструкторам</h4>
            <table class="kuliga-finance-table">
                <thead>
                    <tr>
                        <th>Инструктор</th>
                        <th>Тренировок</th>
                        <th>Сумма (₽)</th>
                        <th>% Админа</th>
                        <th>Доход админа (₽)</th>
                        <th>Доход инстр. (₽)</th>
                    </tr>
                </thead>
                <tbody>
                    ${details
                        .map(
                            (item) => `
                        <tr>
                            <td>${item.instructor_name}</td>
                            <td>${item.trainings_count || 0}</td>
                            <td>${Number(item.total_amount || 0).toLocaleString('ru-RU')}</td>
                            <td>${item.admin_percentage || 0}%</td>
                            <td>${Number(item.admin_revenue || 0).toLocaleString('ru-RU')}</td>
                            <td>${Number(item.instructor_revenue || 0).toLocaleString('ru-RU')}</td>
                        </tr>
                    `
                        )
                        .join('')}
                </tbody>
            </table>
        `;
    } else {
        detailsContainer.innerHTML = '<p style="text-align:center;color:#999;margin-top:24px;">Нет данных за выбранный период</p>';
    }
}

