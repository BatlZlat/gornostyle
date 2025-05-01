document.addEventListener('DOMContentLoaded', function() {
    const dismissedTrainersList = document.querySelector('.dismissed-trainers-list');

    // Загрузка списка уволенных тренеров
    async function loadDismissedTrainers() {
        try {
            const response = await fetch('/api/trainers/dismissed');
            const trainers = await response.json();
            
            if (dismissedTrainersList) {
                if (trainers.length === 0) {
                    dismissedTrainersList.innerHTML = '<p class="no-data">Нет уволенных тренеров</p>';
                } else {
                    dismissedTrainersList.innerHTML = trainers.map(trainer => `
                        <div class="trainer-item">
                            <div class="trainer-info">
                                <h3>${trainer.name}</h3>
                                <p>Вид спорта: ${trainer.sport_type}</p>
                                <p>Телефон: ${trainer.phone}</p>
                                <p>Email: ${trainer.email}</p>
                                <p>Дата увольнения: ${formatDate(trainer.dismissed_at)}</p>
                            </div>
                            <div class="trainer-actions">
                                <button class="btn-primary" onclick="rehireTrainer(${trainer.id})">Восстановить</button>
                            </div>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            console.error('Ошибка при загрузке уволенных тренеров:', error);
            showError('Не удалось загрузить список уволенных тренеров');
        }
    }

    // Функция восстановления тренера
    window.rehireTrainer = async function(trainerId) {
        if (confirm('Вы уверены, что хотите восстановить этого тренера?')) {
            try {
                const response = await fetch(`/api/trainers/${trainerId}/rehire`, {
                    method: 'POST'
                });
                
                if (response.ok) {
                    loadDismissedTrainers();
                } else {
                    throw new Error('Ошибка при восстановлении тренера');
                }
            } catch (error) {
                console.error('Ошибка при восстановлении тренера:', error);
                showError('Не удалось восстановить тренера');
            }
        }
    };

    // Форматирование даты
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU');
    }

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }

    // Инициализация
    loadDismissedTrainers();
}); 