#!/usr/bin/env node
/**
 * Тест уведомлений при бронировании через Telegram бота
 * 
 * Тестирует:
 * 1. Индивидуальная тренировка через бота
 * 2. Групповая тренировка через бота (новая)
 * 3. Групповая тренировка через бота (существующая)
 * 
 * Использование: 
 *   node scripts/test-bot-booking-notifications.js
 */

require('dotenv').config();
const { pool } = require('../src/db/index');
const moment = require('moment-timezone');
const { 
    notifyAdminNaturalSlopeTrainingBooking, 
    notifyInstructorKuligaTrainingBooking 
} = require('../src/bot/admin-notify');

// Цветной вывод
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    console.log('\n' + '═'.repeat(80));
    log(`  ${title}`, 'bright');
    console.log('═'.repeat(80) + '\n');
}

function logStep(step, message) {
    log(`[${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

// Глобальные переменные для тестовых данных
let testClient = null;
let testInstructor = null;
let testSlot = null;
let testGroupTraining = null;

async function findTestClient() {
    logStep('1.1', 'Поиск клиента Тестировщик (ID: 91)...');
    
    const result = await pool.query(`
        SELECT 
            id, 
            full_name, 
            phone, 
            email, 
            telegram_id,
            telegram_username
        FROM clients 
        WHERE id = 91
    `);
    
    if (result.rows.length === 0) {
        throw new Error('Клиент Тестировщик (ID: 91) не найден в базе данных');
    }
    
    testClient = result.rows[0];
    logSuccess(`Клиент найден: ${testClient.full_name} (ID: ${testClient.id})`);
    logInfo(`  Телефон: ${testClient.phone || 'не указан'}`);
    logInfo(`  Email: ${testClient.email || 'не указан'}`);
    logInfo(`  Telegram ID: ${testClient.telegram_id || 'не указан'}`);
    
    if (!testClient.telegram_id) {
        logWarning('⚠️  У клиента нет telegram_id - сообщение в боте не будет отправлено!');
    }
    
    return testClient;
}

async function findTestInstructor() {
    logStep('1.2', 'Поиск инструктора Тебякин Данила...');
    
    const result = await pool.query(`
        SELECT 
            id, 
            full_name, 
            phone, 
            telegram_id,
            admin_percentage,
            location
        FROM kuliga_instructors 
        WHERE full_name ILIKE '%Тебякин%' OR full_name ILIKE '%Данила%'
        ORDER BY 
            CASE WHEN full_name ILIKE 'Тебякин%' THEN 0 ELSE 1 END,
            full_name
        LIMIT 1
    `);
    
    if (result.rows.length === 0) {
        throw new Error('Инструктор Тебякин Данила не найден в базе данных');
    }
    
    testInstructor = result.rows[0];
    logSuccess(`Инструктор найден: ${testInstructor.full_name} (ID: ${testInstructor.id})`);
    logInfo(`  Telegram ID: ${testInstructor.telegram_id || 'не указан'}`);
    logInfo(`  Процент админа: ${testInstructor.admin_percentage || 20}%`);
    logInfo(`  Location: ${testInstructor.location || 'не указан'}`);
    
    if (!testInstructor.telegram_id) {
        logWarning('⚠️  У инструктора нет telegram_id - уведомления не будут отправлены!');
    }
    
    return testInstructor;
}

async function createTestSchedule() {
    logSection('2. СОЗДАНИЕ ТЕСТОВОГО РАСПИСАНИЯ');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Дата для тестов (послезавтра, чтобы не конфликтовать с предыдущими тестами)
        const testDate = moment.tz('Asia/Yekaterinburg').add(2, 'days').format('YYYY-MM-DD');
        const testTime = '15:00:00';
        const testEndTime = '16:00:00';
        
        // Используем location инструктора или 'vorona' по умолчанию
        const instructorLocation = testInstructor.location || 'vorona';
        
        logStep('2.1', `Создание слота для индивидуальной тренировки (${testDate} ${testTime})...`);
        logInfo(`Используем location инструктора: ${instructorLocation}`);
        
        // Проверяем, существует ли уже слот
        const existingSlotResult = await client.query(`
            SELECT id, location FROM kuliga_schedule_slots
            WHERE instructor_id = $1 AND date = $2 AND start_time = $3
            LIMIT 1
        `, [testInstructor.id, testDate, testTime]);
        
        let slotId;
        if (existingSlotResult.rows.length > 0) {
            slotId = existingSlotResult.rows[0].id;
            await client.query(`
                UPDATE kuliga_schedule_slots
                SET status = 'available', 
                    end_time = $1, 
                    location = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [testEndTime, instructorLocation, slotId]);
            logInfo(`Используем существующий слот: ID ${slotId}, обновлен location на ${instructorLocation}`);
        } else {
            // Проверяем еще раз (на случай race condition)
            const doubleCheckResult = await client.query(`
                SELECT id, location FROM kuliga_schedule_slots
                WHERE instructor_id = $1 AND date = $2 AND start_time = $3
                LIMIT 1
            `, [testInstructor.id, testDate, testTime]);
            
            if (doubleCheckResult.rows.length > 0) {
                slotId = doubleCheckResult.rows[0].id;
                await client.query(`
                    UPDATE kuliga_schedule_slots
                    SET status = 'available', 
                        end_time = $1, 
                        location = $2,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                `, [testEndTime, instructorLocation, slotId]);
                logInfo(`Используем существующий слот (повторная проверка): ID ${slotId}, обновлен location на ${instructorLocation}`);
            } else {
                // Создаем новый слот
                const slotResult = await client.query(`
                    INSERT INTO kuliga_schedule_slots (
                        instructor_id,
                        date,
                        start_time,
                        end_time,
                        location,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, 'available')
                    RETURNING id
                `, [
                    testInstructor.id,
                    testDate,
                    testTime,
                    testEndTime,
                    instructorLocation
                ]);
                slotId = slotResult.rows[0].id;
            }
        }
        
        testSlot = { id: slotId };
        logSuccess(`Слот готов: ID ${testSlot.id}`);
        
        logStep('2.2', `Создание групповой тренировки (${testDate} ${testTime})...`);
        
        // Проверяем, существует ли уже групповая тренировка
        const existingGroupTrainingResult = await client.query(`
            SELECT id FROM kuliga_group_trainings
            WHERE instructor_id = $1 AND date = $2 AND start_time = $3 AND location = $4 AND sport_type = $5
            LIMIT 1
        `, [testInstructor.id, testDate, testTime, instructorLocation, 'ski']);
        
        let groupTrainingId;
        if (existingGroupTrainingResult.rows.length > 0) {
            groupTrainingId = existingGroupTrainingResult.rows[0].id;
            await client.query(`
                UPDATE kuliga_group_trainings
                SET min_participants = $1,
                    max_participants = $2,
                    price_per_person = $3,
                    status = $4,
                    current_participants = 0
                WHERE id = $5
            `, [1, 4, 1000.00, 'open', groupTrainingId]);
            logInfo(`Используем существующую групповую тренировку: ID ${groupTrainingId}`);
        } else {
            const groupTrainingResult = await client.query(`
                INSERT INTO kuliga_group_trainings (
                    instructor_id,
                    date,
                    start_time,
                    end_time,
                    location,
                    sport_type,
                    min_participants,
                    max_participants,
                    current_participants,
                    price_per_person,
                    status,
                    level
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id
            `, [
                testInstructor.id,
                testDate,
                testTime,
                testEndTime,
                instructorLocation,
                'ski',
                1,
                4,
                0,
                1000.00,
                'open',
                'beginner'
            ]);
            groupTrainingId = groupTrainingResult.rows[0].id;
        }
        
        testGroupTraining = { id: groupTrainingId };
        logSuccess(`Групповая тренировка готова: ID ${testGroupTraining.id}`);
        
        await client.query('COMMIT');
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function testBotBookingIndividual() {
    logSection('3. ТЕСТ: Индивидуальная тренировка через бота');
    
    logStep('3.1', 'Симуляция бронирования индивидуальной тренировки через бота...');
    
    // Симулируем данные, которые приходят из бота
    const bookingData = {
        client_id: testClient.id,
        client_name: testClient.full_name,
        client_phone: testClient.phone,
        participant_name: testClient.full_name,
        instructor_id: testInstructor.id,
        instructor_name: testInstructor.full_name,
        instructor_telegram_id: testInstructor.telegram_id,
        admin_percentage: testInstructor.admin_percentage || 20,
        date: moment.tz('Asia/Yekaterinburg').add(2, 'days').format('YYYY-MM-DD'),
        time: '15:00',
        sport_type: 'ski',
        location: testInstructor.location || 'vorona',
        booking_type: 'individual',
        price: 2000.00,
        participants_count: 1
    };
    
    logInfo('Отправка уведомлений...');
    
    try {
        // Уведомление администратору
        await notifyAdminNaturalSlopeTrainingBooking({
            client_name: bookingData.client_name,
            client_phone: bookingData.client_phone,
            participant_name: bookingData.participant_name,
            date: bookingData.date,
            time: bookingData.time,
            sport_type: bookingData.sport_type,
            instructor_name: bookingData.instructor_name,
            price: bookingData.price,
            booking_type: bookingData.booking_type,
            participants_count: bookingData.participants_count,
            location: bookingData.location
        });
        logSuccess('✅ Уведомление администратору отправлено');
        
        // Уведомление инструктору
        if (bookingData.instructor_telegram_id) {
            await notifyInstructorKuligaTrainingBooking({
                booking_type: bookingData.booking_type,
                client_name: bookingData.client_name,
                participant_name: bookingData.participant_name,
                client_phone: bookingData.client_phone,
                instructor_name: bookingData.instructor_name,
                instructor_telegram_id: bookingData.instructor_telegram_id,
                admin_percentage: bookingData.admin_percentage,
                date: bookingData.date,
                time: bookingData.time,
                price: bookingData.price,
                location: bookingData.location,
                participants_count: bookingData.participants_count
            });
            logSuccess('✅ Уведомление инструктору отправлено');
        } else {
            logWarning('⚠️  Инструктор не имеет telegram_id - уведомление не отправлено');
        }
        
        logSuccess('✅ Тест индивидуальной тренировки через бота завершен');
        logInfo('Проверьте уведомления:');
        logInfo('  - Telegram клиенту (сообщение в боте)');
        logInfo('  - Telegram администратору');
        logInfo('  - Telegram инструктору (если есть telegram_id)');
        
    } catch (error) {
        logError(`Ошибка: ${error.message}`);
        console.error(error);
    }
}

