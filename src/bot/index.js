require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../db');
const { handleRegistration, showMainMenu } = require('./handlers');
const { getClientByTelegramId, getChildByParentId } = require('./db-utils');

// Инициализация бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Состояния пользователей
const userStates = new Map();

// Генерация уникального номера кошелька
function generateWalletNumber() {
    return Math.random().toString().slice(2, 18);
}

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const username = msg.from.username || '';
    const nickname = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');

    try {
        // Отправляем стикер
        await bot.sendSticker(chatId, 'CAACAgIAAxkBAAELsYplxZQAAUgVxEp4MoVzM0IhpzK0qhwAAjcBAAIw1J0RxkeNX64LHEo0BA');
        
        // Проверяем, существует ли пользователь
        const client = await getClientByTelegramId(telegramId);

        if (!client) {
            // Новый пользователь
            userStates.set(chatId, {
                step: 'registration',
                data: {
                    telegram_id: telegramId,
                    username: username,
                    nickname: nickname
                }
            });

            await bot.sendMessage(chatId, 
                '🎿 Привет! Добро пожаловать в мир горнолыжного спорта! 🏔\n\n' +
                '🌟 Я - ваш персональный помощник Ski-instruktor! Я помогу вам:\n' +
                '• 📝 Записаться на тренировки на горнолыжном тренажере\n' +
                '• ⛷ Забронировать занятия в Кулиге зимой\n' +
                '• 💳 Управлять вашим балансом\n' +
                '• 🎁 Приобрести подарочные сертификаты\n\n' +
                '🚀 Давайте начнем! Нажмите на кнопку "Запуск сервиса Ski-instruktor" внизу экрана, ' +
                'и я помогу вам зарегистрироваться в системе! 🎯',
                {
                    reply_markup: {
                        keyboard: [[{ text: '🚀 Запуск сервиса Ski-instruktor' }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
        } else {
            // Существующий пользователь
            await bot.sendMessage(chatId, 
                '🎿 С возвращением в Ski-instruktor! 🏔\n' +
                'Рад снова видеть вас! Чем могу помочь сегодня?'
            );
            showMainMenu(bot, chatId);
        }
    } catch (error) {
        console.error('Ошибка при проверке пользователя:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
    if (msg.text.startsWith('/')) return; // Игнорируем команды

    const chatId = msg.chat.id;
    const state = userStates.get(chatId);

    if (!state) {
        // Обработка нажатий на кнопки меню
        switch (msg.text) {
            case '📝 Записаться на тренировку':
                await bot.sendMessage(chatId, 
                    '🔄 Функция записи на тренировку находится в разработке.\n' +
                    'Скоро здесь появится возможность записаться на тренировки!',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true,
                            one_time_keyboard: false
                        }
                    }
                );
                break;

            case '📋 Мои записи':
                await bot.sendMessage(chatId, 
                    '🔄 Функция просмотра записей находится в разработке.\n' +
                    'Скоро здесь появится список ваших тренировок!',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true,
                            one_time_keyboard: false
                        }
                    }
                );
                break;

            case '👤 Личная информация':
                try {
                    const client = await getClientByTelegramId(msg.from.id.toString());
                    const child = await getChildByParentId(client.id);
                    
                    let childInfo = 'нет';
                    if (child) {
                        const birthDate = new Date(child.birth_date);
                        const age = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
                        childInfo = `${child.full_name} (${age} лет)`;
                    }

                    await bot.sendMessage(chatId, 
                        '👤 *Ваша личная информация:*\n\n' +
                        `📝 *ФИО:* ${client.full_name}\n` +
                        `📅 *Дата рождения:* ${new Date(client.birth_date).toLocaleDateString()}\n` +
                        `📱 *Телефон:* ${client.phone}\n` +
                        `👶 *Ребенок:* ${childInfo}\n\n` +
                        '✏️ Для редактирования данных нажмите кнопку ниже',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['✏️ Редактировать данные'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true,
                                one_time_keyboard: false
                            }
                        }
                    );
                } catch (error) {
                    console.error('Ошибка при получении информации:', error);
                    await bot.sendMessage(chatId, 'Произошла ошибка при получении информации. Пожалуйста, попробуйте позже.');
                }
                break;

            case '🎁 Подарочный сертификат':
                await bot.sendMessage(chatId, 
                    '🔄 Функция работы с подарочными сертификатами находится в разработке.\n' +
                    'Скоро здесь появится возможность приобрести и использовать сертификаты!',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true,
                            one_time_keyboard: false
                        }
                    }
                );
                break;

            case '💰 Кошелек':
                try {
                    const wallet = await getClientByTelegramId(msg.from.id.toString());
                    if (wallet) {
                        await bot.sendMessage(chatId, 
                            '💰 *Информация о кошельке:*\n\n' +
                            `🔢 *Номер кошелька:* ${wallet.id}\n` +
                            `💵 *Баланс:* ${wallet.balance || 0} руб.`,
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    keyboard: [
                                        ['💳 Пополнить баланс'],
                                        ['🔙 Назад в меню']
                                    ],
                                    resize_keyboard: true,
                                    one_time_keyboard: false
                                }
                            }
                        );
                    }
                } catch (error) {
                    console.error('Ошибка при получении информации о кошельке:', error);
                    await bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте позже.');
                }
                break;

            case '🔙 Назад в меню':
                showMainMenu(bot, chatId);
                break;

            case '🚀 Запуск сервиса Ski-instruktor':
                userStates.set(chatId, {
                    step: 'registration',
                    data: {
                        telegram_id: msg.from.id.toString(),
                        username: msg.from.username || '',
                        nickname: msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '')
                    }
                });
                await bot.sendMessage(chatId, 'Введите ваше полное имя (ФИО):');
                break;
        }
        return;
    }

    switch (state.step) {
        case 'registration':
            await handleRegistration(bot, msg, state);
            break;
        case 'edit_profile':
            await handleEditProfile(bot, msg, state);
            break;
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error);
});

