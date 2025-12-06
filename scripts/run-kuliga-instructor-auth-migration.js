const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const pool = new Pool({
    user: process.env.DB_USER || 'batl-zlat',
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'skisimulator',
    password: process.env.DB_PASSWORD || 'Nemezida2324%)',
    port: process.env.DB_PORT || 6432,
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('🚀 Запуск миграции авторизации инструкторов Кулиги...');

        const migrationPath = path.join(__dirname, '../src/db/migrations/030_add_auth_to_kuliga_instructors.sql');
        const sql = await fs.readFile(migrationPath, 'utf8');
        
        console.log('📄 Файл миграции загружен');

        await client.query('BEGIN');
        console.log('🔄 Выполнение миграции...');
        
        await client.query(sql);
        
        await client.query('COMMIT');
        console.log('✅ Миграция 030_add_auth_to_kuliga_instructors.sql успешно выполнена!');
        console.log('\n✨ Таблица kuliga_instructors расширена полями username и password_hash.\n');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка выполнения миграции:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();

