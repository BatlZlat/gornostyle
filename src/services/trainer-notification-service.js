const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../db/index');

// Создаем экземпляры ботов
const clientBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const adminBot = new TelegramBot(process.env.ADMIN_BOT_TOKEN, { polling: false });

/**
 * Функция для форматирования даты
 */
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

/**
 * Функция для форматирования времени
 */
function formatTime(timeStr) {
    if (!timeStr) return 'Не указано';
    return timeStr.slice(0, 5); // HH:MM
}

/**
 * Функция для получения названия типа снаряжения
 */
function getEquipmentTypeName(equipmentType) {
    if (!equipmentType) return 'Не указано';
    switch (equipmentType.toLowerCase()) {
        case 'ski': return 'Горнолыжная тренировка';
        case 'snowboard': return 'Сноуборд';
        default: return equipmentType;
    }
}

/**
 * Уведомление клиенту о назначении тренера
 * @param {Object} params - Параметры уведомления
 * @param {string} params.clientTelegramId - Telegram ID клиента
 * @param {Object} params.training - Данные о тренировке
 * @param {Object} params.trainer - Данные о тренере
 */
async function notifyClientAboutTrainerAssignment({ clientTelegramId, training, trainer }) {
    try {
        if (!clientTelegramId) {
            console.log('❌ Telegram ID клиента не указан, уведомление не отправлено');
            return;
        }

        const message = 
            '👨‍🏫 <b>Вам назначен тренер!</b>\n\n' +
            `📅 <b>Дата:</b> ${formatDate(training.preferred_date)}\n` +
            `⏰ <b>Время:</b> ${formatTime(training.preferred_time)}\n` +
            `⏱ <b>Длительность:</b> ${training.duration} минут\n` +
            `🎿 <b>Тип:</b> ${getEquipmentTypeName(training.equipment_type)}\n\n` +
            `👤 <b>Ваш тренер:</b> ${trainer.full_name}\n` +
            `📱 <b>Телефон тренера:</b> ${trainer.phone}\n\n` +
            `💡 <i>Тренер свяжется с вами перед началом тренировки</i>`;

        await clientBot.sendMessage(clientTelegramId, message, { 
            parse_mode: 'HTML',
            disable_notification: false 
        });

        console.log(`✅ Уведомление о назначении тренера отправлено клиенту ${clientTelegramId}`);
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомления клиенту о назначении тренера:', error);
    }
}

/**
 * Уведомление администраторам о назначении тренера
 * @param {Object} params - Параметры уведомления
 * @param {Object} params.client - Данные о клиенте
 * @param {Object} params.training - Данные о тренировке
 * @param {Object} params.trainer - Данные о тренере
 */
async function notifyAdminAboutTrainerAssignment({ client, training, trainer }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('❌ ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = 
            '✅ <b>Тренер назначен на индивидуальную тренировку</b>\n\n' +
            `👤 <b>Клиент:</b> ${client.full_name}\n` +
            `📱 <b>Телефон клиента:</b> ${client.phone}\n\n` +
            `📅 <b>Дата:</b> ${formatDate(training.preferred_date)}\n` +
            `⏰ <b>Время:</b> ${formatTime(training.preferred_time)}\n` +
            `⏱ <b>Длительность:</b> ${training.duration} минут\n` +
            `🎿 <b>Тип:</b> ${getEquipmentTypeName(training.equipment_type)}\n` +
            `🏂 <b>Тренажер:</b> ${training.simulator_name || 'Тренажер ' + training.simulator_id}\n\n` +
            `👨‍🏫 <b>Назначен тренер:</b> ${trainer.full_name}\n` +
            `📱 <b>Телефон тренера:</b> ${trainer.phone}\n\n` +
            `💰 <b>Стоимость:</b> ${training.price} ₽`;

        for (const adminId of adminIds) {
            await adminBot.sendMessage(adminId, message, { parse_mode: 'HTML' });
        }

        console.log(`✅ Уведомление о назначении тренера отправлено администраторам`);
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомления администратору о назначении тренера:', error);
    }
}

/**
 * Уведомление клиенту об изменении тренера
 * @param {Object} params - Параметры уведомления
 * @param {string} params.clientTelegramId - Telegram ID клиента
 * @param {Object} params.training - Данные о тренировке
 * @param {Object} params.oldTrainer - Данные о предыдущем тренере
 * @param {Object} params.newTrainer - Данные о новом тренере
 */
