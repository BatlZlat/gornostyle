#!/usr/bin/env node

/**
 * Тестовый скрипт для отправки уведомления одному конкретному клиенту
 * Использование: node src/scripts/test-single-notification.js <client_id> <date>
 */

require('dotenv').config();
const notificationService = require('../services/notification-service');
const { pool } = require('../db');

async function testSingleNotification() {
    try {
        const clientId = process.argv[2] || 91; // По умолчанию ID 91 (Тестировщик)
        const dateStr = process.argv[3] || new Date(Date.now() + 86400000).toISOString().split('T')[0]; // Завтра

        console.log('═══════════════════════════════════════════════════════════');
        console.log('  Тест отправки уведомления одному клиенту');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Клиент ID: ${clientId}`);
        console.log(`Дата тренировок: ${dateStr}`);
        console.log('');

        // Получаем все тренировки на дату
        const date = new Date(dateStr);
        const trainings = await notificationService.getTrainingsByDate(date);

        // Фильтруем только для нужного клиента
        const clientTrainings = trainings.filter(t => t.client_id == clientId);

        if (clientTrainings.length === 0) {
            console.log(`❌ У клиента ${clientId} нет тренировок на ${dateStr}`);
            process.exit(0);
        }

        console.log(`✅ Найдено тренировок: ${clientTrainings.length}\n`);

        // Группируем
        const grouped = notificationService.groupTrainingsByClient(clientTrainings);
        const clientData = grouped[clientId];

        console.log('--- Информация о клиенте ---');
        console.log(`Имя: ${clientData.client_name}`);
        console.log(`Telegram ID: ${clientData.telegram_id}`);
        console.log(`Количество тренировок: ${clientData.trainings.length}`);
        console.log('');

        // Формируем сообщение
        const message = notificationService.formatNotificationMessage(clientData, date);

        console.log('--- Сообщение для отправки ---');
        console.log(message);
        console.log('');
        console.log('─'.repeat(60));
        console.log('');

        // Отправляем
        console.log('Отправка...');
        const result = await notificationService.sendNotification(clientData.telegram_id, message);

        if (result.success) {
            console.log('✅ УСПЕШНО ОТПРАВЛЕНО!');
            
            // Логируем
            await notificationService.logNotification(
                parseInt(clientId),
                clientData.telegram_id,
                date,
                message,
                'sent'
            );
        } else {
            console.log('❌ ОШИБКА:', result.error);
            
            // Логируем
            await notificationService.logNotification(
                parseInt(clientId),
                clientData.telegram_id,
                date,
                message,
                'failed',
                result.error
            );
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        
        process.exit(0);

    } catch (error) {
        console.error('❌ ОШИБКА:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

testSingleNotification();

