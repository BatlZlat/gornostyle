document.addEventListener('DOMContentLoaded', function() {
    const createTrainerForm = document.getElementById('create-trainer-form');

    if (createTrainerForm) {
        createTrainerForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = {
                name: document.getElementById('trainer-name').value,
                phone: document.getElementById('trainer-phone').value,
                email: document.getElementById('trainer-email').value,
                sport_type: document.getElementById('trainer-sport').value,
                experience: document.getElementById('trainer-experience').value,
                description: document.getElementById('trainer-description').value
            };

            try {
                const response = await fetch('/api/trainers', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    // Перенаправляем на страницу тренеров после успешного создания
                    window.location.href = 'admin.html';
                } else {
                    throw new Error('Ошибка при создании тренера');
                }
            } catch (error) {
                console.error('Ошибка при создании тренера:', error);
                showError('Не удалось создать тренера');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }
}); 