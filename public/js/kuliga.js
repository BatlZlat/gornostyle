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
                                    <span><i class="fa-solid fa-seat-airline"></i> Свободно ${item.available_slots} мест</span>
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

                const url = new URL('/instruktora-kuliga/booking', window.location.origin);
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

                const url = new URL('/instruktora-kuliga/booking', window.location.origin);
                if (priceId) url.searchParams.set('priceId', priceId);
                if (priceType) url.searchParams.set('type', priceType);
                if (priceValue) url.searchParams.set('price', priceValue);
                if (duration) url.searchParams.set('duration', duration);
                if (participants) url.searchParams.set('participants', participants);

                window.location.href = url.toString();
            });
        });
    };

    const renderInstructors = async () => {
        const container = document.getElementById('kuligaInstructors');
        if (!container) return;

        try {
            const response = await fetchJson(API_ENDPOINTS.instructors);
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

                card.innerHTML = `
                    <header class="kuliga-instructor__header">
                        <img class="kuliga-instructor__photo" src="${photoUrl}" alt="${instructor.full_name}" loading="lazy">
                        <div class="kuliga-instructor__info">
                            <h3>${instructor.full_name}</h3>
                            <span class="kuliga-instructor__sport"><i class="fa-solid fa-person-skiing"></i> ${sportLabel}</span>
                        </div>
                    </header>
                    ${instructor.description ? `<p class="kuliga-instructor__description">${instructor.description}</p>` : ''}
                    <div class="kuliga-schedule" data-instructor-id="${instructor.id}">
                        <div class="kuliga-schedule__days">
                            ${days.map((day, index) => `
                                <div class="kuliga-schedule__day ${index === 0 ? 'kuliga-schedule__day-active' : ''}" data-date="${day.iso}">
                                    <div class="kuliga-schedule__weekday">${day.weekday}</div>
                                    <div>${day.label}</div>
                                    <div class="kuliga-slot-list">
                                        ${(instructor.schedule[day.iso] || []).map((slot) => `
                                            <span class="kuliga-slot ${statusClasses[slot.status] || ''}">
                                                ${formatTime(slot.startTime)} — ${statusLabels[slot.status] || ''}
                                            </span>
                                        `).join('') || '<span class="kuliga-slot">Нет слотов</span>'}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;

                fragment.appendChild(card);
            });

            container.innerHTML = '';
            container.appendChild(fragment);
        } catch (error) {
            console.error('Не удалось загрузить инструкторов:', error);
            container.innerHTML = '<div class="kuliga-empty">Не удалось загрузить список инструкторов. Зайдите позже.</div>';
        }
    };

    const initBookingButton = () => {
        const button = document.querySelector('[data-booking-open]');
        if (!button) return;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            window.location.href = '/instruktora-kuliga/booking';
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        renderPriceList();
        renderProgramsAndSchedule();
        renderInstructors();
        initBookingButton();
    });
})();
