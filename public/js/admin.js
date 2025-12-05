// Admin.js загружен

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

// Текущий выбранный тип расписания (по умолчанию тренажер)
let currentScheduleType = 'simulator';

// Переключение типа расписания (определяем глобально ДО загрузки DOM)
window.switchScheduleType = function(slopeType) {
    currentScheduleType = slopeType;
    
    // Обновляем активные вкладки
    const tabs = document.querySelectorAll('.schedule-tab');
    tabs.forEach(tab => {
        if (tab.dataset.slopeType === slopeType) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Перезагружаем расписание для выбранного типа
    loadSchedule();
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('Инициализация админской панели...');
    
    initializeNavigation();
    initializeDatePicker();
    loadPageContent(currentPage);
    initializeEventListeners();
    
    // Обработчики событий для поиска и сортировки клиентов
    const searchInput = document.getElementById('clientSearch');
    const sortSelect = document.getElementById('clientSort');
    if (searchInput) {
        searchInput.addEventListener('input', displayClients);
    }
    if (sortSelect) {
        sortSelect.addEventListener('change', displayClients);
    }
    
    // Обработчик для верхней кнопки "Уволенные тренеры"
    const topDismissedBtn = document.getElementById('view-dismissed');
    if (topDismissedBtn) {
        topDismissedBtn.addEventListener('click', async function() {
            console.log('[top button] Кнопка "Уволенные тренеры" (верхняя) нажата');
            try {
                // Загружаем оба типа уволенных тренеров
                const [trainersResponse, kuligaResponse] = await Promise.all([
                    fetch('/api/trainers'),
                    fetch('/api/kuliga/admin/instructors?status=inactive', {
                        headers: {
                            'Authorization': `Bearer ${getCookie('adminToken')}`
                        }
                    })
                ]);
                
                const trainers = await trainersResponse.json();
                const kuligaResult = await kuligaResponse.json();
                const kuligaInstructors = kuligaResult.data || kuligaResult || [];
                
                const dismissedTrainers = trainers.filter(tr => !tr.is_active);
                const dismissedKuligaInstructors = kuligaInstructors.filter(inst => !inst.is_active);
                
                showDismissedTrainersModal(dismissedTrainers, dismissedKuligaInstructors);
            } catch (error) {
                console.error('Ошибка загрузки уволенных тренеров:', error);
                showError('Не удалось загрузить список уволенных тренеров');
            }
        });
    }
    
    // Инициализируем функционал пополнения кошелька
    initializeWalletRefill();
    
    console.log('Инициализация админской панели завершена');
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
    // Обработчики для вкладок расписания
    const scheduleTabSimulator = document.getElementById('schedule-tab-simulator');
    const scheduleTabNatural = document.getElementById('schedule-tab-natural');
    if (scheduleTabSimulator) {
        scheduleTabSimulator.addEventListener('click', () => switchScheduleType('simulator'));
    }
    if (scheduleTabNatural) {
        scheduleTabNatural.addEventListener('click', () => switchScheduleType('natural_slope'));
    }
    
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
    
    // Обработчик для кнопки создания инструктора Кулиги
    const createKuligaInstructorBtn = document.getElementById('create-kuliga-instructor');
    if (createKuligaInstructorBtn) {
        createKuligaInstructorBtn.addEventListener('click', () => {
            showCreateKuligaInstructorModal();
        });
    }
    
    // Обработчики переключения вкладок тренеров
    // Используем делегирование событий только для страницы тренеров
    const trainersPage = document.getElementById('trainers-page');
    if (trainersPage) {
        trainersPage.addEventListener('click', (e) => {
            // Проверяем, что клик именно на вкладке, а не на дочернем элементе
            const tab = e.target.closest('.trainer-tab');
            if (tab) {
                e.preventDefault();
                e.stopPropagation();
                const type = tab.dataset.trainerType;
                console.log('[trainer-tab] Переключение на вкладку:', type);
                
                // Обновляем активную вкладку
                const trainerTabs = document.querySelectorAll('.trainer-tab');
                trainerTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.borderBottom = '3px solid transparent';
                });
                tab.classList.add('active');
                tab.style.borderBottom = '3px solid #007bff';
                
                // Загружаем соответствующий тип тренеров
                if (type === 'simulator') {
                    console.log('[trainer-tab] Загрузка тренеров тренажёра...');
                    loadTrainers();
                } else if (type === 'kuliga') {
                    console.log('[trainer-tab] Загрузка инструкторов Кулиги...');
                    loadKuligaInstructorsForTrainersPage();
                } else {
                    console.warn('[trainer-tab] Неизвестный тип тренера:', type);
                }
            }
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
                <div class="modal-content" style="max-width: 700px;">
                    <h3>📝 Отправка сообщения клиентам</h3>
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
                            <label for="notify-client-search-input">Выберите пользователя:</label>
                            <div id="notify-client-search-wrapper" style="position: relative !important; z-index: 1000;">
                                <input type="text" id="notify-client-search-input" class="form-control" placeholder="Введите ФИО, телефон или номер кошелька..." autocomplete="off">
                                <input type="hidden" id="notify-client-select" name="client_id">
                                <div id="notify-client-search-results" class="search-results" style="display: none; position: absolute; top: 100%; left: 0; right: 0; width: 100%; background: white; border: 1px solid #ccc; border-top: none; max-height: 200px; overflow-y: auto; z-index: 10001 !important; border-radius: 0 0 4px 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-top: 0; padding: 0;"></div>
                            </div>
                        </div>
                        
                        <div id="group-select-container" class="form-group" style="display: none;">
                            <label for="group-select">Выберите тренировку:</label>
                            <select id="group-select" class="form-control">
                                <option value="">Загрузка...</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="schedule-message" style="margin-right: 8px;">
                                ⏰ Отложенная отправка
                            </label>
                        </div>

                        <div id="schedule-datetime-container" class="form-group" style="display: none;">
                            <label for="schedule-datetime">Дата и время отправки (Азия/Екатеринбург):</label>
                            <input type="datetime-local" id="schedule-datetime" class="form-control">
                            <small style="color: #666; font-size: 12px;">Сообщение будет отправлено в указанное время</small>
                        </div>

                        <div class="form-group">
                            <label for="notify-message">Сообщение:</label>
                            
                            <!-- Панель инструментов форматирования -->
                            <div class="formatting-toolbar" style="margin-bottom: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
                                <button type="button" class="format-btn" data-format="bold" title="Жирный (Ctrl+B)" style="padding: 6px 10px; border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer; font-weight: bold;">B</button>
                                <button type="button" class="format-btn" data-format="italic" title="Курсив (Ctrl+I)" style="padding: 6px 10px; border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer; font-style: italic;">I</button>
                                <button type="button" class="format-btn" data-format="strikethrough" title="Зачеркнутый" style="padding: 6px 10px; border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer; text-decoration: line-through;">S</button>
                                <button type="button" class="format-btn" data-format="code" title="Моноширинный" style="padding: 6px 10px; border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer; font-family: monospace;">&lt;/&gt;</button>
                                <button type="button" class="format-btn" data-format="underline" title="Подчеркнутый" style="padding: 6px 10px; border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer; text-decoration: underline;">U</button>
                            </div>
                            
                            <textarea id="notify-message" class="form-control" rows="6" placeholder="Введите сообщение... Используйте кнопки форматирования выше или Markdown: *жирный*, _курсив_, ~зачеркнутый~, \`моноширинный\`" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; white-space: pre-wrap;"></textarea>
                            
                            <!-- Счетчик символов и предупреждение -->
                            <div id="message-info" style="margin-top: 8px; font-size: 13px;">
                                <div id="char-counter" style="color: #666; margin-bottom: 4px;">
                                    <span id="char-count">0</span> / <span id="char-limit">4096</span> символов
                                </div>
                                <div id="two-messages-warning" style="display: none; padding: 8px 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; color: #856404; margin-top: 4px;">
                                    <!-- Содержимое будет обновлено динамически -->
                                </div>
                            </div>
                            
                            <!-- Расширенная панель эмодзи с категориями -->
                            <div style="margin-top: 8px;">
                                <div class="emoji-categories" style="display: flex; gap: 4px; margin-bottom: 4px; border-bottom: 1px solid #ddd; padding-bottom: 4px;">
                                    <button type="button" class="emoji-category-btn active" data-category="all" style="padding: 4px 8px; border: none; background: #e3f2fd; border-radius: 3px; cursor: pointer; font-size: 12px;">Все</button>
                                    <button type="button" class="emoji-category-btn" data-category="celebration" style="padding: 4px 8px; border: none; background: transparent; border-radius: 3px; cursor: pointer; font-size: 12px;">🎉 Праздники</button>
                                    <button type="button" class="emoji-category-btn" data-category="emotions" style="padding: 4px 8px; border: none; background: transparent; border-radius: 3px; cursor: pointer; font-size: 12px;">😊 Эмоции</button>
                                    <button type="button" class="emoji-category-btn" data-category="warnings" style="padding: 4px 8px; border: none; background: transparent; border-radius: 3px; cursor: pointer; font-size: 12px;">⚠️ Предупреждения</button>
                                    <button type="button" class="emoji-category-btn" data-category="sport" style="padding: 4px 8px; border: none; background: transparent; border-radius: 3px; cursor: pointer; font-size: 12px;">🎿 Спорт</button>
                                </div>
                                <div id="emoji-panel" class="emoji-panel" style="max-height: 120px; overflow-y: auto; padding: 4px; background: #fafafa; border-radius: 4px;">
                                    <!-- Праздники и поздравления -->
                                    <button type="button" class="emoji-btn" data-category="celebration">🎉</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🎊</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🎈</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🎁</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🎂</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🍰</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🎄</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🎅</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🌟</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">✨</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">💫</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🍾</button>
                                    <button type="button" class="emoji-btn" data-category="celebration">🥂</button>
                                    
                                    <!-- Эмоции позитивные -->
                                    <button type="button" class="emoji-btn" data-category="emotions">😊</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😄</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😀</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😃</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😁</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😍</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">🥰</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😎</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">🤗</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">👍</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">👌</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">🤙</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">✌️</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">🤝</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">🙏</button>
                                    
                                    <!-- Эмоции негативные/печальные -->
                                    <button type="button" class="emoji-btn" data-category="emotions">😢</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😔</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😞</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😟</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😕</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">🙁</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😤</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">😠</button>
                                    <button type="button" class="emoji-btn" data-category="emotions">👎</button>
                                    
                                    <!-- Предупреждения и восклицательные -->
                                    <button type="button" class="emoji-btn" data-category="warnings">⚠️</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">🚨</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">⛔</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">🔔</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">📢</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">📣</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">❗</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">‼️</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">❓</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">❔</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">💥</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">⚡</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">🔥</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">✅</button>
                                    <button type="button" class="emoji-btn" data-category="warnings">❌</button>
                                    
                                    <!-- Спорт -->
                                    <button type="button" class="emoji-btn" data-category="sport">🎿</button>
                                    <button type="button" class="emoji-btn" data-category="sport">⛷️</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🏂</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🏆</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🥇</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🥈</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🥉</button>
                                    <button type="button" class="emoji-btn" data-category="sport">💪</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🎯</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🏔️</button>
                                    <button type="button" class="emoji-btn" data-category="sport">❄️</button>
                                    <button type="button" class="emoji-btn" data-category="sport">⛄</button>
                                    <button type="button" class="emoji-btn" data-category="sport">🌨️</button>
                                    
                                    <!-- Общие -->
                                    <button type="button" class="emoji-btn" data-category="common">👋</button>
                                    <button type="button" class="emoji-btn" data-category="common">💰</button>
                                    <button type="button" class="emoji-btn" data-category="common">💳</button>
                                    <button type="button" class="emoji-btn" data-category="common">💵</button>
                                    <button type="button" class="emoji-btn" data-category="common">📅</button>
                                    <button type="button" class="emoji-btn" data-category="common">📆</button>
                                    <button type="button" class="emoji-btn" data-category="common">⏰</button>
                                    <button type="button" class="emoji-btn" data-category="common">🕐</button>
                                    <button type="button" class="emoji-btn" data-category="common">👥</button>
                                    <button type="button" class="emoji-btn" data-category="common">👤</button>
                                    <button type="button" class="emoji-btn" data-category="common">👨‍🏫</button>
                                    <button type="button" class="emoji-btn" data-category="common">📱</button>
                                    <button type="button" class="emoji-btn" data-category="common">📞</button>
                                    <button type="button" class="emoji-btn" data-category="common">📍</button>
                                    <button type="button" class="emoji-btn" data-category="common">🌈</button>
                                    <button type="button" class="emoji-btn" data-category="common">🌞</button>
                                    <button type="button" class="emoji-btn" data-category="common">🎁</button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Загрузка медиа -->
                        <div class="form-group">
                            <label>Медиа (фото/видео):</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="file" id="media-upload" accept="image/*,video/*" style="display: none;">
                                <button type="button" id="upload-photo-btn" class="btn-secondary" style="padding: 8px 12px;">📷 Добавить фото</button>
                                <button type="button" id="upload-video-btn" class="btn-secondary" style="padding: 8px 12px;">🎥 Добавить видео</button>
                            </div>
                            <div id="media-preview" style="margin-top: 8px; display: none;">
                                <div style="position: relative; display: inline-block;">
                                    <img id="media-preview-img" style="max-width: 200px; max-height: 200px; display: none; border-radius: 4px; border: 1px solid #ddd;">
                                    <video id="media-preview-video" controls style="max-width: 200px; max-height: 200px; display: none; border-radius: 4px; border: 1px solid #ddd;"></video>
                                    <button type="button" id="remove-media-btn" style="position: absolute; top: 4px; right: 4px; background: red; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: none;">✕</button>
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Предпросмотр:</label>
                            <div id="notify-preview" class="preview-box" style="white-space: pre-wrap; padding: 12px; background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; min-height: 60px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;"></div>
                        </div>
                        
                        <div class="modal-actions">
                            <button type="submit" class="btn-primary">📤 Отправить</button>
                            <button type="button" class="btn-secondary" id="close-notify-modal">Отмена</button>
                        </div>
                    </form>
                </div>
            `;

            // Инициализируем обработчики после обновления HTML
            initializeNotifyModalHandlers();
            
            // Явно блокируем закрытие модального окна при клике вне его
            // Это предотвращает случайное закрытие во время отправки сообщений с медиа
            // Используем capture phase для перехвата события раньше других обработчиков
            notifyModal.addEventListener('click', function blockModalClose(e) {
                // Предотвращаем закрытие при клике на фон модального окна
                if (e.target === notifyModal) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    return false;
                }
            }, true); // capture phase - перехватываем до других обработчиков
            
            // Также блокируем на уровне bubbling
            notifyModal.addEventListener('click', function blockModalCloseBubble(e) {
                if (e.target === notifyModal) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    return false;
                }
            }, false); // bubbling phase
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
        const groupSelect = modal.querySelector('#group-select');
        const messageInput = modal.querySelector('#notify-message');
        const previewBox = modal.querySelector('#notify-preview');
        const emojiPanel = modal.querySelector('#emoji-panel');
        const closeButton = modal.querySelector('#close-notify-modal');
        const formatButtons = modal.querySelectorAll('.format-btn');
        const emojiCategoryButtons = modal.querySelectorAll('.emoji-category-btn');
        const mediaUploadInput = modal.querySelector('#media-upload');
        const uploadPhotoBtn = modal.querySelector('#upload-photo-btn');
        const uploadVideoBtn = modal.querySelector('#upload-video-btn');
        const mediaPreviewContainer = modal.querySelector('#media-preview');
        const mediaPreviewImg = modal.querySelector('#media-preview-img');
        const mediaPreviewVideo = modal.querySelector('#media-preview-video');
        const removeMediaBtn = modal.querySelector('#remove-media-btn');

        if (!form || !recipientTypeSelect || !messageInput || !previewBox || !emojiPanel) {
            console.error('Не найдены необходимые элементы формы');
            return;
        }

        // Переменная для хранения загруженного медиа
        let uploadedMediaFile = null;
        let uploadedMediaType = null;

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
            if (type === 'client') {
                // Инициализируем поиск клиентов (с задержкой, чтобы элементы успели отрендериться)
                setTimeout(() => {
                    initClientSearch();
                }, 150);
            } else if (type === 'group' && groupSelect && groupSelect.options.length <= 1) {
                loadGroupsForSelect();
            }
        });

        // Обработчик для отложенной отправки
        const scheduleCheckbox = modal.querySelector('#schedule-message');
        const scheduleContainer = modal.querySelector('#schedule-datetime-container');
        const scheduleDatetime = modal.querySelector('#schedule-datetime');
        
        if (scheduleCheckbox && scheduleContainer && scheduleDatetime) {
            // Устанавливаем минимальное значение (текущее время)
            const now = new Date();
            const timezoneOffset = now.getTimezoneOffset() * 60000; // в миллисекундах
            const localTime = new Date(now.getTime() - timezoneOffset);
            const localISOTime = localTime.toISOString().slice(0, 16);
            scheduleDatetime.min = localISOTime;
            
            scheduleCheckbox.addEventListener('change', () => {
                if (scheduleCheckbox.checked) {
                    scheduleContainer.style.display = 'block';
                    scheduleDatetime.setAttribute('required', 'required');
                    // Устанавливаем значение по умолчанию (через час)
                    const oneHourLater = new Date(now.getTime() + 60 * 60000);
                    const oneHourLaterISO = new Date(oneHourLater.getTime() - timezoneOffset).toISOString().slice(0, 16);
                    scheduleDatetime.value = oneHourLaterISO;
                } else {
                    scheduleContainer.style.display = 'none';
                    scheduleDatetime.removeAttribute('required');
                    scheduleDatetime.value = '';
                }
            });
        }

        // Обработчики кнопок форматирования
        formatButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const format = btn.dataset.format;
                applyFormatting(format);
            });
        });

        // Функция применения форматирования
        function applyFormatting(format) {
            const start = messageInput.selectionStart;
            const end = messageInput.selectionEnd;
            const selectedText = messageInput.value.substring(start, end);
            const textBefore = messageInput.value.substring(0, start);
            const textAfter = messageInput.value.substring(end);
            
            let formattedText = '';
            switch(format) {
                case 'bold':
                    formattedText = `*${selectedText || 'текст'}*`;
                    break;
                case 'italic':
                    formattedText = `_${selectedText || 'текст'}_`;
                    break;
                case 'strikethrough':
                    formattedText = `~${selectedText || 'текст'}~`;
                    break;
                case 'code':
                    formattedText = `\`${selectedText || 'текст'}\``;
                    break;
                case 'underline':
                    formattedText = `<u>${selectedText || 'текст'}</u>`;
                    break;
            }
            
            messageInput.value = textBefore + formattedText + textAfter;
            messageInput.focus();
            
            // Позиционируем курсор после вставленного текста
            const newPos = start + formattedText.length;
            messageInput.setSelectionRange(newPos, newPos);
            
            // Обновляем предпросмотр и счетчик
            updatePreview();
            updateCharCounter();
        }

        // Обработчики категорий эмодзи
        emojiCategoryButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Убираем активный класс со всех кнопок
                emojiCategoryButtons.forEach(b => {
                    b.classList.remove('active');
                    b.style.background = 'transparent';
                });
                
                // Добавляем активный класс к нажатой кнопке
                btn.classList.add('active');
                btn.style.background = '#e3f2fd';
                
                // Фильтруем эмодзи по категории
                const category = btn.dataset.category;
                const allEmojiBtns = emojiPanel.querySelectorAll('.emoji-btn');
                
                allEmojiBtns.forEach(emojiBtn => {
                    if (category === 'all') {
                        emojiBtn.style.display = 'inline-block';
                    } else {
                        const emojiCategory = emojiBtn.dataset.category;
                        emojiBtn.style.display = emojiCategory === category ? 'inline-block' : 'none';
                    }
                });
            });
        });

        // Обработчик ввода текста сообщения
        messageInput.addEventListener('input', () => {
            updatePreview();
            updateCharCounter();
        });

        // Функция обновления счетчика символов и предупреждения
        function updateCharCounter() {
            const charCountElement = document.getElementById('char-count');
            const charLimitElement = document.getElementById('char-limit');
            const charCounterElement = document.getElementById('char-counter');
            const warningElement = document.getElementById('two-messages-warning');
            
            if (!charCountElement || !charCounterElement) {
                return;
            }
            
            const text = messageInput.value;
            const charCount = text.length;
            
            // Определяем лимит в зависимости от наличия медиа
            const TELEGRAM_CAPTION_MAX_LENGTH = 1024; // для медиа-файлов (caption)
            const TELEGRAM_TEXT_MAX_LENGTH = 4096; // для текстовых сообщений (без медиа)
            
            const hasMedia = !!uploadedMediaFile;
            const maxLength = hasMedia ? TELEGRAM_CAPTION_MAX_LENGTH : TELEGRAM_TEXT_MAX_LENGTH;
            
            // Обновляем счетчик символов
            charCountElement.textContent = charCount;
            
            // Обновляем лимит
            if (charLimitElement) {
                charLimitElement.textContent = maxLength;
            }
            
            // Изменяем цвет в зависимости от количества символов
            if (charCount > maxLength) {
                charCounterElement.style.color = '#dc3545'; // красный - превышен лимит
                charCountElement.style.fontWeight = 'bold';
            } else if (charCount > maxLength * 0.8) {
                charCounterElement.style.color = '#ff9800'; // оранжевый (предупреждение - близко к лимиту)
                charCountElement.style.fontWeight = 'normal';
            } else {
                charCounterElement.style.color = '#666'; // серый (норма)
                charCountElement.style.fontWeight = 'normal';
            }
            
            // Показываем предупреждение о двух сообщениях только если:
            // 1. Есть загруженный медиа-файл
            // 2. Текст > 1024 символов (лимит для caption)
            if (warningElement) {
                if (hasMedia && charCount > TELEGRAM_CAPTION_MAX_LENGTH) {
                    warningElement.style.display = 'block';
                    warningElement.innerHTML = `
                        <strong>⚠️ Внимание:</strong> Текст превышает лимит для подписи к медиа (1024 символа). 
                        Будет отправлено <strong>2 сообщения</strong>: сначала медиа без подписи, затем текст отдельным сообщением.
                    `;
                } else {
                    warningElement.style.display = 'none';
                }
            }
        }

        // Функция обновления предпросмотра
        function updatePreview() {
            let text = messageInput.value;
            // Преобразуем Markdown в простой текст для предпросмотра
            // Жирный: *текст* -> <b>текст</b>
            text = text.replace(/\*([^\*]+)\*/g, '<b>$1</b>');
            // Курсив: _текст_ -> <i>текст</i>
            text = text.replace(/_([^_]+)_/g, '<i>$1</i>');
            // Зачеркнутый: ~текст~ -> <s>текст</s>
            text = text.replace(/~([^~]+)~/g, '<s>$1</s>');
            // Моноширинный: `текст` -> <code>текст</code>
            text = text.replace(/`([^`]+)`/g, '<code style="background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>');
            // Подчеркнутый уже в формате HTML
            
            previewBox.innerHTML = text;
        }
        
        // Инициализируем счетчик при загрузке
        updateCharCounter();

        // Обработчики эмодзи
        emojiPanel.addEventListener('click', (event) => {
            if (event.target.classList.contains('emoji-btn')) {
                const emoji = event.target.textContent;
                const cursorPos = messageInput.selectionStart;
                const text = messageInput.value;
                messageInput.value = text.slice(0, cursorPos) + emoji + text.slice(cursorPos);
                messageInput.focus();
                messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
                updatePreview();
                updateCharCounter();
            }
        });

        // Обработчики загрузки медиа
        uploadPhotoBtn.addEventListener('click', () => {
            mediaUploadInput.accept = 'image/*';
            mediaUploadInput.click();
        });

        uploadVideoBtn.addEventListener('click', () => {
            mediaUploadInput.accept = 'video/*';
            mediaUploadInput.click();
        });

        mediaUploadInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            uploadedMediaFile = file;
            uploadedMediaType = file.type.startsWith('image/') ? 'photo' : 'video';

            // Показываем превью
            const reader = new FileReader();
            reader.onload = (e) => {
                if (uploadedMediaType === 'photo') {
                    mediaPreviewImg.src = e.target.result;
                    mediaPreviewImg.style.display = 'block';
                    mediaPreviewVideo.style.display = 'none';
                } else {
                    mediaPreviewVideo.src = e.target.result;
                    mediaPreviewVideo.style.display = 'block';
                    mediaPreviewImg.style.display = 'none';
                }
                mediaPreviewContainer.style.display = 'block';
                removeMediaBtn.style.display = 'block';
                
                // Обновляем предупреждение после загрузки медиа
                updateCharCounter();
            };
            reader.readAsDataURL(file);
        });

        // Удаление медиа
        removeMediaBtn.addEventListener('click', () => {
            uploadedMediaFile = null;
            uploadedMediaType = null;
            mediaUploadInput.value = '';
            mediaPreviewImg.src = '';
            mediaPreviewVideo.src = '';
            mediaPreviewImg.style.display = 'none';
            mediaPreviewVideo.style.display = 'none';
            mediaPreviewContainer.style.display = 'none';
            removeMediaBtn.style.display = 'none';
            
            // Обновляем предупреждение после удаления медиа
            updateCharCounter();
        });

        // Обработчик отправки формы (модифицированный для поддержки медиа)
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleNotifyFormSubmitWithMedia(e, uploadedMediaFile, uploadedMediaType);
        });

        // Обработчик закрытия модального окна (только по кнопке "Отмена")
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                modal.style.display = 'none';
                form.reset();
                if (previewBox) previewBox.innerHTML = '';
                // Очищаем медиа
                uploadedMediaFile = null;
                uploadedMediaType = null;
                if (removeMediaBtn) removeMediaBtn.click();
                // Сбрасываем счетчик
                updateCharCounter();
            });
        }

        // УБРАНО: Закрытие по клику вне окна
        // Модальное окно теперь закрывается только по кнопке "Отмена",
        // чтобы избежать случайного закрытия во время отправки сообщений с медиа
        
        // Дополнительная защита: блокируем закрытие при клике на фон
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                return false;
            }
        }, true); // capture phase
    }

    // Глобальная переменная для хранения всех клиентов (кэшируем)
    let allClientsForNotify = [];
    let allClientsLoadedForNotify = false;
    
    // Инициализация поиска клиентов (вызывается каждый раз при открытии модального окна)
    function initClientSearch() {
        const clientSearchInput = document.getElementById('notify-client-search-input');
        const clientSearchResults = document.getElementById('notify-client-search-results');
        const clientSelect = document.getElementById('notify-client-select');
        
        if (!clientSearchInput || !clientSearchResults || !clientSelect) {
            return;
        }
        
        // Загружаем клиентов, если еще не загружены
        if (!allClientsLoadedForNotify) {
            loadAllClientsForNotify();
        }
        
        // Обработчик ввода текста (добавляем каждый раз, так как элементы пересоздаются)
        clientSearchInput.addEventListener('input', function handleClientSearchInput(e) {
            const searchTerm = e.target.value.trim().toLowerCase();
            
            if (searchTerm.length < 1) {
                clientSearchResults.style.display = 'none';
                clientSelect.value = '';
                return;
            }
            
            // Фиункция для нормализации номера кошелька (убирает дефисы и пробелы)
            const normalizeWalletNumber = (wallet) => {
                if (!wallet) return '';
                return String(wallet).replace(/[-\s]/g, '').toLowerCase();
            };
            
            const normalizedSearchTerm = normalizeWalletNumber(searchTerm);
            
            // Фильтруем клиентов
            const filteredClients = allClientsForNotify.filter(client => {
                const name = client.full_name ? client.full_name.toLowerCase() : '';
                const phone = client.phone ? client.phone.toLowerCase() : '';
                // Нормализуем номер кошелька (убираем дефисы) и ищем по нормализованному запросу
                const wallet = normalizeWalletNumber(client.wallet_number);
                return name.includes(searchTerm) || phone.includes(searchTerm) || (wallet && wallet.includes(normalizedSearchTerm));
            }).slice(0, 10); // Ограничиваем до 10 результатов
            
            if (filteredClients.length === 0) {
                clientSearchResults.innerHTML = '<div style="padding: 10px; color: #666;">Клиенты не найдены</div>';
                clientSearchResults.style.display = 'block';
                return;
            }
            
            // Отображаем результаты (используем onclick для надежности, как в рабочей версии)
            const resultsHTML = filteredClients.map(client => {
                const escapedName = client.full_name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `
                    <div class="client-search-result-item search-result-item" 
                         data-client-id="${client.id}" 
                         data-client-name="${escapedName}"
                         onclick="selectNotifyClient(${client.id}, '${escapedName}')"
                         style="padding: 10px 15px; cursor: pointer; border-bottom: 1px solid #eee; transition: background-color 0.2s; min-height: 40px; display: block; line-height: 1.4;"
                         onmouseover="this.style.backgroundColor='#f0f0f0'"
                         onmouseout="this.style.backgroundColor='white'">
                        <div style="font-weight: 500; display: block;">${client.full_name}</div>
                    </div>
                `;
            }).join('');
            
            clientSearchResults.innerHTML = resultsHTML;
            
            // Убеждаемся, что родительский контейнер имеет position: relative
            const wrapper = clientSearchResults.parentElement;
            if (wrapper) {
                wrapper.style.position = 'relative';
                wrapper.style.zIndex = '1000';
            }
            
            // Устанавливаем стили для отображения
            clientSearchResults.style.display = 'block';
            clientSearchResults.style.position = 'absolute';
            clientSearchResults.style.top = '100%';
            clientSearchResults.style.left = '0';
            clientSearchResults.style.right = '0';
            clientSearchResults.style.width = '100%';
            clientSearchResults.style.background = 'white';
            clientSearchResults.style.border = '1px solid #ccc';
            clientSearchResults.style.borderTop = 'none';
            clientSearchResults.style.maxHeight = '200px';
            clientSearchResults.style.overflowY = 'auto';
            clientSearchResults.style.zIndex = '10001';
            clientSearchResults.style.borderRadius = '0 0 4px 4px';
            clientSearchResults.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            clientSearchResults.style.visibility = 'visible';
            clientSearchResults.style.opacity = '1';
        });
        
        // Скрываем результаты при клике вне области
        const handleDocumentClick = (e) => {
            const wrapper = document.getElementById('notify-client-search-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                const results = document.getElementById('notify-client-search-results');
                if (results) results.style.display = 'none';
            }
        };
        // Удаляем старый обработчик и добавляем новый
        document.removeEventListener('click', handleDocumentClick);
        document.addEventListener('click', handleDocumentClick);
        
        // Очищаем при потере фокуса, если ничего не выбрано
        clientSearchInput.addEventListener('blur', function handleClientSearchBlur() {
            setTimeout(() => {
                if (clientSelect && !clientSelect.value && clientSearchInput.value) {
                    clientSearchInput.value = '';
                }
            }, 200);
        });
    }
    
    // Глобальная функция выбора клиента (как в рабочей версии)
    window.selectNotifyClient = function(clientId, clientName) {
        const clientSearchInput = document.getElementById('notify-client-search-input');
        const clientSelect = document.getElementById('notify-client-select');
        const clientSearchResults = document.getElementById('notify-client-search-results');
        
        if (clientSearchInput) clientSearchInput.value = clientName;
        if (clientSelect) clientSelect.value = clientId;
        if (clientSearchResults) clientSearchResults.style.display = 'none';
    };
    
    // Загрузка всех клиентов для поиска
    async function loadAllClientsForNotify() {
        if (allClientsLoadedForNotify) {
            return; // Уже загружены
        }
        
        try {
            const response = await fetch('/api/clients');
            const clients = await response.json();
            // Фильтруем только уникальных клиентов без parent_id
            const seenIds = new Set();
            allClientsForNotify = clients.filter(client => {
                if (!client.parent_id && !seenIds.has(client.id)) {
                    seenIds.add(client.id);
                    return true;
                }
                return false;
            });
            allClientsLoadedForNotify = true;
        } catch (error) {
            console.error('Ошибка при загрузке списка клиентов:', error);
        }
    }
    
    // Старая функция для обратной совместимости (если используется где-то еще)
    async function loadClientsForSelect() {
        await loadAllClientsForNotify();
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

    // УБРАНО: Старые обработчики для модального окна отправки сообщений
    // Все обработчики теперь устанавливаются в функции initializeNotifyModalHandlers()
    // после перезаписи innerHTML модального окна

    // Обработчики для страницы заявок
    const archiveApplicationsBtn = document.getElementById('archive-applications');
    if (archiveApplicationsBtn) {
        archiveApplicationsBtn.addEventListener('click', () => {
            window.open('archive-applications.html', '_blank');
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

    // Обработчик для кнопки "Создать абонемент"
    const createSubscriptionBtn = document.getElementById('create-subscription-btn');
    if (createSubscriptionBtn) {
        createSubscriptionBtn.addEventListener('click', () => {
            openSubscriptionModal();
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
    
    // Отправляем событие для других скриптов
    document.dispatchEvent(new CustomEvent('pageChanged', { detail: { page } }));
    
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
            // При открытии страницы "Тренера" по умолчанию загружаем тренеров тренажёра
            const activeTab = document.querySelector('.trainer-tab.active');
            if (activeTab && activeTab.dataset.trainerType === 'kuliga') {
                await loadKuligaInstructorsForTrainersPage();
            } else {
            await loadTrainers();
            }
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
        case 'promotions':
            if (typeof loadPromotionsPage === 'function') {
                await loadPromotionsPage();
            }
            break;
        case 'subscriptions':
            if (typeof loadSubscriptionsPage === 'function') {
                await loadSubscriptionsPage();
            }
            break;
        case 'scheduled-messages':
            if (typeof loadScheduledMessagesPage === 'function') {
                await loadScheduledMessagesPage();
            } else if (typeof loadScheduledMessages === 'function') {
                await loadScheduledMessages();
            }
            break;
        case 'winter-trainings':
            if (typeof initWinterTrainingsPage === 'function') {
                initWinterTrainingsPage();
            }
            break;
        case 'analytics':
            // Аналитика загружается автоматически при открытии вкладки
            // Инициализация происходит в admin-analytics.js
            // Явно вызываем загрузку данных
            if (typeof loadAllAnalytics === 'function') {
                setTimeout(() => {
                    loadAllAnalytics();
                }, 100);
            }
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
        
        let data = await response.json();
        console.log('Полученные данные:', data);
        
        if (!data || !Array.isArray(data)) {
            console.error('Получены некорректные данные:', data);
            throw new Error('Получены некорректные данные от сервера');
        }

        // Оставляем только тренировки на тренажере (исключаем естественный склон)
        data = data.filter(t => (t.slope_type ? t.slope_type === 'simulator' : t.simulator_id != null));

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
                                    <td>${training.training_type ? (training.group_name || '-') : getEquipmentTypeName(training.equipment_type)}</td>
                                    <td>${training.trainer_full_name || 'Не указан'}</td>
                                    <td>Тренажёр ${training.simulator_id}</td>
                                    <td>${training.current_participants || 0}/${training.max_participants}</td>
                                    <td>${training.skill_level || '-'}</td>
                                    <td>${training.price != null ? training.price : '-'} ₽</td>
                                    <td class="training-actions">
                                        <button class="btn-secondary" onclick="viewTrainingDetails(${training.id})">
                                            Подробнее
                                        </button>
                                        <button class="btn-secondary" onclick="showEditTrainingModal(${JSON.stringify(training).replace(/"/g, '&quot;')})">
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

// Функция для перевода типа снаряжения в читаемый вид
function getEquipmentTypeName(equipmentType) {
    if (!equipmentType) return '-';
    switch (equipmentType.toLowerCase()) {
        case 'ski': return 'Лыжи';
        case 'snowboard': return 'Сноуборд';
        default: return equipmentType;
    }
}

// Загрузка расписания
async function loadSchedule() {
    try {
        // Загружаем данные только для выбранного типа расписания
        const response = await fetch(`/api/schedule/admin?slope_type=${currentScheduleType}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log(`Полученные данные для ${currentScheduleType}:`, data);

        const scheduleList = document.querySelector('.schedule-list');
        if (!scheduleList) {
            console.error('Элемент .schedule-list не найден на странице');
            return;
        }

        // Формируем HTML для выбранной секции
        let html = '<div class="schedule-section">';
        const title = currentScheduleType === 'simulator' 
            ? '🏔️ Горнолыжный тренажер' 
            : '🎿 Естественный склон';
        html += `<h3 class="schedule-section-title">${title}</h3>`;
        html += await renderScheduleSection(data, currentScheduleType);
        html += '</div>';

        scheduleList.innerHTML = html;
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        showError('Не удалось загрузить расписание');
    }
}

