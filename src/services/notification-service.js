require('dotenv').config();
const { pool } = require('../db');
const TelegramBot = require('node-telegram-bot-api');
const { getClientSilentMode } = require('./silent-notification-helper');

/**
 * Сервис для отправки уведомлений клиентам о предстоящих тренировках
 */
class NotificationService {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    }

    /**
     * Получает все тренировки на указанную дату
     * @param {Date} date - Дата для поиска тренировок
     * @returns {Promise<Array>} Массив тренировок
     */
    async getTrainingsByDate(date) {
        const dateStr = date.toISOString().split('T')[0];
        
        const query = `
            WITH trainings_on_date AS (
                -- Групповые тренировки
                SELECT 
                    ts.id as training_id,
                    'group' as training_type,
                    ts.session_date as date,
                    ts.start_time,
                    ts.end_time,
                    ts.duration,
                    ts.equipment_type,
                    ts.skill_level,
                    ts.price,
                    ts.with_trainer,
                    ts.max_participants,
                    (SELECT COUNT(*) FROM session_participants 
                     WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
                    s.name as simulator_name,
                    g.name as group_name,
                    t.full_name as trainer_name,
                    sp.client_id,
                    sp.child_id,
                    sp.is_child,
                    c.telegram_id,
                    c.full_name as client_name,
                    ch.full_name as participant_name,
                    CASE 
                        WHEN sp.is_child = true THEN ch.full_name
                        ELSE c.full_name
                    END as display_name
                FROM training_sessions ts
                JOIN session_participants sp ON ts.id = sp.session_id
                JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                LEFT JOIN simulators s ON ts.simulator_id = s.id
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                WHERE ts.session_date = $1
                    AND ts.status = 'scheduled'
                    AND sp.status = 'confirmed'
                    AND c.telegram_id IS NOT NULL

                UNION ALL

                -- Индивидуальные тренировки
                SELECT 
                    its.id as training_id,
                    'individual' as training_type,
                    its.preferred_date as date,
                    its.preferred_time as start_time,
                    (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                    its.duration,
                    its.equipment_type,
                    NULL as skill_level,
                    its.price,
                    its.with_trainer,
                    NULL as max_participants,
                    NULL as current_participants,
                    s.name as simulator_name,
                    NULL as group_name,
                    NULL as trainer_name,
                    its.client_id,
                    its.child_id,
                    CASE WHEN its.child_id IS NOT NULL THEN true ELSE false END as is_child,
                    c.telegram_id,
                    c.full_name as client_name,
                    CASE 
                        WHEN its.child_id IS NOT NULL THEN ch.full_name
                        ELSE c.full_name
                    END as participant_name,
                    CASE 
                        WHEN its.child_id IS NOT NULL THEN ch.full_name
                        ELSE c.full_name
                    END as display_name
                FROM individual_training_sessions its
                JOIN clients c ON its.client_id = c.id
                LEFT JOIN children ch ON its.child_id = ch.id
                LEFT JOIN simulators s ON its.simulator_id = s.id
                WHERE its.preferred_date = $1
                    AND c.telegram_id IS NOT NULL
            )
            SELECT * FROM trainings_on_date
            ORDER BY client_id, start_time
        `;

        const result = await pool.query(query, [dateStr]);
        return result.rows;
    }

    /**
     * Группирует тренировки по клиентам
     * @param {Array} trainings - Массив тренировок
     * @returns {Object} Объект с группировкой { client_id: { telegram_id, client_name, trainings: [] } }
     */
    groupTrainingsByClient(trainings) {
        const grouped = {};

        for (const training of trainings) {
            const clientId = training.client_id;

            if (!grouped[clientId]) {
                grouped[clientId] = {
                    telegram_id: training.telegram_id,
                    client_name: training.client_name,
                    trainings: []
                };
            }

            grouped[clientId].trainings.push(training);
        }

        return grouped;
    }

    /**
     * Форматирует время для отображения
     * @param {string} time - Время в формате HH:MM:SS
     * @returns {string} Время в формате HH:MM
     */
    formatTime(time) {
        if (!time) return '';
        return time.toString().substring(0, 5);
    }

    /**
     * Форматирует дату для отображения
     * @param {Date|string} date - Дата
     * @returns {string} Дата в формате "DD месяц"
     */
    formatDate(date) {
        const d = typeof date === 'string' ? new Date(date) : date;
        const months = [
            'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
            'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
        ];
        
        return `${d.getDate()} ${months[d.getMonth()]}`;
    }

    /**
     * Формирует текст уведомления для клиента
     * @param {Object} clientData - Данные клиента и его тренировок
     * @param {Date} date - Дата тренировок
     * @returns {string} Текст сообщения
     */
    formatNotificationMessage(clientData, date) {
        const { trainings } = clientData;
        const formattedDate = this.formatDate(date);

        let message = `🔔 <b>Напоминание о тренировк${trainings.length > 1 ? 'ах' : 'е'}!</b>\n\n`;
        message += `Завтра, ${formattedDate}:\n\n`;

        trainings.forEach((training, index) => {
            if (index > 0) {
                message += '━━━━━━━━━━━━━━━━━━━━\n\n';
            }

            message += `📅 <b>${this.formatTime(training.start_time)} - ${this.formatTime(training.end_time)}</b>\n`;
            
            // Участник
            message += `👤 Участник: ${training.display_name}`;
            if (training.is_child) {
                message += ' (ребенок)';
            }
            message += '\n';

            // Тип тренировки
            if (training.training_type === 'group') {
                message += `🏂 Тип: Групповая тренировка\n`;
                if (training.group_name) {
                    message += `👥 Группа: ${training.group_name}\n`;
                }
            } else {
                message += `🏂 Тип: Индивидуальная тренировка\n`;
            }

            // Снаряжение
            if (training.equipment_type) {
                const equipment = training.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд';
                message += `⛷ Снаряжение: ${equipment}\n`;
            }

            // Тренажер
            if (training.simulator_name) {
                message += `🏔 Тренажер: ${training.simulator_name}\n`;
            }

            // Тренер
            if (training.training_type === 'group') {
                // Для групповых тренировок
                if (training.trainer_name) {
                    message += `👨‍🏫 Тренер: ${training.trainer_name}\n`;
                } else {
                    message += `👨‍🏫 Без тренера\n`;
                }
                // Количество участников для групповых
                if (training.current_participants && training.max_participants) {
                    message += `👥 Участников: ${training.current_participants}/${training.max_participants}\n`;
                }
            } else {
                // Для индивидуальных тренировок
                if (training.with_trainer) {
                    message += `👨‍🏫 С тренером\n`;
                } else {
                    message += `👨‍🏫 Без тренера\n`;
                }
            }

            // Уровень сложности (только для групповых)
            if (training.skill_level) {
                message += `📊 Уровень: ${training.skill_level}\n`;
            }

            message += '\n';
        });

        message += '━━━━━━━━━━━━━━━━━━━━\n\n';
        message += 'Ждем вас! Приезжайте на тренировку за 10-15 минут до начала. ';
        message += 'Не забудьте взять с собой воду и одежду, желательно закрывающую колени и локти 😊';

        return message;
    }

    /**
     * Отправляет уведомление клиенту
     * @param {string} telegramId - Telegram ID клиента
     * @param {string} message - Текст сообщения
     * @returns {Promise<Object>} Результат отправки
     */
    async sendNotification(telegramId, message) {
        try {
            // Проверяем настройку беззвучного режима
            const isSilent = await getClientSilentMode(telegramId);
            
            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'HTML',
                disable_notification: isSilent
            });
            return { success: true };
        } catch (error) {
            console.error(`Ошибка отправки уведомления клиенту ${telegramId}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Логирует отправку уведомления в БД
     * @param {number} clientId - ID клиента
     * @param {string} telegramId - Telegram ID клиента
     * @param {Date} trainingDate - Дата тренировки
     * @param {string} message - Текст сообщения
     * @param {string} status - Статус отправки ('sent' или 'failed')
     * @param {string} errorMessage - Сообщение об ошибке (если есть)
     */
    async logNotification(clientId, telegramId, trainingDate, message, status, errorMessage = null) {
        try {
            await pool.query(
                `INSERT INTO notification_logs 
                (client_id, telegram_id, notification_type, training_date, message, status, error_message)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [clientId, telegramId, 'training_reminder', trainingDate, message, status, errorMessage]
            );
        } catch (error) {
            console.error('Ошибка логирования уведомления:', error);
        }
    }

    /**
     * Отправляет напоминания о тренировках на указанную дату
     * @param {Date} date - Дата тренировок
     * @returns {Promise<Object>} Статистика отправки
     */
    async sendTrainingReminders(date) {
        const stats = {
            total_clients: 0,
            sent: 0,
            failed: 0,
            errors: []
        };

        try {
            console.log(`[${new Date().toISOString()}] Начало отправки напоминаний о тренировках на ${date.toISOString().split('T')[0]}`);

            // Получаем все тренировки на указанную дату
            const trainings = await this.getTrainingsByDate(date);
            
            if (trainings.length === 0) {
                console.log('Нет тренировок на указанную дату');
                return stats;
            }

            console.log(`Найдено ${trainings.length} записей на тренировки`);

            // Группируем по клиентам
            const groupedByClient = this.groupTrainingsByClient(trainings);
            stats.total_clients = Object.keys(groupedByClient).length;

            console.log(`Уникальных клиентов: ${stats.total_clients}`);

            // Отправляем уведомления
            for (const [clientId, clientData] of Object.entries(groupedByClient)) {
                try {
                    const message = this.formatNotificationMessage(clientData, date);
                    const result = await this.sendNotification(clientData.telegram_id, message);

                    if (result.success) {
                        stats.sent++;
                        await this.logNotification(
                            parseInt(clientId),
                            clientData.telegram_id,
                            date,
                            message,
                            'sent'
                        );
                        console.log(`✓ Отправлено клиенту ${clientData.client_name} (ID: ${clientId})`);
                    } else {
                        stats.failed++;
                        stats.errors.push({
                            client_id: clientId,
                            client_name: clientData.client_name,
                            error: result.error
                        });
                        await this.logNotification(
                            parseInt(clientId),
                            clientData.telegram_id,
                            date,
                            message,
                            'failed',
                            result.error
                        );
                        console.error(`✗ Не удалось отправить клиенту ${clientData.client_name} (ID: ${clientId}): ${result.error}`);
                    }

                    // Небольшая задержка между отправками
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    stats.failed++;
                    stats.errors.push({
                        client_id: clientId,
                        client_name: clientData.client_name,
                        error: error.message
                    });
                    console.error(`✗ Ошибка при обработке клиента ${clientData.client_name} (ID: ${clientId}):`, error);
                }
            }

            console.log(`[${new Date().toISOString()}] Завершено. Отправлено: ${stats.sent}, Ошибок: ${stats.failed}`);

        } catch (error) {
            console.error('Критическая ошибка при отправке напоминаний:', error);
            throw error;
        }

        return stats;
    }

    /**
     * Отправляет напоминания о тренировках на завтра
     * @returns {Promise<Object>} Статистика отправки
     */
    async sendTomorrowReminders() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return await this.sendTrainingReminders(tomorrow);
    }
}

module.exports = new NotificationService();

