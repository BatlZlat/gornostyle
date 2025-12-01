const TelegramBot = require('node-telegram-bot-api');

// Создаем экземпляр бота для уведомлений администратора
const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN, { polling: false });

// Создаем экземпляр бота для уведомлений инструкторов Кулиги
const instructorBot = process.env.KULIGA_INSTRUKTOR_BOT 
    ? new TelegramBot(process.env.KULIGA_INSTRUKTOR_BOT, { polling: false })
    : null;

// Функция для форматирования даты
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

// Функция для форматирования времени (HH:MM)
function formatTime(timeStr) {
    if (!timeStr) return '';
    return timeStr.toString().slice(0, 5);
}

// Функция для получения названия места по location
function getLocationDisplayName(location) {
    if (!location) {
        return 'База отдыха «Кулига-Клуб»'; // Fallback
    }
    const locationNames = {
        'kuliga': 'База отдыха «Кулига-Клуб»',
        'vorona': 'Воронинские горки'
    };
    return locationNames[location] || 'База отдыха «Кулига-Клуб»';
}

// Функция для отправки уведомления о создании расписания
async function notifyScheduleCreated(month) {
    try {
        const message = `✅ Расписание на ${month} успешно создано!`;
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message);
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления о созданных тренировках из шаблонов
async function notifyRecurringTrainingsCreated(month, count) {
    try {
        const message = `📅 *Постоянное расписание*\n\n` +
            `Автоматически создано ${count} ${getTrainingWord(count)} из шаблонов на ${month}.`;
        
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о созданных тренировках:', error);
    }
}

// Функция для отправки уведомления о конфликтах при создании тренировок
async function notifyRecurringTrainingConflict(conflicts) {
    try {
        if (!conflicts || conflicts.length === 0) return;
        
        let message = `⚠️ *Конфликты при создании постоянного расписания*\n\n`;
        message += `Не удалось создать ${conflicts.length} ${getTrainingWord(conflicts.length)}:\n\n`;
        
        // Ограничиваем количество конфликтов в сообщении (максимум 10)
        const maxConflicts = 10;
        const displayConflicts = conflicts.slice(0, maxConflicts);
        
        for (const conflict of displayConflicts) {
            message += `📌 *${conflict.template_name}*\n`;
            message += `   📅 Дата: ${formatDate(conflict.date)}\n`;
            message += `   ⏰ Время: ${conflict.time}\n`;
            message += `   🏂 Тренажер: ${conflict.simulator}\n`;
            
            if (conflict.conflict_with) {
                message += `   ⚡ Конфликт с: ${conflict.conflict_with}\n`;
            } else if (conflict.error) {
                message += `   ❌ Ошибка: ${conflict.error}\n`;
            }
            message += `\n`;
        }
        
        if (conflicts.length > maxConflicts) {
            message += `\n... и ещё ${conflicts.length - maxConflicts} ${getTrainingWord(conflicts.length - maxConflicts)}`;
        }
        
        message += `\n💡 Проверьте расписание и при необходимости создайте тренировки вручную.`;
        
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о конфликтах:', error);
    }
}

// Вспомогательная функция для склонения слова "тренировка"
function getTrainingWord(count) {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    
    if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return 'тренировок';
    }
    
    if (lastDigit === 1) {
        return 'тренировка';
    }
    
    if (lastDigit >= 2 && lastDigit <= 4) {
        return 'тренировки';
    }
    
    return 'тренировок';
}

// Функция для отправки уведомления о новой заявке на тренировку
async function notifyNewTrainingRequest(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Форматируем дату в формат д.м.г
        const formattedDate = formatDate(trainingData.date);

        // Формируем строку с username (если есть)
        const usernameDisplay = trainingData.telegram_username ? ` (*${trainingData.telegram_username}*)` : '';
        
        const message = `
🔔 *Новая заявка на тренировку!*

👤 *Клиент:* ${trainingData.client_name}${usernameDisplay}
📱 *Телефон:* ${trainingData.client_phone || 'Не указан'}
📅 *Дата:* ${formattedDate}
⏰ *Время:* ${trainingData.time}
🎯 *Тип:* ${trainingData.type}
👥 *Группа:* ${trainingData.group_name || 'Индивидуальная'}
👨‍🏫 *Тренер:* ${trainingData.trainer_name}
💰 *Стоимость:* ${trainingData.price} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления о новой индивидуальной тренировке
async function notifyNewIndividualTraining(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Функция для перевода типа снаряжения в читаемый вид
        const getEquipmentTypeName = (equipmentType) => {
            if (!equipmentType) return 'Не указано';
            switch (equipmentType.toLowerCase()) {
                case 'ski': return 'Горнолыжная тренировка';
                case 'snowboard': return 'Сноуборд';
                default: return equipmentType;
            }
        };

        const message = 
            '🔔 *Новая индивидуальная тренировка!*\n\n' +
            `👤 *Участник:* ${trainingData.client_name} (${trainingData.client_age} лет)\n` +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${trainingData.date}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `⏱ *Длительность:* ${trainingData.duration || 'Не указано'} мин\n` +
            `🎿 *Тип:* ${getEquipmentTypeName(trainingData.equipment_type)}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name}\n` +
            `💰 *Стоимость:* ${trainingData.price} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новой тренировке:', error);
    }
}

// Функция для отправки уведомления о новой записи на групповую тренировку
async function notifyNewGroupTrainingParticipant(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Форматируем дату из YYYY-MM-DD в DD.MM.YYYY
        const date = new Date(trainingData.session_date);
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
        
        // Форматируем время в ЧЧ:ММ
        const [hours, minutes] = trainingData.start_time.split(':');
        const formattedTime = `${hours}:${minutes}`;

        const message = `
👥 *Новая запись на групповую тренировку!*

👤 *Клиент:* ${trainingData.client_name}
${trainingData.child_name ? `👶 *Ребенок:* ${trainingData.child_name}\n` : ''}📱 *Телефон:* ${trainingData.client_phone}
👥 *Группа:* ${trainingData.group_name}
🎿 *Тренажер:* ${trainingData.simulator_name}
💰 *Стоимость:* ${trainingData.price} руб.
📅 *Дата:* ${formattedDate} (${dayOfWeek})
⏰ *Время:* ${formattedTime}
👥 *Участников:* ${trainingData.current_participants}/${trainingData.max_participants}`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новой записи на групповую тренировку:', error);
    }
}

