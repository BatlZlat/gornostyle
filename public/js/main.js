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

// Основной JavaScript файл для главной страницы

document.addEventListener('DOMContentLoaded', function() {
    // Инициализация всех функций
    initMobileMenu();
    initFAQ();
    initSmoothScrolling();
    initFormHandlers();
    initAnimations();
    loadTeamMembers();
    // Иконки контактов уже настроены через EJS в HTML
});

// Мобильное меню
function initMobileMenu() {
    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-menu');
    
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            navToggle.classList.toggle('active');
        });
    }
}

// FAQ аккордеон
function initFAQ() {
    const faqQuestions = document.querySelectorAll('.faq-question');
    
    faqQuestions.forEach(question => {
        question.addEventListener('click', function() {
            const answer = this.nextElementSibling;
            const icon = this.querySelector('i');
            
            // Закрываем все остальные ответы
            document.querySelectorAll('.faq-answer').forEach(ans => {
                if (ans !== answer) {
                    ans.classList.remove('active');
                }
            });
            
            // Переключаем текущий ответ
            answer.classList.toggle('active');
            
            // Поворачиваем иконку
            if (answer.classList.contains('active')) {
                icon.style.transform = 'rotate(180deg)';
            } else {
                icon.style.transform = 'rotate(0deg)';
            }
        });
    });
}

// Плавная прокрутка для якорных ссылок
function initSmoothScrolling() {
    const links = document.querySelectorAll('a[href^="#"]');
    
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = targetElement.offsetTop - headerHeight;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Обработчики форм
function initFormHandlers() {
    // Форма обратного звонка
    const callbackForm = document.querySelector('.callback-form');
    if (callbackForm) {
        callbackForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleCallbackForm(this);
        });
    }
    
    // Кнопка "Записаться" в hero секции
    const bookButton = document.querySelector('.hero .btn-primary');
    if (bookButton) {
        bookButton.addEventListener('click', function() {
            scrollToSection('callback');
        });
    }
}

// Обработка формы обратного звонка
function handleCallbackForm(form) {
    const formData = new FormData(form);
    const data = {
        name: form.querySelector('input[type="text"]').value,
        email: form.querySelector('input[type="email"]').value,
        phone: form.querySelector('input[type="tel"]').value
    };
    
    // Валидация
    if (!data.name || !data.email || !data.phone) {
        showNotification('Пожалуйста, заполните все поля', 'error');
        return;
    }
    
    if (!isValidEmail(data.email)) {
        showNotification('Пожалуйста, введите корректный email', 'error');
        return;
    }
    
    if (!isValidPhone(data.phone)) {
        showNotification('Пожалуйста, введите корректный номер телефона', 'error');
        return;
    }
    
    // Имитация отправки данных
    showNotification('Спасибо! Мы свяжемся с вами в ближайшее время', 'success');
    form.reset();
}

// Валидация email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Валидация телефона
function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
}

// Прокрутка к секции
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        const headerHeight = document.querySelector('.header').offsetHeight;
        const targetPosition = section.offsetTop - headerHeight;
        
        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }
}

// Анимации при скролле
function initAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    }, observerOptions);
    
    // Наблюдаем за элементами для анимации
    const animateElements = document.querySelectorAll('.feature-card, .advantage-item, .team-member');
    animateElements.forEach(el => {
        observer.observe(el);
    });
}

// Система уведомлений
function showNotification(message, type = 'success') {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close">&times;</button>
        </div>
    `;
    
    // Добавляем стили
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#28a745' : '#dc3545'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
    `;
    
    // Добавляем на страницу
    document.body.appendChild(notification);
    
    // Анимация появления
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Обработчик закрытия
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        hideNotification(notification);
    });
    
    // Автоматическое закрытие
    setTimeout(() => {
        hideNotification(notification);
    }, 5000);
}

