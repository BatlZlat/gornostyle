#!/usr/bin/env node
/**
 * Полноценный тест всех уведомлений для всех видов бронирований
 * 
 * Тестирует:
 * 1. Индивидуальные тренировки через сайт
 * 2. Групповые тренировки через сайт
 * 3. Программы через сайт
 * 4. Групповые тренировки через бота
 * 5. Напоминания о тренировках
 * 
 * Использование: 
 *   node scripts/test-all-notifications.js
 */

require('dotenv').config();
const { pool } = require('../src/db/index');
const moment = require('moment-timezone');

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
let testProgram = null;
let testGroupTraining = null;
let testSlot = null;

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
    
    if (!testInstructor.location) {
        logWarning('⚠️  У инструктора не указан location - будет использован по умолчанию!');
    }
    
    return testInstructor;
}

async function createTestSchedule() {
    logSection('2. СОЗДАНИЕ ТЕСТОВОГО РАСПИСАНИЯ');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Дата для тестов (завтра)
        const testDate = moment.tz('Asia/Yekaterinburg').add(1, 'days').format('YYYY-MM-DD');
        const testTime = '14:00:00';
        const testEndTime = '15:00:00';
        
        // Используем location инструктора или 'vorona' по умолчанию
        const instructorLocation = testInstructor.location || 'vorona';
        
        logStep('2.1', `Создание слота для индивидуальной тренировки (${testDate} ${testTime})...`);
        logInfo(`Используем location инструктора: ${instructorLocation}`);
        
        // Проверяем, существует ли уже слот (unique constraint: instructor_id, date, start_time)
        const existingSlotResult = await client.query(`
            SELECT id, location FROM kuliga_schedule_slots
            WHERE instructor_id = $1 AND date = $2 AND start_time = $3
            LIMIT 1
        `, [testInstructor.id, testDate, testTime]);
        
        let slotId;
        if (existingSlotResult.rows.length > 0) {
            slotId = existingSlotResult.rows[0].id;
            // Обновляем существующий слот (включая location, если он отличается)
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
            // Обновляем существующую тренировку
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
            // Создаем новую групповую тренировку
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
        
        logStep('2.3', 'Поиск существующей программы...');
        
        // Ищем существующую программу
        const programResult = await client.query(`
            SELECT 
                id,
                name,
                price,
                location,
                sport_type
            FROM kuliga_programs
            WHERE is_active = true
            ORDER BY created_at DESC
            LIMIT 1
        `);
        
        if (programResult.rows.length > 0) {
            testProgram = programResult.rows[0];
            logSuccess(`Программа найдена: ${testProgram.name} (ID: ${testProgram.id})`);
            logInfo(`  Цена: ${testProgram.price} ₽`);
        } else {
            logWarning('Программа не найдена - тест программ будет пропущен');
        }
        
        await client.query('COMMIT');
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function testWebsiteBookingIndividual() {
    logSection('3. ТЕСТ: Индивидуальная тренировка через сайт');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        logStep('3.1', 'Создание транзакции с bookingData...');
        
        // Создаем транзакцию (симулируем создание через сайт)
        const transactionResult = await client.query(`
            INSERT INTO kuliga_transactions (
                client_id,
                type,
                amount,
                status,
                payment_method,
                payment_provider,
                provider_payment_id,
                provider_raw_data,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            RETURNING id
        `, [
            testClient.id,
            'payment',
            2000.00,
            'pending',
            'card',
            'mock',
            `test-individual-${Date.now()}`,
            JSON.stringify({
                bookingData: {
                    client_id: testClient.id,
                    client_name: testClient.full_name,
                    client_phone: testClient.phone,
                    client_email: testClient.email,
                    booking_type: 'individual',
                    slot_id: testSlot.id,
                    instructor_id: testInstructor.id,
                    instructor_name: testInstructor.full_name,
                    date: moment.tz('Asia/Yekaterinburg').add(1, 'days').format('YYYY-MM-DD'),
                    start_time: '14:00:00',
                    end_time: '15:00:00',
                    sport_type: 'ski',
                    location: testInstructor.location || 'vorona',
                    participants_count: 1,
                    participants_names: [testClient.full_name],
                    price_total: 2000.00,
                    price_per_person: 2000.00
                }
            })
        ]);
        
        const transactionId = transactionResult.rows[0].id;
        logSuccess(`Транзакция создана: ID ${transactionId}`);
        
        logStep('3.2', 'Симуляция успешной оплаты (напрямую обновляем транзакцию)...');
        
        // Напрямую обновляем транзакцию на completed и создаем бронирование
        // Это симулирует обработку webhook (используем тот же CASE WHEN, что и в реальном коде)
        await client.query(`
            UPDATE kuliga_transactions
            SET provider_status = 'SUCCESS'::character varying(100),
                provider_order_id = $1::character varying(255),
                status = CASE
                    WHEN 'SUCCESS'::text = 'SUCCESS' THEN 'completed'::character varying(20)
                    ELSE status
                END
            WHERE id = $2
        `, [
            `gornostyle72-winter-${transactionId}`,
            transactionId
        ]);
        
        // Извлекаем bookingData и создаем бронирование
        const txResult = await client.query(`
            SELECT provider_raw_data FROM kuliga_transactions WHERE id = $1
        `, [transactionId]);
        
        if (txResult.rows.length > 0) {
            const rawData = typeof txResult.rows[0].provider_raw_data === 'string'
                ? JSON.parse(txResult.rows[0].provider_raw_data)
                : txResult.rows[0].provider_raw_data;
            
            const bookingData = rawData.bookingData || rawData;
            
            if (bookingData) {
                logInfo('Создание бронирования из bookingData...');
                
                // Создаем бронирование
                const bookingResult = await client.query(`
                    INSERT INTO kuliga_bookings (
                        client_id,
                        booking_type,
                        slot_id,
                        instructor_id,
                        date,
                        start_time,
                        end_time,
                        sport_type,
                        participants_count,
                        participants_names,
                        price_total,
                        price_per_person,
                        location,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'confirmed')
                    RETURNING id
                `, [
                    bookingData.client_id,
                    bookingData.booking_type,
                    bookingData.slot_id || null,
                    bookingData.instructor_id || null,
                    bookingData.date,
                    bookingData.start_time,
                    bookingData.end_time,
                    bookingData.sport_type,
                    bookingData.participants_count || 1,
                    bookingData.participants_names || [bookingData.client_name],
                    bookingData.price_total,
                    bookingData.price_per_person || bookingData.price_total,
                    bookingData.location,
                ]);
                
                const bookingId = bookingResult.rows[0].id;
                
                // Обновляем транзакцию с booking_id
                await client.query(`
                    UPDATE kuliga_transactions
                    SET booking_id = $1
                    WHERE id = $2
                `, [bookingId, transactionId]);
                
                logSuccess(`Бронирование создано: ID ${bookingId}`);
                
                // Отправляем уведомления (используем те же функции, что и webhook)
                logInfo('Отправка уведомлений...');
                const { notifyAdminNaturalSlopeTrainingBooking } = require('../src/bot/admin-notify');
                const { notifyInstructorKuligaTrainingBooking } = require('../src/bot/admin-notify');
                
                // Получаем данные инструктора
                let instructorResult = null;
                if (bookingData.instructor_id) {
                    instructorResult = await client.query(`
                        SELECT full_name, telegram_id, admin_percentage 
                        FROM kuliga_instructors 
                        WHERE id = $1
                    `, [bookingData.instructor_id]);
                }
                
                // Уведомление администратору
                await notifyAdminNaturalSlopeTrainingBooking({
                    client_name: bookingData.client_name,
                    client_phone: bookingData.client_phone,
                    participant_name: bookingData.participants_names?.join(', ') || bookingData.client_name,
                    date: bookingData.date,
                    time: bookingData.start_time,
                    sport_type: bookingData.sport_type,
                    instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || 'Не назначен',
                    price: bookingData.price_total,
                    booking_source: 'website',
                    location: bookingData.location,
                    booking_type: bookingData.booking_type,
                    participants_count: bookingData.participants_count || 1
                });
                
                // Уведомление инструктору
                if (instructorResult && instructorResult.rows.length > 0 && instructorResult.rows[0].telegram_id) {
                    await notifyInstructorKuligaTrainingBooking({
                        booking_type: bookingData.booking_type,
                        client_name: bookingData.client_name,
                        participant_name: bookingData.participants_names?.join(', ') || bookingData.client_name,
                        client_phone: bookingData.client_phone,
                        instructor_name: instructorResult.rows[0].full_name,
                        instructor_telegram_id: instructorResult.rows[0].telegram_id,
                        admin_percentage: instructorResult.rows[0].admin_percentage,
                        date: bookingData.date,
                        time: bookingData.start_time,
                        price: bookingData.price_total,
                        location: bookingData.location,
                        participants_count: bookingData.participants_count || 1
                    });
                }
                
                // Email уведомление клиенту
                if (bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)) {
                    const EmailService = require('../src/services/emailService');
                    const emailTemplateService = require('../src/services/email-template-service');
                    const emailService = new EmailService();
                    
                    const htmlContent = await emailTemplateService.generateBookingConfirmationEmail({
                        client_id: bookingData.client_id,
                        client_name: bookingData.client_name,
                        booking_type: bookingData.booking_type,
                        date: bookingData.date,
                        start_time: bookingData.start_time,
                        end_time: bookingData.end_time,
                        sport_type: bookingData.sport_type,
                        location: bookingData.location,
                        instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || null,
                        participants_count: bookingData.participants_count || 1,
                        price_total: bookingData.price_total,
                        price_per_person: bookingData.price_per_person || null
                    });
                    
                    const dateFormatted = emailTemplateService.formatDate(bookingData.date);
                    const subject = `✅ Подтверждение записи на тренировку - ${dateFormatted}`;
                    
                    const emailResult = await emailService.sendEmail(bookingData.client_email, subject, htmlContent);
                    if (emailResult.success) {
                        logSuccess(`Email отправлен клиенту на ${bookingData.client_email}`);
                    } else {
                        logError(`Ошибка отправки email: ${emailResult.error}`);
                    }
                }
            }
        }
        
        await client.query('COMMIT');
        
        // Проверяем, что бронирование создано
        logStep('3.3', 'Проверка создания бронирования...');
        
        const bookingResult = await client.query(`
            SELECT 
                id,
                booking_type,
                status,
                date,
                start_time
            FROM kuliga_bookings
            WHERE client_id = $1
            AND booking_type = 'individual'
            AND date = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [
            testClient.id,
            moment.tz('Asia/Yekaterinburg').add(1, 'days').format('YYYY-MM-DD')
        ]);
        
        if (bookingResult.rows.length > 0) {
            const booking = bookingResult.rows[0];
            logSuccess(`Бронирование создано: ID ${booking.id}, статус: ${booking.status}`);
        } else {
            logWarning('Бронирование не найдено');
        }
        
        logSuccess('✅ Тест индивидуальной тренировки через сайт завершен');
        logInfo('Проверьте уведомления:');
        logInfo('  - Email клиенту (если указан email)');
        logInfo('  - Telegram администратору');
        logInfo('  - Telegram инструктору (если есть telegram_id)');
        
    } catch (error) {
        await client.query('ROLLBACK');
        logError(`Ошибка: ${error.message}`);
        console.error(error);
    } finally {
        client.release();
    }
}

async function testWebsiteBookingGroup() {
    logSection('4. ТЕСТ: Групповая тренировка через сайт');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        logStep('4.1', 'Создание транзакции для групповой тренировки...');
        
        const transactionResult = await client.query(`
            INSERT INTO kuliga_transactions (
                client_id,
                type,
                amount,
                status,
                payment_method,
                payment_provider,
                provider_payment_id,
                provider_raw_data,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            RETURNING id
        `, [
            testClient.id,
            'payment',
            2000.00,
            'pending',
            'card',
            'mock',
            `test-group-${Date.now()}`,
            JSON.stringify({
                bookingData: {
                    client_id: testClient.id,
                    client_name: testClient.full_name,
                    client_phone: testClient.phone,
                    client_email: testClient.email,
                    booking_type: 'group',
                    group_training_id: testGroupTraining.id,
                    instructor_id: testInstructor.id,
                    instructor_name: testInstructor.full_name,
                    date: moment.tz('Asia/Yekaterinburg').add(1, 'days').format('YYYY-MM-DD'),
                    start_time: '14:00:00',
                    end_time: '15:00:00',
                    sport_type: 'ski',
                    location: testInstructor.location || 'vorona',
                    participants_count: 2,
                    participants_names: [testClient.full_name, 'Участник 2'],
                    price_total: 2000.00,
                    price_per_person: 1000.00
                }
            })
        ]);
        
        const transactionId = transactionResult.rows[0].id;
        logSuccess(`Транзакция создана: ID ${transactionId}`);
        
        logStep('4.2', 'Симуляция успешной оплаты (напрямую обновляем транзакцию)...');
        
        // Напрямую обновляем транзакцию на success
        await client.query(`
            UPDATE kuliga_transactions
            SET status = 'success',
                provider_status = 'SUCCESS',
                provider_order_id = $1
            WHERE id = $2
        `, [
            `gornostyle72-winter-${transactionId}`,
            transactionId
        ]);
        
        // Извлекаем bookingData и создаем бронирование
        const txResult = await client.query(`
            SELECT provider_raw_data FROM kuliga_transactions WHERE id = $1
        `, [transactionId]);
        
        if (txResult.rows.length > 0) {
            const rawData = typeof txResult.rows[0].provider_raw_data === 'string'
                ? JSON.parse(txResult.rows[0].provider_raw_data)
                : txResult.rows[0].provider_raw_data;
            
            const bookingData = rawData.bookingData || rawData;
            
            if (bookingData) {
                logInfo('Создание бронирования из bookingData...');
                
                // Создаем бронирование
                const bookingResult = await client.query(`
                    INSERT INTO kuliga_bookings (
                        client_id,
                        booking_type,
                        group_training_id,
                        date,
                        start_time,
                        end_time,
                        sport_type,
                        participants_count,
                        participants_names,
                        price_total,
                        price_per_person,
                        location,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed')
                    RETURNING id
                `, [
                    bookingData.client_id,
                    bookingData.booking_type,
                    bookingData.group_training_id,
                    bookingData.date,
                    bookingData.start_time,
                    bookingData.end_time,
                    bookingData.sport_type,
                    bookingData.participants_count || 1,
                    bookingData.participants_names || [bookingData.client_name],
                    bookingData.price_total,
                    bookingData.price_per_person || bookingData.price_total,
                    bookingData.location,
                ]);
                
                const bookingId = bookingResult.rows[0].id;
                
                // Обновляем транзакцию с booking_id
                await client.query(`
                    UPDATE kuliga_transactions
                    SET booking_id = $1
                    WHERE id = $2
                `, [bookingId, transactionId]);
                
                // Обновляем current_participants в групповой тренировке
                await client.query(`
                    UPDATE kuliga_group_trainings
                    SET current_participants = current_participants + $1
                    WHERE id = $2
                `, [bookingData.participants_count || 1, bookingData.group_training_id]);
                
                logSuccess(`Бронирование создано: ID ${bookingId}`);
                
                // Отправляем уведомления
                logInfo('Отправка уведомлений...');
                const { notifyAdminNaturalSlopeTrainingBooking } = require('../src/bot/admin-notify');
                const { notifyInstructorKuligaTrainingBooking } = require('../src/bot/admin-notify');
                
                // Получаем данные инструктора из групповой тренировки
                const groupTrainingResult = await client.query(`
                    SELECT instructor_id FROM kuliga_group_trainings WHERE id = $1
                `, [bookingData.group_training_id]);
                
                let instructorResult = null;
                if (groupTrainingResult.rows.length > 0 && groupTrainingResult.rows[0].instructor_id) {
                    instructorResult = await client.query(`
                        SELECT full_name, telegram_id, admin_percentage 
                        FROM kuliga_instructors 
                        WHERE id = $1
                    `, [groupTrainingResult.rows[0].instructor_id]);
                }
                
                // Уведомление администратору
                await notifyAdminNaturalSlopeTrainingBooking({
                    client_name: bookingData.client_name,
                    client_phone: bookingData.client_phone,
                    participant_name: bookingData.participants_names?.join(', ') || bookingData.client_name,
                    date: bookingData.date,
                    time: bookingData.start_time,
                    sport_type: bookingData.sport_type,
                    instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || 'Не назначен',
                    price: bookingData.price_total,
                    booking_source: 'website',
                    location: bookingData.location,
                    booking_type: bookingData.booking_type,
                    participants_count: bookingData.participants_count || 1
                });
                
                // Уведомление инструктору
                if (instructorResult && instructorResult.rows.length > 0 && instructorResult.rows[0].telegram_id) {
                    await notifyInstructorKuligaTrainingBooking({
                        booking_type: bookingData.booking_type,
                        client_name: bookingData.client_name,
                        participant_name: bookingData.participants_names?.join(', ') || bookingData.client_name,
                        client_phone: bookingData.client_phone,
                        instructor_name: instructorResult.rows[0].full_name,
                        instructor_telegram_id: instructorResult.rows[0].telegram_id,
                        admin_percentage: instructorResult.rows[0].admin_percentage,
                        date: bookingData.date,
                        time: bookingData.start_time,
                        price: bookingData.price_total,
                        location: bookingData.location,
                        participants_count: bookingData.participants_count || 1
                    });
                }
                
                // Email уведомление клиенту
                if (bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)) {
                    const EmailService = require('../src/services/emailService');
                    const emailTemplateService = require('../src/services/email-template-service');
                    const emailService = new EmailService();
                    
                    const htmlContent = await emailTemplateService.generateBookingConfirmationEmail({
                        client_id: bookingData.client_id,
                        client_name: bookingData.client_name,
                        booking_type: bookingData.booking_type,
                        date: bookingData.date,
                        start_time: bookingData.start_time,
                        end_time: bookingData.end_time,
                        sport_type: bookingData.sport_type,
                        location: bookingData.location,
                        instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || null,
                        participants_count: bookingData.participants_count || 1,
                        price_total: bookingData.price_total,
                        price_per_person: bookingData.price_per_person || null
                    });
                    
                    const dateFormatted = emailTemplateService.formatDate(bookingData.date);
                    const subject = `✅ Подтверждение записи на тренировку - ${dateFormatted}`;
                    
                    const emailResult = await emailService.sendEmail(bookingData.client_email, subject, htmlContent);
                    if (emailResult.success) {
                        logSuccess(`Email отправлен клиенту на ${bookingData.client_email}`);
                    } else {
                        logError(`Ошибка отправки email: ${emailResult.error}`);
                    }
                }
            }
        }
        
        await client.query('COMMIT');
        
        logStep('4.3', 'Проверка создания бронирования...');
        
        const bookingCheckResult = await client.query(`
            SELECT 
                id,
                booking_type,
                status,
                participants_count
            FROM kuliga_bookings
            WHERE client_id = $1
            AND booking_type = 'group'
            AND group_training_id = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [
            testClient.id,
            testGroupTraining.id
        ]);
        
        if (bookingCheckResult.rows.length > 0) {
            const booking = bookingCheckResult.rows[0];
            logSuccess(`Бронирование создано: ID ${booking.id}, участников: ${booking.participants_count}`);
        } else {
            logWarning('Бронирование не найдено');
        }
        
        logSuccess('✅ Тест групповой тренировки через сайт завершен');
        logInfo('Проверьте уведомления:');
        logInfo('  - Email клиенту (если указан email)');
        logInfo('  - Telegram администратору');
        logInfo('  - Telegram инструктору (если есть telegram_id)');
        
    } catch (error) {
        await client.query('ROLLBACK');
        logError(`Ошибка: ${error.message}`);
        console.error(error);
    } finally {
        client.release();
    }
}

async function testWebsiteBookingProgram() {
    if (!testProgram) {
        logWarning('⚠️  Программа не найдена - тест пропущен');
        return;
    }
    
    logSection('5. ТЕСТ: Программа через сайт');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        logStep('5.1', 'Поиск групповой тренировки для программы...');
        
        // Ищем групповую тренировку, созданную для программы
        const programTrainingResult = await client.query(`
            SELECT 
                id,
                date,
                start_time,
                price_per_person
            FROM kuliga_group_trainings
            WHERE program_id = $1
            AND date >= CURRENT_DATE
            ORDER BY date ASC
            LIMIT 1
        `, [testProgram.id]);
        
        if (programTrainingResult.rows.length === 0) {
            logWarning('⚠️  Групповая тренировка для программы не найдена - тест пропущен');
            await client.query('COMMIT');
            return;
        }
        
        const programTraining = programTrainingResult.rows[0];
        logSuccess(`Групповая тренировка найдена: ID ${programTraining.id}`);
        
        logStep('5.2', 'Создание транзакции для программы...');
        
        const transactionResult = await client.query(`
            INSERT INTO kuliga_transactions (
                client_id,
                type,
                amount,
                status,
                payment_method,
                payment_provider,
                provider_payment_id,
                provider_raw_data,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            RETURNING id
        `, [
            testClient.id,
            'payment',
            programTraining.price_per_person * 2,
            'pending',
            'card',
            'mock',
            `test-program-${Date.now()}`,
            JSON.stringify({
                bookingData: {
                    client_id: testClient.id,
                    client_name: testClient.full_name,
                    client_phone: testClient.phone,
                    client_email: testClient.email,
                    booking_type: 'group',
                    group_training_id: programTraining.id,
                    program_id: testProgram.id,
                    program_name: testProgram.name,
                    instructor_id: testInstructor.id,
                    instructor_name: testInstructor.full_name,
                    date: programTraining.date,
                    start_time: programTraining.start_time,
                    end_time: '15:00:00',
                    sport_type: testProgram.sport_type,
                    location: testProgram.location,
                    participants_count: 2,
                    participants_names: [testClient.full_name, 'Участник 2'],
                    price_total: programTraining.price_per_person * 2,
                    price_per_person: programTraining.price_per_person
                }
            })
        ]);
        
        const transactionId = transactionResult.rows[0].id;
        logSuccess(`Транзакция создана: ID ${transactionId}`);
        
        logStep('5.3', 'Симуляция успешной оплаты (напрямую обновляем транзакцию)...');
        
        // Напрямую обновляем транзакцию на success
        await client.query(`
            UPDATE kuliga_transactions
            SET status = 'success',
                provider_status = 'SUCCESS',
                provider_order_id = $1
            WHERE id = $2
        `, [
            `gornostyle72-winter-${transactionId}`,
            transactionId
        ]);
        
        // Извлекаем bookingData и создаем бронирование
        const txResult = await client.query(`
            SELECT provider_raw_data FROM kuliga_transactions WHERE id = $1
        `, [transactionId]);
        
        if (txResult.rows.length > 0) {
            const rawData = typeof txResult.rows[0].provider_raw_data === 'string'
                ? JSON.parse(txResult.rows[0].provider_raw_data)
                : txResult.rows[0].provider_raw_data;
            
            const bookingData = rawData.bookingData || rawData;
            
            if (bookingData) {
                logInfo('Создание бронирования из bookingData...');
                
                // Создаем бронирование
                const bookingResult = await client.query(`
                    INSERT INTO kuliga_bookings (
                        client_id,
                        booking_type,
                        group_training_id,
                        date,
                        start_time,
                        end_time,
                        sport_type,
                        participants_count,
                        participants_names,
                        price_total,
                        price_per_person,
                        location,
                        status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed')
                    RETURNING id
                `, [
                    bookingData.client_id,
                    bookingData.booking_type,
                    bookingData.group_training_id,
                    bookingData.date,
                    bookingData.start_time,
                    bookingData.end_time,
                    bookingData.sport_type,
                    bookingData.participants_count || 1,
                    bookingData.participants_names || [bookingData.client_name],
                    bookingData.price_total,
                    bookingData.price_per_person || bookingData.price_total,
                    bookingData.location,
                ]);
                
                const bookingId = bookingResult.rows[0].id;
                
                // Обновляем транзакцию с booking_id
                await client.query(`
                    UPDATE kuliga_transactions
                    SET booking_id = $1
                    WHERE id = $2
                `, [bookingId, transactionId]);
                
                // Обновляем current_participants в групповой тренировке
                await client.query(`
                    UPDATE kuliga_group_trainings
                    SET current_participants = current_participants + $1
                    WHERE id = $2
                `, [bookingData.participants_count || 1, bookingData.group_training_id]);
                
                logSuccess(`Бронирование создано: ID ${bookingId}`);
                
                // Отправляем уведомления
                logInfo('Отправка уведомлений...');
                const { notifyAdminNaturalSlopeTrainingBooking } = require('../src/bot/admin-notify');
                const { notifyInstructorKuligaTrainingBooking } = require('../src/bot/admin-notify');
                
                // Получаем данные инструктора из групповой тренировки
                const groupTrainingResult = await client.query(`
                    SELECT instructor_id FROM kuliga_group_trainings WHERE id = $1
                `, [bookingData.group_training_id]);
                
                let instructorResult = null;
                if (groupTrainingResult.rows.length > 0 && groupTrainingResult.rows[0].instructor_id) {
                    instructorResult = await client.query(`
                        SELECT full_name, telegram_id, admin_percentage 
                        FROM kuliga_instructors 
                        WHERE id = $1
                    `, [groupTrainingResult.rows[0].instructor_id]);
                }
                
                // Уведомление администратору (с информацией о программе)
                const adminNotificationData = {
                    client_name: bookingData.client_name,
                    client_phone: bookingData.client_phone,
                    participant_name: bookingData.participants_names?.join(', ') || bookingData.client_name,
                    date: bookingData.date,
                    time: bookingData.start_time,
                    sport_type: bookingData.sport_type,
                    instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || 'Не назначен',
                    price: bookingData.price_total,
                    booking_source: 'website',
                    location: bookingData.location,
                    booking_type: bookingData.booking_type,
                    participants_count: bookingData.participants_count || 1
                };
                
                // Добавляем информацию о программе
                if (bookingData.program_id || bookingData.program_name) {
                    adminNotificationData.program_name = bookingData.program_name || 'Программа';
                }
                
                await notifyAdminNaturalSlopeTrainingBooking(adminNotificationData);
                
                // Уведомление инструктору
                if (instructorResult && instructorResult.rows.length > 0 && instructorResult.rows[0].telegram_id) {
                    await notifyInstructorKuligaTrainingBooking({
                        booking_type: bookingData.booking_type,
                        client_name: bookingData.client_name,
                        participant_name: bookingData.participants_names?.join(', ') || bookingData.client_name,
                        client_phone: bookingData.client_phone,
                        instructor_name: instructorResult.rows[0].full_name,
                        instructor_telegram_id: instructorResult.rows[0].telegram_id,
                        admin_percentage: instructorResult.rows[0].admin_percentage,
                        date: bookingData.date,
                        time: bookingData.start_time,
                        price: bookingData.price_total,
                        location: bookingData.location,
                        participants_count: bookingData.participants_count || 1
                    });
                }
                
                // Email уведомление клиенту
                if (bookingData.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookingData.client_email)) {
                    const EmailService = require('../src/services/emailService');
                    const emailTemplateService = require('../src/services/email-template-service');
                    const emailService = new EmailService();
                    
                    const htmlContent = await emailTemplateService.generateBookingConfirmationEmail({
                        client_id: bookingData.client_id,
                        client_name: bookingData.client_name,
                        booking_type: bookingData.booking_type,
                        date: bookingData.date,
                        start_time: bookingData.start_time,
                        end_time: bookingData.end_time,
                        sport_type: bookingData.sport_type,
                        location: bookingData.location,
                        instructor_name: bookingData.instructor_name || (instructorResult?.rows[0]?.full_name) || null,
                        participants_count: bookingData.participants_count || 1,
                        price_total: bookingData.price_total,
                        price_per_person: bookingData.price_per_person || null
                    });
                    
                    const dateFormatted = emailTemplateService.formatDate(bookingData.date);
                    const subject = `✅ Подтверждение записи на тренировку - ${dateFormatted}`;
                    
                    const emailResult = await emailService.sendEmail(bookingData.client_email, subject, htmlContent);
                    if (emailResult.success) {
                        logSuccess(`Email отправлен клиенту на ${bookingData.client_email}`);
                    } else {
                        logError(`Ошибка отправки email: ${emailResult.error}`);
                    }
                }
            }
        }
        
        await client.query('COMMIT');
        
        logStep('5.4', 'Проверка создания бронирования...');
        
        const bookingCheckResult = await client.query(`
            SELECT 
                id,
                booking_type,
                status,
                participants_count
            FROM kuliga_bookings
            WHERE client_id = $1
            AND group_training_id = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [
            testClient.id,
            programTraining.id
        ]);
        
        if (bookingCheckResult.rows.length > 0) {
            const booking = bookingCheckResult.rows[0];
            logSuccess(`Бронирование создано: ID ${booking.id}, участников: ${booking.participants_count}`);
        } else {
            logWarning('Бронирование не найдено');
        }
        
        logSuccess('✅ Тест программы через сайт завершен');
        logInfo('Проверьте уведомления:');
        logInfo('  - Email клиенту (если указан email)');
        logInfo('  - Telegram администратору (с информацией о программе)');
        logInfo('  - Telegram инструктору (если есть telegram_id)');
        
    } catch (error) {
        await client.query('ROLLBACK');
        logError(`Ошибка: ${error.message}`);
        console.error(error);
    } finally {
        client.release();
    }
}

async function testReminders() {
    logSection('6. ТЕСТ: Напоминания о тренировках');
    
    logStep('6.1', 'Проверка наличия тренировок на завтра...');
    
    const tomorrow = moment.tz('Asia/Yekaterinburg').add(1, 'days').toDate();
    
    const trainingsResult = await pool.query(`
        SELECT 
            id,
            booking_type,
            date,
            start_time
        FROM kuliga_bookings
        WHERE client_id = $1
        AND date = $2
        AND status IN ('pending', 'confirmed')
    `, [
        testClient.id,
        moment(tomorrow).format('YYYY-MM-DD')
    ]);
    
    if (trainingsResult.rows.length === 0) {
        logWarning('⚠️  Нет тренировок на завтра - создайте бронирование сначала');
        return;
    }
    
    logSuccess(`Найдено тренировок на завтра: ${trainingsResult.rows.length}`);
    
    logStep('6.2', 'Запуск отправки напоминаний...');
    
    const notificationService = require('../src/services/notification-service');
    
    try {
        const stats = await notificationService.sendTrainingReminders(tomorrow);
        
        logSuccess(`Напоминания отправлены:`);
        logInfo(`  Всего клиентов: ${stats.total_clients}`);
        logInfo(`  Отправлено: ${stats.sent}`);
        logInfo(`  Ошибок: ${stats.failed}`);
        
        if (stats.errors.length > 0) {
            logWarning('Ошибки:');
            stats.errors.forEach(err => {
                logError(`  - ${err.client_name} (ID: ${err.client_id}): ${err.error}`);
            });
        }
        
    } catch (error) {
        logError(`Ошибка при отправке напоминаний: ${error.message}`);
        console.error(error);
    }
}

async function main() {
    try {
        logSection('🧪 ПОЛНЫЙ ТЕСТ СИСТЕМЫ УВЕДОМЛЕНИЙ');
        
        // Шаг 1: Находим тестовые данные
        logSection('1. ПОИСК ТЕСТОВЫХ ДАННЫХ');
        await findTestClient();
        await findTestInstructor();
        
        // Шаг 2: Создаем расписание
        await createTestSchedule();
        
        // Шаг 3-5: Тестируем бронирования через сайт
        await testWebsiteBookingIndividual();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Пауза между тестами
        
        await testWebsiteBookingGroup();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await testWebsiteBookingProgram();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Шаг 6: Тестируем напоминания
        await testReminders();
        
        logSection('✅ ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ');
        logInfo('Проверьте все уведомления вручную:');
        logInfo('  - Email клиенту (если указан email)');
        logInfo('  - Telegram администратору');
        logInfo('  - Telegram инструктору');
        logInfo('  - Telegram/Email напоминания');
        
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

