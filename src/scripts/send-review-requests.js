/**
 * Скрипт для отправки запросов на отзывы клиентам
 * Запускается ежедневно в 21:00 через cron
 * Отправляет уведомления клиентам, которые тренировались сегодня
 */

require('dotenv').config();
const reviewNotificationService = require('../services/review-notification-service');

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