// Уведомление: создана зимняя групповая тренировка администратором (естественный склон)
async function notifyAdminWinterGroupTrainingCreatedByAdmin(data) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Получаем дату из правильного поля (date или session_date)
        const dateValue = data.date || data.session_date;
        let dateObj;
        
        if (dateValue instanceof Date) {
            dateObj = dateValue;
        } else if (typeof dateValue === 'string') {
            dateObj = new Date(dateValue);
        } else {
            console.error('Ошибка: дата не найдена в данных', data);
            dateObj = new Date();
        }
        
        // Форматируем дату в DD.MM.YYYY
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        const formattedDate = `${day}.${month}.${year}`;
        
        // Форматируем время в ЧЧ:ММ
        const timeFormatted = String(data.start_time || '').substring(0, 5);
        
        // Вычисляем цену за человека
        const totalPrice = (data.price != null) ? Number(data.price) : null;
        const maxParticipants = (data.max_participants != null) ? Number(data.max_participants) : null;
        const pricePerPerson = (totalPrice != null && maxParticipants && maxParticipants > 0)
            ? (totalPrice / maxParticipants)
            : null;

        // Получаем location из данных или используем fallback
        const location = data.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        
        // Формируем сообщение о создании тренировки
        let message = `✅ *Создана зимняя групповая тренировка на естественном склоне в ${locationName}*\n\n`;
        
        message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
        message += `⏰ *Время:* ${timeFormatted}\n`;
        
        if (data.group_name) {
            message += `👥 *Группа:* ${data.group_name}\n`;
        }
        
        if (data.trainer_name) {
            message += `👨‍🏫 *Тренер:* ${data.trainer_name}\n`;
        }
        
        if (maxParticipants != null) {
            message += `🧑‍🤝‍🧑 *Мест:* ${maxParticipants}\n`;
        }
        
        if (pricePerPerson != null) {
            message += `💳 *Цена за человека:* ${pricePerPerson.toFixed(2)} ₽\n`;
        }
        
        if (totalPrice != null) {
            message += `💰 *Цена (общая):* ${totalPrice.toFixed(2)} ₽`;
        }

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о создании зимней групповой тренировки:', error);
    }
}

// Уведомление: новая запись на групповую зимнюю тренировку (естественный склон)
async function notifyAdminWinterGroupTrainingCreated(data) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Получаем дату из правильного поля (date или session_date)
        const dateValue = data.date || data.session_date;
        let dateObj;
        
        if (dateValue instanceof Date) {
            dateObj = dateValue;
        } else if (typeof dateValue === 'string') {
            dateObj = new Date(dateValue);
        } else {
            console.error('Ошибка: дата не найдена в данных', data);
            dateObj = new Date();
        }
        
        // Форматируем дату в DD.MM.YYYY
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        const formattedDate = `${day}.${month}.${year}`;
        
        // Форматируем время в ЧЧ:ММ
        const timeFormatted = String(data.start_time || '').substring(0, 5);
        
        // Вычисляем цену за человека
        const totalPrice = (data.price != null) ? Number(data.price) : null;
        const maxParticipants = (data.max_participants != null) ? Number(data.max_participants) : null;
        const pricePerPerson = (totalPrice != null && maxParticipants && maxParticipants > 0)
            ? (totalPrice / maxParticipants)
            : null;

        // Получаем location из данных или используем fallback
        const location = data.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        
        // Формируем сообщение согласно требованиям
        let message = `👥 *Новая запись на групповую Зимнюю тренировку в ${locationName}!*\n\n`;
        
        if (data.client_name) {
            message += `👤 *Клиент:* ${data.client_name}\n`;
        }
        
        if (data.child_name) {
            message += `👶 *Ребенок:* ${data.child_name}\n`;
        }
        
        if (data.client_phone) {
            message += `📱 *Телефон:* ${data.client_phone}\n`;
        }
        
        if (data.group_name) {
            message += `👥 *Группа:* ${data.group_name}\n`;
        }
        
        if (data.used_subscription) {
            message += `🎫 *Оплата:* По абонементу "${data.subscription_name}"\n`;
            message += `📊 *Занятий осталось:* ${data.remaining_sessions}/${data.total_sessions}\n`;
            // Показываем стоимость занятия по абонементу (цена абонемента / количество занятий)
            if (data.subscription_price_per_session != null) {
                message += `💵 *Стоимость занятия по абонементу:* ${Number(data.subscription_price_per_session).toFixed(2)} руб.\n`;
            }
        } else if (pricePerPerson != null) {
            message += `💰 *Стоимость:* ${pricePerPerson.toFixed(2)} руб.\n`;
        }
        
        message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
        message += `⏰ *Время:* ${timeFormatted}\n`;
        
        if (data.current_participants != null && data.max_participants != null) {
            message += `👥 *Участников:* ${data.current_participants}/${data.max_participants}`;
        }

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о записи на зимнюю групповую тренировку:', error);
    }
}

