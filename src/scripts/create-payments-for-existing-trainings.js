/**
 * Скрипт для создания выплат тренерам за уже проведенные тренировки
 * Этот скрипт обрабатывает все тренировки, которые были проведены до внедрения системы выплат
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false
});

async function createPaymentsForExistingTrainings() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Начинаем создание выплат для существующих тренировок...\n');
        
        await client.query('BEGIN');
        
        // Получаем все тренировки, для которых еще нет выплат
        const trainingsResult = await client.query(`
            SELECT 
                ts.id,
                ts.trainer_id,
                ts.session_date,
                ts.start_time,
                ts.price,
                ts.duration,
                t.full_name as trainer_name,
                t.default_payment_type,
                t.default_percentage,
                t.default_fixed_amount
            FROM training_sessions ts
            JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN trainer_payments tp ON ts.id = tp.training_session_id
            WHERE tp.id IS NULL
            AND ts.trainer_id IS NOT NULL
            ORDER BY ts.session_date, ts.start_time
        `);
        
        const trainings = trainingsResult.rows;
        console.log(`📊 Найдено ${trainings.length} тренировок без выплат\n`);
        
        if (trainings.length === 0) {
            console.log('✅ Все тренировки уже имеют выплаты!');
            return;
        }
        
        let totalCreated = 0;
        let totalAmount = 0;
        
        // Группируем по тренерам для статистики
        const trainerStats = {};
        
        for (const training of trainings) {
            const trainerId = training.trainer_id;
            
            if (!trainerStats[trainerId]) {
                trainerStats[trainerId] = {
                    name: training.trainer_name,
                    count: 0,
                    totalAmount: 0
                };
            }
            
            // Рассчитываем сумму выплаты
            let paymentAmount = 0;
            let paymentType = training.default_payment_type;
            let percentage = null;
            
            if (training.default_payment_type === 'percentage') {
                const percent = parseFloat(training.default_percentage) || 50;
                paymentAmount = (training.price * percent) / 100;
                percentage = percent;
            } else {
                paymentAmount = parseFloat(training.default_fixed_amount) || 500;
            }
            
            // Создаем запись о выплате
            await client.query(`
                INSERT INTO trainer_payments (
                    trainer_id,
                    training_session_id,
                    amount,
                    payment_type,
                    status,
                    created_at
                ) VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP)
            `, [
                trainerId,
                training.id,
                paymentAmount,
                'group_training' // Используем допустимый тип из CHECK constraint
            ]);
            
            trainerStats[trainerId].count++;
            trainerStats[trainerId].totalAmount += paymentAmount;
            totalCreated++;
            totalAmount += paymentAmount;
            
            console.log(`✅ ${training.trainer_name}: ${training.session_date} ${training.start_time} - ${paymentAmount}₽`);
        }
        
        await client.query('COMMIT');
        
        console.log('\n📈 Статистика по тренерам:');
        console.log('='.repeat(50));
        
        for (const [trainerId, stats] of Object.entries(trainerStats)) {
            console.log(`👨‍🏫 ${stats.name}:`);
            console.log(`   Тренировок: ${stats.count}`);
            console.log(`   Сумма к выплате: ${Math.round(stats.totalAmount)}₽`);
            console.log('');
        }
        
        console.log('🎉 ИТОГО:');
        console.log(`   Создано выплат: ${totalCreated}`);
        console.log(`   Общая сумма: ${Math.round(totalAmount)}₽`);
        console.log('\n✅ Все выплаты созданы со статусом "pending" (в ожидании)');
        console.log('💡 Теперь вы можете одобрить их в админ-панели');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при создании выплат:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запускаем скрипт
createPaymentsForExistingTrainings()
    .then(() => {
        console.log('\n🎯 Скрипт завершен успешно!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Критическая ошибка:', error);
        process.exit(1);
    });
