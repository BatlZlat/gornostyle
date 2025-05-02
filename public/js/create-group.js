document.addEventListener('DOMContentLoaded', function() {
    const createGroupForm = document.getElementById('create-group-form');
    const errorContainer = document.createElement('div');
    errorContainer.className = 'alert alert-danger';
    errorContainer.style.display = 'none';
    createGroupForm.parentNode.insertBefore(errorContainer, createGroupForm);

    if (createGroupForm) {
        createGroupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            hideError();

            const nameInput = document.getElementById('group-name');
            const descriptionInput = document.getElementById('group-description');

            // Валидация формы
            if (!nameInput.value.trim()) {
                showError('Название группы обязательно');
                nameInput.focus();
                return;
            }

            const formData = {
                name: nameInput.value.trim(),
                description: descriptionInput.value.trim()
            };

            try {
                console.log('Отправка данных:', formData);
                const response = await fetch('/api/groups', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                console.log('Получен ответ:', response.status);
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error('Сервер вернул неверный формат данных');
                }

                const data = await response.json();
                console.log('Данные ответа:', data);

                if (response.ok) {
                    // Перенаправляем на страницу списка групп после успешного создания
                    window.location.href = 'groups.html';
                } else {
                    throw new Error(data.error || 'Ошибка при создании группы');
                }
            } catch (error) {
                console.error('Ошибка при создании группы:', error);
                showError(error.message || 'Не удалось создать группу');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }

    // Функция скрытия ошибок
    function hideError() {
        errorContainer.style.display = 'none';
    }
}); 