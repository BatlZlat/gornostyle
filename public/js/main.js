// Глобальные переменные
let currentUser = null;

// DOM элементы
const loginBtn = document.getElementById('loginBtn');
const loginModal = document.getElementById('loginModal');
const closeBtn = document.querySelector('.close');
const loginForm = document.getElementById('loginForm');
const profileLink = document.getElementById('profileLink');

// Функции для работы с API
async function apiRequest(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`/api${endpoint}`, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Функции для работы с пользователями
async function login(email, password) {
    try {
        const response = await apiRequest('/users/login', 'POST', { email, password });
        currentUser = response.user;
        localStorage.setItem('user', JSON.stringify(currentUser));
        updateUIForLoggedInUser();
        return response;
    } catch (error) {
        console.error('Login error:', error);
        throw error;
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem('user');
    updateUIForLoggedOutUser();
}

// Функции для работы с бронированиями
async function createBooking(bookingData) {
    try {
        return await apiRequest('/bookings', 'POST', bookingData);
    } catch (error) {
        console.error('Booking error:', error);
        throw error;
    }
}

async function checkAvailability(simulatorId, date, startTime, endTime) {
    try {
        const queryParams = new URLSearchParams({
            simulator_id: simulatorId,
            booking_date: date,
            start_time: startTime,
            end_time: endTime
        });
        return await apiRequest(`/bookings/check-availability?${queryParams}`);
    } catch (error) {
        console.error('Availability check error:', error);
        throw error;
    }
}

// Обработчики событий
loginBtn.addEventListener('click', () => {
    loginModal.style.display = 'block';
});

closeBtn.addEventListener('click', () => {
    loginModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === loginModal) {
        loginModal.style.display = 'none';
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        await login(email, password);
        loginModal.style.display = 'none';
        showNotification('Вы успешно вошли в систему');
    } catch (error) {
        showNotification('Ошибка входа. Проверьте email и пароль.', 'error');
    }
});

// Функции для обновления UI
function updateUIForLoggedInUser() {
    loginBtn.style.display = 'none';
    profileLink.style.display = 'block';
    profileLink.href = currentUser.role === 'admin' ? '/admin.html' : '/profile.html';
}

function updateUIForLoggedOutUser() {
    loginBtn.style.display = 'block';
    profileLink.style.display = 'none';
}

function showNotification(message, type = 'success') {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    // Добавляем уведомление на страницу
    document.body.appendChild(notification);

    // Удаляем уведомление через 3 секунды
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    // Проверяем, есть ли сохраненный пользователь
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateUIForLoggedInUser();
    }
}); 