// Рендеринг секции расписания
async function renderScheduleSection(data, slopeType) {
    if (!data || !Array.isArray(data)) {
        console.error('Получены некорректные данные:', data);
        return '<div class="alert alert-danger">Ошибка загрузки данных</div>';
    }

    if (data.length === 0) {
        return '<div class="alert alert-info">Нет доступных тренировок на ближайшие 7 дней</div>';
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
        html += `<div class="schedule-date-group">
            <div class="schedule-date-header">${formatDateWithWeekday(date)}</div>
            <div class="training-table-container">
                <table class="training-table">
                    <thead>
                        <tr>
                            ${slopeType === 'simulator' ? 
                                `<th>Время</th>
                                <th>Тип</th>
                                <th>Название</th>
                                <th>Тренер</th>
                                <th>Тренажёр</th>
                                <th>Участников</th>
                                <th>Уровень</th>
                                <th>Цена</th>
                                <th>Действия</th>` :
                                `<th>Время</th>
                                <th>Тип</th>
                                <th>Участник</th>
                                <th>Тренер</th>
                                <th>Участников</th>
                                <th>Цена</th>
                                <th>Действия</th>`
                            }
                        </tr>
                    </thead>
                    <tbody>
                        ${grouped[date].map(training => `
                            <tr class="training-row ${training.simulator_id === 2 ? 'simulator-2' : ''}">
                                <td>${training.start_time.slice(0,5)} - ${training.end_time.slice(0,5)}</td>
                                <td>${training.is_individual ? 'Индивидуальная' : 'Групповая'}</td>
                                ${slopeType === 'simulator' ? 
                                    `<td>${training.is_individual ? getEquipmentTypeName(training.equipment_type) : (training.group_name || '-')}</td>
                                    <td>${training.trainer_name || 'Не указан'}</td>
                                    <td>${training.simulator_name || '-'}</td>
                                    <td>${training.is_individual ? '1/1' : `${training.current_participants}/${training.max_participants}`}</td>
                                    <td>${training.skill_level || '-'}</td>
                                    <td>${training.price} ₽</td>` :
                                    `<td>${getParticipantName(training)}</td>
                                    <td>${training.trainer_name || 'Не указан'}</td>
                                    <td>${training.is_individual ? '1/1' : `${training.current_participants}/${training.max_participants}`}</td>
                                    <td>${formatNaturalSlopePricePerPerson(training)} ₽</td>`
                                }
                                <td class="training-actions">
                                    ${training.training_source === 'kuliga' ? 
                                        `<button class="btn-secondary" onclick="viewKuligaTrainingDetails(${training.id}, '${training.kuliga_type}')">
                                            Подробнее
                                        </button>` :
                                        slopeType === 'natural_slope' ? 
                                        `<button class="btn-secondary" onclick="viewWinterTrainingDetails(${training.id})">
                                            Подробнее
                                        </button>` :
                                        `<button class="btn-secondary" onclick="viewScheduleDetails(${training.id}, ${training.is_individual}, '${slopeType}')">
                                            Подробнее
                                        </button>`
                                    }
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    });

    return html;
}

// Получение имени участника для естественного склона
function getParticipantName(training) {
    if (training.is_individual) {
        // Для индивидуальных тренировок используем participant_names из API
        return training.participant_names || 'Участник';
    } else {
        return training.group_name || '-';
    }
}

// Просмотр деталей тренировки Кулиги
window.viewKuligaTrainingDetails = async function(id, type) {
    try {
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        const response = await fetch(`/api/kuliga/admin/training/${id}?type=${type}`, {
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
        
        const training = result.data;
        
        // Форматирование даты
        function formatDate(dateString) {
            if (!dateString) return '—';
            const date = new Date(dateString);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}.${month}.${year}`;
        }
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        
        const startTime = training.start_time ? String(training.start_time).substring(0, 5) : '—';
        const endTime = training.end_time ? String(training.end_time).substring(0, 5) : '—';
        const modalTitle = type === 'group' 
            ? 'Детали групповой тренировки Кулига Парк' 
            : 'Детали индивидуальной тренировки Кулига Парк';
        
        let modalContent = `
            <div class="modal-content" style="max-width: 600px;">
                <span class="close" onclick="this.closest('.modal').remove()" style="float: right; font-size: 28px; font-weight: bold; cursor: pointer;">&times;</span>
                <h3>${modalTitle}</h3>
                <div class="training-details">
                    <div class="detail-group">
                        <h4>Основная информация</h4>
                        <p><strong>Дата:</strong> ${formatDate(training.date)}</p>
                        <p><strong>Время:</strong> ${startTime} - ${endTime}</p>
                        <p><strong>Тип тренировки:</strong> ${type === 'group' ? 'Групповая' : 'Индивидуальная'}</p>
                        <p><strong>Инструктор:</strong> ${training.instructor_name || 'Не указан'}</p>
        `;
        
        if (type === 'group') {
            const sportTypeName = training.sport_type === 'ski' ? 'Горные лыжи' : training.sport_type === 'snowboard' ? 'Сноуборд' : training.sport_type;
            const levelName = training.level === 'beginner' ? 'Начальный' : training.level === 'intermediate' ? 'Средний' : training.level === 'advanced' ? 'Продвинутый' : training.level;
            
            modalContent += `
                        <p><strong>Вид спорта:</strong> ${sportTypeName}</p>
                        <p><strong>Уровень подготовки:</strong> ${levelName || '—'}</p>
                        <p><strong>Участников:</strong> ${training.current_participants || 0} / ${training.max_participants || 0}</p>
                        <p><strong>Минимум участников:</strong> ${training.min_participants || 0}</p>
                        <p><strong>Цена за человека:</strong> ${training.price_per_person ? parseFloat(training.price_per_person).toFixed(2) + ' ₽' : '—'}</p>
                        <p><strong>Общая стоимость:</strong> ${training.price_per_person && training.max_participants ? (parseFloat(training.price_per_person) * training.max_participants).toFixed(2) + ' ₽' : '—'}</p>
            `;
            
            if (training.description) {
                modalContent += `<p><strong>Описание:</strong> ${training.description}</p>`;
            }
            
            modalContent += `
                    </div>
                    <div class="detail-group">
                        <h4>Участники и бронирования (${training.bookings_count || 0})</h4>
            `;
            
            if (training.bookings && training.bookings.length > 0) {
                // Показываем таблицу с участниками по каждому бронированию
                modalContent += `
                    <table class="participants-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <thead>
                            <tr style="background: #f0f0f0;">
                                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Клиент</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Участники</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Кол-во</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Сумма</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Статус</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                training.bookings.forEach((booking, index) => {
                    const statusColor = booking.status === 'confirmed' ? 'green' : booking.status === 'pending' ? 'orange' : 'gray';
                    const statusText = booking.status === 'confirmed' ? 'Подтверждено' : booking.status === 'pending' ? 'Ожидание' : booking.status;
                    
                    modalContent += `
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 8px;">
                                <strong>${booking.client_name || 'Клиент'}</strong><br>
                                <small style="color: #666;">${booking.client_phone || '—'}</small>
                            </td>
                            <td style="padding: 8px;">${booking.participants_names_str || '—'}</td>
                            <td style="padding: 8px;">${booking.participants_count || 1}</td>
                            <td style="padding: 8px;">${booking.price_total ? parseFloat(booking.price_total).toFixed(2) + ' ₽' : '—'}</td>
                            <td style="padding: 8px;">
                                <span style="color: ${statusColor}; font-weight: 500;">${statusText}</span>
                            </td>
                            <td style="padding: 8px;">
                                ${booking.status !== 'cancelled' ? `
                                    <button 
                                        class="btn-primary btn-small" 
                                        onclick="moveKuligaBookingToAnotherTraining(${training.id}, ${booking.id}, '${(booking.client_name || '').replace(/'/g, "\\'")}', '${training.sport_type}', '${training.level}')"
                                        title="Переместить на другую тренировку"
                                        style="font-size: 12px; padding: 4px 8px; margin-right: 5px;">
                                        🔄 Переместить
                                    </button>
                                    <button 
                                        class="btn-danger btn-small" 
                                        onclick="removeKuligaBooking(${training.id}, ${booking.id}, '${(booking.client_name || '').replace(/'/g, "\\'")}', 'group')"
                                        title="Удалить бронирование с возвратом средств"
                                        style="font-size: 12px; padding: 4px 8px;">
                                        ❌ Удалить
                                    </button>
                                ` : '—'}
                            </td>
                        </tr>
                    `;
                });
                
                modalContent += `
                        </tbody>
                    </table>
                `;
            } else {
                modalContent += '<p>Нет бронирований</p>';
            }
        } else {
            modalContent += `
                        <p><strong>Участники:</strong> ${training.participants_names_str || '—'}</p>
                        <p><strong>Количество участников:</strong> ${training.participants_count || 1}</p>
                        <p><strong>Вид спорта:</strong> ${training.sport_type === 'ski' ? 'Горные лыжи' : training.sport_type === 'snowboard' ? 'Сноуборд' : training.sport_type}</p>
                        <p><strong>Цена:</strong> ${training.price_total ? parseFloat(training.price_total).toFixed(2) + ' ₽' : '—'}</p>
                        <p><strong>Статус:</strong> <span style="color: ${training.status === 'confirmed' ? 'green' : training.status === 'pending' ? 'orange' : 'gray'};">${training.status === 'confirmed' ? 'Подтверждено' : training.status === 'pending' ? 'Ожидание' : training.status === 'cancelled' ? 'Отменено' : training.status || '—'}</span></p>
                    </div>
                    <div class="detail-group">
                        <h4>Информация о клиенте</h4>
                        <p><strong>Имя:</strong> ${training.client_name || '—'}</p>
                        <p><strong>Телефон:</strong> ${training.client_phone || '—'}</p>
            `;
        }
        
        modalContent += `
                    </div>
                </div>
            </div>
        `;
        
        modal.innerHTML = modalContent;
        document.body.appendChild(modal);
        
        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    } catch (error) {
        console.error('Ошибка при загрузке деталей тренировки:', error);
        alert('Ошибка при загрузке деталей тренировки: ' + error.message);
    }
};

