'use strict';

(function () {
    const API = {
        prices: '/api/kuliga/prices',
        availability: '/api/kuliga/availability',
        createBooking: '/api/kuliga/bookings',
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
        client: {
            fullName: '',
            phone: '',
            email: '',
        },
        payerParticipation: 'self', // self | other
        participants: [],
        sportType: 'ski',
        date: '',
        slot: null,
        availability: [],
        notification: {
            email: true,
            telegram: false,
        },
        syncMainParticipant: true,
    };

    let state = loadState();
    let prices = [];
    const priceMap = new Map();
    let saveTimer = null;
    let availabilityRequestId = 0;

    const normalizePhone = (value = '') => value.replace(/[^0-9+]/g, '');
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

    function initializeSelection() {
        const params = new URLSearchParams(window.location.search);
        const priceIdParam = params.get('priceId');
        const participantsParam = Number(params.get('participants'));

        let price;
        if (priceIdParam && priceMap.has(priceIdParam)) {
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

        state.slot = null;
        state.availability = [];
    }

    function renderSelectionSummary() {
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
        const count = Math.max(1, state.selection.currentParticipants);
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
                <div class="kuliga-participant-card__header">${title}</div>
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
    }

    function updateTotalPrice() {
        const count = Math.max(1, state.selection.currentParticipants);
        const total =
            state.selection.priceType === 'individual'
                ? state.selection.priceValue
                : state.selection.pricePerPerson * count;
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

        scheduleSaveState();
    }

    function setClientFieldValues() {
        clientNameInput.value = state.client.fullName || '';
        clientPhoneInput.value = state.client.phone || '';
        clientEmailInput.value = state.client.email || '';

        participationRadios.forEach((radio) => {
            radio.checked = radio.value === state.payerParticipation;
        });

        sportRadios.forEach((radio) => {
            radio.checked = radio.value === state.sportType;
        });

        dateInput.value = state.date || '';

        notifyEmailCheckbox.checked = Boolean(state.notification.email);
        notifyTelegramCheckbox.checked = Boolean(state.notification.telegram);

        telegramHint.hidden = !state.notification.telegram;
    }

    function handleClientNameChange() {
        state.client.fullName = clientNameInput.value.trim();
        if (state.payerParticipation === 'self' && state.syncMainParticipant && state.participants[0]) {
            state.participants[0].fullName = state.client.fullName;
            renderParticipants();
        }
        scheduleSaveState();
    }

    function handleClientPhoneChange() {
        state.client.phone = clientPhoneInput.value.trim();
        scheduleSaveState();
    }

    function handleClientEmailChange() {
        state.client.email = clientEmailInput.value.trim();
        scheduleSaveState();
    }

    function handleParticipationChange(event) {
        state.payerParticipation = event.target.value;
        if (state.payerParticipation === 'self') {
            if (!state.participants.length) {
                state.participants = [{ fullName: state.client.fullName || '', age: '' }];
            }
            if (!state.participants[0].fullName) {
                state.participants[0].fullName = state.client.fullName;
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
        state.sportType = event.target.value === 'snowboard' ? 'snowboard' : 'ski';
        state.slot = null;
        state.availability = [];
        renderAvailability();
        scheduleSaveState();
        if (state.date) {
            loadAvailability();
        }
    }

    function handleNotificationChange() {
        state.notification.email = notifyEmailCheckbox.checked;
        state.notification.telegram = notifyTelegramCheckbox.checked;
        telegramHint.hidden = !state.notification.telegram;
        scheduleSaveState();
    }

    function handleDateChange() {
        state.date = dateInput.value;
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

        if (state.slot) {
            renderInstructorCard(state.slot);
        }
    }

    function renderInstructorCard(slot) {
        if (!slot) {
            instructorCard.hidden = true;
            return;
        }
        instructorPhoto.src = slot.instructor_photo_url || '/images/gornostyle72_logo.webp';
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

        if (!state.notification.email && !state.notification.telegram) {
            setMessage('Выберите хотя бы один способ уведомлений (email или Telegram).', 'error');
            return false;
        }

        if (state.notification.email && !state.client.email) {
            setMessage('Укажите email или снимите галочку уведомлений по email.', 'error');
            return false;
        }

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
        const totalPrice =
            state.selection.priceType === 'individual'
                ? state.selection.priceValue
                : state.selection.pricePerPerson * participants.length;

        return {
            bookingType: 'individual',
            fullName: state.client.fullName.trim(),
            phone: normalizePhone(state.client.phone),
            email: state.client.email.trim(),
            priceId: state.selection.priceId,
            priceType: state.selection.priceType,
            duration: state.selection.duration,
            sportType: state.sportType,
            date: state.date,
            slotId: state.slot.slot_id,
            instructorId: state.slot.instructor_id,
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
        };
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

            if (state.slot) {
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

        dateInput.addEventListener('change', handleDateChange);
        form.addEventListener('submit', handleSubmit);
    }

    (async function bootstrap() {
        await loadPrices();
        initializeSelection();
        ensureDateRange();
        setClientFieldValues();
        renderParticipants();
        renderSelectionSummary();
        renderAvailability();
        attachListeners();
        scheduleSaveState();

        if (state.date) {
            loadAvailability();
        }
    })();
})();