// Функция для отправки уведомления об отмене групповой тренировки
async function notifyAdminGroupTrainingCancellation(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Определяем, является ли это зимней тренировкой (если нет тренажера)
        const isWinterTraining = !trainingData.simulator_name;
        
        // Формируем строку с информацией о тренажере/месте
        let locationLine = '';
        if (isWinterTraining) {
            // Получаем location из данных или используем fallback
            const location = trainingData.location || 'kuliga';
            const locationName = getLocationDisplayName(location);
            locationLine = `🏔️ *Место:* ${locationName}\n`;
        } else {
            locationLine = `🎿 *Тренажер:* ${trainingData.simulator_name}\n`;
        }

        // Формируем строку с информацией о возврате
        let refundLine = '';
        if (trainingData.used_subscription) {
            refundLine = '💰 *Возврат занятия на абонемент*';
        } else {
            refundLine = `💰 *Возврат:* ${Number(trainingData.refund).toFixed(2)} руб.`;
        }

        const message =
            (isWinterTraining ? '❌ *Отмена групповой зимней тренировки!*\n\n' : '❌ *Отмена групповой тренировки!*\n\n') +
            `👤 *Клиент:* ${trainingData.client_name}\n` +
            (trainingData.participant_name ? `👤 *Участник:* ${trainingData.participant_name}\n` : '') +
            `📞 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `👥 *Группа:* ${trainingData.group_name}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name}\n` +
            locationLine +
            `🪑 *Мест осталось:* ${trainingData.seats_left}\n` +
            refundLine;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления об удалении участника из тренировки
async function notifyAdminParticipantRemoved(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Определяем, является ли тренировка зимней (естественный склон)
        const isWinterTraining = !trainingData.simulator_id;
        
        // Получаем location для зимних тренировок
        let locationName = '';
        if (isWinterTraining) {
            const location = trainingData.location || 'kuliga';
            locationName = getLocationDisplayName(location);
        }
        
        // Заголовок зависит от типа тренировки
        const header = isWinterTraining 
            ? `👥 *Удаление участника из тренировки на естественном склоне в ${locationName}!*`
            : '👥 *Удаление участника из тренировки!*';
        
        // Формируем строку с информацией о тренажере/месте
        let locationLine = '';
        if (isWinterTraining) {
            locationLine = `🏔️ *Место:* ${locationName}\n`;
        } else {
            locationLine = `🎿 *Тренажер:* ${trainingData.simulator_name}\n`;
        }

        // Формируем строку с информацией о возврате
        let refundLine = '';
        if (trainingData.used_subscription) {
            refundLine = '💰 *Возврат занятия на абонемент*\n';
            if (trainingData.subscription_name) {
                refundLine += `🎫 *Абонемент:* ${trainingData.subscription_name}\n`;
            }
            if (trainingData.remaining_sessions != null && trainingData.total_sessions != null) {
                refundLine += `📊 *Занятий осталось:* ${trainingData.remaining_sessions}/${trainingData.total_sessions}`;
            }
        } else {
            refundLine = `💰 *Возврат:* ${Number(trainingData.refund).toFixed(2)} руб.`;
        }

        const message =
            `${header}\n\n` +
            `👤 *Клиент:* ${trainingData.client_name}\n` +
            (trainingData.participant_name ? `👶 *Участник:* ${trainingData.participant_name} (${trainingData.age} лет)\n` : `👤 *Возраст:* ${trainingData.age} лет\n`) +
            `📞 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${formatTime(trainingData.time)}\n` +
            `👥 *Группа:* ${trainingData.group_name}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name}\n` +
            locationLine +
            `🪑 *Мест осталось:* ${trainingData.seats_left}\n` +
            refundLine;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления об отмене индивидуальной тренировки
async function notifyAdminIndividualTrainingCancellation(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = 
            '❌ *Отмена индивидуальной тренировки!*\n\n' +
            `👨‍💼 *Клиент:* ${trainingData.client_name}\n` +
            `👤 *Участник:* ${trainingData.participant_name} (${trainingData.participant_age} лет)\n` +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name}\n` +
            `💰 *Стоимость:* ${trainingData.price} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления об отмене индивидуальной тренировки естественного склона
async function notifyAdminNaturalSlopeTrainingCancellation(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Определяем заголовок в зависимости от типа тренировки
        // Явно проверяем booking_type, а не наличие инструктора
        const isGroupTraining = trainingData.booking_type === 'group';
        const header = isGroupTraining 
            ? '❌ *Отмена групповой зимней тренировки!*\n\n'
            : '❌ *Отмена индивидуальной тренировки на естественном склоне!*\n\n';

        // Формируем строку с информацией о возврате
        let refundLine = '';
        if (trainingData.used_subscription) {
            refundLine = '💰 *Возврат занятия на абонемент*';
            if (trainingData.subscription_name) {
                refundLine += `\n🎫 *Абонемент:* ${trainingData.subscription_name}`;
            }
            if (trainingData.subscription_remaining_sessions != null && trainingData.subscription_total_sessions != null) {
                refundLine += `\n📊 *Занятий осталось:* ${trainingData.subscription_remaining_sessions}/${trainingData.subscription_total_sessions}`;
            }
        } else {
            refundLine = `💰 *Возврат:* ${Number(trainingData.refund || 0).toFixed(2)} руб.`;
        }

        let message = header +
            `👨‍💼 *Клиент:* ${trainingData.client_name}\n`;
        
        // Для групповых тренировок показываем количество участников
        if (trainingData.participant_name && trainingData.participant_name !== '—') {
            if (isGroupTraining && trainingData.participants_count > 1) {
                message += `👥 *Участники (${trainingData.participants_count}):* ${trainingData.participant_name}\n`;
            } else {
                message += `👤 *Участник:* ${trainingData.participant_name}\n`;
            }
        }
        
        message += `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n`;
        
        // Для групповых тренировок показываем тип спорта
        if (isGroupTraining && trainingData.sport_type) {
            const sportTypeText = trainingData.sport_type === 'ski' ? 'лыжи' : 'сноуборд';
            message += `🎿 *Вид спорта:* ${sportTypeText}\n`;
        }
        
        if (isGroupTraining && trainingData.group_name) {
            message += `👥 *Группа:* ${trainingData.group_name}\n`;
        }
        
        if (trainingData.instructor_name || (trainingData.trainer_name && trainingData.trainer_name !== 'Не указан')) {
            message += `👨‍🏫 *Инструктор:* ${trainingData.instructor_name || trainingData.trainer_name}\n`;
        }
        
        // Получаем location из данных или используем fallback
        const location = trainingData.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        message += `🏔️ *Место:* ${locationName}\n` +
            refundLine;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления об отмене тренировки естественного склона:', error);
    }
}

// Функция для отправки уведомления о новой записи на индивидуальную тренировку естественного склона
async function notifyAdminNaturalSlopeTrainingBooking(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Определяем тип тренировки
        const trainingType = trainingData.booking_type === 'group' ? 'групповую' : 'индивидуальную';
        const participantsInfo = trainingData.booking_type === 'group' 
            ? `👥 *Участники (${trainingData.participants_count || 1}):* ${trainingData.participant_name}`
            : `👤 *Участник:* ${trainingData.participant_name}`;

        // Форматируем дату с днем недели
        let formattedDateWithDay = 'Дата не указана';
        try {
            // Пытаемся распарсить дату в разных форматах
            let dateObj;
            if (trainingData.date) {
                const dateStr = String(trainingData.date).trim();
                
                // Если это строка в формате YYYY-MM-DD
                if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                    dateObj = new Date(dateStr + 'T00:00:00');
                } 
                // Если это строка в формате д.м.г (например, "22.11.2025" или "22.11.2025 (СБ)")
                else if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}/)) {
                    // Убираем день недели в скобках, если есть
                    const datePart = dateStr.split(' (')[0];
                    const [day, month, year] = datePart.split('.');
                    dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                }
                // Пытаемся распарсить как обычную дату
                else {
                    dateObj = new Date(dateStr);
                }
                
                // Проверяем, что дата валидна
                if (!isNaN(dateObj.getTime())) {
                    const day = dateObj.getDate().toString().padStart(2, '0');
                    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const year = dateObj.getFullYear();
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
                    formattedDateWithDay = `${day}.${month}.${year} (${dayOfWeek})`;
                } else {
                    console.error('❌ Неверный формат даты в notifyAdminNaturalSlopeTrainingBooking:', trainingData.date);
                }
            }
        } catch (dateError) {
            console.error('❌ Ошибка форматирования даты в notifyAdminNaturalSlopeTrainingBooking:', dateError, trainingData.date);
        }

        // Получаем название места
        const location = trainingData.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        
        const message = 
            `✅ *Новая запись на ${trainingType} тренировку!*\n\n` +
            `👨‍💼 *Клиент:* ${trainingData.client_name}\n` +
            `${participantsInfo}\n` +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `👨‍🏫 *Инструктор:* ${trainingData.instructor_name || 'Не указан'}\n` +
            `📅 *Дата:* ${formattedDateWithDay}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `🏔️ *Место:* ${locationName}\n` +
            `💰 *Стоимость:* ${Number(trainingData.price).toFixed(2)} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о записи на тренировку естественного склона:', error);
    }
}

// Функция для отправки уведомления инструктору о новой записи
async function notifyInstructorKuligaTrainingBooking(trainingData) {
    try {
        console.log(`[NOTIFY] Вызов notifyInstructorKuligaTrainingBooking для инструктора: ${trainingData.instructor_name || 'Не указан'}`);
        console.log(`[NOTIFY] Данные:`, {
            instructor_telegram_id: trainingData.instructor_telegram_id,
            location: trainingData.location,
            booking_type: trainingData.booking_type,
            date: trainingData.date
        });
        
        if (!instructorBot) {
            console.log('[NOTIFY] ❌ Бот инструкторов Кулиги не настроен (KULIGA_INSTRUKTOR_BOT)');
            return;
        }

        if (!trainingData.instructor_telegram_id) {
            console.log(`[NOTIFY] ❌ Инструктор ${trainingData.instructor_name} не зарегистрирован в Telegram боте (telegram_id отсутствует)`);
            return;
        }

        // Рассчитываем сумму для инструктора (за вычетом процента админа)
        const totalPrice = Number(trainingData.price);
        const adminPercentage = Number(trainingData.admin_percentage || 20);
        const instructorEarnings = totalPrice * (1 - adminPercentage / 100);

        // Определяем тип тренировки
        const trainingType = trainingData.booking_type === 'group' ? 'Групповая' : 'Индивидуальная';

        // Форматируем дату с днем недели
        const date = new Date(trainingData.date);
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
        const formattedDateWithDay = `${formatDate(trainingData.date)} (${dayOfWeek})`;

        // Формируем строку с участниками
        const participantsCount = trainingData.participants_count || (trainingData.participant_name ? trainingData.participant_name.split(',').length : 1);
        const participantLine = trainingData.booking_type === 'group' && participantsCount > 1
            ? `👤 *Участники (${participantsCount}):* ${trainingData.participant_name}`
            : `👤 *Участник:* ${trainingData.participant_name}`;

        // Получаем название места
        const location = trainingData.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        
        const message = 
            '🎉 *Новая запись на вашу тренировку!*\n\n' +
            `*${trainingType}*\n\n` +
            `👨‍💼 *Клиент:* ${trainingData.client_name || trainingData.participant_name}\n` +
            `${participantLine}\n` +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formattedDateWithDay}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `🏔️ *Место:* ${locationName}\n\n` +
            `💵 *Ваш заработок:* ${instructorEarnings.toFixed(2)} руб.`;

        await instructorBot.sendMessage(trainingData.instructor_telegram_id, message, { parse_mode: 'Markdown' });
        console.log(`[NOTIFY] ✅ Уведомление отправлено инструктору ${trainingData.instructor_name} (Telegram ID: ${trainingData.instructor_telegram_id}, Location: ${locationName})`);
    } catch (error) {
        console.error('[NOTIFY] ❌ Ошибка при отправке уведомления инструктору:', error);
        console.error('[NOTIFY] Детали ошибки:', {
            instructor_name: trainingData.instructor_name,
            instructor_telegram_id: trainingData.instructor_telegram_id,
            error_message: error.message,
            error_stack: error.stack
        });
    }
}

// Функция для отправки уведомления инструктору об отмене тренировки
async function notifyInstructorKuligaTrainingCancellation(cancellationData) {
    try {
        if (!instructorBot) {
            console.log('Бот инструкторов Кулиги не настроен (KULIGA_INSTRUKTOR_BOT)');
            return;
        }

        // Получаем telegram_id инструктора по имени (если не передан напрямую)
        if (!cancellationData.instructor_telegram_id && cancellationData.instructor_name) {
            // Используем Pool напрямую, так как файла pool.js может не быть
            const { Pool } = require('pg');
            const pool = new Pool({
                host: process.env.DB_HOST || '127.0.0.1',
                port: process.env.DB_PORT || 6432,
                database: process.env.DB_NAME,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
            });
            
            try {
                const instructorRes = await pool.query(
                    'SELECT telegram_id FROM kuliga_instructors WHERE full_name = $1',
                    [cancellationData.instructor_name]
                );
                
                if (instructorRes.rows.length > 0) {
                    cancellationData.instructor_telegram_id = instructorRes.rows[0].telegram_id;
                }
            } finally {
                await pool.end();
            }
        }

        if (!cancellationData.instructor_telegram_id) {
            console.log(`Инструктор ${cancellationData.instructor_name} не зарегистрирован в Telegram боте`);
            return;
        }

        // Форматируем дату с днем недели
        const date = new Date(cancellationData.date);
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
        const formattedDateWithDay = `${formatDate(cancellationData.date)} (${dayOfWeek})`;
        
        // Форматируем время в формат HH:MM (убираем секунды)
        let formattedTime = cancellationData.time;
        if (formattedTime && formattedTime.includes(':')) {
            const timeParts = formattedTime.split(':');
            formattedTime = `${timeParts[0]}:${timeParts[1]}`;
        }

        // Определяем, кто отменил тренировку (клиент или администратор)
        const cancelledBy = cancellationData.cancelled_by === 'admin' ? 'администратором' : 'клиентом';
        
        // Получаем location из данных или используем fallback
        const location = cancellationData.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        
        const message = 
            '❌ *Отмена тренировки*\n\n' +
            `👨‍💼 *Клиент:* ${cancellationData.client_name}\n` +
            `👤 *Участник:* ${cancellationData.participant_name}\n` +
            `📱 *Телефон:* ${cancellationData.client_phone || 'не указан'}\n` +
            `📅 *Дата:* ${formattedDateWithDay}\n` +
            `⏰ *Время:* ${formattedTime}\n` +
            `🏔️ *Место:* ${locationName}\n\n` +
            `Тренировка была отменена ${cancelledBy}.`;

        await instructorBot.sendMessage(cancellationData.instructor_telegram_id, message, { parse_mode: 'Markdown' });
        console.log(`✅ Уведомление об отмене отправлено инструктору ${cancellationData.instructor_name} (ID: ${cancellationData.instructor_telegram_id})`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления инструктору об отмене:', error);
    }
}

// Уведомление о неудачном платеже
async function notifyAdminFailedPayment({ amount, wallet_number, date, time }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
❌ *Платеж не обработан!*

💵 *Сумма:* ${amount} руб.
📝 *Номер кошелька:* ${wallet_number}
📅 *Дата:* ${date}
⏰ *Время:* ${time}

⚠️ Автор платежа не найден. Деньги не зачислены.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о неудачном платеже:', error);
    }
}

// Функция для отправки уведомления о пополнении кошелька
async function notifyAdminWalletRefilled({ clientName, amount, walletNumber, balance }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
✅ *Пополнение кошелька!*

👤 *Клиент:* ${clientName}
💳 *Кошелек:* ${walletNumber}
💰 *Сумма пополнения:* ${amount} руб.
💵 *Итоговый баланс:* ${balance} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о пополнении кошелька:', error);
    }
}

// Функция для отправки уведомления о покупке сертификата
async function notifyAdminCertificatePurchase({ clientName, certificateNumber, nominalValue, purchaseDate }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const formattedDate = new Date(purchaseDate).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric'
        });

        const message = `
