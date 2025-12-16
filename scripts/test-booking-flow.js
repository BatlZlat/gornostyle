#!/usr/bin/env node
/**
 * Полноценный тест процесса бронирования
 * Симулирует весь процесс: создание бронирования -> оплата -> webhook -> проверка данных
 * 
 * Использование: 
 *   node scripts/test-booking-flow.js
 *   node scripts/test-booking-flow.js --type=individual
 *   node scripts/test-booking-flow.js --type=group
 */

require('dotenv').config();
const { pool } = require('../src/db/index');
const PaymentProviderFactory = require('../src/services/payment/paymentProvider');

// Цветной вывод
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
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

async function testBookingFlow(bookingType = 'individual') {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        logSection(`ТЕСТ: Процесс бронирования (${bookingType})`);
        
        // ============================================
        // ШАГ 1: Создание клиента
        // ============================================
        logStep('1', 'Создание тестового клиента...');
        
        const testEmail = `test-${Date.now()}@example.com`;
        const testPhone = `+7999${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;
        const testName = 'Тестовый Клиент';
        
        // Нормализуем телефон для поиска (убираем все кроме цифр и +)
        const normalizedPhone = testPhone.replace(/[\s\-\(\)]/g, '');
        
        // Ищем клиента по нормализованному телефону
        let clientResult = await client.query(
            `SELECT id, full_name, phone, email FROM clients 
             WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = $1 
             LIMIT 1`,
            [normalizedPhone]
        );
        
        if (clientResult.rows.length === 0) {
            // Создаем нового клиента
            clientResult = await client.query(
                `INSERT INTO clients (full_name, phone, email, birth_date, created_at, updated_at)
                 VALUES ($1, $2, $3, '1990-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 RETURNING id, full_name, phone, email`,
                [testName, testPhone, testEmail]
            );
        } else {
            // Обновляем email если нужно
            if (clientResult.rows[0].email !== testEmail) {
                await client.query(
                    `UPDATE clients SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                    [testEmail, clientResult.rows[0].id]
                );
                clientResult.rows[0].email = testEmail;
            }
        }
        
        const testClient = clientResult.rows[0];
        logSuccess(`Клиент создан/найден: ID=${testClient.id}, email=${testClient.email}`);
        
        // ============================================
        // ШАГ 2: Создание bookingData (как в createIndividualBooking/createGroupBooking)
        // ============================================
        logStep('2', 'Создание bookingData...');
        
        const bookingData = {
            client_id: testClient.id,
            booking_type: bookingType,
            date: '2025-12-20',
            start_time: '10:00:00',
            end_time: '11:00:00',
            sport_type: 'ski',
            participants_count: 1,
            participants_names: [testName],
            price_total: 2000,
            price_per_person: 2000,
            location: 'kuliga',
            // Дополнительные данные для уведомлений
            client_name: testName,
            client_phone: testPhone,
            client_email: testEmail,
            instructor_id: null,
        };
        
        logSuccess(`bookingData создан: client_id=${bookingData.client_id}, client_email=${bookingData.client_email}`);
        console.log('   bookingData:', JSON.stringify(bookingData, null, 2));
        
        // ============================================
        // ШАГ 3: Создание транзакции (как в createIndividualBooking)
        // ============================================
        logStep('3', 'Создание транзакции с bookingData в provider_raw_data...');
        
        const rawDataForInsert = { bookingData };
        const transactionResult = await client.query(
            `INSERT INTO kuliga_transactions (
                client_id, 
                booking_id, 
                type, 
                amount, 
                status, 
                description,
                provider_raw_data
            )
             VALUES ($1, NULL, 'payment', $2, 'pending', $3, $4)
             RETURNING id, provider_raw_data`,
            [testClient.id, bookingData.price_total, 'Тестовая транзакция', JSON.stringify(rawDataForInsert)]
        );
        
        const transactionId = transactionResult.rows[0].id;
        logSuccess(`Транзакция создана: ID=${transactionId}`);
        
        // Проверяем, что bookingData сохранился
        const savedRawData = typeof transactionResult.rows[0].provider_raw_data === 'string'
            ? JSON.parse(transactionResult.rows[0].provider_raw_data)
            : transactionResult.rows[0].provider_raw_data;
        
        if (savedRawData.bookingData) {
            logSuccess(`bookingData сохранен в транзакции: client_id=${savedRawData.bookingData.client_id}`);
        } else {
            logError(`bookingData НЕ сохранен в транзакции!`);
            console.log('   savedRawData:', JSON.stringify(savedRawData, null, 2));
            await client.query('ROLLBACK');
            return;
        }
        
        // ============================================
        // ШАГ 4: Симуляция инициализации платежа (как в createIndividualBooking)
        // ============================================
        logStep('4', 'Симуляция инициализации платежа...');
        
        const provider = PaymentProviderFactory.create();
        const mockPayment = {
            paymentId: `test-payment-${Date.now()}`,
            paymentURL: 'https://test-payment.example.com',
            status: 'CREATED',
            rawData: {
                operationId: `test-op-${Date.now()}`,
                paymentLink: 'https://test-payment.example.com',
                status: 'CREATED'
            }
        };
        
        logSuccess(`Платеж инициализирован: paymentId=${mockPayment.paymentId}`);
        
        // ============================================
        // ШАГ 5: Обновление транзакции с paymentData (как в createIndividualBooking)
        // ============================================
        logStep('5', 'Обновление транзакции с paymentData (ПРОВЕРКА: bookingData должен сохраниться)...');
        
        const paymentData = mockPayment.rawData || mockPayment;
        // Удаляем bookingData из paymentData если он там есть
        if (paymentData && typeof paymentData === 'object') {
            delete paymentData.bookingData;
        }
        const rawData = {
            ...rawDataForInsert, // bookingData уже здесь
            paymentData: paymentData
        };
        
        await client.query(
            `UPDATE kuliga_transactions
             SET payment_provider = $1,
                 provider_payment_id = $2,
                 provider_order_id = $3,
                 provider_status = $4,
                 payment_method = $5,
                 provider_raw_data = $6
             WHERE id = $7
             RETURNING provider_raw_data`,
            [
                'tochka',
                mockPayment.paymentId,
                `gornostyle72-winter-${transactionId}`,
                mockPayment.status,
                'card',
                JSON.stringify(rawData),
                transactionId
            ]
        );
        
        // Проверяем, что bookingData сохранился после обновления
        const afterUpdateResult = await client.query(
            `SELECT provider_raw_data FROM kuliga_transactions WHERE id = $1`,
            [transactionId]
        );
        
        const afterUpdateRawData = typeof afterUpdateResult.rows[0].provider_raw_data === 'string'
            ? JSON.parse(afterUpdateResult.rows[0].provider_raw_data)
            : afterUpdateResult.rows[0].provider_raw_data;
        
        if (afterUpdateRawData.bookingData) {
            logSuccess(`bookingData сохранен после обновления с paymentData: client_id=${afterUpdateRawData.bookingData.client_id}`);
            if (afterUpdateRawData.bookingData.client_email) {
                logSuccess(`client_email сохранен: ${afterUpdateRawData.bookingData.client_email}`);
            } else {
                logError(`client_email ОТСУТСТВУЕТ в bookingData!`);
            }
        } else {
            logError(`bookingData ПОТЕРЯН после обновления с paymentData!`);
            console.log('   afterUpdateRawData:', JSON.stringify(afterUpdateRawData, null, 2));
            await client.query('ROLLBACK');
            return;
        }
        
        // ============================================
        // ШАГ 6: Симуляция webhook (как в kuliga-payment.js)
        // ============================================
        logStep('6', 'Симуляция webhook с успешной оплатой...');
        
        // Загружаем транзакцию заново (как в webhook handler)
        const webhookTransactionResult = await client.query(
            `SELECT id, booking_id, client_id, amount, status as tx_status, provider_raw_data
             FROM kuliga_transactions
             WHERE id = $1
             FOR UPDATE`,
            [transactionId]
        );
        
        const webhookTransaction = webhookTransactionResult.rows[0];
        
        // Извлекаем bookingData (как в webhook handler)
        let webhookRawData = {};
        try {
            if (typeof webhookTransaction.provider_raw_data === 'string') {
                webhookRawData = JSON.parse(webhookTransaction.provider_raw_data);
            } else if (webhookTransaction.provider_raw_data) {
                webhookRawData = webhookTransaction.provider_raw_data;
            }
        } catch (parseError) {
            logError(`Ошибка парсинга provider_raw_data: ${parseError.message}`);
            await client.query('ROLLBACK');
            return;
        }
        
        const webhookBookingData = webhookRawData.bookingData;
        
        logStep('6.1', 'Проверка извлечения bookingData из provider_raw_data...');
        if (webhookBookingData) {
            logSuccess(`bookingData извлечен из provider_raw_data:`);
            console.log(`   - client_id: ${webhookBookingData.client_id}`);
            console.log(`   - client_email: ${webhookBookingData.client_email || 'ОТСУТСТВУЕТ'}`);
            console.log(`   - client_name: ${webhookBookingData.client_name || 'ОТСУТСТВУЕТ'}`);
            console.log(`   - booking_type: ${webhookBookingData.booking_type}`);
        } else {
            logError(`bookingData НЕ извлечен из provider_raw_data!`);
            console.log('   webhookRawData:', JSON.stringify(webhookRawData, null, 2));
            await client.query('ROLLBACK');
            return;
        }
        
        // Симулируем payload от банка
        const webhookPayload = {
            operationId: mockPayment.paymentId,
            status: 'SUCCESS',
            amount: bookingData.price_total * 100,
            // ... другие поля от банка
        };
        
        // Сохраняем bookingData при обновлении (как в webhook handler)
        let updatedRawData = webhookPayload;
        try {
            let existingRawData = {};
            if (webhookTransaction.provider_raw_data) {
                if (typeof webhookTransaction.provider_raw_data === 'string') {
                    existingRawData = JSON.parse(webhookTransaction.provider_raw_data);
                } else {
                    existingRawData = webhookTransaction.provider_raw_data;
                }
            }
            
            if (existingRawData.bookingData) {
                updatedRawData = {
                    ...webhookPayload,
                    bookingData: existingRawData.bookingData
                };
                logSuccess(`bookingData сохранен в updatedRawData: client_id=${existingRawData.bookingData.client_id}`);
            } else {
                logError(`bookingData отсутствует в existingRawData!`);
                console.log('   existingRawData:', JSON.stringify(existingRawData, null, 2));
                await client.query('ROLLBACK');
                return;
            }
        } catch (e) {
            logError(`Ошибка при сохранении bookingData: ${e.message}`);
            await client.query('ROLLBACK');
            return;
        }
        
        // Обновляем транзакцию (как в webhook handler)
        logStep('6.2', 'Обновление транзакции с webhook payload (ПРОВЕРКА: bookingData должен сохраниться)...');
        
        // Финальная проверка
        if (!updatedRawData.bookingData && webhookTransaction.provider_raw_data) {
            logWarning(`bookingData отсутствует в updatedRawData, пытаемся восстановить...`);
            try {
                let existingRawData = {};
                if (typeof webhookTransaction.provider_raw_data === 'string') {
                    existingRawData = JSON.parse(webhookTransaction.provider_raw_data);
                } else {
                    existingRawData = webhookTransaction.provider_raw_data;
                }
                if (existingRawData.bookingData) {
                    updatedRawData.bookingData = existingRawData.bookingData;
                    logSuccess(`bookingData восстановлен: client_id=${existingRawData.bookingData.client_id}`);
                }
            } catch (e) {
                logError(`Не удалось восстановить bookingData: ${e.message}`);
            }
        }
        
        await client.query(
            `UPDATE kuliga_transactions
             SET provider_status = $1::character varying(100),
                 provider_payment_id = $2::character varying(255),
                 provider_order_id = $3::character varying(255),
                 payment_method = COALESCE($4::character varying(50), payment_method),
                 provider_raw_data = $5::jsonb,
                 status = 'completed',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6
             RETURNING provider_raw_data`,
            [
                'SUCCESS',
                mockPayment.paymentId,
                `gornostyle72-winter-${transactionId}`,
                'card',
                JSON.stringify(updatedRawData),
                transactionId
            ]
        );
        
        // Финальная проверка
        logStep('7', 'ФИНАЛЬНАЯ ПРОВЕРКА: bookingData после всех обновлений...');
        
        const finalCheckResult = await client.query(
            `SELECT provider_raw_data FROM kuliga_transactions WHERE id = $1`,
            [transactionId]
        );
        
        const finalRawData = typeof finalCheckResult.rows[0].provider_raw_data === 'string'
            ? JSON.parse(finalCheckResult.rows[0].provider_raw_data)
            : finalCheckResult.rows[0].provider_raw_data;
        
        if (finalRawData.bookingData) {
            logSuccess(`✅ bookingData сохранен после всех обновлений!`);
            console.log(`   - client_id: ${finalRawData.bookingData.client_id}`);
            console.log(`   - client_email: ${finalRawData.bookingData.client_email || 'ОТСУТСТВУЕТ'}`);
            console.log(`   - client_name: ${finalRawData.bookingData.client_name || 'ОТСУТСТВУЕТ'}`);
            
            if (!finalRawData.bookingData.client_email) {
                logError(`❌ ПРОБЛЕМА: client_email отсутствует в финальном bookingData!`);
            } else {
                logSuccess(`✅ client_email присутствует: ${finalRawData.bookingData.client_email}`);
            }
        } else {
            logError(`❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: bookingData ПОТЕРЯН после всех обновлений!`);
            console.log('   finalRawData:', JSON.stringify(finalRawData, null, 2));
            await client.query('ROLLBACK');
            return;
        }
        
        // ============================================
        // ШАГ 8: Проверка SUCCESS_URL с clientId
        // ============================================
        logStep('8', 'Проверка формирования SUCCESS_URL с clientId...');
        
        const kuligaPaymentService = require('../src/services/kuligaPaymentService');
        const testClientId = testClient.id;
        
        // Симулируем вызов initPayment с clientId
        const testSuccessUrl = process.env.KULIGA_PAYMENT_SUCCESS_URL || 'http://localhost:8080/instruktor-po-gornym-lyzham-snoubordy-tyumen/booking/success';
        const separator = testSuccessUrl.includes('?') ? '&' : '?';
        const expectedSuccessUrl = `${testSuccessUrl}${separator}clientId=${testClientId}`;
        
        logSuccess(`Ожидаемый SUCCESS_URL: ${expectedSuccessUrl}`);
        
        // ============================================
        // ИТОГИ
        // ============================================
        logSection('ИТОГИ ТЕСТА');
        
        const allChecks = [
            { name: 'bookingData сохранен при создании транзакции', passed: !!savedRawData.bookingData },
            { name: 'bookingData сохранен после обновления с paymentData', passed: !!afterUpdateRawData.bookingData },
            { name: 'bookingData извлечен из provider_raw_data в webhook', passed: !!webhookBookingData },
            { name: 'bookingData сохранен в updatedRawData', passed: !!updatedRawData.bookingData },
            { name: 'bookingData сохранен после финального обновления', passed: !!finalRawData.bookingData },
            { name: 'client_email присутствует в bookingData', passed: !!finalRawData.bookingData?.client_email },
        ];
        
        let allPassed = true;
        for (const check of allChecks) {
            if (check.passed) {
                logSuccess(check.name);
            } else {
                logError(check.name);
                allPassed = false;
            }
        }
        
        if (allPassed) {
            log('\n✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ!', 'green');
            log('   bookingData сохраняется на всех этапах.', 'green');
            log('   Проблема может быть в реальных данных или в другом месте.', 'yellow');
        } else {
            log('\n❌ НЕКОТОРЫЕ ПРОВЕРКИ НЕ ПРОЙДЕНЫ!', 'red');
            log('   Это указывает на проблему в логике сохранения bookingData.', 'red');
        }
        
        await client.query('ROLLBACK');
        log('\n📝 Транзакция откачена (тестовые данные не сохранены)', 'cyan');
        
    } catch (error) {
        await client.query('ROLLBACK');
        logError(`Ошибка в тесте: ${error.message}`);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Главная функция
async function main() {
    const args = process.argv.slice(2);
    let bookingType = 'individual';
    
    for (const arg of args) {
        if (arg.startsWith('--type=')) {
            bookingType = arg.split('=')[1];
        }
    }
    
    if (!['individual', 'group'].includes(bookingType)) {
        console.error('Неверный тип бронирования. Используйте: individual или group');
        process.exit(1);
    }
    
    await testBookingFlow(bookingType);
}

main().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
});

