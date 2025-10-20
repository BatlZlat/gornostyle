/**
 * Скрипт для отправки запросов на отзывы клиентам
 * Запускается ежедневно в 21:00 через cron
 * Отправляет уведомления клиентам, которые тренировались сегодня
 */

require('dotenv').config();
const reviewNotificationService = require('../services/review-notification-service');
const moment = require('moment-timezone');

/**
 * Отправляет администратору отчет об отправке запросов на отзывы
 * @param {Object} stats - Статистика отправки
 * @param {Date} targetDate - Дата тренировок
 */
async function notifyAdminReviews(stats, targetDate) {
    if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
        console.log('ADMIN_TELEGRAM_ID или ADMIN_BOT_TOKEN не указаны в .env - пропускаем уведомление администратора');
        return;
    }

    try {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
        
        let message = `📊 <b>Отчет об отправке запросов на отзывы</b>\n\n`;
        message += `📅 Дата тренировок: ${targetDate.toISOString().split('T')[0]}\n`;
        message += `👥 Клиентов обработано: ${stats.total_clients}\n`;
        message += `✅ Отправлено: ${stats.sent}\n`;
        message += `⏭️ Пропущено (все отзывы оставлены): ${stats.skipped_no_links}\n`;
        message += `❌ Ошибок: ${stats.failed}\n\n`;
        
        if (stats.errors && stats.errors.length > 0) {
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
        console.log('✓ Отчет об отзывах отправлен администратору');
    } catch (error) {
        console.error('Ошибка при отправке отчета об отзывах администратору:', error.message);
    }
}

async function main() {
    try {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  Запуск отправки запросов на отзывы');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Время запуска: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })} (Екатеринбург)`);
        console.log('');

        let targetDate;

        // Проверяем, передана ли дата в аргументах (для тестирования)
        if (process.argv[2]) {
            targetDate = new Date(process.argv[2]);
            console.log(`Отправка запросов для даты: ${targetDate.toISOString().split('T')[0]}`);
        } else {
            // По умолчанию - сегодня
            targetDate = new Date();
            console.log(`Отправка запросов за сегодня: ${targetDate.toISOString().split('T')[0]}`);
        }

        console.log('');

        // Отправляем запросы на отзывы
        const stats = await reviewNotificationService.sendReviewRequests(targetDate);

        // Отправляем отчет администратору
        await notifyAdminReviews(stats, targetDate);

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  Статистика отправки');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Всего клиентов обработано: ${stats.total_clients}`);
        console.log(`✅ Успешно отправлено: ${stats.sent}`);
        console.log(`⏭️  Пропущено (все отзывы оставлены): ${stats.skipped_no_links}`);
        console.log(`❌ Ошибок: ${stats.failed}`);
        
        if (stats.errors.length > 0) {
            console.log('');
            console.log('Детали ошибок:');
            stats.errors.forEach((err, index) => {
                console.log(`  ${index + 1}. Клиент: ${err.client_name} (ID: ${err.client_id})`);
                console.log(`     Ошибка: ${err.error}`);
            });
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Завершено: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`);
        console.log('═══════════════════════════════════════════════════════════');

        process.exit(0);
    } catch (error) {
        console.error('');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('  КРИТИЧЕСКАЯ ОШИБКА');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(error);
        console.error('═══════════════════════════════════════════════════════════');
        process.exit(1);
    }
}

// Запускаем скрипт
main();

