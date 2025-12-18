'use strict';

// Глобальные переменные
let kuligaInstructors = [];
let kuligaPrograms = [];
let kuligaCurrentTab = 'instructors';
let kuligaPendingPhotoFile = null;
let kuligaRemovePhoto = false;
let kuligaProgramFormInitialized = false;

// API endpoints
const KULIGA_API = {
    instructors: '/api/kuliga/admin/instructors',
    programs: '/api/kuliga/admin/programs',
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

    const addProgramBtn = document.getElementById('kuliga-add-program');
    if (addProgramBtn) {
        addProgramBtn.addEventListener('click', () => openKuligaProgramModal());
    }

    const form = document.getElementById('kuliga-instructor-form');
    if (form) {
        form.addEventListener('submit', handleKuligaInstructorSubmit);
    }

    const programForm = document.getElementById('kuliga-program-form');
    if (programForm) {
        programForm.addEventListener('submit', handleKuligaProgramSubmit);
    }

    setupKuligaProgramFormInteractions();

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
    } else if (tabName === 'programs') {
        // Загружаем инструкторов перед программами, чтобы иметь доступ к их именам (для резервного варианта)
        if (kuligaInstructors.length === 0) {
            loadKuligaInstructors().then(() => loadKuligaPrograms());
        } else {
            loadKuligaPrograms();
        }
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
    const shouldRender = !!container;

    const statusFilter = document.getElementById('kuliga-filter-status')?.value || 'active';
    const sportFilter = document.getElementById('kuliga-filter-sport')?.value || 'all';

    try {
        if (shouldRender) {
            container.innerHTML = '<p>Загрузка инструкторов...</p>';
        }

        // Добавляем timestamp для обхода кэша браузера
        const cacheBuster = `&_t=${Date.now()}`;
        const response = await fetch(`${KULIGA_API.instructors}?status=${statusFilter}&sport=${sportFilter}${cacheBuster}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });

        if (!response.ok) {
            throw new Error(`Ошибка загрузки (${response.status})`);
        }

        const data = await response.json();
        kuligaInstructors = data.data || [];
        
        console.log(`📋 Загружено инструкторов: ${kuligaInstructors.length}`);
        if (kuligaInstructors.length > 0) {
            kuligaInstructors.forEach(instructor => {
                if (instructor.photo_url) {
                    console.log(`  - ${instructor.full_name}: photo_url = ${instructor.photo_url}`);
                }
            });
        }

        if (shouldRender) {
            if (kuligaInstructors.length === 0) {
                container.innerHTML =
                    '<p style="text-align:center;color:#999;padding:40px;">Инструкторы не найдены. Добавьте первого инструктора!</p>';
                return;
            }

            renderKuligaInstructors();
        }
    } catch (error) {
        console.error('Ошибка загрузки инструкторов Кулиги:', error);
        if (shouldRender) {
            container.innerHTML = '<p style="color:red;">Не удалось загрузить список инструкторов</p>';
        }
    }
}

function renderKuligaInstructors() {
    const container = document.getElementById('kuliga-instructors-list');
    if (!container) return;

    container.innerHTML = kuligaInstructors
        .map((instructor) => {
            const statusClass = instructor.is_active ? 'success' : 'secondary';
            const statusText = instructor.is_active ? 'Активен' : 'Неактивен';
            // Добавляем timestamp для обхода кэша браузера, если photo_url уже содержит параметр v
            let photoUrl = instructor.photo_url || KULIGA_PLACEHOLDER;
            if (photoUrl && photoUrl !== KULIGA_PLACEHOLDER && !photoUrl.includes('?v=')) {
                photoUrl = `${photoUrl}?v=${Date.now()}`;
            }
            const description = instructor.description || 'Описание отсутствует';

            return `
            <div class="kuliga-instructor-item" data-id="${instructor.id}">
                <div class="kuliga-instructor-photo">
                    <img src="${photoUrl}" alt="${instructor.full_name}" onerror="this.onerror=null;this.src='${KULIGA_PLACEHOLDER}';" loading="lazy">
                </div>
                <div class="kuliga-instructor-info">
                    <h4>${instructor.full_name}</h4>
                    <p><strong>Вид спорта:</strong> ${mapSportLabel(instructor.sport_type)}</p>
                    <p><strong>Место работы:</strong> ${instructor.location === 'vorona' ? 'Воронинские горки' : 'База отдыха «Кулига-Клуб»'}</p>
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

function openKuligaInstructorModal(instructorId = null, defaultLocation = 'kuliga') {
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
        document.getElementById('kuliga-instructor-location').value = instructor.location || 'kuliga';
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
        
        // Устанавливаем location по умолчанию при создании нового инструктора
        document.getElementById('kuliga-instructor-location').value = defaultLocation || 'kuliga';
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
        location: document.getElementById('kuliga-instructor-location').value || 'kuliga',
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
                console.log('📷 Начинаем загрузку фото для инструктора:', savedInstructor.id);
                const photoUrl = await uploadKuligaInstructorPhoto(savedInstructor.id);
                if (photoUrl) {
                    console.log('✅ Фото успешно загружено, URL:', photoUrl);
                    updateKuligaPhotoPreview(photoUrl);
                    kuligaRemovePhoto = false;
                    // Обновляем локальный объект инструктора с новым photoUrl
                    if (savedInstructor) {
                        savedInstructor.photo_url = photoUrl;
                    }
                } else {
                    console.warn('⚠️ Фото загружено, но URL не получен');
                }
            } catch (uploadError) {
                console.error('❌ Ошибка загрузки фото:', uploadError);
                alert(uploadError.message || 'Фото не загружено');
            }
        }

        alert(isEdit ? 'Инструктор успешно обновлён' : 'Инструктор успешно добавлен');
        closeKuligaInstructorModal();
        
        // Принудительно обновляем список инструкторов, чтобы показать новое фото
        // Используем небольшой таймаут, чтобы дать время БД обновиться
        setTimeout(() => {
            console.log('🔄 Обновляем список инструкторов после сохранения...');
            loadKuligaInstructors();
        }, 500);
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

// ========== ПРОГРАММЫ ==========

const WEEKDAY_LABELS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function setupKuligaProgramFormInteractions() {
    if (kuligaProgramFormInitialized) {
        const durationEl = document.getElementById('kuliga-program-training-duration');
        const warmupEl = document.getElementById('kuliga-program-warmup-duration');
        const practiceLabel = document.getElementById('kuliga-program-practice-duration');
        const updatePracticeDuration = () => {
            const total = parseInt(durationEl?.value || '0', 10);
            const warmup = parseInt(warmupEl?.value || '0', 10);
            const practice = Math.max(total - warmup, 0);
            if (practiceLabel) {
                practiceLabel.textContent = `${practice} мин`;
            }
        };
        updatePracticeDuration();
        return;
    }

    const durationEl = document.getElementById('kuliga-program-training-duration');
    const warmupEl = document.getElementById('kuliga-program-warmup-duration');
    const practiceLabel = document.getElementById('kuliga-program-practice-duration');
    const addTimeslotBtn = document.getElementById('kuliga-add-timeslot');
    const timeslotContainer = document.getElementById('kuliga-program-timeslots');

    const updatePracticeDuration = () => {
        const total = parseInt(durationEl?.value || '0', 10);
        const warmup = parseInt(warmupEl?.value || '0', 10);
        const practice = Math.max(total - warmup, 0);
        if (practiceLabel) {
            practiceLabel.textContent = `${practice} мин`;
        }
    };

    if (durationEl) {
        durationEl.addEventListener('change', updatePracticeDuration);
    }
    if (warmupEl) {
        warmupEl.addEventListener('change', updatePracticeDuration);
    }
    updatePracticeDuration();

    if (addTimeslotBtn && timeslotContainer) {
        addTimeslotBtn.addEventListener('click', () => {
            const wrapper = document.createElement('div');
            wrapper.className = 'timeslot-item';
            wrapper.innerHTML = `
                <input type="time" class="form-control timeslot-input" value="12:00" required>
                <button type="button" class="btn-danger btn-sm remove-timeslot">×</button>
            `;
            timeslotContainer.appendChild(wrapper);
        });

        timeslotContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('remove-timeslot')) {
                const item = event.target.closest('.timeslot-item');
                if (!item) return;
                if (timeslotContainer.querySelectorAll('.timeslot-item').length > 1) {
                    item.remove();
                } else {
                    const input = item.querySelector('input[type="time"]');
                    if (input) input.value = '10:00';
                }
            }
        });
    }

    kuligaProgramFormInitialized = true;
}

