#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки создания платежа через Точка Банк
 * 
 * Использование:
 *   node scripts/test-tochka-payment.js
 */

require('dotenv').config();
const TochkaProvider = require('../src/services/payment/providers/tochkaProvider');

async function testPayment() {
    console.log('🧪 Тестирование создания платежа через Точка Банк...');
    console.log('');

    const provider = new TochkaProvider();

    // Проверяем конфигурацию
    console.log('📋 Конфигурация:');
    console.log(`  API URL: ${provider.apiUrl}`);
    console.log(`  Client ID: ${provider.clientId}`);
    console.log(`  Merchant ID: ${provider.merchantId}`);
    console.log(`  Customer Code: ${provider.customerCode}`);
    console.log(`  СБП включен: ${provider.enableSBP}`);
    console.log(`  Success URL: ${provider.successUrl}`);
    console.log(`  Fail URL: ${provider.failUrl}`);
    console.log(`  Callback URL: ${provider.callbackUrl}`);
    console.log('');

    if (!provider.apiKey || !provider.clientId || !provider.merchantId) {
        console.error('❌ Не все обязательные параметры настроены!');
        process.exit(1);
    }

    // Тестовый платеж
    const testPaymentParams = {
        orderId: `kuliga-test-${Date.now()}`,
        amount: 100, // 100 рублей
        description: 'Тестовый платеж Горностайл72',
        customerPhone: '+79123456789',
        customerEmail: 'test@example.com',
        items: [
            {
                name: 'Тестовая тренировка',
                price: 100,
                quantity: 1,
                amount: 100,
                tax: 'none',
                paymentMethod: 'full_payment',
                paymentObject: 'service'
            }
        ],
        paymentMethod: 'card' // или 'sbp'
    };

    console.log('📤 Создание платежа...');
    console.log('Параметры:', JSON.stringify(testPaymentParams, null, 2));
    console.log('');

    try {
        const result = await provider.initPayment(testPaymentParams);

        console.log('✅ Платеж создан успешно!');
        console.log('');
        console.log('📦 Ответ от банка:');
        console.log(`  Payment ID: ${result.paymentId}`);
        console.log(`  Payment URL: ${result.paymentURL}`);
        console.log(`  Status: ${result.status}`);
        
        if (result.qrCodeUrl) {
            console.log(`  QR Code URL: ${result.qrCodeUrl}`);
        }
        
        console.log('');
        console.log('🔗 Ссылка для оплаты:');
        console.log(result.paymentURL);
        console.log('');
        console.log('📋 Следующие шаги:');
        console.log('   1. Откройте ссылку в браузере');
        console.log('   2. Оплатите (или отмените)');
        console.log('   3. Проверьте, что вебхук пришел на callback URL');
        console.log('   4. Проверьте таблицу webhook_logs в БД');

    } catch (error) {
        console.error('❌ Ошибка создания платежа:');
        console.error('');
        console.error('Сообщение:', error.message);
        
        if (error.response) {
            console.error('Статус:', error.response.status);
            console.error('Ответ:', JSON.stringify(error.response.data, null, 2));
        }
        
        console.error('');
        console.error('💡 Возможные причины:');
        console.error('   - Неверные credentials (API_KEY, MERCHANT_ID, etc.)');
        console.error('   - Эквайринг не активирован в Точка Банке');
        console.error('   - Проблемы с сетью/доступом к API');
        console.error('   - Неверный формат данных');
        
        process.exit(1);
    }
}

// Запуск
testPayment()
    .then(() => {
        console.log('');
        console.log('🎉 Тест завершен!');
        process.exit(0);
    })
    .catch(err => {
        console.error('Критическая ошибка:', err.message);
        process.exit(1);
    });

