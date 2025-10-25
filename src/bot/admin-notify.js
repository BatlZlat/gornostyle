const TelegramBot = require('node-telegram-bot-api');

// Создаем экземпляр бота для уведомлений
const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN, { polling: false });

// Функция для форматирования даты
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
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

        const message = `
🔔 *Новая заявка на тренировку!*

👤 *Клиент:* ${trainingData.client_name}
📅 *Дата:* ${trainingData.date}
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

// Функция для отправки уведомления об отмене групповой тренировки
async function notifyAdminGroupTrainingCancellation(trainingData) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message =
            '❌ *Отмена групповой тренировки!*\n\n' +
            `👤 *Клиент:* ${trainingData.client_name}\n` +
            (trainingData.participant_name ? `👤 *Участник:* ${trainingData.participant_name}\n` : '') +
            `📞 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `👥 *Группа:* ${trainingData.group_name}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name}\n` +
            `🎿 *Тренажер:* ${trainingData.simulator_name}\n` +
            `🪑 *Мест осталось:* ${trainingData.seats_left}\n` +
            `💰 *Возврат:* ${Number(trainingData.refund).toFixed(2)} руб.`;

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

        const message =
            '👥 *Удаление участника из тренировки!*\n\n' +
            `👤 *Клиент:* ${trainingData.client_name}\n` +
            (trainingData.participant_name ? `👶 *Участник:* ${trainingData.participant_name} (${trainingData.age} лет)\n` : `👤 *Возраст:* ${trainingData.age} лет\n`) +
            `📞 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `👥 *Группа:* ${trainingData.group_name}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name}\n` +
            `🎿 *Тренажер:* ${trainingData.simulator_name}\n` +
            `🪑 *Мест осталось:* ${trainingData.seats_left}\n` +
            `💰 *Возврат:* ${Number(trainingData.refund).toFixed(2)} руб.`;

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

        const message = 
            '❌ *Отмена индивидуальной тренировки на естественном склоне!*\n\n' +
            `👨‍💼 *Клиент:* ${trainingData.client_name}\n` +
            `👤 *Участник:* ${trainingData.participant_name}\n` +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.trainer_name || 'Не указан'}\n` +
            `🏔️ *Место:* Естественный склон\n` +
            `💰 *Возврат:* ${Number(trainingData.refund).toFixed(2)} руб.`;

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

        const message = 
            '✅ *Новая запись на индивидуальную тренировку естественного склона!*\n\n' +
            `👨‍💼 *Клиент:* ${trainingData.client_name}\n` +
            `👤 *Участник:* ${trainingData.participant_name}\n` +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `📅 *Дата:* ${formatDate(trainingData.date)}\n` +
            `⏰ *Время:* ${trainingData.time}\n` +
            `🏔️ *Место:* Естественный склон\n` +
            `💰 *Стоимость:* ${Number(trainingData.price).toFixed(2)} руб.`;

        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Ошибка при отправке уведомления о записи на тренировку естественного склона:', error);
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
                
                message += `• ${timeStr} - ${training.group_name || 'Группа'} (${equipmentStr})\n`;
                message += `  👨‍🏫 Тренер: ${trainerStr}\n`;
                message += `  👥 Участники: ${participantsStr}\n`;
                message += `  💰 Стоимость: ${training.price} руб.\n\n`;
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
                
                message += `• ${timeStr} - ${participantStr} (${equipmentStr})\n`;
                message += `  ⏱ Длительность: ${durationStr}\n`;
                message += `  💰 Стоимость: ${training.price} руб.\n\n`;
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

        const message = 
            '🗑 *Удалена индивидуальная тренировка*\n\n' +
            `👨‍💼 *Клиент:* ${client_name}\n` +
            participantInfo +
            `📱 *Телефон:* ${client_phone}\n` +
            `📅 *Дата:* ${formatDate(date)}\n` +
            `⏰ *Время:* ${time}\n` +
            `⏱ *Длительность:* ${duration} мин\n` +
            `${equipmentName} ${trainerText}\n` +
            `🎿 *Тренажер:* ${simulator_name}\n\n` +
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

module.exports = {
    notifyScheduleCreated,
    notifyRecurringTrainingsCreated,
    notifyRecurringTrainingConflict,
    notifyNewTrainingRequest,
    notifyNewIndividualTraining,
    notifyNewGroupTrainingParticipant,
    notifyAdminGroupTrainingCancellation,
    notifyAdminGroupTrainingCancellationByAdmin,
    notifyAdminIndividualTrainingCancellation,
    notifyAdminParticipantRemoved,
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
    notifyAdminNaturalSlopeTrainingBooking
}; 