// Запуск бота
console.log('Бот запущен'); 

// Обработка редактирования профиля
async function handleEditProfile(bot, msg, state) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!state.currentStep) {
        state.currentStep = 'select_field';
        return bot.sendMessage(chatId, 'Выберите, что хотите изменить:');
    }

    switch (state.currentStep) {
        case 'select_field':
            switch (text) {
                case '📝 ФИО':
                    state.currentStep = 'edit_name';
                    state.editField = 'full_name';
                    return bot.sendMessage(chatId, 'Введите новое ФИО:');

                case '📅 Дата рождения':
                    state.currentStep = 'edit_birth_date';
                    state.editField = 'birth_date';
                    return bot.sendMessage(chatId, 'Введите новую дату рождения в формате ДД.ММ.ГГГГ:');

                case '📱 Телефон':
                    state.currentStep = 'edit_phone';
                    state.editField = 'phone';
                    return bot.sendMessage(chatId, 'Введите новый номер телефона в формате +79999999999:');

                case '👶 Данные ребенка':
                    const child = await getChildByParentId(state.clientId);
                    if (!child) {
                        return bot.sendMessage(chatId, 
                            'У вас пока нет зарегистрированного ребенка.\n' +
                            'Хотите добавить?',
                            {
                                reply_markup: {
                                    keyboard: [
                                        ['➕ Добавить ребенка'],
                                        ['🔙 Назад в меню']
                                    ],
                                    resize_keyboard: true,
                                    one_time_keyboard: true
                                }
                            }
                        );
                    }
                    state.currentStep = 'edit_child';
                    return bot.sendMessage(chatId, 
                        'Что вы хотите изменить?',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['👶 ФИО ребенка', '📅 Дата рождения ребенка'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );

                case '➕ Добавить ребенка':
                    state.currentStep = 'add_child_name';
                    return bot.sendMessage(chatId, 'Введите ФИО ребенка:');

                case '🔙 Назад в меню':
                    return showMainMenu(bot, chatId);
            }
            break;

        case 'edit_name':
            if (text.length < 5) {
                return bot.sendMessage(chatId, 'ФИО должно содержать минимум 5 символов. Попробуйте еще раз:');
            }
            await updateClientField(state.clientId, 'full_name', text);
            await showMainMenu(bot, chatId);
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '✅ ФИО успешно обновлено!');

        case 'edit_birth_date':
            const birthDate = validateDate(text);
            if (!birthDate) {
                return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
            }
            await updateClientField(state.clientId, 'birth_date', birthDate);
            await showMainMenu(bot, chatId);
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '✅ Дата рождения успешно обновлена!');

        case 'edit_phone':
            const phone = validatePhone(text);
            if (!phone) {
                return bot.sendMessage(chatId, 'Неверный формат номера телефона. Используйте формат +79999999999:');
            }
            await updateClientField(state.clientId, 'phone', phone);
            await showMainMenu(bot, chatId);
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '✅ Номер телефона успешно обновлен!');

        case 'add_child_name':
            if (text.length < 5) {
                return bot.sendMessage(chatId, 'ФИО ребенка должно содержать минимум 5 символов. Попробуйте еще раз:');
            }
            state.data.child = { full_name: text };
            state.currentStep = 'add_child_birth_date';
            return bot.sendMessage(chatId, 'Введите дату рождения ребенка в формате ДД.ММ.ГГГГ:');

        case 'add_child_birth_date':
            const childBirthDate = validateDate(text);
            if (!childBirthDate) {
                return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
            }
            state.data.child.birth_date = childBirthDate;
            await addChild(state.clientId, state.data.child);
            await showMainMenu(bot, chatId);
            userStates.delete(chatId);
            return bot.sendMessage(chatId, '✅ Ребенок успешно добавлен!');
    }
}

function saveChanges(bot, data) {
    // Реализация сохранения изменений в базе данных
    console.log('Изменения сохранены:', data);
    userStates.set(msg.chat.id, {
        step: 'main_menu',
        currentStep: null,
        data: {}
    });
    showMainMenu(bot, msg.chat.id);
} 