/**
 * Планировщик задач для автоматической отправки уведомлений
 * Использует node-cron для запуска задач по расписанию
 */

const cron = require('node-cron');
const notificationService = require('./notification-service');

class Scheduler {
    constructor() {
        this.tasks = [];
    }

    /**
     * Инициализирует все запланированные задачи
     */
    init() {
        console.log('Инициализация планировщика задач...');
        
        // Запускаем задачу отправки напоминаний о тренировках
        this.scheduleTrainingReminders();
        
        console.log(`Планировщик запущен. Активных задач: ${this.tasks.length}`);
    }

    /**
     * Настраивает задачу отправки напоминаний о тренировках
     * Запускается каждый день в 21:00 по времени Екатеринбурга (UTC+5)
     */
    scheduleTrainingReminders() {
        // Время в UTC для 21:00 Екатеринбурга: 21:00 - 5:00 = 16:00 UTC
        // Но для надежности используем timezone в cron
        const task = cron.schedule('0 21 * * *', async () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: отправка напоминаний о тренировках`);
                
                const stats = await notificationService.sendTomorrowReminders();
                
                console.log(`[${new Date().toISOString()}] Задача завершена. Отправлено: ${stats.sent}, Ошибок: ${stats.failed}`);
                
                // Отправляем отчет администратору
                await this.notifyAdmin(stats, tomorrow);
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при выполнении задачи отправки напоминаний:`, error);
                
                // Уведомляем администратора об ошибке
                await this.notifyAdminError(error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'training_reminders',
            description: 'Отправка напоминаний о тренировках на завтра',
            schedule: '0 21 * * * (Екатеринбург)',
            task: task
        });

        console.log('✓ Задача "Напоминания о тренировках" настроена на 21:00 (Екатеринбург)');
    }

    /**
     * Останавливает все задачи
     */
    stopAll() {
        console.log('Остановка всех задач планировщика...');
        this.tasks.forEach(taskInfo => {
            taskInfo.task.stop();
        });
        console.log('Все задачи остановлены');
    }

    /**
     * Возвращает информацию о всех задачах
     */
    getTasksInfo() {
        return this.tasks.map(taskInfo => ({
            name: taskInfo.name,
            description: taskInfo.description,
            schedule: taskInfo.schedule,
            running: taskInfo.task.running
        }));
    }

    /**
     * Тестовый запуск отправки напоминаний (для отладки)
     * Можно вызвать вручную для проверки
     */
    async testTrainingReminders() {
        console.log('Тестовый запуск отправки напоминаний...');
        try {
            const stats = await notificationService.sendTomorrowReminders();
            console.log('Результаты:', stats);
            return stats;
        } catch (error) {
            console.error('Ошибка при тестовом запуске:', error);
            throw error;
        }
    }

    /**
     * Отправляет администратору отчет о результатах отправки
     * @param {Object} stats - Статистика отправки
     * @param {Date} targetDate - Дата тренировок
     */
    async notifyAdmin(stats, targetDate) {
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
            console.log('✓ Отчет отправлен администратору');
        } catch (error) {
            console.error('Ошибка при отправке отчета администратору:', error.message);
        }
    }

    /**
     * Отправляет администратору уведомление об ошибке
     * @param {Error} error - Объект ошибки
     */
    async notifyAdminError(error) {
        if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
            return;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let message = `⚠️ <b>Ошибка при отправке напоминаний о тренировках</b>\n\n`;
            message += `<code>${error.message}</code>\n\n`;
            message += `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
            console.log('✓ Уведомление об ошибке отправлено администратору');
        } catch (notifyError) {
            console.error('Ошибка при отправке уведомления об ошибке администратору:', notifyError.message);
        }
    }
}

module.exports = new Scheduler();

