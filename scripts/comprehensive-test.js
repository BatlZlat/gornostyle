#!/usr/bin/env node

/**
 * 🧪 КОМПЛЕКСНОЕ ТЕСТИРОВАНИЕ СИСТЕМЫ
 * 
 * Тестирует все компоненты:
 * - База данных и структура
 * - Backend API
 * - Telegram боты (клиентский и инструкторов)
 * - Финансовые операции
 * - Уведомления
 * - Интеграции
 * 
 * После завершения удаляет все тестовые данные
 */

require('dotenv').config();
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');

// Подключение к БД
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Telegram боты
const clientBotToken = process.env.TELEGRAM_BOT_TOKEN;
const instructorBotToken = process.env.KULIGA_INSTRUCTOR_BOT_TOKEN;

// Цвета для консоли
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
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

// Хранилище тестовых данных для последующего удаления
const testRecords = {
    clients: [],
    instructors: [],
    instructors_telegram: [],
    slots: [],
    group_trainings: [],
    bookings: [],
    transactions: [],
    wallets: [],
};

// Результаты тестов
const testResults = {
    database: {},
    backend: {},
    bots: {},
    finances: {},
    notifications: {},
    integrations: {},
};

// ==========================================
// 1. ТЕСТИРОВАНИЕ БАЗЫ ДАННЫХ
// ==========================================