✅ *Покупка сертификата!*

👤 *Клиент:* ${clientName}
🎫 *Номер сертификата:* ${certificateNumber}
💰 *Номинал сертификата:* ${nominalValue} руб.
📅 *Дата приобретения:* ${formattedDate}`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о покупке сертификата:', error);
    }
}

// Функция для отправки уведомления об активации сертификата
async function notifyAdminCertificateActivation({ clientName, certificateNumber, nominalValue, activationDate }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const formattedDate = new Date(activationDate).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric'
        });

        const message = `
🔑 *Активация сертификата!*

👤 *Клиент:* ${clientName}
🎫 *Номер сертификата:* ${certificateNumber}
💰 *Номинал сертификата:* ${nominalValue} руб.
📅 *Дата активации:* ${formattedDate}`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления об активации сертификата:', error);
    }
}

// Функция для вычисления возраста по дате рождения
function calculateAge(birthDate) {
    if (!birthDate) {
        console.warn('calculateAge: birthDate is null or undefined');
        return null;
    }
    
    try {
        const today = new Date();
        const birth = new Date(birthDate);
        
        // Проверяем, что дата валидна
        if (isNaN(birth.getTime())) {
            console.warn('calculateAge: invalid birthDate:', birthDate);
            return null;
        }
        
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        
        return age;
    } catch (error) {
        console.error('calculateAge error:', error, 'birthDate:', birthDate);
        return null;
    }
}

// Функция для отправки уведомления о покупке сертификата через сайт
async function notifyAdminWebCertificatePurchase({ 
    clientName, 
    clientAge, 
    clientPhone, 
    clientEmail, 
    certificateNumber, 
    nominalValue, 
    designName, 
    recipientName, 
    message: certificateMessage 
}) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        let message = `🎉 <b>Ура! У нас купили сертификат</b>

