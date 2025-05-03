// Константы для цен
const PRICES = {
    60: 2000,  // 1 час
    90: 2800,  // 1.5 часа
    120: 3500, // 2 часа
    trainer: 1500 // Стоимость тренера за час
};

// DOM элементы
const simulatorSelect = document.getElementById('simulator');
const dateInput = document.getElementById('training-date');
const timeSelect = document.getElementById('time');
const durationSelect = document.getElementById('duration');
const trainerSelect = document.getElementById('trainer');
const totalPriceSpan = document.getElementById('total-price');
const bookingForm = document.getElementById('booking-form');
const phoneInput = document.getElementById('phone');
const hasChildCheckbox = document.getElementById('has-child');
const childFields = document.querySelector('.child-fields');
const groupTrainingCheckbox = document.getElementById('group-training');
const withTrainerCheckbox = document.getElementById('with-trainer');
const trainingDateInput = document.getElementById('training-date');
const simulator1Slots = document.getElementById('simulator1-slots');
const simulator2Slots = document.getElementById('simulator2-slots');
const trainingPriceSpan = document.getElementById('training-price');
const topUpWalletButton = document.getElementById('top-up-wallet');

// Вспомогательные функции
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Инициализация формы
async function initializeForm() {
    try {
        console.log('Начало инициализации формы');
        
        // Проверяем наличие необходимых элементов
        if (!dateInput) {
            throw new Error('Элемент dateInput не найден');
        }
        if (!simulator1Slots || !simulator2Slots) {
            throw new Error('Элементы simulator1Slots или simulator2Slots не найдены');
        }
        
        await loadSimulators();
        await loadTrainers();
        setMinDate();
        await loadAvailableSlots();
        updatePrice();

        // Добавляем обработчики событий
        if (simulatorSelect) simulatorSelect.addEventListener('change', updateTimeSlots);
        if (dateInput) dateInput.addEventListener('change', loadAvailableSlots);
        if (durationSelect) durationSelect.addEventListener('change', () => {
            loadAvailableSlots();
            updatePrice();
        });
        if (trainerSelect) trainerSelect.addEventListener('change', updatePrice);
        if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit);
        
        console.log('Инициализация формы завершена успешно');
    } catch (error) {
        console.error('Ошибка при инициализации формы:', error);
        showNotification('Ошибка при инициализации формы', 'error');
    }
}

// Загрузка списка тренажеров
async function loadSimulators() {
    try {
        const simulators = await apiRequest('/simulators');
        simulatorSelect.innerHTML = '<option value="">Выберите тренажер</option>';
        simulators.forEach(simulator => {
            if (simulator.status === 'available') {
                simulatorSelect.innerHTML += `
                    <option value="${simulator.id}">${simulator.name}</option>
                `;
            }
        });
    } catch (error) {
        showNotification('Ошибка при загрузке списка тренажеров', 'error');
    }
}

// Загрузка списка тренеров
async function loadTrainers() {
    try {
        const trainers = await apiRequest('/users/role/trainer');
        trainerSelect.innerHTML = '<option value="">Без тренера</option>';
        trainers.forEach(trainer => {
            trainerSelect.innerHTML += `
                <option value="${trainer.id}">${trainer.name}</option>
            `;
        });
    } catch (error) {
        showNotification('Ошибка при загрузке списка тренеров', 'error');
    }
}

// Установка минимальной даты (сегодня + 2 часа)
function setMinDate() {
    const now = new Date();
    now.setHours(now.getHours() + 2);
    const minDate = now.toISOString().split('T')[0];
    dateInput.min = minDate;
    dateInput.value = minDate;
}

// Обновление доступных временных слотов
async function updateTimeSlots() {
    const simulatorId = simulatorSelect.value;
    const selectedDate = dateInput.value;
    const duration = parseInt(durationSelect.value);

    if (!simulatorId || !selectedDate) return;

    try {
        // Получаем расписание тренажера
        const schedule = await apiRequest(`/simulators/${simulatorId}/schedule`);
        const bookings = await apiRequest(`/bookings/simulator/${simulatorId}?date=${selectedDate}`);

        // Генерируем временные слоты
        const slots = generateTimeSlots(schedule, bookings, selectedDate, duration);

        // Обновляем select с временными слотами
        timeSelect.innerHTML = '<option value="">Выберите время</option>';
        slots.forEach(slot => {
            timeSelect.innerHTML += `
                <option value="${slot}">${slot}</option>
            `;
        });
    } catch (error) {
        showNotification('Ошибка при загрузке доступного времени', 'error');
    }
}