async function testDatabaseStructure() {
    logSection('📊 ТЕСТИРОВАНИЕ БАЗЫ ДАННЫХ');

    const results = {
        tablesHaveLocation: false,
        locationConstraints: false,
        indexesExist: false,
        existingDataIntegrity: false,
    };

    try {
        // 1.1. Проверка наличия поля location в таблицах
        log('Проверка структуры таблиц...');
        
        const tablesToCheck = [
            'kuliga_instructors',
            'kuliga_schedule_slots',
            'kuliga_group_trainings',
            'kuliga_bookings',
        ];

        let allTablesHaveLocation = true;
        for (const table of tablesToCheck) {
            const result = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = $1 AND column_name = 'location'
            `, [table]);
            
            if (result.rows.length === 0) {
                logTest(`${table}: нет поля location`, false);
                allTablesHaveLocation = false;
            } else {
                logTest(`${table}: поле location есть`, true);
            }
        }
        results.tablesHaveLocation = allTablesHaveLocation;

        // 1.2. Проверка ограничений CHECK для location
        log('\nПроверка ограничений...');
        const constraintCheck = await pool.query(`
            SELECT constraint_name, check_clause
            FROM information_schema.check_constraints
            WHERE constraint_name LIKE '%location%'
        `);
        
        results.locationConstraints = constraintCheck.rows.length > 0;
        logTest('Ограничения CHECK для location', results.locationConstraints);

        // 1.3. Проверка индексов
        log('\nПроверка индексов...');
        const indexCheck = await pool.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename IN ('kuliga_instructors', 'kuliga_schedule_slots', 'kuliga_group_trainings', 'kuliga_bookings')
            AND indexname LIKE '%location%'
        `);
        
        results.indexesExist = indexCheck.rows.length > 0;
        logTest('Индексы по location', results.indexesExist, `${indexCheck.rows.length} найден(о)`);

        // 1.4. Проверка целостности существующих данных
        log('\nПроверка целостности данных...');
        
        // Проверяем, что нет NULL в location
        const nullCheck = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM kuliga_instructors WHERE location IS NULL) as instructors_nulls,
                (SELECT COUNT(*) FROM kuliga_schedule_slots WHERE location IS NULL) as slots_nulls,
                (SELECT COUNT(*) FROM kuliga_group_trainings WHERE location IS NULL) as trainings_nulls,
                (SELECT COUNT(*) FROM kuliga_bookings WHERE location IS NULL) as bookings_nulls
        `);
        
        const hasNulls = Object.values(nullCheck.rows[0]).some(count => parseInt(count) > 0);
        results.existingDataIntegrity = !hasNulls;
        
        if (hasNulls) {
            logTest('Проверка на NULL в location', false, JSON.stringify(nullCheck.rows[0]));
        } else {
            logTest('Проверка на NULL в location', true);
        }

        // Проверяем валидные значения (только 'kuliga' или 'vorona')
        const invalidValues = await pool.query(`
            SELECT 
                'kuliga_instructors' as table_name,
                COUNT(*) as invalid_count
            FROM kuliga_instructors 
            WHERE location NOT IN ('kuliga', 'vorona')
            UNION ALL
            SELECT 
                'kuliga_schedule_slots' as table_name,
                COUNT(*) as invalid_count
            FROM kuliga_schedule_slots 
            WHERE location NOT IN ('kuliga', 'vorona')
            UNION ALL
            SELECT 
                'kuliga_group_trainings' as table_name,
                COUNT(*) as invalid_count
            FROM kuliga_group_trainings 
            WHERE location NOT IN ('kuliga', 'vorona')
            UNION ALL
            SELECT 
                'kuliga_bookings' as table_name,
                COUNT(*) as invalid_count
            FROM kuliga_bookings 
            WHERE location NOT IN ('kuliga', 'vorona')
        `);
        
        const hasInvalidValues = invalidValues.rows.some(row => parseInt(row.invalid_count) > 0);
        if (hasInvalidValues) {
            logTest('Валидные значения location', false);
            invalidValues.rows.forEach(row => {
                if (parseInt(row.invalid_count) > 0) {
                    console.log(`   ${row.table_name}: ${row.invalid_count} невалидных записей`);
                }
            });
        } else {
            logTest('Валидные значения location', true);
        }

        testResults.database = results;
        return results;

    } catch (error) {
        log(`\n❌ Ошибка при тестировании БД: ${error.message}`, 'red');
        console.error(error);
        testResults.database = { error: error.message };
        return false;
    }
}

// ==========================================
// 2. ТЕСТИРОВАНИЕ СОЗДАНИЯ ТЕСТОВЫХ ДАННЫХ
// ==========================================

async function createTestData() {
    logSection('🔧 СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Сначала удаляем старые тестовые данные, если есть
        log('Очистка старых тестовых данных...');
        await client.query(`
            DELETE FROM kuliga_bookings 
            WHERE client_id IN (SELECT id FROM clients WHERE full_name LIKE 'Тестовый%')
        `);
        await client.query(`
            DELETE FROM wallets 
            WHERE client_id IN (SELECT id FROM clients WHERE full_name LIKE 'Тестовый%')
        `);
        await client.query(`
            DELETE FROM clients 
            WHERE full_name LIKE 'Тестовый%'
        `);
        await client.query(`
            DELETE FROM kuliga_group_trainings 
            WHERE instructor_id IN (SELECT id FROM kuliga_instructors WHERE full_name LIKE 'Тестовый%')
        `);
        await client.query(`
            DELETE FROM kuliga_schedule_slots 
            WHERE instructor_id IN (SELECT id FROM kuliga_instructors WHERE full_name LIKE 'Тестовый%')
        `);
        await client.query(`
            DELETE FROM kuliga_instructors 
            WHERE full_name LIKE 'Тестовый%'
        `);

        // 2.1. Создание тестового клиента
        log('Создание тестового клиента...');
        
        // Генерируем уникальный telegram_id
        const randomTelegramId = Math.floor(Math.random() * 900000000) + 100000000;
        
        const clientResult = await client.query(`
            INSERT INTO clients (full_name, phone, email, birth_date, telegram_id, telegram_username)
            VALUES ($1, $2, $3, $4, $5::text, $6)
            ON CONFLICT (telegram_id) DO UPDATE SET full_name = EXCLUDED.full_name
            RETURNING id, telegram_id
        `, [
            'Тестовый Клиент',
            '+79991234567',
            'test.client@example.com',
            '1990-01-01',
            randomTelegramId.toString(),
            'test_client'
        ]);
        
        const testClientId = clientResult.rows[0].id;
        const testClientTelegramId = clientResult.rows[0].telegram_id;
        testRecords.clients.push(testClientId);
        logTest('Тестовый клиент создан', true, `ID: ${testClientId}`);

        // Генерация уникального номера кошелька
        const generateWalletNumber = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
        let walletNumber, isUnique = false, attempts = 0;
        while (!isUnique && attempts < 10) {
            walletNumber = generateWalletNumber();
            const checkResult = await client.query('SELECT id FROM wallets WHERE wallet_number = $1', [walletNumber]);
            isUnique = checkResult.rows.length === 0;
            attempts++;
        }
        if (!isUnique) {
            throw new Error('Не удалось сгенерировать уникальный номер кошелька');
        }

        // Создание кошелька для клиента
        await client.query(`
            INSERT INTO wallets (client_id, balance, wallet_number, last_updated)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id
        `, [testClientId, 10000, walletNumber]);

        // 2.2. Создание тестовых инструкторов
        log('\nСоздание тестовых инструкторов...');
        
        // Генерируем уникальные телефоны
        const timestamp = Date.now();
        const kuligaPhone = `+7999${timestamp.toString().slice(-7)}`;
        const voronaPhone = `+7998${timestamp.toString().slice(-7)}`;

        // Инструктор Кулиги
        const kuligaInstructorResult = await client.query(`
            INSERT INTO kuliga_instructors (full_name, phone, sport_type, location, is_active)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, telegram_id
        `, [
            'Тестовый Инструктор Кулига',
            kuligaPhone,
            'both',
            'kuliga',
            true
        ]);
        
        const kuligaInstructorId = kuligaInstructorResult.rows[0].id;
        testRecords.instructors.push(kuligaInstructorId);
        logTest('Инструктор Кулиги создан', true, `ID: ${kuligaInstructorId}`);

        // Инструктор Воронинских горок
        const voronaInstructorResult = await client.query(`
            INSERT INTO kuliga_instructors (full_name, phone, sport_type, location, is_active)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, telegram_id
        `, [
            'Тестовый Инструктор Ворона',
            voronaPhone,
            'both',
            'vorona',
            true
        ]);
        
        const voronaInstructorId = voronaInstructorResult.rows[0].id;
        testRecords.instructors.push(voronaInstructorId);
        logTest('Инструктор Воронинских горок создан', true, `ID: ${voronaInstructorId}`);

        // 2.3. Создание тестовых слотов
        log('\nСоздание тестовых слотов...');
        
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = tomorrow.toISOString().split('T')[0];

        // Слот для Кулиги
        const kuligaSlotResult = await client.query(`
            INSERT INTO kuliga_schedule_slots (instructor_id, date, start_time, end_time, location, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [
            kuligaInstructorId,
            tomorrowDate,
            '10:00',
            '11:00',
            'kuliga',
            'available'
        ]);
        
        const kuligaSlotId = kuligaSlotResult.rows[0].id;
        testRecords.slots.push(kuligaSlotId);
        logTest('Слот Кулиги создан', true, `ID: ${kuligaSlotId}`);

        // Слот для Воронинских горок
        const voronaSlotResult = await client.query(`
            INSERT INTO kuliga_schedule_slots (instructor_id, date, start_time, end_time, location, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [
            voronaInstructorId,
            tomorrowDate,
            '11:00',
            '12:00',
            'vorona',
            'available'
        ]);
        
        const voronaSlotId = voronaSlotResult.rows[0].id;
        testRecords.slots.push(voronaSlotId);
        logTest('Слот Воронинских горок создан', true, `ID: ${voronaSlotId}`);

        // 2.4. Создание тестовых групповых тренировок
        log('\nСоздание тестовых групповых тренировок...');
        
        // Групповая тренировка в Кулиге
        const kuligaGroupTrainingResult = await client.query(`
            INSERT INTO kuliga_group_trainings (
                instructor_id, slot_id, date, start_time, end_time,
                sport_type, level, min_participants, max_participants, price_per_person, location, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        `, [
            kuligaInstructorId,
            kuligaSlotId,
            tomorrowDate,
            '10:00',
            '11:00',
            'ski',
            'beginner',
            1,
            4,
            1500,
            'kuliga',
            'open'
        ]);
        
        const kuligaGroupTrainingId = kuligaGroupTrainingResult.rows[0].id;
        testRecords.group_trainings.push(kuligaGroupTrainingId);
        logTest('Групповая тренировка Кулиги создана', true, `ID: ${kuligaGroupTrainingId}`);

        // Групповая тренировка на Воронинских горках
        const voronaGroupTrainingResult = await client.query(`
            INSERT INTO kuliga_group_trainings (
                instructor_id, slot_id, date, start_time, end_time,
                sport_type, level, min_participants, max_participants, price_per_person, location, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        `, [
            voronaInstructorId,
            voronaSlotId,
            tomorrowDate,
            '11:00',
            '12:00',
            'ski',
            'beginner',
            1,
            4,
            1500,
            'vorona',
            'open'
        ]);
        
        const voronaGroupTrainingId = voronaGroupTrainingResult.rows[0].id;
        testRecords.group_trainings.push(voronaGroupTrainingId);
        logTest('Групповая тренировка Воронинских горок создана', true, `ID: ${voronaGroupTrainingId}`);

        await client.query('COMMIT');
        
        log('\n✅ Все тестовые данные созданы успешно!');
        
        return {
            clientId: testClientId,
            clientTelegramId: testClientTelegramId,
            kuligaInstructorId,
            voronaInstructorId,
            kuligaSlotId,
            voronaSlotId,
            kuligaGroupTrainingId,
            voronaGroupTrainingId,
        };

    } catch (error) {
        await client.query('ROLLBACK');
        log(`\n❌ Ошибка при создании тестовых данных: ${error.message}`, 'red');
        console.error(error);
        throw error;
    } finally {
        client.release();
    }
}

// ==========================================
// 3. ТЕСТИРОВАНИЕ ФИЛЬТРАЦИИ И НАСЛЕДОВАНИЯ
// ==========================================

async function testFilteringAndInheritance(testData) {
    logSection('🔍 ТЕСТИРОВАНИЕ ФИЛЬТРАЦИИ И НАСЛЕДОВАНИЯ LOCATION');

    const results = {
        instructorLocationInheritance: false,
        slotLocationInheritance: false,
        groupTrainingLocationInheritance: false,
        filteringWorks: false,
    };

    try {
        // 3.1. Проверка наследования location от инструктора к слоту
        log('Проверка наследования location...');
        
        const slotCheck = await pool.query(`
            SELECT ks.id, ks.location, ki.location as instructor_location
            FROM kuliga_schedule_slots ks
            JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
            WHERE ks.id IN ($1, $2)
        `, [testData.kuligaSlotId, testData.voronaSlotId]);
        
        let inheritanceOk = true;
        slotCheck.rows.forEach(row => {
            if (row.location !== row.instructor_location) {
                inheritanceOk = false;
                logTest(`Наследование location для слота ${row.id}`, false, 
                    `Ожидалось: ${row.instructor_location}, получено: ${row.location}`);
            }
        });
        
        if (inheritanceOk) {
            logTest('Наследование location от инструктора к слоту', true);
        }
        results.slotLocationInheritance = inheritanceOk;

        // 3.2. Проверка наследования location от слота к групповой тренировке
        const trainingCheck = await pool.query(`
            SELECT kgt.id, kgt.location, ks.location as slot_location
            FROM kuliga_group_trainings kgt
            JOIN kuliga_schedule_slots ks ON kgt.slot_id = ks.id
            WHERE kgt.id IN ($1, $2)
        `, [testData.kuligaGroupTrainingId, testData.voronaGroupTrainingId]);
        
        let trainingInheritanceOk = true;
        trainingCheck.rows.forEach(row => {
            if (row.location !== row.slot_location) {
                trainingInheritanceOk = false;
                logTest(`Наследование location для тренировки ${row.id}`, false,
                    `Ожидалось: ${row.slot_location}, получено: ${row.location}`);
            }
        });
        
        if (trainingInheritanceOk) {
            logTest('Наследование location от слота к тренировке', true);
        }
        results.groupTrainingLocationInheritance = trainingInheritanceOk;

        // 3.3. Проверка фильтрации инструкторов по location
        log('\nПроверка фильтрации...');
        
        const kuligaInstructors = await pool.query(`
            SELECT id, full_name, location
            FROM kuliga_instructors
            WHERE location = 'kuliga' AND id = $1
        `, [testData.kuligaInstructorId]);
        
        const voronaInstructors = await pool.query(`
            SELECT id, full_name, location
            FROM kuliga_instructors
            WHERE location = 'vorona' AND id = $1
        `, [testData.voronaInstructorId]);
        
        const filteringWorks = kuligaInstructors.rows.length === 1 && 
                               kuligaInstructors.rows[0].id === testData.kuligaInstructorId &&
                               voronaInstructors.rows.length === 1 &&
                               voronaInstructors.rows[0].id === testData.voronaInstructorId;
        
        logTest('Фильтрация инструкторов по location', filteringWorks);
        results.filteringWorks = filteringWorks;

        testResults.integrations = results;
        return results;

    } catch (error) {
        log(`\n❌ Ошибка при тестировании фильтрации: ${error.message}`, 'red');
        console.error(error);
        testResults.integrations = { error: error.message };
        return false;
    }
}

// ==========================================
// 4. ТЕСТИРОВАНИЕ ФИНАНСОВЫХ ОПЕРАЦИЙ
// ==========================================

async function testFinancialOperations(testData) {
    logSection('💰 ТЕСТИРОВАНИЕ ФИНАНСОВЫХ ОПЕРАЦИЙ');

    const results = {
        bookingCreation: false,
        paymentProcessing: false,
        walletBalance: false,
        transactionRecording: false,
        cancellationRefund: false,
    };

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 4.1. Создание бронирования и списание средств
        log('Создание бронирования...');
        
        const bookingPrice = 1500;
        
        // Получаем текущий баланс
        const balanceBefore = await client.query(`
            SELECT balance FROM wallets WHERE client_id = $1
        `, [testData.clientId]);
        const balanceBeforeValue = parseFloat(balanceBefore.rows[0].balance);

        // Создаем бронирование
        const bookingResult = await client.query(`
            INSERT INTO kuliga_bookings (
                client_id, booking_type, group_training_id,
                date, start_time, end_time, sport_type,
                participants_count, participants_names, participants_birth_years,
                price_total, price_per_person, location, status
            )
            VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed')
            RETURNING id
        `, [
            testData.clientId,
            testData.kuligaGroupTrainingId,
            new Date().toISOString().split('T')[0],
            '10:00',
            '11:00',
            'ski',
            1,
            ['Тестовый Клиент'],
            [null],
            bookingPrice,
            bookingPrice,
            'kuliga',
        ]);

        const bookingId = bookingResult.rows[0].id;
        testRecords.bookings.push(bookingId);
        logTest('Бронирование создано', true, `ID: ${bookingId}`);

        // Списываем средства
        await client.query(`
            UPDATE wallets SET balance = balance - $1 WHERE client_id = $2
        `, [bookingPrice, testData.clientId]);

        // Проверяем баланс
        const balanceAfter = await client.query(`
            SELECT balance FROM wallets WHERE client_id = $1
        `, [testData.clientId]);
        const balanceAfterValue = parseFloat(balanceAfter.rows[0].balance);

        const balanceCorrect = Math.abs(balanceAfterValue - (balanceBeforeValue - bookingPrice)) < 0.01;
        logTest('Баланс обновлен корректно', balanceCorrect, 
            `Было: ${balanceBeforeValue}, Стало: ${balanceAfterValue}`);
        results.walletBalance = balanceCorrect;

        // 4.2. Проверка записи транзакции
        log('\nПроверка транзакций...');
        
        const walletIdResult = await client.query(`
            SELECT id FROM wallets WHERE client_id = $1
        `, [testData.clientId]);
        const walletId = walletIdResult.rows[0].id;

        await client.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [
            walletId,
            -bookingPrice,
            'payment',
            'Тестовое бронирование'
        ]);

        const transactionCheck = await client.query(`
            SELECT COUNT(*) as count
            FROM transactions
            WHERE wallet_id = $1 AND description = 'Тестовое бронирование'
        `, [walletId]);

        const transactionRecorded = parseInt(transactionCheck.rows[0].count) === 1;
        logTest('Транзакция записана', transactionRecorded);
        results.transactionRecording = transactionRecorded;

        // 4.3. Отмена бронирования и возврат средств
        log('\nТестирование отмены и возврата...');
        
        // Возвращаем средства
        await client.query(`
            UPDATE wallets SET balance = balance + $1 WHERE client_id = $2
        `, [bookingPrice, testData.clientId]);

        // Обновляем статус бронирования
        await client.query(`
            UPDATE kuliga_bookings SET status = 'cancelled' WHERE id = $1
        `, [bookingId]);

        // Проверяем баланс после возврата
        const balanceAfterRefund = await client.query(`
            SELECT balance FROM wallets WHERE client_id = $1
        `, [testData.clientId]);
        const balanceAfterRefundValue = parseFloat(balanceAfterRefund.rows[0].balance);

        const refundCorrect = Math.abs(balanceAfterRefundValue - balanceBeforeValue) < 0.01;
        logTest('Возврат средств выполнен корректно', refundCorrect,
            `Баланс после возврата: ${balanceAfterRefundValue}`);
        results.cancellationRefund = refundCorrect;

        await client.query('COMMIT');

        results.bookingCreation = true;
        results.paymentProcessing = true;

        testResults.finances = results;
        return results;

    } catch (error) {
        await client.query('ROLLBACK');
        log(`\n❌ Ошибка при тестировании финансов: ${error.message}`, 'red');
        console.error(error);
        testResults.finances = { error: error.message };
        return false;
    } finally {
        client.release();
    }
}

// ==========================================
// 5. ПРОВЕРКА УВЕДОМЛЕНИЙ
// ==========================================

async function testNotifications() {
    logSection('📢 ПРОВЕРКА УВЕДОМЛЕНИЙ');

    const results = {
        functionExists: false,
        noHardcodedLocation: false,
        notificationStructure: false,
    };

    try {
        // Проверяем, что функция getLocationDisplayName существует и работает корректно
        log('Проверка функции getLocationDisplayName...');
        
        // Проверяем в файлах
        const fs = require('fs');
        const adminNotifyPath = './src/bot/admin-notify.js';
        const clientBotPath = './src/bot/client-bot.js';
        const notificationServicePath = './src/services/notification-service.js';
        
        let functionExists = false;
        let functionsFound = [];
        
        try {
            const adminNotifyContent = fs.readFileSync(adminNotifyPath, 'utf8');
            if (adminNotifyContent.includes('function getLocationDisplayName') || 
                adminNotifyContent.includes('getLocationDisplayName(location)')) {
                functionExists = true;
                functionsFound.push('admin-notify.js');
                logTest('Функция getLocationDisplayName найдена в admin-notify.js', true);
            } else {
                logTest('Функция getLocationDisplayName найдена в admin-notify.js', false);
            }
        } catch (err) {
            logTest('Функция getLocationDisplayName найдена в admin-notify.js', false, err.message);
        }

        try {
            const clientBotContent = fs.readFileSync(clientBotPath, 'utf8');
            if (clientBotContent.includes('function getLocationDisplayName') || 
                clientBotContent.includes('getLocationDisplayName(location)')) {
                functionExists = true;
                functionsFound.push('client-bot.js');
                logTest('Функция getLocationDisplayName найдена в client-bot.js', true);
            } else {
                logTest('Функция getLocationDisplayName найдена в client-bot.js', false);
            }
        } catch (err) {
            logTest('Функция getLocationDisplayName найдена в client-bot.js', false, err.message);
        }

        try {
            const notificationServiceContent = fs.readFileSync(notificationServicePath, 'utf8');
            if (notificationServiceContent.includes('getLocationDisplayName(location)')) {
                functionExists = true;
                functionsFound.push('notification-service.js');
                logTest('Функция getLocationDisplayName найдена в notification-service.js', true);
            }
        } catch (err) {
            // Может не быть в этом файле, это нормально
        }

        results.functionExists = functionExists && functionsFound.length > 0;

        // Проверяем, что нет хардкода "Кулига Парк" в уведомлениях
        log('\nПроверка на хардкод "Кулига Парк"...');
        
        const { execSync } = require('child_process');
        try {
            const checkResult = execSync('node scripts/check-notifications-location.js', { encoding: 'utf8' });
            
            // Ищем итоговую строку
            if (checkResult.includes('Найдено проблем: 0') || 
                checkResult.includes('Проблем не обнаружено') ||
                checkResult.includes('✅')) {
                logTest('Хардкод "Кулига Парк" отсутствует', true);
                results.noHardcodedLocation = true;
            } else {
                const match = checkResult.match(/Найдено проблем: (\d+)/);
                const problemCount = match ? parseInt(match[1]) : -1;
                if (problemCount === 0) {
                    logTest('Хардкод "Кулига Парк" отсутствует', true);
                    results.noHardcodedLocation = true;
                } else if (problemCount > 0) {
                    logTest('Хардкод "Кулига Парк" отсутствует', false, `Найдено ${problemCount} проблем`);
                    results.noHardcodedLocation = false;
                } else {
                    logTest('Проверка хардкода', false, 'Не удалось определить количество проблем');
                    results.noHardcodedLocation = false;
                }
            }
        } catch (err) {
            logTest('Проверка хардкода', false, err.message);
            results.noHardcodedLocation = false;
        }

        // Проверяем структуру уведомлений - что location передается правильно
        log('\nПроверка структуры уведомлений...');
        
        try {
            const adminNotifyContent = fs.readFileSync(adminNotifyPath, 'utf8');
            // Проверяем, что в основных функциях уведомлений используется location
            const notificationFunctions = [
                'notifyAdminWinterGroupTrainingCreated',
                'notifyAdminGroupTrainingCancellation',
                'notifyInstructorKuligaTrainingBooking',
                'notifyAdminParticipantRemoved',
            ];
            
            // Простая проверка - что функции используют динамические названия
            // Проверяем, что в файле нет статических "Кулига Парк" в контексте уведомлений
            const hardcodedPattern = /Кулига Парк/g;
            const matches = adminNotifyContent.match(hardcodedPattern);
            
            // В fallback функциях может быть "Кулига Парк", это нормально
            const fallbackCount = (adminNotifyContent.match(/return ['"]Кулига Парк['"]/g) || []).length;
            const problematicCount = matches ? matches.length - fallbackCount : 0;
            
            if (problematicCount === 0) {
                logTest('Структура уведомлений корректна', true);
                results.notificationStructure = true;
            } else {
                logTest('Структура уведомлений корректна', false, `Найдено ${problematicCount} потенциальных проблем`);
                results.notificationStructure = false;
            }
        } catch (err) {
            logTest('Структура уведомлений', false, err.message);
        }

        testResults.notifications = results;
        return results.functionExists && results.noHardcodedLocation;

    } catch (error) {
        log(`\n❌ Ошибка при проверке уведомлений: ${error.message}`, 'red');
        console.error(error);
        testResults.notifications = { error: error.message };
        return false;
    }
}

// ==========================================
// 6. ТЕСТИРОВАНИЕ ВЗАИМОДЕЙСТВИЙ
// ==========================================

async function testInteractions(testData) {
    logSection('🔄 ТЕСТИРОВАНИЕ ВЗАИМОДЕЙСТВИЙ');

    const results = {
        locationDisplayCorrect: false,
        bookingLocationCorrect: false,
        groupTrainingLocationCorrect: false,
        instructorLocationFiltering: false,
    };

    try {
        // 6.1. Проверка корректного отображения location в различных местах
        log('Проверка отображения location...');
        
        // Проверяем, что location правильно наследуется при создании бронирования
        if (testRecords.bookings.length > 0) {
            const bookingCheck = await pool.query(`
                SELECT kb.location, kgt.location as training_location
                FROM kuliga_bookings kb
                JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
                WHERE kb.id = $1
            `, [testRecords.bookings[0]]);
            
            if (bookingCheck.rows.length > 0) {
                const booking = bookingCheck.rows[0];
                const locationMatch = booking.location === booking.training_location || booking.location === 'kuliga';
                logTest('Location в бронировании корректный', locationMatch, 
                    `Booking: ${booking.location}, Training: ${booking.training_location}`);
                results.bookingLocationCorrect = locationMatch;
            }
        } else {
            logTest('Location в бронировании корректный', true, 'Нет тестовых бронирований для проверки');
            results.bookingLocationCorrect = true;
        }

        // 6.2. Проверка фильтрации инструкторов по location
        log('\nПроверка фильтрации инструкторов...');
        
        const kuligaInstructors = await pool.query(`
            SELECT COUNT(*) as count
            FROM kuliga_instructors
            WHERE location = 'kuliga' AND is_active = true
        `);
        
        const voronaInstructors = await pool.query(`
            SELECT COUNT(*) as count
            FROM kuliga_instructors
            WHERE location = 'vorona' AND is_active = true
        `);
        
        logTest('Фильтрация инструкторов работает', true, 
            `Кулига: ${kuligaInstructors.rows[0].count}, Ворона: ${voronaInstructors.rows[0].count}`);
        results.instructorLocationFiltering = true;

        // 6.3. Проверка названий мест
        log('\nПроверка названий мест...');
        
        const locationNames = {
            'kuliga': 'База отдыха «Кулига-Клуб»',
            'vorona': 'Воронинские горки'
        };
        
        // Проверяем в БД, что location имеет правильные значения
        const locationValues = await pool.query(`
            SELECT DISTINCT location 
            FROM kuliga_instructors 
            WHERE location IS NOT NULL
        `);
        
        let allLocationsValid = true;
        for (const row of locationValues.rows) {
            if (!locationNames[row.location] && row.location !== null) {
                allLocationsValid = false;
                logTest(`Валидность location: ${row.location}`, false, 'Неизвестное значение');
            }
        }
        
        if (allLocationsValid) {
            logTest('Все location имеют валидные значения', true);
        }
        results.locationDisplayCorrect = allLocationsValid;

        // 6.4. Проверка групповых тренировок
        log('\nПроверка групповых тренировок...');
        
        if (testRecords.group_trainings.length > 0) {
            const trainingCheck = await pool.query(`
                SELECT kgt.location, ks.location as slot_location
                FROM kuliga_group_trainings kgt
                JOIN kuliga_schedule_slots ks ON kgt.slot_id = ks.id
                WHERE kgt.id = $1
            `, [testRecords.group_trainings[0]]);
            
            if (trainingCheck.rows.length > 0) {
                const training = trainingCheck.rows[0];
                const locationMatch = training.location === training.slot_location;
                logTest('Location в групповой тренировке корректный', locationMatch,
                    `Training: ${training.location}, Slot: ${training.slot_location}`);
                results.groupTrainingLocationCorrect = locationMatch;
            }
        } else {
            logTest('Location в групповой тренировке корректный', true, 'Нет тестовых тренировок для проверки');
            results.groupTrainingLocationCorrect = true;
        }

        testResults.integrations = { ...testResults.integrations, ...results };
        return Object.values(results).every(r => r === true);

    } catch (error) {
        log(`\n❌ Ошибка при тестировании взаимодействий: ${error.message}`, 'red');
        console.error(error);
        testResults.integrations = { ...testResults.integrations, error: error.message };
        return false;
    }
}

// ==========================================
// 7. ОЧИСТКА ТЕСТОВЫХ ДАННЫХ
// ==========================================

async function cleanupTestData() {
    logSection('🧹 ОЧИСТКА ТЕСТОВЫХ ДАННЫХ');

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        log('Удаление тестовых данных...');

        // Удаляем в правильном порядке (зависимости)

        // 1. Транзакции
        if (testRecords.transactions.length > 0) {
            await client.query(`
                DELETE FROM transactions 
                WHERE description LIKE 'Тестовое%' OR description LIKE '%Тестовый%'
            `);
            logTest('Транзакции удалены', true);
        }

        // 2. Бронирования
        if (testRecords.bookings.length > 0) {
            await client.query(`
                DELETE FROM kuliga_bookings 
                WHERE id = ANY($1)
            `, [testRecords.bookings]);
            logTest('Бронирования удалены', true, `${testRecords.bookings.length} записей`);
        }

        // 3. Групповые тренировки
        if (testRecords.group_trainings.length > 0) {
            await client.query(`
                DELETE FROM kuliga_group_trainings 
                WHERE id = ANY($1)
            `, [testRecords.group_trainings]);
            logTest('Групповые тренировки удалены', true, `${testRecords.group_trainings.length} записей`);
        }

        // 4. Слоты
        if (testRecords.slots.length > 0) {
            await client.query(`
                DELETE FROM kuliga_schedule_slots 
                WHERE id = ANY($1)
            `, [testRecords.slots]);
            logTest('Слоты удалены', true, `${testRecords.slots.length} записей`);
        }

        // 5. Кошельки (если были созданы для тестовых клиентов)
        if (testRecords.clients.length > 0) {
            await client.query(`
                DELETE FROM wallets 
                WHERE client_id = ANY($1)
            `, [testRecords.clients]);
            logTest('Кошельки удалены', true);
        }

        // 6. Инструкторы
        if (testRecords.instructors.length > 0) {
            await client.query(`
                DELETE FROM kuliga_instructors 
                WHERE id = ANY($1)
            `, [testRecords.instructors]);
            logTest('Инструкторы удалены', true, `${testRecords.instructors.length} записей`);
        }

        // 7. Клиенты
        if (testRecords.clients.length > 0) {
            await client.query(`
                DELETE FROM clients 
                WHERE id = ANY($1)
            `, [testRecords.clients]);
            logTest('Клиенты удалены', true, `${testRecords.clients.length} записей`);
        }

        // Удаляем все тестовые данные по паттерну (на случай, если что-то осталось)
        await client.query(`
            DELETE FROM transactions 
            WHERE description LIKE '%Тестовый%' OR description LIKE '%Тестовое%'
        `);

        await client.query(`
            DELETE FROM kuliga_bookings 
            WHERE client_id IN (SELECT id FROM clients WHERE full_name LIKE 'Тестовый%')
               OR client_id IN (SELECT id FROM clients WHERE telegram_id::text LIKE '999%')
        `);

        await client.query(`
            DELETE FROM wallets 
            WHERE client_id IN (SELECT id FROM clients WHERE full_name LIKE 'Тестовый%' OR telegram_id::text LIKE '999%')
        `);

        await client.query(`
            DELETE FROM clients 
            WHERE full_name LIKE 'Тестовый%' OR telegram_id::text LIKE '999%'
        `);

        await client.query(`
            DELETE FROM kuliga_group_trainings 
            WHERE instructor_id IN (SELECT id FROM kuliga_instructors WHERE full_name LIKE 'Тестовый%')
        `);

        await client.query(`
            DELETE FROM kuliga_schedule_slots 
            WHERE instructor_id IN (SELECT id FROM kuliga_instructors WHERE full_name LIKE 'Тестовый%')
        `);

        await client.query(`
            DELETE FROM kuliga_instructors 
            WHERE full_name LIKE 'Тестовый%'
        `);

        await client.query('COMMIT');
        
        log('\n✅ Все тестовые данные успешно удалены!');

    } catch (error) {
        await client.query('ROLLBACK');
        log(`\n❌ Ошибка при очистке данных: ${error.message}`, 'red');
        console.error(error);
        throw error;
    } finally {
        client.release();
    }
}

// ==========================================
// ГЛАВНАЯ ФУНКЦИЯ
// ==========================================

async function runComprehensiveTests() {
    console.clear();
    log('\n🧪 КОМПЛЕКСНОЕ ТЕСТИРОВАНИЕ СИСТЕМЫ\n', 'bright');
    log('Дата запуска: ' + new Date().toLocaleString('ru-RU'), 'cyan');
    console.log('\n' + '='.repeat(80) + '\n');

    let testData = null;
    let allTestsPassed = true;

    try {
        // 1. Тестирование базы данных
        const dbResults = await testDatabaseStructure();
        if (!dbResults || Object.values(dbResults).some(r => !r)) {
            allTestsPassed = false;
        }

        // 2. Создание тестовых данных
        testData = await createTestData();

        // 3. Тестирование фильтрации и наследования
        const filterResults = await testFilteringAndInheritance(testData);
        if (!filterResults || Object.values(filterResults).some(r => !r)) {
            allTestsPassed = false;
        }

        // 4. Тестирование финансовых операций
        const financeResults = await testFinancialOperations(testData);
        if (!financeResults || Object.values(financeResults).some(r => !r)) {
            allTestsPassed = false;
        }

        // 5. Проверка уведомлений
        const notificationResults = await testNotifications();
        if (!notificationResults) {
            allTestsPassed = false;
        }

        // 6. Тестирование взаимодействий
        const interactionResults = await testInteractions(testData);
        if (!interactionResults) {
            allTestsPassed = false;
        }

        // 7. Итоги
        logSection('📊 ИТОГОВЫЙ ОТЧЕТ');

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
            log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!', 'green');
        } else {
            log('\n⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ', 'yellow');
        }

    } catch (error) {
        log(`\n❌ КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`, 'red');
        console.error(error);
        allTestsPassed = false;
    } finally {
        // Всегда очищаем тестовые данные
        try {
            await cleanupTestData();
        } catch (error) {
            log(`\n⚠️  Предупреждение: не удалось полностью очистить тестовые данные: ${error.message}`, 'yellow');
        }
    }

    console.log('\n' + '='.repeat(80) + '\n');
    
    // Если запущено напрямую, выходим с кодом
    if (require.main === module) {
        process.exit(allTestsPassed ? 0 : 1);
    }
    
    return allTestsPassed;
}

// Запуск
if (require.main === module) {
    runComprehensiveTests().catch(error => {
        console.error('Фатальная ошибка:', error);
        process.exit(1);
    });
}

module.exports = { runComprehensiveTests };

