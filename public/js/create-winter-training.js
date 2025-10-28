/**
 * Создание зимних тренировок на естественном склоне
 */

let trainers = [];
let groups = [];
let prices = [];

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadTrainers(),
        loadGroups(),
        loadPrices(),
        setupDateInput(),
        setupFormHandlers()
    ]);
});

// Установить дату по умолчанию
function setupDateInput() {
    const dateInput = document.getElementById('date');
    if (dateInput && !dateInput.value) {
        dateInput.valueAsDate = new Date();
    }
}

// Загрузить список тренеров
async function loadTrainers() {
    try {
        const response = await fetch('/api/trainers');
        if (!response.ok) throw new Error('Ошибка загрузки тренеров');
        const data = await response.json();
        
        trainers = data.trainers || [];
        const trainerSelect = document.getElementById('trainer');
        
        trainers.forEach(trainer => {
            const option = document.createElement('option');
            option.value = trainer.id;
            option.textContent = trainer.full_name;
            trainerSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Ошибка загрузки тренеров:', error);
    }
}

// Загрузить список групп
async function loadGroups() {
    try {
        const response = await fetch('/api/groups');
        if (!response.ok) throw new Error('Ошибка загрузки групп');
        const data = await response.json();
        
        groups = data.groups || [];
        const groupSelect = document.getElementById('group');
        
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            groupSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Ошибка загрузки групп:', error);
    }
}

// Загрузить цены
async function loadPrices() {
    try {
        const response = await fetch('/api/winter-prices');
        if (!response.ok) throw new Error('Ошибка загрузки цен');
        const data = await response.json();
        
        prices = data.prices || [];
    } catch (error) {
        console.error('Ошибка загрузки цен:', error);
    }
}

// Настроить обработчики формы
function setupFormHandlers() {
    const trainingTypeSelect = document.getElementById('trainingType');
    const maxParticipantsContainer = document.getElementById('maxParticipantsContainer');
    const groupSelectionContainer = document.getElementById('groupSelectionContainer');
    const skillLevelContainer = document.getElementById('skillLevelContainer');
    const maxParticipantsSelect = document.getElementById('maxParticipants');
    
    // Обработчик изменения типа тренировки
    trainingTypeSelect.addEventListener('change', async (e) => {
        const type = e.target.value;
        
        // Показываем/скрываем поля в зависимости от типа
        if (type === 'individual') {
            maxParticipantsContainer.style.display = 'none';
            groupSelectionContainer.style.display = 'none';
            skillLevelContainer.style.display = 'none';
            maxParticipantsSelect.value = '1';
        } else if (type === 'sport_group') {
            maxParticipantsContainer.style.display = 'flex';
            groupSelectionContainer.style.display = 'none';
            skillLevelContainer.style.display = 'flex';
            maxParticipantsSelect.value = '4';
        } else if (type === 'group') {
            maxParticipantsContainer.style.display = 'flex';
            groupSelectionContainer.style.display = 'flex';
            skillLevelContainer.style.display = 'none';
            maxParticipantsSelect.value = '6';
        }
        
        await updatePrice();
    });
    
    // Обновление цены при изменении параметров
    const form = document.getElementById('createWinterTrainingForm');
    form.addEventListener('change', updatePrice);
    
    // Отправка формы
    form.addEventListener('submit', handleSubmit);
}

// Обновить отображение цены
async function updatePrice() {
    const trainingType = document.getElementById('trainingType').value;
    const maxParticipants = document.getElementById('maxParticipants').value || '1';
    const priceDisplay = document.getElementById('trainingPrice');
    
    if (!trainingType) {
        priceDisplay.textContent = '';
        return;
    }
    
    try {
        // Поиск цены для данного типа тренировки
        let price = null;
        
        if (trainingType === 'individual') {
            price = prices.find(p => p.type === 'individual');
        } else if (trainingType === 'sport_group') {
            price = prices.find(p => p.type === 'sport_group' && p.participants === parseInt(maxParticipants));
        } else if (trainingType === 'group') {
            price = prices.find(p => p.type === 'group' && p.participants === parseInt(maxParticipants));
        }
        
        if (price) {
            priceDisplay.textContent = `💰 Цена: ${price.price} руб.`;
            priceDisplay.style.color = '#2ecc71';
            priceDisplay.style.fontWeight = 'bold';
        } else {
            priceDisplay.textContent = '⚠️ Цена не найдена';
            priceDisplay.style.color = '#e74c3c';
        }
    } catch (error) {
        console.error('Ошибка расчета цены:', error);
    }
}

// Обработка отправки формы
async function handleSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    
    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Создание тренировки...';
        
        const formData = new FormData(form);
        const trainingType = formData.get('training_type');
        const timeSlot = formData.get('time_slot');
        
        // Преобразуем время в формат для backend
        const [hours, minutes] = timeSlot.split(':');
        const startTime = `${hours}:${minutes}:00`;
        
        // Рассчитываем endTime (длительность 60 минут)
        const endTimeHours = (parseInt(hours) + 1).toString().padStart(2, '0');
        const endTime = `${endTimeHours}:${minutes}:00`;
        
        const data = {
            training_type: trainingType === 'individual' ? false : true,
            group_id: formData.get('group_id') || null,
            session_date: formData.get('date'),
            start_time: startTime,
            end_time: endTime,
            duration: 60,
            trainer_id: formData.get('trainer_id') || null,
            skill_level: formData.get('skill_level') || null,
            max_participants: parseInt(formData.get('max_participants') || '1'),
            slope_type: 'natural_slope',
            winter_training_type: trainingType,
            price: 0 // Будет рассчитана на сервере
        };
        
        // Рассчитываем цену
        const maxParticipants = parseInt(formData.get('max_participants') || '1');
        let price = 0;
        
        if (trainingType === 'individual') {
            const priceObj = prices.find(p => p.type === 'individual');
            price = priceObj ? priceObj.price : 0;
        } else if (trainingType === 'sport_group') {
            const priceObj = prices.find(p => p.type === 'sport_group' && p.participants === maxParticipants);
            price = priceObj ? priceObj.price : 0;
        } else if (trainingType === 'group') {
            const priceObj = prices.find(p => p.type === 'group' && p.participants === maxParticipants);
            price = priceObj ? priceObj.price : 0;
        }
        
        data.price = price;
        
        const response = await fetch('/api/winter-trainings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при создании тренировки');
        }
        
        alert('✅ Тренировка успешно создана');
        setTimeout(() => {
            window.location.href = 'admin.html';
        }, 1000);
        
    } catch (error) {
        console.error('Ошибка создания тренировки:', error);
        alert('❌ Ошибка: ' + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
}