// Форматирование цены для естественного склона: показываем цену за человека
function formatNaturalSlopePricePerPerson(training) {
    if (training.is_individual) {
        // Для индивидуальных тренировок показываем как есть
        return training.price != null ? Number(training.price).toFixed(2) : '-';
    }
    // Для групповых: делим общую стоимость на максимальное число участников
    const totalPrice = training.price != null ? Number(training.price) : null;
    const max = Number(training.max_participants) || 0;
    if (totalPrice == null || max <= 0) return '-';
    return (totalPrice / max).toFixed(2);
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

// Загрузка тренеров тренажёра
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
        if (!trainersList) {
            console.error('[loadTrainers] Элемент .trainers-list не найден');
            return;
        }
        
        console.log('[loadTrainers] Найдено тренеров:', activeTrainers.length, 'активных,', dismissedTrainers.length, 'уволенных');
        
        // Очищаем список
        trainersList.innerHTML = '';
        
            // Добавляем кнопку для просмотра уволенных тренеров
        if (dismissedTrainers.length > 0) {
            const dismissedButton = document.createElement('button');
            dismissedButton.className = 'btn-secondary';
            dismissedButton.style.marginBottom = '20px';
            dismissedButton.innerHTML = `Уволенные тренеры (${dismissedTrainers.length})`;
            dismissedButton.onclick = () => {
                console.log('[loadTrainers] Кнопка "Уволенные тренеры" нажата');
                showDismissedTrainersModal(dismissedTrainers);
            };
            trainersList.appendChild(dismissedButton);
        }
            
            // Отображаем только активных тренеров
            if (activeTrainers.length === 0) {
            const noTrainersMsg = document.createElement('div');
            noTrainersMsg.className = 'alert alert-info';
            noTrainersMsg.textContent = 'Нет активных тренеров';
            trainersList.appendChild(noTrainersMsg);
            } else {
            activeTrainers.forEach(trainer => {
                const trainerCard = document.createElement('div');
                trainerCard.className = 'trainer-item';
                trainerCard.innerHTML = `
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
                `;
                trainersList.appendChild(trainerCard);
            });
        }
        
        // В loadTrainers сохраняем dismissedTrainers глобально для диагностики
        window.lastDismissedTrainers = dismissedTrainers;
        console.log('[loadTrainers] Загрузка завершена успешно');
    } catch (error) {
        console.error('[loadTrainers] Ошибка при загрузке тренеров:', error);
        showError('Не удалось загрузить тренеров: ' + error.message);
    }
}

// Загрузка инструкторов Кулиги для страницы "Тренера"
async function loadKuligaInstructorsForTrainersPage() {
    console.log('==========================================');
    console.log('[loadKuligaInstructorsForTrainersPage] ✅ ФУНКЦИЯ ВЫЗВАНА!');
    console.log('==========================================');
    console.log('[loadKuligaInstructorsForTrainersPage] Начало загрузки инструкторов Кулиги...');
    
    const trainersList = document.querySelector('.trainers-list');
    console.log('[loadKuligaInstructorsForTrainersPage] trainersList элемент:', trainersList ? 'найден' : 'НЕ НАЙДЕН');
    
    try {
        const token = getCookie('adminToken');
        console.log('[loadKuligaInstructorsForTrainersPage] Токен:', token ? 'есть' : 'НЕТ');
        if (!token) {
            console.error('[loadKuligaInstructorsForTrainersPage] Токен не найден в cookie');
            showError('Необходима авторизация');
            return;
        }
        
        console.log('[loadKuligaInstructorsForTrainersPage] Отправка запроса на /api/kuliga/admin/instructors?status=active');
        const response = await fetch('/api/kuliga/admin/instructors?status=active', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('[loadKuligaInstructorsForTrainersPage] Получен ответ:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[loadKuligaInstructorsForTrainersPage] Ошибка ответа:', response.status, errorText);
            throw new Error(`Ошибка загрузки инструкторов: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('[loadKuligaInstructorsForTrainersPage] Получены данные из API (raw):', result);
        console.log('[loadKuligaInstructorsForTrainersPage] Тип данных:', typeof result, 'isArray:', Array.isArray(result));
        
        // Проверяем формат ответа - API возвращает { success: true, data: [...] }
        let instructors = [];
        if (result && result.success && Array.isArray(result.data)) {
            instructors = result.data;
            console.log('[loadKuligaInstructorsForTrainersPage] Данные извлечены из result.data');
        } else if (Array.isArray(result)) {
            instructors = result;
            console.log('[loadKuligaInstructorsForTrainersPage] Данные - массив напрямую');
        } else if (result && Array.isArray(result.data)) {
            instructors = result.data;
            console.log('[loadKuligaInstructorsForTrainersPage] Данные извлечены из result.data (без success)');
        } else {
            console.warn('[loadKuligaInstructorsForTrainersPage] Неожиданный формат ответа:', result);
        }
        
        console.log('[loadKuligaInstructorsForTrainersPage] Извлечено инструкторов:', instructors.length);
        
        // Маппинг значений для вида спорта
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Лыжи и сноуборд'
        };
        
        // Разделяем на активных и уволенных
        const activeInstructors = instructors.filter(instructor => instructor.is_active);
        const dismissedInstructors = instructors.filter(instructor => !instructor.is_active);
        
        const trainersList = document.querySelector('.trainers-list');
        if (!trainersList) {
            console.error('[loadKuligaInstructorsForTrainersPage] Элемент .trainers-list не найден');
            return;
        }
        
        console.log('[loadKuligaInstructorsForTrainersPage] Найдено инструкторов:', activeInstructors.length, 'активных,', dismissedInstructors.length, 'уволенных');
        
        // Очищаем список
        trainersList.innerHTML = '';
        
        // Добавляем кнопку для просмотра уволенных
        if (dismissedInstructors.length > 0) {
            const dismissedButton = document.createElement('button');
            dismissedButton.className = 'btn-secondary';
            dismissedButton.style.marginBottom = '20px';
            dismissedButton.innerHTML = `Уволенные инструкторы (${dismissedInstructors.length})`;
            dismissedButton.onclick = async () => {
                // Загружаем уволенных тренеров тренажёра для полного списка
                try {
                    const trainersResponse = await fetch('/api/trainers');
                    const trainers = await trainersResponse.json();
                    const dismissedTrainers = trainers.filter(tr => !tr.is_active);
                    showDismissedTrainersModal(dismissedTrainers, dismissedInstructors);
                } catch (error) {
                    // Если не удалось загрузить, показываем только инструкторов Кулиги
                    showDismissedTrainersModal([], dismissedInstructors);
                }
            };
            trainersList.appendChild(dismissedButton);
        }
            
        // Отображаем активных инструкторов
        if (activeInstructors.length === 0) {
            const noInstructorsMsg = document.createElement('div');
            noInstructorsMsg.className = 'alert alert-info';
            noInstructorsMsg.textContent = 'Нет активных инструкторов Кулиги';
            trainersList.appendChild(noInstructorsMsg);
        } else {
            activeInstructors.forEach(instructor => {
                console.log(`[loadKuligaInstructorsForTrainersPage] Инструктор ${instructor.full_name}: plain_password=`, instructor.plain_password, 'username=', instructor.username);
                
                const instructorCard = document.createElement('div');
                instructorCard.className = 'trainer-item';
                instructorCard.innerHTML = `
                    <div class="trainer-photo">
                        ${instructor.photo_url ? 
                            `<img src="${instructor.photo_url}" alt="${instructor.full_name}" style="width: 100px; height: 150px; object-fit: cover; border-radius: 8px;">` :
                            `<div class="no-photo" style="width: 100px; height: 150px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px; text-align: center;">Нет фото</div>`
                        }
                    </div>
                    <div class="trainer-info">
                        <h3>${instructor.full_name}</h3>
                        <p>Вид спорта: ${sportTypeMapping[instructor.sport_type] || instructor.sport_type}</p>
                        <p><strong>Место работы:</strong> ${instructor.location === 'vorona' ? 'Воронинские горки' : (instructor.location === 'kuliga' || !instructor.location) ? 'База отдыха «Кулига-Клуб»' : instructor.location}</p>
                        <p>Телефон: ${instructor.phone}</p>
                        ${instructor.email ? `<p>Email: ${instructor.email}</p>` : ''}
                        ${instructor.username ? `<p>Логин: ${instructor.username}</p>` : '<p style="color: #999;">Логин не задан</p>'}
                        ${instructor.plain_password ? `<p><strong>Пароль:</strong> ${instructor.plain_password}</p>` : instructor.username ? '<p style="color: #999;">Пароль не сохранен</p>' : ''}
                        <p>Статус: ${instructor.is_active ? 'Работает' : 'Уволен'}</p>
                    </div>
                    <div class="trainer-actions">
                        <button class="btn-secondary" onclick="editKuligaInstructorForTrainersPage(${instructor.id})">Редактировать</button>
                        <button class="btn-secondary" onclick="viewKuligaInstructorSchedule(${instructor.id})">Расписание</button>
                        <button class="btn-danger" onclick="dismissKuligaInstructor(${instructor.id})">Уволить</button>
                    </div>
                `;
                trainersList.appendChild(instructorCard);
            });
        }
        
        console.log('[loadKuligaInstructorsForTrainersPage] Загрузка завершена успешно');
    } catch (error) {
        console.error('[loadKuligaInstructorsForTrainersPage] Ошибка при загрузке инструкторов Кулиги:', error);
        showError('Не удалось загрузить инструкторов Кулиги: ' + error.message);
    }
}

// Показать модальное окно создания инструктора Кулиги
function showCreateKuligaInstructorModal() {
    // TODO: Создать модальное окно аналогично create-trainer.html
    // Пока используем существующий модал из admin-kuliga.js или создаём новый
    alert('Функция создания инструктора Кулиги будет реализована');
}

// Редактировать инструктора Кулиги (для страницы "Тренера")
async function editKuligaInstructorForTrainersPage(id) {
    try {
        const token = getCookie('adminToken');
        const response = await fetch(`/api/kuliga/admin/instructors/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const instructor = await response.json();
        
        // Маппинг значений для вида спорта
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Лыжи и сноуборд'
        };
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <h3>Редактирование инструктора Кулиги</h3>
                <form id="editKuligaInstructorForm">
                    <input type="hidden" name="hire_date" value="${instructor.hire_date}">
                    <input type="hidden" name="is_active" value="${instructor.is_active}">
                    <input type="hidden" name="dismissal_date" value="${instructor.dismissal_date || ''}">
                    <div class="instructor-current-info" style="margin-bottom: 20px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">
                        <p><strong>Текущая информация:</strong></p>
                        <p>Дата приема: ${new Date(instructor.hire_date).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_full_name">ФИО:</label>
                        <input type="text" id="kuliga_full_name" name="full_name" value="${instructor.full_name}" required>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_sport_type">Вид спорта:</label>
                        <select id="kuliga_sport_type" name="sport_type" required>
                            ${Object.entries(sportTypeMapping).map(([value, label]) => 
                                `<option value="${value}" ${instructor.sport_type === value ? 'selected' : ''}>${label}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_location">Место работы:</label>
                        <select id="kuliga_location" name="location" required>
                            <option value="kuliga" ${(instructor.location || 'kuliga') === 'kuliga' ? 'selected' : ''}>База отдыха «Кулига-Клуб»</option>
                            <option value="vorona" ${instructor.location === 'vorona' ? 'selected' : ''}>Воронинские горки</option>
                        </select>
                        <small style="color: #666; display: block; margin-top: 5px;">Место проведения тренировок инструктора</small>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_phone">Телефон:</label>
                        <input type="tel" id="kuliga_phone" name="phone" value="${instructor.phone}" required>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_email">Email:</label>
                        <input type="email" id="kuliga_email" name="email" value="${instructor.email || ''}">
                    </div>
                    <div class="form-group">
                        <label for="kuliga_admin_percentage">Процент администратора (%):</label>
                        <input type="number" id="kuliga_admin_percentage" name="admin_percentage" value="${instructor.admin_percentage || 20}" min="0" max="100" step="0.01" required>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_instructor_photo">Фото инструктора:</label>
                        <div class="current-photo" style="margin-bottom: 10px;">
                            ${instructor.photo_url ? 
                                `<img id="current-kuliga-instructor-photo" src="${instructor.photo_url}" alt="${instructor.full_name}" style="max-width: 150px; height: auto; max-height: 200px; border-radius: 8px; margin-bottom: 10px;">` :
                                `<div class="no-photo" style="width: 150px; height: 100px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; margin-bottom: 10px;">Нет фото</div>`
                            }
                        </div>
                        <input type="file" id="kuliga_instructor_photo" name="photo" accept="image/*" onchange="previewKuligaInstructorPhoto(this)">
                        <small style="color: #666; display: block; margin-top: 5px;">Фото будет автоматически сжато до высоты 200px и конвертировано в WebP формат</small>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_description">Описание:</label>
                        <textarea id="kuliga_description" name="description" rows="4">${instructor.description || ''}</textarea>
                    </div>
                    <div class="form-group" style="border-top: 2px solid #e0e0e0; padding-top: 15px; margin-top: 15px;">
                        <h4 style="margin-bottom: 10px; color: #667eea;">🔐 Доступ к личному кабинету</h4>
                        <label for="kuliga_username">Логин (для входа в личный кабинет):</label>
                        <input type="text" id="kuliga_username" name="username" value="${instructor.username || ''}" placeholder="Введите логин">
                        <small style="color: #666; display: block; margin-top: 5px;">Если не указан, инструктор не сможет входить в личный кабинет</small>
                    </div>
                    <div class="form-group">
                        <label for="kuliga_password">Пароль (для входа в личный кабинет):</label>
                        <input type="text" id="kuliga_password" name="password" value="${instructor.plain_password || ''}" placeholder="Оставьте пустым, чтобы не менять">
                        <small style="color: #666; display: block; margin-top: 5px;">Пароль будет захеширован для безопасности, но также будет сохранен в открытом виде для отображения. Оставьте пустым, чтобы не менять текущий пароль.</small>
                        ${instructor.plain_password ? `<small style="color: #27ae60; display: block; margin-top: 5px;">Текущий пароль: <strong>${instructor.plain_password}</strong></small>` : ''}
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">Сохранить</button>
                        <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        
        // Обработка сохранения
        document.getElementById('editKuligaInstructorForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);
            const token = getCookie('adminToken');
            
            try {
                // Если есть новое фото, сначала загружаем его
                const photoFile = form.querySelector('#kuliga_instructor_photo').files[0];
                let photoUrl = instructor.photo_url;
                
                if (photoFile) {
                    const photoFormData = new FormData();
                    photoFormData.append('photo', photoFile);
                    
                    const photoResponse = await fetch(`/api/kuliga/admin/instructors/${id}/upload-photo`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        },
                        body: photoFormData
                    });
                    
                    if (!photoResponse.ok) {
                        const photoError = await photoResponse.json();
                        throw new Error(photoError.error || 'Ошибка при загрузке фото');
                    }
                    
                    const photoResult = await photoResponse.json();
                    photoUrl = photoResult.data?.photo_url || photoResult.photo_url;
                }
                
                // Обновляем остальные данные инструктора
                const adminPercentageValue = formData.get('admin_percentage');
                const parsedPercentage = adminPercentageValue !== null && adminPercentageValue !== '' 
                    ? parseFloat(adminPercentageValue) 
                    : 20;
                const adminPercentage = isNaN(parsedPercentage) ? 20 : parsedPercentage;
                
                const updateData = {
                    fullName: formData.get('full_name'),
                    phone: formData.get('phone'),
                    email: formData.get('email') || null,
                    photoUrl: photoUrl || null,
                    description: formData.get('description') || null,
                    sportType: formData.get('sport_type'),
                    location: formData.get('location') || 'kuliga',
                    adminPercentage: adminPercentage,
                    hireDate: formData.get('hire_date'),
                    isActive: formData.get('is_active') === 'true'
                };
                
                // Если указан новый пароль, добавляем его (на бэкенде он будет захеширован)
                const password = formData.get('password');
                if (password && password.trim()) {
                    updateData.password = password.trim();
                }
                
                // Если указан username, добавляем его
                const username = formData.get('username');
                if (username && username.trim()) {
                    updateData.username = username.trim();
                } else if (username === '') {
                    updateData.username = null;
                }
                
                const response = await fetch(`/api/kuliga/admin/instructors/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(updateData)
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Ошибка при обновлении инструктора');
                }
                
                modal.remove();
                await loadKuligaInstructorsForTrainersPage();
                showSuccess('Данные инструктора успешно обновлены');
    } catch (error) {
                console.error('Ошибка при обновлении инструктора:', error);
                showError(error.message || 'Не удалось обновить данные инструктора');
            }
        });
    } catch (error) {
        console.error('Ошибка при загрузке данных инструктора:', error);
        showError('Не удалось загрузить данные инструктора');
    }
}

// Просмотреть расписание инструктора
async function viewKuligaInstructorSchedule(id) {
    try {
        const token = getCookie('adminToken');
        
        // Получаем данные инструктора
        const instructorResponse = await fetch(`/api/kuliga/admin/instructors/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!instructorResponse.ok) {
            throw new Error('Не удалось загрузить данные инструктора');
        }
        
        const instructorData = await instructorResponse.json();
        const instructor = instructorData.data || instructorData;
        
        // Получаем расписание на ближайшие 14 дней
        const today = new Date();
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + 14);
        
        const startDateStr = today.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        const scheduleResponse = await fetch(`/api/kuliga/admin/schedule?instructor_id=${id}&start_date=${startDateStr}&end_date=${endDateStr}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        let slots = [];
        if (scheduleResponse.ok) {
            const scheduleData = await scheduleResponse.json();
            slots = scheduleData.data || scheduleData || [];
        }
        
        // Группируем слоты по датам
        const slotsByDate = {};
        slots.forEach(slot => {
            const date = slot.date;
            if (!slotsByDate[date]) {
                slotsByDate[date] = [];
            }
            slotsByDate[date].push(slot);
        });
        
        // Сортируем даты
        const sortedDates = Object.keys(slotsByDate).sort();
        
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Лыжи и сноуборд'
        };
        
        const statusMapping = {
            'available': 'Свободен',
            'booked': 'Занят',
            'group': 'Группа',
            'blocked': 'Заблокирован'
        };
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
                <h3>Расписание инструктора: ${instructor.full_name}</h3>
                <div style="margin-bottom: 15px; padding: 10px; background: #f0f7ff; border-radius: 8px;">
                    <p><strong>Вид спорта:</strong> ${sportTypeMapping[instructor.sport_type] || instructor.sport_type}</p>
                    <p><strong>Телефон:</strong> ${instructor.phone}</p>
                </div>
                <div class="instructor-schedule">
                    ${sortedDates.length === 0 ? 
                        '<p style="text-align: center; color: #666; padding: 20px;">Расписание на ближайшие 14 дней отсутствует</p>' :
                        sortedDates.map(date => {
                            const dateSlots = slotsByDate[date];
                            const dateObj = new Date(date);
                            const weekday = dateObj.toLocaleDateString('ru-RU', { weekday: 'short' });
                            const dateStr = dateObj.toLocaleDateString('ru-RU');
                            
                            return `
                                <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px;">
                                    <h4 style="margin: 0 0 10px 0; color: #333;">${dateStr} (${weekday})</h4>
                                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px;">
                                        ${dateSlots.map(slot => {
                                            const startTime = slot.start_time.substring(0, 5);
                                            const endTime = slot.end_time.substring(0, 5);
                                            const statusColor = {
                                                'available': '#27ae60',
                                                'booked': '#e74c3c',
                                                'group': '#f39c12',
                                                'blocked': '#95a5a6'
                                            }[slot.status] || '#95a5a6';
                                            
                                            return `
                                                <div style="padding: 8px; background: ${statusColor}20; border: 1px solid ${statusColor}; border-radius: 6px; text-align: center;">
                                                    <div style="font-weight: 600; color: #333;">${startTime}-${endTime}</div>
                                                    <div style="font-size: 0.85rem; color: ${statusColor}; margin-top: 4px;">${statusMapping[slot.status] || slot.status}</div>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        }).join('')
                    }
                </div>
                <div style="margin-top: 20px; text-align: center;">
                    <button type="button" class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    } catch (error) {
        console.error('Ошибка при загрузке расписания инструктора:', error);
        showError('Не удалось загрузить расписание инструктора');
    }
}

