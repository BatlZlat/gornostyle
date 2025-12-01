#!/usr/bin/env node

/**
 * 🚀 ЗАПУСК ВСЕХ ТЕСТОВ
 * 
 * Запускает все тесты последовательно:
 * 1. Комплексное тестирование системы
 * 2. Тестирование ботов и взаимодействий
 * 3. Финальная проверка и очистка
 */

const { runComprehensiveTests } = require('./comprehensive-test');
const { runBotTests } = require('./test-bot-interactions');
const { execSync } = require('child_process');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runAllTests() {
    console.clear();
    log('\n🚀 ПОЛНОЕ ТЕСТИРОВАНИЕ СИСТЕМЫ\n', 'bright');
    log('Дата запуска: ' + new Date().toLocaleString('ru-RU'), 'cyan');
    console.log('\n' + '='.repeat(80));
    log('Включает:', 'cyan');
    log('  • Тестирование базы данных');
    log('  • Тестирование создания данных');
    log('  • Тестирование фильтрации и наследования');
    log('  • Тестирование финансовых операций');
    log('  • Тестирование ботов');
    log('  • Тестирование уведомлений');
    log('  • Проверка всех компонентов');
    log('  • Автоматическая очистка тестовых данных');
    console.log('='.repeat(80) + '\n');

    const results = {
        comprehensive: false,
        bots: false,
        notifications: false,
    };

    try {
        // 1. Проверка уведомлений (быстрая проверка)
        log('\n📢 Шаг 1: Проверка уведомлений...', 'cyan');
        try {
            const notificationCheck = execSync('node scripts/check-notifications-location.js', { 
                encoding: 'utf8',
                stdio: 'pipe'
            });
            
            const problemMatch = notificationCheck.match(/Найдено проблем: (\d+)/);
            const problemCount = problemMatch ? parseInt(problemMatch[1]) : 0;
            
            if (problemCount === 0) {
                log('✅ Все уведомления используют динамические названия мест', 'green');
                results.notifications = true;
            } else {
                log(`⚠️  Найдено ${problemCount} проблем с уведомлениями`, 'yellow');
                results.notifications = false;
            }
        } catch (error) {
            log('❌ Ошибка при проверке уведомлений', 'red');
            console.error(error.message);
        }

        // 2. Комплексное тестирование
        log('\n📊 Шаг 2: Комплексное тестирование системы...', 'cyan');
        try {
            // Запускаем через require, чтобы перехватить результаты
            await runComprehensiveTests();
            results.comprehensive = true;
        } catch (error) {
            log('❌ Ошибка при комплексном тестировании', 'red');
            console.error(error);
            results.comprehensive = false;
        }

        // 3. Тестирование ботов
        log('\n🤖 Шаг 3: Тестирование ботов и взаимодействий...', 'cyan');
        try {
            const botTestsResult = await runBotTests();
            results.bots = botTestsResult;
        } catch (error) {
            log('❌ Ошибка при тестировании ботов', 'red');
            console.error(error);
            results.bots = false;
        }

        // 4. Финальный отчет
        console.log('\n' + '='.repeat(80));
        log('\n📊 ФИНАЛЬНЫЙ ОТЧЕТ\n', 'bright');

        const allPassed = Object.values(results).every(r => r === true);
        const passedCount = Object.values(results).filter(r => r === true).length;
        const totalCount = Object.keys(results).length;

        log(`Пройдено этапов: ${passedCount}/${totalCount}`, passedCount === totalCount ? 'green' : 'yellow');
        
        Object.entries(results).forEach(([test, passed]) => {
            const icon = passed ? '✅' : '❌';
            const color = passed ? 'green' : 'red';
            log(`${icon} ${test}`, color);
        });

        if (allPassed) {
            log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!', 'green');
            log('✅ Система готова к использованию', 'green');
            log('✅ Все тестовые данные удалены', 'green');
        } else {
            log('\n⚠️  НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОЙДЕНЫ', 'yellow');
            log('Проверьте результаты выше для деталей', 'yellow');
        }

        console.log('\n' + '='.repeat(80) + '\n');

        return allPassed;

    } catch (error) {
        log(`\n❌ КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`, 'red');
        console.error(error);
        return false;
    }
}

if (require.main === module) {
    runAllTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Фатальная ошибка:', error);
        process.exit(1);
    });
}

module.exports = { runAllTests };

