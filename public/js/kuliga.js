'use strict';

(function () {
    const API_ENDPOINTS = {
        prices: '/api/kuliga/prices',
        programs: '/api/kuliga/programs',
        instructors: '/api/kuliga/instructors',
    };

    const priceTypeLabels = {
        individual: 'Индивидуальные тренировки',
        group: 'Групповые тренировки',
        sport_group: 'Спортивные группы',
    };

    const priceTypeIcons = {
        individual: 'fa-user',
        group: 'fa-people-group',
        sport_group: 'fa-medal',
    };

    const statusLabels = {
        available: 'Свободно',
        group: 'Групповая тренировка',
        booked: 'Занято',
        blocked: 'Инструктор недоступен',
    };

    const statusClasses = {
        available: 'kuliga-slot--available',
        group: 'kuliga-slot--group',
        booked: 'kuliga-slot--booked',
        blocked: 'kuliga-slot--blocked',
    };

    const sportLabels = {
        ski: 'Горные лыжи',
        snowboard: 'Сноуборд',
        both: 'Лыжи и сноуборд',
    };

    const fetchJson = async (url) => {
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            throw new Error(`Ошибка ${response.status}`);
        }
        return response.json();
    };

    const formatTime = (timeString) => {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
    };

    const formatDate = (dateString, options = {}) => {
        const date = new Date(dateString + 'T00:00:00');
        return new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
            weekday: 'short',
            ...options,
        }).format(date);
    };

    const formatWeekRange = (days) => {
        if (!days || days.length === 0) return '';
        const firstDay = new Date(days[0].iso + 'T00:00:00');
        const lastDay = new Date(days[days.length - 1].iso + 'T00:00:00');
        const year = firstDay.getFullYear();
        
        const firstFormatted = new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
        }).format(firstDay);
        
        const lastFormatted = new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
        }).format(lastDay);
        
        // Если месяц одинаковый, показываем "24–30 ноября 2025"
        if (firstDay.getMonth() === lastDay.getMonth()) {
            return `${firstDay.getDate()}–${lastDay.getDate()} ${new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(firstDay)} ${year}`;
        }
        // Если разные месяцы, показываем "30 ноября – 6 декабря 2025"
        return `${firstFormatted} – ${lastFormatted} ${year}`;
    };

    // Функция для правильного склонения слова "участник"
    const getParticipantsLabel = (count) => {
        if (count === 1) {
            return '1 участник';
        }
        // Для чисел, оканчивающихся на 11, 12, 13, 14 используем "участников"
        const lastDigit = count % 10;
        const lastTwoDigits = count % 100;
        if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
            return `${count} участников`;
        }
        // Для чисел, оканчивающихся на 2, 3, 4 используем "участника"
        if (lastDigit >= 2 && lastDigit <= 4) {
            return `${count} участника`;
        }
        // Для остальных (5, 6, 7, 8, 9, 0) используем "участников"
        return `${count} участников`;
    };

    const renderPriceList = async () => {
        const container = document.getElementById('kuligaPriceList');
        if (!container) return;

        try {
            const response = await fetchJson(API_ENDPOINTS.prices);
            if (!response.success) {
                throw new Error('API вернуло ошибку');
            }

            const sanitizeDescription = (text = '') =>
                text.replace(/-?\s*\d+\s*человек\s*-\s*общая\s*цена\.?/gi, '').trim();

            const individuals = response.data
                .filter((price) => price.type === 'individual')
                .sort((a, b) => Number(a.price) - Number(b.price));

            const groups = response.data
                .filter((price) => price.type !== 'individual')
                .map((price) => {
                    const participants = Math.max(1, Number(price.participants) || 1);
                    // Цена в прайсе - это всегда ОБЩАЯ цена группы (для всех количеств участников)
                    const perPerson = Number(price.price) / participants;
                    return { ...price, participants, perPerson };
                })
                .sort((a, b) => a.participants - b.participants); // Сортировка по количеству участников по возрастанию

            const ordered = [...individuals, ...groups];

            const fragment = document.createDocumentFragment();

            ordered.forEach((price) => {
                const card = document.createElement('article');
                card.className = 'kuliga-price-card';

                const isGroup = price.type !== 'individual';
                const participants = Math.max(1, Number(price.participants) || 1);
                const priceValue = Number(price.price) || 0;
                // Цена в прайсе - это всегда ОБЩАЯ цена группы (для всех количеств участников)
                const pricePerPerson = isGroup 
                    ? Math.ceil(priceValue / participants)
                    : priceValue;
                const totalPrice = isGroup ? priceValue : priceValue; // Для группы используем исходную цену

                if (!isGroup) {
                    card.classList.add('kuliga-price-card--highlight');
                }

                const description = sanitizeDescription(price.description || '');
                const participantsLabel = getParticipantsLabel(participants);

                card.innerHTML = `
                    <div class="kuliga-price-card__type">
                        <i class="fa-solid ${priceTypeIcons[price.type] || 'fa-ticket'}"></i>
                        ${priceTypeLabels[price.type] || 'Тренировка'}
                    </div>
                    <div class="kuliga-price-card__value">
                        ${Number(pricePerPerson).toLocaleString('ru-RU')} ₽ ${isGroup ? '<small>за человека</small>' : ''}
                    </div>
                    ${
                        isGroup
                            ? `
                                <div class="kuliga-price-card__participants">${participantsLabel}</div>
                                <div class="kuliga-price-card__total">Общая стоимость: ${Number(totalPrice).toLocaleString('ru-RU')} ₽</div>
                            `
                            : ''
                    }
                    <div class="kuliga-price-card__meta">
                        <span><i class="fa-regular fa-clock"></i> ${price.duration} мин.</span>
                        ${description ? `<span><i class="fa-regular fa-note-sticky"></i> ${description}</span>` : ''}
                    </div>
                    <div class="kuliga-price-card__note" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(148, 163, 184, 0.2); font-size: 0.85rem; color: var(--kuliga-gray-500);">
                        <i class="fa-solid fa-circle-info"></i> Аренда снаряжения и подъемника в стоимость не входят
                    </div>
                    <button class="kuliga-button kuliga-button--secondary kuliga-button--small" 
                            data-booking-trigger
                            data-price-id="${price.id}"
                            data-price-type="${price.type}"
                            data-price-value="${priceValue}"
                            data-price-duration="${price.duration}"
                            data-price-participants="${participants}">
                        Записаться
                    </button>
                `;

                fragment.appendChild(card);
            });

            container.innerHTML = '';
            container.appendChild(fragment);
            initPriceBookingButtons();
        } catch (error) {
            console.error('Не удалось загрузить прайс:', error);
            container.innerHTML = '<div class="kuliga-empty">Не удалось загрузить прайс. Пожалуйста, попробуйте позже.</div>';
        }
    };

    const renderProgramsAndSchedule = async (locationFilter = null) => {
        const programContainer = document.getElementById('kuligaProgramList');
        const scheduleContainer = document.getElementById('kuligaGroupList');

        if (!programContainer && !scheduleContainer) return;

        try {
            const url = locationFilter ? `${API_ENDPOINTS.programs}?location=${locationFilter}` : API_ENDPOINTS.programs;
            const response = await fetchJson(url);
            if (!response.success) {
                throw new Error('API вернуло ошибку');
            }

            const programs = response.data.programs || [];
            const schedule = response.data.schedule || [];

            if (programContainer) {
                if (!programs.length) {
                    const locationName = locationFilter && window.getLocationName 
                        ? window.getLocationName(locationFilter) 
                        : '';
                    programContainer.innerHTML =
                        `<div class="kuliga-empty">${locationName ? `В ${locationName} программы ещё не добавлены. ` : 'Программы ещё не добавлены. '}Следите за обновлениями в Telegram.</div>`;
                } else {
                    programContainer.innerHTML = programs
                        .map((program) => {
                            const nextSession = (program.schedule || [])[0];
                            let nextHint = '';
                            if (nextSession) {
                                const phoneNumber = '${process.env.SUPPORT_PHONE || "+7 (900) 123-45-67"}';
                                if (nextSession.status === 'cancelled') {
                                    nextHint = `<div class="kuliga-program-next kuliga-program-cancelled"><i class="fa-solid fa-calendar-xmark"></i> Ближайшее занятие: ${nextSession.date_label} (${nextSession.weekday_short}) в ${nextSession.time} <span style="color: #e74c3c; font-weight: 600;">отменено</span>, причину уточните у администратора по тел: ${phoneNumber}</div>`;
                                } else {
                                    nextHint = `<div class="kuliga-program-next"><i class="fa-solid fa-calendar-days"></i> Ближайшее занятие: ${nextSession.date_label} (${nextSession.weekday_short}) в ${nextSession.time}</div>`;
                                }
                            }
                            const locationName = program.location && window.getLocationName 
                                ? window.getLocationName(program.location) 
                                : 'Место не указано';
                            
                            // Формируем атрибуты для кнопки "Записаться" из nextSession
                            const bookingButtonAttrs = nextSession && nextSession.status !== 'cancelled'
                                ? `data-program-id="${program.id}" data-program-date="${nextSession.date_iso}" data-program-time="${nextSession.time}"`
                                : `data-program-id="${program.id}"`;
                            
                            return `
                                <article class="kuliga-group-card">
                                    <h3>${program.name}</h3>
                                    ${program.description ? `<p>${program.description}</p>` : '<p>Описание появится в ближайшее время.</p>'}
                                    <div class="kuliga-group-card__meta">
                                        <span><i class="fa-solid fa-location-dot"></i> ${locationName}</span>
                                        <span><i class="fa-solid fa-person-skiing"></i> ${sportLabels[program.sport_type] || 'Инструктор'}</span>
                                        <span><i class="fa-solid fa-users"></i> До ${program.max_participants} человек</span>
                                        <span><i class="fa-solid fa-clock"></i> ${program.training_duration} мин. (практика ${program.practice_duration} мин.)</span>
                                        <span><i class="fa-solid fa-coins"></i> ${Number(program.price).toLocaleString('ru-RU')} ₽</span>
                                    </div>
                                    <ul class="kuliga-program-options">
                                        <li><i class="fa-solid fa-person-snowboarding"></i> Снаряжение: ${program.equipment_provided ? 'предоставляем' : 'берёте самостоятельно'}</li>
                                        <li><i class="fa-solid fa-ticket"></i> Скипас: ${program.skipass_provided ? 'предоставляем' : 'берёте самостоятельно'}</li>
                                    </ul>
                                    ${nextHint}
                                    <button 
                                        class="kuliga-button kuliga-button--secondary kuliga-button--wide"
                                        data-program-book
                                        ${bookingButtonAttrs}>
                                        Записаться
                                    </button>
                                </article>
                            `;
                        })
                        .join('');
                }
            }

            if (scheduleContainer) {
                if (!schedule.length) {
                    const locationName = locationFilter && window.getLocationName 
                        ? window.getLocationName(locationFilter) 
                        : '';
                    scheduleContainer.innerHTML =
                        `<div class="kuliga-empty">${locationName ? `В ${locationName} в ближайшие две недели регулярных занятий нет. ` : 'В ближайшие две недели регулярных занятий нет. '}Оформите подписку на уведомления в Telegram.</div>`;
                } else {
                    // Фильтруем отмененные тренировки
                    const activeSchedule = schedule.filter((item) => item.status !== 'cancelled');
                    scheduleContainer.innerHTML = activeSchedule
                        .map(
                            (item) => {
                                const locationName = item.location && window.getLocationName 
                                    ? window.getLocationName(item.location) 
                                    : '';
                                return `
                                <article class="kuliga-group-item">
                                    <div class="kuliga-group-item__top">
                                        <span class="kuliga-group-item__date">${item.date_label} (${item.weekday_short})</span>
                                        <strong>${item.program_name}</strong>
                                    </div>
                                    <div class="kuliga-group-item__meta">
                                        ${locationName ? `<span><i class="fa-solid fa-location-dot"></i> ${locationName}</span>` : ''}
                                        <span><i class="fa-regular fa-clock"></i> ${item.time}</span>
                                        <span><i class="fa-solid fa-person-skiing"></i> ${sportLabels[item.sport_type] || 'Инструктор'}</span>
                                        <span><i class="fa-solid fa-seat-airline"></i> Свободно ${item.available_slots || item.max_participants - (item.current_participants || 0)} мест</span>
                                        ${item.price_per_person ? `<span><i class="fa-solid fa-coins"></i> ${Number(item.price_per_person).toLocaleString('ru-RU')} ₽</span>` : ''}
                                        ${item.instructor_name ? `<span><i class="fa-solid fa-user-tie"></i> ${item.instructor_name}</span>` : '<span><i class="fa-solid fa-user-tie"></i> Инструктор будет назначен</span>'}
                                    </div>
                                    <div class="kuliga-group-item__actions">
                                        <button 
                                            class="kuliga-button kuliga-button--primary"
                                            data-program-book
                                            data-program-id="${item.program_id}"
                                            data-program-date="${item.date_iso}"
                                            data-program-time="${item.time}">
                                            Записаться
                                        </button>
                                    </div>
                                </article>
                            `;
                            }
                        )
                        .join('');
                }
            }

            initProgramBookingButtons();
        } catch (error) {
            console.error('Не удалось загрузить программы Кулиги:', error);
            if (programContainer) {
                programContainer.innerHTML =
                    '<div class="kuliga-empty">Не удалось загрузить программы. Попробуйте обновить страницу позже.</div>';
            }
            if (scheduleContainer) {
                scheduleContainer.innerHTML =
                    '<div class="kuliga-empty">Не удалось загрузить расписание. Попробуйте обновить страницу позже.</div>';
            }
        }
    };

    const initProgramBookingButtons = () => {
        document.querySelectorAll('[data-program-book]').forEach((button) => {
            button.addEventListener('click', () => {
                const programId = button.getAttribute('data-program-id');
                const date = button.getAttribute('data-program-date');
                const time = button.getAttribute('data-program-time');

                const url = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
                if (programId) url.searchParams.set('programId', programId);
                if (date) url.searchParams.set('date', date);
                if (time) url.searchParams.set('time', time);

                window.location.href = url.toString();
            });
        });
    };

    const initPriceBookingButtons = () => {
        document.querySelectorAll('[data-booking-trigger]').forEach((button) => {
            button.addEventListener('click', () => {
                const priceId = button.getAttribute('data-price-id');
                const priceType = button.getAttribute('data-price-type');
                const priceValue = button.getAttribute('data-price-value');
                const duration = button.getAttribute('data-price-duration');
                const participants = button.getAttribute('data-price-participants');

                const url = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
                if (priceId) url.searchParams.set('priceId', priceId);
                if (priceType) url.searchParams.set('type', priceType);
                if (priceValue) url.searchParams.set('price', priceValue);
                if (duration) url.searchParams.set('duration', duration);
                if (participants) url.searchParams.set('participants', participants);

                window.location.href = url.toString();
            });
        });
    };

    // Проверить, есть ли у дня расписание (любые слоты - свободные, занятые, групповые)
    // Используется для проверки наличия расписания у инструктора
    const hasScheduleForDay = (instructor, dayIso) => {
        const daySchedule = instructor.schedule[dayIso] || [];
        // Проверяем наличие любых слотов (available, booked, blocked, group и т.д.)
        return daySchedule.length > 0;
    };

    // Проверить, есть ли у дня расписание для отображения (только будущие дни с доступными или групповыми слотами)
    // Используется для отображения дней в мобильной версии
    const hasVisibleScheduleForDay = (instructor, dayIso) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayDate = new Date(dayIso + 'T00:00:00');
        
        // Пропускаем прошедшие дни
        if (dayDate < today) {
            return false;
        }
        
        const daySchedule = instructor.schedule[dayIso] || [];
        return daySchedule.length > 0 && daySchedule.some(slot => 
            slot.status === 'available' || slot.status === 'group' || slot.type === 'group_training'
        );
    };

    // Проверить, есть ли у инструктора хотя бы одно расписание (любые слоты) на будущие даты (>= сегодня)
    const hasAnySchedule = (instructor, days) => {
        const schedule = instructor.schedule || {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Проверяем весь объект schedule - ищем хотя бы одну дату с непустым массивом слотов, которая >= сегодня
        return Object.keys(schedule).some(dateIso => {
            const dayDate = new Date(dateIso + 'T00:00:00');
            // Проверяем только будущие даты (включая сегодня)
            if (dayDate < today) {
                return false;
            }
            
            const daySchedule = schedule[dateIso] || [];
            // Проверяем наличие любых слотов (available, booked, blocked, group и т.д.)
            return daySchedule.length > 0;
        });
    };

    // Найти первый день с расписанием для инструктора (только будущие дни с доступными/групповыми слотами)
    const findFirstDayWithSchedule = (instructor, days) => {
        for (let i = 0; i < days.length; i++) {
            if (hasVisibleScheduleForDay(instructor, days[i].iso)) {
                return i;
            }
        }
        return 0; // Если нет расписания, начинаем с первого дня
    };

    // Фильтровать дни для мобильной версии: только будущие дни с доступными или групповыми слотами
    const filterDaysForMobile = (instructor, days) => {
        return days.filter(day => hasVisibleScheduleForDay(instructor, day.iso));
    };

    // Сохраняем список ID инструкторов с расписанием на месяц вперед (>= сегодня)
    let instructorsWithScheduleIds = new Set();

    const renderInstructors = async (weekOffset = 0) => {
        const container = document.getElementById('kuligaInstructors');
        if (!container) return;

        try {
            // Загружаем данные для текущей недели
            const url = weekOffset !== 0 
                ? `${API_ENDPOINTS.instructors}?weekOffset=${weekOffset}`
                : API_ENDPOINTS.instructors;
            const response = await fetchJson(url);
            if (!response.success) {
                throw new Error('API вернуло ошибку');
            }

            const { days, instructors } = response.data;

            if (!instructors.length) {
                container.innerHTML = '<div class="kuliga-empty">Инструкторы ещё не добавлены. Скоро здесь появится команда Кулиги.</div>';
                return;
            }

            // Загружаем данные на месяц вперед (4 недели: weekOffset 0-4) параллельно для определения инструкторов с расписанием
            // Обновляем список при первой загрузке или при возврате на первую неделю
            if (instructorsWithScheduleIds.size === 0 || weekOffset === 0) {
                const monthPromises = [];
                for (let i = 0; i <= 4; i++) {
                    if (i === weekOffset) {
                        // Используем уже загруженные данные для текущей недели
                        monthPromises.push(Promise.resolve({ days, instructors }));
                    } else {
                        monthPromises.push(
                            fetchJson(i === 0 ? API_ENDPOINTS.instructors : `${API_ENDPOINTS.instructors}?weekOffset=${i}`)
                                .then(res => res.success ? res.data : null)
                                .catch(() => null)
                        );
                    }
                }

                const monthData = await Promise.all(monthPromises);
                
                // Собираем все уникальные инструкторы с расписанием на будущее (>= сегодня)
                instructorsWithScheduleIds = new Set();
                
                monthData.forEach((weekData) => {
                    if (!weekData || !weekData.instructors) return;
                    
                    weekData.instructors.forEach((instructor) => {
                        // Проверяем, есть ли у инструктора расписание на будущее (>= сегодня)
                        if (hasAnySchedule(instructor, weekData.days)) {
                            instructorsWithScheduleIds.add(instructor.id);
                        }
                    });
                });
            }

            // Показываем всех инструкторов, у кого есть расписание на будущее (>= сегодня)
            // даже если на текущей отображаемой неделе у них нет слотов
            const filteredInstructors = instructors.filter(instructor => 
                instructorsWithScheduleIds.has(instructor.id)
            );

            if (!filteredInstructors.length) {
                container.innerHTML = '<div class="kuliga-empty">Нет доступных инструкторов с расписанием на ближайшее время.</div>';
                return;
            }

            const fragment = document.createDocumentFragment();

            const isMobile = window.innerWidth <= 767;

            filteredInstructors.forEach((instructor) => {
                const card = document.createElement('article');
                card.className = 'kuliga-instructor-card';

                const photoUrl = instructor.photo_url || 'https://via.placeholder.com/160x160/1e293b/ffffff?text=GS72';
                const sportLabel = sportLabels[instructor.sport_type] || 'Инструктор';
                
                // Формируем название локации для отображения
                const locationDisplayName = instructor.location === 'vorona' 
                    ? 'Воронинские горки' 
                    : (instructor.location === 'kuliga' || !instructor.location) 
                        ? 'Кулига' 
                        : instructor.location;

                // Для мобильной версии фильтруем дни: только будущие дни с расписанием
                const daysToRender = isMobile ? filterDaysForMobile(instructor, days) : days;
                const firstDayIndex = isMobile ? 0 : findFirstDayWithSchedule(instructor, days);

                card.innerHTML = `
                    <header class="kuliga-instructor__header">
                        <img class="kuliga-instructor__photo" src="${photoUrl}" alt="${instructor.full_name}" loading="lazy">
                        <div class="kuliga-instructor__info">
                            <h3>${instructor.full_name}</h3>
                            <span class="kuliga-instructor__sport"><i class="fa-solid fa-person-skiing"></i> ${sportLabel}</span>
                            <span class="kuliga-instructor__location"><i class="fa-solid fa-location-dot"></i> ${locationDisplayName}</span>
                            ${instructor.description ? `<p class="kuliga-instructor__description">${instructor.description}</p>` : ''}
                        </div>
                    </header>
                    <div class="kuliga-schedule" data-instructor-id="${instructor.id}" data-week-offset="${weekOffset}">
                        <div class="kuliga-schedule__nav kuliga-schedule__nav--desktop">
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--prev" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="prev-week"
                                    ${weekOffset === 0 ? 'disabled' : ''}
                                    aria-label="Предыдущая неделя">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                            <div class="kuliga-schedule__week-title">
                                <span class="kuliga-schedule__week-range">${formatWeekRange(days)}</span>
                                ${weekOffset === 0 ? '<span class="kuliga-schedule__week-badge">Текущая неделя</span>' : ''}
                            </div>
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--next" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="next-week"
                                    ${weekOffset >= 4 ? 'disabled' : ''}
                                    aria-label="Следующая неделя">
                                <i class="fa-solid fa-chevron-right"></i>
                            </button>
                        </div>
                        ${isMobile ? `
                        <div class="kuliga-schedule__nav kuliga-schedule__nav--mobile-week">
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--prev-week-mobile" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="prev-week"
                                    ${weekOffset === 0 ? 'disabled' : ''}
                                    aria-label="Предыдущая неделя">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                            <div class="kuliga-schedule__week-title kuliga-schedule__week-title--mobile">
                                <span class="kuliga-schedule__week-range">${formatWeekRange(days)}</span>
                                ${weekOffset === 0 ? '<span class="kuliga-schedule__week-badge">Текущая неделя</span>' : ''}
                            </div>
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--next-week-mobile" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="next-week"
                                    ${weekOffset >= 4 ? 'disabled' : ''}
                                    aria-label="Следующая неделя">
                                <i class="fa-solid fa-chevron-right"></i>
                            </button>
                        </div>
                        ` : ''}
                        <div class="kuliga-schedule__wrapper">
                            ${isMobile ? `
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--mobile kuliga-schedule__nav-btn--prev-mobile" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="prev-day"
                                    aria-label="Предыдущий день">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                            ` : ''}
                            <div class="kuliga-schedule__days" data-start-index="${firstDayIndex}">
                                ${daysToRender.map((day, index) => {
                                    const daySchedule = instructor.schedule[day.iso] || [];
                                    // Фильтруем только видимые слоты (доступные и групповые тренировки)
                                    const visibleSlots = daySchedule.filter(slot => 
                                        slot.status === 'available' || slot.status === 'group' || slot.type === 'group_training'
                                    );
                                    const availableSlots = visibleSlots.filter(slot => slot.status === 'available').length;
                                    const groupSlots = visibleSlots.filter(slot => slot.status === 'group' || slot.type === 'group_training').length;
                                    const totalSlots = visibleSlots.length;
                                    const hasSlots = totalSlots > 0;
                                    
                                    // Определяем, является ли день сегодняшним
                                    const today = new Date();
                                    const dayDate = new Date(day.iso + 'T00:00:00');
                                    const isToday = today.toDateString() === dayDate.toDateString();
                                    
                                    // Формируем счетчик слотов
                                    let slotCounter = '';
                                    if (totalSlots > 0) {
                                        const parts = [];
                                        if (availableSlots > 0) parts.push(`${availableSlots} свободно`);
                                        if (groupSlots > 0) parts.push(`${groupSlots} групп.`);
                                        slotCounter = parts.length > 0 ? `<div class="kuliga-schedule__day-counter">${parts.join(', ')}</div>` : '';
                                    }
                                    
                                    return `
                                        <div class="kuliga-schedule__day ${isToday ? 'kuliga-schedule__day--today' : ''} ${hasSlots ? 'kuliga-schedule__day--has-slots' : 'kuliga-schedule__day--empty'}" 
                                             data-date="${day.iso}" 
                                             data-index="${index}">
                                            <div class="kuliga-schedule__day-header">
                                                <div class="kuliga-schedule__weekday">${day.weekday}</div>
                                                <div class="kuliga-schedule__date">${day.label}</div>
                                                ${slotCounter}
                                            </div>
                                            <div class="kuliga-slot-list">
                                                ${daySchedule.length > 0 ? (() => {
                                                    // Фильтруем слоты - показываем только доступные (available) или групповые тренировки (group)
                                                    // Не показываем занятые (booked) или заблокированные (blocked) слоты
                                                    const visibleSlots = daySchedule.filter(slot => 
                                                        slot.status === 'available' || slot.status === 'group' || slot.type === 'group_training'
                                                    );
                                                    
                                                    if (visibleSlots.length === 0) {
                                                        return '<span class="kuliga-slot kuliga-slot--empty">Нет расписания</span>';
                                                    }
                                                    
                                                    return visibleSlots.map((slot) => {
                                                        // Делаем слот кликабельным только если он доступен или групповая тренировка
                                                        const isClickable = slot.status === 'available' || slot.status === 'group' || slot.type === 'group_training';
                                                        const clickableClass = isClickable ? 'kuliga-slot--clickable' : '';
                                                        const cursorStyle = isClickable ? 'cursor: pointer;' : '';
                                                        
                                                        // Определяем статус для групповых тренировок (чтобы был правильный класс)
                                                        const displayStatus = slot.type === 'group_training' ? 'group' : slot.status;
                                                        
                                                        // Собираем данные о слоте для передачи в модальное окно
                                                        // Для групповых тренировок используем данные из самого слота
                                                        let slotData;
                                                        if (slot.type === 'group_training') {
                                                            // Это групповая тренировка - используем её данные напрямую
                                                            slotData = {
                                                                id: slot.id,
                                                                slotId: slot.slotId || null,
                                                                instructorId: instructor.id,
                                                                date: day.iso,
                                                                startTime: slot.startTime,
                                                                endTime: slot.endTime || '',
                                                                status: 'group',
                                                                location: instructor.location || 'kuliga',
                                                                slotType: 'group_training',
                                                                programId: slot.programId || null,
                                                                groupTraining: {
                                                                    id: slot.id,
                                                                    programId: slot.programId || null,
                                                                    maxParticipants: slot.maxParticipants || 0,
                                                                    currentParticipants: slot.currentParticipants || 0,
                                                                    pricePerPerson: slot.pricePerPerson || 0,
                                                                    level: slot.level || null,
                                                                    description: slot.description || null
                                                                }
                                                            };
                                                        } else {
                                                            // Это обычный слот (может быть свободный или с групповой тренировкой)
                                                            slotData = {
                                                                slotId: slot.id,
                                                                instructorId: instructor.id,
                                                                date: day.iso,
                                                                startTime: slot.startTime,
                                                                endTime: slot.endTime || '',
                                                                status: slot.status,
                                                                location: instructor.location || 'kuliga',
                                                                slotType: 'slot',
                                                                groupTraining: slot.groupTraining || null,
                                                                programId: slot.groupTraining ? (slot.groupTraining.programId || null) : null
                                                            };
                                                        }
                                                        
                                                        // Экранируем JSON для безопасной вставки в HTML
                                                        const dataAttrs = isClickable 
                                                            ? `data-slot-data="${encodeURIComponent(JSON.stringify(slotData))}"` 
                                                            : '';
                                                        return `
                                                            <span class="kuliga-slot ${statusClasses[displayStatus] || ''} ${clickableClass}" 
                                                                  ${dataAttrs}
                                                                  style="${cursorStyle}"
                                                                  title="${isClickable ? 'Нажмите для записи на тренировку' : ''}">
                                                                <span class="kuliga-slot__time">${formatTime(slot.startTime)}</span>
                                                                <span class="kuliga-slot__status"> — ${statusLabels[displayStatus] || ''}</span>
                                                            </span>
                                                        `;
                                                    }).join('');
                                                })() : '<span class="kuliga-slot kuliga-slot--empty">Нет расписания</span>'}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                            ${isMobile ? `
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--mobile kuliga-schedule__nav-btn--next-mobile" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="next-day"
                                    aria-label="Следующий день">
                                <i class="fa-solid fa-chevron-right"></i>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                `;

                fragment.appendChild(card);
            });

            container.innerHTML = '';
            container.appendChild(fragment);
            initScheduleNavigation();
            initScheduleTouchPrevention();
            initSlotClicks();
            
            // На мобильной версии прокручиваем к первому дню с расписанием
            // НО только если в URL есть якорь (например, #instructors), иначе прокрутка не нужна
            // Важно: используем только горизонтальную прокрутку контейнера, без прокрутки всей страницы
            if (window.innerWidth <= 767 && window.location.hash && window.location.hash !== '#') {
                setTimeout(() => {
                    document.querySelectorAll('.kuliga-schedule').forEach((scheduleEl) => {
                        const daysContainer = scheduleEl.querySelector('.kuliga-schedule__days');
                        if (!daysContainer) return;
                        
                        const startIndex = parseInt(daysContainer.getAttribute('data-start-index') || '0', 10);
                        const days = Array.from(daysContainer.querySelectorAll('.kuliga-schedule__day'));
                        if (days[startIndex]) {
                            const targetDay = days[startIndex];
                            
                            // Только горизонтальная прокрутка контейнера, БЕЗ прокрутки всей страницы
                            requestAnimationFrame(() => {
                                const scrollLeft = targetDay.offsetLeft;
                                daysContainer.scrollLeft = scrollLeft;
                            });
                        }
                    });
                }, 300);
            } else if (window.innerWidth <= 767) {
                // Если нет якоря, гарантируем, что страница открыта в начале
                setTimeout(() => {
                    if (!window.location.hash || window.location.hash === '#') {
                        window.scrollTo(0, 0);
                    }
                }, 350);
            }
        } catch (error) {
            console.error('Не удалось загрузить инструкторов:', error);
            container.innerHTML = '<div class="kuliga-empty">Не удалось загрузить список инструкторов. Зайдите позже.</div>';
        }
    };

    const initScheduleNavigation = () => {
        // Навигация по неделям (десктоп и мобильная версия)
        document.querySelectorAll('[data-action="prev-week"], [data-action="next-week"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const action = e.currentTarget.getAttribute('data-action');
                const instructorId = e.currentTarget.getAttribute('data-instructor-id');
                const scheduleEl = document.querySelector(`[data-instructor-id="${instructorId}"]`);
                if (!scheduleEl) return;

                const currentWeekOffset = parseInt(scheduleEl.getAttribute('data-week-offset') || '0', 10);
                let newWeekOffset;
                
                if (action === 'prev-week') {
                    newWeekOffset = Math.max(0, currentWeekOffset - 1);
                } else {
                    // Можно листать на месяц вперед (до weekOffset = 4, т.е. 4 недели)
                    newWeekOffset = Math.min(4, currentWeekOffset + 1);
                }

                // Перезагружаем всех инструкторов с новым weekOffset
                await renderInstructors(newWeekOffset);
            });
        });
        
        // Обновляем состояние кнопок навигации (десктоп и мобильная версия)
        document.querySelectorAll('.kuliga-schedule').forEach((scheduleEl) => {
            const weekOffset = parseInt(scheduleEl.getAttribute('data-week-offset') || '0', 10);
            const instructorId = scheduleEl.getAttribute('data-instructor-id');
            
            // Обновляем кнопки для десктоп версии
            const prevBtn = scheduleEl.querySelector(`[data-instructor-id="${instructorId}"][data-action="prev-week"]:not(.kuliga-schedule__nav-btn--prev-week-mobile):not(.kuliga-schedule__nav-btn--next-week-mobile)`);
            const nextBtn = scheduleEl.querySelector(`[data-instructor-id="${instructorId}"][data-action="next-week"]:not(.kuliga-schedule__nav-btn--prev-week-mobile):not(.kuliga-schedule__nav-btn--next-week-mobile)`);
            
            // Обновляем кнопки для мобильной версии
            const prevBtnMobile = scheduleEl.querySelector(`[data-instructor-id="${instructorId}"][data-action="prev-week"].kuliga-schedule__nav-btn--prev-week-mobile`);
            const nextBtnMobile = scheduleEl.querySelector(`[data-instructor-id="${instructorId}"][data-action="next-week"].kuliga-schedule__nav-btn--next-week-mobile`);
            
            if (prevBtn) {
                prevBtn.disabled = weekOffset === 0;
            }
            if (nextBtn) {
                // Можно листать на месяц вперед (до weekOffset = 4)
                nextBtn.disabled = weekOffset >= 4;
            }
            if (prevBtnMobile) {
                prevBtnMobile.disabled = weekOffset === 0;
            }
            if (nextBtnMobile) {
                // Можно листать на месяц вперед (до weekOffset = 4)
                nextBtnMobile.disabled = weekOffset >= 4;
            }
        });

        // Навигация по дням (мобильная)
        document.querySelectorAll('[data-action="prev-day"], [data-action="next-day"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.getAttribute('data-action');
                const instructorId = e.currentTarget.getAttribute('data-instructor-id');
                const scheduleEl = document.querySelector(`[data-instructor-id="${instructorId}"]`);
                if (!scheduleEl) return;

                const daysContainer = scheduleEl.querySelector('.kuliga-schedule__days');
                if (!daysContainer) return;

                const days = Array.from(daysContainer.querySelectorAll('.kuliga-schedule__day'));
                if (days.length === 0) return;

                // Находим текущий видимый день
                const containerRect = daysContainer.getBoundingClientRect();
                let currentIndex = -1;
                days.forEach((day, index) => {
                    const dayRect = day.getBoundingClientRect();
                    if (dayRect.left >= containerRect.left && dayRect.right <= containerRect.right) {
                        currentIndex = index;
                    }
                });

                if (currentIndex === -1) {
                    // Если не нашли, используем первый день с расписанием
                    const startIndex = parseInt(daysContainer.getAttribute('data-start-index') || '0', 10);
                    currentIndex = startIndex;
                }

                // Вычисляем следующий/предыдущий индекс
                let targetIndex;
                if (action === 'prev-day') {
                    targetIndex = Math.max(0, currentIndex - 1);
                } else {
                    targetIndex = Math.min(days.length - 1, currentIndex + 1);
                }

                // Прокручиваем к целевому дню
                const targetDay = days[targetIndex];
                if (targetDay) {
                    targetDay.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            });
        });
    };

    const initScheduleTouchPrevention = () => {
        // Блокируем горизонтальные свайпы на расписании в мобильной версии
        if (window.innerWidth <= 767) {
            document.querySelectorAll('.kuliga-schedule__days').forEach((daysContainer) => {
                let touchStartX = 0;
                let touchStartY = 0;
                let isScrolling = false;

                daysContainer.addEventListener('touchstart', (e) => {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    isScrolling = false;
                }, { passive: true });

                daysContainer.addEventListener('touchmove', (e) => {
                    if (!touchStartX || !touchStartY) return;

                    const touchCurrentX = e.touches[0].clientX;
                    const touchCurrentY = e.touches[0].clientY;
                    const diffX = Math.abs(touchCurrentX - touchStartX);
                    const diffY = Math.abs(touchCurrentY - touchStartY);

                    // Если горизонтальное движение больше вертикального - блокируем
                    if (diffX > diffY && diffX > 10) {
                        e.preventDefault();
                        e.stopPropagation();
                        isScrolling = true;
                    }
                }, { passive: false });

                daysContainer.addEventListener('touchend', () => {
                    touchStartX = 0;
                    touchStartY = 0;
                    isScrolling = false;
                }, { passive: true });
            });
        }
    };

    const initBookingButton = () => {
        const button = document.querySelector('[data-booking-open]');
        if (!button) return;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            window.location.href = '/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking';
        });
    };

    const initSlotClicks = () => {
        // Обработчик клика на слоты для записи на тренировку
        // Используем модальные окна вместо перехода на страницу
        document.querySelectorAll('.kuliga-slot--clickable').forEach((slotElement) => {
            slotElement.addEventListener('click', async (event) => {
                event.preventDefault();
                
                // Получаем данные из data-атрибута (новый способ)
                const slotDataStr = slotElement.getAttribute('data-slot-data');
                if (slotDataStr) {
                    // Используем функцию из модуля модальных окон
                    if (window.openSlotBookingModal) {
                        await window.openSlotBookingModal(slotDataStr);
                    } else {
                        console.error('Модуль модальных окон не загружен');
                        // Fallback на старую логику
                        try {
                            const slotData = JSON.parse(decodeURIComponent(slotDataStr));
                            redirectToBookingPage(slotData);
                        } catch (error) {
                            console.error('Ошибка парсинга данных слота:', error);
                            const slotData = getSlotDataFromAttributes(slotElement);
                            if (slotData) {
                                redirectToBookingPage(slotData);
                            }
                        }
                    }
                } else {
                    // Старый способ (fallback)
                    const slotData = getSlotDataFromAttributes(slotElement);
                    if (slotData) {
                        redirectToBookingPage(slotData);
                    }
                }
            });
        });
    };

    // Fallback функция для получения данных из старых атрибутов
    function getSlotDataFromAttributes(element) {
        const slotId = element.getAttribute('data-slot-id');
        const instructorId = element.getAttribute('data-instructor-id');
        const date = element.getAttribute('data-date');
        const startTime = element.getAttribute('data-start-time');
        const endTime = element.getAttribute('data-end-time');
        const status = element.getAttribute('data-status');
        const location = element.getAttribute('data-location');
        
        if (!slotId || !instructorId || !date || !startTime) {
            return null;
        }
        
        return {
            slotId: parseInt(slotId),
            instructorId: parseInt(instructorId),
            date: date,
            startTime: startTime,
            endTime: endTime || '',
            status: status || 'available',
            location: location || 'kuliga',
            slotType: 'slot'
        };
    }

    // Fallback функция для перехода на страницу бронирования (старая логика)
    function redirectToBookingPage(slotData) {
        const bookingUrl = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
        bookingUrl.searchParams.set('slotId', slotData.slotId);
        bookingUrl.searchParams.set('instructorId', slotData.instructorId);
        bookingUrl.searchParams.set('date', slotData.date);
        bookingUrl.searchParams.set('startTime', slotData.startTime);
        if (slotData.endTime) bookingUrl.searchParams.set('endTime', slotData.endTime);
        bookingUrl.searchParams.set('location', slotData.location || 'kuliga');
        bookingUrl.searchParams.set('bookingType', slotData.status === 'group' ? 'group' : 'individual');
        bookingUrl.searchParams.set('priceType', slotData.status === 'group' ? 'group' : 'individual');
        window.location.href = bookingUrl.toString();
    }

    // Функция для отправки событий в Яндекс.Метрику
    function trackYandexMetrika(goalName, params = {}) {
        if (window.ym && window.KULIGA_ANALYTICS && window.KULIGA_ANALYTICS.yandexMetrikaId) {
            try {
                window.ym(window.KULIGA_ANALYTICS.yandexMetrikaId, 'reachGoal', goalName, params);
            } catch (e) {
                console.warn('Ошибка отправки события в Яндекс.Метрику:', e);
            }
        }
    }

    // Функция для отправки событий в Google Analytics
    function trackGoogleAnalytics(eventName, params = {}) {
        if (window.gtag) {
            try {
                window.gtag('event', eventName, params);
            } catch (e) {
                console.warn('Ошибка отправки события в Google Analytics:', e);
            }
        }
    }

    // Отслеживание просмотра страницы инструкторов
    function trackPageView() {
        trackYandexMetrika('instructor_page_view', {
            page_url: window.location.href,
            page_title: 'Страница инструкторов'
        });
        trackGoogleAnalytics('page_view', {
            page_title: 'Страница инструкторов',
            page_location: window.location.href
        });
    }

    // Отслеживание клика по кнопке записи
    function trackBookingButtonClick() {
        trackYandexMetrika('booking_button_click', {
            button_location: 'hero_section'
        });
        trackGoogleAnalytics('button_click', {
            button_name: 'Записаться на тренировку',
            button_location: 'hero_section'
        });
    }

    // Отслеживание просмотра инструкторов
    function trackInstructorsView() {
        trackYandexMetrika('instructors_list_view');
        trackGoogleAnalytics('instructors_view', {
            event_category: 'engagement'
        });
    }

    // Отслеживание просмотра цен
    function trackPricesView() {
        trackYandexMetrika('prices_view');
        trackGoogleAnalytics('prices_view', {
            event_category: 'engagement'
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Отслеживание просмотра страницы
        trackPageView();

        renderPriceList();
        renderProgramsAndSchedule();
        renderInstructors();
        initBookingButton();

        // Отслеживание просмотра инструкторов после загрузки
        setTimeout(() => {
            trackInstructorsView();
            trackPricesView();
        }, 2000);

        // Отслеживание клика по кнопке записи в hero секции
        const bookingButtons = document.querySelectorAll('a[href*="booking"], .kuliga-button--primary');
        bookingButtons.forEach(button => {
            button.addEventListener('click', () => {
                trackBookingButtonClick();
            });
        });

        // Обработчик фильтра по локации
        const locationFilter = document.getElementById('kuligaLocationFilter');
        if (locationFilter) {
            locationFilter.addEventListener('change', (e) => {
                const selectedLocation = e.target.value || null;
                renderProgramsAndSchedule(selectedLocation);
                
                // Отслеживание фильтрации по локации
                trackYandexMetrika('location_filter_change', { location: selectedLocation || 'all' });
                trackGoogleAnalytics('location_filter', {
                    filter_value: selectedLocation || 'all'
                });
            });
        }
    });
})();