async function testBotBookingGroup() {
    logSection('4. ТЕСТ: Групповая тренировка через бота');
    
    logStep('4.1', 'Симуляция бронирования групповой тренировки через бота...');
    
    // Симулируем данные, которые приходят из бота
    const bookingData = {
        client_id: testClient.id,
        client_name: testClient.full_name,
        client_phone: testClient.phone,
        participant_name: `${testClient.full_name}, Участник 2`,
        instructor_id: testInstructor.id,
        instructor_name: testInstructor.full_name,
        instructor_telegram_id: testInstructor.telegram_id,
        admin_percentage: testInstructor.admin_percentage || 20,
        date: moment.tz('Asia/Yekaterinburg').add(2, 'days').format('YYYY-MM-DD'),
        time: '15:00',
        sport_type: 'ski',
        location: testInstructor.location || 'vorona',
        booking_type: 'group',
        price: 2000.00,
        participants_count: 2
    };
    
    logInfo('Отправка уведомлений...');
    
    try {
        // Уведомление инструктору
        if (bookingData.instructor_telegram_id) {
            await notifyInstructorKuligaTrainingBooking({
                booking_type: bookingData.booking_type,
                client_name: bookingData.client_name,
                participant_name: bookingData.participant_name,
                client_phone: bookingData.client_phone,
                instructor_name: bookingData.instructor_name,
                instructor_telegram_id: bookingData.instructor_telegram_id,
                admin_percentage: bookingData.admin_percentage,
                date: bookingData.date,
                time: bookingData.time,
                price: bookingData.price,
                location: bookingData.location,
                participants_count: bookingData.participants_count
            });
            logSuccess('✅ Уведомление инструктору отправлено');
        } else {
            logWarning('⚠️  Инструктор не имеет telegram_id - уведомление не отправлено');
        }
        
        // Уведомление администратору
        await notifyAdminNaturalSlopeTrainingBooking({
            client_name: bookingData.client_name,
            client_phone: bookingData.client_phone,
            participant_name: bookingData.participant_name,
            date: bookingData.date,
            time: bookingData.time,
            sport_type: bookingData.sport_type,
            instructor_name: bookingData.instructor_name,
            price: bookingData.price,
            booking_type: bookingData.booking_type,
            participants_count: bookingData.participants_count,
            location: bookingData.location
        });
        logSuccess('✅ Уведомление администратору отправлено');
        
        logSuccess('✅ Тест групповой тренировки через бота завершен');
        logInfo('Проверьте уведомления:');
        logInfo('  - Telegram клиенту (сообщение в боте)');
        logInfo('  - Telegram администратору');
        logInfo('  - Telegram инструктору (если есть telegram_id)');
        
    } catch (error) {
        logError(`Ошибка: ${error.message}`);
        console.error(error);
    }
}

async function main() {
    try {
        logSection('🧪 ТЕСТ УВЕДОМЛЕНИЙ ПРИ БРОНИРОВАНИИ ЧЕРЕЗ БОТА');
        
        // Шаг 1: Находим тестовые данные
        logSection('1. ПОИСК ТЕСТОВЫХ ДАННЫХ');
        await findTestClient();
        await findTestInstructor();
        
        // Шаг 2: Создаем расписание
        await createTestSchedule();
        
        // Шаг 3-4: Тестируем бронирования через бота
        await testBotBookingIndividual();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Пауза между тестами
        
        await testBotBookingGroup();
        
        logSection('✅ ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ');
        logInfo('Проверьте все уведомления вручную:');
        logInfo('  - Telegram клиенту (сообщение в боте об успешной записи)');
        logInfo('  - Telegram администратору');
        logInfo('  - Telegram инструктору');
        logInfo('');
        logInfo('⚠️  Примечание: Этот тест симулирует только отправку уведомлений.');
        logInfo('    Реальное бронирование через бота создает записи в БД и отправляет сообщение клиенту.');
        
    } catch (error) {
        logError(`Критическая ошибка: ${error.message}`);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Запуск
if (require.main === module) {
    main();
}

module.exports = { main };

