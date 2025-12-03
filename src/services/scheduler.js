/**
 * Планировщик задач для автоматической отправки уведомлений
 * Использует node-cron для запуска задач по расписанию
 */

const cron = require('node-cron');
const notificationService = require('./notification-service');
const reviewNotificationService = require('./review-notification-service');
const scheduledMessagesService = require('./scheduled-messages-service');
const programTrainingsGenerator = require('./program-trainings-generator');

class Scheduler {
    constructor() {
        this.tasks = [];
        this.isRunning = {
            trainingReminders: false,
            reviewRequests: false,
            statusUpdates: false,
            scheduledMessages: false,
            programTrainingsGeneration: false
        };
    }

    /**
     * Инициализирует все запланированные задачи
     */
    init() {
        console.log('Инициализация планировщика задач...');
        
        // Запускаем задачу отправки напоминаний о тренировках
        this.scheduleTrainingReminders();
        
        // Запускаем задачу отправки запросов на отзывы
        this.scheduleReviewRequests();
        
        // Запускаем задачу обновления статусов тренировок
        this.scheduleStatusUpdates();
        
        // Запускаем задачу отправки отложенных сообщений
        this.scheduleScheduledMessages();
        
        // Запускаем задачу генерации тренировок из программ
        this.scheduleProgramTrainingsGeneration();
        
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
            // Защита от повторного запуска
            if (this.isRunning.trainingReminders) {
                console.log(`[${new Date().toISOString()}] Задача отправки напоминаний уже выполняется, пропускаем`);
                return;
            }
            
            this.isRunning.trainingReminders = true;
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
            } finally {
                this.isRunning.trainingReminders = false;
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
     * Настраивает задачу отправки запросов на отзывы
     * Запускается каждый день в 21:00 по времени Екатеринбурга (UTC+5)
     */
    scheduleReviewRequests() {
        // Запускаем в 21:00 - сразу после завершения тренировок
        const task = cron.schedule('0 21 * * *', async () => {
            // Защита от повторного запуска
            if (this.isRunning.reviewRequests) {
                console.log(`[${new Date().toISOString()}] Задача отправки запросов на отзывы уже выполняется, пропускаем`);
                return;
            }
            
            this.isRunning.reviewRequests = true;
            const today = new Date();
            
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: отправка запросов на отзывы`);
                
                const stats = await reviewNotificationService.sendReviewRequests(today);
                
                console.log(`[${new Date().toISOString()}] Задача завершена. Отправлено: ${stats.sent}, Пропущено: ${stats.skipped_no_links}, Ошибок: ${stats.failed}`);
                
                // Отправляем отчет администратору
                await this.notifyAdminReviews(stats, today);
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при выполнении задачи отправки запросов на отзывы:`, error);
                
                // Уведомляем администратора об ошибке
                await this.notifyAdminErrorReviews(error);
            } finally {
                this.isRunning.reviewRequests = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'review_requests',
            description: 'Отправка запросов на отзывы клиентам',
            schedule: '0 21 * * * (Екатеринбург)',
            task: task
        });

        console.log('✓ Задача "Запросы на отзывы" настроена на 21:00 (Екатеринбург)');
    }

