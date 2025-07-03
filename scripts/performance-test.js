#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Анализ производительности сайта Горностайл72\n');

// Функция для анализа размера файлов
function analyzeFileSize(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch (error) {
        return 0;
    }
}

// Функция для конвертации байт в читаемый формат
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Анализ CSS файлов
console.log('📊 Анализ CSS файлов:');
const cssFiles = [
    'public/css/style.css',
    'public/css/mobile.css'
];

let totalCssSize = 0;
cssFiles.forEach(file => {
    const size = analyzeFileSize(file);
    totalCssSize += size;
    console.log(`  ${path.basename(file)}: ${formatBytes(size)}`);
});
console.log(`  Общий размер CSS: ${formatBytes(totalCssSize)}\n`);

// Анализ изображений
console.log('🖼️  Анализ изображений:');
const imageFiles = [
    'public/images/photo_trenagor.webp',
    'public/images/partners/maximum72.webp',
    'public/images/partners/nevidalia.webp',
    'public/images/partners/Richwood.webp',
    'public/images/trainers/pervuhin-aleksey.webp',
    'public/images/trainers/tebyakin-danil.webp'
];

let totalImageSize = 0;
imageFiles.forEach(file => {
    const size = analyzeFileSize(file);
    totalImageSize += size;
    console.log(`  ${path.basename(file)}: ${formatBytes(size)}`);
});
console.log(`  Общий размер изображений: ${formatBytes(totalImageSize)}\n`);

// Анализ JavaScript файлов
console.log('📜 Анализ JavaScript файлов:');
const jsFiles = [
    'public/js/main.js',
    'public/js/admin.js',
    'public/js/booking.js',
    'public/js/profile.js'
];

let totalJsSize = 0;
jsFiles.forEach(file => {
    const size = analyzeFileSize(file);
    totalJsSize += size;
    console.log(`  ${path.basename(file)}: ${formatBytes(size)}`);
});
console.log(`  Общий размер JavaScript: ${formatBytes(totalJsSize)}\n`);

// Анализ HTML шаблонов
console.log('📄 Анализ HTML шаблонов:');
const htmlFiles = [
    'views/index.ejs',
    'views/prices.ejs',
    'views/schedule.ejs'
];

let totalHtmlSize = 0;
htmlFiles.forEach(file => {
    const size = analyzeFileSize(file);
    totalHtmlSize += size;
    console.log(`  ${path.basename(file)}: ${formatBytes(size)}`);
});
console.log(`  Общий размер HTML: ${formatBytes(totalHtmlSize)}\n`);

// Общая статистика
const totalSize = totalCssSize + totalImageSize + totalJsSize + totalHtmlSize;
console.log('📈 Общая статистика:');
console.log(`  CSS: ${formatBytes(totalCssSize)} (${((totalCssSize / totalSize) * 100).toFixed(1)}%)`);
console.log(`  Изображения: ${formatBytes(totalImageSize)} (${((totalImageSize / totalSize) * 100).toFixed(1)}%)`);
console.log(`  JavaScript: ${formatBytes(totalJsSize)} (${((totalJsSize / totalSize) * 100).toFixed(1)}%)`);
console.log(`  HTML: ${formatBytes(totalHtmlSize)} (${((totalHtmlSize / totalSize) * 100).toFixed(1)}%)`);
console.log(`  Общий размер: ${formatBytes(totalSize)}\n`);

// Рекомендации по оптимизации
console.log('💡 Рекомендации по оптимизации:');

if (totalImageSize > totalSize * 0.6) {
    console.log('  ⚠️  Изображения занимают более 60% от общего размера');
    console.log('     Рекомендуется:');
    console.log('     - Конвертировать изображения в WebP формат');
    console.log('     - Использовать lazy loading для изображений');
    console.log('     - Оптимизировать размеры изображений');
}

if (totalCssSize > 100 * 1024) { // Больше 100KB
    console.log('  ⚠️  CSS файлы довольно большие');
    console.log('     Рекомендуется:');
    console.log('     - Минифицировать CSS');
    console.log('     - Удалить неиспользуемые стили');
    console.log('     - Разделить CSS на критические и некритические стили');
}

if (totalJsSize > 200 * 1024) { // Больше 200KB
    console.log('  ⚠️  JavaScript файлы довольно большие');
    console.log('     Рекомендуется:');
    console.log('     - Минифицировать JavaScript');
    console.log('     - Использовать code splitting');
    console.log('     - Загружать скрипты асинхронно');
}

// Проверка наличия lazy loading
console.log('\n🔍 Проверка оптимизаций:');

const indexContent = fs.readFileSync('views/index.ejs', 'utf8');
if (indexContent.includes('loading="lazy"')) {
    console.log('  ✅ Lazy loading для изображений настроен');
} else {
    console.log('  ❌ Lazy loading для изображений не настроен');
}

if (fs.existsSync('public/css/mobile.css')) {
    console.log('  ✅ Мобильная оптимизация CSS настроена');
} else {
    console.log('  ❌ Мобильная оптимизация CSS не настроена');
}

if (fs.existsSync('public/sitemap.xml')) {
    console.log('  ✅ Sitemap.xml создан');
} else {
    console.log('  ❌ Sitemap.xml отсутствует');
}

if (fs.existsSync('public/robots.txt')) {
    console.log('  ✅ Robots.txt создан');
} else {
    console.log('  ❌ Robots.txt отсутствует');
}

// Проверка мета-тегов
if (indexContent.includes('viewport') && indexContent.includes('description')) {
    console.log('  ✅ Основные мета-теги настроены');
} else {
    console.log('  ❌ Основные мета-теги отсутствуют');
}

console.log('\n✅ Анализ производительности завершён!'); 