// Генерация доступных временных слотов
function generateTimeSlots(schedule, bookings, date, duration) {
    const slots = [];
    const selectedDay = new Date(date).getDay() || 7; // Воскресенье = 7
    const daySchedule = schedule.find(s => s.day_of_week === selectedDay);

    if (!daySchedule) return slots;

    const startTime = new Date(`${date}T${daySchedule.start_time}`);
    const endTime = new Date(`${date}T${daySchedule.end_time}`);
    const now = new Date();
    now.setHours(now.getHours() + 2); // Минимум 2 часа до начала

    // Генерируем слоты по 30 минут
    let currentSlot = new Date(startTime);
    while (currentSlot < endTime) {
        const slotEnd = new Date(currentSlot.getTime() + duration * 60000);
        
        if (slotEnd <= endTime && currentSlot > now) {
            // Проверяем, не пересекается ли слот с существующими бронированиями
            const isAvailable = !bookings.some(booking => {
                const bookingStart = new Date(`${date}T${booking.start_time}`);
                const bookingEnd = new Date(`${date}T${booking.end_time}`);
                return (currentSlot < bookingEnd && slotEnd > bookingStart);
            });

            if (isAvailable) {
                slots.push(currentSlot.toTimeString().slice(0, 5));
            }
        }
        currentSlot.setMinutes(currentSlot.getMinutes() + 30);
    }

    return slots;
}

// Расчет общей стоимости
function calculateTotal() {
    const duration = parseInt(durationSelect.value);
    const hasTrainer = trainerSelect.value !== '';

    let total = PRICES[duration];
    if (hasTrainer) {
        total += PRICES.trainer * (duration / 60);
    }

    totalPriceSpan.textContent = total;
}

// Обработка отправки формы
async function handleBookingSubmit(e) {
    e.preventDefault();

    if (!currentUser) {
        showNotification('Пожалуйста, войдите в систему для бронирования', 'error');
        loginModal.style.display = 'block';
        return;
    }

    const duration = parseInt(durationSelect.value);
    const selectedSimulator = document.querySelector('input[name="simulator"]:checked');
    const simulatorId = selectedSimulator.value;
    const slotsSelect = document.getElementById(`simulator${simulatorId}-slots`);
    const selectedSlotId = slotsSelect.value;

    // Проверяем доступность следующего слота для 60-минутных занятий
    if (duration === 60) {
        try {
            const response = await fetch(`/api/schedule?date=${trainingDateInput.value}`);
            const schedule = await response.json();
            
            const currentSlotIndex = schedule.findIndex(slot => 
                slot.id === parseInt(selectedSlotId) && 
                slot.simulator_id === parseInt(simulatorId)
            );
            
            if (currentSlotIndex === -1 || currentSlotIndex === schedule.length - 1) {
                showNotification('Для 60-минутного занятия необходимо выбрать время, после которого есть свободный слот', 'error');
                return;
            }

            const nextSlot = schedule[currentSlotIndex + 1];
            if (nextSlot.is_holiday || nextSlot.is_booked || nextSlot.simulator_id !== parseInt(simulatorId)) {
                showNotification('Для 60-минутного занятия необходимо выбрать время, после которого есть свободный слот', 'error');
                return;
            }
        } catch (error) {
            console.error('Ошибка при проверке доступности следующего слота:', error);
            showNotification('Произошла ошибка при проверке доступности времени', 'error');
            return;
        }
    }

    const formData = {
        simulator_id: simulatorId,
        booking_date: trainingDateInput.value,
        start_time: slotsSelect.options[slotsSelect.selectedIndex].dataset.startTime,
        duration: duration,
        with_trainer: withTrainerCheckbox.checked,
        is_group: groupTrainingCheckbox.checked
    };

    try {
        const booking = await createBooking(formData);
        showNotification('Бронирование успешно создано!', 'success');
        setTimeout(() => {
            window.location.href = '/profile.html';
        }, 2000);
    } catch (error) {
        showNotification('Ошибка при создании бронирования', 'error');
    }
}

