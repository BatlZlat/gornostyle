
// ==========================================
// ФУНКЦИОНАЛ СТРАНИЦЫ АКЦИЙ
// ==========================================

// Загрузка данных акций
async function loadPromotionsPage() {
    try {
        showLoading();
        
        // Загружаем статистику
        const statsResponse = await fetch('/api/promotions/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });
        
        if (!statsResponse.ok) throw new Error('Ошибка при загрузке статистики');
        
        const stats = await statsResponse.json();
        
        // Обновляем статистику
        document.getElementById('active-bonuses-count').textContent = stats.activeCount;
        document.getElementById('total-bonuses-paid').textContent = `${stats.totalPaid.toLocaleString('ru-RU')}₽`;
        document.getElementById('referral-count').textContent = stats.referralCount;
        
        // Загружаем список акций
        const bonusesResponse = await fetch('/api/promotions', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });
        
        if (!bonusesResponse.ok) throw new Error('Ошибка при загрузке акций');
        
        const bonuses = await bonusesResponse.json();
        displayBonuses(bonuses);
        
    } catch (error) {
        console.error('Ошибка при загрузке акций:', error);
        showError('Ошибка при загрузке акций: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Отображение списка акций
function displayBonuses(bonuses) {
    const container = document.getElementById('bonuses-list');
    
    if (bonuses.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 18px; margin-bottom: 20px;">📭 Акций пока нет</p>
                <p>Создайте первую акцию, нажав кнопку "➕ Создать акцию"</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = bonuses.map(bonus => {
        const statusBadge = bonus.is_active 
            ? '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Активна</span>'
            : '<span style="background: #6b7280; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Неактивна</span>';
        
        const bonusTypeLabels = {
            'registration': 'Регистрация',
            'booking': 'Запись на тренировку',
            'referral': 'Реферальная программа',
            'group_booking': 'Групповая тренировка',
            'individual_booking': 'Индивидуальная тренировка',
            'attendance_milestone': 'Посещение N тренировок',
            'subscription_purchase': 'Покупка абонемента',
            'early_booking': 'Ранняя запись',
            'review': 'Отзыв',
            'birthday': 'День рождения',
            'morning_training': 'Утренняя тренировка',
            'evening_training': 'Вечерняя тренировка'
        };
        
        const slopeTypeLabels = {
            'both': 'Оба',
            'simulator': 'Тренажер',
            'natural_slope': 'Естественный склон'
        };
        
        const validFrom = bonus.valid_from ? new Date(bonus.valid_from).toLocaleDateString('ru-RU') : '—';
        const validUntil = bonus.valid_until ? new Date(bonus.valid_until).toLocaleDateString('ru-RU') : '—';
        
        return `
            <div class="bonus-card" style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <h4 style="margin: 0; font-size: 18px;">${bonus.name}</h4>
                            ${statusBadge}
                        </div>
                        ${bonus.description ? `<p style="color: #666; margin: 5px 0;">${bonus.description}</p>` : ''}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="editBonus(${bonus.id})" class="btn-icon" title="Редактировать">
                            ✏️
                        </button>
                        <button onclick="toggleBonusStatus(${bonus.id})" class="btn-icon" title="${bonus.is_active ? 'Деактивировать' : 'Активировать'}">
                            ${bonus.is_active ? '🔴' : '🟢'}
                        </button>
                        <button onclick="deleteBonus(${bonus.id})" class="btn-icon" title="Удалить" style="color: #dc2626;">
                            🗑️
                        </button>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; padding: 15px; background: #f9fafb; border-radius: 6px;">
                    <div>
                        <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Тип бонуса</div>
                        <div style="font-weight: 500;">${bonusTypeLabels[bonus.bonus_type] || bonus.bonus_type}</div>
                    </div>
                    <div>
                        <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Сумма</div>
                        <div style="font-weight: 500; color: #10b981; font-size: 18px;">${bonus.bonus_amount}₽</div>
                    </div>
                    <div>
                        <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Тип склона</div>
                        <div style="font-weight: 500;">${slopeTypeLabels[bonus.slope_type] || bonus.slope_type}</div>
                    </div>
                    <div>
                        <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Действует</div>
                        <div style="font-weight: 500;">${validFrom} — ${validUntil}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Открытие модального окна создания акции
function openBonusModal(bonusId = null) {
    const modal = document.getElementById('bonus-modal');
    const form = document.getElementById('bonus-form');
    const title = document.getElementById('bonus-modal-title');
    
    if (bonusId) {
        title.textContent = 'Редактировать акцию';
        loadBonusData(bonusId);
    } else {
        title.textContent = 'Создать акцию';
        form.reset();
        document.getElementById('bonus-is-active').checked = true;
    }
    
    modal.style.display = 'flex';
}

// Закрытие модального окна
function closeBonusModal() {
    document.getElementById('bonus-modal').style.display = 'none';
    document.getElementById('bonus-form').reset();
}

// Загрузка данных акции для редактирования
async function loadBonusData(bonusId) {
    try {
        const response = await fetch(`/api/promotions/${bonusId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });
        
        if (!response.ok) throw new Error('Ошибка при загрузке данных акции');
        
        const bonus = await response.json();
        
        // Заполняем форму
        document.getElementById('bonus-id').value = bonus.id;
        document.getElementById('bonus-name').value = bonus.name;
        document.getElementById('bonus-description').value = bonus.description || '';
        document.getElementById('bonus-type').value = bonus.bonus_type;
        document.getElementById('bonus-slope-type').value = bonus.slope_type;
        document.getElementById('bonus-amount').value = bonus.bonus_amount;
        document.getElementById('bonus-min-amount').value = bonus.min_amount || 0;
        document.getElementById('bonus-max-per-user').value = bonus.max_bonus_per_user || '';
        
        if (bonus.valid_from) {
            const validFrom = new Date(bonus.valid_from);
            document.getElementById('bonus-valid-from').value = validFrom.toISOString().slice(0, 16);
        }
        
        if (bonus.valid_until) {
            const validUntil = new Date(bonus.valid_until);
            document.getElementById('bonus-valid-until').value = validUntil.toISOString().slice(0, 16);
        }
        
        document.getElementById('bonus-is-active').checked = bonus.is_active;
        
    } catch (error) {
        console.error('Ошибка при загрузке акции:', error);
        showError('Ошибка при загрузке акции: ' + error.message);
    }
}

// Сохранение акции
async function saveBonus(event) {
    event.preventDefault();
    
    const bonusId = document.getElementById('bonus-id').value;
    const formData = {
        name: document.getElementById('bonus-name').value,
        description: document.getElementById('bonus-description').value,
        bonus_type: document.getElementById('bonus-type').value,
        slope_type: document.getElementById('bonus-slope-type').value,
        bonus_amount: parseFloat(document.getElementById('bonus-amount').value),
        min_amount: parseFloat(document.getElementById('bonus-min-amount').value) || 0,
        max_bonus_per_user: parseInt(document.getElementById('bonus-max-per-user').value) || null,
        valid_from: document.getElementById('bonus-valid-from').value || null,
        valid_until: document.getElementById('bonus-valid-until').value || null,
        is_active: document.getElementById('bonus-is-active').checked
    };
    
    try {
        showLoading();
        
        const url = bonusId ? `/api/promotions/${bonusId}` : '/api/promotions';
        const method = bonusId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при сохранении акции');
        }
        
        showSuccess(bonusId ? 'Акция успешно обновлена' : 'Акция успешно создана');
        closeBonusModal();
        loadPromotionsPage();
        
    } catch (error) {
        console.error('Ошибка при сохранении акции:', error);
        showError('Ошибка при сохранении акции: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Редактирование акции
function editBonus(bonusId) {
    openBonusModal(bonusId);
}

// Переключение статуса акции
async function toggleBonusStatus(bonusId) {
    try {
        showLoading();
        
        const response = await fetch(`/api/promotions/${bonusId}/toggle`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });
        
        if (!response.ok) throw new Error('Ошибка при изменении статуса');
        
        showSuccess('Статус акции изменен');
        loadPromotionsPage();
        
    } catch (error) {
        console.error('Ошибка при изменении статуса:', error);
        showError('Ошибка при изменении статуса: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Удаление акции
async function deleteBonus(bonusId) {
    if (!confirm('Вы уверены, что хотите удалить эту акцию? Это действие нельзя отменить.')) {
        return;
    }
    
    try {
        showLoading();
        
        const response = await fetch(`/api/promotions/${bonusId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка при удалении акции');
        }
        
        showSuccess('Акция успешно удалена');
        loadPromotionsPage();
        
    } catch (error) {
        console.error('Ошибка при удалении акции:', error);
        showError('Ошибка при удалении акции: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Инициализация обработчиков для страницы акций
document.addEventListener('DOMContentLoaded', () => {
    // Кнопка создания акции
    const createBonusBtn = document.getElementById('create-bonus-btn');
    if (createBonusBtn) {
        createBonusBtn.addEventListener('click', () => openBonusModal());
    }
    
    // Форма создания/редактирования акции
    const bonusForm = document.getElementById('bonus-form');
    if (bonusForm) {
        bonusForm.addEventListener('submit', saveBonus);
    }
    
    // Закрытие модального окна при клике вне его
    const bonusModal = document.getElementById('bonus-modal');
    if (bonusModal) {
        bonusModal.addEventListener('click', (e) => {
            if (e.target === bonusModal) {
                closeBonusModal();
            }
        });
    }
});

