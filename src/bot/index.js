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
                        `�� *Ребенок:* ${childInfo}\n\n` +
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
        // Добавим другие обработчики позже
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error);
});

// Запуск бота
console.log('Бот запущен'); 

function handleEditProfile(bot, msg, state) {
    const chatId = msg.chat.id;
    const currentStep = state.currentStep;
    const data = state.data;

    switch (currentStep) {
        case 'select_field':
            // Обработка выбора поля для редактирования
            const field = msg.text;
            switch (field) {
                case '📝 ФИО':
                    userStates.set(chatId, {
                        step: 'edit_profile',
                        currentStep: 'new_full_name',
                        data: { ...data, field: 'full_name' }
                    });
                    await bot.sendMessage(chatId, 'Введите новое полное имя (ФИО):');
                    break;
                case '📅 Дата рождения':
                    userStates.set(chatId, {
                        step: 'edit_profile',
                        currentStep: 'new_birth_date',
                        data: { ...data, field: 'birth_date' }
                    });
                    await bot.sendMessage(chatId, 'Введите новую дату рождения (в формате ГГГГ-ММ-ДД):');
                    break;
                case '📱 Телефон':
                    userStates.set(chatId, {
                        step: 'edit_profile',
                        currentStep: 'new_phone',
                        data: { ...data, field: 'phone' }
                    });
                    await bot.sendMessage(chatId, 'Введите новый телефон:');
                    break;
                case '👶 Данные ребенка':
                    userStates.set(chatId, {
                        step: 'edit_profile',
                        currentStep: 'child_name',
                        data: { ...data, field: 'child_name' }
                    });
                    await bot.sendMessage(chatId, 'Введите имя ребенка:');
                    break;
                case '➕ Добавить ребенка':
                    userStates.set(chatId, {
                        step: 'edit_profile',
                        currentStep: 'child_birth_date',
                        data: { ...data, field: 'child_birth_date' }
                    });
                    await bot.sendMessage(chatId, 'Введите дату рождения ребенка (в формате ГГГГ-ММ-ДД):');
                    break;
                case '🔙 Назад в меню':
                    showMainMenu(bot, chatId);
                    break;
            }
            break;
        case 'new_full_name':
            // Обработка нового полного имени
            const newFullName = msg.text;
            userStates.set(chatId, {
                step: 'edit_profile',
                currentStep: 'new_phone',
                data: { ...data, full_name: newFullName }
            });
            await bot.sendMessage(chatId, 'Введите новый телефон:');
            break;
        case 'new_birth_date':
            // Обработка новой даты рождения
            const newBirthDate = msg.text;
            userStates.set(chatId, {
                step: 'edit_profile',
                currentStep: 'new_phone',
                data: { ...data, birth_date: newBirthDate }
            });
            await bot.sendMessage(chatId, 'Введите новый телефон:');
            break;
        case 'new_phone':
            // Обработка нового телефона
            const newPhone = msg.text;
            userStates.set(chatId, {
                step: 'edit_profile',
                currentStep: 'confirm',
                data: { ...data, phone: newPhone }
            });
            await bot.sendMessage(chatId, `Вы уверены, что хотите изменить телефон на ${newPhone}?`);
            break;
        case 'child_name':
            // Обработка имени ребенка
            const childName = msg.text;
            userStates.set(chatId, {
                step: 'edit_profile',
                currentStep: 'child_birth_date',
                data: { ...data, child_name: childName }
            });
            await bot.sendMessage(chatId, 'Введите дату рождения ребенка (в формате ГГГГ-ММ-ДД):');
            break;
        case 'child_birth_date':
            // Обработка даты рождения ребенка
            const childBirthDate = msg.text;
            userStates.set(chatId, {
                step: 'edit_profile',
                currentStep: 'confirm',
                data: { ...data, child_birth_date: childBirthDate }
            });
            await bot.sendMessage(chatId, `Вы уверены, что хотите изменить дату рождения ребенка на ${childBirthDate}?`);
            break;
        case 'confirm':
            // Обработка подтверждения изменений
            const confirm = msg.text;
            if (confirm === 'Да') {
                // Сохранение изменений
                await saveChanges(bot, data);
            } else {
                userStates.set(chatId, {
                    step: 'edit_profile',
                    currentStep: 'select_field',
                    data: { ...data }
                });
                await bot.sendMessage(chatId, 'Изменения отменены.');
            }
            break;
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