// Вспомогательная функция для превью фото инструктора Кулиги
function previewKuligaInstructorPhoto(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const currentPhoto = document.getElementById('current-kuliga-instructor-photo');
            if (currentPhoto) {
                currentPhoto.src = e.target.result;
            } else {
                const photoContainer = input.parentElement.querySelector('.current-photo');
                if (photoContainer) {
                    photoContainer.innerHTML = `<img id="current-kuliga-instructor-photo" src="${e.target.result}" alt="Превью" style="max-width: 150px; height: auto; max-height: 200px; border-radius: 8px; margin-bottom: 10px;">`;
                }
            }
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// Уволить инструктора Кулиги
async function dismissKuligaInstructor(id) {
    if (!confirm('Вы уверены, что хотите уволить этого инструктора?')) return;
    
    try {
        const token = getCookie('adminToken');
        const response = await fetch(`/api/kuliga/admin/instructors/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ isActive: false })
        });
        
        if (!response.ok) throw new Error('Ошибка увольнения инструктора');
        
        showSuccess('Инструктор уволен');
        loadKuligaInstructorsForTrainersPage();
    } catch (error) {
        console.error('Ошибка увольнения инструктора:', error);
        showError('Не удалось уволить инструктора');
    }
}

// Просмотреть информацию об инструкторе Кулиги (для страницы "Тренера")
async function viewKuligaInstructorForTrainersPage(id) {
    try {
        const token = getCookie('adminToken');
        const response = await fetch(`/api/kuliga/admin/instructors/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) throw new Error('Ошибка загрузки данных инструктора');
        
        const instructor = await response.json();
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Лыжи и сноуборд'
        };
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Информация об инструкторе Кулиги</h3>
                <div class="trainer-photo-view" style="text-align: center; margin-bottom: 20px;">
                    ${instructor.photo_url ? 
                        `<img src="${instructor.photo_url}" alt="${instructor.full_name}" style="max-width: 200px; height: auto; max-height: 300px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">` :
                        `<div class="no-photo" style="width: 200px; height: 150px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; margin: 0 auto;">Нет фото</div>`
                    }
                </div>
                <div class="trainer-details">
                    <p><strong>ФИО:</strong> ${instructor.full_name}</p>
                    <p><strong>Вид спорта:</strong> ${sportTypeMapping[instructor.sport_type] || instructor.sport_type}</p>
                    <p><strong>Телефон:</strong> ${instructor.phone}</p>
                    <p><strong>Email:</strong> ${instructor.email || '-'}</p>
                    <p><strong>Описание:</strong> ${instructor.description || '-'}</p>
                    <p><strong>Процент администратора:</strong> ${instructor.admin_percentage || 20}%</p>
                    <p><strong>Дата приема:</strong> ${instructor.hire_date ? new Date(instructor.hire_date).toLocaleDateString('ru-RU') : '-'}</p>
                    <p><strong>Статус:</strong> ${instructor.is_active ? 'Работает' : 'Уволен'}</p>
                    ${instructor.dismissal_date ? `<p><strong>Дата увольнения:</strong> ${new Date(instructor.dismissal_date).toLocaleDateString('ru-RU')}</p>` : ''}
                    ${instructor.username ? `<p><strong>Логин:</strong> ${instructor.username}</p>` : '<p><strong>Логин:</strong> Не задан</p>'}
                </div>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    } catch (error) {
        console.error('Ошибка при загрузке данных инструктора:', error);
        showError('Не удалось загрузить данные инструктора');
    }
}

