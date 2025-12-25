#!/usr/bin/env node

/**
 * Скрипт для проверки подключения к SMTP Yandex
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

async function testSMTP() {
    console.log('🔍 Проверка подключения к SMTP Yandex...\n');
    
    const transporter = nodemailer.createTransport({
        host: 'smtp.yandex.ru',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER || 'batl-zlat@yandex.ru',
            pass: process.env.EMAIL_PASS || ''
        },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 60000,
        tls: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('📧 Проверка соединения...');
        await transporter.verify();
        console.log('✅ SMTP сервер готов к отправке писем!\n');
        
        console.log('📤 Попытка отправить тестовое письмо...');
        const testEmail = process.env.EMAIL_USER || 'batl-zlat@yandex.ru';
        const info = await transporter.sendMail({
            from: {
                name: 'Горностайл72',
                address: process.env.EMAIL_USER || 'batl-zlat@yandex.ru'
            },
            to: testEmail,
            subject: 'Тестовое письмо',
            text: 'Это тестовое письмо для проверки SMTP',
            html: '<p>Это тестовое письмо для проверки SMTP</p>'
        });
        
        console.log('✅ Письмо отправлено успешно!');
        console.log('Message ID:', info.messageId);
        console.log('Response:', info.response);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('Код ошибки:', error.code);
        if (error.response) {
            console.error('Ответ сервера:', error.response);
        }
        if (error.responseCode) {
            console.error('Код ответа:', error.responseCode);
        }
        process.exit(1);
    } finally {
        transporter.close();
    }
}

testSMTP().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
});

