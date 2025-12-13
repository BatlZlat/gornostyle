'use strict';

(function () {
    const API = {
        prices: '/api/kuliga/prices',
        availability: '/api/kuliga/availability',
        createBooking: '/api/kuliga/bookings',
        preRegisterClient: '/api/kuliga/pre-register-client',
        program: '/api/kuliga/programs',
    };

    const STORAGE_KEY = 'kuligaBookingDraft';
    const MAX_DAYS_AHEAD = 14;

    const form = document.getElementById('kuligaBookingForm');
    if (!form) return;

    const selectionTitle = form.querySelector('[data-selection-title]');
    const selectionDetails = form.querySelector('[data-selection-details]');
    const participantsHint = document.getElementById('kuligaParticipantsHint');
    const participantsContainer = document.getElementById('kuligaParticipantsContainer');
    const totalPriceLabel = document.getElementById('kuligaTotalPrice');
    const messageBox = document.getElementById('kuligaBookingMessage');
    const clientNameInput = document.getElementById('kuligaClientName');
    const clientBirthDateInput = document.getElementById('kuligaClientBirthDate');
    const clientPhoneInput = document.getElementById('kuligaClientPhone');
    const clientEmailInput = document.getElementById('kuligaClientEmail');
    const participationRadios = form.querySelectorAll('input[name="kuligaPayerParticipation"]');
    const sportRadios = form.querySelectorAll('input[name="kuligaSportType"]');
    const dateInput = document.getElementById('kuligaDate');
    const timeSlotsContainer = document.getElementById('kuligaTimeSlots');
    const availabilityMessage = document.getElementById('kuligaAvailabilityMessage');
    const instructorCard = document.getElementById('kuligaInstructorCard');
    const instructorPhoto = document.getElementById('kuligaInstructorPhoto');
    const instructorName = document.getElementById('kuligaInstructorName');
    const instructorSport = document.getElementById('kuligaInstructorSport');
    const instructorDescription = document.getElementById('kuligaInstructorDescription');
    const notifyEmailCheckbox = document.getElementById('kuligaNotifyEmail');
    const notifyTelegramCheckbox = document.getElementById('kuligaNotifyTelegram');
    const telegramHint = document.getElementById('kuligaTelegramHint');
    const telegramLink = document.getElementById('kuligaTelegramLink');
    const consentCheckbox = document.getElementById('kuligaConsent');
    const locationSelect = document.getElementById('kuligaLocation');
    const addParticipantBtn = document.getElementById('kuligaAddParticipantBtn');

    const botUsername = (window.KULIGA_BOOKING_CONFIG && window.KULIGA_BOOKING_CONFIG.botUsername) || '';
    if (botUsername) {
        const username = botUsername.replace(/^@/, '');
        telegramLink.href = `https://t.me/${username}`;
        telegramLink.textContent = `https://t.me/${username}`;
    } else {
        telegramLink.removeAttribute('href');
        telegramLink.textContent = 'Telegram-бота уточните у администратора';
    }

    const priceTypeLabels = {
        individual: 'Индивидуальная тренировка',
        group: 'Групповая тренировка',
        sport_group: 'Спортивная группа',
    };

    const sportLabels = {
        ski: 'Горные лыжи',
        snowboard: 'Сноуборд',
        both: 'Лыжи и сноуборд',
    };

    const defaultState = {
        selection: {
            priceId: null,
            priceType: 'individual',
            duration: 60,
            baseParticipants: 1,
            currentParticipants: 1,
            priceValue: 0,
            pricePerPerson: 0,
            title: '',
            description: '',
        },
        program: null, // Данные программы (если бронирование через программу)
        client: {
            fullName: '',
            birthDate: '',
            phone: '',
            email: '',
        },
        payerParticipation: 'self', // self | other
        participants: [],
        sportType: 'ski',
        location: 'vorona', // МИГРАЦИЯ 038: Место проведения тренировки (по умолчанию Воронинские горки)
        date: '',
        slot: null,
        availability: [],
        notification: {
            email: true,
            telegram: true, // Теперь включено по умолчанию
        },
        syncMainParticipant: true,
    };

    let state = loadState();
    let prices = [];
    const priceMap = new Map();
    let saveTimer = null;
    let availabilityRequestId = 0;

    /**
     * Нормализует телефонный номер к единому формату +79XXXXXXXXX
     * Синхронизировано с серверной версией в src/utils/phone-normalizer.js
     */
    const normalizePhone = (phone) => {
        if (!phone || typeof phone !== 'string') {
            return '';
        }

        // Убираем все символы кроме цифр и +
        let cleaned = phone.replace(/[^\d+]/g, '');

        // Если номер начинается с 8, заменяем на +7
        if (cleaned.startsWith('8')) {
            cleaned = '+7' + cleaned.substring(1);
        }

        // Если номер начинается с 7 (без +), добавляем +
        if (cleaned.startsWith('7') && !cleaned.startsWith('+7')) {
            cleaned = '+' + cleaned;
        }

        // Если номер начинается с 9 (мобильный без кода страны), добавляем +7
        if (cleaned.startsWith('9') && cleaned.length === 10) {
            cleaned = '+7' + cleaned;
        }

        // Если уже есть +7, оставляем как есть
        // Если нет + в начале, но номер валидный, добавляем +
        if (!cleaned.startsWith('+') && cleaned.length >= 10) {
            // Предполагаем что это российский номер
            if (cleaned.length === 10) {
                cleaned = '+7' + cleaned;
            } else if (cleaned.length === 11 && cleaned.startsWith('7')) {
                cleaned = '+' + cleaned;
            }
        }

        return cleaned;
    };
    const formatCurrency = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
    const formatTime = (timeString = '') => timeString.slice(0, 5);
    const todayISO = () => new Date().toISOString().split('T')[0];

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return structuredClone(defaultState);
            const parsed = JSON.parse(raw);
            return {
                ...structuredClone(defaultState),
                ...parsed,
                selection: { ...structuredClone(defaultState.selection), ...(parsed.selection || {}) },
                client: { ...structuredClone(defaultState.client), ...(parsed.client || {}) },
                participants: Array.isArray(parsed.participants) ? parsed.participants : [],
                notification: {
                    ...structuredClone(defaultState.notification),
                    ...(parsed.notification || {}),
                },
            };
        } catch (error) {
            console.error('Не удалось загрузить черновик бронирования Кулиги:', error);
            return structuredClone(defaultState);
        }
    }

    function saveState() {
        try {
            const persistable = {
                ...state,
                availability: [],
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
        } catch (error) {
            console.warn('Не удалось сохранить черновик бронирования Кулиги:', error);
        }
    }

    function scheduleSaveState() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveState, 200);
    }

    function setMessage(text, type = 'neutral') {
        messageBox.textContent = text;
        messageBox.className = 'kuliga-message';
        if (type === 'error') {
            messageBox.classList.add('kuliga-message--error');
        } else if (type === 'success') {
            messageBox.classList.add('kuliga-message--success');
        } else if (type === 'info') {
            messageBox.classList.add('kuliga-message--info');
        }
    }

    function clearMessage() {
        setMessage('');
    }

    function ensureDateRange() {
        const today = new Date();
        const maxDate = new Date();
        maxDate.setDate(today.getDate() + MAX_DAYS_AHEAD);

        const minISO = today.toISOString().split('T')[0];
        const maxISO = maxDate.toISOString().split('T')[0];

        dateInput.min = minISO;
        dateInput.max = maxISO;

        if (state.date) {
            if (state.date < minISO || state.date > maxISO) {
                state.date = '';
            }
        }
    }

    async function loadPrices() {
        try {
            const response = await fetch(API.prices, { headers: { Accept: 'application/json' } });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось загрузить прайс');
            }
            prices = data.data || [];
            priceMap.clear();
            prices.forEach((price) => {
                priceMap.set(String(price.id), price);
            });
        } catch (error) {
            console.error('Ошибка загрузки прайса Кулиги:', error);
            setMessage('Не удалось загрузить прайс. Попробуйте обновить страницу или обратитесь к администратору.', 'error');
        }
    }

    async function loadProgramData(programId, date, time) {
        try {
            const params = new URLSearchParams();
            if (date) params.set('date', date);
            if (time) params.set('time', time);
            
            const response = await fetch(`${API.program}/${programId}${params.toString() ? '?' + params.toString() : ''}`, {
                headers: { Accept: 'application/json' }
            });
            
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось загрузить данные программы');
            }
            
            return data.data;
        } catch (error) {
            console.error('Ошибка загрузки программы:', error);
            throw error;
        }
    }

    async function initializeSelection() {
        const params = new URLSearchParams(window.location.search);
        const programIdParam = params.get('programId');
        const priceIdParam = params.get('priceId');
        const participantsParam = Number(params.get('participants'));
        
        // Проверяем параметры слота из URL (при переходе с клика на слот)
        const slotIdParam = params.get('slotId');
        const instructorIdParam = params.get('instructorId');
        const dateParam = params.get('date');
        const startTimeParam = params.get('startTime') || params.get('time'); // Поддерживаем оба варианта
        const locationParam = params.get('location');
        const bookingTypeParam = params.get('bookingType'); // individual или group
        const priceTypeParam = params.get('priceType') || params.get('type'); // individual или group (поддерживаем оба параметра для совместимости)

        // Если перешли по клику на слот - предзаполняем данные
        if (slotIdParam && dateParam) {
            state.date = dateParam;
            if (locationParam) {
                state.location = locationParam;
            }
            // Сохраняем информацию о слоте для последующего автоматического выбора
            state.presetSlot = {
                slotId: parseInt(slotIdParam),
                instructorId: instructorIdParam ? parseInt(instructorIdParam) : null,
                startTime: startTimeParam || '',
            };
        }

        // Очищаем state.program если в URL нет programId (чтобы не показывались данные программы из сохраненного состояния)
        if (!programIdParam) {
            state.program = null;
            state.programTime = null;
            state.programTraining = null;
        }
        
        // Обработка программы (приоритет выше, чем priceId)
        if (programIdParam) {
            try {
                const programData = await loadProgramData(programIdParam, dateParam, startTimeParam);
                state.program = programData;
                
                // Предзаполняем данные из программы
                state.selection = {
                    priceId: null,
                    priceType: 'group',
                    duration: Number(programData.training_duration) || 90,
                    baseParticipants: Number(programData.max_participants) || 4,
                    currentParticipants: 1,
                    priceValue: 0,
                    pricePerPerson: Number(programData.price) || 0, // Цена за человека из программы
                    title: programData.name || 'Групповая тренировка',
                    description: programData.description || '',
                };
                
                // Устанавливаем дату и время, если переданы
                if (dateParam) {
                    state.date = dateParam;
                }
                if (startTimeParam) {
                    // startTimeParam может быть в формате "10:00", сохраняем его
                    state.programTime = startTimeParam;
                }
                
                // Если время не передано в URL, берем первое время из time_slots программы
                if (!state.programTime && programData.time_slots && Array.isArray(programData.time_slots) && programData.time_slots.length > 0) {
                    // Берем первое время из массива time_slots
                    const firstTimeSlot = programData.time_slots[0];
                    if (firstTimeSlot) {
                        // Убеждаемся, что формат правильный (может быть "10:00" или "10:00:00")
                        const timeStr = String(firstTimeSlot).trim();
                        state.programTime = timeStr.length >= 5 ? timeStr.substring(0, 5) : timeStr;
                    }
                }
                
                // Устанавливаем location из программы
                if (programData.location) {
                    state.location = programData.location;
                }
                
                // Устанавливаем sportType из программы
                if (programData.sport_type) {
                    state.sportType = programData.sport_type === 'snowboard' ? 'snowboard' : 'ski';
                }
                
                // Если есть информация о тренировке (уже созданной), показываем инструктора
                if (programData.training) {
                    state.programTraining = programData.training;
                    // Если у тренировки есть время и время еще не установлено, используем его
                    if (programData.training.start_time && !state.programTime) {
                        const timeFromTraining = String(programData.training.start_time).substring(0, 5);
                        state.programTime = timeFromTraining;
                    }
                    
                    // Если есть start_time и end_time, вычисляем фактическую длительность
                    if (programData.training.start_time && programData.training.end_time) {
                        const startTime = programData.training.start_time;
                        const endTime = programData.training.end_time;
                        // Вычисляем разницу в минутах (формат времени: "HH:mm:ss" или "HH:mm")
                        try {
                            const startParts = startTime.split(':').map(Number);
                            const endParts = endTime.split(':').map(Number);
                            const startMinutes = startParts[0] * 60 + startParts[1];
                            const endMinutes = endParts[0] * 60 + endParts[1];
                            let durationMinutes = endMinutes - startMinutes;
                            // Если время пересекает полночь
                            if (durationMinutes < 0) {
                                durationMinutes += 24 * 60;
                            }
                            if (durationMinutes > 0) {
                                state.selection.duration = durationMinutes;
                            }
                        } catch (e) {
                            console.warn('Не удалось вычислить длительность из времени тренировки:', e);
                        }
                    }
                }
                
                state.participants = [{ fullName: '', age: '' }];
                state.selection.currentParticipants = 1;
                if (!state.client.fullName) {
                    state.syncMainParticipant = true;
                }
                
                // Обновляем цену после инициализации программы
                updateTotalPrice();
                
                return; // Выходим, так как для программы не нужно загружать прайсы
            } catch (error) {
                console.error('Ошибка загрузки программы:', error);
                setMessage(error.message || 'Не удалось загрузить данные программы. Вернитесь к выбору программы.', 'error');
                return;
            }
        }

        // Обычная логика инициализации для тарифов
        let price;
        
        // Если есть priceType из URL (при клике на слот), ищем подходящий тариф
        if (priceTypeParam && prices.length > 0) {
            price = prices.find((item) => item.type === priceTypeParam) || prices[0];
        } else if (priceIdParam && priceMap.has(priceIdParam)) {
            price = priceMap.get(priceIdParam);
        } else if (state.selection.priceId && priceMap.has(String(state.selection.priceId))) {
            price = priceMap.get(String(state.selection.priceId));
        } else if (prices.length > 0) {
            price = prices.find((item) => item.type === 'individual') || prices[0];
        }

        if (!price) {
            setMessage('Не найден подходящий тариф. Вернитесь к прайсу и выберите карточку заново.', 'error');
            return;
        }

        const participantsFromPrice = Math.max(1, Number(price.participants) || 1);
        const currentParticipants =
            Number.isFinite(participantsParam) && participantsParam >= 1 && participantsParam <= participantsFromPrice
                ? participantsParam
                : Math.max(1, Number(state.selection.currentParticipants) || participantsFromPrice);

        state.selection = {
            priceId: price.id,
            priceType: price.type,
            duration: Number(price.duration) || 60,
            baseParticipants: participantsFromPrice,
            currentParticipants: Math.max(1, Math.min(participantsFromPrice, currentParticipants)),
            priceValue: Number(price.price) || 0,
            pricePerPerson:
                price.type === 'individual'
                    ? Number(price.price) || 0
                    : (Number(price.price) || 0) / participantsFromPrice,
            title: priceTypeLabels[price.type] || 'Тренировка',
            description: price.description || '',
        };

        state.participants = Array.from(
            { length: state.selection.currentParticipants },
            (_, index) => state.participants[index] || { fullName: '', age: '' }
        );

        if (!state.client.fullName) {
            state.syncMainParticipant = true;
        }

        // Если нет presetSlot, сбрасываем слот
        if (!state.presetSlot) {
            state.slot = null;
        }
        state.availability = [];
    }

    function renderSelectionSummary() {
        // Если это программа, показываем информацию о программе
        if (state.program) {
            selectionTitle.textContent = '';
            
            const {
                duration,
                pricePerPerson,
            } = state.selection;
            
            // Получаем название локации
            let locationName = 'Место не указано';
            if (state.program.location) {
                if (typeof window.getLocationName === 'function') {
                    locationName = window.getLocationName(state.program.location);
                } else {
                    // Fallback если функция не загружена
                    locationName = state.program.location === 'vorona' 
                        ? 'Воронинские горки' 
                        : (state.program.location === 'kuliga' ? 'База отдыха «Кулига-Клуб»' : state.program.location);
                }
            }
            
            // Форматируем дату, если она есть
            let dateStr = '';
            if (state.date) {
                const dateObj = new Date(state.date + 'T00:00:00');
                dateStr = dateObj.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    weekday: 'long'
                });
            }
            
            // Определяем имя инструктора
            const instructorName = (state.programTraining && state.programTraining.instructor_name) 
                ? state.programTraining.instructor_name 
                : 'Будет назначен администратором';
            
            // Получаем название вида спорта
            const sportName = sportLabels[state.program.sport_type] || 'Инструктор';
            
            // Получаем информацию о текущем количестве записанных участников
            const maxParticipants = state.program.max_participants || 4;
            const currentBooked = (state.programTraining && state.programTraining.current_participants) ? Number(state.programTraining.current_participants) : 0;
            const availableSlots = maxParticipants - currentBooked;
            
            const details = [
                `<p style="margin: 0;"><strong>Программа:</strong> ${state.program.name || 'Групповая тренировка'}</p>`,
                `<p style="margin: 0;"><strong>Вид спорта:</strong> ${sportName}</p>`,
                `<p style="margin: 0;"><strong>Место:</strong> ${locationName}</p>`,
                dateStr ? `<p style="margin: 0;"><strong>Дата:</strong> ${dateStr}</p>` : '<p style="margin: 0;"><strong>Дата:</strong></p>',
                state.programTime ? `<p style="margin: 0;"><strong>Время:</strong> ${state.programTime}</p>` : '<p style="margin: 0;"><strong>Время:</strong></p>',
                `<p style="margin: 0;"><strong>Длительность тренировки:</strong> ${duration} мин.</p>`,
                `<p style="margin: 0;"><strong>Инструктор:</strong> ${instructorName}</p>`,
                `<p style="margin: 0;"><strong>Участники:</strong> ${currentBooked}/${maxParticipants} мест (свободно ${availableSlots})</p>`,
                `<p style="margin: 0;"><strong>Цена за человека:</strong> ${formatCurrency(pricePerPerson)}</p>`,
            ];
            
            selectionDetails.innerHTML = details.join('');
            updateParticipantsHint();
            updateTotalPrice();
            return;
        }
        
        if (!state.selection.priceId) {
            selectionTitle.textContent = 'Не выбран тариф';
            selectionDetails.innerHTML = '';
            return;
        }

        const {
            title,
            duration,
            currentParticipants,
            pricePerPerson,
            priceValue,
            priceType,
            baseParticipants,
        } = state.selection;

        selectionTitle.textContent = title;

        const totalPrice = priceType === 'individual' ? priceValue : pricePerPerson * currentParticipants;

        const details = [
            `<span><i class="fa-regular fa-clock"></i>${duration} мин.</span>`,
            `<span><i class="fa-solid fa-users"></i>${currentParticipants} участник${currentParticipants > 1 ? 'ов' : ''}</span>`,
            priceType === 'individual'
                ? `<span><i class="fa-solid fa-coins"></i>Стоимость: ${formatCurrency(totalPrice)}</span>`
                : `<span><i class="fa-solid fa-coins"></i>Цена за человека: ${formatCurrency(pricePerPerson)}</span>
                   <span><i class="fa-solid fa-receipt"></i>Общая стоимость: ${formatCurrency(totalPrice)}</span>
                   <span><i class="fa-solid fa-users-line"></i>Базовое количество участников: ${baseParticipants}</span>`,
        ];

        selectionDetails.innerHTML = details.join('');

        updateParticipantsHint();
        updateTotalPrice();
    }

    function updateParticipantsHint() {
        if (state.program) {
            const participantCount = Math.max(1, state.participants.length || 1);
            const maxParticipants = state.program.max_participants || 4;
            const currentBooked = (state.programTraining && state.programTraining.current_participants) ? Number(state.programTraining.current_participants) : 0;
            const availableSlots = maxParticipants - currentBooked;
            
            if (state.payerParticipation === 'self') {
                participantsHint.textContent = `Заполните данные участников. Доступно мест: ${availableSlots} из ${maxParticipants} (уже записано: ${currentBooked}).`;
            } else {
                participantsHint.textContent = `Заполните данные участников. Доступно мест: ${availableSlots} из ${maxParticipants} (уже записано: ${currentBooked}). Заказчик в тренировке не участвует.`;
            }
            return;
        }
        
        const { currentParticipants, baseParticipants } = state.selection;
        if (state.payerParticipation === 'self') {
            participantsHint.textContent = `Заполните данные на ${currentParticipants} участника, включая заказчика.`;
        } else {
            participantsHint.textContent = `Заполните данные на ${currentParticipants} участника${
                currentParticipants > 1 ? 'ов' : ''
            }. Заказчик в тренировке не участвует.`;
        }

        if (currentParticipants < baseParticipants) {
            participantsHint.textContent += ` (Вы уменьшили количество участников. При необходимости вы можете добавить участников вручную, дополнив их данные.)`;
        }
    }

    function ensureParticipantsLength(count) {
        if (!Array.isArray(state.participants)) {
            state.participants = [];
        }
        if (state.participants.length < count) {
            const difference = count - state.participants.length;
            for (let i = 0; i < difference; i += 1) {
                state.participants.push({ fullName: '', age: '' });
            }
        } else if (state.participants.length > count) {
            state.participants.length = count;
        }
    }

    function renderParticipants() {
        const count = Math.max(1, state.participants.length || state.selection.currentParticipants);
        ensureParticipantsLength(count);

        participantsContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();

        state.participants.forEach((participant, index) => {
            const card = document.createElement('div');
            card.className = 'kuliga-participant-card';
            card.dataset.index = index;

            const isMain = index === 0;
            const title =
                state.payerParticipation === 'self'
                    ? isMain
                        ? 'Участник 1 (заказчик)'
                        : `Участник ${index + 1}`
                    : isMain
                    ? 'Участник 1 (основной)'
                    : `Участник ${index + 1}`;

            card.innerHTML = `
                <div class="kuliga-participant-card__header">
                    ${title}
                    ${index > 0 ? `<button type="button" class="kuliga-participant-remove" data-index="${index}" aria-label="Удалить участника" style="float: right; background: none; border: none; color: #dc3545; cursor: pointer; font-size: 1.2rem; padding: 0 8px;">&times;</button>` : ''}
                </div>
                <div class="kuliga-form-grid kuliga-form-grid--compact">
                    <label class="kuliga-field">
                        <span>ФИО *</span>
                        <input type="text" class="kuliga-participant-input" data-field="fullName" data-index="${index}" maxlength="100" value="${participant.fullName || ''}" placeholder="ФИО полностью">
                    </label>
                    <label class="kuliga-field">
                        <span>Возраст (полных лет) *</span>
                        <input type="number" class="kuliga-participant-input" data-field="age" data-index="${index}" min="3" max="90" value="${participant.age || ''}" placeholder="Например, 12">
                    </label>
                </div>
            `;

            fragment.appendChild(card);
        });

        participantsContainer.appendChild(fragment);
        
        // Показываем/скрываем кнопку "Добавить участника" для программ
        if (state.program && addParticipantBtn) {
            const maxParticipants = state.program.max_participants || 4;
            const currentBooked = (state.programTraining && state.programTraining.current_participants) ? Number(state.programTraining.current_participants) : 0;
            const availableSlots = maxParticipants - currentBooked;
            // Можно добавить участников только если есть свободные места
            // Учитываем что мы уже добавляем участников в этой форме
            const canAddMore = state.participants.length < availableSlots;
            
            if (canAddMore && state.participants.length < maxParticipants) {
                addParticipantBtn.style.display = 'block';
            } else {
                addParticipantBtn.style.display = 'none';
            }
        } else if (addParticipantBtn) {
            addParticipantBtn.style.display = 'none';
        }
        
        // Добавляем обработчики для кнопок удаления
        participantsContainer.querySelectorAll('.kuliga-participant-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const index = Number(btn.dataset.index);
                if (index > 0 && state.participants.length > index) {
                    state.participants.splice(index, 1);
                    renderParticipants();
                    updateTotalPrice();
                    scheduleSaveState();
                }
            });
        });
    }
    
    function handleAddParticipant() {
        if (!state.program) return;
        
        const maxParticipants = state.program.max_participants || 4;
        const currentBooked = (state.programTraining && state.programTraining.current_participants) ? Number(state.programTraining.current_participants) : 0;
        const availableSlots = maxParticipants - currentBooked;
        
        // Проверяем доступное количество мест с учетом уже записанных участников
        if (state.participants.length >= availableSlots) {
            setMessage(`Недостаточно мест. Доступно: ${availableSlots} мест (уже записано: ${currentBooked} из ${maxParticipants}).`, 'info');
            return;
        }
        
        if (state.participants.length >= maxParticipants) {
            setMessage(`Максимальное количество участников: ${maxParticipants}`, 'info');
            return;
        }
        
        state.participants.push({ fullName: '', age: '' });
        state.selection.currentParticipants = state.participants.length;
        renderParticipants();
        updateTotalPrice();
        scheduleSaveState();
    }

    function updateTotalPrice() {
        // Для программ считаем по количеству реальных участников
        const count = state.program 
            ? Math.max(1, state.participants.length || 1)
            : Math.max(1, state.selection.currentParticipants);
        const total =
            state.program
                ? state.selection.pricePerPerson * count
                : (state.selection.priceType === 'individual'
                    ? state.selection.priceValue
                    : state.selection.pricePerPerson * count);
        totalPriceLabel.textContent = formatCurrency(total);
    }

    function handleParticipantInput(event) {
        const target = event.target;
        if (!target.classList.contains('kuliga-participant-input')) return;

        const index = Number(target.dataset.index);
        const field = target.dataset.field;
        if (Number.isNaN(index) || !field || !state.participants[index]) return;

        if (field === 'fullName') {
            state.participants[index].fullName = target.value.trim();
            if (index === 0 && state.payerParticipation === 'self') {
                state.syncMainParticipant = false;
            }
        } else if (field === 'age') {
            state.participants[index].age = target.value.trim();
        }

        // Обновляем цену при изменении данных участников (для программ)
        if (state.program) {
            updateTotalPrice();
            renderSelectionSummary();
        }

        scheduleSaveState();
    }

    function setClientFieldValues() {
        clientNameInput.value = state.client.fullName || '';
        clientBirthDateInput.value = state.client.birthDate || '';
        clientPhoneInput.value = state.client.phone || '';
        clientEmailInput.value = state.client.email || '';

        participationRadios.forEach((radio) => {
            radio.checked = radio.value === state.payerParticipation;
        });

        // Устанавливаем вид спорта
        sportRadios.forEach((radio) => {
            // Для программ берем вид спорта из программы
            const sportTypeToSet = state.program 
                ? (state.program.sport_type === 'snowboard' ? 'snowboard' : 'ski')
                : state.sportType;
            
            radio.checked = radio.value === sportTypeToSet;
            // Для программ отключаем изменение вида спорта
            if (state.program) {
                radio.disabled = true;
            } else {
                radio.disabled = false;
            }
        });

        if (locationSelect) {
            locationSelect.value = state.location || 'vorona';
            
            // Для программ скрываем и отключаем поле выбора локации
            if (state.program) {
                const locationField = locationSelect.closest('.kuliga-field');
                if (locationField) {
                    locationField.style.display = 'none';
                }
                locationSelect.disabled = true;
                locationSelect.removeAttribute('required');
            } else {
                const locationField = locationSelect.closest('.kuliga-field');
                if (locationField) {
                    locationField.style.display = '';
                }
                locationSelect.disabled = false;
                locationSelect.setAttribute('required', 'required');
            }
        }

        dateInput.value = state.date || '';
        
        // Для программ показываем дату в читаемом формате вместо поля ввода
        if (state.program && state.date) {
            const dateField = dateInput.closest('.kuliga-field');
            if (dateField) {
                // Скрываем input
                dateInput.style.display = 'none';
                dateInput.disabled = true;
                dateInput.removeAttribute('required');
                
                // Проверяем, не создан ли уже блок с датой
                let dateDisplay = dateField.querySelector('.kuliga-date-display');
                if (!dateDisplay) {
                    // Создаем блок для отображения даты
                    dateDisplay = document.createElement('div');
                    dateDisplay.className = 'kuliga-date-display';
                    dateDisplay.style.cssText = 'padding: 12px 16px; background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; font-size: 1rem; font-weight: 600; color: #1976d2;';
                    dateInput.parentNode.insertBefore(dateDisplay, dateInput.nextSibling);
                }
                
                // Форматируем и отображаем дату
                const dateObj = new Date(state.date + 'T00:00:00');
                const formattedDate = dateObj.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                    weekday: 'long'
                });
                dateDisplay.textContent = formattedDate;
                dateDisplay.style.display = 'block';
            }
        } else {
            // Для обычных тренировок или программ без даты показываем поле ввода
            const dateField = dateInput.closest('.kuliga-field');
            if (dateField) {
                // Удаляем блок с датой, если он существует
                const dateDisplay = dateField.querySelector('.kuliga-date-display');
                if (dateDisplay) {
                    dateDisplay.remove();
                }
                
                dateInput.style.display = '';
                dateInput.disabled = false;
                dateInput.setAttribute('required', 'required');
            }
        }

        notifyEmailCheckbox.checked = Boolean(state.notification.email);
        notifyTelegramCheckbox.checked = Boolean(state.notification.telegram);

        telegramHint.hidden = !state.notification.telegram;
    }

    function handleClientNameChange() {
        state.client.fullName = clientNameInput.value.trim();
        if (state.payerParticipation === 'self' && state.syncMainParticipant && state.participants[0]) {
            state.participants[0].fullName = state.client.fullName;
            // Также обновляем возраст, если дата рождения уже указана
            if (state.client.birthDate) {
                const calculatedAge = calculateAgeFromBirthDate(state.client.birthDate);
                if (calculatedAge !== null) {
                    state.participants[0].age = String(calculatedAge);
                }
            }
            renderParticipants();
        }
        scheduleSaveState();
    }

    function handleClientPhoneChange() {
        state.client.phone = clientPhoneInput.value.trim();
        scheduleSaveState();
    }

    function handleClientBirthDateChange() {
        state.client.birthDate = clientBirthDateInput.value;
        
        // Если выбрано "Я буду кататься", автоматически обновляем возраст первого участника
        if (state.payerParticipation === 'self' && state.syncMainParticipant && state.participants[0]) {
            const calculatedAge = state.client.birthDate ? calculateAgeFromBirthDate(state.client.birthDate) : null;
            if (calculatedAge !== null) {
                state.participants[0].age = String(calculatedAge);
                renderParticipants();
            }
        }
        
        scheduleSaveState();
    }

    function handleClientEmailChange() {
        state.client.email = clientEmailInput.value.trim();
        scheduleSaveState();
    }

    // Функция вычисления возраста из даты рождения
    function calculateAgeFromBirthDate(birthDate) {
        if (!birthDate) return null;
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        
        // Если день рождения еще не наступил в этом году, уменьшаем возраст на 1
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        
        return Math.max(0, age);
    }

    function handleParticipationChange(event) {
        state.payerParticipation = event.target.value;
        if (state.payerParticipation === 'self') {
            // Вычисляем возраст из даты рождения заказчика
            const calculatedAge = state.client.birthDate ? calculateAgeFromBirthDate(state.client.birthDate) : null;
            
            if (!state.participants.length) {
                state.participants = [{ 
                    fullName: state.client.fullName || '', 
                    age: calculatedAge !== null ? String(calculatedAge) : '' 
                }];
            } else {
                // Обновляем первого участника
                state.participants[0].fullName = state.client.fullName || state.participants[0].fullName;
                if (calculatedAge !== null) {
                    state.participants[0].age = String(calculatedAge);
                }
            }
            state.syncMainParticipant = true;
        } else {
            state.syncMainParticipant = false;
        }
        updateParticipantsHint();
        renderParticipants();
        scheduleSaveState();
    }

    function handleSportChange(event) {
        // Для программ запрещаем изменение вида спорта
        if (state.program) {
            // Восстанавливаем значение из программы
            sportRadios.forEach((radio) => {
                const programSportType = state.program.sport_type === 'snowboard' ? 'snowboard' : 'ski';
                radio.checked = radio.value === programSportType;
            });
            return;
        }
        
        state.sportType = event.target.value === 'snowboard' ? 'snowboard' : 'ski';
        state.slot = null;
        state.availability = [];
        renderAvailability();
        scheduleSaveState();
        
        // Обновляем подсветку дат в календаре
        if (datePickerInstance) {
            highlightAvailableDates(datePickerInstance);
        }
        
        if (state.date) {
            loadAvailability();
        }
    }

    function handleLocationChange() {
        if (!locationSelect) return;
        
        // Для программ запрещаем изменение локации
        if (state.program) {
            locationSelect.value = state.location || 'vorona';
            return;
        }
        
        const newLocation = locationSelect.value || 'vorona';
        if (state.location !== newLocation) {
            state.location = newLocation;
            state.slot = null;
            state.availability = [];
            renderAvailability();
            scheduleSaveState();
            
            // Обновляем подсветку дат в календаре
            if (datePickerInstance) {
                highlightAvailableDates(datePickerInstance);
            }
            
            if (state.date) {
                loadAvailability();
            }
        }
    }

    function handleNotificationChange() {
        state.notification.email = notifyEmailCheckbox.checked;
        state.notification.telegram = notifyTelegramCheckbox.checked;
        telegramHint.hidden = !state.notification.telegram;
        scheduleSaveState();
    }

    function handleDateChange() {
        // Для программ запрещаем изменение даты, если она уже установлена
        if (state.program && state.date) {
            // Восстанавливаем исходную дату
            if (datePickerInstance) {
                datePickerInstance.setDate(state.date, false);
            } else {
                dateInput.value = state.date;
            }
            return;
        }
        
        const newDate = datePickerInstance ? datePickerInstance.input.value : dateInput.value;
        state.date = newDate;
        state.slot = null;
        state.availability = [];
        renderAvailability();
        scheduleSaveState();
        if (state.date) {
            loadAvailability();
        }
    }

    function renderAvailability() {
        timeSlotsContainer.innerHTML = '';
        instructorCard.hidden = true;
        availabilityMessage.textContent = '';

        if (!state.date) {
            availabilityMessage.textContent = 'Выберите дату, чтобы увидеть свободные слоты.';
            return;
        }

        if (!state.availability.length) {
            availabilityMessage.textContent =
                'На выбранную дату свободных инструкторов нет. Попробуйте выбрать другую дату или запишитесь в регулярную программу.';
            return;
        }

        const fragment = document.createDocumentFragment();
        state.availability.forEach((slot, index) => {
            const option = document.createElement('label');
            option.className = 'kuliga-timeslot-option';
            option.innerHTML = `
                <input type="radio" name="kuligaTimeSlot" value="${slot.slot_id}" data-index="${index}" ${
                state.slot && state.slot.slot_id === slot.slot_id ? 'checked' : ''
            }>
                <span>
                    <strong>${formatTime(slot.start_time)}</strong>
                    <em>${slot.instructor_name}</em>
                </span>
            `;
            fragment.appendChild(option);
        });

        timeSlotsContainer.appendChild(fragment);
        availabilityMessage.textContent = `Свободных слотов найдено: ${state.availability.length}`;

        // Если слот выбран, автоматически отмечаем его в UI и показываем карточку инструктора
        if (state.slot) {
            // Находим radio кнопку для выбранного слота и отмечаем её
            const slotRadio = timeSlotsContainer.querySelector(`input[name="kuligaTimeSlot"][value="${state.slot.slot_id}"]`);
            if (slotRadio) {
                slotRadio.checked = true;
            }
            renderInstructorCard(state.slot);
        }
    }

    function renderInstructorCard(slot) {
        if (!slot) {
            instructorCard.hidden = true;
            return;
        }
        instructorPhoto.src = slot.instructor_photo_url || '/images/gornosyle72_logo.webp';
        instructorPhoto.alt = slot.instructor_name;
        instructorName.textContent = slot.instructor_name;
        instructorSport.textContent = sportLabels[slot.instructor_sport_type] || 'Инструктор';
        instructorDescription.textContent = slot.instructor_description || 'Описание появится позже.';
        instructorCard.hidden = false;
    }

    function handleTimeslotChange(event) {
        const target = event.target;
        if (target.name !== 'kuligaTimeSlot') return;

        const index = Number(target.dataset.index);
        if (Number.isNaN(index) || !state.availability[index]) return;

        state.slot = state.availability[index];
        renderInstructorCard(state.slot);
        scheduleSaveState();
    }

    function buildParticipantsPayload() {
        const participants = [];
        const currentYear = new Date().getFullYear();

        state.participants.forEach((participant) => {
            const fullName = (participant.fullName || '').trim();
            const ageNumber = Number(participant.age);
            if (!fullName || !Number.isFinite(ageNumber)) {
                return;
            }
            const safeAge = Math.max(1, Math.min(99, ageNumber));
            const birthYear = currentYear - safeAge;
            participants.push({
                fullName,
                birthYear,
                age: safeAge,
            });
        });

        return participants;
    }

    function validateForm() {
        if (!form.checkValidity()) {
            form.reportValidity();
            setMessage('Проверьте корректность заполнения формы', 'error');
            return false;
        }

        if (!state.client.fullName || !state.client.birthDate || !state.client.phone) {
            setMessage('Заполните ФИО заказчика, дату рождения и телефон.', 'error');
            return false;
        }

        if (!state.notification.email && !state.notification.telegram) {
            setMessage('Выберите хотя бы один способ уведомлений (email или Telegram).', 'error');
            return false;
        }

        if (state.notification.email && !state.client.email) {
            setMessage('Укажите email или снимите галочку уведомлений по email.', 'error');
            return false;
        }

        // Валидация для программ
        if (state.program) {
            if (!state.date) {
                setMessage('Дата тренировки не указана. Вернитесь к выбору программы и выберите дату.', 'error');
                return false;
            }
            
            if (!state.programTime) {
                setMessage('Время тренировки не указано. Вернитесь к выбору программы и выберите время.', 'error');
                return false;
            }
            
            const participants = buildParticipantsPayload();
            if (!participants.length) {
                setMessage('Заполните ФИО и возраст хотя бы одного участника.', 'error');
                return false;
            }
            
            return true;
        }

        // Валидация для обычных тренировок
        if (!state.date) {
            setMessage('Выберите дату тренировки.', 'error');
            return false;
        }

        if (!state.slot) {
            setMessage('Выберите свободный слот для тренировки.', 'error');
            return false;
        }

        const participants = buildParticipantsPayload();
        const requiredCount = state.selection.currentParticipants;

        if (!participants.length) {
            setMessage('Заполните ФИО и возраст хотя бы одного участника.', 'error');
            return false;
        }

        if (participants.length < requiredCount) {
            const missing = requiredCount - participants.length;
            const proceed = window.confirm(
                `Вы заполнили данные на ${participants.length} участник${
                    participants.length > 1 ? 'ов' : 'а'
                }. Ещё ${missing} участник${missing > 1 ? 'ов' : ''} не заполнен. Сократить количество участников и пересчитать стоимость?`
            );
            if (proceed) {
                state.selection.currentParticipants = participants.length;
                state.participants = participants.map(({ fullName, age }) => ({ fullName, age }));
                renderParticipants();
                renderSelectionSummary();
                scheduleSaveState();
                setMessage('Количество участников обновлено. Проверьте данные и нажмите «Перейти к оплате» ещё раз.', 'info');
            } else {
                setMessage('Укажите данные на всех участников или подтвердите пересчёт.', 'error');
            }
            return false;
        }

        return true;
    }

    function buildPayload() {
        const participants = buildParticipantsPayload();
        
        // Для программ
        if (state.program) {
            const totalPrice = state.selection.pricePerPerson * participants.length;
            
            return {
                programId: state.program.id,
                date: state.date,
                time: state.programTime,
                fullName: state.client.fullName.trim(),
                birthDate: state.client.birthDate,
                phone: normalizePhone(state.client.phone),
                email: state.client.email.trim(),
                participantsCount: participants.length,
                participantsNames: participants.map(({ fullName }) => fullName),
                consentConfirmed: consentCheckbox.checked,
            };
        }
        
        // Для обычных тренировок
        const totalPrice =
            state.selection.priceType === 'individual'
                ? state.selection.priceValue
                : state.selection.pricePerPerson * participants.length;

        return {
            bookingType: state.selection.priceType === 'group' ? 'group' : 'individual',
            fullName: state.client.fullName.trim(),
            birthDate: state.client.birthDate,
            phone: normalizePhone(state.client.phone),
            email: state.client.email.trim(),
            priceId: state.selection.priceId,
            priceType: state.selection.priceType,
            duration: state.selection.duration,
            sportType: state.sportType,
            date: state.date,
            slotId: state.slot.slot_id,
            instructorId: state.slot.instructor_id,
            location: state.location || 'vorona', // МИГРАЦИЯ 038: Передаем location при создании бронирования
            startTime: state.slot.start_time,
            endTime: state.slot.end_time,
            participantsCount: participants.length,
            participants: participants.map(({ fullName, birthYear }) => ({ fullName, birthYear })),
            notification: {
                email: state.notification.email,
                telegram: state.notification.telegram,
            },
            payerParticipation: state.payerParticipation,
            pricePerPerson: state.selection.pricePerPerson,
            totalPrice,
            consentConfirmed: consentCheckbox.checked,
        };
    }

    function showTelegramBookingModal(payload) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'kuliga-confirmation-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                padding: 20px;
            `;
            
            const participants = buildParticipantsPayload();
            const totalPrice = state.selection.pricePerPerson * participants.length;
            
            const dateStr = state.date ? new Date(state.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            }) : '';
            
            const locationNames = {
                'kuliga': 'База отдыха «Кулига-Клуб»',
                'vorona': 'Воронинские горки'
            };
            const locationName = locationNames[state.program.location] || state.program.location || 'База отдыха «Кулига-Клуб»';
            
            let modalContent = `
                <div style="background: white; border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                    <h2 style="margin-top: 0; margin-bottom: 24px; color: #1e293b;">Запись на программу</h2>
                    
                    <div style="margin-bottom: 24px;">
                        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
                            <p style="margin: 8px 0;"><strong>Групповая тренировка:</strong> ${state.program.name}</p>
                            <p style="margin: 8px 0;"><strong>Место:</strong> ${locationName}</p>
                            ${dateStr ? `<p style="margin: 8px 0;"><strong>Дата тренировки:</strong> ${dateStr}</p>` : '<p style="margin: 8px 0;"><strong>Дата тренировки:</strong></p>'}
                            ${state.programTime ? `<p style="margin: 8px 0;"><strong>Время тренировки:</strong> ${state.programTime}</p>` : '<p style="margin: 8px 0;"><strong>Время тренировки:</strong></p>'}
                            <p style="margin: 8px 0;"><strong>Длительность тренировки:</strong> ${state.selection.duration} мин.</p>
                            <p style="margin: 8px 0;"><strong>${participants.length} ${participants.length === 1 ? 'участник' : participants.length < 5 ? 'участника' : 'участников'}</strong></p>
                            <p style="margin: 8px 0;"><strong>Стоимость:</strong> ${formatCurrency(totalPrice)}</p>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="kuliga-button kuliga-button--secondary" id="kuligaTelegramCancel" style="padding: 12px 24px;">
                            Отмена
                        </button>
                        <button type="button" class="kuliga-button kuliga-button--primary" id="kuligaTelegramPay" style="padding: 12px 24px;">
                            Оплатить
                        </button>
                    </div>
                </div>
            `;
            
            modal.innerHTML = modalContent;
            document.body.appendChild(modal);
            
            const cancelBtn = modal.querySelector('#kuligaTelegramCancel');
            const payBtn = modal.querySelector('#kuligaTelegramPay');
            
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                resolve(false);
            });
            
            payBtn.addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });
            
            // Закрытие по клику вне модального окна
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(false);
                }
            });
            
            // Закрытие по Escape
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    function showConfirmationModal(payload) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'kuliga-confirmation-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                padding: 20px;
            `;
            
            const participants = buildParticipantsPayload();
            const totalPrice = state.program 
                ? state.selection.pricePerPerson * participants.length
                : (state.selection.priceType === 'individual'
                    ? state.selection.priceValue
                    : state.selection.pricePerPerson * participants.length);
            
            const dateStr = state.date ? new Date(state.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                weekday: 'long'
            }) : '';
            
            const locationNames = {
                'kuliga': 'База отдыха «Кулига-Клуб»',
                'vorona': 'Воронинские горки'
            };
            const locationName = state.program 
                ? (locationNames[state.program.location] || state.program.location || 'База отдыха «Кулига-Клуб»')
                : (locationNames[state.location] || state.location || 'База отдыха «Кулига-Клуб»');
            
            let modalContent = `
                <div style="background: white; border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                    <h2 style="margin-top: 0; margin-bottom: 24px; color: #1e293b;">Подтверждение бронирования</h2>
                    
                    <div style="margin-bottom: 24px;">
                        <h3 style="margin-bottom: 12px; color: #334155;">Информация о тренировке</h3>
                        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
                            ${state.program 
                                ? `<p><strong>Программа:</strong> ${state.program.name}</p>`
                                : `<p><strong>Тип:</strong> ${state.selection.title}</p>`
                            }
                            <p><strong>Вид спорта:</strong> ${sportLabels[state.program ? state.program.sport_type : state.sportType] || 'Инструктор'}</p>
                            <p><strong>Место:</strong> ${locationName}</p>
                            ${dateStr ? `<p><strong>Дата:</strong> ${dateStr}</p>` : ''}
                            ${state.programTime 
                                ? `<p><strong>Время:</strong> ${state.programTime}</p>`
                                : (state.slot ? `<p><strong>Время:</strong> ${formatTime(state.slot.start_time)} - ${formatTime(state.slot.end_time)}</p>` : '')
                            }
                            ${state.program ? `<p><strong>Длительность тренировки:</strong> ${state.selection.duration} мин.</p>` : ''}
                            ${state.program 
                                ? (state.programTraining && state.programTraining.instructor_name
                                    ? `<p><strong>Инструктор:</strong> ${state.programTraining.instructor_name}</p>`
                                    : '<p><strong>Инструктор:</strong> Будет назначен администратором</p>'
                                )
                                : (state.slot && state.slot.instructor_name
                                    ? `<p><strong>Инструктор:</strong> ${state.slot.instructor_name}</p>`
                                    : '<p><strong>Инструктор:</strong> Будет назначен администратором</p>'
                                )
                            }
                            <p><strong>Цена за человека:</strong> ${formatCurrency(state.program ? state.program.price : state.selection.pricePerPerson)}</p>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 24px;">
                        <h3 style="margin-bottom: 12px; color: #334155;">Участники (${participants.length} ${participants.length === 1 ? 'человек' : participants.length < 5 ? 'человека' : 'человек'})</h3>
                        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
                            ${participants.map((p, idx) => `
                                <p style="margin: 8px 0;">
                                    <strong>${idx + 1}.</strong> ${p.fullName} (${p.age} ${p.age === 1 ? 'год' : p.age < 5 ? 'года' : 'лет'})
                                </p>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 24px;">
                        <h3 style="margin-bottom: 12px; color: #334155;">Заказчик</h3>
                        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
                            <p><strong>ФИО:</strong> ${state.client.fullName}</p>
                            <p><strong>Телефон:</strong> ${state.client.phone}</p>
                            ${state.client.email ? `<p><strong>Email:</strong> ${state.client.email}</p>` : ''}
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 24px; padding: 16px; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #2196f3;">
                        <p style="margin: 0; font-size: 1.1rem;">
                            <strong>К оплате: ${formatCurrency(totalPrice)}</strong>
                        </p>
                    </div>
                    
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="kuliga-button kuliga-button--secondary" id="kuligaConfirmCancel" style="padding: 12px 24px;">
                            Отмена
                        </button>
                        <button type="button" class="kuliga-button kuliga-button--primary" id="kuligaConfirmPay" style="padding: 12px 24px;">
                            Перейти к оплате
                        </button>
                    </div>
                </div>
            `;
            
            modal.innerHTML = modalContent;
            document.body.appendChild(modal);
            
            const cancelBtn = modal.querySelector('#kuligaConfirmCancel');
            const payBtn = modal.querySelector('#kuligaConfirmPay');
            
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                resolve(false);
            });
            
            payBtn.addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });
            
            // Закрытие по клику вне модального окна
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(false);
                }
            });
            
            // Закрытие по Escape
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    async function handleSubmit(event) {
        event.preventDefault();
        clearMessage();

        if (!validateForm()) {
            return;
        }

        if (!consentCheckbox.checked) {
            setMessage('Нужно подтвердить согласие на обработку персональных данных.', 'error');
            return;
        }

        const payload = buildPayload();
        
        // Показываем модальное окно подтверждения только для программ
        if (state.program) {
            const confirmed = await showConfirmationModal(payload);
            if (!confirmed) {
                return;
            }
        }
        
        setMessage('Создаём бронирование и перенаправляем на оплату...', 'neutral');

        try {
            const response = await fetch(API.createBooking, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось создать бронирование');
            }

            setMessage('Перенаправляем на страницу оплаты...', 'success');
            localStorage.removeItem(STORAGE_KEY);
            if (data.paymentUrl) {
                window.location.href = data.paymentUrl;
            }
        } catch (error) {
            console.error('Ошибка бронирования Кулиги:', error);
            setMessage(error.message || 'Произошла ошибка. Попробуйте позже или обратитесь к администратору.', 'error');
        }
    }

    async function loadAvailability() {
        if (!state.date) return;

        const requestId = ++availabilityRequestId;
        availabilityMessage.textContent = 'Загружаем свободные слоты...';
        timeSlotsContainer.innerHTML = '';
        instructorCard.hidden = true;

        const params = new URLSearchParams({
            date: state.date,
            sport: state.sportType,
            duration: String(state.selection.duration),
            location: state.location || 'vorona', // МИГРАЦИЯ 038: Передаем location в API
        });

        try {
            const response = await fetch(`${API.availability}?${params.toString()}`, {
                headers: { Accept: 'application/json' },
            });
            const data = await response.json();
            if (requestId !== availabilityRequestId) {
                return;
            }
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось загрузить свободные слоты');
            }

            state.availability = data.data || [];

            // Если есть presetSlot (переход по клику на слот), пытаемся найти и выбрать его
            if (state.presetSlot && !state.slot) {
                const targetSlot = state.availability.find((slot) => 
                    slot.slot_id === state.presetSlot.slotId ||
                    (state.presetSlot.instructorId && slot.instructor_id === state.presetSlot.instructorId && 
                     slot.start_time === state.presetSlot.startTime)
                );
                if (targetSlot) {
                    state.slot = targetSlot;
                    // Очищаем presetSlot, так как слот найден
                    delete state.presetSlot;
                }
            } else if (state.slot) {
                // Сохраняем текущий выбранный слот, если он доступен
                const preserved = state.availability.find((slot) => slot.slot_id === state.slot.slot_id);
                state.slot = preserved || null;
            }

            renderAvailability();
            scheduleSaveState();
        } catch (error) {
            console.error('Ошибка загрузки слотов Кулиги:', error);
            if (requestId === availabilityRequestId) {
                availabilityMessage.textContent =
                    'Не удалось загрузить свободные слоты. Попробуйте обновить дату или страницу.';
                state.availability = [];
                state.slot = null;
                renderAvailability();
            }
        }
    }

    function attachListeners() {
        clientNameInput.addEventListener('input', handleClientNameChange);
        clientBirthDateInput.addEventListener('change', handleClientBirthDateChange);
        clientPhoneInput.addEventListener('input', handleClientPhoneChange);
        clientEmailInput.addEventListener('input', handleClientEmailChange);
        participantsContainer.addEventListener('input', handleParticipantInput);
        timeSlotsContainer.addEventListener('change', handleTimeslotChange);

        participationRadios.forEach((radio) => {
            radio.addEventListener('change', handleParticipationChange);
        });

        sportRadios.forEach((radio) => {
            radio.addEventListener('change', handleSportChange);
        });

        notifyEmailCheckbox.addEventListener('change', handleNotificationChange);
        notifyTelegramCheckbox.addEventListener('change', handleNotificationChange);

        if (locationSelect) {
            locationSelect.addEventListener('change', handleLocationChange);
        }

        // Для flatpickr обработчик устанавливается в onChange, поэтому не добавляем стандартный
        // Но оставляем на случай, если flatpickr не инициализирован
        // Проверяем после того, как datePickerInstance может быть создан
        setTimeout(() => {
            if (!datePickerInstance) {
                dateInput.addEventListener('change', handleDateChange);
            }
        }, 0);
        form.addEventListener('submit', handleSubmit);

        // Обработчик клика на ссылку бота - создаем клиента заранее
        telegramLink.addEventListener('click', handleTelegramLinkClick);
        
        // Обработчик кнопки "Добавить участника"
        if (addParticipantBtn) {
            addParticipantBtn.addEventListener('click', handleAddParticipant);
        }
    }

    async function handleTelegramLinkClick(event) {
        event.preventDefault();

        // Проверяем, заполнены ли обязательные данные
        if (!state.client.fullName || !state.client.birthDate || !state.client.phone) {
            setMessage('Заполните ФИО заказчика, дату рождения и телефон перед переходом к боту.', 'error');
            
            // Скроллим к первому незаполненному полю
            let targetField = null;
            if (!state.client.fullName) {
                targetField = clientNameInput;
            } else if (!state.client.birthDate) {
                targetField = clientBirthDateInput;
            } else if (!state.client.phone) {
                targetField = clientPhoneInput;
            }
            
            if (targetField) {
                targetField.focus();
                targetField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            return false;
        }

        try {
            setMessage('Регистрируем вас в системе...', 'neutral');

            const response = await fetch(API.preRegisterClient, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    fullName: state.client.fullName.trim(),
                    birthDate: state.client.birthDate,
                    phone: normalizePhone(state.client.phone),
                    email: state.client.email?.trim() || null,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось зарегистрировать клиента');
            }

            // Сохраняем, что клиент предварительно зарегистрирован
            state.client.preRegistered = true;
            scheduleSaveState();

            setMessage('Регистрация успешна. Открываем бота...', 'success');

            // Открываем бота в новой вкладке
            const botUrl = telegramLink.href;
            window.open(botUrl, '_blank');

            // Через небольшую задержку очищаем сообщение
            setTimeout(() => {
                clearMessage();
            }, 3000);
        } catch (error) {
            console.error('Ошибка предварительной регистрации клиента:', error);
            setMessage(error.message || 'Произошла ошибка. Попробуйте позже или обратитесь к администратору.', 'error');
        }

        return false;
    }

    // Инициализация flatpickr для подсветки доступных дат
    let datePickerInstance = null;
    
    async function loadAvailableDatesForCalendar(from, to) {
        if (state.program) return [];
        
        const params = new URLSearchParams({
            from,
            to,
            sport: state.sportType || 'ski',
            duration: String(state.selection.duration || 60),
            location: state.location || 'vorona',
        });
        
        try {
            const response = await fetch(`/api/kuliga/availability/dates?${params.toString()}`, {
                headers: { Accept: 'application/json' },
            });
            const data = await response.json();
            if (data.success) {
                return data.data || [];
            }
        } catch (error) {
            console.error('Ошибка загрузки доступных дат:', error);
        }
        return [];
    }
    
    function highlightAvailableDates(instance) {
        if (!instance || !instance.calendarContainer || state.program) return;
        
        setTimeout(async () => {
            const days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
            if (days.length === 0) return;
            
            // Определяем диапазон дат для текущего месяца
            // Используем currentYear и currentMonth из flatpickr
            const year = instance.currentYear;
            const month = instance.currentMonth; // 0-based (0 = январь)
            
            // Первый день месяца
            const firstDay = new Date(year, month, 1);
            // Последний день месяца
            const lastDay = new Date(year, month + 1, 0);
            
            const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
            const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
            
            const availableDates = await loadAvailableDatesForCalendar(from, to);
            const availableDatesSet = new Set(availableDates);
            
            days.forEach(day => {
                if (!day.dateObj) {
                    day.classList.remove('has-schedule');
                    return;
                }
                
                // Пропускаем дни из других месяцев (обычно серые)
                const dayMonth = day.dateObj.getMonth();
                if (dayMonth !== month) {
                    day.classList.remove('has-schedule');
                    return;
                }
                
                // Проверяем, не прошла ли дата
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (day.dateObj < today) {
                    day.classList.remove('has-schedule');
                    return;
                }
                
                // Форматируем дату в локальном времени, избегая toISOString() для предотвращения смещения часовых поясов
                const d = day.dateObj;
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                
                if (availableDatesSet.has(dateStr)) {
                    day.classList.add('has-schedule');
                    day.title = 'Есть доступные слоты';
                } else {
                    day.classList.remove('has-schedule');
                    day.removeAttribute('title');
                }
            });
        }, 100);
    }
    
    function initializeDatePicker() {
        if (state.program || !dateInput) return;
        
        // Проверяем, доступен ли flatpickr
        if (typeof window.flatpickr === 'undefined') {
            console.warn('Flatpickr не доступен, используем стандартный date input');
            return;
        }
        
        // Если уже инициализирован, уничтожаем старый экземпляр
        if (datePickerInstance) {
            datePickerInstance.destroy();
            datePickerInstance = null;
        }
        
        const ruLocale = window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.ru 
            ? window.flatpickr.l10ns.ru 
            : null;
        
        const fpOptions = {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'd.m.Y',
            allowInput: true,
            minDate: 'today',
            firstDayOfWeek: 1,
            locale: ruLocale || {
                firstDayOfWeek: 1,
                weekdays: {
                    shorthand: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
                    longhand: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
                },
                months: {
                    shorthand: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
                    longhand: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
                }
            },
            onChange: function(selectedDates, dateStr) {
                if (dateStr) {
                    state.date = dateStr;
                    handleDateChange();
                }
            },
            onMonthChange: function(selectedDates, dateStr, instance) {
                highlightAvailableDates(instance);
            },
            onOpen: function(selectedDates, dateStr, instance) {
                highlightAvailableDates(instance);
            },
            onReady: function(selectedDates, dateStr, instance) {
                highlightAvailableDates(instance);
            }
        };
        
        datePickerInstance = window.flatpickr(dateInput, fpOptions);
        
        // Убеждаемся, что иконка календаря видна для altInput (который создает flatpickr)
        // Flatpickr создает altInput как соседний элемент, поэтому нужно обновить позиционирование иконки
        setTimeout(() => {
            if (datePickerInstance && datePickerInstance.altInput) {
                const wrapper = dateInput.closest('.kuliga-input-wrapper');
                const icon = wrapper ? wrapper.querySelector('.kuliga-date-icon') : null;
                
                if (icon) {
                    // Проверяем, где находится altInput
                    const altInputParent = datePickerInstance.altInput.parentNode;
                    if (altInputParent && altInputParent !== wrapper) {
                        // Если altInput находится в другом контейнере, делаем его родителя relative
                        altInputParent.style.position = 'relative';
                        // Создаем иконку для altInput, если её там нет
                        if (!altInputParent.querySelector('.kuliga-date-icon')) {
                            const clonedIcon = icon.cloneNode(true);
                            clonedIcon.style.position = 'absolute';
                            clonedIcon.style.right = '12px';
                            clonedIcon.style.zIndex = '2';
                            altInputParent.appendChild(clonedIcon);
                        }
                    } else if (altInputParent === wrapper) {
                        // Если altInput внутри обертки, иконка уже должна быть видна
                        // Убеждаемся, что она позиционирована правильно относительно altInput
                        const computedStyle = window.getComputedStyle(datePickerInstance.altInput);
                        if (computedStyle.position !== 'absolute') {
                            icon.style.right = '12px';
                        }
                    }
                }
            }
        }, 100);
    }

    (async function bootstrap() {
        await loadPrices();
        await initializeSelection(); // Теперь async
        ensureDateRange();
        setClientFieldValues();
        renderParticipants();
        renderSelectionSummary();
        
        // Для программ не показываем выбор слотов, а показываем информацию о тренировке
        if (state.program) {
            renderProgramInfo();
            // Скрываем и отключаем выбор локации для программ
            if (locationSelect) {
                const locationField = locationSelect.closest('.kuliga-field');
                if (locationField) {
                    locationField.style.display = 'none';
                }
                locationSelect.disabled = true;
                locationSelect.removeAttribute('required');
            }
            
            // Скрываем карточку инструктора для программ
            if (instructorCard) {
                instructorCard.hidden = true;
                instructorCard.style.display = 'none';
            }
            
            // Скрываем radio-кнопки выбора вида спорта для программ
            sportRadios.forEach((radio) => {
                const radioContainer = radio.closest('.kuliga-choice');
                if (radioContainer) {
                    radioContainer.style.display = 'none';
                }
            });
            
            // Для программ с установленной датой показываем дату в читаемом формате
            if (dateInput && state.date) {
                const dateField = dateInput.closest('.kuliga-field');
                if (dateField) {
                    // Скрываем input
                    dateInput.style.display = 'none';
                    dateInput.disabled = true;
                    dateInput.removeAttribute('required');
                    
                    // Проверяем, не создан ли уже блок с датой
                    let dateDisplay = dateField.querySelector('.kuliga-date-display');
                    if (!dateDisplay) {
                        // Создаем блок для отображения даты
                        dateDisplay = document.createElement('div');
                        dateDisplay.className = 'kuliga-date-display';
                        dateDisplay.style.cssText = 'padding: 12px 16px; background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; font-size: 1rem; font-weight: 600; color: #1976d2;';
                        dateInput.parentNode.insertBefore(dateDisplay, dateInput.nextSibling);
                    }
                    
                    // Форматируем и отображаем дату
                    const dateObj = new Date(state.date + 'T00:00:00');
                    const formattedDate = dateObj.toLocaleDateString('ru-RU', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        weekday: 'long'
                    });
                    dateDisplay.textContent = formattedDate;
                    dateDisplay.style.display = 'block';
                }
            } else if (dateInput && state.program && !state.date) {
                // Для программ без даты показываем поле ввода
                const dateField = dateInput.closest('.kuliga-field');
                if (dateField) {
                    const dateDisplay = dateField.querySelector('.kuliga-date-display');
                    if (dateDisplay) {
                        dateDisplay.remove();
                    }
                    dateInput.style.display = '';
                    dateInput.disabled = false;
                    dateInput.setAttribute('required', 'required');
                }
            }
        } else {
            renderAvailability();
            // Показываем выбор локации для обычных тренировок
            if (locationSelect) {
                const locationField = locationSelect.closest('.kuliga-field');
                if (locationField) {
                    locationField.style.display = '';
                }
                locationSelect.disabled = false;
                locationSelect.setAttribute('required', 'required');
            }
            
            // Показываем radio-кнопки выбора вида спорта для обычных тренировок
            sportRadios.forEach((radio) => {
                const radioContainer = radio.closest('.kuliga-choice');
                if (radioContainer) {
                    radioContainer.style.display = '';
                }
            });
            
            // Инициализируем date picker с подсветкой дат для обычных тренировок
            initializeDatePicker();
            
            // Если datePickerInstance был создан, обновляем подсветку после инициализации
            if (datePickerInstance) {
                setTimeout(() => {
                    highlightAvailableDates(datePickerInstance);
                }, 200);
            }
        }
        
        attachListeners();
        scheduleSaveState();

        if (state.date && !state.program) {
            loadAvailability();
        }
    })();
    
    function renderProgramInfo() {
        // Для программ заменяем "Свободные слоты" на фиксированное время
        if (state.program && timeSlotsContainer) {
            const program = state.program;
            const timeStr = state.programTime || '';
            
            // Всегда меняем метку на "Время тренировки" для программ
            // Ищем label, который содержит timeSlotsContainer
            let timeSlotLabel = timeSlotsContainer.closest('label');
            if (!timeSlotLabel) {
                timeSlotLabel = timeSlotsContainer.parentElement;
            }
            
            if (timeSlotLabel) {
                const labelSpan = timeSlotLabel.querySelector('span');
                if (labelSpan) {
                    labelSpan.textContent = 'Время тренировки *';
                } else {
                    // Если span не найден, создаем его или изменяем textContent родителя
                    const firstChild = timeSlotLabel.firstChild;
                    if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
                        firstChild.textContent = 'Время тренировки *';
                    }
                }
            }
            
            // Показываем фиксированное время, если оно указано
            if (timeStr) {
                timeSlotsContainer.innerHTML = `
                    <div style="padding: 16px; background: #e3f2fd; border: 2px solid #2196f3; border-radius: 8px; font-size: 1.1rem; font-weight: 600; color: #1976d2; text-align: center;">
                        ${timeStr}
                    </div>
                `;
            } else {
                // Если время не указано, показываем сообщение
                timeSlotsContainer.innerHTML = `
                    <div style="padding: 16px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; font-size: 0.95rem; color: #856404; text-align: center;">
                        Время тренировки будет указано администратором
                    </div>
                `;
            }
            
            // Скрываем сообщение о доступности, так как время фиксировано
            availabilityMessage.innerHTML = '';
            availabilityMessage.style.display = 'none';
            
            // Для программ всегда скрываем карточку инструктора, чтобы администратор мог гибко назначать тренера
            if (instructorCard) {
                instructorCard.hidden = true;
                instructorCard.style.display = 'none';
            }
        } else if (timeSlotsContainer) {
            // Для обычных тренировок показываем "Свободные слоты"
            let timeSlotLabel = timeSlotsContainer.closest('label');
            if (!timeSlotLabel) {
                timeSlotLabel = timeSlotsContainer.parentElement;
            }
            if (timeSlotLabel && timeSlotLabel.tagName === 'LABEL') {
                const labelSpan = timeSlotLabel.querySelector('span');
                if (labelSpan) {
                    labelSpan.textContent = 'Свободные слоты *';
                }
            }
            if (availabilityMessage) {
                availabilityMessage.style.display = '';
            }
        }
    }
})();
