/**
 * Модуль для проверки "зависших" платежей Кулиги
 */

(function() {
    'use strict';

    // Элементы
    let modal = null;
    let periodSelect = null;
    let customDatesDiv = null;
    let fromDateInput = null;
    let toDateInput = null;
    let checkBtn = null;
    let resultsDiv = null;

    // Инициализация
    function init() {
        const stuckPaymentsBtn = document.getElementById('stuck-payments-btn');
        if (stuckPaymentsBtn) {
            stuckPaymentsBtn.addEventListener('click', openStuckPaymentsModal);
        }
    }

    // Открытие модального окна
    function openStuckPaymentsModal() {
        if (!modal) {
            createModal();
        }
        modal.style.display = 'flex';
        // Автоматически проверяем за сегодня
        periodSelect.value = 'today';
        handlePeriodChange();
        checkStuckPayments();
    }

    // Создание модального окна
    function createModal() {
        modal = document.createElement('div');
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 10px;
            padding: 30px;
            max-width: 1200px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        `;

        modalContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0;">⚠️ Проверка зависших платежей</h2>
                <button id="close-stuck-payments-modal" style="background: none; border: none; font-size: 30px; cursor: pointer; color: #999;">&times;</button>
            </div>

            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 15px; margin-bottom: 20px;">
                <strong>ℹ️ Что такое "зависший" платеж?</strong>
                <p style="margin: 10px 0 0 0; font-size: 14px; color: #856404;">
                    Это транзакции, по которым клиент оплатил, но webhook от банка не пришёл, и бронирование не создалось автоматически.
                    Здесь вы можете найти такие платежи и создать бронирование вручную.
                </p>
            </div>

            <div style="display: flex; gap: 15px; margin-bottom: 20px; align-items: end; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 500;">Период:</label>
                    <select id="stuck-period-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                        <option value="today">Сегодня</option>
                        <option value="2days">За 2 дня</option>
                        <option value="3days">За 3 дня</option>
                        <option value="week">За неделю</option>
                        <option value="custom">Произвольный период</option>
                    </select>
                </div>

                <div id="custom-dates-div" style="display: none; flex: 2; min-width: 300px;">
                    <div style="display: flex; gap: 10px;">
                        <div style="flex: 1;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">С:</label>
                            <input type="date" id="stuck-from-date" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">По:</label>
                            <input type="date" id="stuck-to-date" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                        </div>
                    </div>
                </div>

                <button id="check-stuck-btn" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 500;">
                    🔍 Проверить
                </button>
            </div>

            <div id="stuck-payments-results">
                <div style="text-align: center; padding: 40px; color: #999;">
                    Выберите период и нажмите "Проверить"
                </div>
            </div>
        `;

        modalContent.querySelector('#close-stuck-payments-modal').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Сохраняем ссылки на элементы
        periodSelect = document.getElementById('stuck-period-select');
        customDatesDiv = document.getElementById('custom-dates-div');
        fromDateInput = document.getElementById('stuck-from-date');
        toDateInput = document.getElementById('stuck-to-date');
        checkBtn = document.getElementById('check-stuck-btn');
        resultsDiv = document.getElementById('stuck-payments-results');

        // Устанавливаем сегодняшнюю дату для произвольного периода
        const today = new Date().toISOString().split('T')[0];
        fromDateInput.value = today;
        toDateInput.value = today;

        // События
        periodSelect.addEventListener('change', handlePeriodChange);
        checkBtn.addEventListener('click', checkStuckPayments);
    }

    // Обработка смены периода
    function handlePeriodChange() {
        if (periodSelect.value === 'custom') {
            customDatesDiv.style.display = 'block';
        } else {
            customDatesDiv.style.display = 'none';
        }
    }

    // Проверка зависших платежей
    async function checkStuckPayments() {
        const period = periodSelect.value;
        let url = `/api/kuliga/admin/stuck-payments?period=${period}`;

        if (period === 'custom') {
            const from = fromDateInput.value;
            const to = toDateInput.value;
            if (!from || !to) {
                alert('Укажите даты для произвольного периода');
                return;
            }
            url += `&from=${from}&to=${to}`;
        }

        resultsDiv.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="spinner"></div><p>Загрузка...</p></div>';

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            displayResults(data);

        } catch (error) {
            console.error('Ошибка проверки зависших платежей:', error);
            resultsDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <h3>❌ Ошибка</h3>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }

    // Отображение результатов
    function displayResults(data) {
        if (data.count === 0) {
            resultsDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px;">
                    <h3 style="color: #155724; margin: 0;">✅ Зависших платежей не найдено</h3>
                    <p style="margin: 10px 0 0 0; color: #155724;">За период ${formatDate(data.startDate)} - ${formatDate(data.endDate)}</p>
                </div>
            `;
            return;
        }

        let html = `
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px; padding: 15px; margin-bottom: 20px;">
                <h3 style="color: #721c24; margin: 0 0 10px 0;">⚠️ Найдено зависших платежей: ${data.count}</h3>
                <p style="margin: 0; color: #721c24; font-size: 14px;">
                    Период: ${formatDate(data.startDate)} - ${formatDate(data.endDate)}
                </p>
            </div>

            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 12px; text-align: left;">ID</th>
                            <th style="padding: 12px; text-align: left;">Клиент</th>
                            <th style="padding: 12px; text-align: left;">Сумма</th>
                            <th style="padding: 12px; text-align: left;">Описание</th>
                            <th style="padding: 12px; text-align: left;">Статус</th>
                            <th style="padding: 12px; text-align: left;">Создано</th>
                            <th style="padding: 12px; text-align: left;">Действия</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.payments.forEach(payment => {
            const createdAt = new Date(payment.createdAt);
            const timeAgo = payment.minutesAgo < 60 
                ? `${payment.minutesAgo} мин. назад`
                : `${Math.floor(payment.minutesAgo / 60)} ч. назад`;

            html += `
                <tr style="border-bottom: 1px solid #dee2e6;">
                    <td style="padding: 12px;">#${payment.id}</td>
                    <td style="padding: 12px;">
                        ${payment.clientName || 'Неизвестно'}<br>
                        <small style="color: #6c757d;">${payment.clientPhone || ''}</small>
                    </td>
                    <td style="padding: 12px; font-weight: 500;">${payment.amount} ₽</td>
                    <td style="padding: 12px;">
                        ${payment.description}<br>
                        <small style="color: #6c757d;">Order: ${payment.providerOrderId || 'N/A'}</small>
                    </td>
                    <td style="padding: 12px;">
                        <span style="padding: 4px 8px; background: #ffc107; color: #856404; border-radius: 3px; font-size: 12px; font-weight: 500;">
                            ${payment.status}
                        </span><br>
                        <small style="color: #6c757d;">${payment.providerStatus || 'N/A'}</small>
                    </td>
                    <td style="padding: 12px;">
                        ${createdAt.toLocaleString('ru-RU')}<br>
                        <small style="color: #dc3545;">${timeAgo}</small>
                    </td>
                    <td style="padding: 12px;">
                        <div style="display: flex; gap: 5px; flex-direction: column;">
                            ${payment.hasBookingData 
                                ? `<button onclick="createBookingFromTransaction(${payment.id})" style="padding: 5px 10px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                                    ✅ Создать бронь
                                </button>`
                                : `<span style="color: #999; font-size: 12px;">Нет данных</span>`
                            }
                            <button onclick="cancelStuckPayment(${payment.id})" style="padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                                ❌ Отменить
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        resultsDiv.innerHTML = html;
    }

    // Форматирование даты
    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU');
    }

    // Создание бронирования из транзакции
    window.createBookingFromTransaction = async function(transactionId) {
        if (!confirm(`Создать бронирование из транзакции #${transactionId}?\n\nУбедитесь, что слот ещё свободен!`)) {
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/kuliga/admin/stuck-payments/${transactionId}/create-booking`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            alert(`✅ Бронирование #${data.bookingId} успешно создано!\n\n⚠️ Не забудьте отправить уведомления клиенту и инструктору.`);
            checkStuckPayments(); // Обновляем список

        } catch (error) {
            console.error('Ошибка создания бронирования:', error);
            alert(`❌ Ошибка: ${error.message}`);
        }
    };

    // Отмена транзакции
    window.cancelStuckPayment = async function(transactionId) {
        const reason = prompt('Причина отмены транзакции:', 'Слот занят, требуется возврат средств');
        if (!reason) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/kuliga/admin/stuck-payments/${transactionId}/cancel`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reason })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            alert(`✅ Транзакция #${transactionId} отменена.\n\n⚠️ Выполните возврат средств клиенту вручную через личный кабинет банка.`);
            checkStuckPayments(); // Обновляем список

        } catch (error) {
            console.error('Ошибка отмены транзакции:', error);
            alert(`❌ Ошибка: ${error.message}`);
        }
    };

    // Инициализация после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

