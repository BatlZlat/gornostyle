/**
 * Планировщик задач для автоматической отправки уведомлений
 * Использует node-cron для запуска задач по расписанию
 */

const cron = require('node-cron');
const notificationService = require('./notification-service');
const reviewNotificationService = require('./review-notification-service');
const scheduledMessagesService = require('./scheduled-messages-service');
const programTrainingsGenerator = require('./program-trainings-generator');
const { pool } = require('../db');

class Scheduler {
    constructor() {
        this.tasks = [];
        this.isRunning = {
            trainingReminders: false,
            reviewRequests: false,
            statusUpdates: false,
            scheduledMessages: false,
            programTrainingsGeneration: false,
            certificateExpiration: false,
            holdCleanup: false,
            paymentTimeout: false
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
        
        // Запускаем задачу автоматического сгорания сертификатов
        this.scheduleCertificateExpiration();
        
        // Запускаем задачу очистки истёкших hold
        this.scheduleHoldCleanup();
        
        // Запускаем задачу проверки таймаута оплаты
        this.schedulePaymentTimeout();
        
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
     * Настраивает задачу автоматического сгорания просроченных сертификатов
     * Запускается каждый день в 00:00 по времени Екатеринбурга
     * Помечает сертификаты со статусом 'active', у которых expiry_date < NOW(), как 'expired'
     */
    scheduleCertificateExpiration() {
        // Запускаем в 00:00 - начало нового дня
        const task = cron.schedule('0 0 * * *', async () => {
            // Защита от повторного запуска
            if (this.isRunning.certificateExpiration) {
                console.log(`[${new Date().toISOString()}] Задача пометки просроченных сертификатов уже выполняется, пропускаем`);
                return;
            }
            
            this.isRunning.certificateExpiration = true;
            
            try {
                console.log(`[${new Date().toISOString()}] Запуск задачи: автоматическое сгорание просроченных сертификатов`);
                
                // Помечаем просроченные сертификаты
                const result = await pool.query(`
                    UPDATE certificates 
                    SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                    WHERE status = 'active' AND expiry_date < NOW()
                    RETURNING id, certificate_number, purchaser_id, recipient_name, nominal_value
                `);
                
                const expiredCertificates = result.rows;
                const count = expiredCertificates.length;
                
                if (count > 0) {
                    const totalValue = expiredCertificates.reduce((sum, cert) => sum + parseFloat(cert.nominal_value), 0);
                    
                    console.log(`[${new Date().toISOString()}] Задача завершена. Истекло сертификатов: ${count}, общая сумма: ${totalValue}₽`);
                    
                    // Отправляем отчет администратору
                    await this.notifyAdminCertificateExpiration({
                        count: count,
                        total_value: totalValue,
                        certificates: expiredCertificates
                    });
                } else {
                    console.log(`[${new Date().toISOString()}] Задача завершена. Просроченных сертификатов не найдено`);
                }
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при выполнении задачи пометки просроченных сертификатов:`, error);
                
                // Уведомляем администратора об ошибке
                await this.notifyAdminErrorCertificateExpiration(error);
            } finally {
                this.isRunning.certificateExpiration = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'certificate_expiration',
            description: 'Автоматическое сгорание просроченных сертификатов',
            schedule: '0 0 * * * (Екатеринбург)',
            task: task
        });

        console.log('✓ Задача "Автоматическое сгорание сертификатов" настроена на 00:00 (Екатеринбург)');
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

    /**
     * Отправляет администратору отчет об истекших сертификатах
     * @param {Object} stats - Статистика истекших сертификатов
     */
    async notifyAdminCertificateExpiration(stats) {
        if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
            console.log('ADMIN_TELEGRAM_ID или ADMIN_BOT_TOKEN не указаны в .env - пропускаем уведомление администратора');
            return;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let message = `🎟️ <b>Отчет об истекших сертификатах</b>\n\n`;
            message += `📊 Истекло сертификатов: ${stats.count}\n`;
            message += `💰 Общая сумма: ${stats.total_value.toLocaleString('ru-RU')} ₽\n\n`;
            
            if (stats.certificates && stats.certificates.length > 0) {
                message += `<b>Детали:</b>\n`;
                stats.certificates.slice(0, 10).forEach((cert, index) => {
                    const recipientInfo = cert.recipient_name ? ` → ${cert.recipient_name}` : '';
                    message += `${index + 1}. #${cert.certificate_number}${recipientInfo} - ${parseFloat(cert.nominal_value).toLocaleString('ru-RU')} ₽\n`;
                });
                if (stats.certificates.length > 10) {
                    message += `... и еще ${stats.certificates.length - 10}\n`;
                }
            }
            
            message += `\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
            console.log('✓ Отчет об истекших сертификатах отправлен администратору');
        } catch (error) {
            console.error('Ошибка при отправке отчета об истекших сертификатах администратору:', error.message);
        }
    }

    /**
     * Отправляет администратору уведомление об ошибке при пометке просроченных сертификатов
     * @param {Error} error - Объект ошибки
     */
    async notifyAdminErrorCertificateExpiration(error) {
        if (!process.env.ADMIN_TELEGRAM_ID || !process.env.ADMIN_BOT_TOKEN) {
            return;
        }

        try {
            const TelegramBot = require('node-telegram-bot-api');
            const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN);
            
            let message = `⚠️ <b>Ошибка при пометке просроченных сертификатов</b>\n\n`;
            message += `<code>${error.message}</code>\n\n`;
            message += `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`;

            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'HTML' });
            console.log('✓ Уведомление об ошибке пометки сертификатов отправлено администратору');
        } catch (notifyError) {
            console.error('Ошибка при отправке уведомления об ошибке пометки сертификатов администратору:', notifyError.message);
        }
    }

    /**
     * Настраивает задачу очистки истёкших hold на слотах
     * Запускается каждые 5 минут
     */
    scheduleHoldCleanup() {
        const task = cron.schedule('*/5 * * * *', async () => {
            // Защита от повторного запуска
            if (this.isRunning.holdCleanup) {
                return;
            }
            
            this.isRunning.holdCleanup = true;
            
            try {
                // Вызываем функцию БД для очистки истёкших hold
                const result = await pool.query('SELECT clear_expired_holds()');
                const clearedCount = result.rows[0].clear_expired_holds;
                
                if (clearedCount > 0) {
                    console.log(`[${new Date().toISOString()}] 🔓 Очистка hold: освобождено слотов: ${clearedCount}`);
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Ошибка при очистке истёкших hold:`, error);
            } finally {
                this.isRunning.holdCleanup = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'hold_cleanup',
            description: 'Очистка истёкших hold (временных блокировок слотов)',
            schedule: 'каждые 5 минут',
            task: task
        });

