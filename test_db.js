require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function testMaxDate() {
    try {
        const result = await pool.query('SELECT MAX(date) as max_date FROM schedule');
        const maxDate = result.rows[0]?.max_date;
        const formattedMaxDate = maxDate ? maxDate.toISOString().split('T')[0] : null;
        
        console.log('Максимальная дата в расписании (исходная):', maxDate);
        console.log('Максимальная дата в расписании (форматированная):', formattedMaxDate);
        
        // Тестируем сравнение дат
        const testDate = '2026-06-27';
        console.log('Тестовая дата:', testDate);
        console.log('Сравнение:', testDate > formattedMaxDate ? 'Тестовая дата больше' : 'Тестовая дата меньше или равна');
        
    } catch (error) {
        console.error('Ошибка при запросе к БД:', error);
    } finally {
        await pool.end();
    }
}

testMaxDate(); 