    /**
     * Настраивает задачу обновления статусов завершенных тренировок
     * Запускается каждые 30 минут
     */
    scheduleStatusUpdates() {
        const { exec } = require('child_process');
        const path = require('path');
        
        const task = cron.schedule('*/30 * * * *', async () => {
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: обновление статусов тренировок`);
                
                const scriptPath = path.join(__dirname, '../scripts/complete-past-group-sessions.js');
                
                exec(`node ${scriptPath}`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[${new Date().toISOString()}] Ошибка обновления статусов:`, error);
                        return;
                    }
                    if (stderr) {
                        console.error(`[${new Date().toISOString()}] Stderr обновления статусов:`, stderr);
                    }
                    console.log(`[${new Date().toISOString()}] ${stdout}`);
                });
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при запуске обновления статусов:`, error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'status_updates',
            description: 'Обновление статусов завершенных тренировок',
            schedule: '*/30 * * * * (Екатеринбург)',
            task: task
        });

        console.log('✓ Задача "Обновление статусов" настроена на каждые 30 минут');
    }

    /**
     * Настраивает задачу отправки отложенных сообщений
     * Запускается каждые 5 минут для проверки и отправки отложенных сообщений
     */
    scheduleScheduledMessages() {
        const task = cron.schedule('*/5 * * * *', async () => {
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: отправка отложенных сообщений`);
                
                const stats = await scheduledMessagesService.sendScheduledMessages();
                
                if (stats.sent > 0 || stats.errors > 0) {
                    console.log(`[${new Date().toISOString()}] Задача завершена. Отправлено: ${stats.sent}, Ошибок: ${stats.errors}`);
                }
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при выполнении задачи отправки отложенных сообщений:`, error);
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'scheduled_messages',
            description: 'Отправка отложенных сообщений',
            schedule: '*/5 * * * * (Екатеринбург)',
            task: task
        });

        console.log('✓ Задача "Отправка отложенных сообщений" настроена на каждые 5 минут');
    }

    /**
     * Настраивает задачу автоматической генерации тренировок из программ
     * Запускается каждый день в 02:00 по времени Екатеринбурга
     * Проверяет все активные программы и создает недостающие тренировки на 14 дней вперед
     */
    scheduleProgramTrainingsGeneration() {
        // Запускаем в 02:00 ночи - в это время мало нагрузки на систему
        const task = cron.schedule('0 2 * * *', async () => {
            // Защита от повторного запуска
            if (this.isRunning.programTrainingsGeneration) {
                console.log(`[${new Date().toISOString()}] Задача генерации тренировок из программ уже выполняется, пропускаем`);
                return;
            }
            
            this.isRunning.programTrainingsGeneration = true;
            
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: генерация тренировок из программ`);
                
                const stats = await programTrainingsGenerator.generateTrainingsForAllPrograms();
                
                console.log(`[${new Date().toISOString()}] Задача завершена. Программ обработано: ${stats.programsProcessed}, создано тренировок: ${stats.totalCreated}, пропущено: ${stats.totalSkipped}, ошибок: ${stats.errors.length}`);
                
                // Отправляем отчет администратору, если были созданы тренировки или ошибки
                if (stats.totalCreated > 0 || stats.errors.length > 0) {
                    await this.notifyAdminProgramGeneration(stats);
                }
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при выполнении задачи генерации тренировок из программ:`, error);
                
                // Уведомляем администратора об ошибке
                await this.notifyAdminErrorProgramGeneration(error);
            } finally {
                this.isRunning.programTrainingsGeneration = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'program_trainings_generation',
            description: 'Автоматическая генерация тренировок из программ (14 дней вперед)',
            schedule: '0 2 * * * (Екатеринбург)',
            task: task
        });

        console.log('✓ Задача "Генерация тренировок из программ" настроена на 02:00 (Екатеринбург)');
    }

    /**
     * Отправляет администратору отчет о генерации тренировок из программ
     * @param {Object} stats - Статистика генерации
     */
    async notifyAdminProgramGeneration(stats) {
        if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
            console.log('ADMIN_TELEGRAM_ID или ADMIN_BOT_TOKEN не указаны в .env - пропускаем уведомление администратора');
            return;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let message = `📋 <b>Отчет о генерации тренировок из программ</b>\n\n`;
            message += `📊 Программ обработано: ${stats.programsProcessed}\n`;
            message += `✅ Создано тренировок: ${stats.totalCreated}\n`;
            message += `⏭️ Пропущено (уже существуют): ${stats.totalSkipped}\n`;
            message += `❌ Ошибок: ${stats.errors.length}\n\n`;
            
            if (stats.errors && stats.errors.length > 0) {
                message += `<b>Ошибки:</b>\n`;
                stats.errors.slice(0, 5).forEach((error, index) => {
                    message += `${index + 1}. Программа "${error.program_name}" (ID: ${error.program_id}): ${error.error}\n`;
                });
                if (stats.errors.length > 5) {
                    message += `... и еще ${stats.errors.length - 5}\n`;
                }
            }
            
            message += `\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
            console.log('✓ Отчет о генерации тренировок отправлен администратору');
        } catch (error) {
            console.error('Ошибка при отправке отчета о генерации тренировок администратору:', error.message);
        }
    }

    /**
     * Отправляет администратору уведомление об ошибке при генерации тренировок из программ
     * @param {Error} error - Объект ошибки
     */
    async notifyAdminErrorProgramGeneration(error) {
        if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
            return;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let message = `⚠️ <b>Ошибка при генерации тренировок из программ</b>\n\n`;
            message += `<code>${error.message}</code>\n\n`;
            message += `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
            console.log('✓ Уведомление об ошибке генерации тренировок отправлено администратору');
        } catch (notifyError) {
            console.error('Ошибка при отправке уведомления об ошибке генерации тренировок администратору:', notifyError.message);
        }
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

    /**
     * Отправляет администратору отчет о результатах отправки запросов на отзывы
     * @param {Object} stats - Статистика отправки
     * @param {Date} targetDate - Дата тренировок
     */
    async notifyAdminReviews(stats, targetDate) {
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

    /**
     * Отправляет администратору уведомление об ошибке при отправке запросов на отзывы
     * @param {Error} error - Объект ошибки
     */
    async notifyAdminErrorReviews(error) {
        if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
            return;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let message = `⚠️ <b>Ошибка при отправке запросов на отзывы</b>\n\n`;
            message += `<code>${error.message}</code>\n\n`;
            message += `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
            console.log('✓ Уведомление об ошибке отправки отзывов отправлено администратору');
        } catch (notifyError) {
            console.error('Ошибка при отправке уведомления об ошибке отзывов администратору:', notifyError.message);
        }
    }
}

module.exports = new Scheduler();

