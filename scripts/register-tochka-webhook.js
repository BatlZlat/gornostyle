#!/usr/bin/env node

/**
 * Скрипт для регистрации вебхука в Точка Банке
 * 
 * API: PUT /webhook/{clientId}/v1.0
 * Документация: https://developers.tochka.com/docs/tochka-api/api/create-webhook-webhook-v-1-0-client-id-put
 * 
 * Использование:
 *   node scripts/register-tochka-webhook.js
 */

require('dotenv').config();
const axios = require('axios');

const TOCHKA_CLIENT_ID = process.env.TOCHKA_CLIENT_ID;
const TOCHKA_API_KEY = process.env.TOCHKA_API_KEY;
const TOCHKA_API_URL = process.env.TOCHKA_API_URL || 'https://api.tochka.com';
const PAYMENT_CALLBACK_URL = process.env.PAYMENT_CALLBACK_URL;

async function registerWebhook() {
    if (!TOCHKA_CLIENT_ID || !TOCHKA_API_KEY || !PAYMENT_CALLBACK_URL) {
        console.error('❌ Отсутствуют обязательные переменные окружения:');
        console.error('  - TOCHKA_CLIENT_ID:', TOCHKA_CLIENT_ID ? '✓' : '✗');
        console.error('  - TOCHKA_API_KEY:', TOCHKA_API_KEY ? '✓' : '✗');
        console.error('  - PAYMENT_CALLBACK_URL:', PAYMENT_CALLBACK_URL ? '✓' : '✗');
        process.exit(1);
    }

    console.log('🔧 Регистрация вебхука в Точка Банке...');
    console.log('');
    console.log('Параметры:');
    console.log(`  Client ID: ${TOCHKA_CLIENT_ID}`);
    console.log(`  Callback URL: ${PAYMENT_CALLBACK_URL}`);
    console.log(`  API URL: ${TOCHKA_API_URL}`);
    console.log('');

    const requestBody = {
        webhooksList: ['acquiringInternetPayment'],
        url: PAYMENT_CALLBACK_URL
    };

    console.log('📤 Отправляю PUT запрос...');
    console.log('Body:', JSON.stringify(requestBody, null, 2));
    console.log('');

    try {
        // Согласно ответу техподдержки Точка Банка:
        // Правильный URL: https://enter.tochka.com/uapi/webhook/v1.0/{client_id}
        // Метод: PUT
        // Авторизация: Authorization: Bearer {JWT_TOKEN}
        // Тело запроса: { webhooksList: ['acquiringInternetPayment'], url: '...' }
        
        const webhookUrl = `https://enter.tochka.com/uapi/webhook/v1.0/${TOCHKA_CLIENT_ID}`;
        
        console.log(`📤 Отправляю PUT запрос на: ${webhookUrl}`);
        console.log('');
        
        const axiosConfig = {
            headers: {
                'Authorization': `Bearer ${TOCHKA_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        };
        
        const response = await axios.put(webhookUrl, requestBody, axiosConfig);
        
        if (response.status === 200 || response.status === 201 || response.status === 204) {
            console.log('✅ Вебхук успешно зарегистрирован!');
            console.log('');
            if (response.data) {
                console.log('Ответ от банка:');
                console.log(JSON.stringify(response.data, null, 2));
                console.log('');
            }
            console.log('ℹ️  Банк отправит тестовый вебхук на указанный URL.');
            console.log('   Проверьте логи сервера, чтобы убедиться, что он принят (HTTP 200).');
            return response;
        } else {
            throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
        }

    } catch (error) {
        console.error('❌ Ошибка регистрации вебхука:');
        
        if (error.response) {
            console.error('');
            console.error('Статус:', error.response.status);
            console.error('Ответ:', JSON.stringify(error.response.data, null, 2));
            console.error('');
            
            if (error.response.status === 400) {
                console.error('💡 Возможные причины:');
                console.error('   - URL недоступен (банк не смог достучаться)');
                console.error('   - Endpoint не вернул HTTP 200 на тестовый вебхук');
                console.error('   - Неверный формат URL');
                console.error('');
                console.error('🔍 Проверьте:');
                console.error(`   1. Доступен ли ${PAYMENT_CALLBACK_URL} извне?`);
                console.error('   2. Работает ли сервер?');
                console.error('   3. Отвечает ли endpoint 200 OK?');
            } else if (error.response.status === 401) {
                console.error('💡 Проблема с авторизацией:');
                console.error('   - Проверьте TOCHKA_API_KEY');
                console.error('   - Проверьте TOCHKA_CLIENT_ID');
            }
        } else {
            console.error('');
            console.error(error.message);
        }
        
        process.exit(1);
    }
}

// Запуск
registerWebhook()
    .then(() => {
        console.log('');
        console.log('🎉 Готово! Вебхук зарегистрирован.');
        console.log('');
        console.log('📋 Следующие шаги:');
        console.log('   1. Создайте тестовый платеж');
        console.log('   2. Проверьте, что вебхук приходит и обрабатывается');
        console.log('   3. Проверьте таблицу webhook_logs в БД');
        process.exit(0);
    })
    .catch(err => {
        console.error('Критическая ошибка:', err.message);
        process.exit(1);
    });

