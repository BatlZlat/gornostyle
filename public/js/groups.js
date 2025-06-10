document.addEventListener('DOMContentLoaded', function() {
    loadGroups();

    // Функция загрузки списка групп
    async function loadGroups() {
        try {
            const response = await fetchWithAuth('/api/groups');
            if (!response.ok) {
                throw new Error('Ошибка при загрузке групп');
            }
            const groups = await response.json();
            displayGroups(groups);
        } catch (error) {
            console.error('Ошибка:', error);
            showError('Не удалось загрузить список групп');
        }
    }

    // Функция отображения списка групп
    function displayGroups(groups) {
        const groupsList = document.getElementById('groups-list');
        groupsList.innerHTML = '';

        if (groups.length === 0) {
            groupsList.innerHTML = '<p class="no-data">Группы пока не созданы</p>';
            return;
        }

        const groupsHTML = groups.map(group => `
            <div class="group-card" data-id="${group.id}">
                <div class="group-info">
                    <h3>${group.name}</h3>
                    <p>${group.description || 'Нет описания'}</p>
                </div>
                <div class="group-actions">
                    <button class="btn-secondary edit-group" data-id="${group.id}">Редактировать</button>
                    <button class="btn-danger delete-group" data-id="${group.id}">Удалить</button>
                </div>
            </div>
        `).join('');

        groupsList.innerHTML = groupsHTML;

        // Добавляем обработчики событий для кнопок
        document.querySelectorAll('.edit-group').forEach(button => {
            button.addEventListener('click', () => editGroup(button.dataset.id));
        });

        document.querySelectorAll('.delete-group').forEach(button => {
            button.addEventListener('click', () => deleteGroup(button.dataset.id));
        });
    }

    // Функция редактирования группы
    async function editGroup(id) {
        window.location.href = 'create-group.html?id=' + id;
    }

    // Функция удаления группы
    async function deleteGroup(id) {
        if (!confirm('Вы уверены, что хотите удалить эту группу?')) {
            return;
        }

        try {
            const response = await fetchWithAuth(`/api/groups/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Ошибка при удалении группы');
            }

            // Перезагружаем список групп
            loadGroups();
        } catch (error) {
            console.error('Ошибка:', error);
            showError('Не удалось удалить группу');
        }
    }

    // Функция отображения ошибок
    function showError(message) {
        // Здесь можно добавить код для отображения ошибок пользователю
        console.error(message);
        alert(message);
    }

    // === ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ ТОКЕНА И fetch С АВТОРИЗАЦИЕЙ ===
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }

    async function fetchWithAuth(url, options = {}) {
        const token = getCookie('adminToken');
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            const headersObj = {};
            options.headers.forEach((v, k) => { headersObj[k] = v; });
            options.headers = headersObj;
        }
        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        return fetch(url, options);
    }
}); 