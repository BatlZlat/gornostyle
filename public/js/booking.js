// Константы для цен
const PRICES = {
    60: 2000,  // 1 час
    90: 2800,  // 1.5 часа
    120: 3500, // 2 часа
    trainer: 1500 // Стоимость тренера за час
};

// DOM элементы
const simulatorSelect = document.getElementById('simulator');
const dateInput = document.getElementById('date');
const timeSelect = document.getElementById('time');
const durationSelect = document.getElementById('duration');
const trainerSelect = document.getElementById('trainer');
const totalPriceSpan = document.getElementById('totalPrice');
const bookingForm = document.getElementById('bookingForm');

// Инициализация формы
async function initializeForm() {
    await loadSimulators();
    await loadTrainers();
    setMinDate();
    updateTimeSlots();
    calculateTotal();

    // Добавляем обработчики событий
    simulatorSelect.addEventListener('change', updateTimeSlots);
    dateInput.addEventListener('change', updateTimeSlots);
    durationSelect.addEventListener('change', () => {
        updateTimeSlots();
        calculateTotal();
    });
    trainerSelect.addEventListener('change', calculateTotal);
    bookingForm.addEventListener('submit', handleBookingSubmit);
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

    const formData = {
        simulator_id: simulatorSelect.value,
        booking_date: dateInput.value,
        start_time: timeSelect.value,
        end_time: calculateEndTime(timeSelect.value, parseInt(durationSelect.value)),
        trainer_id: trainerSelect.value || null
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

// Вычисление времени окончания
function calculateEndTime(startTime, duration) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const endDate = new Date();
    endDate.setHours(hours);
    endDate.setMinutes(minutes + duration);
    return endDate.toTimeString().slice(0, 5);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initializeForm); 