/**
 * Скрипт для проверки разрешений и тестирования создания платежа
 * 
 * Запуск: node scripts/test-tochka-consent-check.js
 */

require('dotenv').config();
const axios = require('axios');

const TOCHKA_API_KEY = process.env.TOCHKA_API_KEY;
const TOCHKA_CLIENT_ID = process.env.TOCHKA_CLIENT_ID;
const TOCHKA_CUSTOMER_CODE = process.env.TOCHKA_CUSTOMER_CODE;

if (!TOCHKA_API_KEY || !TOCHKA_CLIENT_ID || !TOCHKA_CUSTOMER_CODE) {
    console.error('❌ Отсутствуют обязательные переменные окружения');
    process.exit(1);
}

async function checkConsents() {
    console.log('🔍 Шаг 1: Проверка разрешений...\n');
    
    try {
        const response = await axios.get(
            'https://enter.tochka.com/uapi/consent/v1.0/consents',
            {
                headers: {
                    'Authorization': `Bearer ${TOCHKA_API_KEY}`,
                    'Accept': 'application/json',
                    'customer-code': TOCHKA_CUSTOMER_CODE
                }
            }
        );

        const consents = response.data?.Data?.Consent || [];
        console.log(`📋 Найдено разрешений: ${consents.length}\n`);

        const acquiringConsents = consents.filter(c => 
            c.permissions?.includes('MakeAcquiringOperation')
        );

        if (acquiringConsents.length === 0) {
            console.log('❌ Разрешение MakeAcquiringOperation НЕ НАЙДЕНО\n');
            console.log('💡 Нужно создать разрешение через личный кабинет или API\n');
            return false;
        }

        const validConsents = acquiringConsents.filter(c => 
            c.status === 'Authorised' && c.isValid
        );

        if (validConsents.length === 0) {
            console.log('⚠️  Разрешение найдено, но не авторизовано или истекло\n');
            acquiringConsents.forEach(c => {
                console.log(`   Consent ID: ${c.consentId}`);
                console.log(`   Статус: ${c.status}`);
                console.log(`   Действителен: ${c.isValid ? '✅' : '❌'}\n`);
            });
            return false;
        }

        console.log('✅ Найдено валидных разрешений MakeAcquiringOperation:', validConsents.length);
        validConsents.forEach(c => {
            console.log(`   Consent ID: ${c.consentId}`);
            console.log(`   Статус: ${c.status}`);
            console.log(`   Истекает: ${c.expirationDateTime || 'Не указано'}\n`);
        });
        return true;

    } catch (error) {
        console.error('❌ Ошибка при проверке разрешений:');
        if (error.response) {
            console.error(`   Статус: ${error.response.status}`);
            console.error(`   Ответ: ${JSON.stringify(error.response.data, null, 2)}\n`);
        } else {
            console.error(`   Ошибка: ${error.message}\n`);
        }
        return false;
    }
}

async function testPayment() {
    console.log('🧪 Шаг 2: Тестирование создания платежа...\n');

    const requestBody = {
        Data: {
            customerCode: TOCHKA_CUSTOMER_CODE,
            amount: 1.00, // Минимальная сумма для теста
            purpose: 'Тестовый платеж',
            paymentMode: ['card'],
            paymentLinkId: `test-${Date.now()}`,
            redirectUrl: 'https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking/success',
            failRedirectUrl: 'https://gornostyle72.ru/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking/fail'
        }
    };

    try {
        console.log('📤 Отправляю запрос...');
        console.log('   Endpoint: https://enter.tochka.com/uapi/acquiring/v1.0/payments');
        console.log('   Body:', JSON.stringify(requestBody, null, 2));
        console.log('');

        const response = await axios.post(
            'https://enter.tochka.com/uapi/acquiring/v1.0/payments',
            requestBody,
            {
                headers: {
                    'Authorization': `Bearer ${TOCHKA_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000
            }
        );

        console.log('✅ Платеж успешно создан!');
        console.log('   Operation ID:', response.data?.Data?.operationId);
        console.log('   Payment Link:', response.data?.Data?.paymentLink);
        console.log('   Status:', response.data?.Data?.status);
        return true;

    } catch (error) {
        console.error('❌ Ошибка создания платежа:');
        if (error.response) {
            console.error(`   Статус: ${error.response.status}`);
            console.error(`   Ответ: ${JSON.stringify(error.response.data, null, 2)}`);
            
            if (error.response.data?.Errors) {
                console.error('\n   Детали ошибки:');
                error.response.data.Errors.forEach(err => {
                    console.error(`   - ${err.errorCode}: ${err.message}`);
                });
            }
        } else {
            console.error(`   Ошибка: ${error.message}`);
        }
        return false;
    }
}

async function main() {
    console.log('🚀 Проверка настроек Точка Банк API\n');
    console.log(`   Customer Code: ${TOCHKA_CUSTOMER_CODE}`);
    console.log(`   Client ID: ${TOCHKA_CLIENT_ID}\n`);
    console.log('='.repeat(50));
    console.log('');

    const hasConsent = await checkConsents();
    
    console.log('='.repeat(50));
    console.log('');

    if (hasConsent) {
        await testPayment();
    } else {
        console.log('⚠️  Пропускаю тест платежа - нет валидного разрешения');
        console.log('   Сначала нужно создать и подтвердить разрешение MakeAcquiringOperation');
    }

    console.log('');
    console.log('='.repeat(50));
    console.log('✅ Проверка завершена');
}

main().catch(console.error);

