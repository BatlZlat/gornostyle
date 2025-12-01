#!/usr/bin/env node

/**
 * 🧪 ПОЛНОЕ ТЕСТИРОВАНИЕ СИСТЕМЫ
 * 
 * Комплексное тестирование всех компонентов:
 * 1. База данных
 * 2. Backend API  
 * 3. Telegram боты (клиентский и инструкторов)
 * 4. Финансовые операции
 * 5. Уведомления
 * 6. Интеграции
 * 7. Взаимодействия инструкторов, клиентов, администраторов
 * 
 * После завершения автоматически удаляет все тестовые данные
 */

const { runComprehensiveTests } = require('./comprehensive-test');
const { execSync } = require('child_process');
const path = require('path');

// Цвета для консоли
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    console.log('\n' + '='.repeat(80));
    log(title, 'magenta');
    console.log('='.repeat(80) + '\n');
}

async function runFullSystemTests() {
    console.clear();
    log('\n🧪 ПОЛНОЕ ТЕСТИРОВАНИЕ СИСТЕМЫ\n', 'bright');
    log('Дата запуска: ' + new Date().toLocaleString('ru-RU'), 'cyan');
    log('Версия: 1.0', 'cyan');
    console.log('\n' + '='.repeat(80) + '\n');

    const testResults = {
        comprehensive: false,
        notifications: false,
        finalCheck: false,
    };

    try {
        // 1. Комплексное тестирование
        logSection('📋 ЭТАП 1: КОМПЛЕКСНОЕ ТЕСТИРОВАНИЕ');
        log('Запуск основного набора тестов...\n', 'cyan');
        
        const comprehensiveResult = await runComprehensiveTests();
        testResults.comprehensive = comprehensiveResult;
        
        if (!comprehensiveResult) {
            log('\n⚠️  Комплексное тестирование завершилось с ошибками', 'yellow');
        }

        // 2. Проверка уведомлений отдельно
        logSection('📋 ЭТАП 2: ПРОВЕРКА УВЕДОМЛЕНИЙ');
        log('Запуск скрипта проверки уведомлений...\n', 'cyan');
        
        try {
            const notificationCheck = execSync('node scripts/check-notifications-location.js', { 
                encoding: 'utf8',
                cwd: path.resolve(__dirname, '..')
            });
            
            if (notificationCheck.includes('Найдено проблем: 0') || 
                notificationCheck.includes('Проблем не обнаружено')) {
                log('✅ Все уведомления используют динамические названия мест', 'green');
                testResults.notifications = true;
            } else {
                const match = notificationCheck.match(/Найдено проблем: (\d+)/);
                const problemCount = match ? parseInt(match[1]) : -1;
                if (problemCount > 0) {
                    log(`⚠️  Найдено ${problemCount} проблем с уведомлениями`, 'yellow');
                    testResults.notifications = false;
                } else {
                    log('✅ Уведомления проверены', 'green');
                    testResults.notifications = true;
                }
            }
        } catch (err) {
            log(`⚠️  Ошибка при проверке уведомлений: ${err.message}`, 'yellow');
            testResults.notifications = false;
        }

        // 3. Финальная проверка системы
        logSection('📋 ЭТАП 3: ФИНАЛЬНАЯ ПРОВЕРКА');
        
        log('Проверка целостности данных...\n', 'cyan');
        
        const { Pool } = require('pg');
        require('dotenv').config();
        
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });

        // Проверяем, что нет тестовых данных
        const testDataCheck = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM clients WHERE full_name LIKE 'Тестовый%') as test_clients,
                (SELECT COUNT(*) FROM kuliga_instructors WHERE full_name LIKE 'Тестовый%') as test_instructors,
                (SELECT COUNT(*) FROM kuliga_bookings 
                 WHERE client_id IN (SELECT id FROM clients WHERE full_name LIKE 'Тестовый%')) as test_bookings
        `);

        const hasTestData = Object.values(testDataCheck.rows[0]).some(count => parseInt(count) > 0);
        
        if (hasTestData) {
            log('⚠️  Обнаружены остатки тестовых данных', 'yellow');
            Object.entries(testDataCheck.rows[0]).forEach(([key, value]) => {
                if (parseInt(value) > 0) {
                    log(`   ${key}: ${value}`, 'yellow');
                }
            });
            testResults.finalCheck = false;
        } else {
            log('✅ Тестовые данные полностью удалены', 'green');
            testResults.finalCheck = true;
        }

        await pool.end();

        // 4. Итоговый отчет
        logSection('📊 ИТОГОВЫЙ ОТЧЕТ ПОЛНОГО ТЕСТИРОВАНИЯ');

        const allPassed = Object.values(testResults).every(r => r === true);
        
        log('Результаты тестирования:\n', 'cyan');
        log(`✅ Комплексное тестирование: ${testResults.comprehensive ? 'ПРОЙДЕНО' : 'ПРОВАЛЕНО'}`, 
            testResults.comprehensive ? 'green' : 'red');
        log(`✅ Проверка уведомлений: ${testResults.notifications ? 'ПРОЙДЕНО' : 'ПРОВАЛЕНО'}`, 
            testResults.notifications ? 'green' : 'red');
        log(`✅ Финальная проверка: ${testResults.finalCheck ? 'ПРОЙДЕНО' : 'ПРОВАЛЕНО'}`, 
            testResults.finalCheck ? 'green' : 'red');

        if (allPassed) {
            log('\n🎉 ВСЕ ТЕСТЫ ПОЛНОСТЬЮ ПРОЙДЕНЫ! СИСТЕМА ГОТОВА К РАБОТЕ!', 'green');
        } else {
            log('\n⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ. ПРОВЕРЬТЕ РЕЗУЛЬТАТЫ ВЫШЕ.', 'yellow');
        }

        console.log('\n' + '='.repeat(80) + '\n');
        
        return allPassed;

    } catch (error) {
        log(`\n❌ КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`, 'red');
        console.error(error);
        return false;
    }
}

// Запуск
if (require.main === module) {
    runFullSystemTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Фатальная ошибка:', error);
        process.exit(1);
    });
}

module.exports = { runFullSystemTests };

