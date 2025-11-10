'use strict';

(function () {
    const API_ENDPOINTS = {
        prices: '/api/kuliga/prices',
        groupTrainings: '/api/kuliga/group-trainings',
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

    const formatDateTime = (dateString, timeString) => {
        const date = new Date(`${dateString}T${timeString}`);
        const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'long',
            weekday: 'long',
        });
        const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        return {
            date: dateFormatter.format(date),
            time: timeFormatter.format(date),
        };
    };

    const renderPriceList = async () => {
        const container = document.getElementById('kuligaPriceList');
        if (!container) return;

        try {
            const response = await fetchJson(API_ENDPOINTS.prices);
            if (!response.success) {
                throw new Error('API вернуло ошибку');
            }

            const grouped = response.data.reduce((acc, price) => {
                if (!acc[price.type]) acc[price.type] = [];
                acc[price.type].push(price);
                return acc;
            }, {});

            const fragment = document.createDocumentFragment();

            Object.entries(grouped).forEach(([type, items]) => {
                items.forEach((price) => {
                    const card = document.createElement('article');
                    card.className = 'kuliga-price-card';

                    card.innerHTML = `
                        <div class="kuliga-price-card__type">
                            <i class="fa-solid ${priceTypeIcons[type] || 'fa-ticket'}"></i>
                            ${priceTypeLabels[type] || 'Тренировка'}
                        </div>
                        <div class="kuliga-price-card__value">${Number(price.price).toLocaleString('ru-RU')} ₽</div>
                        <div class="kuliga-price-card__meta">
                            <span><i class="fa-regular fa-clock"></i> ${price.duration} мин.</span>
                            ${price.participants ? `<span><i class="fa-solid fa-users-line"></i> ${price.participants} участника</span>` : ''}
                            ${price.description ? `<span><i class="fa-regular fa-note-sticky"></i> ${price.description}</span>` : ''}
                        </div>
                    `;

                    fragment.appendChild(card);
                });
            });

            container.innerHTML = '';
            container.appendChild(fragment);
        } catch (error) {
            console.error('Не удалось загрузить прайс:', error);
            container.innerHTML = '<div class="kuliga-empty">Не удалось загрузить прайс. Пожалуйста, попробуйте позже.</div>';
        }
    };

    const renderGroupTrainings = async () => {
        const container = document.getElementById('kuligaGroupList');
        if (!container) return;

        try {
            const response = await fetchJson(API_ENDPOINTS.groupTrainings);
            if (!response.success) {
                throw new Error('API вернуло ошибку');
            }

            if (!response.data.length) {
                container.innerHTML = '<div class="kuliga-empty">Сейчас нет открытых групповых тренировок. Подпишитесь на бота, чтобы узнать о новых наборах.</div>';
                return;
            }

            const fragment = document.createDocumentFragment();

            response.data.forEach((training) => {
                const { date, time } = formatDateTime(training.date, training.start_time);
                const endTime = formatTime(training.end_time);

                const item = document.createElement('article');
                item.className = 'kuliga-group-item';
                item.innerHTML = `
                    <div class="kuliga-group-item__top">
                        <span class="kuliga-group-item__date">${date}</span>
                        <strong>${training.level}</strong>
                    </div>
                    <div class="kuliga-group-item__meta">
                        <span><i class="fa-regular fa-clock"></i> ${time} – ${endTime}</span>
                        <span><i class="fa-solid fa-person-chalkboard"></i> ${sportLabels[training.sport_type] || 'Инструктор'}</span>
                        <span><i class="fa-solid fa-users"></i> ${training.current_participants}/${training.max_participants}</span>
                        <span><i class="fa-solid fa-coins"></i> ${Number(training.price_per_person).toLocaleString('ru-RU')} ₽</span>
                    </div>
                    ${training.description ? `<p>${training.description}</p>` : ''}
                `;

                fragment.appendChild(item);
            });

            container.innerHTML = '';
            container.appendChild(fragment);
        } catch (error) {
            console.error('Не удалось загрузить групповые тренировки:', error);
            container.innerHTML = '<div class="kuliga-empty">Не удалось загрузить список групповых тренировок.</div>';
        }
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
        renderGroupTrainings();
        renderInstructors();
        initBookingButton();
    });
})();
