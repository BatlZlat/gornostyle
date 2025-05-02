document.addEventListener('DOMContentLoaded', function() {
    const groupsList = document.querySelector('.groups-list');
    const createGroupBtn = document.getElementById('create-group');

    // Загрузка списка групп
    async function loadGroups() {
        try {
            const response = await fetch('/api/groups');
            const groups = await response.json();
            
            if (groupsList) {
                groupsList.innerHTML = groups.map(group => `
                    <div class="group-item">
                        <div class="group-info">
                            <h3>${group.name}</h3>
                            <p>${group.description || 'Нет описания'}</p>
                        </div>
                        <div class="group-actions">
                            <button class="btn-secondary" onclick="editGroup(${group.id})">Редактировать</button>
                            <button class="btn-secondary" onclick="deleteGroup(${group.id})">Удалить</button>
                        </div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Ошибка при загрузке групп:', error);
            showError('Не удалось загрузить список групп');
        }
    }

    // Обработчик создания новой группы
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            window.location.href = 'create-group.html';
        });
    }

    // Функция редактирования группы
    window.editGroup = function(groupId) {
        window.location.href = `edit-group.html?id=${groupId}`;
    };

    // Функция удаления группы
    window.deleteGroup = async function(groupId) {
        if (confirm('Вы уверены, что хотите удалить эту группу?')) {
            try {
                const response = await fetch(`/api/groups/${groupId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    loadGroups();
                } else {
                    throw new Error('Ошибка при удалении группы');
                }
            } catch (error) {
                console.error('Ошибка при удалении группы:', error);
                showError('Не удалось удалить группу');
            }
        }
    };

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
    }

    // Инициализация
    loadGroups();
}); 