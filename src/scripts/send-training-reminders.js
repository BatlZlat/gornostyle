#!/usr/bin/env node

/**
 * Скрипт для отправки напоминаний о тренировках
 * Запускается по расписанию (cron) каждый день в 21:00
 * 
 * Использование:
 * node src/scripts/send-training-reminders.js
 * 
 * Или с указанием конкретной даты:
 * node src/scripts/send-training-reminders.js 2025-10-10
 */

require('dotenv').config();
const notificationService = require('../services/notification-service');

async function main() {
    try {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  Запуск отправки напоминаний о тренировках');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Время запуска: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })} (Екатеринбург)`);
        console.log('');

        let targetDate;

        // Проверяем, передана ли дата в аргументах
        if (process.argv[2]) {
            targetDate = new Date(process.argv[2]);
            console.log(`Отправка напоминаний для даты: ${targetDate.toISOString().split('T')[0]}`);
        } else {
            // По умолчанию - завтра
            targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + 1);
            console.log(`Отправка напоминаний на завтра: ${targetDate.toISOString().split('T')[0]}`);
        }

        console.log('');

        // Отправляем напоминания
        const stats = await notificationService.sendTrainingReminders(targetDate);

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  Статистика отправки');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Всего клиентов:     ${stats.total_clients}`);
        console.log(`Успешно отправлено: ${stats.sent}`);
        console.log(`Ошибок:             ${stats.failed}`);
        console.log('');

        if (stats.errors.length > 0) {
            console.log('Детали ошибок:');
            stats.errors.forEach((error, index) => {
                console.log(`  ${index + 1}. Клиент: ${error.client_name} (ID: ${error.client_id})`);
                console.log(`     Ошибка: ${error.error}`);
            });
            console.log('');
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Завершено: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`);
        console.log('═══════════════════════════════════════════════════════════');

        // Уведомляем администратора о результатах (опционально)
        if (process.env.ADMIN_TELEGRAM_ID && process.env.TELEGRAM_BOT_TOKEN) {
            await notifyAdmin(stats, targetDate);
        }

        process.exit(0);

    } catch (error) {
        console.error('');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('  КРИТИЧЕСКАЯ ОШИБКА');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(error);
        console.error('═══════════════════════════════════════════════════════════');
        
        // Уведомляем администратора об ошибке
        if (process.env.ADMIN_TELEGRAM_ID && process.env.ADMIN_BOT_TOKEN) {
            try {
                const TelegramBot = require('node-telegram-bot-api');
                const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
                await bot.sendMessage(
                    process.env.ADMIN_TELEGRAM_ID,
                    `⚠️ <b>Ошибка при отправке напоминаний о тренировках</b>\n\n` +
                    `<code>${error.message}</code>\n\n` +
                    `Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`,
                    { parse_mode: 'HTML' }
                );
            } catch (notifyError) {
                console.error('Не удалось уведомить администратора:', notifyError);
            }
        }

        process.exit(1);
    }
}

/**
 * Отправляет администратору сводку о результатах отправки
 */
async function notifyAdmin(stats, targetDate) {
    if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
        console.log('ADMIN_TELEGRAM_ID или ADMIN_BOT_TOKEN не указаны в .env - пропускаем уведомление администратора');
        return;
    }

    try {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
        
        let message = `📊 <b>Отчет об отправке напоминаний</b>\n\n`;
        message += `📅 Дата тренировок: ${targetDate.toISOString().split('T')[0]}\n`;
        message += `👥 Клиентов: ${stats.total_clients}\n`;
        message += `✅ Отправлено: ${stats.sent}\n`;
        message += `❌ Ошибок: ${stats.failed}\n\n`;
        
        if (stats.errors.length > 0) {
            message += `<b>Ошибки:</b>\n`;
            stats.errors.slice(0, 5).forEach((error, index) => {
                message += `${index + 1}. ${error.client_name} - ${error.error}\n`;
            });
            if (stats.errors.length > 5) {
                message += `... и еще ${stats.errors.length - 5}\n`;
            }
        }
        
        message += `\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Ошибка при отправке отчета администратору:', error);
    }
}

// Запуск
main();

