// Аналитика для админ-панели
console.log('✅ admin-analytics.js загружен');

let currentPeriod = 'current_month';
let currentTab = 'attendance';
let attendanceChart = null;
let trainingTypesChart = null;
let referralsConversionChart = null;
let customPeriodFrom = null;
let customPeriodTo = null;

// Инициализация при загрузке страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initializeAnalytics();
    });
} else {
    // DOM уже загружен
    initializeAnalytics();
}

function initializeAnalytics() {
    console.log('[Analytics] Инициализация аналитики...');
    
    // Обработчики вкладок
    const tabButtons = document.querySelectorAll('.analytics-tab-btn');
    console.log('[Analytics] Найдено кнопок вкладок:', tabButtons.length);
    tabButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            console.log('[Analytics] Переключение на вкладку:', tab);
            switchTab(tab);
        });
    });

    // Обработчики периодов
    document.querySelectorAll('.analytics-period-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.analytics-period-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentPeriod = this.dataset.period;
            customPeriodFrom = null;
            customPeriodTo = null;
            document.getElementById('analytics-period-from').value = '';
            document.getElementById('analytics-period-to').value = '';
            loadAllAnalytics();
        });
    });

    // Обработчик кастомного периода
    document.getElementById('apply-analytics-period-btn').addEventListener('click', function() {
        const from = document.getElementById('analytics-period-from').value;
        const to = document.getElementById('analytics-period-to').value;
        if (from && to) {
            customPeriodFrom = from;
            customPeriodTo = to;
            currentPeriod = 'custom';
            document.querySelectorAll('.analytics-period-btn').forEach(b => b.classList.remove('active'));
            loadAllAnalytics();
        } else {
            alert('Выберите обе даты для кастомного периода');
        }
    });

    // Обработчик кнопки обновления
    const refreshBtn = document.getElementById('refresh-analytics-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadAllAnalytics);
    }

    // Загружаем данные при открытии страницы
    const analyticsPage = document.getElementById('analytics-page');
    console.log('[Analytics] Страница аналитики найдена:', !!analyticsPage);
    if (analyticsPage) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const isVisible = analyticsPage.style.display !== 'none';
                    console.log('[Analytics] Страница стала видимой:', isVisible);
                    if (isVisible) {
                        // Небольшая задержка для корректной инициализации
                        setTimeout(() => {
                            console.log('[Analytics] Автозагрузка данных после показа страницы');
                            loadAllAnalytics();
                        }, 200);
                    }
                }
            });
        });
        observer.observe(analyticsPage, { attributes: true, attributeFilter: ['style'] });
        
        // Также проверяем текущее состояние страницы
        if (analyticsPage.style.display !== 'none') {
            console.log('[Analytics] Страница уже видна, загружаем данные');
            setTimeout(() => {
                loadAllAnalytics();
            }, 200);
        }
    }

    // Также слушаем событие pageChanged из admin.js
    document.addEventListener('pageChanged', function(event) {
        console.log('[Analytics] pageChanged event:', event.detail.page);
        if (event.detail.page === 'analytics') {
            setTimeout(() => {
                console.log('[Analytics] Загрузка данных после pageChanged');
                loadAllAnalytics();
            }, 100);
        }
    });

    // Дополнительная проверка при видимости страницы
    const checkPageVisibility = setInterval(() => {
        const analyticsPage = document.getElementById('analytics-page');
        if (analyticsPage && analyticsPage.style.display !== 'none') {
            console.log('[Analytics] Страница видна, проверяем данные...');
            const hasData = document.getElementById('attendance-total-trainings')?.textContent !== '0';
            if (!hasData && currentTab === 'attendance') {
                console.log('[Analytics] Данных нет, загружаем...');
                loadAllAnalytics();
            }
        }
    }, 1000);

    // Останавливаем проверку через 10 секунд
    setTimeout(() => {
        clearInterval(checkPageVisibility);
    }, 10000);
}

function switchTab(tab) {
    currentTab = tab;
    
    // Обновляем активные вкладки
    document.querySelectorAll('.analytics-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    
    // Показываем нужный контент
    document.querySelectorAll('.analytics-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `analytics-tab-${tab}`);
        content.style.display = content.id === `analytics-tab-${tab}` ? 'block' : 'none';
    });

    // Загружаем данные для выбранной вкладки
    loadTabData(tab);
}