👤 ${clientName} (${clientAge} лет)
📱 Телефон: ${clientPhone}
📧 Email: ${clientEmail}

🎁 <b>СЕРТИФИКАТ СОЗДАН:</b>
📋 Номер: ${certificateNumber}
💰 Номинал: ${nominalValue} ₽
🎨 Дизайн: ${designName}`;

        if (recipientName) {
            message += `\n👤 Получатель: ${recipientName}`;
        }
        
        if (certificateMessage) {
            message += `\n💌 Сообщение: ${certificateMessage}`;
        }

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'HTML' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о покупке сертификата через сайт:', error);
    }
}

// Функция для отправки уведомления о новом клиенте
async function notifyNewClient({ full_name, birth_date, phone, skill_level, child }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }
        // Вычисляем возраст
        const birth = new Date(birth_date);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        // Формируем текст
        let message = '🎉 *УРА! У нас появился новый клиент!*\n\n';
        message += `👤 *${full_name}* (${age} лет)\n`;
        if (child && child.full_name && child.birth_date) {
            // Вычисляем возраст ребенка
            const childBirth = new Date(child.birth_date);
            let childAge = today.getFullYear() - childBirth.getFullYear();
            const cm = today.getMonth() - childBirth.getMonth();
            if (cm < 0 || (cm === 0 && today.getDate() < childBirth.getDate())) childAge--;
            message += `👶 *Ребенок:* ${child.full_name} (${childAge} лет)\n`;
        }
        message += `📱 *Телефон:* ${phone}\n`;
        message += `📊 *Уровень:* ${skill_level}/10`;
        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новом клиенте:', error);
    }
}

// Функция для отправки уведомления администратору об отмене групповой тренировки
// Функция для уведомления администратора об удалении групповой тренировки инструктором
async function notifyAdminGroupTrainingDeletedByInstructor(data) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const moment = require('moment-timezone');
        const dateObj = moment(data.training.date).tz('Asia/Yekaterinburg');
        const formattedDate = dateObj.format('DD.MM.YYYY');
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.day()];

        const message =
            `❌ *Инструктор удалил групповую тренировку*\n\n` +
            `👨‍🏫 *Инструктор:* ${data.instructorName}\n` +
            `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
            `⏰ *Время:* ${data.training.start_time.substring(0, 5)} - ${data.training.end_time.substring(0, 5)}\n` +
            `⛷️ *Вид спорта:* ${data.training.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n` +
            `📊 *Уровень:* ${data.training.level}\n` +
            `👥 *Отменено бронирований:* ${data.bookingsCount}\n` +
            `💰 *Средства возвращены клиентам*`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления администратору об удалении групповой тренировки:', error);
    }
}

async function notifyAdminGroupTrainingCancellationByAdmin(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Форматируем дату
        const dateObj = new Date(trainingData.session_date);
        const days = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
        const dayOfWeek = days[dateObj.getDay()];
        const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()} (${dayOfWeek})`;
        const startTime = trainingData.start_time ? trainingData.start_time.slice(0,5) : '';
        const endTime = trainingData.end_time ? trainingData.end_time.slice(0,5) : '';
        const duration = trainingData.duration || 60;
        const group = trainingData.group_name || '-';
        const trainer = trainingData.trainer_name || '-';
        const level = trainingData.skill_level || '-';
        const sim = trainingData.simulator_name || `Тренажер ${trainingData.simulator_id}`;
        const priceStr = Number(trainingData.price).toFixed(2);

        // Формируем список участников с возрастом
        let participantsList = '';
        if (trainingData.refunds && trainingData.refunds.length > 0) {
            participantsList = trainingData.refunds.map(refund => {
                const ageStr = refund.age ? ` (${refund.age}лет)` : '';
                return `- ${refund.full_name}${ageStr} ${priceStr}р`;
            }).join('\n');
        }

        const message = `❗️ *Администратор отменил групповую тренировку:*

📅 Дата: ${dateStr}
⏰ Время: ${startTime} - ${endTime}
⏱️ Длительность: ${duration} минут
👥 Группа: ${group}
👨‍🏫 Тренер: ${trainer}
📊 Уровень: ${level}
🎿 Тренажер: ${sim}
💰 Стоимость: ${priceStr} руб.