function hideNotification(notification) {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// Загрузка команды тренеров с каруселью
async function loadTeamMembers() {
    console.log('loadTeamMembers: Начало загрузки команды');
    const teamCarousel = document.getElementById('team-carousel');
    if (!teamCarousel) {
        console.log('loadTeamMembers: Элемент team-carousel не найден');
        return;
    }
    console.log('loadTeamMembers: Элемент team-carousel найден');
    
    try {
        console.log('loadTeamMembers: Запрос к API...');
        const response = await fetch('/api/public/trainers');
        if (!response.ok) {
            throw new Error('Ошибка загрузки команды');
        }
        
        const trainers = await response.json();
        console.log('loadTeamMembers: Получены данные тренеров:', trainers);
        
        // Маппинг видов спорта
        const sportTypeMapping = {
            'ski': 'Горные лыжи',
            'snowboard': 'Сноуборд',
            'both': 'Горные лыжи и сноуборд'
        };
        
        if (trainers.length === 0) {
            teamCarousel.innerHTML = '<div class="team-member"><p>Информация о команде скоро появится</p></div>';
            return;
        }
        
        const html = trainers.map(trainer => `
            <div class="team-member">
                <div class="member-photo">
                    ${trainer.photo_url ? 
                        `<img src="${trainer.photo_url}" alt="${trainer.full_name}">` :
                        `<i class="fas fa-user"></i>`
                    }
                </div>
                <h4>${trainer.full_name}</h4>
                <p class="member-age">${trainer.age || 'Возраст не указан'} лет</p>
                <div class="member-sport">
                    ${sportTypeMapping[trainer.sport_type] || trainer.sport_type}
                </div>
                <p class="member-description">${trainer.description || 'Профессиональный инструктор'}</p>
            </div>
        `).join('');
        
        console.log('loadTeamMembers: Сгенерированный HTML:', html);
        teamCarousel.innerHTML = html;
        console.log('loadTeamMembers: HTML установлен в карусель');
        
        // Простая проверка - показываем все элементы без карусели для отладки
        teamCarousel.style.overflow = 'visible';
        teamCarousel.style.flexWrap = 'wrap';
        teamCarousel.style.justifyContent = 'center';
        
        // Скрываем элементы управления каруселью
        const prevBtn = document.getElementById('carousel-prev');
        const nextBtn = document.getElementById('carousel-next');
        const dotsContainer = document.getElementById('carousel-dots');
        
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (dotsContainer) dotsContainer.style.display = 'none';
        
        console.log('loadTeamMembers: Тренеры загружены успешно, всего:', trainers.length);
        
        // Временно отключаем карусель для отладки
        // initTeamCarousel(trainers.length);
        
    } catch (error) {
        console.error('Ошибка при загрузке команды:', error);
        teamCarousel.innerHTML = `
            <div class="team-member">
                <div class="member-photo">
                    <i class="fas fa-user"></i>
                </div>
                <h4>Команда</h4>
                <p class="member-age">Профессиональные инструкторы</p>
                <div class="member-sport">Горные лыжи и сноуборд</div>
                <p class="member-description">Информация скоро появится</p>
            </div>
        `;
        
        teamCarousel.style.overflow = 'visible';
        teamCarousel.style.flexWrap = 'wrap';
        teamCarousel.style.justifyContent = 'center';
        
        // Скрываем элементы управления каруселью при ошибке
        const prevBtn = document.getElementById('carousel-prev');
        const nextBtn = document.getElementById('carousel-next');
        const dotsContainer = document.getElementById('carousel-dots');
        
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (dotsContainer) dotsContainer.style.display = 'none';
        
        // Временно отключаем карусель
        // initTeamCarousel(1);
    }
}

// Инициализация карусели команды
function initTeamCarousel(totalItems) {
    console.log('initTeamCarousel: Инициализация с', totalItems, 'элементами');
    const carousel = document.getElementById('team-carousel');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const dotsContainer = document.getElementById('carousel-dots');
    
    console.log('initTeamCarousel: Найденные элементы:', {
        carousel: !!carousel,
        prevBtn: !!prevBtn,
        nextBtn: !!nextBtn,
        dotsContainer: !!dotsContainer
    });
    
    if (!carousel || !prevBtn || !nextBtn || !dotsContainer) {
        console.log('initTeamCarousel: Некоторые элементы не найдены, выход');
        return;
    }
    
    let currentIndex = 0;
    const itemWidth = 350; // ширина одного элемента с отступом
    const visibleItems = Math.floor(carousel.parentElement.offsetWidth / itemWidth) || 1;
    const maxIndex = Math.max(0, totalItems - visibleItems);
    
    // Создаем точки навигации
    dotsContainer.innerHTML = '';
    const dotsCount = Math.ceil(totalItems / visibleItems);
    for (let i = 0; i < dotsCount; i++) {
        const dot = document.createElement('button');
        dot.className = `carousel-dot ${i === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => goToSlide(i * visibleItems));
        dotsContainer.appendChild(dot);
    }
    
    function updateCarousel() {
        const translateX = -currentIndex * itemWidth;
        carousel.style.transform = `translateX(${translateX}px)`;
        
        // Обновляем состояние кнопок
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex >= maxIndex;
        
        // Обновляем точки
        const activeDotIndex = Math.floor(currentIndex / visibleItems);
        document.querySelectorAll('.carousel-dot').forEach((dot, index) => {
            dot.classList.toggle('active', index === activeDotIndex);
        });
    }
    
    function goToSlide(index) {
        currentIndex = Math.max(0, Math.min(index, maxIndex));
        updateCarousel();
    }
    
    // Обработчики кнопок
    prevBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            goToSlide(currentIndex - 1);
        }
    });
    
    nextBtn.addEventListener('click', () => {
        if (currentIndex < maxIndex) {
            goToSlide(currentIndex + 1);
        }
    });
    
    // Скрываем элементы управления если все элементы видны
    if (totalItems <= visibleItems) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        dotsContainer.style.display = 'none';
    } else {
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
        dotsContainer.style.display = 'flex';
    }
    
    // Поддержка свайпов на мобильных устройствах
    let startX = 0;
    let isDragging = false;
    
    carousel.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
    });
    
    carousel.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
    });
    
    carousel.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        const endX = e.changedTouches[0].clientX;
        const diff = startX - endX;
        
        if (Math.abs(diff) > 50) { // минимальная дистанция для свайпа
            if (diff > 0 && currentIndex < maxIndex) {
                goToSlide(currentIndex + 1);
            } else if (diff < 0 && currentIndex > 0) {
                goToSlide(currentIndex - 1);
            }
        }
    });
    
    // Адаптивность при изменении размера окна
    window.addEventListener('resize', () => {
        const newVisibleItems = Math.floor(carousel.parentElement.offsetWidth / itemWidth) || 1;
        if (newVisibleItems !== visibleItems) {
            // Перезапускаем карусель с новыми параметрами
            setTimeout(() => initTeamCarousel(totalItems), 100);
        }
    });
    
    // Инициализация
    updateCarousel();
}

// Добавляем CSS для анимаций
const style = document.createElement('style');
style.textContent = `
    .feature-card,
    .advantage-item {
        opacity: 0;
        transform: translateY(30px);
        transition: opacity 0.6s ease, transform 0.6s ease;
    }
    
    .feature-card.animate-in,
    .advantage-item.animate-in {
        opacity: 1;
        transform: translateY(0);
    }
    
    /* Анимация для команды в карусели */
    .team-carousel .team-member {
        opacity: 1;
        transform: translateY(0);
    }
    
    .nav-menu.active {
        display: flex;
        flex-direction: column;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        padding: 1rem;
    }
    
    .nav-toggle.active span:nth-child(1) {
        transform: rotate(45deg) translate(5px, 5px);
    }
    
    .nav-toggle.active span:nth-child(2) {
        opacity: 0;
    }
    
    .nav-toggle.active span:nth-child(3) {
        transform: rotate(-45deg) translate(7px, -6px);
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    
    .notification-close {
        background: none;
        border: none;
        color: white;
        font-size: 1.5rem;
        cursor: pointer;
        margin-left: 1rem;
        padding: 0;
        line-height: 1;
    }
    
    .notification-close:hover {
        opacity: 0.8;
    }
`;
document.head.appendChild(style); 