// DOM элементы
const profileMenu = document.querySelector('.profile-menu');
const profileSections = document.querySelectorAll('.profile-section');
const bookingsList = document.getElementById('bookingsList');
const bookingsFilter = document.querySelector('.bookings-filter');
const profileForm = document.getElementById('profileForm');
const logoutBtn = document.getElementById('logoutBtn');
const adminMenuItem = document.getElementById('adminMenuItem');
const confirmationModal = document.getElementById('confirmationModal');
const confirmBtn = document.getElementById('confirmBtn');
const cancelBtn = document.getElementById('cancelBtn');
const closeModalBtn = confirmationModal.querySelector('.close');

// Состояние
let currentFilter = 'upcoming';
let currentBookings = [];

// Инициализация страницы
async function initializeProfile() {
    if (!currentUser) {
        window.location.href = '/';
        return;
    }

    // Обновляем информацию пользователя
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role;

    // Показываем пункт меню администратора, если пользователь - админ
    if (currentUser.role === 'admin') {
        adminMenuItem.style.display = 'block';
    }

    // Загружаем данные профиля
    await loadProfileData();
    await loadBookings();

    // Добавляем обработчики событий
    setupEventListeners();
}

// Загрузка данных профиля
async function loadProfileData() {
    try {
        const user = await apiRequest(`/users/${currentUser.id}`);
        document.getElementById('name').value = user.name;
        document.getElementById('email').value = user.email;
        document.getElementById('phone').value = user.phone;
    } catch (error) {
        showNotification('Ошибка при загрузке данных профиля', 'error');
    }
}

// Загрузка бронирований
async function loadBookings() {
    try {
        const bookings = await apiRequest(`/bookings/user/${currentUser.id}`);
        currentBookings = bookings;
        filterAndDisplayBookings();
    } catch (error) {
        showNotification('Ошибка при загрузке бронирований', 'error');
    }
}

// Фильтрация и отображение бронирований
function filterAndDisplayBookings() {
    const now = new Date();
    let filteredBookings;

    switch (currentFilter) {
        case 'upcoming':
            filteredBookings = currentBookings.filter(booking => {
                const bookingDate = new Date(`${booking.booking_date}T${booking.start_time}`);
                return bookingDate > now && booking.status !== 'cancelled';
            });
            break;
        case 'past':
            filteredBookings = currentBookings.filter(booking => {
                const bookingDate = new Date(`${booking.booking_date}T${booking.end_time}`);
                return bookingDate < now && booking.status !== 'cancelled';
            });
            break;
        case 'cancelled':
            filteredBookings = currentBookings.filter(booking => 
                booking.status === 'cancelled'
            );
            break;
    }

    displayBookings(filteredBookings);
}

// Отображение бронирований
function displayBookings(bookings) {
    bookingsList.innerHTML = '';

    if (bookings.length === 0) {
        bookingsList.innerHTML = '<p class="no-bookings">Записи не найдены</p>';
        return;
    }

    bookings.forEach(booking => {
        const bookingCard = document.createElement('div');
        bookingCard.className = 'booking-card';
        
        const participantName = booking.is_child ? 
            `Ребенок: ${booking.child_name}` : 
            `Клиент: ${booking.client_name}`;

        bookingCard.innerHTML = `
            <div class="booking-info">
                <h4>${booking.simulator_name}</h4>
                <p>${participantName}</p>
                <p>Дата: ${formatDate(booking.session_date)}</p>
                <p>Время: ${booking.start_time} - ${booking.end_time}</p>
                <p>Тренер: ${booking.trainer_name || 'Без тренера'}</p>
                <p>Статус: ${getStatusText(booking.participant_status)}</p>
            </div>
            <div class="booking-actions">
                ${booking.participant_status !== 'cancelled' && isUpcoming(booking) ? `
                    <button class="cancel-booking" data-booking-id="${booking.id}">
                        Отменить
                    </button>
                ` : ''}
            </div>
        `;
        bookingsList.appendChild(bookingCard);
    });
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Навигация по меню
    profileMenu.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
            e.preventDefault();
            const targetId = e.target.getAttribute('href').slice(1);
            switchSection(targetId);
        }
    });

    // Фильтры бронирований
    bookingsFilter.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            const filter = e.target.dataset.filter;
            currentFilter = filter;
            
            // Обновляем активную кнопку
            bookingsFilter.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });

            filterAndDisplayBookings();
        }
    });

    // Отмена бронирования
    bookingsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('cancel-booking')) {
            const bookingId = e.target.dataset.bookingId;
            showCancellationConfirmation(bookingId);
        }
    });

    // Обновление профиля
    profileForm.addEventListener('submit', handleProfileUpdate);

    // Выход
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
        window.location.href = '/';
    });

    // Модальное окно
    closeModalBtn.addEventListener('click', () => {
        confirmationModal.style.display = 'none';
    });

    cancelBtn.addEventListener('click', () => {
        confirmationModal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target === confirmationModal) {
            confirmationModal.style.display = 'none';
        }
    });
}

// Переключение разделов
function switchSection(sectionId) {
    profileSections.forEach(section => {
        section.classList.toggle('active', section.id === sectionId);
    });

    profileMenu.querySelectorAll('a').forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${sectionId}`);
    });
}

// Обработка обновления профиля
async function handleProfileUpdate(e) {
    e.preventDefault();

    const formData = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value
    };

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword) {
        if (!currentPassword) {
            showNotification('Введите текущий пароль', 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showNotification('Пароли не совпадают', 'error');
            return;
        }
        formData.currentPassword = currentPassword;
        formData.newPassword = newPassword;
    }

    try {
        await apiRequest(`/users/${currentUser.id}`, 'PUT', formData);
        showNotification('Профиль успешно обновлен');
        
        // Очищаем поля пароля
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    } catch (error) {
        showNotification('Ошибка при обновлении профиля', 'error');
    }
}

// Показ подтверждения отмены бронирования
function showCancellationConfirmation(bookingId) {
    const booking = currentBookings.find(b => b.id === parseInt(bookingId));
    if (!booking) return;

    document.getElementById('confirmationMessage').textContent = 
        `Вы уверены, что хотите отменить бронирование тренажера "${booking.simulator_name}" на ${formatDate(booking.booking_date)} ${booking.start_time}?`;
    
    confirmBtn.onclick = () => cancelBooking(bookingId);
    confirmationModal.style.display = 'block';
}

// Отмена бронирования
async function cancelBooking(bookingId) {
    try {
        await apiRequest(`/bookings/${bookingId}/status`, 'PATCH', { status: 'cancelled' });
        await loadBookings();
        showNotification('Бронирование успешно отменено');
        confirmationModal.style.display = 'none';
    } catch (error) {
        showNotification('Ошибка при отмене бронирования', 'error');
    }
}

// Вспомогательные функции
function formatDate(dateString) {
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return new Date(dateString).toLocaleDateString('ru-RU', options);
}

function getStatusText(status) {
    const statusMap = {
        pending: 'Ожидает подтверждения',
        confirmed: 'Подтверждено',
        cancelled: 'Отменено',
        completed: 'Завершено'
    };
    return statusMap[status] || status;
}

function isUpcoming(booking) {
    const bookingDate = new Date(`${booking.booking_date}T${booking.start_time}`);
    const now = new Date();
    return bookingDate > now;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initializeProfile); 