Вернул деньги участникам:
${participantsList}`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления об отмене групповой тренировки администратором:', error);
    }
}

// Переменная для блокировки множественных вызовов
let isNotificationInProgress = false;

// Функция для отправки уведомления о тренировках на завтра
async function notifyTomorrowTrainings(trainings) {
    // Проверяем, не выполняется ли уже отправка уведомлений
    if (isNotificationInProgress) {
        console.log('Уведомление о тренировках на завтра уже отправляется, пропускаем дублирующий вызов');
        return;
    }
    
    // Устанавливаем блокировку
    isNotificationInProgress = true;
    
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            isNotificationInProgress = false; // Снимаем блокировку
            return;
        }

        // Если тренировок нет, ничего не отправляем
        if (!trainings || trainings.length === 0) {
            console.log('Тренировок на завтра нет, уведомление не отправляется');
            isNotificationInProgress = false; // Снимаем блокировку
            return;
        }

        // Получаем завтрашнюю дату для заголовка
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = formatDate(tomorrow.toISOString().split('T')[0]);

        // Разделяем тренировки на групповые и индивидуальные
        const groupTrainings = trainings.filter(t => !t.is_individual);
        const individualTrainings = trainings.filter(t => t.is_individual);

        let message = `🔔 *Тренировки на завтра (${tomorrowStr})*\n\n`;

        // Групповые тренировки
        if (groupTrainings.length > 0) {
            message += `👥 *ГРУППОВЫЕ ТРЕНИРОВКИ:*\n`;
            groupTrainings.forEach(training => {
                const timeStr = training.start_time ? training.start_time.substring(0, 5) : 'Время не указано';
                const trainerStr = training.trainer_name || 'Тренер не назначен';
                const participantsStr = training.participants_list || 'Нет участников';
                const equipmentStr = training.equipment_type === 'ski' ? '🎿' : '🏂';
                
                // Определяем место проведения
                let locationStr = '';
                if (training.simulator_name) {
                    locationStr = `🎿 Тренажер: ${training.simulator_name}`;
                } else {
                    // Для зимних тренировок используем location из данных или fallback
                    const location = training.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    locationStr = `🏔️ Место: ${locationName}`;
                }
                
                // Для зимних групповых тренировок показываем цену за человека
                let priceStr = training.price;
                if (!training.simulator_name && training.max_participants) {
                    const pricePerPerson = (Number(training.price) / training.max_participants).toFixed(2);
                    priceStr = `${pricePerPerson} руб. (за человека, общая: ${Number(training.price).toFixed(2)} руб.)`;
                } else {
                    priceStr = `${Number(training.price).toFixed(2)} руб.`;
                }
                
                message += `• ${timeStr} - ${training.group_name || 'Группа'} (${equipmentStr})\n`;
                message += `  ${locationStr}\n`;
                message += `  👨‍🏫 Тренер: ${trainerStr}\n`;
                message += `  👥 Участники: ${participantsStr}\n`;
                message += `  💰 Стоимость: ${priceStr}\n\n`;
            });
        }

        // Индивидуальные тренировки
        if (individualTrainings.length > 0) {
            message += `🏃 *ИНДИВИДУАЛЬНЫЕ ТРЕНИРОВКИ:*\n`;
            individualTrainings.forEach(training => {
                const timeStr = training.start_time ? training.start_time.substring(0, 5) : 'Время не указано';
                const durationStr = training.duration ? `${training.duration} мин` : 'Длительность не указана';
                const equipmentStr = training.equipment_type === 'ski' ? '🎿' : '🏂';
                const participantStr = training.participants_list || 'Участник не указан';
                
                // Определяем место проведения
                let locationStr = '';
                if (training.simulator_name) {
                    locationStr = `🎿 Тренажер: ${training.simulator_name}`;
                } else {
                    // Для зимних тренировок используем location из данных или fallback
                    const location = training.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    locationStr = `🏔️ Место: ${locationName}`;
                }
                
                message += `• ${timeStr} - ${participantStr} (${equipmentStr})\n`;
                message += `  ${locationStr}\n`;
                message += `  ⏱ Длительность: ${durationStr}\n`;
                message += `  💰 Стоимость: ${Number(training.price).toFixed(2)} руб.\n\n`;
            });
        }

        // Отправляем полное уведомление всем администраторам
        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }

        console.log(`Уведомление о ${trainings.length} тренировках на завтра отправлено администраторам`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления о тренировках на завтра:', error);
    } finally {
        // Снимаем блокировку
        isNotificationInProgress = false;
    }
}

// Функция для отправки уведомления об отмене шаблона постоянного расписания
async function notifyAdminTemplateCancellation(templateData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const { template_name, deleted_trainings_count, total_refund, refunds_count, trainings, refunds } = templateData;
        
        // Формируем список тренировок
        let trainingsList = '';
        if (trainings && trainings.length > 0) {
            trainingsList = trainings.map(training => {
                const dateObj = new Date(training.session_date);
                const days = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
                const dayOfWeek = days[dateObj.getDay()];
                const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()} (${dayOfWeek})`;
                const startTime = training.start_time ? training.start_time.slice(0,5) : '';
                const endTime = training.end_time ? training.end_time.slice(0,5) : '';
                return `• ${dateStr} ${startTime}-${endTime} (${training.group_name})`;
            }).join('\n');
        }

        // Формируем список участников с возвратами
        let refundsList = '';
        if (refunds && refunds.length > 0) {
            refundsList = refunds.map(refund => {
                const ageStr = refund.age ? ` (${refund.age} лет)` : '';
                return `• ${refund.full_name}${ageStr} - ${Number(refund.amount).toFixed(2)} руб.`;
            }).join('\n');
        }

        const message = `🗑️ *Отмена шаблона постоянного расписания*

📋 *Шаблон:* ${template_name}
📊 *Отменено тренировок:* ${deleted_trainings_count}
👥 *Участников затронуто:* ${refunds_count}
💰 *Общий возврат:* ${Number(total_refund).toFixed(2)} руб.

📅 *Отмененные тренировки:*
${trainingsList}

💳 *Возвраты участникам:*
${refundsList}

Все участники получили возврат средств на свои кошельки.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления об отмене шаблона:', error);
    }
}

// Уведомление о применении шаблонов к расписанию
async function notifyTemplatesApplied(templateData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const { created, conflicts, date_range, conflicts_list } = templateData;
        
        // Формируем информацию о периоде
        let periodInfo = '';
        if (date_range && date_range.from && date_range.to) {
            periodInfo = `\n📅 *Период:* ${date_range.from} - ${date_range.to}`;
        }
        
        // Формируем список конфликтов (если есть)
        let conflictsList = '';
        if (conflicts > 0 && conflicts_list && conflicts_list.length > 0) {
            conflictsList = `\n⚠️ *Конфликты:*\n`;
            conflictsList += conflicts_list.slice(0, 5).map(conflict => {
                const dateObj = new Date(conflict.date);
                const days = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
                const dayOfWeek = days[dateObj.getDay()];
                const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()} (${dayOfWeek})`;
                const timeStr = conflict.time ? conflict.time.slice(0,5) : '';
                return `• ${dateStr} ${timeStr} - ${conflict.template_name} (${conflict.reason})`;
            }).join('\n');
            
            if (conflicts_list.length > 5) {
                conflictsList += `\n... и еще ${conflicts_list.length - 5} конфликтов`;
            }
        }

        const message = `📅 *Применение шаблонов к расписанию*

✅ *Создано тренировок:* ${created}
⚠️ *Конфликтов:* ${conflicts}${periodInfo}${conflictsList}

${conflicts > 0 ? 'Проверьте логи для деталей о конфликтах.' : 'Все шаблоны успешно применены!'}`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о применении шаблонов:', error);
    }
}

