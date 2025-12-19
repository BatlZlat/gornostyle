'use strict';

/**
 * Модальные окна для записи на тренировки через слоты инструкторов
 * Изолированный модуль, чтобы не конфликтовать с логикой карточек прайса и программ
 */
(function() {
    'use strict';

    // API endpoints
    const API_ENDPOINTS = {
        prices: '/api/kuliga/prices',
        programs: '/api/kuliga/programs',
    };

    // Кеш для прайсов
    let pricesCache = null;

    // Загрузка прайсов
    async function loadPrices() {
        if (pricesCache) return pricesCache;
        
        try {
            const response = await fetch(API_ENDPOINTS.prices, {
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.success && data.data) {
                pricesCache = data.data;
                return pricesCache;
            }
            throw new Error('Неверный формат ответа');
        } catch (error) {
            console.error('Ошибка загрузки прайса:', error);
            return [];
        }
    }

    // Получение цены из прайса по количеству участников
    function getPriceFromPricelist(prices, participantsCount) {
        if (!prices || prices.length === 0) return null;
        
        const matchingPrice = prices.find(p => {
            const pType = String(p.type || '').toLowerCase();
            const pParticipants = parseInt(p.participants) || 0;
            const pDuration = parseInt(p.duration) || 0;
            
            return pType === 'group' && 
                   pParticipants === participantsCount &&
                   pDuration === 60;
        });
        
        if (!matchingPrice) return null;
        
        const priceFromPricelist = parseFloat(matchingPrice.price) || 0;
        
        // Для 8 участников цена в прайсе уже является ценой за человека
        // Для остальных (2-7) - это общая цена группы, которую нужно разделить
        return participantsCount === 8 
            ? priceFromPricelist 
            : priceFromPricelist / participantsCount;
    }

    // Форматирование валюты
    function formatCurrency(amount) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }

    // Форматирование времени
    function formatTime(timeString) {
        if (!timeString) return '';
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
    }

    /**
     * Тип 1: Модальное окно для записи на программу
     */
    function showProgramBookingModal(slotData, programData) {
        // Если это программа - перенаправляем на страницу бронирования
        // используя существующую логику (чтобы не дублировать код)
        const url = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
        url.searchParams.set('programId', programData.id);
        if (slotData.date) url.searchParams.set('date', slotData.date);
        if (slotData.startTime) url.searchParams.set('time', slotData.startTime);
        window.location.href = url.toString();
    }

    /**
     * Тип 2: Модальное окно для свободного слота (индивидуальная с возможностью добавления участников)
     */
    async function showFreeSlotBookingModal(slotData) {
        const prices = await loadPrices();
        const modal = document.createElement('div');
        modal.className = 'kuliga-slot-booking-modal';
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

        let participantsCount = 1;
        let pricePerPerson = 0;
        
        // Инициализируем цену для 1 участника (индивидуальная)
        const individualPrice = prices.find(p => p.type === 'individual' && parseInt(p.duration) === 60);
        if (individualPrice) {
            pricePerPerson = parseFloat(individualPrice.price) || 0;
        }

        function updatePrice() {
            if (participantsCount === 1) {
                // Индивидуальная тренировка
                const individualPriceObj = prices.find(p => p.type === 'individual' && parseInt(p.duration) === 60);
                pricePerPerson = individualPriceObj ? parseFloat(individualPriceObj.price) || 0 : 0;
            } else {
                // Групповая тренировка - цена из прайса
                const calculatedPrice = getPriceFromPricelist(prices, participantsCount);
                if (calculatedPrice !== null) {
                    pricePerPerson = calculatedPrice;
                }
            }
            
            const totalPrice = pricePerPerson * participantsCount;
            const totalPriceEl = modal.querySelector('.slot-modal-total-price');
            const pricePerPersonEl = modal.querySelector('.slot-modal-price-per-person');
            if (totalPriceEl) totalPriceEl.textContent = formatCurrency(totalPrice);
            if (pricePerPersonEl) pricePerPersonEl.textContent = formatCurrency(pricePerPerson);
        }

        const dateStr = slotData.date 
            ? new Date(slotData.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                weekday: 'long'
            })
            : '';

        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                <h2 style="margin-top: 0; margin-bottom: 24px; color: #1e293b;">Запись на тренировку</h2>
                
                <div style="margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
                    <p style="margin: 8px 0;"><strong>Дата:</strong> ${dateStr}</p>
                    <p style="margin: 8px 0;"><strong>Время:</strong> ${formatTime(slotData.startTime)}${slotData.endTime ? ` - ${formatTime(slotData.endTime)}` : ''}</p>
                    <p style="margin: 8px 0;"><strong>Место:</strong> ${slotData.location === 'kuliga' ? 'База отдыха «Кулига-Клуб»' : 'Воронинские горки'}</p>
                </div>

                <div style="margin-bottom: 24px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #334155;">
                        Количество участников (можно записаться всей семьёй, до 8 человек):
                    </label>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <button type="button" class="slot-modal-btn-minus" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1.2rem;" ${participantsCount <= 1 ? 'disabled' : ''}>−</button>
                        <input type="number" class="slot-modal-participants-count" value="${participantsCount}" min="1" max="8" style="width: 80px; padding: 8px; text-align: center; border: 1px solid #ddd; border-radius: 8px; font-size: 1.1rem;">
                        <button type="button" class="slot-modal-btn-plus" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1.2rem;" ${participantsCount >= 8 ? 'disabled' : ''}>+</button>
                    </div>
                </div>

                <div style="margin-bottom: 24px; padding: 16px; background: #e3f2fd; border-radius: 8px;">
                    <p style="margin: 4px 0;"><strong>Цена за человека:</strong> <span class="slot-modal-price-per-person">${formatCurrency(pricePerPerson)}</span></p>
                    <p style="margin: 4px 0; font-size: 1.1rem;"><strong>К оплате:</strong> <span class="slot-modal-total-price">${formatCurrency(pricePerPerson * participantsCount)}</span></p>
                </div>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" class="slot-modal-btn-cancel" style="padding: 12px 24px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; color: #666;">
                        Отмена
                    </button>
                    <button type="button" class="slot-modal-btn-submit" style="padding: 12px 24px; border: none; border-radius: 8px; background: #2196f3; color: white; cursor: pointer; font-weight: 600;">
                        Перейти к заполнению данных
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        updatePrice();

        // Обработчики
        const minusBtn = modal.querySelector('.slot-modal-btn-minus');
        const plusBtn = modal.querySelector('.slot-modal-btn-plus');
        const countInput = modal.querySelector('.slot-modal-participants-count');
        const cancelBtn = modal.querySelector('.slot-modal-btn-cancel');
        const submitBtn = modal.querySelector('.slot-modal-btn-submit');

        function updateButtons() {
            minusBtn.disabled = participantsCount <= 1;
            plusBtn.disabled = participantsCount >= 8;
        }

        minusBtn.addEventListener('click', () => {
            if (participantsCount > 1) {
                participantsCount--;
                countInput.value = participantsCount;
                updatePrice();
                updateButtons();
            }
        });

        plusBtn.addEventListener('click', () => {
            if (participantsCount < 8) {
                participantsCount++;
                countInput.value = participantsCount;
                updatePrice();
                updateButtons();
            }
        });

        countInput.addEventListener('change', () => {
            const newCount = parseInt(countInput.value) || 1;
            participantsCount = Math.max(1, Math.min(8, newCount));
            countInput.value = participantsCount;
            updatePrice();
            updateButtons();
        });

        cancelBtn.addEventListener('click', () => {
            modal.remove();
        });

        submitBtn.addEventListener('click', () => {
            // Переход на страницу бронирования с параметрами
            const url = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
            url.searchParams.set('slotId', slotData.slotId);
            url.searchParams.set('instructorId', slotData.instructorId);
            url.searchParams.set('date', slotData.date);
            url.searchParams.set('startTime', slotData.startTime);
            if (slotData.endTime) url.searchParams.set('endTime', slotData.endTime);
            url.searchParams.set('location', slotData.location);
            url.searchParams.set('bookingType', participantsCount === 1 ? 'individual' : 'group');
            url.searchParams.set('priceType', participantsCount === 1 ? 'individual' : 'group');
            url.searchParams.set('participants', participantsCount);
            window.location.href = url.toString();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * Тип 3: Модальное окно для групповой тренировки (с ограничением участников)
     */
    function showGroupTrainingBookingModal(slotData) {
        const groupTraining = slotData.groupTraining || {};
        const maxParticipants = groupTraining.maxParticipants || 0;
        const currentParticipants = groupTraining.currentParticipants || 0;
        const availableSlots = maxParticipants - currentParticipants;
        const pricePerPerson = parseFloat(groupTraining.pricePerPerson) || 0;

        const modal = document.createElement('div');
        modal.className = 'kuliga-slot-booking-modal';
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

        let participantsCount = Math.min(1, availableSlots);

        function updatePrice() {
            const totalPrice = pricePerPerson * participantsCount;
            const totalPriceEl = modal.querySelector('.slot-modal-total-price');
            if (totalPriceEl) totalPriceEl.textContent = formatCurrency(totalPrice);
        }

        const dateStr = slotData.date 
            ? new Date(slotData.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                weekday: 'long'
            })
            : '';

        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                <h2 style="margin-top: 0; margin-bottom: 24px; color: #1e293b;">Запись на групповую тренировку</h2>
                
                <div style="margin-bottom: 24px; padding: 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
                    <p style="margin: 4px 0;"><strong>Записано участников:</strong> ${currentParticipants} из ${maxParticipants}</p>
                    <p style="margin: 4px 0;"><strong>Свободных мест:</strong> ${availableSlots}</p>
                </div>

                <div style="margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
                    <p style="margin: 8px 0;"><strong>Дата:</strong> ${dateStr}</p>
                    <p style="margin: 8px 0;"><strong>Время:</strong> ${formatTime(slotData.startTime)}${slotData.endTime ? ` - ${formatTime(slotData.endTime)}` : ''}</p>
                    <p style="margin: 8px 0;"><strong>Место:</strong> ${slotData.location === 'kuliga' ? 'База отдыха «Кулига-Клуб»' : 'Воронинские горки'}</p>
                    <p style="margin: 8px 0;"><strong>Цена за человека:</strong> ${formatCurrency(pricePerPerson)}</p>
                </div>

                <div style="margin-bottom: 24px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #334155;">
                        Количество участников (можно добавить несколько человек):
                    </label>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <button type="button" class="slot-modal-btn-minus" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1.2rem;" ${participantsCount <= 1 ? 'disabled' : ''}>−</button>
                        <input type="number" class="slot-modal-participants-count" value="${participantsCount}" min="1" max="${availableSlots}" style="width: 80px; padding: 8px; text-align: center; border: 1px solid #ddd; border-radius: 8px; font-size: 1.1rem;">
                        <button type="button" class="slot-modal-btn-plus" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1.2rem;" ${participantsCount >= availableSlots ? 'disabled' : ''}>+</button>
                        <span style="color: #666; font-size: 0.9rem;">Макс. ${availableSlots} мест</span>
                    </div>
                </div>

                <div style="margin-bottom: 24px; padding: 16px; background: #e3f2fd; border-radius: 8px;">
                    <p style="margin: 4px 0; font-size: 1.1rem;"><strong>К оплате:</strong> <span class="slot-modal-total-price">${formatCurrency(pricePerPerson * participantsCount)}</span></p>
                </div>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" class="slot-modal-btn-cancel" style="padding: 12px 24px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer; color: #666;">
                        Отмена
                    </button>
                    <button type="button" class="slot-modal-btn-submit" style="padding: 12px 24px; border: none; border-radius: 8px; background: #2196f3; color: white; cursor: pointer; font-weight: 600;">
                        Перейти к заполнению данных
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        updatePrice();

        // Обработчики
        const minusBtn = modal.querySelector('.slot-modal-btn-minus');
        const plusBtn = modal.querySelector('.slot-modal-btn-plus');
        const countInput = modal.querySelector('.slot-modal-participants-count');
        const cancelBtn = modal.querySelector('.slot-modal-btn-cancel');
        const submitBtn = modal.querySelector('.slot-modal-btn-submit');

        function updateButtons() {
            minusBtn.disabled = participantsCount <= 1;
            plusBtn.disabled = participantsCount >= availableSlots;
        }

        minusBtn.addEventListener('click', () => {
            if (participantsCount > 1) {
                participantsCount--;
                countInput.value = participantsCount;
                updatePrice();
                updateButtons();
            }
        });

        plusBtn.addEventListener('click', () => {
            if (participantsCount < availableSlots) {
                participantsCount++;
                countInput.value = participantsCount;
                updatePrice();
                updateButtons();
            }
        });

        countInput.addEventListener('change', () => {
            const newCount = parseInt(countInput.value) || 1;
            participantsCount = Math.max(1, Math.min(availableSlots, newCount));
            countInput.value = participantsCount;
            updatePrice();
            updateButtons();
        });

        cancelBtn.addEventListener('click', () => {
            modal.remove();
        });

        submitBtn.addEventListener('click', () => {
            // Переход на страницу бронирования с параметрами
            const url = new URL('/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking', window.location.origin);
            url.searchParams.set('slotId', slotData.slotId || slotData.id);
            url.searchParams.set('instructorId', slotData.instructorId);
            url.searchParams.set('date', slotData.date);
            url.searchParams.set('startTime', slotData.startTime);
            if (slotData.endTime) url.searchParams.set('endTime', slotData.endTime);
            url.searchParams.set('location', slotData.location);
            url.searchParams.set('bookingType', 'group');
            url.searchParams.set('priceType', 'group');
            url.searchParams.set('participants', participantsCount);
            if (groupTraining.id) {
                url.searchParams.set('groupTrainingId', groupTraining.id);
            }
            window.location.href = url.toString();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * Главная функция - определяет тип слота и открывает соответствующее модальное окно
     */
    window.openSlotBookingModal = async function(slotDataStr) {
        try {
            // Парсим данные, если они пришли как строка (из data-атрибута)
            let slotData;
            if (typeof slotDataStr === 'string') {
                slotData = JSON.parse(decodeURIComponent(slotDataStr));
            } else {
                slotData = slotDataStr;
            }

            // Если это групповая тренировка с программой - используем логику программ
            if (slotData.programId || (slotData.groupTraining && slotData.groupTraining.programId)) {
                const programId = slotData.programId || slotData.groupTraining.programId;
                try {
                    const response = await fetch(`${API_ENDPOINTS.programs}/${programId}`, {
                        headers: { 'Accept': 'application/json' }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (data.success && data.data) {
                            showProgramBookingModal(slotData, data.data);
                            return;
                        }
                    }
                } catch (error) {
                    console.error('Ошибка загрузки программы:', error);
                }
            }

            // Если это групповая тренировка (без программы или не удалось загрузить программу)
            if (slotData.status === 'group' || slotData.slotType === 'group_training' || slotData.groupTraining) {
                showGroupTrainingBookingModal(slotData);
                return;
            }

            // Если это свободный слот
            if (slotData.status === 'available' || slotData.slotType === 'slot') {
                await showFreeSlotBookingModal(slotData);
                return;
            }

            console.error('Неизвестный тип слота:', slotData);
        } catch (error) {
            console.error('Ошибка открытия модального окна:', error);
            alert('Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
        }
    };
})();