async function notifyClientAboutTrainerChange({ clientTelegramId, training, oldTrainer, newTrainer }) {
    try {
        if (!clientTelegramId) {
            console.log('❌ Telegram ID клиента не указан, уведомление не отправлено');
            return;
        }

        const message = 
            '🔄 <b>Изменение тренера</b>\n\n' +
            `📅 <b>Дата:</b> ${formatDate(training.preferred_date)}\n` +
            `⏰ <b>Время:</b> ${formatTime(training.preferred_time)}\n` +
            `🎿 <b>Тип:</b> ${getEquipmentTypeName(training.equipment_type)}\n\n` +
            `👤 <b>Предыдущий тренер:</b> ${oldTrainer.full_name}\n\n` +
            `👨‍🏫 <b>Новый тренер:</b> ${newTrainer.full_name}\n` +
            `📱 <b>Телефон:</b> ${newTrainer.phone}\n\n` +
            `💡 <i>Приносим извинения за вынужденную подмену. При необходимости причину можете узнать у администратора:</i>\n` +
            `📞 <b>Номер администратора:</b> ${process.env.ADMIN_PHONE || '+7 (3452) 123-45-67'}`;

        await clientBot.sendMessage(clientTelegramId, message, { 
            parse_mode: 'HTML',
            disable_notification: false 
        });

        console.log(`✅ Уведомление об изменении тренера отправлено клиенту ${clientTelegramId}`);
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомления клиенту об изменении тренера:', error);
    }
}

/**
 * Уведомление администраторам об изменении тренера
 * @param {Object} params - Параметры уведомления
 * @param {Object} params.client - Данные о клиенте
 * @param {Object} params.training - Данные о тренировке
 * @param {Object} params.oldTrainer - Данные о предыдущем тренере
 * @param {Object} params.newTrainer - Данные о новом тренере
 */
async function notifyAdminAboutTrainerChange({ client, training, oldTrainer, newTrainer }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('❌ ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = 
            '🔄 <b>Тренер изменен на индивидуальной тренировке</b>\n\n' +
            `👤 <b>Клиент:</b> ${client.full_name}\n` +
            `📱 <b>Телефон клиента:</b> ${client.phone}\n\n` +
            `📅 <b>Дата:</b> ${formatDate(training.preferred_date)}\n` +
            `⏰ <b>Время:</b> ${formatTime(training.preferred_time)}\n` +
            `⏱ <b>Длительность:</b> ${training.duration} минут\n` +
            `🎿 <b>Тип:</b> ${getEquipmentTypeName(training.equipment_type)}\n\n` +
            `❌ <b>Предыдущий тренер:</b> ${oldTrainer.full_name}\n` +
            `✅ <b>Новый тренер:</b> ${newTrainer.full_name}\n` +
            `📱 <b>Телефон нового тренера:</b> ${newTrainer.phone}\n\n` +
            `💰 <b>Стоимость:</b> ${training.price} ₽`;

        for (const adminId of adminIds) {
            await adminBot.sendMessage(adminId, message, { parse_mode: 'HTML' });
        }

        console.log(`✅ Уведомление об изменении тренера отправлено администраторам`);
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомления администратору об изменении тренера:', error);
    }
}

/**
 * Получение полных данных о тренировке и клиенте из БД
 * @param {number} trainingId - ID индивидуальной тренировки
 * @returns {Object} Данные о тренировке и клиенте
 */
async function getTrainingAndClientData(trainingId) {
    const query = `
        SELECT 
            its.*,
            c.full_name as client_full_name,
            c.phone as client_phone,
            c.telegram_id as client_telegram_id,
            s.name as simulator_name
        FROM individual_training_sessions its
        LEFT JOIN clients c ON its.client_id = c.id
        LEFT JOIN simulators s ON its.simulator_id = s.id
        WHERE its.id = $1
    `;
    
    const result = await pool.query(query, [trainingId]);
    
    if (result.rows.length === 0) {
        throw new Error(`Тренировка с ID ${trainingId} не найдена`);
    }
    
    return result.rows[0];
}

module.exports = {
    notifyClientAboutTrainerAssignment,
    notifyAdminAboutTrainerAssignment,
    notifyClientAboutTrainerChange,
    notifyAdminAboutTrainerChange,
    getTrainingAndClientData
};