// Загрузка доступных слотов
async function loadAvailableSlots() {
    const date = trainingDateInput?.value;
    if (!date) {
        console.log('Дата не выбрана');
        return;
    }

    console.log('Загрузка слотов для даты:', date);

    try {
        if (groupTrainingCheckbox?.checked) {
            console.log('Загрузка групповых тренировок');
            const response = await fetch(`/api/trainings?date=${date}&type=group`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const trainings = await response.json();
            console.log('Полученные групповые тренировки:', trainings);

            // Обновляем слоты для тренажера 1
            if (simulator1Slots) {
                simulator1Slots.innerHTML = '<option value="">Выберите группу</option>';
                trainings.filter(training => training.simulator_id === 1).forEach(training => {
                    simulator1Slots.innerHTML += `
                        <option value="${training.id}" 
                                data-group-id="${training.group_id}"
                                data-max-participants="${training.max_participants}">
                            ${training.group_name} (${training.max_participants} чел.)
                        </option>
                    `;
                });
            }

            // Обновляем слоты для тренажера 2
            if (simulator2Slots) {
                simulator2Slots.innerHTML = '<option value="">Выберите группу</option>';
                trainings.filter(training => training.simulator_id === 2).forEach(training => {
                    simulator2Slots.innerHTML += `
                        <option value="${training.id}"
                                data-group-id="${training.group_id}"
                                data-max-participants="${training.max_participants}">
                            ${training.group_name} (${training.max_participants} чел.)
                        </option>
                    `;
                });
            }
        } else {
            console.log('Загрузка индивидуальных слотов');
            const response = await fetch(`/api/schedule?date=${date}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const schedule = await response.json();
            console.log('Полученное расписание:', schedule);

            if (!Array.isArray(schedule)) {
                throw new Error('Полученные данные не являются массивом');
            }

            // Обновляем слоты для тренажера 1
            if (simulator1Slots) {
                simulator1Slots.innerHTML = '<option value="">Выберите время</option>';
                const simulator1Schedule = schedule.filter(slot => slot.simulator_id === 1);
                
                simulator1Schedule.forEach(slot => {
                    const isAvailable = !slot.is_holiday && !slot.is_booked;
                    simulator1Slots.innerHTML += `
                        <option value="${slot.id}" 
                                ${!isAvailable ? 'disabled' : ''}
                                data-start-time="${slot.start_time}">
                            ${formatTime(slot.start_time)}
                        </option>
                    `;
                });
            }

            // Обновляем слоты для тренажера 2
            if (simulator2Slots) {
                simulator2Slots.innerHTML = '<option value="">Выберите время</option>';
                const simulator2Schedule = schedule.filter(slot => slot.simulator_id === 2);
                
                simulator2Schedule.forEach(slot => {
                    const isAvailable = !slot.is_holiday && !slot.is_booked;
                    simulator2Slots.innerHTML += `
                        <option value="${slot.id}" 
                                ${!isAvailable ? 'disabled' : ''}
                                data-start-time="${slot.start_time}">
                            ${formatTime(slot.start_time)}
                        </option>
                    `;
                });
            }
        }

        // Активируем select'ы только для выбранного тренажера
        const selectedSimulator = document.querySelector('input[name="simulator"]:checked');
        if (selectedSimulator) {
            const simulatorId = selectedSimulator.value;
            const selectedSlots = document.getElementById(`simulator${simulatorId}-slots`);
            if (selectedSlots) {
                selectedSlots.disabled = false;
            }
        }

        console.log('Загрузка слотов завершена успешно');
    } catch (error) {
        console.error('Ошибка при загрузке слотов:', error);
        showNotification('Не удалось загрузить доступное время', 'error');
    }
}

// Загрузка прайса
async function loadPrices() {
    try {
        const response = await fetch('/api/prices');
        const prices = await response.json();
        
        const priceTable = document.getElementById('price-table');
        if (!priceTable) {
            console.error('Элемент price-table не найден на странице');
            return;
        }

        // Фильтруем цены по категориям
        const individualWithTrainer = prices.filter(p => p.type === 'individual' && p.with_trainer);
        const individualWithoutTrainer = prices.filter(p => p.type === 'individual' && !p.with_trainer);
        const groupWithTrainer = prices.filter(p => p.type === 'group' && p.with_trainer);
        const groupWithoutTrainer = prices.filter(p => p.type === 'group' && !p.with_trainer);

        priceTable.innerHTML = `
            <div class="price-section">
                <h4>ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ С ТРЕНЕРОМ</h4>
                ${individualWithTrainer.map(p => `
                    <p>${p.duration} минут - ${p.price} ₽</p>
                `).join('')}
            </div>
            <div class="price-section">
                <h4>ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ БЕЗ ТРЕНЕРА</h4>
                ${individualWithoutTrainer.map(p => `
                    <p>${p.duration} минут - ${p.price} ₽</p>
                `).join('')}
            </div>
            <div class="price-section">
                <h4>ГРУППОВЫЕ ЗАНЯТИЯ С ТРЕНЕРОМ</h4>
                ${groupWithTrainer.map(p => `
                    <p>${p.participants} человека - ${p.price} ₽</p>
                `).join('')}
            </div>
            <div class="price-section">
                <h4>ГРУППОВЫЕ ЗАНЯТИЯ БЕЗ ТРЕНЕРА</h4>
                ${groupWithoutTrainer.map(p => `
                    <p>${p.participants} человека - ${p.price} ₽</p>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Ошибка при загрузке прайса:', error);
        showNotification('Не удалось загрузить прайс', 'error');
    }
}

// Обновление стоимости
async function updatePrice() {
    try {
        const response = await fetch('/api/prices');
        const prices = await response.json();
        
        const duration = parseInt(durationSelect.value);
        const withTrainer = withTrainerCheckbox.checked;
        const isGroup = groupTrainingCheckbox.checked;
        
        let price = 0;
        
        if (isGroup) {
            const selectedSimulator = document.querySelector('input[name="simulator"]:checked');
            if (!selectedSimulator) return;
            
            const simulatorId = selectedSimulator.value;
            const slotsSelect = document.getElementById(`simulator${simulatorId}-slots`);
            const selectedOption = slotsSelect.options[slotsSelect.selectedIndex];
            
            if (selectedOption && selectedOption.value) {
                const maxParticipants = parseInt(selectedOption.dataset.maxParticipants);
                const groupPrice = prices.find(p => 
                    p.type === 'group' && 
                    p.with_trainer === withTrainer && 
                    p.participants === maxParticipants
                );
                
                if (groupPrice) {
                    price = groupPrice.price;
                }
            }
        } else {
            const individualPrice = prices.find(p => 
                p.type === 'individual' && 
                p.with_trainer === withTrainer && 
                p.duration === duration
            );
            
            if (individualPrice) {
                price = individualPrice.price;
            }
        }
        
        const priceElement = document.getElementById('total-price');
        if (priceElement) {
            priceElement.textContent = `${price} ₽`;
        }
    } catch (error) {
        console.error('Ошибка при обновлении цены:', error);
        showNotification('Не удалось обновить стоимость', 'error');
    }
}

// Вспомогательные функции
function formatTime(time) {
    return time.substring(0, 5);
}

function showError(message) {
    alert(message);
}

function showSuccess(message) {
    alert(message);
}

// Форматирование номера телефона
phoneInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 0) {
        if (value.length <= 3) {
            value = value;
        } else if (value.length <= 6) {
            value = value.slice(0, 3) + '-' + value.slice(3);
        } else if (value.length <= 8) {
            value = value.slice(0, 3) + '-' + value.slice(3, 6) + '-' + value.slice(6);
        } else {
            value = value.slice(0, 3) + '-' + value.slice(3, 6) + '-' + value.slice(6, 8) + '-' + value.slice(8, 10);
        }
    }
    e.target.value = value;
});

// Обработка галочки "Хочу записать ребенка"
hasChildCheckbox.addEventListener('change', function() {
    childFields.style.display = this.checked ? 'block' : 'none';
    if (this.checked) {
        document.getElementById('child-name').required = true;
        document.getElementById('child-birth-date').required = true;
    } else {
        document.getElementById('child-name').required = false;
        document.getElementById('child-birth-date').required = false;
    }
    updatePrice();
});

// Обработка галочки "Тренировка в группе"
groupTrainingCheckbox.addEventListener('change', function() {
    if (this.checked) {
        durationSelect.value = '60';
        durationSelect.disabled = true;
    } else {
        durationSelect.disabled = false;
    }
    loadAvailableSlots();
    updatePrice();
});

// Обработка галочки "С тренером"
withTrainerCheckbox.addEventListener('change', function() {
    updatePrice();
});

// Обработка изменения количества участников
participantsSelect.addEventListener('change', function() {
    updatePrice();
});

// Обработка изменения длительности
durationSelect.addEventListener('change', function() {
    updatePrice();
});

// Обработка выбора тренажера
document.querySelectorAll('input[name="simulator"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const simulatorId = this.value;
        
        // Деактивируем оба select'а
        if (simulator1Slots) simulator1Slots.disabled = true;
        if (simulator2Slots) simulator2Slots.disabled = true;
        
        // Активируем выбранный select
        const selectedSlots = document.getElementById(`simulator${simulatorId}-slots`);
        if (selectedSlots) {
            selectedSlots.disabled = false;
        }
        
        // Загружаем доступные слоты
        loadAvailableSlots();
        updatePrice();
    });
});

// Обработка выбора слота
simulator1Slots.addEventListener('change', updatePrice);
simulator2Slots.addEventListener('change', updatePrice);

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('Страница загружена, начинаем инициализацию');
    initializeForm();
    loadPrices();
}); 