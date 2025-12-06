// === ПЕРЕМЕЩЕНИЕ БРОНИРОВАНИЯ KULIGA НА ДРУГУЮ ТРЕНИРОВКУ ===

// Функция для перемещения бронирования Kuliga на другую тренировку
async function moveKuligaBookingToAnotherTraining(sourceTrainingId, bookingId, clientName, sportType, currentLevel) {
    try {
        showLoading('Загрузка доступных тренировок...');

        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        // Получаем список доступных групповых тренировок Kuliga на 2 недели
        const response = await fetch(
            `/api/kuliga/admin/available-trainings-for-transfer?exclude_training_id=${sourceTrainingId}&sport_type=${encodeURIComponent(sportType)}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error('Не удалось загрузить список тренировок');
        }

        const data = await response.json();
        hideLoading();

        if (!data.success || !data.trainings || data.trainings.length === 0) {
            showError('Нет доступных тренировок для переноса на ближайшие 2 недели');
            return;
        }

        // Создаем модальное окно с выбором тренировки
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.zIndex = '10001';
        
        const trainingsList = data.trainings.map(training => {
            const trainingDate = new Date(training.date);
            const formattedDate = trainingDate.toLocaleDateString('ru-RU', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            const startTime = training.start_time ? String(training.start_time).slice(0, 5) : '';
            const endTime = training.end_time ? String(training.end_time).slice(0, 5) : '';
            const sportTypeName = training.sport_type === 'ski' ? 'Лыжи' : training.sport_type === 'snowboard' ? 'Сноуборд' : training.sport_type;
            const levelName = training.level || '—';
            const availableSpots = training.max_participants - training.current_participants;
            
            // Проверка соответствия по уровню
            const levelMatch = !currentLevel || !training.level || currentLevel === training.level;
            const hasEnoughSpace = availableSpots > 0;
            
            const hasWarning = !levelMatch || !hasEnoughSpace;
            const warningMessages = [];
            
            if (!levelMatch) {
                warningMessages.push(`Уровень текущей тренировки (${currentLevel}) не совпадает с уровнем группы (${levelName})`);
            }
            
            if (!hasEnoughSpace) {
                warningMessages.push(`В группе нет свободных мест`);
            }

            // Экранируем сообщения предупреждений для безопасной передачи в onclick
            const warningMessagesStr = warningMessages.map(msg => msg.replace(/'/g, "\\'")).join('|');

            return `
                <div class="training-option" data-training-id="${training.id}" style="
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    ${hasWarning ? 'border-color: #ff9800; background-color: #fff3cd;' : ''}
                    ${!hasEnoughSpace ? 'opacity: 0.6; pointer-events: none;' : ''}
                " onmouseover="${hasEnoughSpace ? `this.style.backgroundColor='${hasWarning ? '#ffe69c' : '#f0f0f0'}'` : ''}" 
                   onmouseout="${hasEnoughSpace ? `this.style.backgroundColor='${hasWarning ? '#fff3cd' : 'transparent'}'` : ''}"
                   onclick="${hasEnoughSpace ? `selectKuligaTrainingForTransfer(${training.id}, ${sourceTrainingId}, ${bookingId}, '${clientName.replace(/'/g, "\\'")}', ${hasWarning ? 'true' : 'false'}, '${warningMessagesStr}')` : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <strong>${formattedDate} ${startTime} - ${endTime}</strong>
                            <div style="margin-top: 5px; color: #666;">
                                <div>Вид спорта: ${sportTypeName}</div>
                                <div>Инструктор: ${training.instructor_name}</div>
                                <div>Уровень: ${levelName}</div>
                                <div>Участники: ${training.current_participants}/${training.max_participants} (свободно: ${availableSpots})</div>
                                <div>Цена: ${training.price_per_person ? parseFloat(training.price_per_person).toFixed(2) + ' ₽/чел' : '—'}</div>
                            </div>
                            ${hasWarning ? `
                                <div style="margin-top: 10px; padding: 10px; background-color: #fff; border-left: 3px solid #ff9800; border-radius: 4px;">
                                    <strong style="color: #ff9800;">⚠️ Предупреждение:</strong>
                                    <ul style="margin: 5px 0 0 0; padding-left: 20px;">
                                        ${warningMessages.map(msg => `<li style="color: #856404;">${msg}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                        ${hasEnoughSpace ? `
                            <button class="btn-primary" style="margin-left: 15px; white-space: nowrap;" onclick="event.stopPropagation(); selectKuligaTrainingForTransfer(${training.id}, ${sourceTrainingId}, ${bookingId}, '${clientName.replace(/'/g, "\\'")}', ${hasWarning ? 'true' : 'false'}, '${warningMessagesStr}')">
                                Выбрать
                            </button>
                        ` : `
                            <span style="margin-left: 15px; color: #999; font-weight: 500;">Нет мест</span>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
                <h3>Переместить бронирование клиента "${clientName}"</h3>
                <p style="margin-bottom: 15px; color: #666;">
                    Выберите тренировку из списка доступных на ближайшие 2 недели:
                </p>
                <div id="trainings-list" style="max-height: 60vh; overflow-y: auto;">
                    ${trainingsList}
                </div>
                <div class="modal-actions" style="margin-top: 20px;">
                    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.style.display = 'block';

        // Закрытие по клику вне окна
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        };
    } catch (error) {
        console.error('Ошибка при загрузке доступных тренировок Kuliga:', error);
        hideLoading();
        showError('Не удалось загрузить список тренировок: ' + error.message);
    }
}

// Функция для выбора тренировки Kuliga и подтверждения переноса
async function selectKuligaTrainingForTransfer(targetTrainingId, sourceTrainingId, bookingId, clientName, hasWarning, warningMessages) {
    // Если есть предупреждение, показываем подтверждение
    if (hasWarning && warningMessages) {
        const messages = typeof warningMessages === 'string' && warningMessages 
            ? warningMessages.split('|').filter(msg => msg.trim()) 
            : (Array.isArray(warningMessages) ? warningMessages : []);
        
        if (messages.length > 0) {
            const confirmMessage = `⚠️ Внимание! Бронирование клиента "${clientName}" не полностью соответствует требованиям выбранной тренировки:\n\n` +
                messages.map(msg => `• ${msg}`).join('\n') +
                `\n\nВы всё равно хотите переместить бронирование на эту тренировку?`;
            
            if (!confirm(confirmMessage)) {
                return;
            }
        }
    } else {
        // Обычное подтверждение
        if (!confirm(`Вы уверены, что хотите переместить бронирование клиента "${clientName}" на выбранную тренировку?`)) {
            return;
        }
    }

    try {
        showLoading('Перемещение бронирования...');

        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        const response = await fetch(
            `/api/kuliga/admin/booking/${bookingId}/transfer`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    target_training_id: targetTrainingId
                })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Ошибка при перемещении бронирования');
        }

        hideLoading();
        showSuccess(`Бронирование клиента "${clientName}" успешно перемещено на новую тренировку`);
        
        // Закрываем все модальные окна
        document.querySelectorAll('.modal').forEach(modal => modal.remove());

        // Обновляем расписание
        if (typeof loadSchedule === 'function') {
            await loadSchedule();
        }
    } catch (error) {
        console.error('Ошибка при перемещении бронирования Kuliga:', error);
        hideLoading();
        showError(error.message);
    }
}

