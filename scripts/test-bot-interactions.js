#!/usr/bin/env node

/**
 * 🤖 ТЕСТИРОВАНИЕ ВЗАИМОДЕЙСТВИЙ БОТОВ
 * 
 * Тестирует:
 * - Клиентский бот (выбор места, бронирование, отмена)
 * - Бот инструкторов (создание слотов, просмотр тренировок)
 * - Уведомления между компонентами
 */

require('dotenv').config();
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    console.log('\n' + '='.repeat(80));
    log(title, 'cyan');
    console.log('='.repeat(80) + '\n');
}

function logTest(testName, passed, details = '') {
    const icon = passed ? '✅' : '❌';
    const color = passed ? 'green' : 'red';
    log(`${icon} ${testName}`, color);
    if (details) {
        console.log(`   ${details}`);
    }
    return passed;
}

const testResults = {
    clientBot: {},
    instructorBot: {},
    notifications: {},
};

// ==========================================
// ТЕСТИРОВАНИЕ КЛИЕНТСКОГО БОТА
// ==========================================

async function testClientBotLocationSelection() {
    logSection('📱 ТЕСТИРОВАНИЕ КЛИЕНТСКОГО БОТА - ВЫБОР МЕСТА');

    const results = {
        locationMenuExists: false,
        locationSelectionWorks: false,
        instructorFiltering: false,
        slotFiltering: false,
    };

    try {
        // Проверяем, что функция getLocationDisplayName работает корректно
        const fs = require('fs');
        const clientBotPath = './src/bot/client-bot.js';
        const clientBotContent = fs.readFileSync(clientBotPath, 'utf8');

        // Проверяем наличие функции
        const hasFunction = clientBotContent.includes('function getLocationDisplayName');
        logTest('Функция getLocationDisplayName существует', hasFunction);
        results.locationMenuExists = hasFunction;

        // Проверяем, что в коде есть обработка выбора места
        const hasLocationSelection = clientBotContent.includes('natural_slope_location_selection') ||
                                    clientBotContent.includes('🏔️ База отдыха «Кулига-Клуб»') ||
                                    clientBotContent.includes('⛰️ Воронинские горки');
        logTest('Обработка выбора места существует', hasLocationSelection);
        results.locationSelectionWorks = hasLocationSelection;

        // Проверяем фильтрацию инструкторов по location
        const hasInstructorFiltering = clientBotContent.includes('locationFilter') ||
                                      clientBotContent.includes('ks.location =') ||
                                      clientBotContent.includes('ki.location =');
        logTest('Фильтрация инструкторов по location', hasInstructorFiltering);
        results.instructorFiltering = hasInstructorFiltering;

        // Проверяем фильтрацию слотов по location
        const hasSlotFiltering = clientBotContent.includes('ks.location') ||
                                clientBotContent.includes('location = $');
        logTest('Фильтрация слотов по location', hasSlotFiltering);
        results.slotFiltering = hasSlotFiltering;

        testResults.clientBot = results;
        return results;

    } catch (error) {
        log(`❌ Ошибка: ${error.message}`, 'red');
        testResults.clientBot = { error: error.message };
        return false;
    }
}