        console.log('✓ Задача "Очистка hold" настроена на каждые 5 минут');
    }

    /**
     * Настраивает задачу проверки таймаута оплаты
     * Запускается каждые 5 минут
     * Проверяет транзакции со статусом 'pending' старше 30 минут
     */
    schedulePaymentTimeout() {
        const task = cron.schedule('*/5 * * * *', async () => {
            // Защита от повторного запуска
            if (this.isRunning.paymentTimeout) {
                return;
            }
            
            this.isRunning.paymentTimeout = true;
            
            try {
                console.log(`[${new Date().toISOString()}] 🔍 Проверка таймаута оплаты (транзакции старше 30 минут)...`);
                
                // Находим транзакции со статусом 'pending' старше 30 минут, где бронирование не создано
                const expiredTransactions = await pool.query(
                    `SELECT id, client_id, provider_raw_data, amount, description
                     FROM kuliga_transactions
                     WHERE booking_id IS NULL
                       AND status = 'pending'
                       AND created_at < NOW() - INTERVAL '30 minutes'`
                );

                if (expiredTransactions.rows.length === 0) {
                    console.log(`[${new Date().toISOString()}] ✅ Просроченных транзакций не найдено`);
                    return;
                }

                console.log(`[${new Date().toISOString()}] 🔍 Найдено ${expiredTransactions.rows.length} просроченных транзакций`);

                const bot = require('../bot/client-bot').bot;

                for (const transaction of expiredTransactions.rows) {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        
                        // Парсим bookingData из provider_raw_data
                        let rawData = {};
                        try {
                            if (typeof transaction.provider_raw_data === 'string') {
                                rawData = JSON.parse(transaction.provider_raw_data);
                            } else if (transaction.provider_raw_data) {
                                rawData = transaction.provider_raw_data;
                            }
                        } catch (parseError) {
                            console.error(`❌ Ошибка парсинга provider_raw_data для транзакции #${transaction.id}:`, parseError);
                            await client.query('ROLLBACK');
                            continue;
                        }
                        
                        const bookingData = rawData.bookingData;
                        const walletRefillData = rawData.walletRefillData;
                        
                        // Освобождаем места/слоты в зависимости от типа транзакции
                        if (bookingData) {
                            if (bookingData.slot_id) {
                                // Индивидуальное бронирование: снимаем hold со слота
                                await client.query(
                                    `UPDATE kuliga_schedule_slots
                                     SET status = 'available',
                                         hold_until = NULL,
                                         hold_transaction_id = NULL,
                                         updated_at = CURRENT_TIMESTAMP
                                     WHERE id = $1 AND hold_transaction_id = $2`,
                                    [bookingData.slot_id, transaction.id]
                                );
                                console.log(`🔓 Hold снят со слота #${bookingData.slot_id} (таймаут оплаты)`);
                            } else if (bookingData.group_training_id && bookingData.participants_count) {
                                // Групповое бронирование: возвращаем места
                                await client.query(
                                    `UPDATE kuliga_group_trainings
                                     SET current_participants = current_participants - $1,
                                         updated_at = CURRENT_TIMESTAMP
                                     WHERE id = $2`,
                                    [bookingData.participants_count, bookingData.group_training_id]
                                );
                                console.log(`🔓 Возвращено ${bookingData.participants_count} мест в групповой тренировке #${bookingData.group_training_id} (таймаут оплаты)`);
                            } else if (bookingData.booking_type === 'group_simulator' && bookingData.group_id) {
                                // Групповое бронирование на тренажере: возвращаем место
                                await client.query(
                                    `UPDATE training_sessions
                                     SET current_participants = GREATEST(current_participants - 1, 0),
                                         status = CASE 
                                             WHEN current_participants <= 1 THEN 'scheduled'
                                             ELSE status
                                         END,
                                         hold_until = NULL,
                                         hold_transaction_id = NULL,
                                         updated_at = CURRENT_TIMESTAMP
                                     WHERE id = $1`,
                                    [bookingData.group_id]
                                );
                                console.log(`🔓 Возвращено место в групповой тренировке на тренажере #${bookingData.group_id} (таймаут оплаты)`);
                            } else if (bookingData.booking_type === 'individual_simulator') {
                                // Индивидуальное бронирование на тренажере: освобождаем слоты в schedule
                                if (bookingData.simulator_id && bookingData.date && bookingData.start_time && bookingData.duration) {
                                    await client.query(
                                        `UPDATE schedule
                                         SET is_booked = FALSE, updated_at = CURRENT_TIMESTAMP
                                         WHERE simulator_id = $1
                                           AND date = $2
                                           AND start_time >= $3
                                           AND start_time < ($3::time + ($4 * interval '1 minute'))`,
                                        [bookingData.simulator_id, bookingData.date, bookingData.start_time, bookingData.duration]
                                    );
                                    console.log(`🔓 Слоты на тренажере освобождены (таймаут оплаты)`);
                                }
                            }
                        }
                        
                        // Обновляем статус транзакции на 'expired'
                        await client.query(
                            `UPDATE kuliga_transactions 
                             SET status = 'expired', updated_at = CURRENT_TIMESTAMP
                             WHERE id = $1`,
                            [transaction.id]
                        );
                        
                        await client.query('COMMIT');
                        
                        // Отправляем уведомление в Telegram клиенту, если платеж был из бота
                        if (rawData.source === 'bot' && transaction.client_id) {
                            try {
                                const clientResult = await pool.query(
                                    'SELECT telegram_id FROM clients WHERE id = $1',
                                    [transaction.client_id]
                                );
                                
                                if (clientResult.rows.length > 0 && clientResult.rows[0].telegram_id) {
                                    const telegramId = clientResult.rows[0].telegram_id;
                                    
                                    let message = '';
                                    if (walletRefillData) {
                                        // Пополнение кошелька
                                        const amount = walletRefillData.amount || 0;
                                        message = `⏰ <b>Время оплаты истекло</b>\n\n`;
                                        message += `💰 Сумма пополнения: ${amount.toFixed(2)} ₽\n\n`;
                                        message += `Время на оплату истекло. Место было освобождено.\n\n`;
                                        message += `Вы можете попробовать пополнить кошелек снова.`;
                                    } else if (bookingData) {
                                        // Бронирование тренировки
                                        const formatDate = (dateStr) => {
                                            const date = new Date(dateStr);
                                            const day = date.getDate().toString().padStart(2, '0');
                                            const month = (date.getMonth() + 1).toString().padStart(2, '0');
                                            const year = date.getFullYear();
                                            return `${day}.${month}.${year}`;
                                        };
                                        
                                        const formatTime = (timeStr) => {
                                            if (!timeStr) return '';
                                            const time = timeStr.toString();
                                            return time.substring(0, 5);
                                        };
                                        
                                        const dateFormatted = formatDate(bookingData.date);
                                        const timeFormatted = formatTime(bookingData.start_time);
                                        const sportText = bookingData.sport_type === 'ski' ? 'Лыжи' : 'Сноуборд';
                                        let bookingTypeText;
                                        if (bookingData.booking_type === 'individual') {
                                            bookingTypeText = 'Индивидуальное занятие (естественный склон)';
                                        } else if (bookingData.booking_type === 'individual_simulator') {
                                            bookingTypeText = 'Индивидуальное занятие (тренажер)';
                                        } else if (bookingData.booking_type === 'group') {
                                            bookingTypeText = 'Групповое занятие (естественный склон)';
                                        } else if (bookingData.booking_type === 'group_simulator') {
                                            bookingTypeText = 'Групповое занятие (тренажер)';
                                        } else {
                                            bookingTypeText = 'Занятие';
                                        }
                                        
                                        message = `⏰ <b>Время оплаты истекло</b>\n\n`;
                                        message += `📅 Дата: ${dateFormatted}\n`;
                                        message += `⏰ Время: ${timeFormatted}\n`;
                                        message += `🎿 Тип: ${bookingTypeText}, ${sportText}\n`;
                                        message += `💰 Сумма: ${bookingData.price_total?.toFixed(2) || '0.00'} ₽\n\n`;
                                        message += `Время на оплату истекло (30 минут). Место было освобождено.\n\n`;
                                        message += `Вы можете попробовать записаться снова.`;
                                    }
                                    
                                    if (message) {
                                        await bot.sendMessage(telegramId, message, { parse_mode: 'HTML' });
                                        console.log(`✅ Уведомление о таймауте оплаты отправлено клиенту (telegram_id: ${telegramId}, transaction #${transaction.id})`);
                                    }
                                }
                            } catch (telegramError) {
                                console.error(`❌ Ошибка при отправке уведомления в Telegram о таймауте оплаты (transaction #${transaction.id}):`, telegramError);
                            }
                        }
                        
                        console.log(`✅ Транзакция #${transaction.id} помечена как expired`);
                        
                    } catch (error) {
                        await client.query('ROLLBACK');
                        console.error(`❌ Ошибка при обработке просроченной транзакции #${transaction.id}:`, error);
                    } finally {
                        client.release();
                    }
                }
                
                console.log(`[${new Date().toISOString()}] ✅ Проверка таймаута оплаты завершена. Обработано транзакций: ${expiredTransactions.rows.length}`);
                
            } catch (error) {
                console.error(`[${new Date().toISOString()}] ❌ Ошибка при проверке таймаута оплаты:`, error);
            } finally {
                this.isRunning.paymentTimeout = false;
            }
        }, {
            scheduled: true,
            timezone: "Asia/Yekaterinburg"
        });

        this.tasks.push({
            name: 'payment_timeout',
            description: 'Проверка таймаута оплаты (освобождение мест/слотов через 30 минут)',
            schedule: 'каждые 5 минут',
            task: task
        });

        console.log('✓ Задача "Проверка таймаута оплаты" настроена на каждые 5 минут');
    }
}

module.exports = new Scheduler();

