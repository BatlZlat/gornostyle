require('dotenv').config();
const { pool } = require('../db');
const TelegramBot = require('node-telegram-bot-api');

/**
 * Сервис для отправки уведомлений клиентам с просьбой оставить отзыв
 */
class ReviewNotificationService {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    }

    /**
     * Склонение слова "тренировка"
     * @param {number} count - Количество тренировок
     * @returns {string} - "1-ю", "2-ю", "3-ю", "4-ю", "5-ю" и т.д.
     */
    getTrainingOrdinal(count) {
        const lastDigit = count % 10;
        const lastTwoDigits = count % 100;
        
        // Особые случаи: 11-19
        if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
            return `${count}-ю`;
        }
        
        // 1-ю, 21-ю, 31-ю и т.д.
        if (lastDigit === 1) {
            return `${count}-ю`;
        }
        
        // Все остальные: 2-ю, 3-ю, 4-ю, 5-ю и т.д.
        return `${count}-ю`;
    }

    /**
     * Получает тренировки, завершенные сегодня
     * @param {Date} date - Дата для поиска (по умолчанию - сегодня)
     * @returns {Promise<Array>} Массив тренировок с участниками
     */
    async getCompletedTrainingsToday(date = new Date()) {
        const dateStr = date.toISOString().split('T')[0];
        
        const query = `
            WITH todays_trainings AS (
                -- Групповые тренировки
                SELECT 
                    sp.client_id,
                    sp.child_id,
                    sp.is_child,
                    c.telegram_id,
                    c.full_name as client_name,
                    ch.full_name as child_name,
                    'group' as training_type
                FROM training_sessions ts
                JOIN session_participants sp ON ts.id = sp.session_id
                JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                WHERE ts.session_date = $1
                    AND ts.status = 'scheduled'
                    AND sp.status = 'confirmed'
                    AND c.telegram_id IS NOT NULL
                
                UNION ALL
                
                -- Индивидуальные тренировки
                SELECT 
                    its.client_id,
                    its.child_id,
                    CASE WHEN its.child_id IS NOT NULL THEN true ELSE false END as is_child,
                    c.telegram_id,
                    c.full_name as client_name,
                    ch.full_name as child_name,
                    'individual' as training_type
                FROM individual_training_sessions its
                JOIN clients c ON its.client_id = c.id
                LEFT JOIN children ch ON its.child_id = ch.id
                WHERE its.preferred_date = $1
                    AND c.telegram_id IS NOT NULL
            )
            SELECT * FROM todays_trainings
            ORDER BY client_id, child_id
        `;

        const result = await pool.query(query, [dateStr]);
        return result.rows;
    }

    /**
     * Подсчитывает общее количество тренировок для клиента
     * @param {number} clientId - ID клиента
     * @param {number|null} childId - ID ребенка (если null, считаем для клиента)
     * @returns {Promise<number>} Количество тренировок
     */
    async getTrainingCount(clientId, childId = null) {
        let query;
        let params;

        if (childId) {
            // Считаем тренировки ребенка
            query = `
                SELECT COUNT(*) as count FROM (
                    -- Индивидуальные тренировки ребенка
                    SELECT id
                    FROM individual_training_sessions
                    WHERE child_id = $1
                        AND preferred_date <= CURRENT_DATE
                    
                    UNION ALL
                    
                    -- Групповые тренировки ребенка
                    SELECT sp.id
                    FROM session_participants sp
                    JOIN training_sessions ts ON sp.session_id = ts.id
                    WHERE sp.child_id = $1
                        AND sp.is_child = true
                        AND sp.status = 'confirmed'
                        AND ts.session_date <= CURRENT_DATE
                ) t
            `;
            params = [childId];
        } else {
            // Считаем тренировки клиента (родителя)
            query = `
                SELECT COUNT(*) as count FROM (
                    -- Индивидуальные тренировки клиента
                    SELECT id
                    FROM individual_training_sessions
                    WHERE client_id = $1 AND child_id IS NULL
                        AND preferred_date <= CURRENT_DATE
                    
                    UNION ALL
                    
                    -- Групповые тренировки клиента
                    SELECT sp.id
                    FROM session_participants sp
                    JOIN training_sessions ts ON sp.session_id = ts.id
                    WHERE sp.client_id = $1
                        AND sp.is_child = false
                        AND sp.status = 'confirmed'
                        AND ts.session_date <= CURRENT_DATE
                ) t
            `;
            params = [clientId];
        }

        const result = await pool.query(query, params);
        return parseInt(result.rows[0].count);
    }

    /**
     * Группирует тренировки по клиентам
     * @param {Array} trainings - Массив тренировок
     * @returns {Object} Объект с группировкой по client_id
     */
    groupTrainingsByClient(trainings) {
        const grouped = {};

        for (const training of trainings) {
            const clientId = training.client_id;

            if (!grouped[clientId]) {
                grouped[clientId] = {
                    telegram_id: training.telegram_id,
                    client_name: training.client_name,
                    participants: []
                };
            }

            grouped[clientId].participants.push({
                is_child: training.is_child,
                child_id: training.child_id,
                child_name: training.child_name
            });
        }

        return grouped;
    }

    /**
     * Формирует текст уведомления
     * @param {Object} clientData - Данные клиента
     * @param {Object} stats - Статистика тренировок
     * @param {boolean} request2gis - Запрашивать ли отзыв на 2ГИС
     * @param {boolean} requestYandex - Запрашивать ли отзыв на Яндекс
     * @returns {string} Текст уведомления
     */
    formatNotificationMessage(clientData, stats, request2gis, requestYandex) {
        let message = '🎉 Поздравляем!\n\n';

        // Определяем тип участников
        const clientParticipated = stats.clientParticipated;
        const childrenParticipated = stats.children || [];

        if (clientParticipated && childrenParticipated.length === 0) {
            // Только клиент тренировался
            message += `Вы провели ${this.getTrainingOrdinal(stats.clientCount)} тренировку!\n\n`;
        } else if (!clientParticipated && childrenParticipated.length === 1) {
            // Только один ребенок тренировался
            const child = childrenParticipated[0];
            message += `Ваш ребенок провел ${this.getTrainingOrdinal(child.count)} тренировку!\n\n`;
        } else if (!clientParticipated && childrenParticipated.length > 1) {
            // Несколько детей тренировались
            message += 'Ваши дети провели ';
            const childMessages = childrenParticipated.map(child => 
                `${child.name} ${this.getTrainingOrdinal(child.count)} тренировку`
            );
            message += childMessages.join(', ') + '!\n\n';
        } else {
            // Клиент + дети (показываем статистику клиента)
            message += `Вы провели ${this.getTrainingOrdinal(stats.clientCount)} тренировку!\n\n`;
        }

        // Добавляем просьбу об отзыве
        message += 'Мы будем очень благодарны, если вы оставите отзыв о нашем комплексе:\n\n';

        // Добавляем ссылки в зависимости от статуса отзывов
        if (request2gis) {
            message += '📍 <a href="https://go.2gis.com/eHFpz">2ГИС</a>\n';
        }
        if (requestYandex) {
            message += '📍 <a href="https://yandex.ru/maps/-/CLV0yINs">Яндекс Карты</a>\n';
        }

        if (!request2gis && !requestYandex) {
            // Если оба отзыва уже оставлены, не отправляем уведомление
            return null;
        }

        message += '\nВаше мнение очень важно для нас! 🙏';

        return message;
    }

    /**
     * Определяет участников и их статистику
     * @param {Object} clientData - Данные клиента с участниками
     * @param {number} clientId - ID клиента
     * @returns {Promise<Object>} Статистика участников
     */
    async getParticipantStats(clientData, clientId) {
        const stats = {
            clientParticipated: false,
            clientCount: 0,
            children: [],
            participantType: null,
            participantDetails: null
        };

        // Проверяем уникальных участников
        const uniqueParticipants = {};
        
        for (const participant of clientData.participants) {
            const key = participant.is_child ? `child_${participant.child_id}` : 'client';
            
            if (!uniqueParticipants[key]) {
                uniqueParticipants[key] = {
                    is_child: participant.is_child,
                    child_id: participant.child_id,
                    child_name: participant.child_name
                };
            }
        }

        // Собираем статистику
        for (const [key, participant] of Object.entries(uniqueParticipants)) {
            if (!participant.is_child) {
                stats.clientParticipated = true;
                stats.clientCount = await this.getTrainingCount(clientId, null);
            } else {
                const childCount = await this.getTrainingCount(clientId, participant.child_id);
                stats.children.push({
                    id: participant.child_id,
                    name: participant.child_name,
                    count: childCount
                });
            }
        }

        // Определяем тип участника
        if (stats.clientParticipated && stats.children.length === 0) {
            stats.participantType = 'client';
            stats.participantDetails = { clientCount: stats.clientCount };
        } else if (!stats.clientParticipated && stats.children.length === 1) {
            stats.participantType = 'child';
            stats.participantDetails = { 
                childName: stats.children[0].name,
                childCount: stats.children[0].count 
            };
        } else if (!stats.clientParticipated && stats.children.length > 1) {
            stats.participantType = 'multiple_children';
            stats.participantDetails = { 
                children: stats.children.map(c => ({ name: c.name, count: c.count }))
            };
        } else {
            // Клиент + дети - используем статистику клиента
            stats.participantType = 'client';
            stats.participantDetails = { 
                clientCount: stats.clientCount,
                withChildren: true 
            };
        }

        return stats;
    }

    /**
     * Отправляет уведомление клиенту
     * @param {string} telegramId - Telegram ID клиента
     * @param {string} message - Текст сообщения
     * @returns {Promise<Object>} Результат отправки
     */
    async sendNotification(telegramId, message) {
        try {
            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: false
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
     * @param {number} trainingCount - Количество тренировок
     * @param {string} participantType - Тип участника
     * @param {Object} participantDetails - Детали участников
     * @param {string} message - Текст сообщения
     * @param {boolean} request2gis - Был ли запрошен отзыв на 2ГИС
     * @param {boolean} requestYandex - Был ли запрошен отзыв на Яндекс
     */
    async logNotification(clientId, telegramId, trainingCount, participantType, participantDetails, message, request2gis, requestYandex) {
        try {
            await pool.query(
                `INSERT INTO review_notification_logs 
                (client_id, telegram_id, training_count, participant_type, participant_details, 
                 notification_text, review_2gis_requested, review_yandex_requested)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [clientId, telegramId, trainingCount, participantType, 
                 JSON.stringify(participantDetails), message, request2gis, requestYandex]
            );
        } catch (error) {
            console.error('Ошибка логирования уведомления:', error);
        }
    }

    /**
     * Отправляет запросы на отзывы для завершенных тренировок
     * @param {Date} date - Дата для поиска завершенных тренировок
     * @returns {Promise<Object>} Статистика отправки
     */
    async sendReviewRequests(date = new Date()) {
        const stats = {
            total_clients: 0,
            sent: 0,
            skipped_no_links: 0,
            failed: 0,
            errors: []
        };

        try {
            console.log(`[${new Date().toISOString()}] Начало отправки запросов на отзывы за ${date.toISOString().split('T')[0]}`);

            // Получаем все завершенные тренировки за указанную дату
            const trainings = await this.getCompletedTrainingsToday(date);
            
            if (trainings.length === 0) {
                console.log('Нет завершенных тренировок за указанную дату');
                return stats;
            }

            console.log(`Найдено ${trainings.length} записей на тренировки`);

            // Группируем по клиентам (чтобы отправить только одно сообщение на клиента)
            const groupedByClient = this.groupTrainingsByClient(trainings);
            stats.total_clients = Object.keys(groupedByClient).length;

            console.log(`Уникальных клиентов: ${stats.total_clients}`);

            // Отправляем уведомления
            for (const [clientId, clientData] of Object.entries(groupedByClient)) {
                try {
                    // Получаем статус отзывов клиента
                    const reviewStatusResult = await pool.query(
                        'SELECT review_2gis, review_yandex FROM clients WHERE id = $1',
                        [parseInt(clientId)]
                    );

                    if (reviewStatusResult.rows.length === 0) {
                        console.log(`Клиент ${clientId} не найден в БД`);
                        continue;
                    }

                    const { review_2gis, review_yandex } = reviewStatusResult.rows[0];

                    // Определяем, какие ссылки показывать
                    const request2gis = !review_2gis;
                    const requestYandex = !review_yandex;

                    // Если оба отзыва уже оставлены, пропускаем
                    if (!request2gis && !requestYandex) {
                        console.log(`✓ Пропущен клиент ${clientData.client_name} (ID: ${clientId}) - все отзывы уже оставлены`);
                        stats.skipped_no_links++;
                        continue;
                    }

                    // Получаем статистику участников
                    const participantStats = await this.getParticipantStats(clientData, parseInt(clientId));

                    // Формируем сообщение
                    const message = this.formatNotificationMessage(clientData, participantStats, request2gis, requestYandex);

                    if (!message) {
                        stats.skipped_no_links++;
                        continue;
                    }

                    // Отправляем уведомление
                    const result = await this.sendNotification(clientData.telegram_id, message);

                    if (result.success) {
                        stats.sent++;
                        
                        // Определяем основное количество для логирования
                        const mainCount = participantStats.clientParticipated 
                            ? participantStats.clientCount 
                            : (participantStats.children[0]?.count || 0);

                        await this.logNotification(
                            parseInt(clientId),
                            clientData.telegram_id,
                            mainCount,
                            participantStats.participantType,
                            participantStats.participantDetails,
                            message,
                            request2gis,
                            requestYandex
                        );
                        
                        console.log(`✓ Отправлено клиенту ${clientData.client_name} (ID: ${clientId})`);
                    } else {
                        stats.failed++;
                        stats.errors.push({
                            client_id: clientId,
                            client_name: clientData.client_name,
                            error: result.error
                        });
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

            console.log(`[${new Date().toISOString()}] Завершено. Отправлено: ${stats.sent}, Пропущено: ${stats.skipped_no_links}, Ошибок: ${stats.failed}`);

        } catch (error) {
            console.error('Критическая ошибка при отправке запросов на отзывы:', error);
            throw error;
        }

        return stats;
    }
}

module.exports = new ReviewNotificationService();