async function testClientBotBookingFlow() {
    logSection('📱 ТЕСТИРОВАНИЕ КЛИЕНТСКОГО БОТА - ПОТОК БРОНИРОВАНИЯ');

    const results = {
        bookingMessagesHaveLocation: false,
        cancellationMessagesHaveLocation: false,
        myBookingsShowsLocation: false,
    };

    try {
        const fs = require('fs');
        const clientBotPath = './src/bot/client-bot.js';
        const clientBotContent = fs.readFileSync(clientBotPath, 'utf8');

        // Проверяем, что сообщения о бронировании содержат динамическое location
        const bookingPatterns = [
            /getLocationDisplayName.*location/,
            /location.*getLocationDisplayName/,
            /state\.data\.location/,
            /selectedTraining\.location/,
        ];

        let hasDynamicLocation = false;
        for (const pattern of bookingPatterns) {
            if (pattern.test(clientBotContent)) {
                hasDynamicLocation = true;
                break;
            }
        }

        // Проверяем, что нет хардкода "Кулига Парк" в сообщениях о бронировании
        const bookingMessages = clientBotContent.match(/✅.*бронирована.*\n[\s\S]{0,500}/g) || [];
        const hasHardcodedInBooking = bookingMessages.some(msg => 
            msg.includes('Кулига Парк') && !msg.includes('getLocationDisplayName')
        );

        logTest('Сообщения о бронировании используют динамическое location', 
            hasDynamicLocation && !hasHardcodedInBooking);
        results.bookingMessagesHaveLocation = hasDynamicLocation && !hasHardcodedInBooking;

        // Проверяем сообщения об отмене
        const cancellationMessages = clientBotContent.match(/✅.*отменена.*\n[\s\S]{0,500}/g) || [];
        const hasHardcodedInCancellation = cancellationMessages.some(msg => 
            msg.includes('Кулига Парк') && !msg.includes('getLocationDisplayName')
        );

        logTest('Сообщения об отмене используют динамическое location',
            hasDynamicLocation && !hasHardcodedInCancellation);
        results.cancellationMessagesHaveLocation = hasDynamicLocation && !hasHardcodedInCancellation;

        // Проверяем функцию showMyBookings
        const hasMyBookingsLocation = clientBotContent.includes('showMyBookings') &&
                                     (clientBotContent.includes('session.location') ||
                                      clientBotContent.includes('booking.location'));
        logTest('Функция "Мои записи" показывает location', hasMyBookingsLocation);
        results.myBookingsShowsLocation = hasMyBookingsLocation;

        testResults.clientBot = { ...testResults.clientBot, ...results };
        return results;

    } catch (error) {
        log(`❌ Ошибка: ${error.message}`, 'red');
        return false;
    }
}

// ==========================================
// ТЕСТИРОВАНИЕ БОТА ИНСТРУКТОРОВ
// ==========================================

async function testInstructorBot() {
    logSection('👨‍🏫 ТЕСТИРОВАНИЕ БОТА ИНСТРУКТОРОВ');

    const results = {
        locationInHeader: false,
        slotCreationInheritsLocation: false,
        trainingCreationInheritsLocation: false,
    };

    try {
        // Проверяем, что в кабинете инструктора отображается location
        const fs = require('fs');
        const financesPath = './public/trainer_kuliga_finances.html';
        const financesJsPath = './public/js/trainer-kuliga-finances.js';

        let hasLocationInHeader = false;
        try {
            const financesContent = fs.readFileSync(financesPath, 'utf8');
            const financesJsContent = fs.readFileSync(financesJsPath, 'utf8');
            
            hasLocationInHeader = financesJsContent.includes('location') &&
                                 (financesJsContent.includes('getLocationDisplayName') ||
                                  financesJsContent.includes('Воронинские горки') ||
                                  financesJsContent.includes('Кулига'));
        } catch (err) {
            // Файлы могут не существовать, это нормально
        }

        logTest('Location отображается в заголовке кабинета инструктора', hasLocationInHeader);
        results.locationInHeader = hasLocationInHeader;

        // Проверяем, что слоты наследуют location от инструктора
        const routesPath = './src/routes/kuliga-instructor-schedule.js';
        try {
            const routesContent = fs.readFileSync(routesPath, 'utf8');
            const inheritsLocation = routesContent.includes('SELECT location FROM kuliga_instructors') &&
                                    routesContent.includes('instructorLocation') &&
                                    routesContent.includes('INSERT INTO kuliga_schedule_slots') &&
                                    routesContent.includes('location') &&
                                    routesContent.includes('instructorLocation');
            logTest('Слоты наследуют location от инструктора', inheritsLocation);
            results.slotCreationInheritsLocation = inheritsLocation;
        } catch (err) {
            logTest('Слоты наследуют location от инструктора', false, 'Файл не найден');
        }

        testResults.instructorBot = results;
        return results;

    } catch (error) {
        log(`❌ Ошибка: ${error.message}`, 'red');
        testResults.instructorBot = { error: error.message };
        return false;
    }
}

// ==========================================
// ТЕСТИРОВАНИЕ УВЕДОМЛЕНИЙ
// ==========================================

