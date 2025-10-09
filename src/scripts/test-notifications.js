#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки системы уведомлений
 * 
 * Использование:
 * 1. Проверить уведомления на завтра:
 *    node src/scripts/test-notifications.js
 * 
 * 2. Проверить уведомления на конкретную дату:
 *    node src/scripts/test-notifications.js 2025-10-15
 * 
 * 3. Тестовый запуск (без реальной отправки):
 *    node src/scripts/test-notifications.js --dry-run
 */

require('dotenv').config();
const notificationService = require('../services/notification-service');
const { pool } = require('../db');

async function testNotifications() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Тестирование системы уведомлений');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // Определяем дату для тестирования
        let targetDate;
        const dryRun = process.argv.includes('--dry-run');

        if (process.argv[2] && !process.argv[2].startsWith('--')) {
            targetDate = new Date(process.argv[2]);
            console.log(`📅 Целевая дата: ${targetDate.toISOString().split('T')[0]}`);
        } else {
            targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + 1);
            console.log(`📅 Целевая дата: завтра (${targetDate.toISOString().split('T')[0]})`);
        }

        if (dryRun) {
            console.log('🧪 РЕЖИМ ТЕСТИРОВАНИЯ (без реальной отправки)\n');
        }

        console.log('\n--- Шаг 1: Получение тренировок ---\n');
        const trainings = await notificationService.getTrainingsByDate(targetDate);

        if (trainings.length === 0) {
            console.log('❌ Нет тренировок на указанную дату');
            process.exit(0);
        }

        console.log(`✅ Найдено записей на тренировки: ${trainings.length}\n`);
        
        // Выводим информацию о тренировках
        console.log('Список тренировок:');
        trainings.forEach((training, index) => {
            console.log(`\n${index + 1}. ${training.start_time} - ${training.end_time}`);
            console.log(`   Тип: ${training.training_type === 'group' ? 'Групповая' : 'Индивидуальная'}`);
            console.log(`   Участник: ${training.display_name}`);
            console.log(`   Клиент: ${training.client_name} (ID: ${training.client_id})`);
            console.log(`   Telegram ID: ${training.telegram_id || 'НЕТ'}`);
        });

        console.log('\n--- Шаг 2: Группировка по клиентам ---\n');
        const groupedByClient = notificationService.groupTrainingsByClient(trainings);
        const clientIds = Object.keys(groupedByClient);

        console.log(`✅ Уникальных клиентов: ${clientIds.length}\n`);

        // Выводим информацию по клиентам
        clientIds.forEach((clientId, index) => {
            const clientData = groupedByClient[clientId];
            console.log(`${index + 1}. Клиент: ${clientData.client_name} (ID: ${clientId})`);
            console.log(`   Telegram ID: ${clientData.telegram_id}`);
            console.log(`   Количество тренировок: ${clientData.trainings.length}`);
            clientData.trainings.forEach((training, tIndex) => {
                console.log(`   ${tIndex + 1}) ${training.start_time} - ${training.display_name}`);
            });
            console.log('');
        });

        console.log('--- Шаг 3: Формирование сообщений ---\n');

        for (const [clientId, clientData] of Object.entries(groupedByClient)) {
            console.log(`\n┌─────────────────────────────────────────────────────────┐`);
            console.log(`│ Клиент: ${clientData.client_name}`);
            console.log(`└─────────────────────────────────────────────────────────┘\n`);
            
            const message = notificationService.formatNotificationMessage(clientData, targetDate);
            console.log(message);
            console.log('\n' + '─'.repeat(60) + '\n');
        }

        if (!dryRun) {
            console.log('--- Шаг 4: Отправка уведомлений ---\n');
            console.log('Начинаем отправку...\n');

            const stats = await notificationService.sendTrainingReminders(targetDate);

            console.log('\n═══════════════════════════════════════════════════════════');
            console.log('  ИТОГОВАЯ СТАТИСТИКА');
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`Всего клиентов:     ${stats.total_clients}`);
            console.log(`Успешно отправлено: ${stats.sent}`);
            console.log(`Ошибок:             ${stats.failed}`);

            if (stats.errors.length > 0) {
                console.log('\nОшибки:');
                stats.errors.forEach((error, index) => {
                    console.log(`  ${index + 1}. ${error.client_name} (ID: ${error.client_id})`);
                    console.log(`     ${error.error}`);
                });
            }
            console.log('═══════════════════════════════════════════════════════════\n');
        } else {
            console.log('--- Тестирование завершено ---\n');
            console.log('💡 Для реальной отправки запустите без флага --dry-run\n');
        }

        process.exit(0);

    } catch (error) {
        console.error('\n❌ ОШИБКА:', error);
        console.error('\nStack trace:', error.stack);
        process.exit(1);
    } finally {
        // Закрываем соединение с БД
        await pool.end();
    }
}

// Запуск
testNotifications();

