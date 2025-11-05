// ==========================================
// ФУНКЦИОНАЛ СТРАНИЦЫ ОТЛОЖЕННЫХ СООБЩЕНИЙ
// ==========================================

let currentScheduledMessages = [];

// Инициализация страницы
document.addEventListener('DOMContentLoaded', () => {
    // Обработчик переключения страницы
    const scheduledMessagesPage = document.getElementById('scheduled-messages-page');
    if (scheduledMessagesPage) {
        // Слушаем событие переключения страницы из admin.js
        document.addEventListener('pageChanged', (e) => {
            if (e.detail.page === 'scheduled-messages') {
                loadScheduledMessages();
            }
        });
    }

    // Обработчик кнопки обновления
    const refreshBtn = document.getElementById('refresh-scheduled-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadScheduledMessages();
        });
    }

    // Обработчик фильтра статуса
    const statusFilter = document.getElementById('status-filter-scheduled');
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            loadScheduledMessages();
        });
    }
});

// Загрузка отложенных сообщений
async function loadScheduledMessages() {
    try {
        showLoading('Загрузка отложенных сообщений...');
        
        const statusFilter = document.getElementById('status-filter-scheduled').value;
        
        // Загружаем все сообщения для фильтра "all"
        let messages = [];
        if (statusFilter === 'all') {
            const statuses = ['pending', 'sent', 'cancelled'];
            const promises = statuses.map(status => 
                fetch(`/api/trainings/scheduled-messages?status=${status}`)
                    .then(res => res.json())
                    .then(data => data.messages || [])
            );
            const results = await Promise.all(promises);
            messages = results.flat();
        } else {
            const response = await fetch(`/api/trainings/scheduled-messages?status=${statusFilter}`);
            if (!response.ok) {
                throw new Error('Ошибка при загрузке отложенных сообщений');
            }
            const data = await response.json();
            messages = data.messages || [];
        }
        
        // Сортируем по дате отправки (сначала ближайшие)
        messages.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        
        currentScheduledMessages = messages;
        
        displayScheduledMessages(currentScheduledMessages);
        
        return;
        
    } catch (error) {
        console.error('Ошибка при загрузке отложенных сообщений:', error);
        showError('Ошибка при загрузке отложенных сообщений: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Отображение списка отложенных сообщений
function displayScheduledMessages(messages) {
    const container = document.getElementById('scheduled-messages-list');
    
    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 18px; margin-bottom: 20px;">📭 Отложенных сообщений нет</p>
                <p>Создайте отложенное сообщение, используя кнопку "Отправить сообщение клиентам" и выбрав "Отложенная отправка"</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = messages.map(msg => {
        const statusBadge = getStatusBadge(msg.status);
        const scheduledDate = new Date(msg.scheduled_at).toLocaleString('ru-RU', {
            timeZone: 'Asia/Yekaterinburg',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const createdDate = new Date(msg.created_at).toLocaleString('ru-RU', {
            timeZone: 'Asia/Yekaterinburg',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const recipientText = msg.recipient_type === 'client' 
            ? `👤 Клиент: ${msg.recipient_name || `ID: ${msg.recipient_id}`}`
            : '👥 Все пользователи';
        
        const mediaBadge = msg.media_type 
            ? `<span style="background: #3b82f6; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">
                ${msg.media_type === 'video' ? '🎥 Видео' : '📷 Фото'}
               </span>`
            : '';
        
        const sentDate = msg.sent_at 
            ? `<div style="color: #10b981; font-size: 12px; margin-top: 5px;">
                ✅ Отправлено: ${new Date(msg.sent_at).toLocaleString('ru-RU', {
                    timeZone: 'Asia/Yekaterinburg',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}
               </div>`
            : '';
        
        return `
            <div class="scheduled-message-card" style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
                            <h4 style="margin: 0; font-size: 16px;">Сообщение #${msg.id}</h4>
                            ${statusBadge}
                            ${mediaBadge}
                        </div>
                        <div style="color: #666; font-size: 14px; margin-bottom: 8px;">
                            ${recipientText}
                        </div>
                        <div style="color: #666; font-size: 12px; margin-bottom: 5px;">
                            📅 Создано: ${createdDate}
                        </div>
                        <div style="color: ${msg.status === 'pending' ? '#f59e0b' : '#666'}; font-size: 14px; font-weight: ${msg.status === 'pending' ? 'bold' : 'normal'}; margin-bottom: 5px;">
                            ⏰ ${msg.status === 'pending' ? 'Будет отправлено' : 'Планировалось отправить'}: ${scheduledDate}
                        </div>
                        ${sentDate}
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${msg.status === 'pending' ? `
                            <button class="btn-secondary" onclick="editScheduledMessage(${msg.id})" style="padding: 6px 12px; font-size: 13px;">
                                ✏️ Редактировать
                            </button>
                            <button class="btn-danger" onclick="deleteScheduledMessage(${msg.id})" style="padding: 6px 12px; font-size: 13px;">
                                🗑️ Удалить
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <div style="background: #f9fafb; border-radius: 6px; padding: 12px; margin-top: 15px;">
                    <div style="font-size: 13px; color: #666; margin-bottom: 5px;">Текст сообщения:</div>
                    <div style="font-size: 14px; line-height: 1.5; word-wrap: break-word;">
                        ${msg.message}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Получение бейджа статуса
function getStatusBadge(status) {
    const badges = {
        'pending': '<span style="background: #f59e0b; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">⏳ Ожидает отправки</span>',
        'sent': '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">✅ Отправлено</span>',
        'cancelled': '<span style="background: #6b7280; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">❌ Отменено</span>'
    };
    return badges[status] || '<span style="background: #6b7280; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">Неизвестно</span>';
}

// Редактирование отложенного сообщения
async function editScheduledMessage(id) {
    const message = currentScheduledMessages.find(m => m.id === id);
    if (!message) {
        showError('Сообщение не найдено');
        return;
    }
    
    if (message.status !== 'pending') {
        showError('Можно редактировать только сообщения, ожидающие отправки');
        return;
    }
    
    // Открываем модальное окно редактирования (можно использовать существующее или создать новое)
    // Пока просто открываем модальное окно отправки сообщений и заполняем его данными
    const notifyBtn = document.getElementById('notify-clients-btn');
    if (notifyBtn) {
        notifyBtn.click();
        
        // Ждем, пока модальное окно откроется
        setTimeout(() => {
            const modal = document.getElementById('notify-clients-modal');
            const form = modal.querySelector('#notify-clients-form');
            
            // Заполняем форму данными сообщения
            const messageInput = form.querySelector('#notify-message');
            const recipientType = form.querySelector('#recipient-type');
            const scheduleCheckbox = form.querySelector('#schedule-message');
            const scheduleDatetime = form.querySelector('#schedule-datetime');
            const clientSelect = form.querySelector('#notify-client-select');
            
            if (messageInput) {
                // Убираем HTML теги для отображения (можно улучшить)
                messageInput.value = message.message.replace(/<[^>]*>/g, '');
            }
            
            if (recipientType) {
                recipientType.value = message.recipient_type;
                recipientType.dispatchEvent(new Event('change'));
            }
            
            if (message.recipient_type === 'client' && clientSelect) {
                setTimeout(() => {
                    clientSelect.value = message.recipient_id;
                }, 500);
            }
            
            if (scheduleCheckbox && scheduleDatetime) {
                scheduleCheckbox.checked = true;
                scheduleCheckbox.dispatchEvent(new Event('change'));
                
                // Устанавливаем дату и время
                const scheduledDate = new Date(message.scheduled_at);
                const localDate = new Date(scheduledDate.getTime() - scheduledDate.getTimezoneOffset() * 60000);
                scheduleDatetime.value = localDate.toISOString().slice(0, 16);
            }
            
            // Сохраняем ID редактируемого сообщения в форме
            form.dataset.editingMessageId = id;
            
            // Если используется поиск клиентов, устанавливаем значение
            const clientSearchInput = form.querySelector('#notify-client-search-input');
            const clientSelectHidden = form.querySelector('#notify-client-select');
            if (message.recipient_type === 'client') {
                if (clientSearchInput && message.recipient_name) {
                    clientSearchInput.value = message.recipient_name;
                }
                if (clientSelectHidden && message.recipient_id) {
                    clientSelectHidden.value = message.recipient_id;
                }
            }
            
        }, 500);
    } else {
        showError('Модальное окно отправки сообщений не найдено');
    }
}

// Обновление отложенного сообщения
async function updateScheduledMessage(id, form) {
    try {
        showLoading('Обновление отложенного сообщения...');
        
        const rawMessage = form.querySelector('#notify-message').value.trim();
        const recipientType = form.querySelector('#recipient-type').value;
        const scheduleDatetime = form.querySelector('#schedule-datetime');
        const clientSelect = form.querySelector('#notify-client-select');
        
        if (!rawMessage) {
            showError('Введите текст сообщения');
            return;
        }
        
        // Конвертируем Markdown в HTML (используем функцию из admin.js)
        const message = typeof markdownToHtml === 'function' 
            ? markdownToHtml(rawMessage)
            : rawMessage;
        
        const formData = new FormData();
        formData.append('message', message);
        formData.append('recipient_type', recipientType);
        formData.append('parse_mode', 'HTML');
        
        if (recipientType === 'client') {
            const clientId = clientSelect ? clientSelect.value : null;
            if (!clientId) {
                showError('Выберите клиента');
                hideLoading();
                return;
            }
            formData.append('recipient_id', clientId);
        }
        
        if (scheduleDatetime && scheduleDatetime.value) {
            const scheduledDateTime = new Date(scheduleDatetime.value);
            formData.append('scheduled_at', scheduledDateTime.toISOString());
        }
        
        const response = await fetch(`/api/trainings/scheduled-messages/${id}`, {
            method: 'PUT',
            body: formData
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при обновлении отложенного сообщения');
        }
        
        showSuccess('Отложенное сообщение обновлено');
        hideLoading();
        
        // Удаляем флаг редактирования
        delete form.dataset.editingMessageId;
        
        // Закрываем модальное окно
        document.getElementById('notify-clients-modal').style.display = 'none';
        form.reset();
        
        // Очищаем поиск клиентов
        const clientSearchInput = form.querySelector('#notify-client-search-input');
        const clientSelectHidden = form.querySelector('#notify-client-select');
        if (clientSearchInput) clientSearchInput.value = '';
        if (clientSelectHidden) clientSelectHidden.value = '';
        
        // Скрываем контейнер отложенной отправки
        const scheduleCheckbox = form.querySelector('#schedule-message');
        const scheduleContainer = form.querySelector('#schedule-datetime-container');
        if (scheduleCheckbox) scheduleCheckbox.checked = false;
        if (scheduleContainer) scheduleContainer.style.display = 'none';
        
        // Обновляем список
        loadScheduledMessages();
        
    } catch (error) {
        console.error('Ошибка при обновлении отложенного сообщения:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// Удаление отложенного сообщения
async function deleteScheduledMessage(id) {
    if (!confirm('Вы уверены, что хотите удалить это отложенное сообщение?')) {
        return;
    }
    
    try {
        showLoading('Удаление отложенного сообщения...');
        
        const response = await fetch(`/api/trainings/scheduled-messages/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при удалении отложенного сообщения');
        }
        
        showSuccess('Отложенное сообщение удалено');
        
        // Обновляем список
        loadScheduledMessages();
        
    } catch (error) {
        console.error('Ошибка при удалении отложенного сообщения:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// Экспортируем функцию для использования в admin.js
if (typeof window !== 'undefined') {
    window.loadScheduledMessagesPage = loadScheduledMessages;
}