function getSelectedWeekdays() {
    return Array.from(document.querySelectorAll('#kuliga-program-form input[name="weekday"]:checked')).map((input) =>
        parseInt(input.value, 10)
    );
}

function setSelectedWeekdays(weekdays = []) {
    const checkboxList = document.querySelectorAll('#kuliga-program-form input[name="weekday"]');
    checkboxList.forEach((input) => {
        input.checked = weekdays.includes(parseInt(input.value, 10));
    });
}

function getProgramTimeslots() {
    const inputs = Array.from(document.querySelectorAll('#kuliga-program-timeslots .timeslot-input'));
    return inputs
        .map((input) => input.value)
        .filter((value) => !!value)
        .map((value) => (value.length === 5 ? `${value}:00` : value));
}

function setProgramTimeslots(timeSlots = []) {
    const container = document.getElementById('kuliga-program-timeslots');
    if (!container) return;

    container.innerHTML = '';
    const slots = timeSlots.length > 0 ? timeSlots : ['10:00:00'];
    slots.forEach((slot, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'timeslot-item';
        const value = slot.length === 5 ? slot : slot.slice(0, 5);
        wrapper.innerHTML = `
            <input type="time" class="form-control timeslot-input" value="${value}" required>
            <button type="button" class="btn-danger btn-sm remove-timeslot">×</button>
        `;
        container.appendChild(wrapper);
    });
}