// Восстановить инструктора Кулиги
async function restoreKuligaInstructor(id) {
    try {
        const token = getCookie('adminToken');
        const response = await fetch(`/api/kuliga/admin/instructors/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ isActive: true })
        });
        
        if (!response.ok) throw new Error('Ошибка восстановления инструктора');
        
        showSuccess('Инструктор восстановлен');
        closeModal('dismissed-kuliga-instructors-modal');
        loadKuligaInstructorsForTrainersPage();
    } catch (error) {
        console.error('Ошибка восстановления инструктора:', error);
        showError('Не удалось восстановить инструктора');
    }
}

// Функция для отображения модального окна с уволенными тренерами (оба типа)
function showDismissedTrainersModal(dismissedTrainers = [], dismissedKuligaInstructors = []) {
    console.log('[showDismissedTrainersModal] вызвана');
    console.log('  - Тренеры тренажёра:', dismissedTrainers.length);
    console.log('  - Инструкторы Кулиги:', dismissedKuligaInstructors.length);
    
    // Маппинг значений для вида спорта
    const sportTypeMapping = {
        'ski': 'Горные лыжи',
        'snowboard': 'Сноуборд',
        'both': 'Лыжи и сноуборд'
    };
    
    const totalDismissed = dismissedTrainers.length + dismissedKuligaInstructors.length;
    
    try {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'dismissed-trainers-modal';
        
        // Определяем активную вкладку по умолчанию
        let activeTab = 'simulator';
        if (dismissedTrainers.length === 0 && dismissedKuligaInstructors.length > 0) {
            activeTab = 'kuliga';
        }
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                <h3>Уволенные тренеры (${totalDismissed})</h3>
                
                <!-- Вкладки для разделения типов -->
                <div class="dismissed-tabs" style="margin-bottom: 20px; border-bottom: 2px solid #e0e0e0; display: flex; gap: 10px;">
                    <button class="dismissed-tab ${activeTab === 'simulator' ? 'active' : ''}" 
                            data-tab="simulator" 
                            style="padding: 10px 20px; border: none; background: transparent; cursor: pointer; font-size: 16px; font-weight: 500; border-bottom: 3px solid ${activeTab === 'simulator' ? '#007bff' : 'transparent'};">
                        Тренеры тренажёра (${dismissedTrainers.length})
                    </button>
                    <button class="dismissed-tab ${activeTab === 'kuliga' ? 'active' : ''}" 
                            data-tab="kuliga"
                            style="padding: 10px 20px; border: none; background: transparent; cursor: pointer; font-size: 16px; font-weight: 500; border-bottom: 3px solid ${activeTab === 'kuliga' ? '#007bff' : 'transparent'};">
                        Инструкторы Кулиги (${dismissedKuligaInstructors.length})
                    </button>
                </div>
                
                <!-- Контент для тренеров тренажёра -->
                <div class="dismissed-content" data-content="simulator" style="display: ${activeTab === 'simulator' ? 'block' : 'none'};">
                    ${dismissedTrainers.length === 0 ? 
                        '<div class="alert alert-info">Нет уволенных тренеров тренажёра</div>' :
                        dismissedTrainers.map(trainer => `
                            <div class="trainer-item" style="display: flex; gap: 15px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 15px;">
                                <div class="trainer-photo" style="flex-shrink: 0;">
                                    ${trainer.photo_url ? 
                                        `<img src="${trainer.photo_url}" alt="${trainer.full_name}" style="width: 80px; height: 100px; object-fit: cover; border-radius: 8px;">` :
                                        `<div class="no-photo" style="width: 80px; height: 100px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px; text-align: center;">Нет фото</div>`
                                    }
                                </div>
                                <div class="trainer-info" style="flex-grow: 1;">
                                    <h3 style="margin: 0 0 10px 0;">${trainer.full_name}</h3>
                                    <p style="margin: 5px 0;"><strong>Вид спорта:</strong> ${sportTypeMapping[trainer.sport_type] || trainer.sport_type}</p>
                                    <p style="margin: 5px 0;"><strong>Телефон:</strong> ${trainer.phone}</p>
                                    ${trainer.email ? `<p style="margin: 5px 0;"><strong>Email:</strong> ${trainer.email}</p>` : ''}
                                    <p style="margin: 5px 0; color: #999;"><strong>Дата увольнения:</strong> ${trainer.dismissal_date ? new Date(trainer.dismissal_date).toLocaleDateString('ru-RU') : 'Не указана'}</p>
                                </div>
                                <div class="trainer-actions" style="display: flex; flex-direction: column; gap: 10px; justify-content: center;">
                                    <button class="btn-secondary" onclick="viewTrainer(${trainer.id})">Просмотр</button>
                                    <button class="btn-primary" onclick="rehireTrainer(${trainer.id}); this.closest('#dismissed-trainers-modal').remove();">Восстановить</button>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
                
                <!-- Контент для инструкторов Кулиги -->
                <div class="dismissed-content" data-content="kuliga" style="display: ${activeTab === 'kuliga' ? 'block' : 'none'};">
                    ${dismissedKuligaInstructors.length === 0 ? 
                        '<div class="alert alert-info">Нет уволенных инструкторов Кулиги</div>' :
                        dismissedKuligaInstructors.map(instructor => `
                            <div class="trainer-item" style="display: flex; gap: 15px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 15px;">
                                <div class="trainer-photo" style="flex-shrink: 0;">
                                    ${instructor.photo_url ? 
                                        `<img src="${instructor.photo_url}" alt="${instructor.full_name}" style="width: 80px; height: 100px; object-fit: cover; border-radius: 8px;">` :
                                        `<div class="no-photo" style="width: 80px; height: 100px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px; text-align: center;">Нет фото</div>`
                                    }
                                </div>
                                <div class="trainer-info" style="flex-grow: 1;">
                                    <h3 style="margin: 0 0 10px 0;">${instructor.full_name}</h3>
                                    <p style="margin: 5px 0;"><strong>Вид спорта:</strong> ${sportTypeMapping[instructor.sport_type] || instructor.sport_type}</p>
                                    <p style="margin: 5px 0;"><strong>Телефон:</strong> ${instructor.phone}</p>
                                    ${instructor.email ? `<p style="margin: 5px 0;"><strong>Email:</strong> ${instructor.email}</p>` : ''}
                                    <p style="margin: 5px 0; color: #999;"><strong>Дата увольнения:</strong> ${instructor.dismissal_date ? new Date(instructor.dismissal_date).toLocaleDateString('ru-RU') : 'Не указана'}</p>
                                </div>
                                <div class="trainer-actions" style="display: flex; flex-direction: column; gap: 10px; justify-content: center;">
                                    <button class="btn-secondary" onclick="viewKuligaInstructorForTrainersPage(${instructor.id})">Просмотр</button>
                                    <button class="btn-primary" onclick="restoreKuligaInstructor(${instructor.id}); this.closest('#dismissed-trainers-modal').remove();">Восстановить</button>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
                
                <div class="modal-actions" style="margin-top: 20px; text-align: center;">
                    <button class="btn-secondary" onclick="document.getElementById('dismissed-trainers-modal').remove()">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        
        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        
        // Обработчики переключения вкладок
        const tabs = modal.querySelectorAll('.dismissed-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabType = tab.dataset.tab;
                
                // Обновляем активную вкладку
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.borderBottom = '3px solid transparent';
                });
                tab.classList.add('active');
                tab.style.borderBottom = '3px solid #007bff';
                
                // Показываем соответствующий контент
                const contents = modal.querySelectorAll('.dismissed-content');
                contents.forEach(content => {
                    content.style.display = content.dataset.content === tabType ? 'block' : 'none';
                });
            });
        });
        
        console.log('[showDismissedTrainersModal] Модальное окно создано и показано');
    } catch (err) {
        console.error('[showDismissedTrainersModal] Ошибка:', err);
        showError('Не удалось отобразить список уволенных тренеров');
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
                    <div class="form-group" style="border-top: 2px solid #e0e0e0; padding-top: 15px; margin-top: 15px;">
                        <h4 style="margin-bottom: 10px; color: #667eea;">🔐 Доступ к системе бронирования</h4>
                        <label for="trainer_username">Логин (для входа в систему):</label>
                        <input type="text" id="trainer_username" name="username" value="${trainer.username || ''}" placeholder="Введите логин">
                        <small style="color: #666; display: block; margin-top: 5px;">Если не указан, тренер не сможет входить в систему бронирования</small>
                    </div>
                    <div class="form-group">
                        <label for="trainer_password">Пароль (для входа в систему):</label>
                        <input type="text" id="trainer_password" name="password" value="${trainer.password || ''}" placeholder="Введите пароль">
                        <small style="color: #666; display: block; margin-top: 5px;">Пароль хранится в открытом виде. Оставьте пустым, чтобы не менять.</small>
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
                    username: formData.get('username') || null,
                    password: formData.get('password') || null,
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
        
        // Получаем значение фильтра спортсменов
        const athleteFilter = document.getElementById('clientAthleteFilter');
        let url = '/api/clients';
        if (athleteFilter && athleteFilter.value) {
            url += `?is_athlete=${athleteFilter.value}`;
        }
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allClients = await response.json();
        console.log('Получены данные клиентов:', allClients);
        
        const clientsContainer = document.getElementById('clientsContainer');
        if (!clientsContainer) {
            throw new Error('Элемент clientsContainer не найден');
        }

        // Добавляем обработчик фильтра при первой загрузке
        if (athleteFilter && !athleteFilter.hasAttribute('data-initialized')) {
            athleteFilter.addEventListener('change', loadClients);
            athleteFilter.setAttribute('data-initialized', 'true');
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
    // Функция для нормализации номера кошелька (убирает дефисы и пробелы)
    const normalizeWalletNumber = (wallet) => {
        if (!wallet) return '';
        return String(wallet).replace(/[-\s]/g, '').toLowerCase();
    };
    
    const normalizedSearchTerm = normalizeWalletNumber(searchTerm);
    
    let filteredClients = allClients.filter(client => {
        const fullNameMatch = client.full_name ? client.full_name.toLowerCase().includes(searchTerm) : false;
        const phoneMatch = client.phone ? client.phone.toLowerCase().includes(searchTerm) : false;
        const childNameMatch = client.child_name ? client.child_name.toLowerCase().includes(searchTerm) : false;
        // Нормализуем номер кошелька (убираем дефисы) и ищем по нормализованному запросу
        const walletNumber = normalizeWalletNumber(client.wallet_number);
        const walletMatch = walletNumber && walletNumber.includes(normalizedSearchTerm);
        return fullNameMatch || phoneMatch || childNameMatch || walletMatch;
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
                    <th>🏔️ Спортсмен</th>
                    <th>Отзыв 2ГИС</th>
                    <th>Отзыв Яндекс</th>
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
                    
                    // Форматируем счетчики тренировок для клиента
                    const clientIndividualCount = client.client_individual_count || 0;
                    const clientGroupCount = client.client_group_count || 0;
                    const usernameDisplay = client.telegram_username ? ` <strong>${client.telegram_username}</strong>` : '';
                    const clientTrainingCount = `${client.full_name}${usernameDisplay} (${clientIndividualCount} и./${clientGroupCount} г.)`;
                    
                    // Форматируем счетчики тренировок для ребенка
                    const childIndividualCount = client.child_individual_count || 0;
                    const childGroupCount = client.child_group_count || 0;
                    const childTrainingCount = client.child_name 
                        ? `${client.child_name} (${childIndividualCount} и./${childGroupCount} г.)`
                        : '-';
                    
                    return `
                        <tr class="${clientBirthdayClass || childBirthdayClass}">
                            <td>${index + 1}</td>
                            <td>${clientTrainingCount} ${clientBirthdayText}</td>
                            <td>${clientAge} лет</td>
                            <td>${client.phone}</td>
                            <td>${client.skill_level || '-'}</td>
                            <td>${childTrainingCount} ${childBirthdayText}</td>
                            <td>${childAge ? `${childAge} лет` : '-'}</td>
                            <td>${client.child_skill_level || '-'}</td>
                            <td>${client.balance || 0} ₽</td>
                            <td style="text-align: center;">
                                <input type="checkbox" 
                                       onchange="toggleClientAthleteStatus(${client.id}, ${client.is_athlete || false})"
                                       ${client.is_athlete ? 'checked' : ''}
                                       title="Отметить клиента как спортсмена (может покупать абонементы)">
                            </td>
                            <td style="text-align: center;">
                                <input type="checkbox" 
                                       onchange="updateReviewStatus(${client.id}, '2gis', this.checked)"
                                       ${client.review_2gis ? 'checked' : ''}
                                       title="Отметить, что клиент оставил отзыв на 2ГИС">
                            </td>
                            <td style="text-align: center;">
                                <input type="checkbox" 
                                       onchange="updateReviewStatus(${client.id}, 'yandex', this.checked)"
                                       ${client.review_yandex ? 'checked' : ''}
                                       title="Отметить, что клиент оставил отзыв на Яндекс картах">
                            </td>
                            <td>
                                <button onclick="editClient(${client.id})" class="edit-button">✏️</button>
                                ${client.child_id ? `<button onclick="editChild(${client.child_id})" class="edit-button">✏️👶</button>` : ''}
                                <button onclick="openClientNotifyModal(${client.id}, '${client.full_name.replace(/'/g, "\\'")}')" class="notify-button" title="Отправить сообщение">💬</button>
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

// Обработчики событий для поиска и сортировки клиентов (перенесены в основной обработчик)

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
        const response = await fetch('/api/certificates/admin/list?limit=50&offset=0');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Ошибка при загрузке сертификатов');
        }
        
        const certificates = result.certificates || [];
        
        const certificatesList = document.querySelector('.certificates-list');
        if (certificatesList) {
            if (certificates.length === 0) {
                certificatesList.innerHTML = '<p style="text-align: center; padding: 40px; color: #666;">Сертификаты не найдены</p>';
                return;
            }
            
            certificatesList.innerHTML = certificates.map(cert => {
                // Форматируем статус с эмодзи
                const statusEmoji = {
                    'active': '🟢',
                    'used': '🔵',
                    'expired': '🔴',
                    'cancelled': '⚫'
                }[cert.status] || '⚪';
                
                const statusText = {
                    'active': 'Активен',
                    'used': 'Использован',
                    'expired': 'Истек',
                    'cancelled': 'Отменен'
                }[cert.status] || cert.status;
                
                // Форматируем дату
                const expiryDate = cert.expiry_date ? new Date(cert.expiry_date).toLocaleDateString('ru-RU') : '—';
                const purchaseDate = cert.purchase_date ? new Date(cert.purchase_date).toLocaleDateString('ru-RU') : '—';
                
                // Определяем класс для истекающих скоро
                const isExpiringSoon = cert.days_until_expiry > 0 && cert.days_until_expiry <= 7 && cert.status === 'active';
                const itemClass = isExpiringSoon ? 'certificate-item expiring-soon' : 'certificate-item';
                
                return `
                    <div class="${itemClass}">
                        <div class="certificate-info">
                            <h3>Сертификат #${cert.certificate_number}</h3>
                            <p><strong>Номинал:</strong> ${cert.nominal_value.toLocaleString('ru-RU')} ₽</p>
                            <p><strong>Статус:</strong> ${statusEmoji} ${statusText}</p>
                            <p><strong>Покупатель:</strong> ${cert.purchaser ? cert.purchaser.full_name : '—'}</p>
                            ${cert.recipient_name ? `<p><strong>Получатель:</strong> ${cert.recipient_name}</p>` : ''}
                            <p><strong>Дата покупки:</strong> ${purchaseDate}</p>
                            <p><strong>Срок действия:</strong> ${expiryDate}${isExpiringSoon ? ' <span style="color: orange;">⚠️ Истекает через ' + cert.days_until_expiry + ' дн.</span>' : ''}</p>
                            ${cert.activation_date ? `<p><strong>Активирован:</strong> ${new Date(cert.activation_date).toLocaleDateString('ru-RU')}</p>` : ''}
                        </div>
                        <div class="certificate-actions">
                            <button class="btn-secondary" onclick="viewCertificateDetail(${cert.id})">Просмотр</button>
                            ${cert.status === 'active' ? `<button class="btn-secondary" onclick="editCertificate(${cert.id})">Редактировать</button>` : ''}
                            ${cert.status === 'active' ? `<button class="btn-secondary" onclick="extendCertificate(${cert.id})">Продлить</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Ошибка при загрузке сертификатов:', error);
        const certificatesList = document.querySelector('.certificates-list');
        if (certificatesList) {
            certificatesList.innerHTML = `<p style="text-align: center; padding: 40px; color: #d32f2f;">Ошибка при загрузке сертификатов: ${error.message}</p>`;
        }
        showError('Не удалось загрузить сертификаты');
    }
}

// Просмотр детальной информации о сертификате
async function viewCertificateDetail(id) {
    try {
        const response = await fetch(`/api/certificates/admin/certificate/${id}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Ошибка при загрузке сертификата');
        }
        
        const cert = result.certificate;
        
        // Форматируем статус с эмодзи
        const statusEmoji = {
            'active': '🟢',
            'used': '🔵',
            'expired': '🔴',
            'cancelled': '⚫'
        }[cert.status] || '⚪';
        
        const statusText = {
            'active': 'Активен',
            'used': 'Использован',
            'expired': 'Истек',
            'cancelled': 'Отменен'
        }[cert.status] || cert.status;
        
        // Форматируем даты
        const formatDate = (dateStr) => {
            if (!dateStr) return '—';
            return new Date(dateStr).toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        };
        
        // URL картинки сертификата
        const imageUrl = cert.image_url || cert.pdf_url || '';
        const imagePath = imageUrl ? (imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`) : '';
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'certificate-view-modal';
        modal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 10000; align-items: center; justify-content: center; overflow-y: auto; padding: 20px;';
        
        modal.innerHTML = `
            <div class="modal-content" style="background: white; border-radius: 12px; max-width: 1200px; width: 100%; max-height: 95vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3); position: relative;">
                <button class="modal-close" onclick="closeCertificateModal()" style="position: absolute; top: 15px; right: 15px; background: #f44336; color: white; border: none; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; z-index: 10001;">✕</button>
                
                <div style="padding: 30px;">
                    <h2 style="margin: 0 0 25px 0; color: #2c3e50;">Сертификат #${cert.certificate_number}</h2>
                    
                    <!-- Превью картинки сертификата -->
                    <div style="text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 30px; border-radius: 12px; border: 2px dashed #dee2e6;">
                        ${imagePath ? `
                            <div style="position: relative; display: inline-block; max-width: 100%;">
                                <img src="${imagePath}" 
                                     alt="Сертификат #${cert.certificate_number}" 
                                     id="certificate-image"
                                     style="max-width: 900px; width: 100%; height: auto; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); cursor: pointer; transition: transform 0.3s ease, box-shadow 0.3s ease;"
                                     onclick="openCertificateImageFullscreen('${imagePath}')"
                                     onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 12px 32px rgba(0,0,0,0.3)';"
                                     onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.2)';"
                                     onerror="this.style.display='none'; document.getElementById('certificate-image-error').style.display='block';">
                                <div id="certificate-image-error" style="display: none; padding: 40px; color: #666;">
                                    <p style="font-size: 18px; margin-bottom: 10px;">⚠️ Изображение сертификата не найдено</p>
                                    <p style="font-size: 14px; color: #999;">Сертификат может быть создан, но JPG файл еще не сгенерирован</p>
                                </div>
                                <div style="margin-top: 15px; color: #666; font-size: 14px;">
                                    <span>👆 Нажмите на изображение для просмотра в полном размере</span>
                                </div>
                            </div>
                        ` : `
                            <div style="padding: 60px 40px; color: #666;">
                                <p style="font-size: 18px; margin-bottom: 10px;">⚠️ Изображение сертификата отсутствует</p>
                                <p style="font-size: 14px; color: #999;">JPG файл не был создан при покупке сертификата</p>
                            </div>
                        `}
                    </div>
                    
                    <!-- Основная информация -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px;">
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                            <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 16px;">📋 Основная информация</h3>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div>
                                    <strong>Номинал:</strong><br>
                                    <span style="font-size: 20px; color: #27ae60; font-weight: bold;">${cert.nominal_value.toLocaleString('ru-RU')} ₽</span>
                                </div>
                                <div>
                                    <strong>Статус:</strong><br>
                                    ${statusEmoji} ${statusText}
                                </div>
                                <div>
                                    <strong>Дизайн:</strong><br>
                                    ${cert.design ? cert.design.name : '—'}
                                </div>
                                ${cert.message ? `
                                <div>
                                    <strong>Сообщение:</strong><br>
                                    <em style="color: #666;">${cert.message}</em>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                            <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 16px;">📅 Даты</h3>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div>
                                    <strong>Дата покупки:</strong><br>
                                    ${formatDate(cert.purchase_date)}
                                </div>
                                <div>
                                    <strong>Срок действия:</strong><br>
                                    ${formatDate(cert.expiry_date)}
                                    ${cert.days_until_expiry > 0 ? `<br><small style="color: ${cert.days_until_expiry <= 7 ? '#ff9800' : '#666'};">⏰ Осталось ${cert.days_until_expiry} дн.</small>` : ''}
                                </div>
                                ${cert.activation_date ? `
                                <div>
                                    <strong>Дата активации:</strong><br>
                                    ${formatDate(cert.activation_date)}
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        ${cert.purchaser ? `
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                            <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 16px;">👤 Покупатель</h3>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div>
                                    <strong>ФИО:</strong><br>
                                    ${cert.purchaser.full_name || '—'}
                                </div>
                                ${cert.purchaser.phone ? `
                                <div>
                                    <strong>Телефон:</strong><br>
                                    ${cert.purchaser.phone}
                                </div>
                                ` : ''}
                                ${cert.purchaser.email ? `
                                <div>
                                    <strong>Email:</strong><br>
                                    ${cert.purchaser.email}
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        ` : ''}
                        
                        ${cert.recipient_name ? `
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                            <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 16px;">🎁 Получатель</h3>
                            <div>
                                <strong>Имя:</strong><br>
                                ${cert.recipient_name}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    
                    <!-- Транзакции -->
                    ${cert.transactions && cert.transactions.length > 0 ? `
                    <div style="margin-bottom: 30px;">
                        <h3 style="margin: 0 0 15px 0; color: #2c3e50;">💳 История транзакций</h3>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="border-bottom: 2px solid #dee2e6;">
                                        <th style="padding: 10px; text-align: left;">Дата</th>
                                        <th style="padding: 10px; text-align: left;">Описание</th>
                                        <th style="padding: 10px; text-align: right;">Сумма</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${cert.transactions.map(trans => `
                                        <tr style="border-bottom: 1px solid #e9ecef;">
                                            <td style="padding: 10px;">${formatDate(trans.created_at)}</td>
                                            <td style="padding: 10px;">${trans.description || '—'}</td>
                                            <td style="padding: 10px; text-align: right; color: ${trans.amount < 0 ? '#e74c3c' : '#27ae60'}; font-weight: bold;">
                                                ${trans.amount > 0 ? '+' : ''}${trans.amount.toLocaleString('ru-RU')} ₽
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    ` : ''}
                    
                    <!-- Действия -->
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; padding-top: 20px; border-top: 1px solid #dee2e6;">
                        ${imagePath ? `<button class="btn-secondary" onclick="downloadCertificateImage('${imagePath}', '${cert.certificate_number}')">📥 Скачать изображение</button>` : ''}
                        ${cert.purchaser && cert.purchaser.email ? `<button class="btn-secondary" onclick="resendCertificate(${id})">📧 Отправить повторно</button>` : ''}
                        ${cert.status === 'active' ? `
                            <button class="btn-secondary" onclick="editCertificate(${id})">✏️ Редактировать</button>
                            <button class="btn-secondary" onclick="extendCertificate(${id})">⏰ Продлить срок</button>
                        ` : ''}
                        <button class="btn-secondary" onclick="closeCertificateModal()">Закрыть</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeCertificateModal();
            }
        });
        
    } catch (error) {
        console.error('Ошибка при просмотре сертификата:', error);
        alert(`Ошибка при загрузке сертификата: ${error.message}`);
    }
}

// Закрытие модального окна просмотра
function closeCertificateModal() {
    const modal = document.getElementById('certificate-view-modal');
    if (modal) {
        modal.remove();
    }
}

// Открытие картинки в полном размере
function openCertificateImageFullscreen(imageUrl) {
    const fullscreenModal = document.createElement('div');
    fullscreenModal.style.cssText = 'display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 20000; align-items: center; justify-content: center;';
    
    fullscreenModal.innerHTML = `
        <div style="position: relative; max-width: 95vw; max-height: 95vh;">
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="position: absolute; top: -40px; right: 0; background: #f44336; color: white; border: none; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; font-size: 20px;">✕</button>
            <img src="${imageUrl}" 
                 alt="Сертификат" 
                 style="max-width: 100%; max-height: 95vh; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
        </div>
    `;
    
    document.body.appendChild(fullscreenModal);
    
    fullscreenModal.addEventListener('click', (e) => {
        if (e.target === fullscreenModal) {
            fullscreenModal.remove();
        }
    });
}

// Скачивание изображения сертификата
function downloadCertificateImage(imageUrl, certificateNumber) {
    const link = document.createElement('a');
    link.href = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
    link.download = `certificate_${certificateNumber}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Отправка сертификата повторно
async function resendCertificate(id) {
    if (!confirm('Отправить сертификат покупателю повторно на email?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/certificates/admin/certificate/${id}/resend`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Сертификат успешно отправлен повторно');
        } else {
            showError(result.error || 'Ошибка при отправке сертификата');
        }
    } catch (error) {
        console.error('Ошибка при отправке сертификата:', error);
        showError('Ошибка при отправке сертификата: ' + error.message);
    }
}

function editCertificate(id) {
    alert('Редактирование будет реализовано в следующем этапе. ID: ' + id);
}

function extendCertificate(id) {
    alert('Продление срока будет реализовано в следующем этапе. ID: ' + id);
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
                        <span>Групповые тренировки (аренда):</span>
                        <span class="amount expense">${formatCurrency(data.group_expenses)}</span>
                    </div>
                    <div class="summary-item">
                        <span>Индивидуальные тренировки (аренда):</span>
                        <span class="amount expense">${formatCurrency(data.individual_expenses)}</span>
                    </div>
                    <div class="summary-item">
                        <span>ЗП Инструкторов:</span>
                        <span class="amount expense">${formatCurrency(data.trainer_salary_expenses)}</span>
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
    
    // Проверяем, не выполняется ли уже отправка (используем data-атрибут формы)
    if (event.target.dataset.submitting === 'true') {
        console.log('Форма создания тренировки уже отправляется, игнорируем повторное нажатие');
        return;
    }
    
    // Устанавливаем флаг отправки
    event.target.dataset.submitting = 'true';
    
    // Получаем кнопку отправки и блокируем её
    const submitButton = event.target.querySelector('button[type="submit"]');
    const originalButtonText = submitButton ? submitButton.textContent : '';
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Создание...';
    }
    
    try {
        const formData = new FormData(event.target);
        const data = Object.fromEntries(formData.entries());
        
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
    } finally {
        // Восстанавливаем кнопку
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
        event.target.dataset.submitting = 'false';
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
                                    <th>Действия</th>
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
                                            <td>
                                                <button 
                                                    class="btn-danger btn-small" 
                                                    onclick="removeParticipantFromTraining(${training.id}, ${participant.id}, '${participant.full_name}')"
                                                    title="Удалить участника с возвратом средств">
                                                    ❌ Удалить
                                                </button>
                                            </td>
                                        </tr>
                                    `;
                                }).join('') : '<tr><td colspan="5">Нет участников</td></tr>'}
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

// Просмотр деталей тренировки из расписания (групповой или индивидуальной)
async function viewScheduleDetails(trainingId, isIndividual, slopeType) {
    try {
        let training;
        
        if (isIndividual) {
            // Запрос деталей индивидуальной тренировки
            const response = await fetch(`/api/individual-trainings/${trainingId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            training = await response.json();
            training.is_individual = true;
        } else {
            // Запрос деталей групповой тренировки
            const response = await fetch(`/api/trainings/${trainingId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            training = await response.json();
            training.is_individual = false;
        }
        
        // Определяем тип склона из переданного параметра или из данных тренировки
        if (slopeType) {
            training.slope_type = slopeType;
        } else if (!training.slope_type) {
            // Если не указан явно, определяем по наличию simulator_id
            training.slope_type = training.simulator_id ? 'simulator' : 'natural_slope';
        }
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        
        if (training.is_individual) {
            // Модальное окно для индивидуальной тренировки
            const participant = training.participant;
            const birthDate = new Date(participant.birth_date);
            const age = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
            const equipmentName = training.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд';
            const trainerText = training.with_trainer ? 'С тренером' : 'Без тренера';
            
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Детали индивидуальной тренировки</h3>
                    <div class="training-details">
                        <div class="detail-group">
                            <h4>Основная информация</h4>
                            <p><strong>Дата:</strong> ${formatDate(training.preferred_date)}</p>
                            <p><strong>Время:</strong> ${training.start_time.slice(0,5)} - ${training.end_time.slice(0,5)}</p>
                            <p><strong>Длительность:</strong> ${training.duration} минут</p>
                            <p><strong>Тренажёр:</strong> ${training.simulator_name}</p>
                            <p><strong>Тип:</strong> ${equipmentName}</p>
                            <p><strong>Тренер (требуется):</strong> ${trainerText}</p>
                            ${training.with_trainer ? `
                                <p><strong>Назначен:</strong> 
                                    <span id="assigned-trainer-${trainingId}">
                                        ${training.trainer_name 
                                            ? `${training.trainer_name} (${training.trainer_phone})` 
                                            : '<span style="color: #ff6b6b;">Не назначен</span>'}
                                    </span>
                                </p>
                                ${!training.trainer_name ? `
                                    <div class="form-group" style="margin-top: 16px; padding: 16px; background: #f8f9fa; border-radius: 8px;" id="trainer-assignment-${trainingId}">
                                        <label style="font-weight: 600; margin-bottom: 8px; display: block;">Назначить тренера:</label>
                                        <select id="trainer-select-${trainingId}" class="form-control" style="width: 100%; padding: 8px; margin-bottom: 8px;">
                                            <option value="">Загрузка...</option>
                                        </select>
                                        <button 
                                            class="btn-primary" 
                                            onclick="assignTrainer(${trainingId}, '${training.equipment_type}')">
                                            Назначить тренера
                                        </button>
                                    </div>
                                ` : `
                                    <div style="margin-top: 12px;">
                                        <button 
                                            class="btn-secondary" 
                                            onclick="showChangeTrainerForm(${trainingId}, '${training.equipment_type}', '${training.trainer_name}')">
                                            🔄 Изменить тренера
                                        </button>
                                    </div>
                                `}
                            ` : ''}
                            <p><strong>Цена:</strong> ${training.price} ₽</p>
                        </div>
                        <div class="detail-group">
                            <h4>Информация об участнике</h4>
                            <table class="participants-table">
                                <thead>
                                    <tr>
                                        ${participant.is_child ? '<th>ФИО участника</th><th>ФИО родителя</th>' : '<th>ФИО</th>'}
                                        <th>Возраст</th>
                                        ${participant.skill_level ? '<th>Уровень</th>' : ''}
                                        <th>Контактный телефон</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        ${participant.is_child ? 
                                            `<td>${participant.full_name}</td><td>${participant.parent_name || '-'}</td>` : 
                                            `<td>${participant.full_name}</td>`
                                        }
                                        <td>${age} лет</td>
                                        ${participant.skill_level ? `<td>${participant.skill_level}</td>` : ''}
                                        <td>${participant.phone || '-'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-danger" onclick="deleteIndividualTraining(${trainingId})">
                            Удалить тренировку
                        </button>
                        <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                    </div>
                </div>
            `;
        } else {
            // Модальное окно для групповой тренировки
            const isNaturalSlope = training.slope_type === 'natural_slope';
            const totalPrice = training.price != null ? parseFloat(training.price) : null;
            const maxParticipants = training.max_participants || 1;
            const pricePerPerson = totalPrice && maxParticipants > 0 ? (totalPrice / maxParticipants).toFixed(2) : null;
            
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Детали групповой тренировки</h3>
                    <div class="training-details">
                        <div class="detail-group">
                            <h4>Основная информация</h4>
                            <p><strong>Дата:</strong> ${formatDate(training.session_date)}</p>
                            <p><strong>Время:</strong> ${training.start_time.slice(0,5)} - ${training.end_time.slice(0,5)}</p>
                            ${!isNaturalSlope && training.simulator_id ? `<p><strong>Тренажёр:</strong> Тренажёр ${training.simulator_id}</p>` : ''}
                            <p><strong>Группа:</strong> ${training.group_name || 'Не указана'}</p>
                            <p><strong>Тренер:</strong> ${training.trainer_name || 'Не указан'}</p>
                            <p><strong>Уровень:</strong> ${training.skill_level || '-'}</p>
                            ${totalPrice != null ? `
                                <p><strong>Цена общая:</strong> ${totalPrice.toFixed(2)} ₽</p>
                                ${pricePerPerson ? `<p><strong>Цена за человека:</strong> ${pricePerPerson} ₽</p>` : ''}
                            ` : '<p><strong>Цена:</strong> -</p>'}
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
                                        <th>Действия</th>
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
                                                <td>
                                                    <button 
                                                        class="btn-primary btn-small" 
                                                        onclick="moveParticipantToAnotherTraining(${training.id}, ${participant.id}, '${(participant.full_name || '').replace(/'/g, "\\'")}', ${participant.skill_level ? `'${participant.skill_level}'` : 'null'}, ${age}, '${participant.birth_date}', '${training.slope_type || (training.simulator_id ? 'simulator' : 'natural_slope')}')"
                                                        title="Переместить участника на другую тренировку"
                                                        style="margin-right: 5px;">
                                                        🔄 Переместить
                                                    </button>
                                                    <button 
                                                        class="btn-danger btn-small" 
                                                        onclick="removeParticipantFromTraining(${training.id}, ${participant.id}, '${participant.full_name}')"
                                                        title="Удалить участника с возвратом средств">
                                                        ❌ Удалить
                                                    </button>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('') : '<tr><td colspan="5">Нет участников</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
                    </div>
                </div>
            `;
        }
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Автоматически загружаем тренеров если нужно
        if (training.is_individual && training.with_trainer && !training.trainer_name) {
            loadAvailableTrainers(trainingId, training.equipment_type);
        }

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

// Удаление индивидуальной тренировки с возвратом средств
async function deleteIndividualTraining(trainingId) {
    if (!confirm('Вы уверены, что хотите удалить эту индивидуальную тренировку? Средства будут возвращены клиенту.')) {
        return;
    }
    
    // Находим модальное окно заранее
    const modal = document.querySelector('.modal');
    
    try {
        const response = await fetch(`/api/individual-trainings/${trainingId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Закрываем модальное окно
        if (modal) {
            modal.remove();
        }
        
        // Показываем сообщение об успехе
        showSuccess(`Индивидуальная тренировка успешно удалена. Возвращено ${result.refund.amount} ₽ клиенту ${result.refund.client_name}. Новый баланс: ${result.refund.new_balance} ₽`);
        
        // Перезагружаем расписание
        await loadSchedule();
    } catch (error) {
        console.error('Ошибка при удалении индивидуальной тренировки:', error);
        
        // Закрываем модальное окно даже при ошибке
        if (modal) {
            modal.remove();
        }
        
        showError('Не удалось удалить индивидуальную тренировку');
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
    // Попробовать найти .admin-content, если не найден - использовать body
    const container = document.querySelector('.admin-content') || document.body;
    
    const successDiv = document.createElement('div');
    successDiv.className = 'alert alert-success';
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 300px;
        max-width: 500px;
        font-weight: 500;
        opacity: 0;
        transform: translateY(-20px);
        transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    successDiv.textContent = '✅ ' + message;
    
    // Добавить на страницу
    document.body.appendChild(successDiv);
    
    // Анимация появления
    setTimeout(() => {
        successDiv.style.opacity = '1';
        successDiv.style.transform = 'translateY(0)';
    }, 10);
    
    // Автоматическое удаление через 5 секунд
    setTimeout(() => {
        successDiv.style.opacity = '0';
        successDiv.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 300);
    }, 5000);
    
    console.log('Сообщение об успехе отображено:', message);
}

// Закрытие модальных окон при клике вне их области
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

// Закрытие модальных окон при клике вне их области
window.addEventListener('click', (e) => {
    // Исключаем модальное окно отправки сообщений - оно закрывается только по кнопке "Отмена"
    if (e.target.classList.contains('modal') && e.target.id !== 'notify-clients-modal') {
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
        const token = getCookie('adminToken');
        const response = await fetch(`/api/trainings/${trainingId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при удалении тренировки');
        }

        showSuccess('Тренировка успешно удалена');
        
        // Добавляем небольшую задержку перед обновлением списка
        setTimeout(() => {
            loadTrainings(); // Перезагружаем список тренировок
        }, 500);
        
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

// Функция для обновления статуса отзыва клиента
async function updateReviewStatus(clientId, reviewType, isChecked) {
    try {
        console.log(`Обновление статуса отзыва: клиент ${clientId}, тип ${reviewType}, значение ${isChecked}`);
        
        const response = await fetch(`/api/clients/${clientId}/review-status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reviewType: reviewType,
                value: isChecked
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка при обновлении статуса отзыва');
        }

        const result = await response.json();
        console.log('Статус отзыва обновлен:', result);
        
        // Показываем уведомление об успешном обновлении
        const reviewName = reviewType === '2gis' ? '2ГИС' : 'Яндекс Карты';
        const statusText = isChecked ? 'оставлен' : 'не оставлен';
        showSuccess(`Отзыв на ${reviewName} отмечен как "${statusText}"`);
        
    } catch (error) {
        console.error('Ошибка при обновлении статуса отзыва:', error);
        showError(error.message || 'Не удалось обновить статус отзыва');
        
        // Возвращаем чекбокс в предыдущее состояние
        loadClients();
    }
}

// Функция для переключения статуса спортсмена
async function toggleClientAthleteStatus(clientId, currentStatus) {
    try {
        console.log(`Переключение статуса спортсмена: клиент ${clientId}, текущий статус ${currentStatus}`);
        
        const response = await fetch(`/api/clients/${clientId}/athlete-status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                is_athlete: !currentStatus
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка при обновлении статуса спортсмена');
        }

        const result = await response.json();
        console.log('Статус спортсмена обновлен:', result);
        
        // Показываем уведомление об успешном обновлении
        const statusText = !currentStatus ? 'спортсменом' : 'обычным клиентом';
        showSuccess(`Клиент отмечен как ${statusText}`);
        
        // Перезагружаем список клиентов для обновления данных
        await loadClients();
        
    } catch (error) {
        console.error('Ошибка при обновлении статуса спортсмена:', error);
        showError(error.message || 'Не удалось обновить статус спортсмена');
        
        // Возвращаем чекбокс в предыдущее состояние
        await loadClients();
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
        case 'subscription_purchase': return 'Покупка абонемента';
        case 'subscription_usage': return 'Запись по абонементу';
        case 'subscription_return': return 'Возврат занятия в абонемент';
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
        
        // Закрываем модальное окно уволенных, если открыто
        const dismissedModal = document.getElementById('dismissed-trainers-modal');
        if (dismissedModal) {
            dismissedModal.remove();
        }
        
        // Перезагружаем текущую вкладку
        const activeTab = document.querySelector('.trainer-tab.active');
        if (activeTab && activeTab.dataset.trainerType === 'kuliga') {
            loadKuligaInstructorsForTrainersPage();
        } else {
            await loadTrainers();
        }
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

// Функция конвертации Markdown в HTML для Telegram
function markdownToHtml(text) {
    if (!text) return '';
    
    let html = text;
    
    // Сначала сохраняем уже существующие HTML-теги (например, <u>текст</u>)
    // Используем уникальный плейсхолдер с невидимыми символами, который не конфликтует с Markdown
    const htmlPlaceholders = [];
    let htmlIdx = 0;
    
    // Сохраняем все HTML теги с их содержимым (не жадный режим)
    const htmlTagPattern = /<(u|b|i|s|code|a|pre)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match;
    const matches = [];
    while ((match = htmlTagPattern.exec(html)) !== null) {
        matches.push({
            full: match[0],
            start: match.index,
            end: match.index + match[0].length
        });
    }
    
    // Заменяем с конца, чтобы не сбить индексы
    // Используем плейсхолдер с невидимыми символами, чтобы избежать конфликтов
    for (let i = matches.length - 1; i >= 0; i--) {
        const placeholder = `\u0001HTML${htmlIdx}\u0001`;
        htmlPlaceholders[htmlIdx] = matches[i].full;
        html = html.substring(0, matches[i].start) + placeholder + html.substring(matches[i].end);
        htmlIdx++;
    }
    
    // Конвертируем Markdown в HTML (обрабатываем в правильном порядке)
    
    // Моноширинный: `текст` -> <code>текст</code>
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Зачеркнутый: ~текст~ -> <s>текст</s>
    html = html.replace(/~([^~]+)~/g, '<s>$1</s>');
    
    // Жирный: **текст** -> <b>текст</b> (двойные звездочки обрабатываем первыми)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    
    // Курсив: _текст_ -> <i>текст</i>
    // Обрабатываем все случаи _текст_ (не внутри звездочек и других символов)
    html = html.replace(/_([^_\n]+)_/g, '<i>$1</i>');
    
    // Жирный: *текст* -> <b>текст</b> (одиночные звездочки)
    // Обрабатываем только одиночные звездочки
    html = html.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
    
    // Восстанавливаем сохраненные HTML-теги (в обратном порядке, чтобы индексы совпали)
    for (let i = htmlPlaceholders.length - 1; i >= 0; i--) {
        html = html.replace(`\u0001HTML${i}\u0001`, htmlPlaceholders[i]);
    }
    
    // Экранируем специальные символы HTML, но сохраняем теги форматирования
    const formatPlaceholders = [];
    let fmtIdx = 0;
    
    html = html.replace(/<(b|i|u|s|code|a|pre)(\s[^>]*)?>|<\/(b|i|u|s|code|a|pre)>/gi, (match) => {
        const placeholder = `\u0002FMT${fmtIdx}\u0002`;
        formatPlaceholders[fmtIdx] = match;
        fmtIdx++;
        return placeholder;
    });
    
    // Экранируем остальные символы
    html = html.replace(/&/g, '&amp;');
    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Восстанавливаем теги форматирования
    formatPlaceholders.forEach((tag, index) => {
        html = html.replace(`\u0002FMT${index}\u0002`, tag);
    });
    
    return html;
}

// Новая функция для отправки сообщений с поддержкой медиа и форматирования
async function handleNotifyFormSubmitWithMedia(event, mediaFile, mediaType) {
    event.preventDefault();
    const form = event.target;
    const rawMessage = form.querySelector('#notify-message').value.trim();
    const recipientType = form.querySelector('#recipient-type').value;
    const clientSelect = form.querySelector('#notify-client-select');
    const groupSelect = form.querySelector('#group-select');
    const scheduleCheckbox = form.querySelector('#schedule-message');
    const scheduleDatetime = form.querySelector('#schedule-datetime');

    if (!rawMessage) {
        showError('Введите текст сообщения');
        return;
    }

    // Проверка: если отправляем всем пользователям, запрашиваем подтверждение
    if (recipientType === 'all') {
        // Создаем модальное окно подтверждения с HTML-форматированием
        const confirmed = await new Promise((resolve) => {
            const confirmModal = document.createElement('div');
            confirmModal.className = 'modal';
            confirmModal.style.display = 'flex';
            confirmModal.style.zIndex = '10002';
            confirmModal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <h3 style="margin-top: 0;">Подтверждение отправки</h3>
                    <p style="font-size: 16px; line-height: 1.6;">
                        Вы уверены, что хотите отправить это сообщение <strong style="font-weight: bold; font-size: 18px;">ВСЕМ ПОЛЬЗОВАТЕЛЯМ</strong>?
                    </p>
                    <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                        <button class="btn-secondary" id="confirm-cancel-btn" style="padding: 10px 20px;">Отмена</button>
                        <button class="btn-primary" id="confirm-send-btn" style="padding: 10px 20px;">Да, отправить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(confirmModal);

            const cleanup = () => {
                confirmModal.remove();
            };

            const cancelBtn = confirmModal.querySelector('#confirm-cancel-btn');
            const sendBtn = confirmModal.querySelector('#confirm-send-btn');

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });

            sendBtn.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });

            // Закрытие по клику вне модального окна
            confirmModal.addEventListener('click', (e) => {
                if (e.target === confirmModal) {
                    cleanup();
                    resolve(false);
                }
            });
        });

        if (!confirmed) {
            return; // Пользователь отменил отправку
        }
    }

    // Проверяем, что медиафайл все еще доступен после подтверждения
    // Если файл недоступен, пытаемся получить его из input элемента
    let finalMediaFile = mediaFile;
    let finalMediaType = mediaType;
    
    if (!finalMediaFile) {
        // Пытаемся получить файл из input элемента
        const mediaUploadInput = form.querySelector('#media-upload');
        if (mediaUploadInput && mediaUploadInput.files && mediaUploadInput.files.length > 0) {
            finalMediaFile = mediaUploadInput.files[0];
            finalMediaType = finalMediaFile.type.startsWith('image/') ? 'photo' : 'video';
            console.log('[handleNotifyFormSubmitWithMedia] Медиафайл восстановлен из input:', {
                name: finalMediaFile.name,
                type: finalMediaFile.type,
                size: finalMediaFile.size
            });
        }
    } else {
        console.log('[handleNotifyFormSubmitWithMedia] Медиафайл после подтверждения:', {
            name: finalMediaFile.name,
            type: finalMediaFile.type,
            size: finalMediaFile.size,
            mediaType: finalMediaType
        });
    }

    // Конвертируем Markdown в HTML перед отправкой
    const message = markdownToHtml(rawMessage);

    // Проверяем, редактируется ли существующее сообщение
    const editingMessageId = form.dataset.editingMessageId;
    if (editingMessageId) {
        // Если редактируем существующее сообщение, используем функцию обновления
        if (typeof updateScheduledMessage === 'function') {
            await updateScheduledMessage(editingMessageId, form);
            return;
        }
    }
    
    // Проверяем, отложенное ли это сообщение
    const isScheduled = scheduleCheckbox && scheduleCheckbox.checked;
    if (isScheduled) {
        if (!scheduleDatetime || !scheduleDatetime.value) {
            showError('Укажите дату и время отправки');
            return;
        }
        
        // Отправляем как отложенное сообщение
        try {
            showLoading('Создание отложенного сообщения...');
            
            const formData = new FormData();
            formData.append('message', message);
            formData.append('recipient_type', recipientType);
            formData.append('parse_mode', 'HTML');
            
            if (recipientType === 'client') {
                const clientId = clientSelect ? clientSelect.value : null;
                if (!clientId) {
                    showError('Выберите клиента');
                    hideLoading();
                    return;
                }
                formData.append('recipient_id', clientId);
            }
            
            // Конвертируем локальное время в ISO строку для отправки на сервер
            const scheduledDateTime = new Date(scheduleDatetime.value);
            formData.append('scheduled_at', scheduledDateTime.toISOString());
            
            if (finalMediaFile) {
                formData.append('media', finalMediaFile);
                formData.append('media_type', finalMediaType);
            }
            
            const response = await fetch('/api/trainings/scheduled-messages', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Ошибка при создании отложенного сообщения');
            }
            
            const scheduledDate = new Date(scheduleDatetime.value);
            const formattedDate = scheduledDate.toLocaleString('ru-RU', {
                timeZone: 'Asia/Yekaterinburg',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            showSuccess(`Отложенное сообщение создано. Будет отправлено: ${formattedDate}`);
            hideLoading();
            
            // Удаляем флаг редактирования, если был
            delete form.dataset.editingMessageId;
            
            // Закрываем модальное окно и очищаем форму
            document.getElementById('notify-clients-modal').style.display = 'none';
            form.reset();
            if (form.querySelector('#notify-preview')) {
                form.querySelector('#notify-preview').innerHTML = '';
            }
            
            // Очищаем поиск клиентов
            const clientSearchInput = form.querySelector('#notify-client-search-input');
            const clientSelectHidden = form.querySelector('#notify-client-select');
            if (clientSearchInput) clientSearchInput.value = '';
            if (clientSelectHidden) clientSelectHidden.value = '';
            const clientSearchResults = form.querySelector('#notify-client-search-results');
            if (clientSearchResults) clientSearchResults.style.display = 'none';
            
            // Очищаем медиа
            const removeMediaBtn = form.querySelector('#remove-media-btn');
            if (removeMediaBtn) {
                removeMediaBtn.click();
            }
            
            // Скрываем контейнер отложенной отправки
            const scheduleCheckbox = form.querySelector('#schedule-message');
            const scheduleContainer = form.querySelector('#schedule-datetime-container');
            if (scheduleCheckbox) {
                scheduleCheckbox.checked = false;
            }
            if (scheduleContainer) {
                scheduleContainer.style.display = 'none';
            }
            
            return;
        } catch (error) {
            console.error('Ошибка при создании отложенного сообщения:', error);
            hideLoading();
            showError(error.message);
            return;
        }
    }

    let endpoint;
    let recipientId = null;

    switch (recipientType) {
        case 'all':
            endpoint = '/api/trainings/notify-clients';
            break;
        case 'client':
            const clientId = clientSelect ? clientSelect.value : null;
            if (!clientId) {
                showError('Выберите клиента');
                return;
            }
            recipientId = clientId;
            endpoint = `/api/trainings/notify-client/${recipientId}`;
            break;
        case 'group':
            if (!groupSelect || !groupSelect.value) {
                showError('Выберите групповую тренировку');
                return;
            }
            recipientId = groupSelect.value;
            endpoint = `/api/trainings/notify-group/${recipientId}`;
            break;
        default:
            showError('Неверный тип получателей');
            return;
    }

    try {
        showLoading('Отправка сообщения...');

        // Если есть медиа, используем FormData
        if (finalMediaFile) {
            console.log('[handleNotifyFormSubmitWithMedia] Отправка с медиафайлом:', {
                endpoint: endpoint,
                fileName: finalMediaFile.name,
                fileType: finalMediaFile.type,
                fileSize: finalMediaFile.size,
                mediaType: finalMediaType,
                messageLength: message.length
            });
            
            const formData = new FormData();
            formData.append('message', message);
            formData.append('media', finalMediaFile);
            formData.append('mediaType', finalMediaType);
            formData.append('parse_mode', 'HTML'); // Используем HTML для поддержки <u>

            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
                // НЕ устанавливаем Content-Type, браузер автоматически установит multipart/form-data
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Ошибка при отправке сообщения');
            }

            showSuccess(result.message || 'Сообщение успешно отправлено');
        } else {
            // Если медиа нет, отправляем JSON с форматированием
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    message, 
                    parse_mode: 'HTML' // Используем HTML для поддержки всех тегов
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Ошибка при отправке сообщения');
            }

            showSuccess(result.message || 'Сообщение успешно отправлено');
        }

        // Закрываем модальное окно и очищаем форму
        document.getElementById('notify-clients-modal').style.display = 'none';
        form.reset();
        if (form.querySelector('#notify-preview')) {
            form.querySelector('#notify-preview').innerHTML = '';
        }
        
        // Очищаем медиа
        const removeMediaBtn = form.querySelector('#remove-media-btn');
        if (removeMediaBtn) {
            removeMediaBtn.click();
        }
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// Старая функция (оставляем для совместимости, если где-то используется)
async function handleNotifyFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const message = form.querySelector('#notify-message').value.trim();
    const recipientType = form.querySelector('#recipient-type').value;
    const clientSelect = form.querySelector('#notify-client-select');
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
        
        const response = await fetch('/api/applications?status=ungrouped', {
            headers: {
                'Authorization': `Bearer ${getCookie('adminToken')}`
            }
        });
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

    // Фильтруем заявки (показываем только ungrouped)
    let filteredApplications = allApplications.filter(application => {
        // Показываем только не выполненные заявки
        if (application.group_status !== 'ungrouped') {
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
                    <th>Телефон</th>
                    <th>Тип заявки</th>
                    <th>Оборудование</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${filteredApplications.map((application, index) => {
                    const clientName = application.client_name || application.child_name || 'Не указан';
                    const usernameDisplay = application.telegram_username ? ` <strong>${application.telegram_username}</strong>` : '';
                    const clientDisplay = clientName !== 'Не указан' ? `${clientName}${usernameDisplay}` : clientName;
                    return `
                    <tr class="application-row application-status-${application.group_status}">
                        <td>${index + 1}</td>
                        <td>${formatDate(application.preferred_date)} ${application.preferred_time}</td>
                        <td>${clientDisplay}</td>
                        <td>${application.client_phone || '-'}</td>
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
                    `;
                }).join('')}
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
        
        // Если заявка стала выполненной или отмененной, она исчезнет из списка
        // Если стала не выполненной, останется в списке
        loadApplications(); // Перезагружаем список
    } catch (error) {
        console.error('Ошибка при обновлении статуса заявки:', error);
        showError('Не удалось обновить статус заявки');
    }
}

// Функция загрузки клиентов (оставляем для других целей)

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
// Функция удалена - администратор не создает заявки

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
                        <p><strong>Дата тренировки:</strong> ${formatDate(application.preferred_date)} ${application.preferred_time}</p>
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
        
        // Функция для нормализации номера кошелька (убирает дефисы и пробелы)
        const normalizeWalletNumber = (wallet) => {
            if (!wallet) return '';
            return String(wallet).replace(/[-\s]/g, '').toLowerCase();
        };
        
        const normalizedQuery = normalizeWalletNumber(queryLower);
        
        const filteredClients = allClients.filter(client => {
            const fullNameMatch = client.full_name ? client.full_name.toLowerCase().includes(queryLower) : false;
            const phoneMatch = client.phone ? client.phone.toLowerCase().includes(queryLower) : false;
            // Нормализуем номер кошелька (убираем дефисы) и ищем по нормализованному запросу
            const walletNumber = normalizeWalletNumber(client.wallet_number);
            const walletMatch = walletNumber && walletNumber.includes(normalizedQuery);
            return fullNameMatch || phoneMatch || walletMatch;
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

// Инициализация пополнения кошелька (перенесена в основной обработчик)

// Также инициализируем при переключении на страницу финансов
const originalLoadPageContent = loadPageContent;
loadPageContent = async function(page) {
    await originalLoadPageContent(page);
    
    if (page === 'finances') {
        // Переинициализируем пополнение кошелька после загрузки страницы
        setTimeout(initializeWalletRefill, 100);
    }
};

// Функция для открытия страницы управления постоянным расписанием
function openRecurringSchedule() {
    // Получаем токен из cookies (как это делает система авторизации)
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }
    
    const token = getCookie('adminToken');
    
    if (!token) {
        alert('Ошибка авторизации. Пожалуйста, перезайдите в систему.');
        return;
    }
    
    // Открываем в новой вкладке
    const newWindow = window.open('recurring-schedule.html', '_blank');
    
    // Передаем токен в новое окно через localStorage
    if (newWindow) {
        newWindow.addEventListener('load', () => {
            try {
                newWindow.localStorage.setItem('authToken', token);
                console.log('Токен передан в новое окно');
            } catch (error) {
                console.error('Ошибка при передаче токена:', error);
            }
        });
    }
}

// Функция для открытия страницы управления блокировками слотов
function openScheduleBlocks() {
    // Получаем токен из cookies (как это делает система авторизации)
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }
    
    const token = getCookie('adminToken');
    
    if (!token) {
        alert('Ошибка авторизации. Пожалуйста, перезайдите в систему.');
        return;
    }
    
    // Открываем в новой вкладке
    const newWindow = window.open('schedule-blocks.html', '_blank');
    
    // Передаем токен в новое окно через localStorage
    if (newWindow) {
        newWindow.addEventListener('load', () => {
            try {
                newWindow.localStorage.setItem('authToken', token);
                console.log('Токен передан в новое окно для блокировок');
            } catch (error) {
                console.error('Ошибка при передаче токена:', error);
            }
        });
    }
}

// Функция для открытия модального окна отправки сообщения конкретному клиенту
function openClientNotifyModal(clientId, clientName) {
    const modal = document.getElementById('client-notify-modal');
    if (!modal) {
        console.error('Модальное окно client-notify-modal не найдено');
        return;
    }

    // Сохраняем ID и имя клиента в data-атрибуты модального окна
    modal.dataset.clientId = clientId;
    modal.dataset.clientName = clientName;

    // Обновляем заголовок модального окна
    const modalTitle = modal.querySelector('h3');
    if (modalTitle) {
        modalTitle.textContent = `Отправить сообщение: ${clientName}`;
    }

    // Очищаем текстовое поле и предпросмотр
    const messageInput = modal.querySelector('#client-notify-message');
    const previewBox = modal.querySelector('#client-notify-preview');
    if (messageInput) {
        messageInput.value = '';
    }
    if (previewBox) {
        previewBox.textContent = '';
    }

    // Инициализируем обработчики эмодзи
    initClientEmojiHandlers();

    // Показываем модальное окно
    modal.style.display = 'block';
}

// Функция инициализации обработчиков эмодзи для модального окна клиента
function initClientEmojiHandlers() {
    const modal = document.getElementById('client-notify-modal');
    if (!modal) return;

    const messageInput = modal.querySelector('#client-notify-message');
    const previewBox = modal.querySelector('#client-notify-preview');
    const emojiPanel = modal.querySelector('#client-emoji-panel');

    if (!messageInput || !previewBox || !emojiPanel) return;

    // Обработчик изменения текста для обновления предпросмотра
    messageInput.removeEventListener('input', updateClientPreview);
    messageInput.addEventListener('input', updateClientPreview);

    function updateClientPreview() {
        previewBox.textContent = messageInput.value || '';
    }

    // Обработчики для кнопок эмодзи
    const emojiButtons = emojiPanel.querySelectorAll('.emoji-btn');
    emojiButtons.forEach(button => {
        // Удаляем старые обработчики, если они есть
        button.replaceWith(button.cloneNode(true));
    });

    // Добавляем новые обработчики
    const newEmojiButtons = emojiPanel.querySelectorAll('.emoji-btn');
    newEmojiButtons.forEach(button => {
        button.addEventListener('click', () => {
            const emoji = button.textContent;
            const cursorPos = messageInput.selectionStart;
            const textBefore = messageInput.value.substring(0, cursorPos);
            const textAfter = messageInput.value.substring(cursorPos);
            
            messageInput.value = textBefore + emoji + textAfter;
            messageInput.focus();
            messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
            
            // Обновляем предпросмотр
            updateClientPreview();
        });
    });
}

// Функция для отправки сообщения конкретному клиенту
async function sendClientNotification() {
    const modal = document.getElementById('client-notify-modal');
    if (!modal) return;

    const clientId = modal.dataset.clientId;
    const clientName = modal.dataset.clientName;
    const messageInput = modal.querySelector('#client-notify-message');
    
    if (!messageInput || !messageInput.value.trim()) {
        showError('Введите текст сообщения');
        return;
    }

    const message = messageInput.value.trim();

    try {
        showLoading('Отправка сообщения...');
        
        const response = await fetch(`/api/trainings/notify-client/${clientId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при отправке сообщения');
        }

        showSuccess(`Сообщение успешно отправлено клиенту ${clientName}`);
        modal.style.display = 'none';
        messageInput.value = '';
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// Функция для удаления участника из тренировки (тренажер)
async function removeParticipantFromTraining(trainingId, participantId, participantName) {
    // Подтверждение удаления
    if (!confirm(`Вы уверены, что хотите удалить участника "${participantName}" из тренировки?\n\nДействия:\n✅ Статус участника будет изменен на "отменено"\n💰 Средства будут возвращены на счет клиента\n📨 Клиент получит уведомление об удалении\n📱 Администратор получит уведомление`)) {
        return;
    }

    try {
        showLoading('Удаление участника...');

        const response = await fetch(`/api/trainings/${trainingId}/participants/${participantId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при удалении участника');
        }

        showSuccess(`Участник "${participantName}" успешно удален из тренировки\nВозврат: ${result.refund} руб.\nОсталось участников: ${result.remaining_participants}`);
        
        // Закрываем модальное окно
        const modal = document.querySelector('.modal');
        if (modal) {
            modal.remove();
        }

        // Обновляем список тренировок
        if (typeof loadTrainings === 'function') {
            loadTrainings();
        }
        
        // Обновляем расписание
        if (typeof loadSchedule === 'function') {
            await loadSchedule();
        }
    } catch (error) {
        console.error('Ошибка при удалении участника:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// Функция для удаления бронирования Kuliga (естественный склон)
async function removeKuligaBooking(groupTrainingId, bookingId, clientName, type) {
    // Подтверждение удаления
    if (!confirm(`Вы уверены, что хотите удалить бронирование клиента "${clientName}"?\n\nДействия:\n✅ Бронирование будет отменено\n💰 Средства будут возвращены на счет клиента\n📨 Клиент и тренер получат уведомления`)) {
        return;
    }

    try {
        showLoading('Удаление бронирования...');

        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        const response = await fetch(`/api/kuliga/admin/booking/${bookingId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при удалении бронирования');
        }

        showSuccess(`Бронирование клиента "${clientName}" успешно удалено\nВозврат: ${result.refund_amount ? result.refund_amount.toFixed(2) : '0.00'} руб.`);
        
        // Закрываем модальное окно
        const modal = document.querySelector('.modal');
        if (modal) {
            modal.remove();
        }

        // Обновляем расписание
        if (typeof loadSchedule === 'function') {
            await loadSchedule();
        }
    } catch (error) {
        console.error('Ошибка при удалении бронирования Kuliga:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// === ПЕРЕМЕЩЕНИЕ УЧАСТНИКА НА ДРУГУЮ ТРЕНИРОВКУ ===

// Функция для перемещения участника на другую тренировку
async function moveParticipantToAnotherTraining(trainingId, participantId, participantName, participantLevel, participantAge, participantBirthDate, slopeType) {
    try {
        showLoading('Загрузка доступных тренировок...');

        // Получаем список доступных тренировок на 2 недели
        const response = await fetch(
            `/api/trainings/available-for-transfer?slope_type=${encodeURIComponent(slopeType)}&exclude_training_id=${trainingId}`
        );

        if (!response.ok) {
            throw new Error('Не удалось загрузить список тренировок');
        }

        const data = await response.json();
        hideLoading();

        if (!data.success || !data.trainings || data.trainings.length === 0) {
            showError('Нет доступных тренировок для переноса на ближайшие 2 недели');
            return;
        }

        // Создаем модальное окно с выбором тренировки
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.zIndex = '10001';
        
        const trainingsList = data.trainings.map(training => {
            const trainingDate = new Date(training.session_date);
            const formattedDate = trainingDate.toLocaleDateString('ru-RU', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            const startTime = training.start_time ? training.start_time.slice(0, 5) : '';
            const endTime = training.end_time ? training.end_time.slice(0, 5) : '';
            
            // Проверка соответствия по уровню и возрасту
            const participantLevelStr = participantLevel && participantLevel !== 'null' ? String(participantLevel) : null;
            const trainingLevelStr = training.skill_level ? String(training.skill_level) : null;
            
            const levelMatch = !participantLevelStr || !trainingLevelStr || 
                              participantLevelStr === trainingLevelStr || 
                              parseInt(participantLevelStr) === parseInt(trainingLevelStr);
            
            const ageMatch = (!training.min_age || participantAge >= training.min_age) && 
                            (!training.max_age || participantAge <= training.max_age);
            
            const hasWarning = !levelMatch || !ageMatch;
            const warningMessages = [];
            
            if (!levelMatch && participantLevelStr && trainingLevelStr) {
                warningMessages.push(`Уровень участника (${participantLevelStr}) не совпадает с уровнем группы (${trainingLevelStr})`);
            }
            
            if (!ageMatch) {
                if (training.min_age && participantAge < training.min_age) {
                    warningMessages.push(`Возраст участника (${participantAge} лет) меньше минимального для группы (${training.min_age} лет)`);
                }
                if (training.max_age && participantAge > training.max_age) {
                    warningMessages.push(`Возраст участника (${participantAge} лет) больше максимального для группы (${training.max_age} лет)`);
                }
            }

            // Экранируем сообщения предупреждений для безопасной передачи в onclick
            const warningMessagesStr = warningMessages.map(msg => msg.replace(/'/g, "\\'")).join('|');

            return `
                <div class="training-option" data-training-id="${training.id}" style="
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    ${hasWarning ? 'border-color: #ff9800; background-color: #fff3cd;' : ''}
                " onmouseover="this.style.backgroundColor='${hasWarning ? '#ffe69c' : '#f0f0f0'}'" 
                   onmouseout="this.style.backgroundColor='${hasWarning ? '#fff3cd' : 'transparent'}'"
                   onclick="selectTrainingForTransfer(${training.id}, ${trainingId}, ${participantId}, '${participantName.replace(/'/g, "\\'")}', ${hasWarning ? 'true' : 'false'}, '${warningMessagesStr}')">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <strong>${formattedDate} ${startTime} - ${endTime}</strong>
                            <div style="margin-top: 5px; color: #666;">
                                <div>${training.group_name || 'Группа не указана'}</div>
                                <div>Тренер: ${training.trainer_name}</div>
                                ${training.simulator_name ? `<div>Тренажер: ${training.simulator_name}</div>` : ''}
                                <div>Уровень: ${training.skill_level || '-'}</div>
                                <div>Участники: ${training.current_participants}/${training.max_participants}</div>
                            </div>
                            ${hasWarning ? `
                                <div style="margin-top: 10px; padding: 10px; background-color: #fff; border-left: 3px solid #ff9800; border-radius: 4px;">
                                    <strong style="color: #ff9800;">⚠️ Предупреждение:</strong>
                                    <ul style="margin: 5px 0 0 0; padding-left: 20px;">
                                        ${warningMessages.map(msg => `<li style="color: #856404;">${msg}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                        <button class="btn-primary" style="margin-left: 15px; white-space: nowrap;" onclick="event.stopPropagation(); selectTrainingForTransfer(${training.id}, ${trainingId}, ${participantId}, '${participantName.replace(/'/g, "\\'")}', ${hasWarning ? 'true' : 'false'}, '${warningMessagesStr}')">
                            Выбрать
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
                <h3>Переместить участника "${participantName}"</h3>
                <p style="margin-bottom: 15px; color: #666;">
                    Выберите тренировку из списка доступных на ближайшие 2 недели (только ${slopeType === 'simulator' ? 'тренажер' : 'естественный склон'}):
                </p>
                <div id="trainings-list" style="max-height: 60vh; overflow-y: auto;">
                    ${trainingsList}
                </div>
                <div class="modal-actions" style="margin-top: 20px;">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
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
        console.error('Ошибка при загрузке доступных тренировок:', error);
        hideLoading();
        showError('Не удалось загрузить список тренировок: ' + error.message);
    }
}

// Функция для выбора тренировки и подтверждения переноса
async function selectTrainingForTransfer(targetTrainingId, sourceTrainingId, participantId, participantName, hasWarning, warningMessages) {
    // Если есть предупреждение, показываем подтверждение
    if (hasWarning && warningMessages) {
        // warningMessages передается как строка, разделенная символом |
        const messages = typeof warningMessages === 'string' && warningMessages 
            ? warningMessages.split('|').filter(msg => msg.trim()) 
            : (Array.isArray(warningMessages) ? warningMessages : []);
        
        if (messages.length > 0) {
            const confirmMessage = `⚠️ Внимание! Участник "${participantName}" не соответствует требованиям выбранной тренировки:\n\n` +
                messages.map(msg => `• ${msg}`).join('\n') +
                `\n\nВы всё равно хотите переместить участника на эту тренировку?`;
            
            if (!confirm(confirmMessage)) {
                return;
            }
        }
    } else {
        // Обычное подтверждение
        if (!confirm(`Вы уверены, что хотите переместить участника "${participantName}" на выбранную тренировку?`)) {
            return;
        }
    }

    try {
        showLoading('Перемещение участника...');

        const response = await fetch(
            `/api/trainings/${sourceTrainingId}/participants/${participantId}/transfer`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    target_training_id: targetTrainingId
                })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при перемещении участника');
        }

        hideLoading();
        showSuccess(`Участник "${participantName}" успешно перемещен на новую тренировку`);
        
        // Закрываем все модальные окна
        document.querySelectorAll('.modal').forEach(modal => modal.remove());

        // Обновляем список тренировок
        if (typeof loadSchedule === 'function') {
            await loadSchedule();
        } else if (typeof loadTrainings === 'function') {
            loadTrainings();
        }
    } catch (error) {
        console.error('Ошибка при перемещении участника:', error);
        hideLoading();
        showError(error.message);
    }
}

// === НАЗНАЧЕНИЕ ТРЕНЕРОВ ===

// Загрузка доступных тренеров в селектор
async function loadAvailableTrainers(trainingId, equipmentType) {
    try {
        const response = await fetch(`/api/individual-trainings/trainers/available?equipment_type=${equipmentType}`);
        if (!response.ok) throw new Error('Ошибка при загрузке тренеров');
        
        const trainers = await response.json();
        const select = document.getElementById(`trainer-select-${trainingId}`);
        
        if (!select) {
            console.error(`Селектор trainer-select-${trainingId} не найден`);
            return;
        }
        
        if (trainers.length === 0) {
            select.innerHTML = '<option value="">Нет доступных тренеров</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Выберите тренера...</option>' +
            trainers.map(t => `<option value="${t.id}">${t.full_name} (${t.phone})</option>`).join('');
            
    } catch (error) {
        console.error('Ошибка при загрузке тренеров:', error);
        showError('Не удалось загрузить список тренеров');
    }
}

// Назначение тренера на индивидуальную тренировку
async function assignTrainer(trainingId, equipmentType) {
    const select = document.getElementById(`trainer-select-${trainingId}`);
    const trainerId = select.value;
    
    if (!trainerId) {
        showError('Пожалуйста, выберите тренера');
        return;
    }
    
    try {
        showLoading('Назначение тренера...');
        
        const response = await fetch(`/api/individual-trainings/${trainingId}/assign-trainer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainer_id: trainerId })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при назначении тренера');
        }
        
        const result = await response.json();
        
        // Обновляем отображение
        const assignedSpan = document.getElementById(`assigned-trainer-${trainingId}`);
        if (assignedSpan) {
            assignedSpan.innerHTML = `${result.trainer_name} (${result.trainer_phone})`;
        }
        
        // Скрываем форму назначения
        const assignmentForm = document.getElementById(`trainer-assignment-${trainingId}`);
        if (assignmentForm) {
            assignmentForm.remove();
        }
        
        hideLoading();
        showSuccess(`Тренер ${result.trainer_name} успешно назначен!`);
        
        // Обновляем расписание
        if (typeof loadSchedule === 'function') {
            loadSchedule();
        }
        
    } catch (error) {
        hideLoading();
        console.error('Ошибка при назначении тренера:', error);
        showError(error.message || 'Не удалось назначить тренера');
    }
}

// Показать форму изменения тренера
function showChangeTrainerForm(trainingId, equipmentType, currentTrainerName) {
    // Скрываем кнопку "Изменить тренера"
    const changeButton = document.querySelector(`button[onclick="showChangeTrainerForm(${trainingId}, '${equipmentType}', '${currentTrainerName}')"]`);
    if (changeButton) {
        changeButton.style.display = 'none';
    }
    
    // Создаем форму изменения
    const formHtml = `
        <div class="form-group" style="margin-top: 16px; padding: 16px; background: #fff3cd; border-radius: 8px; border: 1px solid #ffeaa7;" id="change-trainer-form-${trainingId}">
            <label style="font-weight: 600; margin-bottom: 8px; display: block;">Изменить тренера:</label>
            <p style="margin-bottom: 12px; color: #856404; font-size: 14px;">
                Текущий: <strong>${currentTrainerName}</strong>
            </p>
            <select id="new-trainer-select-${trainingId}" class="form-control" style="width: 100%; padding: 8px; margin-bottom: 8px;">
                <option value="">Загрузка...</option>
            </select>
            <div style="display: flex; gap: 8px;">
                <button 
                    class="btn-primary" 
                    onclick="changeTrainer(${trainingId}, '${equipmentType}')">
                    ✅ Изменить
                </button>
                <button 
                    class="btn-secondary" 
                    onclick="cancelChangeTrainer(${trainingId}, '${equipmentType}', '${currentTrainerName}')">
                    ❌ Отмена
                </button>
            </div>
        </div>
    `;
    
    // Вставляем форму после информации о назначенном тренере
    const assignedSpan = document.getElementById(`assigned-trainer-${trainingId}`);
    if (assignedSpan) {
        assignedSpan.parentElement.insertAdjacentHTML('afterend', formHtml);
    }
    
    // Загружаем список тренеров
    loadAvailableTrainersForChange(trainingId, equipmentType);
}

// Загрузка тренеров для формы изменения
async function loadAvailableTrainersForChange(trainingId, equipmentType) {
    try {
        const response = await fetch(`/api/individual-trainings/trainers/available?equipment_type=${equipmentType}`);
        if (!response.ok) throw new Error('Ошибка при загрузке тренеров');
        
        const trainers = await response.json();
        const select = document.getElementById(`new-trainer-select-${trainingId}`);
        
        if (!select) {
            console.error(`Селектор new-trainer-select-${trainingId} не найден`);
            return;
        }
        
        if (trainers.length === 0) {
            select.innerHTML = '<option value="">Нет доступных тренеров</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Выберите нового тренера...</option>' +
            trainers.map(t => `<option value="${t.id}">${t.full_name} (${t.phone})</option>`).join('');
            
    } catch (error) {
        console.error('Ошибка при загрузке тренеров:', error);
        showError('Не удалось загрузить список тренеров');
    }
}

// Изменение тренера
async function changeTrainer(trainingId, equipmentType) {
    const select = document.getElementById(`new-trainer-select-${trainingId}`);
    const newTrainerId = select.value;
    
    if (!newTrainerId) {
        showError('Пожалуйста, выберите нового тренера');
        return;
    }
    
    try {
        showLoading('Изменение тренера...');
        
        const response = await fetch(`/api/individual-trainings/${trainingId}/change-trainer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainer_id: newTrainerId })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при изменении тренера');
        }
        
        const result = await response.json();
        
        // Обновляем отображение
        const assignedSpan = document.getElementById(`assigned-trainer-${trainingId}`);
        if (assignedSpan) {
            assignedSpan.innerHTML = `${result.trainer_name} (${result.trainer_phone})`;
        }
        
        // Скрываем форму изменения
        const changeForm = document.getElementById(`change-trainer-form-${trainingId}`);
        if (changeForm) {
            changeForm.remove();
        }
        
        // Показываем кнопку "Изменить тренера" снова
        const changeButton = document.querySelector(`button[onclick*="showChangeTrainerForm(${trainingId}"]`);
        if (changeButton) {
            changeButton.style.display = 'inline-block';
            changeButton.setAttribute('onclick', `showChangeTrainerForm(${trainingId}, '${equipmentType}', '${result.trainer_name}')`);
        }
        
        hideLoading();
        showSuccess(`Тренер изменен на ${result.trainer_name}!`);
        
        // Обновляем расписание
        if (typeof loadSchedule === 'function') {
            loadSchedule();
        }
        
    } catch (error) {
        hideLoading();
        console.error('Ошибка при изменении тренера:', error);
        showError(error.message || 'Не удалось изменить тренера');
    }
}

// Отмена изменения тренера
function cancelChangeTrainer(trainingId, equipmentType, currentTrainerName) {
    // Скрываем форму изменения
    const changeForm = document.getElementById(`change-trainer-form-${trainingId}`);
    if (changeForm) {
        changeForm.remove();
    }
    
    // Показываем кнопку "Изменить тренера" снова
    const changeButton = document.querySelector(`button[onclick*="showChangeTrainerForm(${trainingId}"]`);
    if (changeButton) {
        changeButton.style.display = 'inline-block';
    }
}

// ==========================================
// ФУНКЦИОНАЛ СОЗДАНИЯ АБОНЕМЕНТОВ
// ==========================================

// Проценты скидок в зависимости от количества занятий
const SUBSCRIPTION_DISCOUNTS = {
    3: 5,   // 3 занятия - 5% скидка
    5: 10,  // 5 занятий - 10% скидка
    7: 20,  // 7 занятий - 20% скидка
    10: 25  // 10 занятий - 25% скидка
};

// Загрузка цен групповых занятий для абонементов
async function loadGroupPricesForSubscription() {
    try {
        const response = await fetch('/api/winter-prices?type=group&is_active=true');
        
        if (!response.ok) {
            throw new Error('Ошибка при загрузке цен');
        }
        
        const prices = await response.json();
        
        // Фильтруем только групповые цены и сортируем по количеству участников
        const groupPrices = prices
            .filter(price => price.type === 'group')
            .sort((a, b) => {
                const aParticipants = a.participants || 0;
                const bParticipants = b.participants || 0;
                return aParticipants - bParticipants;
            });
        
        return groupPrices;
    } catch (error) {
        console.error('Ошибка при загрузке цен:', error);
        showError('Не удалось загрузить цены из прайса');
        return [];
    }
}

// Заполнение выпадающего списка цен
async function populatePriceSelect() {
    const priceSelect = document.getElementById('subscription-price-select');
    if (!priceSelect) return;
    
    // Очистить текущие опции (кроме первой)
    while (priceSelect.options.length > 1) {
        priceSelect.remove(1);
    }
    
    // Загрузить цены
    const prices = await loadGroupPricesForSubscription();
    
    if (prices.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Нет доступных цен';
        option.disabled = true;
        priceSelect.appendChild(option);
        return;
    }
    
    // Добавить опции для каждой цены
    prices.forEach(price => {
        const option = document.createElement('option');
        option.value = price.id;
        
        // Формируем текст опции: "X человек - YYYY ₽"
        const participantsText = price.participants 
            ? `${price.participants} человек`
            : 'Не указано';
        const priceText = parseFloat(price.price).toLocaleString('ru-RU');
        
        option.textContent = `${participantsText} - ${priceText} ₽`;
        option.dataset.priceId = price.id;
        option.dataset.totalPrice = price.price;
        option.dataset.participants = price.participants || '';
        
        priceSelect.appendChild(option);
    });
}

// Открытие модального окна создания абонемента
async function openSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    if (!modal) return;
    
    // Сброс формы
    document.getElementById('subscription-form').reset();
    document.getElementById('subscription-id').value = '';
        document.getElementById('subscription-modal-title').textContent = 'Создать абонемент';
        document.getElementById('subscription-submit-btn').textContent = 'Создать абонемент';
    
    // Скрыть блоки с информацией о скидке и цене
    document.getElementById('subscription-discount-controls').style.display = 'none';
    document.getElementById('subscription-discount-info').style.display = 'none';
    document.getElementById('subscription-price-info').style.display = 'none';
    
    // Сброс значений
    document.getElementById('subscription-discount').value = '';
    document.getElementById('subscription-price-id').value = '';
    document.getElementById('subscription-price-per-person').value = '';
    document.getElementById('subscription-price-per-session').value = '';
    document.getElementById('subscription-participants').value = '';
    document.getElementById('subscription-is-active').checked = true;
    
    // Сброс процентов скидки к значениям по умолчанию
    document.getElementById('discount-3').value = '5';
    document.getElementById('discount-5').value = '10';
    document.getElementById('discount-7').value = '15';
    document.getElementById('discount-10').value = '20';
    
    // Отключить выбор количества занятий до выбора цены
    const subscriptionSessions = document.getElementById('subscription-sessions');
    if (subscriptionSessions) {
        subscriptionSessions.disabled = true;
        subscriptionSessions.value = '';
    }
    
    // Добавить обработчик submit формы (удаляем старый и добавляем новый каждый раз, чтобы избежать конфликтов)
    const subscriptionForm = document.getElementById('subscription-form');
    if (subscriptionForm) {
        // Удалить старые обработчики (клонируем форму без обработчиков)
        const newForm = subscriptionForm.cloneNode(true);
        subscriptionForm.parentNode.replaceChild(newForm, subscriptionForm);
        
        // Добавить обработчик на новую форму
        const form = document.getElementById('subscription-form');
        if (form) {
            form.addEventListener('submit', handleSubscriptionSubmit);
        }
    }
    
    // Загрузить и заполнить список цен (после клонирования формы!)
    await populatePriceSelect();
    
    // Добавить обработчик изменения выбранной цены (после клонирования формы!)
    // Используем setTimeout, чтобы убедиться, что DOM обновлен после populatePriceSelect
    setTimeout(() => {
        const priceSelect = document.getElementById('subscription-price-select');
        if (priceSelect) {
            // Удалить старый обработчик, если есть, через клонирование
            const newPriceSelect = priceSelect.cloneNode(true);
            priceSelect.parentNode.replaceChild(newPriceSelect, priceSelect);
            
            // Добавить обработчик на новый элемент
            const newSelect = document.getElementById('subscription-price-select');
            if (newSelect) {
                newSelect.addEventListener('change', handlePriceSelection);
                console.log('Обработчик изменения цены добавлен на селект');
            }
        }
    }, 150);
    
    // Добавить обработчик изменения количества занятий (после клонирования формы!)
    const subscriptionSessionsNew = document.getElementById('subscription-sessions');
    if (subscriptionSessionsNew) {
        // Удалить старый обработчик, если есть
        const newSessions = subscriptionSessionsNew.cloneNode(true);
        subscriptionSessionsNew.parentNode.replaceChild(newSessions, subscriptionSessionsNew);
        
        // Добавить обработчик на новый элемент
        const newSessionsEl = document.getElementById('subscription-sessions');
        if (newSessionsEl) {
            newSessionsEl.addEventListener('change', calculateSubscriptionPrice);
        }
    }
    
    // Обработчик закрытия при клике вне модального окна
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeSubscriptionModal();
        }
    };
    
    // Открыть модальное окно
    modal.style.display = 'block';
}

// Обработчик выбора цены из прайса
function handlePriceSelection() {
    const priceSelect = document.getElementById('subscription-price-select');
    const selectedOption = priceSelect.options[priceSelect.selectedIndex];
    
    if (!selectedOption || !selectedOption.value) {
        // Если цена не выбрана, отключить выбор количества занятий
        const subscriptionSessions = document.getElementById('subscription-sessions');
        if (subscriptionSessions) {
            subscriptionSessions.disabled = true;
            subscriptionSessions.value = '';
        }
        
        // Скрыть блоки с информацией
        document.getElementById('subscription-discount-controls').style.display = 'none';
        document.getElementById('subscription-discount-info').style.display = 'none';
        document.getElementById('subscription-price-info').style.display = 'none';
        
        // Сбросить скрытые поля
        document.getElementById('subscription-price-id').value = '';
        document.getElementById('subscription-price-per-person').value = '';
        document.getElementById('subscription-price-per-session').value = '';
        document.getElementById('subscription-participants').value = '';
        
        return;
    }
    
    // Получить данные выбранной цены
    const priceId = selectedOption.value;
    const totalPrice = parseFloat(selectedOption.dataset.totalPrice);
    const participants = parseInt(selectedOption.dataset.participants) || 1;
    
    // Рассчитать цену за одного человека (для внутренних расчетов)
    const pricePerPerson = totalPrice / participants;
    
    // Сохранить в скрытые поля
    // price-per-person - цена за одного человека (для отправки на сервер)
    // price-per-session - цена за групповое занятие (для расчета абонемента)
    document.getElementById('subscription-price-id').value = priceId;
    document.getElementById('subscription-price-per-person').value = pricePerPerson;
    document.getElementById('subscription-price-per-session').value = totalPrice;
    document.getElementById('subscription-participants').value = participants;
    
    // Включить выбор количества занятий
    const subscriptionSessions = document.getElementById('subscription-sessions');
    if (subscriptionSessions) {
        subscriptionSessions.disabled = false;
        const firstOption = subscriptionSessions.querySelector('option:first-child');
        if (firstOption) {
            firstOption.textContent = 'Выберите количество занятий';
        }
        
        // Сохранить выбранное значение количества занятий, если оно уже выбрано (при редактировании)
        const currentSessionsValue = subscriptionSessions.value;
        
        // Убедиться, что обработчик события добавлен
        const currentSessions = document.getElementById('subscription-sessions');
        if (currentSessions) {
            // Удалить старый обработчик через клонирование
            const newSessionsEl = currentSessions.cloneNode(true);
            currentSessions.parentNode.replaceChild(newSessionsEl, currentSessions);
            // Добавить обработчик на новый элемент
            const newEl = document.getElementById('subscription-sessions');
            if (newEl) {
                // Восстановить выбранное значение, если оно было
                if (currentSessionsValue && currentSessionsValue !== '') {
                    newEl.value = currentSessionsValue;
                }
                if (!newEl.dataset.listenerAdded) {
                    newEl.addEventListener('change', calculateSubscriptionPrice);
                    newEl.dataset.listenerAdded = 'true';
                }
            }
        }
    }
    
    // Показать блок настройки процентов скидки
    document.getElementById('subscription-discount-controls').style.display = 'block';
    
    // Если количество занятий уже выбрано, показать блоки с информацией
    const sessionsValue = document.getElementById('subscription-sessions')?.value;
    if (sessionsValue && sessionsValue !== '') {
        // Если количество занятий уже выбрано, пересчитать цену
        calculateSubscriptionPrice();
    } else {
        // Скрыть блоки с информацией до выбора количества занятий
        document.getElementById('subscription-discount-info').style.display = 'none';
        document.getElementById('subscription-price-info').style.display = 'none';
    }
    
    // Добавить обработчики изменения процентов скидки
    const discountInputs = ['discount-3', 'discount-5', 'discount-7', 'discount-10'];
    discountInputs.forEach(discountId => {
        const discountInput = document.getElementById(discountId);
        if (discountInput) {
            // Удалить старый обработчик через клонирование
            const newInput = discountInput.cloneNode(true);
            discountInput.parentNode.replaceChild(newInput, discountInput);
            
            // Добавить обработчик на новый элемент
            const newInputEl = document.getElementById(discountId);
            if (newInputEl) {
                newInputEl.addEventListener('input', () => {
                    // Если количество занятий уже выбрано, пересчитать цену
                    const sessionsEl = document.getElementById('subscription-sessions');
                    if (sessionsEl && sessionsEl.value) {
                        calculateSubscriptionPrice();
                    }
                });
            }
        }
    });
    
    // Если количество занятий уже выбрано, пересчитать цену
    if (subscriptionSessions && subscriptionSessions.value) {
        calculateSubscriptionPrice();
    } else {
        // Иначе сбросить выбор количества занятий
        subscriptionSessions.value = '';
    }
}

// Закрытие модального окна создания абонемента
function closeSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Расчет цены абонемента при выборе количества занятий
function calculateSubscriptionPrice() {
    const sessionsSelect = document.getElementById('subscription-sessions');
    const sessionsCount = parseInt(sessionsSelect?.value) || 0;
    
    // Проверить, выбрана ли цена из прайса
    // Используем цену за одного человека (цена за занятие / количество участников)
    const pricePerPerson = parseFloat(document.getElementById('subscription-price-per-person').value);
    
    if (!pricePerPerson || pricePerPerson <= 0) {
        // Если цена не выбрана, скрыть блоки
        document.getElementById('subscription-discount-info').style.display = 'none';
        document.getElementById('subscription-price-info').style.display = 'none';
        return;
    }
    
    if (!sessionsCount || !['3', '5', '7', '10'].includes(sessionsCount.toString())) {
        // Скрыть блоки если количество не выбрано или неверное
        document.getElementById('subscription-discount-info').style.display = 'none';
        document.getElementById('subscription-price-info').style.display = 'none';
        return;
    }
    
    // Получить процент скидки из поля ввода для выбранного номинала
    const discountInput = document.getElementById(`discount-${sessionsCount}`);
    let discountPercentage = 0;
    
    if (discountInput && discountInput.value !== '') {
        discountPercentage = parseFloat(discountInput.value);
        // Если значение невалидное, использовать значение по умолчанию
        if (isNaN(discountPercentage)) {
            discountPercentage = SUBSCRIPTION_DISCOUNTS[sessionsCount] || 0;
        }
    } else {
        // Если поле ввода пустое, использовать значение по умолчанию
        discountPercentage = SUBSCRIPTION_DISCOUNTS[sessionsCount] || 0;
    }
    
    // Сохранить скидку в скрытое поле (гарантируем, что это число)
    document.getElementById('subscription-discount').value = discountPercentage;
    
    // Рассчитать цены на основе цены за одного человека
    // Цена без скидки = цена за одного человека * количество занятий
    const totalPriceWithoutDiscount = pricePerPerson * sessionsCount;
    // Цена со скидкой = цена без скидки * (1 - процент скидки)
    const totalPriceWithDiscount = totalPriceWithoutDiscount * (1 - discountPercentage / 100);
    const savings = totalPriceWithoutDiscount - totalPriceWithDiscount;
    
    // Обновить отображение скидки
    document.getElementById('subscription-discount-display').textContent = discountPercentage;
    document.getElementById('subscription-discount-info').style.display = 'block';
    
    // Рассчитать цену за одно занятие для клиента
    const pricePerSessionFinal = totalPriceWithDiscount / sessionsCount;
    
    // Обновить отображение цены
    document.getElementById('subscription-price-per-person-without').textContent = Math.round(pricePerPerson).toLocaleString('ru-RU');
    document.getElementById('subscription-price-without').textContent = Math.round(totalPriceWithoutDiscount).toLocaleString('ru-RU');
    document.getElementById('subscription-price-with').textContent = Math.round(totalPriceWithDiscount).toLocaleString('ru-RU');
    document.getElementById('subscription-savings').textContent = Math.round(savings).toLocaleString('ru-RU');
    document.getElementById('subscription-price-per-session-final').textContent = Math.round(pricePerSessionFinal).toLocaleString('ru-RU');
    document.getElementById('subscription-price-info').style.display = 'block';
}

// ==========================================
// ЗАГРУЗКА И ОТОБРАЖЕНИЕ АБОНЕМЕНТОВ
// ==========================================

// Загрузка страницы абонементов
async function loadSubscriptionsPage() {
    try {
        // Загружаем статистику
        const statsResponse = await fetch('/api/natural-slope-subscriptions/stats');
        if (!statsResponse.ok) throw new Error('Ошибка при загрузке статистики');
        const stats = await statsResponse.json();
        
        // Обновляем статистику
        document.getElementById('total-subscription-types').textContent = stats.total_types || 0;
        document.getElementById('active-subscriptions-count').textContent = stats.active_count || 0;
        document.getElementById('clients-with-subscriptions').textContent = stats.clients_with_subscriptions || 0;
        
        // Загружаем список типов абонементов
        const typesResponse = await fetch('/api/natural-slope-subscriptions/types');
        if (!typesResponse.ok) throw new Error('Ошибка при загрузке типов абонементов');
        const subscriptionTypes = await typesResponse.json();
        displaySubscriptionTypes(subscriptionTypes);
        
        // Загружаем активные абонементы клиентов
        const clientSubscriptionsResponse = await fetch('/api/natural-slope-subscriptions/client-subscriptions?status=active');
        if (clientSubscriptionsResponse.ok) {
            const clientSubscriptions = await clientSubscriptionsResponse.json();
            displayClientSubscriptions(clientSubscriptions);
        }
        
    } catch (error) {
        console.error('Ошибка при загрузке абонементов:', error);
        showError('Ошибка при загрузке абонементов: ' + error.message);
    }
}

// Отображение списка типов абонементов
function displaySubscriptionTypes(subscriptionTypes) {
    const container = document.getElementById('subscription-types-list');
    if (!container) return;
    
    if (subscriptionTypes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 18px; margin-bottom: 20px;">📭 Абонементов пока нет</p>
                <p>Создайте первый абонемент, нажав кнопку "➕ Создать абонемент"</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = subscriptionTypes.map(sub => {
        const statusBadge = sub.is_active 
            ? '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Активен</span>'
            : '<span style="background: #6b7280; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Неактивен</span>';
        
        const createdDate = new Date(sub.created_at).toLocaleDateString('ru-RU');
        const activeCount = parseInt(sub.active_subscriptions_count) || 0;
        const clientsCount = parseInt(sub.clients_count) || 0;
        
        return `
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <h4 style="margin: 0; font-size: 18px;">${sub.name}</h4>
                            ${statusBadge}
                        </div>
                        ${sub.description ? `<p style="color: #666; margin: 5px 0;">${sub.description}</p>` : ''}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-secondary" onclick="editSubscriptionType(${sub.id})" style="padding: 6px 12px; font-size: 14px;">
                            ✏️ Редактировать
                        </button>
                        <button class="btn-danger" onclick="deleteSubscriptionType(${sub.id})" style="padding: 6px 12px; font-size: 14px;">
                            🗑️ Удалить
                        </button>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Занятий</small>
                        <strong style="font-size: 16px;">${sub.sessions_count}</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Скидка</small>
                        <strong style="font-size: 16px; color: #10b981;">${parseFloat(sub.discount_percentage).toFixed(0)}%</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Цена</small>
                        <strong style="font-size: 16px;">${parseFloat(sub.price).toLocaleString('ru-RU')} ₽</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Цена за занятие</small>
                        <strong style="font-size: 16px;">${parseFloat(sub.price_per_session).toLocaleString('ru-RU')} ₽</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Действует до</small>
                        <strong style="font-size: 16px;">${sub.expires_at ? new Date(sub.expires_at).toLocaleDateString('ru-RU') : (sub.validity_days ? `${sub.validity_days} дн.` : 'Не указано')}</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Активных абонементов</small>
                        <strong style="font-size: 16px;">${activeCount}</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Клиентов</small>
                        <strong style="font-size: 16px;">${clientsCount}</strong>
                    </div>
                    <div>
                        <small style="color: #666; display: block; margin-bottom: 4px;">Создан</small>
                        <strong style="font-size: 16px;">${createdDate}</strong>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Отображение активных абонементов клиентов
function displayClientSubscriptions(clientSubscriptions) {
    const container = document.getElementById('active-subscriptions-list');
    if (!container) return;
    
    if (clientSubscriptions.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 18px;">Нет активных абонементов у клиентов</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = clientSubscriptions.map(sub => {
        const purchasedDate = new Date(sub.purchased_at).toLocaleDateString('ru-RU');
        const expiresDate = new Date(sub.expires_at).toLocaleDateString('ru-RU');
        const daysLeft = Math.ceil((new Date(sub.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
        const daysLeftClass = daysLeft <= 7 ? 'color: #ef4444;' : daysLeft <= 30 ? 'color: #f59e0b;' : 'color: #10b981;';
        
        return `
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <strong>${sub.client_name}</strong>
                        <div style="margin-top: 5px; color: #666; font-size: 14px;">
                            ${sub.subscription_name} • Осталось занятий: <strong>${sub.remaining_sessions}/${sub.total_sessions}</strong>
                        </div>
                        <div style="margin-top: 5px; font-size: 12px; color: #666;">
                            Куплен: ${purchasedDate} • Истекает: ${expiresDate} 
                            <span style="${daysLeftClass} font-weight: bold;">(${daysLeft > 0 ? daysLeft : 0} дн.)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Редактирование типа абонемента
async function editSubscriptionType(id) {
    try {
        // Загрузить список всех абонементов и найти нужный
        const response = await fetch('/api/natural-slope-subscriptions/types');
        if (!response.ok) throw new Error('Ошибка при загрузке данных абонементов');
        
        const subscriptions = await response.json();
        const subscription = subscriptions.find(sub => sub.id === parseInt(id));
        
        if (!subscription) {
            throw new Error('Абонемент не найден');
        }
        
        // Открыть модальное окно с заполненными данными
        const modal = document.getElementById('subscription-modal');
        if (!modal) return;
        
        // Заполнить форму данными
        document.getElementById('subscription-id').value = subscription.id.toString();
        document.getElementById('subscription-modal-title').textContent = 'Редактировать абонемент';
        document.getElementById('subscription-name').value = subscription.name;
        document.getElementById('subscription-description').value = subscription.description || '';
        // Преобразовать validity_days в дату окончания действия
        // Если у абонемента есть expires_at, использовать его, иначе вычислить из validity_days
        let expiresDate = null;
        if (subscription.expires_at) {
            expiresDate = new Date(subscription.expires_at).toISOString().split('T')[0];
        } else if (subscription.validity_days) {
            // Вычислить дату окончания: сегодня + validity_days дней
            const today = new Date();
            today.setDate(today.getDate() + subscription.validity_days);
            expiresDate = today.toISOString().split('T')[0];
        }
        document.getElementById('subscription-validity').value = expiresDate || '';
        document.getElementById('subscription-is-active').checked = subscription.is_active;
        
        // Установить количество занятий и скидку ПЕРЕД загрузкой цен
        const sessionsCount = subscription.sessions_count;
        const discountPercentage = parseFloat(subscription.discount_percentage);
        
        // Сохранить эти значения в глобальной переменной для использования в handlePriceSelection
        window._editSubscriptionData = {
            sessionsCount: sessionsCount,
            discountPercentage: discountPercentage
        };
        
        // Загрузить цены
        await populatePriceSelect();
        
        // Найти цену из прайса, соответствующую цене абонемента
        // Цена за занятие после скидки = price_per_session
        // Обратная расчет: цена за человека без скидки = price_per_session / (1 - discount_percentage / 100)
        const pricePerPersonWithoutDiscount = subscription.price_per_session / (1 - discountPercentage / 100);
        
        // Получить список цен и найти соответствующую
        const prices = await loadGroupPricesForSubscription();
        
        // Попробовать найти подходящую цену из прайса
        let foundPrice = null;
        for (const price of prices) {
            const pricePerPerson = price.price / (price.participants || 1);
            // Проверяем с небольшой погрешностью (10 руб)
            if (Math.abs(pricePerPerson - pricePerPersonWithoutDiscount) < 10) {
                foundPrice = price;
                break;
            }
        }
        
        // Установить количество занятий
        document.getElementById('subscription-sessions').value = sessionsCount;
        document.getElementById(`discount-${sessionsCount}`).value = discountPercentage.toFixed(0);
        document.getElementById('subscription-discount').value = discountPercentage.toFixed(2);
        
        // Показать блоки настроек
        document.getElementById('subscription-discount-controls').style.display = 'block';
        
        if (foundPrice) {
            // Найти опцию в селекте и выбрать её
            const priceSelect = document.getElementById('subscription-price-select');
            for (let i = 0; i < priceSelect.options.length; i++) {
                if (priceSelect.options[i].value == foundPrice.id) {
                    priceSelect.selectedIndex = i;
                    break;
                }
            }
            
            // Установить значения в скрытые поля ПЕРЕД вызовом handlePriceSelection
            const totalPrice = foundPrice.price;
            const participants = foundPrice.participants || 1;
            const pricePerPerson = totalPrice / participants;
            
            document.getElementById('subscription-price-id').value = foundPrice.id;
            document.getElementById('subscription-price-per-person').value = pricePerPerson;
            document.getElementById('subscription-price-per-session').value = totalPrice;
            document.getElementById('subscription-participants').value = participants;
            
            // Включить выбор количества занятий и сохранить выбранное значение
            document.getElementById('subscription-sessions').disabled = false;
            
            // Вызвать расчет цены (а не handlePriceSelection, чтобы не перезаписать выбранные значения)
            calculateSubscriptionPrice();
        } else {
            // Если не нашли подходящую цену, просто включить выбор и установить значения вручную
            document.getElementById('subscription-sessions').disabled = false;
            
            // Сохранить вычисленные значения для последующего использования
            document.getElementById('subscription-price-per-person').value = pricePerPersonWithoutDiscount;
            
            // Рассчитать и показать цену
            setTimeout(() => {
                calculateSubscriptionPrice();
            }, 100);
        }
        
        // Обновить текст кнопки
        document.getElementById('subscription-submit-btn').textContent = 'Сохранить изменения';
        
        // КРИТИЧЕСКИ ВАЖНО: Добавить обработчик submit формы (как в openSubscriptionModal)
        const subscriptionForm = document.getElementById('subscription-form');
        if (subscriptionForm) {
            // Удалить старые обработчики (клонируем форму без обработчиков)
            const newForm = subscriptionForm.cloneNode(true);
            subscriptionForm.parentNode.replaceChild(newForm, subscriptionForm);
            
            // Добавить обработчик на новую форму
            const form = document.getElementById('subscription-form');
            if (form) {
                form.addEventListener('submit', handleSubscriptionSubmit);
                console.log('Обработчик submit формы добавлен для редактирования');
            } else {
                console.error('Форма subscription-form не найдена после клонирования');
            }
        } else {
            console.error('Форма subscription-form не найдена');
        }
        
        // Добавить обработчик изменения выбранной цены
        setTimeout(() => {
            const priceSelect = document.getElementById('subscription-price-select');
            if (priceSelect) {
                // Удалить старый обработчик, если есть, через клонирование
                const newPriceSelect = priceSelect.cloneNode(true);
                priceSelect.parentNode.replaceChild(newPriceSelect, priceSelect);
                
                // Добавить обработчик на новый элемент
                const newSelect = document.getElementById('subscription-price-select');
                if (newSelect) {
                    newSelect.addEventListener('change', handlePriceSelection);
                    console.log('Обработчик изменения цены добавлен для редактирования');
                }
            }
        }, 150);
        
        // Добавить обработчик изменения количества занятий
        const subscriptionSessionsEl = document.getElementById('subscription-sessions');
        if (subscriptionSessionsEl) {
            // Удалить старый обработчик через клонирование
            const newSessions = subscriptionSessionsEl.cloneNode(true);
            subscriptionSessionsEl.parentNode.replaceChild(newSessions, subscriptionSessionsEl);
            
            // Добавить обработчик на новый элемент
            const newSessionsEl = document.getElementById('subscription-sessions');
            if (newSessionsEl) {
                newSessionsEl.addEventListener('change', calculateSubscriptionPrice);
                console.log('Обработчик изменения количества занятий добавлен для редактирования');
            }
        }
        
        // Добавить обработчики изменения процентов скидки
        const discountInputs = ['discount-3', 'discount-5', 'discount-7', 'discount-10'];
        discountInputs.forEach(discountId => {
            const discountInput = document.getElementById(discountId);
            if (discountInput) {
                // Удалить старый обработчик через клонирование
                const newInput = discountInput.cloneNode(true);
                discountInput.parentNode.replaceChild(newInput, discountInput);
                
                // Добавить обработчик на новый элемент
                const newInputEl = document.getElementById(discountId);
                if (newInputEl) {
                    newInputEl.addEventListener('input', () => {
                        console.log(`Изменен процент скидки для ${discountId}:`, newInputEl.value);
                        const sessionsEl = document.getElementById('subscription-sessions');
                        const sessionsCount = sessionsEl?.value;
                        
                        // Если количество занятий выбрано, обновить скрытое поле discount и пересчитать цену
                        if (sessionsCount) {
                            const discountValue = parseFloat(newInputEl.value) || 0;
                            
                            // Если это поле скидки соответствует выбранному количеству занятий, обновить скрытое поле
                            if (sessionsCount === discountId.replace('discount-', '')) {
                                document.getElementById('subscription-discount').value = discountValue.toFixed(2);
                            }
                            
                            // Всегда пересчитать цену, если количество занятий выбрано
                            calculateSubscriptionPrice();
                        }
                    });
                    console.log(`Обработчик процента скидки добавлен для ${discountId}`);
                }
            }
        });
        
        // Открыть модальное окно
        modal.style.display = 'block';
        
    } catch (error) {
        console.error('Ошибка при редактировании абонемента:', error);
        showError('Ошибка при загрузке данных абонемента: ' + error.message);
    }
}

// Удаление типа абонемента
async function deleteSubscriptionType(id) {
    if (!confirm('Вы уверены, что хотите удалить этот абонемент? Это действие нельзя отменить.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/natural-slope-subscriptions/types/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при удалении абонемента');
        }
        
        showSuccess('Абонемент успешно удален');
        await loadSubscriptionsPage();
        
    } catch (error) {
        console.error('Ошибка при удалении абонемента:', error);
        showError(error.message || 'Не удалось удалить абонемент');
    }
}

// Обработчик отправки формы создания абонемента
async function handleSubscriptionSubmit(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Собрать данные из формы
    const name = document.getElementById('subscription-name').value.trim();
    const description = document.getElementById('subscription-description').value.trim();
    const expiresAt = document.getElementById('subscription-validity').value;
    const sessionsCount = parseInt(document.getElementById('subscription-sessions').value);
    
    // Получить процент скидки: сначала из скрытого поля, если пусто - из поля ввода для выбранного номинала
    let discountPercentage = parseFloat(document.getElementById('subscription-discount').value);
    if (isNaN(discountPercentage) && sessionsCount) {
        // Если скрытое поле пустое или невалидное, получить из поля ввода для выбранного номинала
        const discountInput = document.getElementById(`discount-${sessionsCount}`);
        discountPercentage = discountInput ? parseFloat(discountInput.value) : (SUBSCRIPTION_DISCOUNTS[sessionsCount] || 0);
        // Сохранить в скрытое поле для последующих проверок
        if (!isNaN(discountPercentage)) {
            document.getElementById('subscription-discount').value = discountPercentage;
        }
    }
    
    const priceId = document.getElementById('subscription-price-id').value;
    const pricePerPerson = parseFloat(document.getElementById('subscription-price-per-person').value);
    const isActive = document.getElementById('subscription-is-active').checked;
    
    // Валидация
    if (!name) {
        showError('Введите название абонемента');
        return;
    }
    
    if (!expiresAt) {
        showError('Укажите дату окончания действия абонемента');
        return;
    }
    
    // Проверка, что дата не в прошлом
    const selectedDate = new Date(expiresAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
        showError('Дата окончания действия не может быть в прошлом');
        return;
    }
    
    if (!sessionsCount || !['3', '5', '7', '10'].includes(sessionsCount.toString())) {
        showError('Выберите количество занятий');
        return;
    }
    
    if (!priceId || !pricePerPerson || pricePerPerson <= 0) {
        showError('Выберите цену из прайса');
        return;
    }
    
    // Проверка процента скидки: должно быть валидное число от 0 до 100
    if (isNaN(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
        showError('Укажите корректный процент скидки');
        return;
    }
    
    // Рассчитать общую цену абонемента (цена за одного человека * количество занятий со скидкой)
    const priceWithoutDiscount = pricePerPerson * sessionsCount;
    const priceWithDiscount = priceWithoutDiscount * (1 - discountPercentage / 100);
    
    // Рассчитать цену за одно занятие после скидки (для сохранения в БД)
    const pricePerSessionAfterDiscount = pricePerPerson * (1 - discountPercentage / 100);
    
    // Проверить, это редактирование или создание
    const subscriptionId = document.getElementById('subscription-id').value;
    const isEdit = subscriptionId && subscriptionId !== '' && subscriptionId !== '0';
    
    console.log('Режим:', isEdit ? 'Редактирование' : 'Создание', 'ID:', subscriptionId);
    
    // Данные для отправки
    const subscriptionData = {
        name: name,
        description: description || null,
        sessions_count: sessionsCount,
        discount_percentage: discountPercentage,
        price: Math.round(priceWithDiscount),
        price_per_session: Math.round(pricePerSessionAfterDiscount),
        expires_at: expiresAt,
        is_active: isActive
    };
    
    console.log('Данные для отправки на сервер:', JSON.stringify(subscriptionData, null, 2));
    
    try {
        // Показать загрузку
        const submitButton = document.getElementById('subscription-submit-btn') || 
                            (event.target?.querySelector ? event.target.querySelector('button[type="submit"]') : null) ||
                            document.querySelector('#subscription-form button[type="submit"]');
        
        if (!submitButton) {
            console.error('Кнопка submit не найдена');
            showError('Ошибка: кнопка отправки не найдена');
            return;
        }
        
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = isEdit ? 'Сохранение...' : 'Создание...';
        
        // Отправить запрос
        const url = isEdit 
            ? `/api/natural-slope-subscriptions/types/${subscriptionId}`
            : '/api/natural-slope-subscriptions/types';
        const method = isEdit ? 'PUT' : 'POST';
        
        console.log('Отправка запроса:', method, url, subscriptionData);
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(subscriptionData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Ошибка ответа сервера:', error);
            throw new Error(error.error || 'Ошибка при сохранении абонемента');
        }
        
        const savedSubscription = await response.json();
        console.log('Абонемент сохранен:', savedSubscription);
        
        // Показать успех с детальной информацией
        const successMessage = isEdit 
            ? 'Изменения абонемента успешно сохранены!' 
            : 'Абонемент успешно создан!';
        showSuccess(successMessage);
        console.log('Показываем сообщение об успехе:', successMessage);
        
        // Закрыть модальное окно
        closeSubscriptionModal();
        
        // Перезагрузить список абонементов и убедиться, что остаемся на странице абонементов
        // Сначала переключаемся на страницу абонементов (если не на ней)
        const subscriptionsPage = document.getElementById('subscriptions-page');
        if (subscriptionsPage && subscriptionsPage.style.display === 'none') {
            switchPage('subscriptions');
        }
        
        // Затем перезагружаем данные (НО НЕ перезагружаем DOM, чтобы не потерять обработчики формы)
        if (typeof loadSubscriptionsPage === 'function') {
            await loadSubscriptionsPage();
        }
        
        // ВАЖНО: После перезагрузки страницы нужно переустановить обработчик формы, если модальное окно все еще открыто
        // Но так как мы закрыли модальное окно, это не нужно. Однако если нужно будет работать с формой снова,
        // обработчик будет установлен при следующем открытии модального окна.
        
    } catch (error) {
        console.error('Ошибка при сохранении абонемента:', error);
        showError(error.message || 'Не удалось сохранить абонемент');
        
        // Восстановить кнопку
        const submitBtn = document.getElementById('subscription-submit-btn') || 
                          document.querySelector('#subscription-form button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? 'Сохранить изменения' : 'Создать абонемент';
        }
    }
}