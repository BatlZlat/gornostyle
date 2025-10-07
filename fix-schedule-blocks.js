/**
 * Скрипт для исправления блокировок слотов
 * 
 * Проблема: Блокировка создана с неправильной логикой (без пересечения)
 * Этот скрипт:
 * 1. Находит все активные блокировки
 * 2. Освобождает ВСЕ заблокированные слоты (кроме тех где реально есть тренировки)
 * 3. Применяет блокировки заново с правильной логикой пересечения
 */

const { Pool } = require('pg');

const pool = new Pool({
    user: 'batl-zlat',
    host: '90.156.210.24',
    database: 'skisimulator',
    password: 'Nemezida2324%)',
    port: 5432,
});

async function fixScheduleBlocks() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('\n=== ШАГ 1: Освобождение всех заблокированных слотов ===');
        
        // Освобождаем ВСЕ слоты которые заблокированы, но не имеют реальных тренировок
        const freedResult = await client.query(
            `UPDATE schedule
             SET is_booked = false
             WHERE is_booked = true
             AND id NOT IN (
                 SELECT DISTINCT s.id
                 FROM schedule s
                 JOIN training_sessions ts ON 
                     s.date = ts.session_date 
                     AND s.simulator_id = ts.simulator_id
                     AND s.start_time < ts.end_time
                     AND s.end_time > ts.start_time
             )`
        );
        
        console.log(`Освобождено слотов: ${freedResult.rowCount}`);
        
        console.log('\n=== ШАГ 2: Получение всех активных блокировок ===');
        
        const blocksResult = await client.query(
            'SELECT * FROM schedule_blocks WHERE is_active = TRUE ORDER BY id'
        );
        
        console.log(`Найдено активных блокировок: ${blocksResult.rows.length}`);
        
        if (blocksResult.rows.length === 0) {
            console.log('Нет активных блокировок для применения');
            await client.query('COMMIT');
            return;
        }
        
        console.log('\n=== ШАГ 3: Применение блокировок с правильной логикой ===');
        
        let totalBlocked = 0;
        
        for (const block of blocksResult.rows) {
            console.log(`\nОбработка блокировки ID ${block.id}:`);
            console.log(`  Тип: ${block.block_type}`);
            console.log(`  Время: ${block.start_time.slice(0,5)} - ${block.end_time.slice(0,5)}`);
            
            if (block.block_type === 'specific') {
                const result = await client.query(
                    `UPDATE schedule
                     SET is_booked = true
                     WHERE date >= $1 AND date <= $2
                     AND (simulator_id = $3 OR $3 IS NULL)
                     AND start_time <= $5::time
                     AND start_time >= $4::time
                     AND is_booked = false`,
                    [block.start_date, block.end_date, block.simulator_id, block.start_time, block.end_time]
                );
                
                console.log(`  Заблокировано слотов: ${result.rowCount}`);
                totalBlocked += result.rowCount;
                
            } else if (block.block_type === 'recurring') {
                const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
                console.log(`  День недели: ${days[block.day_of_week]}`);
                
                const futureDatesResult = await client.query(
                    `SELECT DISTINCT date FROM schedule
                     WHERE date >= CURRENT_DATE
                     AND EXTRACT(DOW FROM date) = $1
                     ORDER BY date`,
                    [block.day_of_week]
                );
                
                console.log(`  Найдено дат: ${futureDatesResult.rows.length}`);
                
                for (const row of futureDatesResult.rows) {
                    const result = await client.query(
                        `UPDATE schedule
                         SET is_booked = true
                         WHERE date = $1
                         AND (simulator_id = $2 OR $2 IS NULL)
                         AND start_time <= $4::time
                         AND start_time >= $3::time
                         AND is_booked = false`,
                        [row.date, block.simulator_id, block.start_time, block.end_time]
                    );
                    
                    if (result.rowCount > 0) {
                        console.log(`    ${row.date}: заблокировано ${result.rowCount} слотов`);
                        totalBlocked += result.rowCount;
                    }
                }
            }
        }
        
        console.log(`\n=== ИТОГО: Заблокировано слотов с новой логикой: ${totalBlocked} ===`);
        
        await client.query('COMMIT');
        console.log('\n✅ Успешно! Все блокировки применены с правильной логикой.');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запуск скрипта
console.log('🚀 Запуск скрипта исправления блокировок...\n');

fixScheduleBlocks()
    .then(() => {
        console.log('\n✨ Скрипт завершён успешно!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Скрипт завершён с ошибкой:', error);
        process.exit(1);
    });

