#!/usr/bin/env node

require('dotenv').config();

console.log('📊 Проверка настроек аналитики\\n');

// Проверяем переменные окружения
const yandexMetrikaId = process.env.YANDEX_METRIKA_ID;
const googleAnalyticsId = process.env.GOOGLE_ANALYTICS_ID;

console.log('🔍 Переменные окружения:');
console.log(`   Яндекс.Метрика ID: ${yandexMetrikaId || '❌ Не настроен'}`);
console.log(`   Google Analytics ID: ${googleAnalyticsId || '❌ Не настроен'}`);

// Проверяем файлы шаблонов
const fs = require('fs');
const path = require('path');

console.log('\\n📁 Проверка файлов шаблонов:');

const analyticsFile = 'views/partials/analytics.ejs';
if (fs.existsSync(analyticsFile)) {
    console.log(`   ✅ ${analyticsFile} - найден`);
} else {
    console.log(`   ❌ ${analyticsFile} - не найден`);
}

// Проверяем подключение аналитики в шаблонах
const templates = ['views/index.ejs', 'views/prices.ejs', 'views/schedule.ejs'];

templates.forEach(template => {
    if (fs.existsSync(template)) {
        const content = fs.readFileSync(template, 'utf8');
        if (content.includes('partials/analytics')) {
            console.log(`   ✅ ${template} - аналитика подключена`);
        } else {
            console.log(`   ❌ ${template} - аналитика не подключена`);
        }
    } else {
        console.log(`   ❌ ${template} - файл не найден`);
    }
});

// Рекомендации
console.log('\\n💡 Рекомендации:');
if (!yandexMetrikaId) {
    console.log('   1. Получите ID Яндекс.Метрики на https://metrika.yandex.ru/');
    console.log('   2. Добавьте YANDEX_METRIKA_ID=ваш_id в файл .env');
}
if (!googleAnalyticsId) {
    console.log('   3. Получите ID Google Analytics на https://analytics.google.com/');
    console.log('   4. Добавьте GOOGLE_ANALYTICS_ID=ваш_id в файл .env');
}

if (yandexMetrikaId && googleAnalyticsId) {
    console.log('   ✅ Все настройки аналитики выполнены!');
    console.log('   📈 Аналитика будет работать на всех страницах сайта');
}

console.log('\\n🔗 Полезные ссылки:');
console.log('   Яндекс.Метрика: https://metrika.yandex.ru/');
console.log('   Google Analytics: https://analytics.google.com/'); 