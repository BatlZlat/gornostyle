#!/usr/bin/env node

/**
 * Скрипт для тестирования отправки email через Unisender API
 * Использование: node scripts/test-unisender.js <email_получателя>
 */

require('dotenv').config();
const UnisenderEmailService = require('../src/services/unisenderEmailService');

async function main() {
    const recipientEmail = process.argv[2];

    if (!recipientEmail) {
        console.error('❌ Ошибка: Укажите email получателя');
        console.log('Использование: node scripts/test-unisender.js <email_получателя>');
        console.log('');
        console.log('⚠️  ВАЖНО: На бесплатном тарифе Unisender можно отправлять только на');
        console.log('   подтвержденные email адреса в вашем аккаунте!');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('📧 Тест отправки email через Unisender API');
    console.log('═══════════════════════════════════════════════════════\n');

    // Проверка переменных окружения
    console.log('🔍 Проверка конфигурации...');
    console.log(`UNISENDER_API_KEY: ${process.env.UNISENDER_API_KEY ? '✅ Настроен' : '❌ Не настроен'}`);
    console.log(`UNISENDER_FROM_EMAIL: ${process.env.UNISENDER_FROM_EMAIL || 'используется по умолчанию'}`);
    console.log(`UNISENDER_FROM_NAME: ${process.env.UNISENDER_FROM_NAME || 'используется по умолчанию'}`);
    console.log('');

    if (!process.env.UNISENDER_API_KEY) {
        console.error('❌ Ошибка: UNISENDER_API_KEY не настроен в .env файле');
        process.exit(1);
    }

    // Создаем сервис
    const unisenderService = new UnisenderEmailService();

    if (!unisenderService.apiKey) {
        console.error('❌ Ошибка: Unisender не инициализирован');
        process.exit(1);
    }

    // Тестовое HTML содержимое
    const testHTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Тестовое письмо</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f8f9fa; font-family: Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background: white; border-radius: 15px; overflow: hidden;">
        <tr>
            <td style="padding: 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                <h1 style="margin: 0; font-size: 1.8rem;">✅ Тестовое письмо</h1>
                <p style="margin: 10px 0 0 0; font-size: 1rem; opacity: 0.9;">Unisender работает!</p>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 1.1rem;">
                    Здравствуйте!
                </p>
                <p style="margin: 0 0 20px 0; color: #555; font-size: 1rem; line-height: 1.6;">
                    Это тестовое письмо для проверки работы Unisender API.
                </p>
                <p style="margin: 0 0 20px 0; color: #555; font-size: 1rem; line-height: 1.6;">
                    Если вы получили это письмо, значит интеграция работает правильно! 🎉
                </p>
                <p style="margin: 20px 0 0 0; color: #999; font-size: 0.9rem;">
                    Дата отправки: ${new Date().toLocaleString('ru-RU')}
                </p>
            </td>
        </tr>
        <tr>
            <td style="padding: 20px 30px; text-align: center; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <p style="margin: 0 0 10px 0; color: #7f8c8d; font-size: 0.9rem;">
                    С уважением,<br>Команда Горностайл72 🎿
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    const subject = '✅ Тестовое письмо от Unisender API';

    console.log(`📧 Отправка тестового письма на ${recipientEmail}...`);
    console.log('');

    try {
        const result = await unisenderService.sendEmail(recipientEmail, subject, testHTML);

        if (result.success) {
            console.log('═══════════════════════════════════════════════════════');
            console.log('✅ УСПЕХ! Письмо отправлено через Unisender');
            console.log('═══════════════════════════════════════════════════════');
            console.log(`📧 Email получателя: ${recipientEmail}`);
            console.log(`🆔 Message ID: ${result.messageId}`);
            console.log(`🔧 Сервис: ${result.service}`);
            console.log('');
            console.log('💡 Проверьте папку "Входящие" (и "Спам") на почте получателя');
        } else {
            console.log('═══════════════════════════════════════════════════════');
            console.log('❌ ОШИБКА при отправке письма');
            console.log('═══════════════════════════════════════════════════════');
            console.log(`Ошибка: ${result.error}`);
            process.exit(1);
        }
    } catch (error) {
        console.log('═══════════════════════════════════════════════════════');
        console.log('❌ ИСКЛЮЧЕНИЕ при отправке письма');
        console.log('═══════════════════════════════════════════════════════');
        console.error(`Ошибка: ${error.message}`);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
});

