document.addEventListener('DOMContentLoaded', function() {
    const createTrainerForm = document.getElementById('create-trainer-form');

    if (createTrainerForm) {
        createTrainerForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = {
                full_name: document.getElementById('trainer-full-name').value,
                phone: document.getElementById('trainer-phone').value,
                birth_date: document.getElementById('trainer-birth-date').value,
                sport_type: document.getElementById('trainer-sport-type').value,
                description: document.getElementById('trainer-description').value,
                hire_date: document.getElementById('trainer-hire-date').value,
                is_active: true // По умолчанию тренер активен
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
                    showSuccess('Тренер успешно создан');
                    // Перенаправляем на страницу тренеров через 2 секунды
                    setTimeout(() => {
                        window.location.href = 'admin.html';
                    }, 2000);
                } else {
                    const error = await response.json();
                    throw new Error(error.message || 'Ошибка при создании тренера');
                }
            } catch (error) {
                console.error('Ошибка при создании тренера:', error);
                showError(error.message || 'Не удалось создать тренера');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;
        document.querySelector('.form-container').insertBefore(errorDiv, document.querySelector('.form-actions'));
        setTimeout(() => errorDiv.remove(), 3000);
    }

    // Функция отображения успешного сообщения
    function showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success';
        successDiv.textContent = message;
        document.querySelector('.form-container').insertBefore(successDiv, document.querySelector('.form-actions'));
    }
}); 