// Уведомление о создании блокировки слота
async function notifyBlockCreated(blockData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const { reason, block_type, start_date, end_date, day_of_week, start_time, end_time, simulator_name } = blockData;
        
        let periodInfo = '';
        if (block_type === 'specific') {
            const startDateStr = new Date(start_date).toLocaleDateString('ru-RU');
            const endDateStr = new Date(end_date).toLocaleDateString('ru-RU');
            periodInfo = `📅 *Период:* ${startDateStr} - ${endDateStr}`;
        } else {
            const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
            periodInfo = `📅 *День недели:* ${days[day_of_week]}`;
        }
        
        const timeStr = `${start_time.slice(0,5)} - ${end_time.slice(0,5)}`;
        const typeStr = block_type === 'specific' ? 'Конкретные даты' : 'Постоянная';
        
        const message = `🔒 *Создана блокировка слота*

📋 *Причина:* ${reason || 'Не указана'}
📊 *Тип:* ${typeStr}
${periodInfo}
⏰ *Время:* ${timeStr}
🎿 *Тренажер:* ${simulator_name || 'Оба тренажера'}

Слоты заблокированы для бронирования.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о создании блокировки:', error);
    }
}

// Уведомление об удалении блокировки слота
async function notifyBlockDeleted(blockData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const { reason, block_type, start_date, end_date, day_of_week, start_time, end_time, simulator_name } = blockData;
        
        let periodInfo = '';
        if (block_type === 'specific') {
            const startDateStr = new Date(start_date).toLocaleDateString('ru-RU');
            const endDateStr = new Date(end_date).toLocaleDateString('ru-RU');
            periodInfo = `📅 *Период:* ${startDateStr} - ${endDateStr}`;
        } else {
            const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
            periodInfo = `📅 *День недели:* ${days[day_of_week]}`;
        }
        
        const timeStr = `${start_time.slice(0,5)} - ${end_time.slice(0,5)}`;
        
        const message = `🔓 *Удалена блокировка слота*

📋 *Причина:* ${reason || 'Не указана'}
${periodInfo}
⏰ *Время:* ${timeStr}
🎿 *Тренажер:* ${simulator_name || 'Оба тренажера'}

Слоты снова доступны для бронирования.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления об удалении блокировки:', error);
    }
}

// Уведомление о создании нового шаблона
async function notifyTemplateCreated(templateData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const { name, day_of_week, start_time, simulator_id, group_name, trainer_name, equipment_type, skill_level, max_participants } = templateData;
        
        const days = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
        const dayName = days[day_of_week];
        const timeStr = start_time ? start_time.slice(0,5) : '';
        const equipmentEmoji = equipment_type === 'ski' ? '🎿' : '🏂';
        const simulatorName = simulator_id === 1 ? 'Тренажер 1' : 'Тренажер 2';
        
        const message = `📅 *Создан новый шаблон постоянного расписания*

📋 *Название:* ${name}
📅 *День недели:* ${dayName}
⏰ *Время:* ${timeStr}
${equipmentEmoji} *Тренажер:* ${simulatorName}
👥 *Группа:* ${group_name || '-'}
👨‍🏫 *Тренер:* ${trainer_name || '-'}
📊 *Уровень:* ${skill_level || '-'}
👥 *Макс. участников:* ${max_participants}

Шаблон готов к применению к расписанию!`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о создании шаблона:', error);
    }
}

