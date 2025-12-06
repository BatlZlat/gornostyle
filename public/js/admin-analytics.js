// Аналитика для админ-панели
(function() {
    'use strict';
    
    console.log('✅ admin-analytics.js загружен (версия 2)');
    
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
        const applyBtn = document.getElementById('apply-analytics-period-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
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
        }

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

        // Дополнительная проверка при видимости страницы (только первые 10 секунд)
        let checkCount = 0;
        const maxChecks = 10;
        const checkPageVisibility = setInterval(() => {
            checkCount++;
            if (checkCount > maxChecks) {
                clearInterval(checkPageVisibility);
                return;
            }
            
            const analyticsPage = document.getElementById('analytics-page');
            if (analyticsPage && analyticsPage.style.display !== 'none') {
                console.log('[Analytics] Страница видна, проверяем данные... (проверка', checkCount, '/', maxChecks, ')');
                const totalTrainingsEl = document.getElementById('attendance-total-trainings');
                const hasData = totalTrainingsEl && totalTrainingsEl.textContent !== '0' && totalTrainingsEl.textContent.trim() !== '';
                if (!hasData && currentTab === 'attendance' && checkCount <= 3) {
                    console.log('[Analytics] Данных нет, загружаем...');
                    loadAllAnalytics();
                }
            }
        }, 1000);
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
        const totalTrainingsEl = document.getElementById('attendance-total-trainings');
        const uniqueClientsEl = document.getElementById('attendance-unique-clients');
        const childrenEl = document.getElementById('attendance-children');
        
        if (totalTrainingsEl) totalTrainingsEl.textContent = totals.total_trainings || 0;
        if (uniqueClientsEl) uniqueClientsEl.textContent = totals.total_unique_clients || 0;
        if (childrenEl) childrenEl.textContent = totals.total_children || 0;

        // Строим график
        const ctx = document.getElementById('attendance-chart');
        if (!ctx) {
            console.warn('[Analytics] Canvas элемент не найден');
            return;
        }

        // Уничтожаем предыдущий график, если есть
        if (attendanceChart) {
            attendanceChart.destroy();
            attendanceChart = null;
        }

        const dailyData = result.daily || [];
        console.log('[Analytics] Данных для графика:', dailyData.length, dailyData);
        if (dailyData.length === 0) {
            // Сохраняем структуру HTML, просто скрываем canvas и показываем сообщение
            ctx.style.display = 'none';
            const parentEl = ctx.parentElement;
            // Удаляем предыдущее сообщение, если есть
            const existingMsg = parentEl.querySelector('.no-data-message');
            if (existingMsg) {
                existingMsg.remove();
            }
            // Добавляем сообщение
            const msgEl = document.createElement('p');
            msgEl.className = 'no-data-message';
            msgEl.style.cssText = 'text-align: center; color: #666; padding: 20px; margin: 0;';
            msgEl.textContent = 'Нет данных за выбранный период';
            parentEl.appendChild(msgEl);
            return;
        }
        
        // Показываем canvas обратно, если он был скрыт
        ctx.style.display = 'block';
        const existingMsg = ctx.parentElement.querySelector('.no-data-message');
        if (existingMsg) {
            existingMsg.remove();
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
            console.log('[Analytics] Загрузка данных по тренерам, период:', currentPeriod);
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
            
            console.log('[Analytics] Ответ по тренерам:', response.status);
            
            if (!response.ok) {
                throw new Error('Ошибка загрузки данных по тренерам');
            }

            const result = await response.json();
            console.log('[Analytics] Данные по тренерам:', result);
            
            if (result.success) {
                displayTrainersData(result);
            } else {
                throw new Error(result.error || 'Ошибка загрузки данных по тренерам');
            }
        } catch (error) {
            console.error('[Analytics] Ошибка загрузки данных по тренерам:', error);
            showError('Не удалось загрузить данные по тренерам: ' + error.message);
        } finally {
            hideLoading();
        }
    }

    function displayTrainersData(result) {
        // Обновляем общую статистику
        const simulatorData = result.simulator || [];
        const kuligaData = result.kuliga || [];
        
        const totalCountEl = document.getElementById('trainers-total-count');
        const totalTrainingsEl = document.getElementById('trainers-total-trainings');
        const totalRevenueEl = document.getElementById('trainers-total-revenue');
        const totalEarningsEl = document.getElementById('trainers-total-earnings');
        
        if (totalCountEl) totalCountEl.textContent = simulatorData.length + kuligaData.length;
        if (totalTrainingsEl) {
            const total = simulatorData.reduce((sum, t) => sum + (parseInt(t.total_trainings) || 0), 0) +
                          kuligaData.reduce((sum, t) => sum + (parseInt(t.total_trainings) || 0), 0);
            totalTrainingsEl.textContent = total;
        }
        if (totalRevenueEl) {
            const total = kuligaData.reduce((sum, t) => sum + parseFloat(t.total_revenue || 0), 0);
            totalRevenueEl.textContent = total.toFixed(2) + ' ₽';
        }
        if (totalEarningsEl) {
            const total = kuligaData.reduce((sum, t) => sum + parseFloat(t.instructor_earnings || 0), 0);
            totalEarningsEl.textContent = total.toFixed(2) + ' ₽';
        }

        // Тренеры тренажера
        const simulatorListEl = document.getElementById('trainers-simulator-list');
        console.log('[Analytics] Элемент trainers-simulator-list:', !!simulatorListEl);
        if (simulatorListEl) {
            if (simulatorData.length > 0) {
                simulatorListEl.innerHTML = `
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">ФИО</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Индивидуальных</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Групповых</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Всего</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Уникальных клиентов</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${simulatorData.map(t => `
                                <tr style="border-bottom: 1px solid #eee;">
                                    <td style="padding: 12px;">${t.full_name}</td>
                                    <td style="padding: 12px; text-align: right;">${t.individual_trainings || 0}</td>
                                    <td style="padding: 12px; text-align: right;">${t.group_trainings || 0}</td>
                                    <td style="padding: 12px; text-align: right;"><strong>${t.total_trainings || 0}</strong></td>
                                    <td style="padding: 12px; text-align: right;">${t.unique_clients || 0}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                simulatorListEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных</p>';
            }
        } else {
            console.warn('[Analytics] Элемент trainers-simulator-list не найден!');
        }

        // Инструкторы Кулиги
        const kuligaListEl = document.getElementById('trainers-kuliga-list');
        console.log('[Analytics] Элемент trainers-kuliga-list:', !!kuligaListEl);
        if (kuligaListEl) {
            if (kuligaData.length > 0) {
                kuligaListEl.innerHTML = `
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">ФИО</th>
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Место работы</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Индивидуальных</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Групповых</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Всего</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Уникальных клиентов</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Выручка</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Заработок</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${kuligaData.map(i => {
                                const locationName = i.location === 'vorona' ? 'Воронинские горки' : 'Кулига';
                                return `
                                    <tr style="border-bottom: 1px solid #eee;">
                                        <td style="padding: 12px;">${i.full_name}</td>
                                        <td style="padding: 12px;">${locationName}</td>
                                        <td style="padding: 12px; text-align: right;">${i.individual_trainings || 0}</td>
                                        <td style="padding: 12px; text-align: right;">${i.group_trainings || 0}</td>
                                        <td style="padding: 12px; text-align: right;"><strong>${i.total_trainings || 0}</strong></td>
                                        <td style="padding: 12px; text-align: right;">${i.unique_clients || 0}</td>
                                        <td style="padding: 12px; text-align: right;">${parseFloat(i.total_revenue || 0).toFixed(2)} ₽</td>
                                        <td style="padding: 12px; text-align: right;">${parseFloat(i.instructor_earnings || 0).toFixed(2)} ₽</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                kuligaListEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных</p>';
            }
        } else {
            console.warn('[Analytics] Элемент trainers-kuliga-list не найден!');
        }
    }

    // Загрузка данных по типам тренировок
    async function loadTrainingTypesData() {
        try {
            console.log('[Analytics] Загрузка данных по типам тренировок, период:', currentPeriod);
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
            
            console.log('[Analytics] Ответ по типам:', response.status);
            
            if (!response.ok) {
                throw new Error('Ошибка загрузки данных по типам тренировок');
            }

            const result = await response.json();
            console.log('[Analytics] Данные по типам:', result);
            
            if (result.success) {
                displayTrainingTypesData(result);
            } else {
                throw new Error(result.error || 'Ошибка загрузки данных по типам тренировок');
            }
        } catch (error) {
            console.error('[Analytics] Ошибка загрузки данных по типам тренировок:', error);
            showError('Не удалось загрузить данные по типам тренировок: ' + error.message);
        } finally {
            hideLoading();
        }
    }

    function displayTrainingTypesData(result) {
        // Обновляем статистику
        const typesData = result.types || [];
        const totalTrainingsEl = document.getElementById('training-types-total-trainings');
        const totalRevenueEl = document.getElementById('training-types-total-revenue');
        
        if (totalTrainingsEl) {
            const total = typesData.reduce((sum, t) => sum + (parseInt(t.trainings_count) || 0), 0);
            totalTrainingsEl.textContent = total;
        }
        if (totalRevenueEl) {
            const total = typesData.reduce((sum, t) => sum + parseFloat(t.total_revenue || 0), 0);
            totalRevenueEl.textContent = total.toFixed(2) + ' ₽';
        }

        // Строим график
        const ctx = document.getElementById('training-types-chart');
        if (!ctx) return;

        // Уничтожаем предыдущий график, если есть
        if (trainingTypesChart) {
            trainingTypesChart.destroy();
            trainingTypesChart = null;
        }

        if (typesData.length === 0) {
            ctx.parentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных за выбранный период</p>';
            const detailsDiv = document.getElementById('training-types-table');
            if (detailsDiv) {
                detailsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных</p>';
            }
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
        const detailsDiv = document.getElementById('training-types-table');
        if (detailsDiv) {
            detailsDiv.innerHTML = `
                <table class="data-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th>Тип тренировки</th>
                            <th>Тренировок</th>
                            <th>Клиентов</th>
                            <th>Выручка</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${typesData.map(type => `
                            <tr>
                                <td>${type.type}</td>
                                <td>${type.trainings_count || 0}</td>
                                <td>${type.unique_clients || 0}</td>
                                <td>${parseFloat(type.total_revenue || 0).toFixed(2)} ₽</td>
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
            console.log('[Analytics] Загрузка данных реферальной программы, период:', currentPeriod);
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
            
            console.log('[Analytics] Ответ по рефералам:', response.status);
            
            if (!response.ok) {
                throw new Error('Ошибка загрузки данных реферальной программы');
            }

            const result = await response.json();
            console.log('[Analytics] Данные по рефералам:', result);
            
            if (result.success) {
                displayReferralsData(result);
            } else {
                throw new Error(result.error || 'Ошибка загрузки данных реферальной программы');
            }
        } catch (error) {
            console.error('[Analytics] Ошибка загрузки данных реферальной программы:', error);
            showError('Не удалось загрузить данные реферальной программы: ' + error.message);
        } finally {
            hideLoading();
        }
    }

    function displayReferralsData(result) {
        // Обновляем статистику
        const stats = result.stats || {};
        const totalReferrersEl = document.getElementById('referrals-total-referrers');
        const totalReferredEl = document.getElementById('referrals-total-referred');
        const totalBonusesPaidEl = document.getElementById('referrals-total-bonuses-paid');
        const totalBonusesReceivedEl = document.getElementById('referrals-total-bonuses-received');
        
        if (totalReferrersEl) totalReferrersEl.textContent = stats.total_referrers || 0;
        if (totalReferredEl) totalReferredEl.textContent = stats.total_referred || 0;
        
        // Обновляем карточку "Завершено"
        const completedEl = document.getElementById('referrals-completed');
        if (completedEl) completedEl.textContent = stats.completed || 0;
        
        // Обновляем карточку "Выплачено бонусов"
        const totalBonusesEl = document.getElementById('referrals-total-bonuses');
        if (totalBonusesEl) totalBonusesEl.textContent = parseFloat(stats.total_bonuses_paid || 0).toFixed(2) + ' ₽';
        
        if (totalBonusesPaidEl) totalBonusesPaidEl.textContent = parseFloat(stats.total_bonuses_paid || 0).toFixed(2) + ' ₽';
        if (totalBonusesReceivedEl) totalBonusesReceivedEl.textContent = parseFloat(stats.total_bonuses_received || 0).toFixed(2) + ' ₽';

        // График конверсии
        const ctx = document.getElementById('referral-conversion-chart');
        if (ctx) {
            if (referralsConversionChart) {
                referralsConversionChart.destroy();
                referralsConversionChart = null;
            }

            const conversionData = result.conversion || [];
            console.log('[Analytics] Данных конверсии:', conversionData.length, conversionData);
            
            // Удаляем предыдущее сообщение, если есть
            const existingMsg = ctx.parentElement.querySelector('.no-data-message');
            if (existingMsg) {
                existingMsg.remove();
            }
            
            if (conversionData.length === 0) {
                // Сохраняем структуру HTML, просто скрываем canvas и показываем сообщение
                ctx.style.display = 'none';
                const msgEl = document.createElement('p');
                msgEl.className = 'no-data-message';
                msgEl.style.cssText = 'text-align: center; color: #666; padding: 20px; margin: 0;';
                msgEl.textContent = 'Нет данных за выбранный период';
                ctx.parentElement.appendChild(msgEl);
            } else {
                // Показываем canvas обратно
                ctx.style.display = 'block';
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

        // Таблица конверсии - элемент не существует в HTML, данные отображаются в графике
        // Если нужно добавить таблицу, можно добавить элемент в HTML

        // ТОП рефереров
        const topReferrersEl = document.getElementById('referrals-top-referrers');
        console.log('[Analytics] Элемент referrals-top-referrers:', !!topReferrersEl);
        if (topReferrersEl) {
            const topReferrersData = result.topReferrers || [];
            console.log('[Analytics] Данных ТОП рефереров:', topReferrersData.length);
            if (topReferrersData.length > 0) {
                topReferrersEl.innerHTML = `
                    <table class="data-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Место</th>
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">ФИО</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Приглашено</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Завершено</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Бонус заработан</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topReferrersData.map((ref, index) => `
                                <tr style="border-bottom: 1px solid #eee;">
                                    <td style="padding: 12px;">${index + 1}</td>
                                    <td style="padding: 12px;">${ref.referrer_name}</td>
                                    <td style="padding: 12px; text-align: right;">${ref.total_referred || 0}</td>
                                    <td style="padding: 12px; text-align: right;">${ref.completed || 0}</td>
                                    <td style="padding: 12px; text-align: right;"><strong>${parseFloat(ref.total_bonus_earned || 0).toFixed(2)} ₽</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                topReferrersEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Нет данных</p>';
            }
        } else {
            console.warn('[Analytics] Элемент referrals-top-referrers не найден!');
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
})(); // IIFE - изолируем код в отдельной области видимости