function formatWeekdays(weekdays = []) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) {
        return 'Дни не указаны';
    }

    const sorted = [...new Set(weekdays)].sort((a, b) => {
        const order = [1, 2, 3, 4, 5, 6, 0];
        return order.indexOf(a) - order.indexOf(b);
    });

    return sorted.map((day) => WEEKDAY_LABELS[day] || day).join(', ');
}

function formatTimeslots(timeSlots = []) {
    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
        return 'Без времени';
    }
    return timeSlots
        .map((slot) => slot.slice(0, 5))
        .sort()
        .join(', ');
}

async function loadKuligaPrograms() {
    const container = document.getElementById('kuliga-programs-list');
    if (!container) return;

    try {
        container.innerHTML = '<p>Загрузка программ...</p>';

        const response = await fetch(KULIGA_API.programs, {
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });

        if (!response.ok) {
            throw new Error(`Ошибка загрузки (${response.status})`);
        }

        const data = await response.json();
        kuligaPrograms = data.data || [];

        if (kuligaPrograms.length === 0) {
            container.innerHTML =
                '<p style="text-align:center;color:#999;padding:40px;">Программы не найдены. Создайте первую программу!</p>';
            return;
        }

        renderKuligaPrograms();
    } catch (error) {
        console.error('Ошибка загрузки программ Кулиги:', error);
        container.innerHTML = '<p style="color:red;">Не удалось загрузить список программ</p>';
    }
}

