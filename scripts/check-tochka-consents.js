/**
 * Скрипт для проверки разрешений (consents) в Точка Банке
 * 
 * Проверяет, есть ли разрешение MakeAcquiringOperation для создания платежей
 */

require('dotenv').config();
const axios = require('axios');

const TOCHKA_API_KEY = process.env.TOCHKA_API_KEY;
const TOCHKA_CLIENT_ID = process.env.TOCHKA_CLIENT_ID;
const TOCHKA_CUSTOMER_CODE = process.env.TOCHKA_CUSTOMER_CODE;

if (!TOCHKA_API_KEY || !TOCHKA_CLIENT_ID || !TOCHKA_CUSTOMER_CODE) {
    console.error('❌ Отсутствуют обязательные переменные окружения:');
    console.error('   TOCHKA_API_KEY:', TOCHKA_API_KEY ? '✅' : '❌');
    console.error('   TOCHKA_CLIENT_ID:', TOCHKA_CLIENT_ID ? '✅' : '❌');
    console.error('   TOCHKA_CUSTOMER_CODE:', TOCHKA_CUSTOMER_CODE ? '✅' : '❌');
    process.exit(1);
}

async function checkConsents() {
    try {
        console.log('🔍 Проверяю разрешения в Точка Банке...');
        console.log(`   Customer Code: ${TOCHKA_CUSTOMER_CODE}`);
        console.log(`   Client ID: ${TOCHKA_CLIENT_ID}`);
        console.log('');

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

        const data = response.data;
        
        if (!data || !data.Data || !data.Data.Consent) {
            console.log('⚠️  Разрешения не найдены');
            return;
        }

        const consents = data.Data.Consent;
        console.log(`📋 Найдено разрешений: ${consents.length}`);
        console.log('');

        // Ищем разрешение MakeAcquiringOperation
        const acquiringConsents = consents.filter(consent => 
            consent.permissions && consent.permissions.includes('MakeAcquiringOperation')
        );

        if (acquiringConsents.length === 0) {
            console.log('❌ Разрешение MakeAcquiringOperation НЕ НАЙДЕНО');
            console.log('');
            console.log('📝 Доступные разрешения:');
            consents.forEach((consent, index) => {
                console.log(`   ${index + 1}. Consent ID: ${consent.consentId}`);
                console.log(`      Статус: ${consent.status}`);
                console.log(`      Разрешения: ${consent.permissions.join(', ')}`);
                console.log(`      Действителен: ${consent.isValid ? '✅' : '❌'}`);
                console.log(`      Истекает: ${consent.expirationDateTime || 'Не указано'}`);
                console.log('');
            });
            console.log('💡 Нужно создать разрешение MakeAcquiringOperation');
            return;
        }

        console.log('✅ Найдено разрешений с MakeAcquiringOperation:', acquiringConsents.length);
        console.log('');

        acquiringConsents.forEach((consent, index) => {
            console.log(`📄 Разрешение #${index + 1}:`);
            console.log(`   Consent ID: ${consent.consentId}`);
            console.log(`   Статус: ${consent.status}`);
            console.log(`   Действителен: ${consent.isValid ? '✅' : '❌'}`);
            console.log(`   Истекает: ${consent.expirationDateTime || 'Не указано'}`);
            console.log(`   Создано: ${consent.creationDateTime || 'Не указано'}`);
            console.log('');

            if (consent.status !== 'Authorised') {
                console.log(`   ⚠️  ВНИМАНИЕ: Статус разрешения "${consent.status}", а должен быть "Authorised"`);
                console.log('   Нужно подтвердить разрешение в личном кабинете Точка Банка');
                console.log('');
            }

            if (!consent.isValid) {
                console.log('   ⚠️  ВНИМАНИЕ: Разрешение недействительно (истек срок)');
                console.log('');
            }
        });

        // Проверяем, есть ли хотя бы одно валидное и авторизованное разрешение
        const validConsents = acquiringConsents.filter(consent => 
            consent.status === 'Authorised' && consent.isValid
        );

        if (validConsents.length === 0) {
            console.log('❌ Нет валидных и авторизованных разрешений MakeAcquiringOperation');
            console.log('   Нужно создать новое разрешение или подтвердить существующее');
        } else {
            console.log(`✅ Найдено валидных разрешений: ${validConsents.length}`);
            console.log('   Можно создавать платежи!');
        }

    } catch (error) {
        console.error('❌ Ошибка при проверке разрешений:');
        if (error.response) {
            console.error(`   Статус: ${error.response.status}`);
            console.error(`   Ответ: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`   Ошибка: ${error.message}`);
        }
        process.exit(1);
    }
}

checkConsents();