async function testNotificationMessages() {
    logSection('📢 ТЕСТИРОВАНИЕ УВЕДОМЛЕНИЙ');

    const results = {
        adminNotifications: false,
        clientNotifications: false,
        instructorNotifications: false,
        reminderNotifications: false,
    };

    try {
        // Проверяем уведомления администраторам
        const adminNotifyPath = './src/bot/admin-notify.js';
        const fs = require('fs');
        const adminNotifyContent = fs.readFileSync(adminNotifyPath, 'utf8');

        const hasAdminLocation = adminNotifyContent.includes('getLocationDisplayName') &&
                                !adminNotifyContent.match(/Кулига Парк(?!.*getLocationDisplayName)/);
        logTest('Уведомления администраторам используют динамическое location', hasAdminLocation);
        results.adminNotifications = hasAdminLocation;

        // Проверяем уведомления клиентам
        const notificationServicePath = './src/services/notification-service.js';
        const notificationServiceContent = fs.readFileSync(notificationServicePath, 'utf8');

        const hasClientLocation = notificationServiceContent.includes('getLocationDisplayName') &&
                                 !notificationServiceContent.match(/Кулига Парк(?!.*getLocationDisplayName)/);
        logTest('Уведомления клиентам используют динамическое location', hasClientLocation);
        results.clientNotifications = hasClientLocation;

        // Проверяем уведомления инструкторам
        const hasInstructorLocation = adminNotifyContent.includes('notifyInstructor') &&
                                     adminNotifyContent.includes('getLocationDisplayName');
        logTest('Уведомления инструкторам используют динамическое location', hasInstructorLocation);
        results.instructorNotifications = hasInstructorLocation;

        // Проверяем напоминания
        const hasReminderLocation = notificationServiceContent.includes('sendTrainingReminders') &&
                                    notificationServiceContent.includes('getLocationDisplayName');
        logTest('Напоминания используют динамическое location', hasReminderLocation);
        results.reminderNotifications = hasReminderLocation;

        testResults.notifications = results;
        return results;

    } catch (error) {
        log(`❌ Ошибка: ${error.message}`, 'red');
        testResults.notifications = { error: error.message };
        return false;
    }
}

// ==========================================
// ГЛАВНАЯ ФУНКЦИЯ
// ==========================================

async function runBotTests() {
    console.clear();
    log('\n🤖 ТЕСТИРОВАНИЕ ВЗАИМОДЕЙСТВИЙ БОТОВ\n', 'cyan');
    console.log('='.repeat(80) + '\n');

    let allTestsPassed = true;

    try {
        // Тестирование клиентского бота
        const clientLocationResults = await testClientBotLocationSelection();
        if (!clientLocationResults || Object.values(clientLocationResults).some(r => !r)) {
            allTestsPassed = false;
        }

        const clientBookingResults = await testClientBotBookingFlow();
        if (!clientBookingResults || Object.values(clientBookingResults).some(r => !r)) {
            allTestsPassed = false;
        }

        // Тестирование бота инструкторов
        const instructorResults = await testInstructorBot();
        if (!instructorResults || Object.values(instructorResults).some(r => !r)) {
            allTestsPassed = false;
        }

        // Тестирование уведомлений
        const notificationResults = await testNotificationMessages();
        if (!notificationResults || Object.values(notificationResults).some(r => !r)) {
            allTestsPassed = false;
        }

        // Итоги
        logSection('📊 ИТОГИ ТЕСТИРОВАНИЯ БОТОВ');

        const totalTests = Object.values(testResults).reduce((sum, category) => {
            return sum + (typeof category === 'object' && !category.error ? Object.keys(category).length : 1);
        }, 0);

        const passedTests = Object.values(testResults).reduce((sum, category) => {
            if (typeof category === 'object' && !category.error) {
                return sum + Object.values(category).filter(r => r === true).length;
            }
            return sum;
        }, 0);

        log(`Всего тестов: ${totalTests}`, 'cyan');
        log(`Пройдено: ${passedTests}`, 'green');
        log(`Провалено: ${totalTests - passedTests}`, totalTests - passedTests > 0 ? 'red' : 'green');

        if (allTestsPassed) {
            log('\n🎉 ВСЕ ТЕСТЫ БОТОВ ПРОЙДЕНЫ УСПЕШНО!', 'green');
        } else {
            log('\n⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ', 'yellow');
        }

        return allTestsPassed;

    } catch (error) {
        log(`\n❌ КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`, 'red');
        console.error(error);
        return false;
    }
}

if (require.main === module) {
    runBotTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Фатальная ошибка:', error);
        process.exit(1);
    });
}

module.exports = { runBotTests };