function renderKuligaPrograms() {
    const container = document.getElementById('kuliga-programs-list');
    if (!container) return;

    container.innerHTML = kuligaPrograms
        .map((program) => {
            const statusClass = program.is_active ? 'success' : 'secondary';
            const statusText = program.is_active ? 'Активна' : 'Неактивна';
            const weekdays = formatWeekdays(program.weekdays);
            const timeSlots = formatTimeslots(program.time_slots);
            
            // Получаем название локации
            let locationName = 'Не указана';
            if (program.location) {
                if (typeof window.getLocationName === 'function') {
                    locationName = window.getLocationName(program.location);
                } else {
                    locationName = program.location === 'vorona' ? 'Воронинские горки' : program.location === 'kuliga' ? 'Кулига Парк' : program.location;
                }
            }
            
            // Получаем имена инструкторов
            let instructorsText = 'Не назначен';
            if (program.instructor_names && Array.isArray(program.instructor_names) && program.instructor_names.length > 0) {
                // Фильтруем пустые значения (на случай NULL в массиве)
                const validNames = program.instructor_names.filter(name => name && name.trim());
                if (validNames.length > 0) {
                    instructorsText = validNames.join(', ');
                }
            } else if (program.instructor_ids && Array.isArray(program.instructor_ids) && program.instructor_ids.length > 0) {
                // Если имена не пришли с сервера, пытаемся найти их в локальном массиве инструкторов
                const instructorNames = program.instructor_ids
                    .map(id => {
                        const instructor = kuligaInstructors.find(i => i.id === id || i.id === String(id));
                        return instructor ? instructor.full_name : null;
                    })
                    .filter(name => name);
                if (instructorNames.length > 0) {
                    instructorsText = instructorNames.join(', ');
                }
            }

            return `
            <div class="kuliga-program-card" data-id="${program.id}">
                <div class="kuliga-program-header">
                    <h4>${program.name}</h4>
                    <span class="badge badge-${statusClass}">${statusText}</span>
                </div>
                <p class="kuliga-program-description">${program.description || 'Описание отсутствует'}</p>
                <div class="kuliga-program-meta">
                    <span class="tag">${mapSportLabel(program.sport_type)}</span>
                    <span class="tag">До ${program.max_participants} чел.</span>
                    <span class="tag">${program.training_duration} мин.</span>
                    <span class="tag">Практика ${Math.max(program.practice_duration || 0, 0)} мин.</span>
                    <span class="tag">${Number(program.price).toLocaleString('ru-RU')} ₽</span>
                </div>
                <div class="kuliga-program-details">
                    <p><strong>Место проведения:</strong> ${locationName}</p>
                    <p><strong>Инструктор:</strong> ${instructorsText}</p>
                    <p><strong>Дни недели:</strong> ${weekdays}</p>
                    <p><strong>Время:</strong> ${timeSlots}</p>
                    <p><strong>Снаряжение:</strong> ${program.equipment_provided ? 'Предоставляем' : 'Самостоятельно'}</p>
                    <p><strong>Скипас:</strong> ${program.skipass_provided ? 'Предоставляем' : 'Самостоятельно'}</p>
                </div>
                <div class="kuliga-program-actions">
                    <button class="btn-secondary" onclick="openKuligaProgramModal(${program.id})">✏️ Редактировать</button>
                    <button class="btn-secondary" onclick="toggleKuligaProgramStatus(${program.id}, ${program.is_active ? 'false' : 'true'})">
                        ${program.is_active ? '🙈 Скрыть' : '👁️ Показать'}
                    </button>
                    <button class="btn-danger" onclick="deleteKuligaProgram(${program.id})">🗑️ Удалить</button>
                </div>
            </div>
        `;
        })
        .join('');
}

function resetKuligaProgramForm() {
    const form = document.getElementById('kuliga-program-form');
    if (!form) return;
    form.reset();
    setSelectedWeekdays([6, 0]);
    setProgramTimeslots(['10:00:00']);
    const practiceLabel = document.getElementById('kuliga-program-practice-duration');
    if (practiceLabel) {
        practiceLabel.textContent = '60 мин';
    }
}

