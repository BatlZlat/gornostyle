/**
 * Управление ценами для зимнего направления (естественный склон)
 * Версия: 2.0
 * Дата обновления: 2025-11-24
 */

console.log('✅ [WINTER PRICES] admin-winter-prices.js загружен (версия 2.0)');

// Получить cookie по имени
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Открыть модальное окно управления ценами
function openWinterPricesModal() {
    const modal = document.getElementById('winter-prices-modal');
    const container = document.getElementById('winter-prices-list');
    
    if (!modal) {
        console.error('❌ Модальное окно winter-prices-modal не найдено');
        return;
    }
    
    if (!container) {
        console.error('❌ Контейнер winter-prices-list не найден');
        return;
    }
    
    console.log('✅ Открываем модальное окно с ценами');
    modal.style.display = 'flex';
    
    // Показываем индикатор загрузки
    container.innerHTML = '<p style="text-align:center;color:#666;">Загрузка цен...</p>';
    
    loadWinterPricesForModal();
}

// Закрыть модальное окно управления ценами
function closeWinterPricesModal() {
    document.getElementById('winter-prices-modal').style.display = 'none';
}

// Загрузить список зимних цен (для модального окна управления ценами)
async function loadWinterPricesForModal() {
    console.log('🔵 [WINTER PRICES] Функция loadWinterPrices вызвана');
    
    try {
        // Получаем токен из cookie (для админа)
        const token = getCookie('adminToken') || localStorage.getItem('token');
        console.log('🔵 [WINTER PRICES] Токен получен:', token ? 'ДА' : 'НЕТ');
        
        console.log('🔵 [WINTER PRICES] Отправка запроса на /api/winter-prices');
        const response = await fetch('/api/winter-prices', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('🔵 [WINTER PRICES] Ответ получен, статус:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('🔴 [WINTER PRICES] Ошибка ответа:', response.status, errorText);
            throw new Error('Ошибка загрузки цен: ' + response.status);
        }

        const data = await response.json();
        console.log('🔵 [WINTER PRICES] Данные получены, тип:', typeof data, 'isArray:', Array.isArray(data));
        console.log('🔵 [WINTER PRICES] Содержимое данных:', data);
        
        // API возвращает массив напрямую (result.rows)
        let prices = [];
        if (Array.isArray(data)) {
            prices = data;
            console.log('✅ [WINTER PRICES] Данные - массив, записей:', prices.length);
        } else if (data && data.data && Array.isArray(data.data)) {
            prices = data.data;
            console.log('✅ [WINTER PRICES] Данные в data.data, записей:', prices.length);
        } else if (data && data.rows && Array.isArray(data.rows)) {
            prices = data.rows;
            console.log('✅ [WINTER PRICES] Данные в data.rows, записей:', prices.length);
        } else {
            console.error('❌ [WINTER PRICES] Неожиданный формат данных:', data);
            prices = [];
        }
        
        console.log('✅ [WINTER PRICES] Цены обработаны, всего:', prices.length, 'записей');
        if (prices.length > 0) {
            console.log('✅ [WINTER PRICES] Первая цена:', JSON.stringify(prices[0]));
        }
        
        console.log('🔵 [WINTER PRICES] Вызов displayWinterPrices с', prices.length, 'ценами');
        displayWinterPrices(prices);
        console.log('🔵 [WINTER PRICES] displayWinterPrices вызвана');
    } catch (error) {
        console.error('🔴 [WINTER PRICES] Ошибка в loadWinterPrices:', error);
        alert('Не удалось загрузить цены: ' + error.message);
    }
}

// Отобразить список зимних цен
function displayWinterPrices(prices) {
    console.log('🟢 [DISPLAY] Функция displayWinterPrices вызвана');
    console.log('🟢 [DISPLAY] Параметр prices:', prices);
    
    const container = document.getElementById('winter-prices-list');
    console.log('🟢 [DISPLAY] Контейнер найден:', container ? 'ДА' : 'НЕТ');
    
    if (!container) {
        console.error('❌ [DISPLAY] Контейнер winter-prices-list не найден!');
        alert('Ошибка: контейнер для отображения цен не найден');
        return;
    }
    
    console.log('🟢 [DISPLAY] Количество цен:', prices ? prices.length : 'undefined');
    console.log('🟢 [DISPLAY] Тип prices:', typeof prices, 'isArray:', Array.isArray(prices));
    
    if (!prices || !Array.isArray(prices) || prices.length === 0) {
        console.warn('⚠️ [DISPLAY] Цены не найдены или пусты');
        container.innerHTML = '<p style="text-align:center;color:#666;">Цены не найдены</p>';
        return;
    }

    // Группируем цены по типам
    const grouped = {
        individual: prices.filter(p => p.type === 'individual'),
        sport_group: prices.filter(p => p.type === 'sport_group'),
        group: prices.filter(p => p.type === 'group')
    };
    
    console.log('Группировка цен:', {
        individual: grouped.individual.length,
        sport_group: grouped.sport_group.length,
        group: grouped.group.length,
        total: prices.length
    });
    
    // Проверяем, есть ли цены с неизвестными типами
    const unknownTypes = prices.filter(p => !['individual', 'sport_group', 'group'].includes(p.type));
    if (unknownTypes.length > 0) {
        console.warn('⚠️ Найдены цены с неизвестными типами:', unknownTypes.map(p => ({ id: p.id, type: p.type })));
    }

    let html = '';

    // Индивидуальное
    if (grouped.individual.length > 0) {
        html += '<div class="price-group" style="margin-bottom:30px;"><h4>Индивидуальное</h4>';
        grouped.individual.forEach(price => {
            html += renderWinterPriceItem(price);
        });
        html += '</div>';
    }

    // Спортивная группа
    if (grouped.sport_group.length > 0) {
        html += '<div class="price-group" style="margin-bottom:30px;"><h4>Спортивная группа (до 4 чел)</h4>';
        grouped.sport_group.forEach(price => {
            html += renderWinterPriceItem(price);
        });
        html += '</div>';
    }

    // Групповая тренировка
    if (grouped.group.length > 0) {
        html += '<div class="price-group" style="margin-bottom:30px;"><h4>Групповая тренировка</h4>';
        grouped.group.sort((a, b) => a.participants - b.participants).forEach(price => {
            html += renderWinterPriceItem(price);
        });
        html += '</div>';
    }

    if (html.length === 0) {
        // Если HTML пустой, но цены есть - показываем их все без группировки
        console.warn('⚠️ HTML пустой, но цены есть. Показываем все цены без группировки');
        html = '<div class="price-group" style="margin-bottom:30px;"><h4>Все цены</h4>';
        prices.forEach(price => {
            html += renderWinterPriceItem(price);
        });
        html += '</div>';
    }
    
    console.log('🟢 [DISPLAY] HTML сгенерирован, длина:', html.length);
    console.log('🟢 [DISPLAY] Первые 200 символов HTML:', html.substring(0, 200));
    
    if (html.length === 0) {
        // Если HTML пустой, но цены есть - показываем их все без группировки
        console.warn('⚠️ [DISPLAY] HTML пустой, но цены есть. Показываем все цены без группировки');
        html = '<div class="price-group" style="margin-bottom:30px;"><h4>Все цены</h4>';
        prices.forEach((price, index) => {
            console.log(`🟢 [DISPLAY] Добавляем цену ${index + 1}:`, price);
            html += renderWinterPriceItem(price);
        });
        html += '</div>';
    }
    
    console.log('🟢 [DISPLAY] Устанавливаем HTML в контейнер, длина:', html.length);
    container.innerHTML = html;
    console.log('✅ [DISPLAY] HTML установлен в контейнер');
    
    // Дополнительная проверка после установки
    setTimeout(() => {
        const checkContainer = document.getElementById('winter-prices-list');
        if (!checkContainer) {
            console.error('❌ [DISPLAY] Контейнер не найден после установки HTML!');
        } else if (checkContainer.innerHTML.length === 0) {
            console.error('❌ [DISPLAY] Контейнер все еще пуст после установки HTML!');
        } else {
            console.log('✅ [DISPLAY] Контейнер заполнен успешно, длина содержимого:', checkContainer.innerHTML.length);
        }
    }, 100);
}

// Отрисовать элемент цены
function renderWinterPriceItem(price) {
    const typeLabels = {
        individual: 'Индивидуальное',
        sport_group: 'Спортивная группа',
        group: 'Групповая тренировка'
    };

    const participantsText = price.participants ? `(${price.participants} чел)` : '';
    const statusBadge = price.is_active 
        ? '<span style="color:#4CAF50;font-weight:bold;">✓ Активна</span>' 
        : '<span style="color:#999;">✗ Неактивна</span>';
    
    // Преобразуем цену в число
    const priceValue = parseFloat(price.price) || 0;

    return `
        <div class="price-item" style="border:1px solid #ddd;padding:15px;margin-bottom:10px;border-radius:8px;background:${price.is_active ? '#fff' : '#f5f5f5'};">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="flex:1;">
                    <div style="font-weight:bold;font-size:16px;margin-bottom:5px;">
                        ${typeLabels[price.type]} ${participantsText} - ${price.duration} мин
                    </div>
                    <div style="font-size:20px;color:#2196F3;font-weight:bold;margin:5px 0;">
                        ${priceValue.toFixed(2)} ₽
                        ${price.type === 'individual' || price.type === 'sport_group' ? '<span style="font-size:14px;color:#666;">/чел</span>' : ''}
                    </div>
                    ${price.description ? `<div style="color:#666;font-size:14px;">${price.description}</div>` : ''}
                    <div style="margin-top:5px;">${statusBadge}</div>
                </div>
                <div style="display:flex;gap:10px;">
                    <button class="btn-secondary" onclick="editWinterPrice(${price.id})">✏️ Изменить</button>
                    <button class="btn-${price.is_active ? 'warning' : 'success'}" onclick="toggleWinterPriceStatus(${price.id})">
                        ${price.is_active ? '🔒 Деактивировать' : '✅ Активировать'}
                    </button>
                    <button class="btn-danger" onclick="deleteWinterPrice(${price.id})">🗑️ Удалить</button>
                </div>
            </div>
        </div>
    `;
}

// Открыть модальное окно создания цены
function openCreateWinterPriceModal() {
    document.getElementById('winter-price-modal-title').textContent = 'Добавить цену';
    document.getElementById('winter-price-form').reset();
    document.getElementById('winter-price-id').value = '';
    document.getElementById('winter-price-active').checked = true;
    updateWinterPriceFormFields();
    document.getElementById('winter-price-edit-modal').style.display = 'flex';
}

// Открыть модальное окно редактирования цены
async function editWinterPrice(id) {
    try {
        const token = getCookie('adminToken') || localStorage.getItem('token');
        const response = await fetch(`/api/winter-prices/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки цены');
        }

        const price = await response.json();
        
        document.getElementById('winter-price-modal-title').textContent = 'Редактировать цену';
        document.getElementById('winter-price-id').value = price.id;
        document.getElementById('winter-price-type').value = price.type;
        document.getElementById('winter-price-participants').value = price.participants || '';
        document.getElementById('winter-price-duration').value = price.duration;
        document.getElementById('winter-price-price').value = price.price;
        document.getElementById('winter-price-description').value = price.description || '';
        document.getElementById('winter-price-active').checked = price.is_active;
        
        updateWinterPriceFormFields();
        document.getElementById('winter-price-edit-modal').style.display = 'flex';
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Не удалось загрузить цену');
    }
}

// Закрыть модальное окно создания/редактирования цены
function closeWinterPriceEditModal() {
    document.getElementById('winter-price-edit-modal').style.display = 'none';
}

// Обновить видимость полей формы в зависимости от типа тренировки
function updateWinterPriceFormFields() {
    const type = document.getElementById('winter-price-type').value;
    const participantsGroup = document.getElementById('participants-group');
    const participantsInput = document.getElementById('winter-price-participants');
    const priceHint = document.getElementById('price-hint');
    
    if (type === 'individual') {
        participantsGroup.style.display = 'none';
        participantsInput.removeAttribute('required');
        participantsInput.value = '';
        priceHint.textContent = 'Цена за человека';
    } else if (type === 'sport_group') {
        participantsGroup.style.display = 'block';
        participantsInput.setAttribute('required', 'required');
        participantsInput.setAttribute('max', '4');
        priceHint.textContent = 'Цена за человека (группа до 4 чел)';
    } else if (type === 'group') {
        participantsGroup.style.display = 'block';
        participantsInput.setAttribute('required', 'required');
        participantsInput.setAttribute('max', '20');
        priceHint.textContent = 'Общая цена за всю группу';
    } else {
        participantsGroup.style.display = 'none';
        participantsInput.removeAttribute('required');
    }
}

// Сохранить цену
async function saveWinterPrice(event) {
    event.preventDefault();
    
    const id = document.getElementById('winter-price-id').value;
    const type = document.getElementById('winter-price-type').value;
    const participants = document.getElementById('winter-price-participants').value;
    const duration = parseInt(document.getElementById('winter-price-duration').value);
    const price = parseFloat(document.getElementById('winter-price-price').value);
    const description = document.getElementById('winter-price-description').value;
    const is_active = document.getElementById('winter-price-active').checked;
    
    // Валидация
    if (type === 'sport_group' && participants && parseInt(participants) > 4) {
        alert('Для спортивной группы количество участников не может быть больше 4');
        return;
    }
    
    const data = {
        type,
        duration,
        price,
        description,
        is_active
    };
    
    if (type !== 'individual') {
        data.participants = parseInt(participants);
    }
    
    try {
        const token = getCookie('adminToken') || localStorage.getItem('token');
        const url = id ? `/api/winter-prices/${id}` : '/api/winter-prices';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сохранения');
        }
        
        alert(id ? 'Цена успешно обновлена' : 'Цена успешно создана');
        closeWinterPriceEditModal();
        loadWinterPricesForModal();
    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message);
    }
}

// Переключить статус активности цены
async function toggleWinterPriceStatus(id) {
    if (!confirm('Изменить статус активности этой цены?')) {
        return;
    }
    
    try {
        const token = getCookie('adminToken') || localStorage.getItem('token');
        const response = await fetch(`/api/winter-prices/${id}/toggle`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка изменения статуса');
        }
        
        loadWinterPricesForModal();
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Не удалось изменить статус');
    }
}

// Удалить цену
async function deleteWinterPrice(id) {
    if (!confirm('Вы уверены, что хотите удалить эту цену? Это действие необратимо.')) {
        return;
    }
    
    try {
        const token = getCookie('adminToken') || localStorage.getItem('token');
        const response = await fetch(`/api/winter-prices/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка удаления');
        }
        
        alert('Цена успешно удалена');
        loadWinterPricesForModal();
    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message);
    }
}

console.log('✅ [WINTER PRICES] admin-winter-prices.js полностью загружен (версия 2.0)');

