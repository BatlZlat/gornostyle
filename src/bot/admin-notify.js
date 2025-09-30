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
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    
    return age;
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

// Функция для отправки уведомления о тренировках на завтра
async function notifyTomorrowTrainings(trainings) {
    try {
        const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => id.trim());
        if (!adminIds.length) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        // Если тренировок нет, ничего не отправляем
        if (!trainings || trainings.length === 0) {
            console.log('Тренировок на завтра нет, уведомление не отправляется');
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

        // Отправляем уведомление всем администраторам
        for (const adminId of adminIds) {
            await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        }

        console.log(`Уведомление о ${trainings.length} тренировках на завтра отправлено администраторам`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления о тренировках на завтра:', error);
    }
}

module.exports = {
    notifyScheduleCreated,
    notifyNewTrainingRequest,
    notifyNewIndividualTraining,
    notifyNewGroupTrainingParticipant,
    notifyAdminGroupTrainingCancellation,
    notifyAdminGroupTrainingCancellationByAdmin,
    notifyAdminIndividualTrainingCancellation,
    notifyAdminFailedPayment,
    notifyAdminWalletRefilled,
    notifyAdminCertificatePurchase,
    notifyAdminCertificateActivation,
    notifyAdminWebCertificatePurchase,
    calculateAge,
    notifyNewClient,
    notifyTomorrowTrainings
}; 