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
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: отправка напоминаний о тренировках`);
                
                const stats = await notificationService.sendTomorrowReminders();
                
                console.log(`[${new Date().toISOString()}] Задача завершена. Отправлено: ${stats.sent}, Ошибок: ${stats.failed}`);
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при выполнении задачи отправки напоминаний:`, error);
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
}

module.exports = new Scheduler();

