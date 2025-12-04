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
                const pricePerPerson = isGroup ? Math.ceil(priceValue / participants) : priceValue;
                const totalPrice = isGroup ? Math.ceil(pricePerPerson * participants) : priceValue;

                if (!isGroup) {
                    card.classList.add('kuliga-price-card--highlight');
                }

                const description = sanitizeDescription(price.description || '');
                const participantsLabel = participants === 1 ? '1 участник' : `${participants} участников`;

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

    const renderProgramsAndSchedule = async () => {
        const programContainer = document.getElementById('kuligaProgramList');
        const scheduleContainer = document.getElementById('kuligaGroupList');

        if (!programContainer && !scheduleContainer) return;

        try {
            const response = await fetchJson(API_ENDPOINTS.programs);
            if (!response.success) {
                throw new Error('API вернуло ошибку');
            }

            const programs = response.data.programs || [];
            const schedule = response.data.schedule || [];

            if (programContainer) {
                if (!programs.length) {
                    programContainer.innerHTML =
                        '<div class="kuliga-empty">Программы ещё не добавлены. Следите за обновлениями в Telegram.</div>';
                } else {
                    programContainer.innerHTML = programs
                        .map((program) => {
                            const nextSession = (program.schedule || [])[0];
                            const nextHint = nextSession
                                ? `<div class="kuliga-program-next"><i class="fa-solid fa-calendar-days"></i> Ближайшее занятие: ${nextSession.date_label} (${nextSession.weekday_short}) в ${nextSession.time}</div>`
                                : '';
                            return `
                                <article class="kuliga-group-card">
                                    <h3>${program.name}</h3>
                                    ${program.description ? `<p>${program.description}</p>` : '<p>Описание появится в ближайшее время.</p>'}
                                    <div class="kuliga-group-card__meta">
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
                                        data-program-id="${program.id}">
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
                    scheduleContainer.innerHTML =
                        '<div class="kuliga-empty">В ближайшие две недели регулярных занятий нет. Оформите подписку на уведомления в Telegram.</div>';
                } else {
                    scheduleContainer.innerHTML = schedule
                        .map(
                            (item) => `
                            <article class="kuliga-group-item">
                                <div class="kuliga-group-item__top">
                                    <span class="kuliga-group-item__date">${item.date_label} (${item.weekday_short})</span>
                                    <strong>${item.program_name}</strong>
                                </div>
                                <div class="kuliga-group-item__meta">
                                    <span><i class="fa-regular fa-clock"></i> ${item.time}</span>
                                    <span><i class="fa-solid fa-person-skiing"></i> ${sportLabels[item.sport_type] || 'Инструктор'}</span>
                                    <span><i class="fa-solid fa-seat-airline"></i> Свободно ${item.available_slots || item.max_participants - (item.current_participants || 0)} мест</span>
                                    ${item.price_per_person ? `<span><i class="fa-solid fa-coins"></i> ${Number(item.price_per_person).toLocaleString('ru-RU')} ₽</span>` : ''}
                                    ${item.instructor_name ? `<span><i class="fa-solid fa-user-tie"></i> ${item.instructor_name}</span>` : '<span><i class="fa-solid fa-user-tie"></i> Инструктор будет назначен</span>'}
                                </div>
                                <div class="kuliga-group-item__actions">
                                    <button 
                                        class="kuliga-button kuliga-button--ghost"
                                        data-program-book
                                        data-program-id="${item.program_id}"
                                        data-program-date="${item.date_iso}"
                                        data-program-time="${item.time}">
                                        Записаться
                                    </button>
                                </div>
                            </article>
                        `
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

    // Найти первый день с расписанием для инструктора
    const findFirstDayWithSchedule = (instructor, days) => {
        for (let i = 0; i < days.length; i++) {
            const daySchedule = instructor.schedule[days[i].iso] || [];
            if (daySchedule.length > 0 && daySchedule.some(slot => slot.status === 'available' || slot.status === 'group')) {
                return i;
            }
        }
        return 0; // Если нет расписания, начинаем с первого дня
    };

    const renderInstructors = async (weekOffset = 0) => {
        const container = document.getElementById('kuligaInstructors');
        if (!container) return;

        try {
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

            const fragment = document.createDocumentFragment();

            instructors.forEach((instructor) => {
                const card = document.createElement('article');
                card.className = 'kuliga-instructor-card';

                const photoUrl = instructor.photo_url || 'https://via.placeholder.com/160x160/1e293b/ffffff?text=GS72';
                const sportLabel = sportLabels[instructor.sport_type] || 'Инструктор';

                // Находим первый день с расписанием для мобильной версии
                const firstDayIndex = findFirstDayWithSchedule(instructor, days);

                card.innerHTML = `
                    <header class="kuliga-instructor__header">
                        <img class="kuliga-instructor__photo" src="${photoUrl}" alt="${instructor.full_name}" loading="lazy">
                        <div class="kuliga-instructor__info">
                            <h3>${instructor.full_name}</h3>
                            <span class="kuliga-instructor__sport"><i class="fa-solid fa-person-skiing"></i> ${sportLabel}</span>
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
                                    aria-label="Следующая неделя">
                                <i class="fa-solid fa-chevron-right"></i>
                            </button>
                        </div>
                        <div class="kuliga-schedule__wrapper">
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--mobile kuliga-schedule__nav-btn--prev-mobile" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="prev-day"
                                    aria-label="Предыдущий день">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                            <div class="kuliga-schedule__days" data-start-index="${firstDayIndex}">
                                ${days.map((day, index) => {
                                    const daySchedule = instructor.schedule[day.iso] || [];
                                    const availableSlots = daySchedule.filter(slot => slot.status === 'available').length;
                                    const groupSlots = daySchedule.filter(slot => slot.status === 'group').length;
                                    const totalSlots = daySchedule.length;
                                    const hasSlots = totalSlots > 0 && daySchedule.some(slot => slot.status === 'available' || slot.status === 'group');
                                    
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
                                                ${daySchedule.length > 0 ? daySchedule.map((slot) => {
                                                    // Делаем слот кликабельным только если он доступен или групповая тренировка
                                                    const isClickable = slot.status === 'available' || slot.status === 'group';
                                                    const clickableClass = isClickable ? 'kuliga-slot--clickable' : '';
                                                    const cursorStyle = isClickable ? 'cursor: pointer;' : '';
                                                    const dataAttrs = isClickable 
                                                        ? `data-slot-id="${slot.id}" 
                                                           data-instructor-id="${instructor.id}" 
                                                           data-date="${day.iso}" 
                                                           data-start-time="${slot.startTime}" 
                                                           data-end-time="${slot.endTime || ''}" 
                                                           data-status="${slot.status}"
                                                           data-location="${instructor.location || 'kuliga'}"` 
                                                        : '';
                                                    return `
                                                        <span class="kuliga-slot ${statusClasses[slot.status] || ''} ${clickableClass}" 
                                                              ${dataAttrs}
                                                              style="${cursorStyle}"
                                                              title="${isClickable ? 'Нажмите для записи на тренировку' : ''}">
                                                            <span class="kuliga-slot__time">${formatTime(slot.startTime)}</span>
                                                            <span class="kuliga-slot__status"> — ${statusLabels[slot.status] || ''}</span>
                                                        </span>
                                                    `;
                                                }).join('') : '<span class="kuliga-slot kuliga-slot--empty">Нет слотов</span>'}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                            <button class="kuliga-schedule__nav-btn kuliga-schedule__nav-btn--mobile kuliga-schedule__nav-btn--next-mobile" 
                                    data-instructor-id="${instructor.id}" 
                                    data-action="next-day"
                                    aria-label="Следующий день">
                                <i class="fa-solid fa-chevron-right"></i>
                            </button>
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
            if (window.innerWidth <= 767) {
                setTimeout(() => {
                    document.querySelectorAll('.kuliga-schedule').forEach((scheduleEl) => {
                        const daysContainer = scheduleEl.querySelector('.kuliga-schedule__days');
                        if (!daysContainer) return;
                        
                        const startIndex = parseInt(daysContainer.getAttribute('data-start-index') || '0', 10);
                        const days = Array.from(daysContainer.querySelectorAll('.kuliga-schedule__day'));
                        if (days[startIndex]) {
                            const targetDay = days[startIndex];
                            
                            // Используем scrollIntoView с правильными параметрами
                            targetDay.scrollIntoView({
                                behavior: 'auto',
                                block: 'nearest',
                                inline: 'start'
                            });
                            
                            // Дополнительная корректировка через requestAnimationFrame
                            requestAnimationFrame(() => {
                                // Проверяем, полностью ли виден день
                                const containerRect = daysContainer.getBoundingClientRect();
                                const dayRect = targetDay.getBoundingClientRect();
                                
                                // Если день обрезан слева, корректируем
                                if (dayRect.left < containerRect.left) {
                                    const scrollLeft = targetDay.offsetLeft;
                                    daysContainer.scrollLeft = scrollLeft;
                                }
                            });
                        }
                    });
                }, 300);
            }
        } catch (error) {
            console.error('Не удалось загрузить инструкторов:', error);
            container.innerHTML = '<div class="kuliga-empty">Не удалось загрузить список инструкторов. Зайдите позже.</div>';
        }
    };

    const initScheduleNavigation = () => {
        // Навигация по неделям (десктоп)
        document.querySelectorAll('[data-action="prev-week"], [data-action="next-week"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const action = e.currentTarget.getAttribute('data-action');
                const instructorId = e.currentTarget.getAttribute('data-instructor-id');
                const scheduleEl = document.querySelector(`[data-instructor-id="${instructorId}"]`);
                if (!scheduleEl) return;

                const currentWeekOffset = parseInt(scheduleEl.getAttribute('data-week-offset') || '0', 10);
                const newWeekOffset = action === 'prev-week' ? currentWeekOffset - 1 : currentWeekOffset + 1;

                // Перезагружаем всех инструкторов с новым weekOffset
                await renderInstructors(newWeekOffset);
            });
        });
        
        // Обновляем состояние кнопок навигации
        document.querySelectorAll('.kuliga-schedule').forEach((scheduleEl) => {
            const weekOffset = parseInt(scheduleEl.getAttribute('data-week-offset') || '0', 10);
            const instructorId = scheduleEl.getAttribute('data-instructor-id');
            
            const prevBtn = scheduleEl.querySelector(`[data-instructor-id="${instructorId}"][data-action="prev-week"]`);
            if (prevBtn) {
                prevBtn.disabled = weekOffset === 0;
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
        document.querySelectorAll('.kuliga-slot--clickable').forEach((slotElement) => {
            slotElement.addEventListener('click', (event) => {
                event.preventDefault();
                
                const slotId = slotElement.getAttribute('data-slot-id');
                const instructorId = slotElement.getAttribute('data-instructor-id');
                const date = slotElement.getAttribute('data-date');
                const startTime = slotElement.getAttribute('data-start-time');
                const endTime = slotElement.getAttribute('data-end-time');
                const status = slotElement.getAttribute('data-status');
                const location = slotElement.getAttribute('data-location');
                
                if (!slotId || !instructorId || !date || !startTime) {
                    console.error('Недостаточно данных для перехода к бронированию');
                    return;
                }
                
                // Определяем тип тренировки
                const bookingType = status === 'group' ? 'group' : 'individual';
                const priceType = status === 'group' ? 'group' : 'individual';
                
                // Сохраняем данные слота в localStorage для предзаполнения формы
                const slotData = {
                    slotId: parseInt(slotId),
                    instructorId: parseInt(instructorId),
                    date: date,
                    startTime: startTime,
                    endTime: endTime,
                    location: location || 'kuliga',
                    bookingType: bookingType,
                    priceType: priceType,
                    fromSlotClick: true
                };
                
                try {
                    localStorage.setItem('kuligaSlotPreset', JSON.stringify(slotData));
                } catch (error) {
                    console.warn('Не удалось сохранить данные слота в localStorage:', error);
                }
                
                // Переходим на страницу бронирования с параметрами
                const bookingUrl = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
                bookingUrl.searchParams.set('slotId', slotId);
                bookingUrl.searchParams.set('instructorId', instructorId);
                bookingUrl.searchParams.set('date', date);
                bookingUrl.searchParams.set('startTime', startTime);
                if (endTime) bookingUrl.searchParams.set('endTime', endTime);
                bookingUrl.searchParams.set('location', location || 'kuliga');
                bookingUrl.searchParams.set('bookingType', bookingType);
                bookingUrl.searchParams.set('priceType', priceType);
                
                window.location.href = bookingUrl.toString();
            });
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        renderPriceList();
        renderProgramsAndSchedule();
        renderInstructors();
        initBookingButton();
    });
})();