// Функция для отправки уведомления о бронировании тренером
async function notifyTrainerBookingCreated(bookingData) {
    try {
        const { trainerName, date, startTime, endTime, simulatorId } = bookingData;
        
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const formattedDate = formatDate(date);
        const simulatorName = simulatorId === 1 ? 'Тренажер 1' : simulatorId === 2 ? 'Тренажер 2' : `Тренажер ${simulatorId}`;
        
        let message = `🎿 *Бронирование тренером*\n\n`;
        message += `👤 *Тренер:* ${trainerName}\n`;
        message += `📅 *Дата:* ${formattedDate}\n`;
        message += `⏰ *Время:* ${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}\n`;
        message += `🎿 *Тренажер:* ${simulatorName}\n`;

        for (const adminId of adminIds) {
            try {
                await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error(`Ошибка при отправке уведомления администратору ${adminId}:`, error.message);
            }
        }
        
        console.log(`✓ Уведомление о бронировании отправлено администраторам`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления о бронировании тренером:', error);
    }
}

// Функция для отправки уведомления об отмене бронирования тренером
async function notifyTrainerBookingCancelled(bookingData) {
    try {
        const { trainerName, date, startTime, endTime, simulatorId, simulatorName } = bookingData;
        
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const formattedDate = formatDate(date);
        const simName = simulatorName || (simulatorId === 1 ? 'Тренажер 1' : simulatorId === 2 ? 'Тренажер 2' : `Тренажер ${simulatorId}`);
        
        let message = `❌ *Отмена бронирования тренером*\n\n`;
        message += `👤 *Тренер:* ${trainerName}\n`;
        message += `📅 *Дата:* ${formattedDate}\n`;
        message += `⏰ *Время:* ${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}\n`;
        message += `🎿 *Тренажер:* ${simName}\n`;

        for (const adminId of adminIds) {
            try {
                await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error(`Ошибка при отправке уведомления администратору ${adminId}:`, error.message);
            }
        }
        
        console.log(`✓ Уведомление об отмене бронирования отправлено администраторам`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления об отмене бронирования тренером:', error);
    }
}

// Функция для отправки уведомления об удалении индивидуальной тренировки администратором
async function notifyAdminIndividualTrainingDeleted(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const { 
            client_name, 
            client_phone, 
            participant_name,
            participant_age,
            date, 
            time, 
            duration,
            equipment_type,
            with_trainer,
            simulator_name, 
            price,
            refund_amount,
            new_balance,
            is_child,
            parent_name
        } = trainingData;

        const equipmentName = equipment_type === 'ski' ? '⛷ Лыжи' : '🏂 Сноуборд';
        const trainerText = with_trainer ? 'С тренером' : 'Без тренера';
        
        // Проверяем и вычисляем возраст
        let participantAgeDisplay;
        if (participant_age !== null && participant_age !== undefined && !isNaN(participant_age) && participant_age >= 0) {
            participantAgeDisplay = `${participant_age} лет`;
        } else {
            console.warn('Некорректный возраст участника:', participant_age);
            participantAgeDisplay = 'возраст не указан';
        }
        
        let participantInfo = '';
        if (is_child && parent_name) {
            participantInfo = `👶 *Участник:* ${participant_name} (${participantAgeDisplay})\n` +
                            `👨‍👩‍👧 *Родитель:* ${parent_name}\n`;
        } else {
            participantInfo = `👤 *Участник:* ${participant_name} (${participantAgeDisplay})\n`;
        }

        const simulatorLine = simulator_name ? `\n🎿 *Тренажер:* ${simulator_name}` : '';
        const message = 
            '🗑 *Удалена индивидуальная тренировка*\n\n' +
            `👨‍💼 *Клиент:* ${client_name}\n` +
            participantInfo +
            `📱 *Телефон:* ${client_phone}\n` +
            `📅 *Дата:* ${formatDate(date)}\n` +
            `⏰ *Время:* ${time}\n` +
            `⏱ *Длительность:* ${duration} мин\n` +
            `${equipmentName} ${trainerText}${simulatorLine}\n\n` +
            `💰 *Возвращено:* ${refund_amount} ₽\n` +
            `💳 *Новый баланс клиента:* ${new_balance} ₽\n\n` +
            `_Удалено администратором через админ-панель_`;

        for (const adminId of adminIds) {
            try {
                await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error(`Ошибка при отправке уведомления администратору ${adminId}:`, error.message);
            }
        }
        
        console.log(`✓ Уведомление об удалении индивидуальной тренировки отправлено администраторам`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления об удалении индивидуальной тренировки:', error);
    }
}

// Функция для отправки уведомления о переносе участника между тренировками
async function notifyAdminParticipantTransferred(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Определяем, является ли тренировка зимней (естественный склон)
        const isWinterTraining = trainingData.slope_type === 'natural_slope';
        
        // Получаем location для зимних тренировок
        let locationName = '';
        if (isWinterTraining) {
            const location = trainingData.location || trainingData.target_location || 'kuliga';
            locationName = getLocationDisplayName(location);
        }
        
        // Заголовок зависит от типа тренировки
        const header = isWinterTraining 
            ? `🔄 *Перенос участника между тренировками на естественном склоне в ${locationName}!*`
            : '🔄 *Перенос участника между тренировками!*';
        
        // Формируем строку с информацией о тренажере/месте
        let locationLine = '';
        if (isWinterTraining) {
            locationLine = `🏔️ *Место:* ${locationName}\n`;
        } else {
            locationLine = `🎿 *Тренажер:* ${trainingData.target_simulator_name || 'Не указан'}\n`;
        }

        const message =
            `${header}\n\n` +
            `👤 *Клиент:* ${trainingData.client_name}\n` +
            `👶 *Участник:* ${trainingData.participant_name} (${trainingData.participant_age} лет)\n` +
            `📞 *Телефон:* ${trainingData.client_phone}\n\n` +
            `📅 *Было:*\n` +
            `   Дата: ${trainingData.source_date}\n` +
            `   Время: ${trainingData.source_time}\n` +
            `   Группа: ${trainingData.source_group_name || 'Не указана'}\n` +
            `   Мест осталось: ${trainingData.remaining_seats_source}\n\n` +
            `📅 *Стало:*\n` +
            `   Дата: ${trainingData.target_date}\n` +
            `   Время: ${trainingData.target_time}\n` +
            `   Группа: ${trainingData.target_group_name || 'Не указана'}\n` +
            `   Тренер: ${trainingData.target_trainer_name || 'Не назначен'}\n` +
            locationLine +
            `   Участников: ${trainingData.new_seats_target}\n\n` +
            `_Перенесено администратором через админ-панель_`;

        for (const adminId of adminIds) {
            try {
                await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error(`Ошибка при отправке уведомления администратору ${adminId}:`, error.message);
            }
        }
        
        console.log(`✓ Уведомление о переносе участника отправлено администраторам`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления о переносе участника:', error);
    }
}

module.exports = {
    bot,
    instructorBot,
    notifyScheduleCreated,
    notifyRecurringTrainingsCreated,
    notifyRecurringTrainingConflict,
    notifyNewTrainingRequest,
    notifyNewIndividualTraining,
    notifyNewGroupTrainingParticipant,
    notifyAdminGroupTrainingCancellation,
    notifyAdminGroupTrainingCancellationByAdmin,
    notifyAdminGroupTrainingDeletedByInstructor,
    notifyAdminIndividualTrainingCancellation,
    notifyAdminParticipantRemoved,
    notifyAdminParticipantTransferred,
    notifyAdminFailedPayment,
    notifyAdminWalletRefilled,
    notifyAdminCertificatePurchase,
    notifyAdminCertificateActivation,
    notifyAdminWebCertificatePurchase,
    calculateAge,
    notifyNewClient,
    notifyTomorrowTrainings,
    notifyAdminTemplateCancellation,
    notifyTemplatesApplied,
    notifyTemplateCreated,
    notifyBlockCreated,
    notifyBlockDeleted,
    notifyTrainerBookingCreated,
    notifyTrainerBookingCancelled,
    notifyAdminIndividualTrainingDeleted,
    notifyAdminNaturalSlopeTrainingCancellation,
    notifyAdminNaturalSlopeTrainingBooking,
    notifyInstructorKuligaTrainingBooking,
    notifyInstructorKuligaTrainingCancellation,
    notifyAdminWinterGroupTrainingCreated,
    notifyAdminWinterGroupTrainingCreatedByAdmin,
    notifyAdminSubscriptionPurchase
};

// Функция для отправки уведомления о покупке абонемента
async function notifyAdminSubscriptionPurchase({ client_name, client_id, subscription_name, price, sessions_count }) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = 
            '🎫 *Новая покупка абонемента!*\n\n' +
            `👨‍💼 *Клиент:* ${client_name}\n` +
            `🆔 *ID клиента:* ${client_id}\n` +
            `🎫 *Абонемент:* ${subscription_name}\n` +
            `🎯 *Количество занятий:* ${sessions_count}\n` +
            `💰 *Стоимость:* ${Number(price).toFixed(2)} руб.\n` +
            `💵 *Цена за занятие:* ${Number(price / sessions_count).toFixed(2)} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о покупке абонемента:', error);
    }
} 