async function loadInstructorsForProgram(location = 'kuliga', sportType = 'ski', selectedIds = []) {
    try {
        const response = await fetch(`${KULIGA_API.instructors}?status=active&location=${location}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });
        if (!response.ok) throw new Error('Ошибка загрузки инструкторов');
        
        const data = await response.json();
        let instructors = data.data || [];
        
        // Фильтруем инструкторов по виду спорта (совместимые с программой)
        instructors = instructors.filter(instructor => 
            instructor.sport_type === 'both' || instructor.sport_type === sportType
        );
        
        const select = document.getElementById('kuliga-program-instructors');
        if (!select) return;
        
        select.innerHTML = '';
        instructors.forEach(instructor => {
            const option = document.createElement('option');
            option.value = instructor.id;
            const sportLabel = instructor.sport_type === 'ski' ? 'Лыжи' : instructor.sport_type === 'snowboard' ? 'Сноуборд' : 'Оба';
            option.textContent = `${instructor.full_name} (${sportLabel})`;
            if (selectedIds.includes(instructor.id) || selectedIds.includes(String(instructor.id))) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        if (instructors.length === 0) {
            select.innerHTML = '<option value="">Нет доступных инструкторов для выбранного места и вида спорта</option>';
        }
    } catch (error) {
        console.error('Ошибка загрузки инструкторов:', error);
        const select = document.getElementById('kuliga-program-instructors');
        if (select) {
            select.innerHTML = '<option value="">Ошибка загрузки инструкторов</option>';
        }
    }
}

async function openKuligaProgramModal(programId = null) {
    const modal = document.getElementById('kuliga-program-modal');
    const title = document.getElementById('kuliga-program-modal-title');
    const submitBtn = document.getElementById('kuliga-program-submit');

    if (!modal) return;

    resetKuligaProgramForm();

    if (programId) {
        const program = kuligaPrograms.find((item) => item.id === programId);
        if (!program) return;

        title.textContent = 'Редактировать программу';
        submitBtn.textContent = 'Сохранить';

        const location = program.location || 'kuliga';
        
        document.getElementById('kuliga-program-id').value = program.id;
        document.getElementById('kuliga-program-name').value = program.name || '';
        document.getElementById('kuliga-program-description').value = program.description || '';
        document.getElementById('kuliga-program-sport').value = program.sport_type || 'ski';
        document.getElementById('kuliga-program-location').value = location;
        document.getElementById('kuliga-program-max-participants').value = program.max_participants || 4;
        document.getElementById('kuliga-program-training-duration').value = program.training_duration || 90;
        document.getElementById('kuliga-program-warmup-duration').value = program.warmup_duration || 30;
        document.getElementById('kuliga-program-equipment').checked = Boolean(program.equipment_provided);
        document.getElementById('kuliga-program-skipass').checked = Boolean(program.skipass_provided);
        document.getElementById('kuliga-program-price').value = Number(program.price || 1700).toFixed(0);
        document.getElementById('kuliga-program-active').checked = Boolean(program.is_active);

        setSelectedWeekdays(program.weekdays || []);
        setProgramTimeslots(program.time_slots || []);
        
        // Загружаем назначенных инструкторов
        const sportType = program.sport_type || 'ski';
        const selectedInstructorIds = program.instructor_ids || [];
        await loadInstructorsForProgram(location, sportType, selectedInstructorIds);
    } else {
        title.textContent = 'Создать программу';
        submitBtn.textContent = 'Создать';
        document.getElementById('kuliga-program-id').value = '';
        
        // Загружаем инструкторов для выбранного места по умолчанию
        await loadInstructorsForProgram('kuliga', 'ski', []);
    }

    // Обновляем список инструкторов при изменении места или вида спорта
    const locationSelect = document.getElementById('kuliga-program-location');
    const sportSelect = document.getElementById('kuliga-program-sport');
    const instructorSelect = document.getElementById('kuliga-program-instructors');
    
    const updateInstructorsList = async () => {
        const currentLocation = locationSelect?.value || 'kuliga';
        const currentSport = sportSelect?.value || 'ski';
        const selectedIds = Array.from(instructorSelect?.selectedOptions || [])
            .map(opt => parseInt(opt.value, 10))
            .filter(id => !isNaN(id));
        await loadInstructorsForProgram(currentLocation, currentSport, selectedIds);
    };
    
    if (locationSelect) {
        locationSelect.onchange = updateInstructorsList;
    }
    if (sportSelect) {
        sportSelect.onchange = updateInstructorsList;
    }

    modal.style.display = 'flex';
    setupKuligaProgramFormInteractions();
}

function closeKuligaProgramModal() {
    const modal = document.getElementById('kuliga-program-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

window.openKuligaProgramModal = openKuligaProgramModal;
window.closeKuligaProgramModal = closeKuligaProgramModal;

async function handleKuligaProgramSubmit(event) {
    event.preventDefault();

    const programId = document.getElementById('kuliga-program-id').value;
    const isEdit = Boolean(programId);

    const weekdays = getSelectedWeekdays();
    const timeSlots = getProgramTimeslots();

    if (!weekdays.length) {
        alert('Выберите хотя бы один день недели');
        return;
    }

    if (!timeSlots.length) {
        alert('Добавьте хотя бы один временной слот');
        return;
    }

    const trainingDuration = parseInt(document.getElementById('kuliga-program-training-duration').value, 10);
    const warmupDuration = parseInt(document.getElementById('kuliga-program-warmup-duration').value, 10);

    if (warmupDuration > trainingDuration) {
        alert('Время разминки не может превышать время тренировки');
        return;
    }

    // Получаем выбранных инструкторов
    const instructorSelect = document.getElementById('kuliga-program-instructors');
    const selectedInstructorIds = Array.from(instructorSelect.selectedOptions)
        .map(opt => parseInt(opt.value, 10))
        .filter(id => !isNaN(id));
    
    if (selectedInstructorIds.length === 0) {
        alert('Выберите хотя бы одного инструктора для программы');
        return;
    }

    const payload = {
        name: document.getElementById('kuliga-program-name').value.trim(),
        description: document.getElementById('kuliga-program-description').value.trim(),
        sportType: document.getElementById('kuliga-program-sport').value,
        location: document.getElementById('kuliga-program-location').value || 'kuliga',
        maxParticipants: parseInt(document.getElementById('kuliga-program-max-participants').value, 10),
        trainingDuration,
        warmupDuration,
        weekdays,
        timeSlots,
        equipmentProvided: document.getElementById('kuliga-program-equipment').checked,
        skipassProvided: document.getElementById('kuliga-program-skipass').checked,
        price: parseFloat(document.getElementById('kuliga-program-price').value) || 1700,
        isActive: document.getElementById('kuliga-program-active').checked,
        instructorIds: selectedInstructorIds,
    };

    if (!payload.name) {
        alert('Укажите название программы');
        return;
    }

    if (!['ski', 'snowboard', 'both'].includes(payload.sportType)) {
        alert('Выберите корректный вид спорта');
        return;
    }

    try {
        const url = isEdit ? `${KULIGA_API.programs}/${programId}` : KULIGA_API.programs;
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
            throw new Error(data.error || 'Не удалось сохранить программу');
        }

        alert(isEdit ? 'Программа успешно обновлена' : 'Программа успешно создана');
        closeKuligaProgramModal();
        loadKuligaPrograms();
    } catch (error) {
        console.error('Ошибка сохранения программы Кулиги:', error);
        alert(error.message || 'Не удалось сохранить программу');
    }
}

async function toggleKuligaProgramStatus(programId, nextStatus) {
    const isActive = nextStatus === 'true';
    const action = isActive ? 'активировать' : 'деактивировать';

    if (!confirm(`Вы уверены, что хотите ${action} эту программу?`)) return;

    try {
        const response = await fetch(`${KULIGA_API.programs}/${programId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
            },
            body: JSON.stringify({ isActive }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Не удалось обновить статус программы');
        }

        loadKuligaPrograms();
    } catch (error) {
        console.error('Ошибка изменения статуса программы Кулиги:', error);
        alert(error.message || 'Не удалось изменить статус программы');
    }
}

window.toggleKuligaProgramStatus = toggleKuligaProgramStatus;

async function deleteKuligaProgram(programId) {
    if (!confirm('Удалить программу? Это действие нельзя отменить.')) return;

    try {
        const response = await fetch(`${KULIGA_API.programs}/${programId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Не удалось удалить программу');
        }

        loadKuligaPrograms();
    } catch (error) {
        console.error('Ошибка удаления программы Кулиги:', error);
        alert(error.message || 'Не удалось удалить программу');
    }
}

window.deleteKuligaProgram = deleteKuligaProgram;

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
                            (item) => {
                                const locationName = item.location === 'vorona' ? 'Воронинские горки' : 'Кулига';
                                return `
                        <tr>
                            <td>${item.instructor_name} (${locationName})</td>
                            <td>${item.trainings_count || 0}</td>
                            <td>${Number(item.total_amount || 0).toLocaleString('ru-RU')}</td>
                            <td>${item.admin_percentage || 0}%</td>
                            <td>${Number(item.admin_revenue || 0).toLocaleString('ru-RU')}</td>
                            <td>${Number(item.instructor_revenue || 0).toLocaleString('ru-RU')}</td>
                        </tr>
                    `;
                            }
                        )
                        .join('')}
                </tbody>
            </table>
        `;
    } else {
        detailsContainer.innerHTML = '<p style="text-align:center;color:#999;margin-top:24px;">Нет данных за выбранный период</p>';
    }
}

