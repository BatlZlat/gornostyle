/**
 * Скрипт для тестирования всех нововведений связанных с location (Кулига/Воронинские горки)
 * 
 * Использование:
 * node scripts/test-location-features.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const moment = require('moment-timezone');

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 6432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

// Список ID тестовых записей для последующего удаления
const testRecords = {
    instructors: [],
    slots: [],
    groupTrainings: [],
    bookings: [],
    clients: [],
};

// Функция для логирования результатов теста
function logTest(testName, passed, message = '') {
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${testName}`);
    if (message) {
        console.log(`   ${message}`);
    }
    return passed;
}

// Функция для получения названия места
function getLocationName(location) {
    const names = {
        'kuliga': 'База отдыха «Кулига-Клуб»',
        'vorona': 'Воронинские горки'
    };
    return names[location] || 'Неизвестно';
}

async function testDatabaseStructure() {
    console.log('\n📋 ТЕСТ 1: Структура базы данных\n');
    let allPassed = true;

    try {
        // Проверяем наличие поля location в таблицах
        const tables = [
            { name: 'kuliga_instructors', display: 'Инструкторы' },
            { name: 'kuliga_schedule_slots', display: 'Слоты расписания' },
            { name: 'kuliga_group_trainings', display: 'Групповые тренировки' },
            { name: 'kuliga_bookings', display: 'Бронирования' },
        ];

        for (const table of tables) {
            const result = await pool.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = $1 AND column_name = 'location'
            `, [table.name]);

            const passed = result.rows.length > 0;
            allPassed = allPassed && logTest(
                `Поле location в таблице ${table.display}`,
                passed,
                passed ? `Тип: ${result.rows[0].data_type}, NULL: ${result.rows[0].is_nullable}` : 'Поле не найдено'
            );
        }

        // Проверяем индексы
        const indexResult = await pool.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename LIKE 'kuliga_%' 
            AND indexname LIKE '%location%'
        `);

        allPassed = allPassed && logTest(
            'Индексы для location',
            indexResult.rows.length > 0,
            `Найдено индексов: ${indexResult.rows.length}`
        );

    } catch (error) {
        console.error('Ошибка при тестировании структуры БД:', error);
        allPassed = false;
    }

    return allPassed;
}

async function testExistingData() {
    console.log('\n📋 ТЕСТ 2: Существующие данные\n');
    let allPassed = true;

    try {
        const tables = [
            { name: 'kuliga_instructors', display: 'Инструкторы' },
            { name: 'kuliga_schedule_slots', display: 'Слоты' },
            { name: 'kuliga_group_trainings', display: 'Групповые тренировки' },
            { name: 'kuliga_bookings', display: 'Бронирования' },
        ];

        for (const table of tables) {
            // Проверяем записи с NULL
            const nullResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM ${table.name}
                WHERE location IS NULL
            `);

            const nullCount = parseInt(nullResult.rows[0].count);
            allPassed = allPassed && logTest(
                `Нет NULL значений в ${table.display}`,
                nullCount === 0,
                nullCount > 0 ? `Найдено ${nullCount} записей с NULL` : 'Все записи имеют location'
            );
        }

    } catch (error) {
        console.error('Ошибка при тестировании существующих данных:', error);
        allPassed = false;
    }

    return allPassed;
}

async function testInstructorCreation() {
    console.log('\n📋 ТЕСТ 3: Создание инструкторов\n');
    let allPassed = true;

    try {
        // Создаем тестового инструктора для Кулиги
        const kuligaInstructor = await pool.query(`
            INSERT INTO kuliga_instructors (
                full_name, sport_type, phone, email, location, is_active, admin_percentage
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, location
        `, [
            `ТЕСТ Инструктор Кулига ${Date.now()}`,
            'ski',
            '+79991234567',
            'test@test.com',
            'kuliga',
            false, // Неактивный для теста
            20
        ]);

        testRecords.instructors.push(kuligaInstructor.rows[0].id);
        allPassed = allPassed && logTest(
            'Создание инструктора для Кулиги',
            kuligaInstructor.rows[0].location === 'kuliga',
            `Location: ${kuligaInstructor.rows[0].location}`
        );

        // Создаем тестового инструктора для Воронинских горок
        const voronaInstructor = await pool.query(`
            INSERT INTO kuliga_instructors (
                full_name, sport_type, phone, email, location, is_active, admin_percentage
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, location
        `, [
            `ТЕСТ Инструктор Ворона ${Date.now()}`,
            'ski',
            '+79991234568',
            'test2@test.com',
            'vorona',
            false,
            20
        ]);

        testRecords.instructors.push(voronaInstructor.rows[0].id);
        allPassed = allPassed && logTest(
            'Создание инструктора для Воронинских горок',
            voronaInstructor.rows[0].location === 'vorona',
            `Location: ${voronaInstructor.rows[0].location}`
        );

    } catch (error) {
        console.error('Ошибка при тестировании создания инструкторов:', error);
        allPassed = false;
    }

    return allPassed;
}

async function testSlotCreation() {
    console.log('\n📋 ТЕСТ 4: Создание слотов\n');
    let allPassed = true;

    try {
        if (testRecords.instructors.length < 2) {
            console.log('⚠️  Пропущено: нужно сначала создать инструкторов');
            return false;
        }

        const kuligaInstructorId = testRecords.instructors[0];
        const tomorrow = moment().tz('Asia/Yekaterinburg').add(1, 'day').format('YYYY-MM-DD');

        // Создаем слот для инструктора Кулиги
        const kuligaSlot = await pool.query(`
            INSERT INTO kuliga_schedule_slots (
                instructor_id, date, start_time, end_time, status, location
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, location
        `, [
            kuligaInstructorId,
            tomorrow,
            '10:00:00',
            '11:00:00',
            'available',
            'kuliga'
        ]);

        testRecords.slots.push(kuligaSlot.rows[0].id);
        allPassed = allPassed && logTest(
            'Создание слота для Кулиги',
            kuligaSlot.rows[0].location === 'kuliga',
            `Location: ${kuligaSlot.rows[0].location}`
        );

        // Проверяем автоматическое наследование location
        const voronaInstructorId = testRecords.instructors[1];
        const instructorInfo = await pool.query(`
            SELECT location FROM kuliga_instructors WHERE id = $1
        `, [voronaInstructorId]);

        const slotAuto = await pool.query(`
            INSERT INTO kuliga_schedule_slots (
                instructor_id, date, start_time, end_time, status, location
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, location
        `, [
            voronaInstructorId,
            tomorrow,
            '11:00:00',
            '12:00:00',
            'available',
            instructorInfo.rows[0].location // Используем location инструктора
        ]);

        testRecords.slots.push(slotAuto.rows[0].id);
        allPassed = allPassed && logTest(
            'Автоматическое наследование location из инструктора',
            slotAuto.rows[0].location === 'vorona',
            `Location: ${slotAuto.rows[0].location}`
        );

    } catch (error) {
        console.error('Ошибка при тестировании создания слотов:', error);
        allPassed = false;
    }

    return allPassed;
}

async function testGroupTrainingCreation() {
    console.log('\n📋 ТЕСТ 5: Создание групповых тренировок\n');
    let allPassed = true;

    try {
        if (testRecords.slots.length < 1) {
            console.log('⚠️  Пропущено: нужно сначала создать слоты');
            return false;
        }

        const slotId = testRecords.slots[0];
        
        // Получаем информацию о слоте
        const slotInfo = await pool.query(`
            SELECT location FROM kuliga_schedule_slots WHERE id = $1
        `, [slotId]);

        const slotLocation = slotInfo.rows[0].location;
        const tomorrow = moment().tz('Asia/Yekaterinburg').add(1, 'day').format('YYYY-MM-DD');

        // Создаем групповую тренировку
        const groupTraining = await pool.query(`
            INSERT INTO kuliga_group_trainings (
                slot_id, date, start_time, end_time, sport_type, max_participants,
                price_per_person, status, location
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, location
        `, [
            slotId,
            tomorrow,
            '10:00:00',
            '11:00:00',
            'ski',
            4,
            1000,
            'open',
            slotLocation
        ]);

        testRecords.groupTrainings.push(groupTraining.rows[0].id);
        allPassed = allPassed && logTest(
            'Создание групповой тренировки с наследованием location',
            groupTraining.rows[0].location === slotLocation,
            `Location: ${groupTraining.rows[0].location} (из слота: ${slotLocation})`
        );

    } catch (error) {
        console.error('Ошибка при тестировании создания групповых тренировок:', error);
        allPassed = false;
    }

    return allPassed;
}

async function testFiltering() {
    console.log('\n📋 ТЕСТ 6: Фильтрация по location\n');
    let allPassed = true;

    try {
        // Тестируем фильтрацию инструкторов
        const kuligaInstructors = await pool.query(`
            SELECT COUNT(*) as count
            FROM kuliga_instructors
            WHERE location = 'kuliga' AND full_name LIKE 'ТЕСТ%'
        `);

        allPassed = allPassed && logTest(
            'Фильтрация инструкторов по location = kuliga',
            parseInt(kuligaInstructors.rows[0].count) >= 1,
            `Найдено: ${kuligaInstructors.rows[0].count}`
        );

        const voronaInstructors = await pool.query(`
            SELECT COUNT(*) as count
            FROM kuliga_instructors
            WHERE location = 'vorona' AND full_name LIKE 'ТЕСТ%'
        `);

        allPassed = allPassed && logTest(
            'Фильтрация инструкторов по location = vorona',
            parseInt(voronaInstructors.rows[0].count) >= 1,
            `Найдено: ${voronaInstructors.rows[0].count}`
        );

        // Тестируем фильтрацию слотов
        if (testRecords.slots.length >= 1) {
            const kuligaSlots = await pool.query(`
                SELECT COUNT(*) as count
                FROM kuliga_schedule_slots
                WHERE location = 'kuliga' AND id = ANY($1)
            `, [testRecords.slots]);

            allPassed = allPassed && logTest(
                'Фильтрация слотов по location',
                parseInt(kuligaSlots.rows[0].count) >= 1,
                `Найдено слотов Кулиги: ${kuligaSlots.rows[0].count}`
            );
        }

    } catch (error) {
        console.error('Ошибка при тестировании фильтрации:', error);
        allPassed = false;
    }

    return allPassed;
}

async function cleanupTestData() {
    console.log('\n🧹 Очистка тестовых данных...\n');

    try {
        // Удаляем бронирования
        if (testRecords.bookings.length > 0) {
            await pool.query(`
                DELETE FROM kuliga_bookings WHERE id = ANY($1)
            `, [testRecords.bookings]);
            console.log(`   ✅ Удалено бронирований: ${testRecords.bookings.length}`);
        }

        // Удаляем групповые тренировки
        if (testRecords.groupTrainings.length > 0) {
            await pool.query(`
                DELETE FROM kuliga_group_trainings WHERE id = ANY($1)
            `, [testRecords.groupTrainings]);
            console.log(`   ✅ Удалено групповых тренировок: ${testRecords.groupTrainings.length}`);
        }

        // Удаляем слоты
        if (testRecords.slots.length > 0) {
            await pool.query(`
                DELETE FROM kuliga_schedule_slots WHERE id = ANY($1)
            `, [testRecords.slots]);
            console.log(`   ✅ Удалено слотов: ${testRecords.slots.length}`);
        }

        // Удаляем инструкторов
        if (testRecords.instructors.length > 0) {
            await pool.query(`
                DELETE FROM kuliga_instructors WHERE id = ANY($1)
            `, [testRecords.instructors]);
            console.log(`   ✅ Удалено инструкторов: ${testRecords.instructors.length}`);
        }

        // Удаляем клиентов (если создавались)
        if (testRecords.clients.length > 0) {
            await pool.query(`
                DELETE FROM clients WHERE id = ANY($1)
            `, [testRecords.clients]);
            console.log(`   ✅ Удалено клиентов: ${testRecords.clients.length}`);
        }

        console.log('\n✅ Все тестовые данные удалены\n');

    } catch (error) {
        console.error('❌ Ошибка при очистке тестовых данных:', error);
        throw error;
    }
}

// Главная функция
async function runTests() {
    console.log('🧪 НАЧАЛО ТЕСТИРОВАНИЯ НОВОВВЕДЕНИЙ\n');
    console.log('=' .repeat(60));

    const results = {
        databaseStructure: false,
        existingData: false,
        instructorCreation: false,
        slotCreation: false,
        groupTrainingCreation: false,
        filtering: false,
    };

    try {
        results.databaseStructure = await testDatabaseStructure();
        results.existingData = await testExistingData();
        results.instructorCreation = await testInstructorCreation();
        results.slotCreation = await testSlotCreation();
        results.groupTrainingCreation = await testGroupTrainingCreation();
        results.filtering = await testFiltering();

        // Итоги
        console.log('\n' + '='.repeat(60));
        console.log('\n📊 ИТОГИ ТЕСТИРОВАНИЯ\n');

        const totalTests = Object.keys(results).length;
        const passedTests = Object.values(results).filter(r => r).length;

        Object.entries(results).forEach(([test, passed]) => {
            const icon = passed ? '✅' : '❌';
            console.log(`${icon} ${test}`);
        });

        console.log(`\n✅ Пройдено: ${passedTests}/${totalTests}`);
        
        if (passedTests === totalTests) {
            console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!\n');
        } else {
            console.log('\n⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ\n');
        }

        // Очистка
        const shouldCleanup = process.argv.includes('--cleanup') || process.argv.includes('-c');
        if (shouldCleanup || passedTests === totalTests) {
            await cleanupTestData();
        } else {
            console.log('\n⚠️  Тестовые данные не удалены (используйте --cleanup для удаления)');
        }

    } catch (error) {
        console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error);
        console.error(error.stack);
        
        // Пытаемся очистить данные даже при ошибке
        try {
            await cleanupTestData();
        } catch (cleanupError) {
            console.error('❌ Ошибка при очистке:', cleanupError);
        }
        
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Запуск тестов
if (require.main === module) {
    runTests().catch(error => {
        console.error('Критическая ошибка:', error);
        process.exit(1);
    });
}

module.exports = { runTests, cleanupTestData };

