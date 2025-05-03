const { createClient, getClientByTelegramId, getChildByParentId } = require('./db-utils');

// Обработка регистрации
async function handleRegistration(bot, msg, state) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!state.currentStep) {
        state.currentStep = 'full_name';
        return bot.sendMessage(chatId, 'Введите ваше полное имя (ФИО):');
    }

    switch (state.currentStep) {
        case 'full_name':
            if (text.length < 5) {
                return bot.sendMessage(chatId, 'Имя должно содержать минимум 5 символов. Попробуйте еще раз:');
            }
            state.data.full_name = text;
            state.currentStep = 'birth_date';
            return bot.sendMessage(chatId, 'Введите вашу дату рождения в формате ДД.ММ.ГГГГ:');

        case 'birth_date':
            const birthDate = validateDate(text);
            if (!birthDate) {
                return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
            }
            state.data.birth_date = birthDate;
            state.currentStep = 'phone';
            return bot.sendMessage(chatId, 'Введите ваш номер телефона в формате +79999999999:');

        case 'phone':
            const phone = validatePhone(text);
            if (!phone) {
                return bot.sendMessage(chatId, 'Неверный формат номера телефона. Используйте формат +79999999999:');
            }
            state.data.phone = phone;
            state.currentStep = 'has_child';
            return bot.sendMessage(chatId, 'У вас есть ребенок, которого вы будете записать на тренировки?', {
                reply_markup: {
                    keyboard: [['Да', 'Нет']],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });

        case 'has_child':
            if (text.toLowerCase() === 'да') {
                state.currentStep = 'child_name';
                return bot.sendMessage(chatId, 'Введите полное имя ребенка (ФИО):');
            } else {
                return await completeRegistration(bot, chatId, state);
            }

        case 'child_name':
            if (text.length < 5) {
                return bot.sendMessage(chatId, 'Имя должно содержать минимум 5 символов. Попробуйте еще раз:');
            }
            state.data.child = { 
                full_name: text,
                sport_type: null,
                skill_level: null
            };
            state.currentStep = 'child_birth_date';
            return bot.sendMessage(chatId, 'Введите дату рождения ребенка в формате ДД.ММ.ГГГГ:');

        case 'child_birth_date':
            const childBirthDate = validateDate(text);
            if (!childBirthDate) {
                return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
            }
            state.data.child.birth_date = childBirthDate;
            return await completeRegistration(bot, chatId, state);
    }
}

// Завершение регистрации
async function completeRegistration(bot, chatId, state) {
    try {
        const { clientId } = await createClient(state.data);
        
        await bot.sendMessage(chatId, 
            'Регистрация успешно завершена!\n\n' +
            'Теперь вы можете использовать все функции бота.'
        );

        showMainMenu(bot, chatId);
        userStates.delete(chatId);
    } catch (error) {
        console.error('Ошибка при регистрации:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при регистрации. Пожалуйста, попробуйте позже.');
    }
}

// Валидация даты
function validateDate(dateStr) {
    const [day, month, year] = dateStr.split('.');
    const date = new Date(year, month - 1, day);
    
    if (date.getDate() !== parseInt(day) || 
        date.getMonth() !== parseInt(month) - 1 || 
        date.getFullYear() !== parseInt(year)) {
        return null;
    }
    
    return date.toISOString().split('T')[0];
}

// Валидация телефона
function validatePhone(phone) {
    const phoneRegex = /^\+7\d{10}$/;
    if (!phoneRegex.test(phone)) {
        return null;
    }
    return phone;
}

// Показ главного меню
function showMainMenu(bot, chatId) {
    const keyboard = {
        reply_markup: {
            keyboard: [
                ['📝 Записаться на тренировку'],
                ['📋 Мои записи', '👤 Личная информация'],
                ['🎁 Подарочный сертификат', '💰 Кошелек']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    return bot.sendMessage(chatId, 'Выберите действие:', keyboard);
}

// Обработка редактирования профиля
async function handleProfileEdit(bot, msg, state) {
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

module.exports = {
    handleRegistration,
    handleProfileEdit,
    showMainMenu
}; 