// Делаем функцию глобальной
window.loadAllAnalytics = function() {
    console.log('[Analytics] loadAllAnalytics вызван, текущая вкладка:', currentTab);
    loadTabData(currentTab);
}

function loadTabData(tab) {
    switch(tab) {
        case 'attendance':
            loadAttendanceData();
            break;
        case 'trainers':
            loadTrainersData();
            break;
        case 'training-types':
            loadTrainingTypesData();
            break;
        case 'referrals':
            loadReferralsData();
            break;
    }
}

// Загрузка данных посещаемости
async function loadAttendanceData() {
    try {
        console.log('[Analytics] Загрузка данных посещаемости, период:', currentPeriod);
        showLoading('Загрузка данных посещаемости...');
        
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && customPeriodFrom && customPeriodTo) {
            params.append('period', 'custom');
            params.append('from', customPeriodFrom);
            params.append('to', customPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const url = `/api/analytics/attendance?${params}`;
        console.log('[Analytics] Запрос к:', url);
        const response = await authFetch(url);
        
        console.log('[Analytics] Ответ получен:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Analytics] Ошибка ответа:', errorText);
            throw new Error('Ошибка загрузки данных посещаемости: ' + response.status);
        }

        const result = await response.json();
        console.log('[Analytics] Данные получены:', result);
        
        if (result.success) {
            displayAttendanceData(result);
        } else {
            throw new Error(result.error || 'Ошибка загрузки данных посещаемости');
        }
    } catch (error) {
        console.error('[Analytics] Ошибка загрузки данных посещаемости:', error);
        showError('Не удалось загрузить данные посещаемости: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayAttendanceData(result) {
    // Обновляем статистику
    const totals = result.totals || {};
    document.getElementById('attendance-total-trainings').textContent = totals.total_trainings || 0;
    document.getElementById('attendance-unique-clients').textContent = totals.total_unique_clients || 0;
    document.getElementById('attendance-children').textContent = totals.total_children || 0;

    // Строим график
    const ctx = document.getElementById('attendance-chart');
    if (!ctx) return;

    // Уничтожаем предыдущий график, если есть
    if (attendanceChart) {
        attendanceChart.destroy();
    }

    const dailyData = result.daily || [];
    if (dailyData.length === 0) {
        ctx.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных за выбранный период</p>';
        return;
    }

    const labels = dailyData.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    });
    
    attendanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Тренировок',
                    data: dailyData.map(d => parseInt(d.trainings_count) || 0),
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1
                },
                {
                    label: 'Уникальных клиентов',
                    data: dailyData.map(d => parseInt(d.unique_clients) || 0),
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                title: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Загрузка данных по тренерам
async function loadTrainersData() {
    try {
        showLoading('Загрузка данных по тренерам...');
        
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && customPeriodFrom && customPeriodTo) {
            params.append('period', 'custom');
            params.append('from', customPeriodFrom);
            params.append('to', customPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/analytics/trainers?${params}`);
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки данных по тренерам');
        }

        const result = await response.json();
        
        if (result.success) {
            displayTrainersData(result);
        } else {
            throw new Error(result.error || 'Ошибка загрузки данных по тренерам');
        }
    } catch (error) {
        console.error('Ошибка загрузки данных по тренерам:', error);
        showError('Не удалось загрузить данные по тренерам');
    } finally {
        hideLoading();
    }
}

function displayTrainersData(result) {
    // Тренеры тренажера
    const simulatorList = document.getElementById('trainers-simulator-list');
    if (simulatorList) {
        const simulatorData = result.simulator || [];
        if (simulatorData.length > 0) {
            simulatorList.innerHTML = simulatorData.map(trainer => `
                <div style="padding: 15px; border-bottom: 1px solid #e0e0e0;">
                    <div style="font-weight: bold; margin-bottom: 8px;">${trainer.full_name}</div>
                    <div style="font-size: 14px; color: #666;">
                        <div>Всего тренировок: <strong>${trainer.total_trainings || 0}</strong></div>
                        <div>Индивидуальных: ${trainer.individual_trainings || 0}</div>
                        <div>Групповых: ${trainer.group_trainings || 0}</div>
                        <div>Уникальных клиентов: ${trainer.unique_clients || 0}</div>
                    </div>
                </div>
            `).join('');
        } else {
            simulatorList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Нет данных</p>';
        }
    }

    // Инструкторы Кулиги
    const kuligaList = document.getElementById('trainers-kuliga-list');
    if (kuligaList) {
        const kuligaData = result.kuliga || [];
        if (kuligaData.length > 0) {
            kuligaList.innerHTML = kuligaData.map(instructor => {
                const locationName = instructor.location === 'vorona' ? 'Воронинские горки' : 'Кулига';
                return `
                    <div style="padding: 15px; border-bottom: 1px solid #e0e0e0;">
                        <div style="font-weight: bold; margin-bottom: 8px;">${instructor.full_name}</div>
                        <div style="font-size: 12px; color: #999; margin-bottom: 8px;">${locationName}</div>
                        <div style="font-size: 14px; color: #666;">
                            <div>Всего тренировок: <strong>${instructor.total_trainings || 0}</strong></div>
                            <div>Индивидуальных: ${instructor.individual_trainings || 0}</div>
                            <div>Групповых: ${instructor.group_trainings || 0}</div>
                            <div>Уникальных клиентов: ${instructor.unique_clients || 0}</div>
                            <div>Выручка: <strong>${parseFloat(instructor.total_revenue || 0).toFixed(2)} ₽</strong></div>
                            <div>Заработок: <strong>${parseFloat(instructor.instructor_earnings || 0).toFixed(2)} ₽</strong></div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            kuligaList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Нет данных</p>';
        }
    }
}

// Загрузка данных по типам тренировок
async function loadTrainingTypesData() {
    try {
        showLoading('Загрузка данных по типам тренировок...');
        
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && customPeriodFrom && customPeriodTo) {
            params.append('period', 'custom');
            params.append('from', customPeriodFrom);
            params.append('to', customPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/analytics/training-types?${params}`);
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки данных по типам тренировок');
        }

        const result = await response.json();
        
        if (result.success) {
            displayTrainingTypesData(result);
        } else {
            throw new Error(result.error || 'Ошибка загрузки данных по типам тренировок');
        }
    } catch (error) {
        console.error('Ошибка загрузки данных по типам тренировок:', error);
        showError('Не удалось загрузить данные по типам тренировок');
    } finally {
        hideLoading();
    }
}

function displayTrainingTypesData(result) {
    // Строим график
    const ctx = document.getElementById('training-types-chart');
    if (!ctx) return;

    // Уничтожаем предыдущий график, если есть
    if (trainingTypesChart) {
        trainingTypesChart.destroy();
    }

    const typesData = result.types || [];
    if (typesData.length === 0) {
        ctx.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных за выбранный период</p>';
        document.getElementById('training-types-details').innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных</p>';
        return;
    }

    const labels = typesData.map(t => t.type);
    const trainingsData = typesData.map(t => parseInt(t.trainings_count) || 0);
    const clientsData = typesData.map(t => parseInt(t.unique_clients) || 0);

    trainingTypesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Количество тренировок',
                    data: trainingsData,
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Уникальных клиентов',
                    data: clientsData,
                    backgroundColor: 'rgba(255, 99, 132, 0.6)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });

    // Детальная статистика
    const detailsDiv = document.getElementById('training-types-details');
    if (detailsDiv) {
        detailsDiv.innerHTML = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f5f5f5;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Тип тренировки</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Тренировок</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Клиентов</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Выручка</th>
                    </tr>
                </thead>
                <tbody>
                    ${typesData.map(type => `
                        <tr>
                            <td style="padding: 12px; border-bottom: 1px solid #eee;">${type.type}</td>
                            <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">${type.trainings_count || 0}</td>
                            <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">${type.unique_clients || 0}</td>
                            <td style="padding: 12px; text-align: right; border-bottom: 1px solid #eee;">${parseFloat(type.total_revenue || 0).toFixed(2)} ₽</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}

// Загрузка данных реферальной программы
async function loadReferralsData() {
    try {
        showLoading('Загрузка данных реферальной программы...');
        
        const params = new URLSearchParams();
        if (currentPeriod === 'custom' && customPeriodFrom && customPeriodTo) {
            params.append('period', 'custom');
            params.append('from', customPeriodFrom);
            params.append('to', customPeriodTo);
        } else {
            params.append('period', currentPeriod);
        }

        const response = await authFetch(`/api/analytics/referrals?${params}`);
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки данных реферальной программы');
        }

        const result = await response.json();
        
        if (result.success) {
            displayReferralsData(result);
        } else {
            throw new Error(result.error || 'Ошибка загрузки данных реферальной программы');
        }
    } catch (error) {
        console.error('Ошибка загрузки данных реферальной программы:', error);
        showError('Не удалось загрузить данные реферальной программы');
    } finally {
        hideLoading();
    }
}

function displayReferralsData(result) {
    // Обновляем статистику
    const stats = result.stats || {};
    document.getElementById('referrals-total-referrers').textContent = stats.total_referrers || 0;
    document.getElementById('referrals-total-referred').textContent = stats.total_referred || 0;
    document.getElementById('referrals-completed').textContent = stats.completed || 0;
    const totalBonuses = parseFloat(stats.total_bonuses_paid || 0) + parseFloat(stats.total_bonuses_received || 0);
    document.getElementById('referrals-total-bonuses').textContent = totalBonuses.toFixed(2) + ' ₽';

    // График конверсии
    const ctx = document.getElementById('referrals-conversion-chart');
    if (ctx) {
        if (referralsConversionChart) {
            referralsConversionChart.destroy();
        }

        const conversionData = result.conversion || [];
        if (conversionData.length === 0) {
            ctx.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных за выбранный период</p>';
        } else {
            const labels = conversionData.map(c => {
                const stageNames = {
                    'registered': 'Зарегистрировано',
                    'deposited': 'Пополнили баланс',
                    'trained': 'Прошли тренировку',
                    'completed': 'Завершено'
                };
                return stageNames[c.stage] || c.stage;
            });
            const counts = conversionData.map(c => parseInt(c.count) || 0);
            const rates = conversionData.map(c => parseFloat(c.conversion_rate) || 0);

        referralsConversionChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Количество',
                        data: counts,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Конверсия (%)',
                        data: rates,
                        type: 'line',
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        yAxisID: 'y1',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        max: 100,
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
        }
    }

    // ТОП рефереров
    const topReferrersDiv = document.getElementById('referrals-top-referrers');
    if (topReferrersDiv) {
        const topReferrersData = result.topReferrers || [];
        if (topReferrersData.length > 0) {
            topReferrersDiv.innerHTML = topReferrersData.map((ref, index) => `
                <div style="padding: 15px; border-bottom: 1px solid #e0e0e0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="font-weight: bold;">${index + 1}. ${ref.referrer_name}</div>
                        <div style="font-size: 18px; color: #4CAF50; font-weight: bold;">${parseFloat(ref.total_bonus_earned || 0).toFixed(2)} ₽</div>
                    </div>
                    <div style="font-size: 14px; color: #666;">
                        <div>Приглашено: <strong>${ref.total_referred || 0}</strong></div>
                        <div>Завершено: <strong>${ref.completed || 0}</strong></div>
                    </div>
                </div>
            `).join('');
        } else {
            topReferrersDiv.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Нет данных</p>';
        }
    }
}

// Вспомогательные функции
function authFetch(url, options = {}) {
    const token = getCookie('adminToken') || localStorage.getItem('token');
    console.log('[Analytics] authFetch вызван для:', url, 'токен найден:', !!token);
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return fetch(url, {
        ...options,
        headers
    });
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function showLoading(message) {
    // Используем существующую функцию showLoading из admin.js, если есть
    if (typeof window.showLoading === 'function') {
        window.showLoading(message);
    }
}

function hideLoading() {
    // Используем существующую функцию hideLoading из admin.js, если есть
    if (typeof window.hideLoading === 'function') {
        window.hideLoading();
    }
}

function showError(message) {
    // Используем существующую функцию showError из admin.js, если есть
    if (typeof window.showError === 'function') {
        window.showError(message);
    } else {
        alert(message);
    }
}
