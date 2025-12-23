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
                        Количество участников (можно записаться всей семьёй, или большой дружной компанией, до 8 человек):
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
            // Используем специальный параметр fromSlot=true, чтобы открыть страницу, а не модальное окно
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
            url.searchParams.set('fromSlot', 'true'); // Маркер, что переход со слота
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
    /**
     * Показывает модальное окно с уведомлением о требуемом уровне тренировки
     * @param {number} requiredLevel - Требуемый уровень (2, 3, 4 и т.д.)
     * @param {string} trainingType - Тип тренировки: 'children', 'adults', 'general'
     * @returns {Promise} Promise, который резолвится когда пользователь закрыл уведомление
     */
    function showSkillLevelNotification(requiredLevel, trainingType = 'general') {
        return new Promise((resolve) => {
            const config = window.KULIGA_BOOKING_CONFIG || {};
            const botUsername = config.botUsername || '';
            const adminPhone = config.adminPhone || '';
            const adminTelegramUsername = config.adminTelegramUsername || '';
            
            const botLink = botUsername ? `https://t.me/${botUsername.replace(/^@/, '')}` : '#';
            const adminTelegramLink = adminTelegramUsername ? `https://t.me/${adminTelegramUsername}` : '#';
            
            const levelNamesGenitive = {
                2: 'второго',
                3: 'третьего',
                4: 'четвертого',
                5: 'пятого',
                6: 'шестого',
                7: 'седьмого',
                8: 'восьмого',
                9: 'девятого',
                10: 'десятого'
            };
            
            const levelNamesNominative = {
                2: 'второй',
                3: 'третий',
                4: 'четвертый',
                5: 'пятый',
                6: 'шестой',
                7: 'седьмой',
                8: 'восьмой',
                9: 'девятый',
                10: 'десятый'
            };
            
            const levelNameGenitive = levelNamesGenitive[requiredLevel] || `${requiredLevel}-го`;
            const levelNameNominative = levelNamesNominative[requiredLevel] || `${requiredLevel}-й`;
            
            // Определяем текст в зависимости от типа тренировки
            const isChildrenTraining = trainingType === 'children';
            const skillsText = isChildrenTraining 
                ? 'Если у вашего ребенка есть базовые навыки катания:' 
                : 'Если у вас есть базовые навыки катания:';
            
            const modal = document.createElement('div');
            modal.className = 'kuliga-skill-level-notification';
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
                z-index: 10001;
                padding: 20px;
            `;
            
            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                    <h2 style="margin-top: 0; margin-bottom: 24px; color: #1e293b; display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 2rem;">⚠️</span>
                        <span>Тренировка ${levelNameGenitive} уровня</span>
                    </h2>
                    
                    <div style="margin-bottom: 24px; padding: 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
                        <p style="margin: 0; font-weight: 600; color: #1e293b;">
                            Для записи на данную тренировку необходим ${levelNameNominative} уровень подготовки.
                        </p>
                    </div>
                    
                    <div style="margin-bottom: 24px;">
                        <h3 style="margin-top: 0; margin-bottom: 16px; color: #334155; font-size: 1.1rem;">${skillsText}</h3>
                        <ol style="margin: 0; padding-left: 24px; color: #475569; line-height: 1.8;">
                            <li>Зарегистрируйтесь в нашем Telegram-боте: <a href="${botLink}" target="_blank" rel="noopener" style="color: #2196f3; text-decoration: none; font-weight: 600;">${botUsername || 'Telegram-бот'}</a></li>
                            <li>Напишите администратору с просьбой повысить уровень:
                                ${adminTelegramUsername ? `<a href="${adminTelegramLink}" target="_blank" rel="noopener" style="color: #2196f3; text-decoration: none; font-weight: 600;">Telegram администратора</a>` : ''}
                                ${adminPhone ? ` или позвоните: <a href="tel:${adminPhone}" style="color: #2196f3; text-decoration: none; font-weight: 600;">${adminPhone}</a>` : ''}
                            </li>
                            <li>После повышения уровня вы сможете записаться на данную тренировку через сайт или телеграм бот.</li>
                        </ol>
                    </div>
                    
                    <div style="margin-bottom: 24px;">
                        <h3 style="margin-top: 0; margin-bottom: 16px; color: #334155; font-size: 1.1rem;">Если вы новичок:</h3>
                        <p style="margin: 0; color: #475569; line-height: 1.8;">
                            Рекомендуем записаться на индивидуальную или групповую тренировку начального уровня, к любому нашему инструктору в удобное для вас время. 
                            Это поможет вам освоить базовые навыки и повысить уровень подготовки.
                        </p>
                    </div>
                    
                    <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 32px;">
                        <button type="button" class="kuliga-notification-close" style="padding: 12px 24px; border: none; border-radius: 8px; background: #2196f3; color: white; cursor: pointer; font-weight: 600;">
                            Понятно, продолжить
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const closeBtn = modal.querySelector('.kuliga-notification-close');
            const closeModal = () => {
                modal.remove();
                resolve();
            };
            
            closeBtn.addEventListener('click', closeModal);
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
        });
    }

    /**
     * Определяет тип тренировки по description
     * @param {string} description - Описание тренировки
     * @returns {Object} { type: 'children'|'adults'|'general', label: string }
     */
    function determineTrainingType(description) {
        if (!description || typeof description !== 'string') {
            return { type: 'general', label: '' };
        }

        const descLower = description.trim().toLowerCase();

        // Проверяем начало описания (стандартный формат)
        if (descLower.startsWith('детская тренировка')) {
            return { type: 'children', label: '👶 Детская тренировка' };
        }
        if (descLower.startsWith('взрослая тренировка')) {
            return { type: 'adults', label: '👤 Взрослая тренировка' };
        }

        // Проверяем наличие ключевых слов
        const childrenKeywords = ['дети', 'детск', 'для детей', 'детская', 'ребёнок', 'ребенок'];
        const adultsKeywords = ['взрослые', 'взросл', 'для взрослых', 'взрослая'];

        for (const keyword of childrenKeywords) {
            if (descLower.includes(keyword)) {
                return { type: 'children', label: '👶 Детская тренировка' };
            }
        }

        for (const keyword of adultsKeywords) {
            if (descLower.includes(keyword)) {
                return { type: 'adults', label: '👤 Взрослая тренировка' };
            }
        }

        return { type: 'general', label: '' };
    }

    async function showGroupTrainingBookingModal(slotData) {
        const groupTraining = slotData.groupTraining || {};
        const maxParticipants = groupTraining.maxParticipants || 0;
        const currentParticipants = groupTraining.currentParticipants || 0;
        const availableSlots = maxParticipants - currentParticipants;
        const pricePerPerson = parseFloat(groupTraining.pricePerPerson) || 0;
        // Берем description из groupTraining, если его нет - пробуем из slotData напрямую
        const description = groupTraining.description || slotData.description || '';
        
        // Получаем уровень тренировки
        let skillLevel = null;
        if (groupTraining.level !== null && groupTraining.level !== undefined) {
            if (typeof groupTraining.level === 'number') {
                skillLevel = groupTraining.level;
            } else if (typeof groupTraining.level === 'string') {
                // Преобразуем текстовый уровень в число
                const levelMap = {
                    'beginner': 1,
                    'intermediate': 2,
                    'advanced': 3
                };
                const levelLower = groupTraining.level.toLowerCase();
                skillLevel = levelMap[levelLower] || parseInt(groupTraining.level) || null;
            }
        }
        
        // Отладочный вывод
        console.log('🔍 showGroupTrainingBookingModal:', {
            slotData,
            groupTraining,
            description,
            skillLevel,
            'groupTraining.level (raw)': groupTraining.level,
            'groupTraining.level type': typeof groupTraining.level
        });
        
        // Определяем тип тренировки
        const trainingType = determineTrainingType(description);
        
        // Если уровень >= 2, показываем уведомление перед открытием модального окна
        if (skillLevel !== null && skillLevel >= 2) {
            await showSkillLevelNotification(skillLevel, trainingType.type);
        }

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
                
                ${trainingType.label ? `
                <div style="margin-bottom: 24px; padding: 16px; background: ${trainingType.type === 'children' ? '#e3f2fd' : trainingType.type === 'adults' ? '#fff3e0' : '#f5f5f5'}; border-left: 4px solid ${trainingType.type === 'children' ? '#2196f3' : trainingType.type === 'adults' ? '#ff9800' : '#9e9e9e'}; border-radius: 8px;">
                    <p style="margin: 0; font-weight: 600; color: #1e293b; font-size: 1.1rem;">${trainingType.label}</p>
                </div>
                ` : ''}
                
                <div style="margin-bottom: 24px; padding: 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
                    <p style="margin: 4px 0;"><strong>Записано участников:</strong> ${currentParticipants} из ${maxParticipants}</p>
                    <p style="margin: 4px 0;"><strong>Свободных мест:</strong> ${availableSlots}</p>
                </div>

                <div style="margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
                    <p style="margin: 8px 0;"><strong>Дата:</strong> ${dateStr}</p>
                    <p style="margin: 8px 0;"><strong>Время:</strong> ${formatTime(slotData.startTime)}${slotData.endTime ? ` - ${formatTime(slotData.endTime)}` : ''}</p>
                    <p style="margin: 8px 0;"><strong>Место:</strong> ${slotData.location === 'kuliga' ? 'База отдыха «Кулига-Клуб»' : 'Воронинские горки'}</p>
                    <p style="margin: 8px 0;"><strong>Цена за человека:</strong> ${formatCurrency(pricePerPerson)}</p>
                    ${description ? `<p style="margin: 8px 0;"><strong>Описание:</strong> ${description}</p>` : ''}
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
            // Используем специальный параметр fromSlot=true, чтобы открыть страницу, а не модальное окно
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
            url.searchParams.set('fromSlot', 'true'); // Маркер, что переход со слота
            if (groupTraining.id) {
                url.searchParams.set('groupTrainingId', groupTraining.id);
                // Передаем данные групповой тренировки для использования на странице бронирования
                url.searchParams.set('gtPricePerPerson', groupTraining.pricePerPerson);
                url.searchParams.set('gtMaxParticipants', groupTraining.maxParticipants);
                url.searchParams.set('gtCurrentParticipants', groupTraining.currentParticipants);
                if (groupTraining.level !== null && groupTraining.level !== undefined) {
                    url.searchParams.set('gtLevel', groupTraining.level);
                }
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
                await showGroupTrainingBookingModal(slotData);
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

