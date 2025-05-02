document.addEventListener('DOMContentLoaded', function() {
    const createGroupForm = document.getElementById('create-group-form');

    if (createGroupForm) {
        createGroupForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = {
                name: document.getElementById('group-name').value,
                description: document.getElementById('group-description').value
            };

            try {
                const response = await fetch('/api/groups', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    // Перенаправляем на страницу списка групп после успешного создания
                    window.location.href = 'groups.html';
                } else {
                    throw new Error('Ошибка при создании группы');
                }
            } catch (error) {
                console.error('Ошибка при создании группы:', error);
                showError('Не удалось создать группу');
            }
        });
    }

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }
}); 