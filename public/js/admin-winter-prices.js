/**
 * Управление ценами для зимнего направления (естественный склон)
 */

// Получить cookie по имени
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Открыть модальное окно управления ценами
function openWinterPricesModal() {
    document.getElementById('winter-prices-modal').style.display = 'flex';
    loadWinterPrices();
}

// Закрыть модальное окно управления ценами
function closeWinterPricesModal() {
    document.getElementById('winter-prices-modal').style.display = 'none';
}

// Загрузить список зимних цен
async function loadWinterPrices() {
    try {
        // Получаем токен из cookie (для админа)
        const token = getCookie('adminToken') || localStorage.getItem('token');
        const response = await fetch('/api/winter-prices', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки цен');
        }

        const prices = await response.json();
        console.log('✅ Цены загружены:', prices.length);
        displayWinterPrices(prices);
    } catch (error) {
        console.error('Ошибка:', error);
        alert('Не удалось загрузить цены');
    }
}

// Отобразить список зимних цен
function displayWinterPrices(prices) {
    const container = document.getElementById('winter-prices-list');
    
    if (!container) {
        console.error('❌ Контейнер winter-prices-list не найден');
        return;
    }
    
    console.log('Отображение цен, количество:', prices.length);
    
    if (!prices || prices.length === 0) {
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
        group: grouped.group.length
    });

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

    // Обычная группа
    if (grouped.group.length > 0) {
        html += '<div class="price-group" style="margin-bottom:30px;"><h4>Обычная группа</h4>';
        grouped.group.sort((a, b) => a.participants - b.participants).forEach(price => {
            html += renderWinterPriceItem(price);
        });
        html += '</div>';
    }

    container.innerHTML = html;
    console.log('HTML сгенерирован, длина:', html.length);
}

// Отрисовать элемент цены
function renderWinterPriceItem(price) {
    const typeLabels = {
        individual: 'Индивидуальное',
        sport_group: 'Спортивная группа',
        group: 'Обычная группа'
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
        loadWinterPrices();
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
        
        loadWinterPrices();
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
        loadWinterPrices();
    } catch (error) {
        console.error('Ошибка:', error);
        alert(error.message);
    }
}

console.log('✅ admin-winter-prices.js загружен');

