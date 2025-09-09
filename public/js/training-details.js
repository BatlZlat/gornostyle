document.addEventListener('DOMContentLoaded', function() {
    // Получаем параметры из URL
    const urlParams = new URLSearchParams(window.location.search);
    const trainingId = urlParams.get('id');
    const trainingType = urlParams.get('type');

    if (!trainingId) {
        showError('ID тренировки не указан');
        return;
    }

    // Функция для получения токена из cookie
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }

    // Загрузка деталей тренировки
    async function loadTrainingDetails() {
        try {
            const token = getCookie('adminToken');
            const response = await fetch(`/api/trainings/${trainingId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const training = await response.json();
            console.log('Загруженные данные тренировки:', training);
            
            displayTrainingDetails(training);
        } catch (error) {
            console.error('Ошибка при загрузке деталей тренировки:', error);
            showError('Не удалось загрузить детали тренировки');
        }
    }

    // Отображение деталей тренировки
    function displayTrainingDetails(training) {
        // Основная информация
        document.getElementById('training-date').textContent = formatDate(training.session_date);
        document.getElementById('training-time').textContent = `${formatTime(training.start_time)} - ${formatTime(training.end_time)}`;
        document.getElementById('training-simulator').textContent = `Тренажер ${training.simulator_id}`;
        document.getElementById('training-group').textContent = training.group_name || 'Не указана';
        
        // Добавляем информацию о тренере
        addTrainerInfo(training);
        
        // Отображаем участников
        displayParticipants(training.participants || []);
        
        // Кнопки действий убраны для архивных тренировок
    }

    // Добавление информации о тренере
    function addTrainerInfo(training) {
        const trainerInfo = document.createElement('div');
        trainerInfo.className = 'detail-item';
        trainerInfo.innerHTML = `
            <span class="detail-label">Тренер:</span>
            <span class="detail-value">${training.trainer_name || 'Не указан'}</span>
        `;
        
        // Вставляем после информации о группе
        const groupItem = document.querySelector('#training-group').parentElement;
        groupItem.parentElement.insertBefore(trainerInfo, groupItem.nextSibling);
    }

    // Отображение участников
    function displayParticipants(participants) {
        const participantsList = document.getElementById('participants-list');
        
        if (participants.length === 0) {
            participantsList.innerHTML = '<p class="no-participants">Нет участников</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'participants-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>ФИО</th>
                    <th>Возраст</th>
                    <th>Уровень</th>
                    <th>Телефон</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${participants.map(participant => `
                    <tr data-participant-id="${participant.id || ''}">
                        <td>${participant.full_name || 'Не указано'}</td>
                        <td>${calculateAge(participant.birth_date)}</td>
                        <td>${participant.skill_level || 'Не указан'}</td>
                        <td>${participant.phone || 'Не указан'}</td>
                        <td>
                            <button class="btn-danger btn-small" onclick="confirmRemoveParticipant('${participant.id}', '${participant.full_name}')">
                                Удалить
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        
        participantsList.innerHTML = '';
        participantsList.appendChild(table);
    }



    // Подтверждение удаления участника
    window.confirmRemoveParticipant = function(participantId, participantName) {
        if (confirm(`Вы уверены, что хотите удалить участника "${participantName}" из тренировки?\n\nЭто действие нельзя отменить.`)) {
            removeParticipantFromTraining(participantId, participantName);
        }
    };

    // Удаление участника из тренировки
    async function removeParticipantFromTraining(participantId, participantName) {
        try {
            const token = getCookie('adminToken');
            // Используем специальный endpoint для архивных тренировок (без возврата средств)
            const response = await fetch(`/api/trainings/${trainingId}/participants/${participantId}/archive`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'Ошибка при удалении участника');
            }

            showSuccess(`Участник "${participantName}" удален из архивной тренировки`);
            
            // Перезагружаем данные тренировки
            setTimeout(() => {
                loadTrainingDetails();
            }, 1000);

        } catch (error) {
            console.error('Ошибка при удалении участника:', error);
            showError(error.message || 'Не удалось удалить участника');
        }
    }


    // Вспомогательные функции
    function formatDate(dateString) {
        if (!dateString) return 'Не указана';
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    function formatTime(timeString) {
        if (!timeString) return '';
        return timeString.slice(0, 5); // Убираем секунды
    }

    function calculateAge(birthDate) {
        if (!birthDate) return 'Не указан';
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        
        return age;
    }

    // Функции уведомлений
    function showError(message) {
        showNotification(message, 'error');
    }

    function showSuccess(message) {
        showNotification(message, 'success');
    }

    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close">&times;</button>
            </div>
        `;

        document.body.appendChild(notification);

        // Автоматическое удаление через 5 секунд
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 5000);

        // Обработчик кнопки закрытия
        notification.querySelector('.notification-close').addEventListener('click', () => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        });
    }


    // Инициализация
    loadTrainingDetails();
});