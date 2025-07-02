#!/usr/bin/env node

/**
 * Скрипт для тестирования SEO-оптимизации сайта
 * Запуск: node scripts/test-seo.js
 */

const fs = require('fs');
const path = require('path');

// Цвета для вывода
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filePath, description) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            log(`✅ ${description}`, 'green');
            return { exists: true, content };
        } else {
            log(`❌ ${description} - файл не найден`, 'red');
            return { exists: false, content: null };
        }
    } catch (error) {
        log(`❌ ${description} - ошибка чтения: ${error.message}`, 'red');
        return { exists: false, content: null };
    }
}

function checkMetaTags(content, requiredTags) {
    const results = [];
    
    for (const tag of requiredTags) {
        if (content.includes(tag)) {
            results.push({ tag, found: true });
        } else {
            results.push({ tag, found: false });
        }
    }
    
    return results;
}

function checkImages(content) {
    const imgRegex = /<img[^>]+>/g;
    const images = content.match(imgRegex) || [];
    
    const results = {
        total: images.length,
        withAlt: 0,
        withoutAlt: 0,
        withLazy: 0
    };
    
    images.forEach(img => {
        if (img.includes('alt=')) {
            results.withAlt++;
        } else {
            results.withoutAlt++;
        }
        
        if (img.includes('loading="lazy"')) {
            results.withLazy++;
        }
    });
    
    return results;
}

function main() {
    log('🔍 Начинаем тестирование SEO-оптимизации...', 'blue');
    log('');
    
    // Проверяем основные файлы
    const files = [
        { path: 'views/index.ejs', desc: 'Главная страница' },
        { path: 'views/prices.ejs', desc: 'Страница цен' },
        { path: 'views/schedule.ejs', desc: 'Страница графика работы' },
        { path: 'public/sitemap.xml', desc: 'Sitemap.xml' },
        { path: 'public/robots.txt', desc: 'Robots.txt' },
        { path: 'public/css/style.css', desc: 'CSS файл' }
    ];
    
    const results = {};
    
    for (const file of files) {
        const result = checkFile(file.path, file.desc);
        results[file.path] = result;
    }
    
    log('');
    log('📊 Анализ мета-тегов:', 'blue');
    
    // Проверяем мета-теги на главной странице
    if (results['views/index.ejs'].exists) {
        const content = results['views/index.ejs'].content;
        
        const requiredMetaTags = [
            '<meta name="description"',
            '<meta name="keywords"',
            '<meta property="og:title"',
            '<meta property="og:description"',
            '<meta property="og:image"',
            '<meta name="twitter:card"',
            '<link rel="canonical"',
            'type="application/ld+json"'
        ];
        
        const metaResults = checkMetaTags(content, requiredMetaTags);
        
        metaResults.forEach(result => {
            if (result.found) {
                log(`  ✅ ${result.tag}`, 'green');
            } else {
                log(`  ❌ ${result.tag}`, 'red');
            }
        });
        
        // Проверяем изображения
        log('');
        log('🖼️ Анализ изображений:', 'blue');
        const imageResults = checkImages(content);
        
        log(`  📸 Всего изображений: ${imageResults.total}`, 'blue');
        log(`  ✅ С alt-текстом: ${imageResults.withAlt}`, 'green');
        log(`  ❌ Без alt-текста: ${imageResults.withoutAlt}`, imageResults.withoutAlt > 0 ? 'red' : 'green');
        log(`  🚀 С lazy loading: ${imageResults.withLazy}`, 'blue');
        
        // Проверяем скрытый SEO-блок
        if (content.includes('seo-keywords')) {
            log('  ✅ Скрытый SEO-блок найден', 'green');
        } else {
            log('  ❌ Скрытый SEO-блок не найден', 'red');
        }
    }
    
    // Проверяем sitemap
    log('');
    log('🗺️ Анализ sitemap.xml:', 'blue');
    if (results['public/sitemap.xml'].exists) {
        const sitemapContent = results['public/sitemap.xml'].content;
        const urls = sitemapContent.match(/<loc>(.*?)<\/loc>/g) || [];
        log(`  📄 Найдено URL: ${urls.length}`, 'green');
        
        urls.forEach(url => {
            const cleanUrl = url.replace(/<\/?loc>/g, '');
            log(`    ${cleanUrl}`, 'blue');
        });
    }
    
    // Проверяем robots.txt
    log('');
    log('🤖 Анализ robots.txt:', 'blue');
    if (results['public/robots.txt'].exists) {
        const robotsContent = results['public/robots.txt'].content;
        
        if (robotsContent.includes('Sitemap:')) {
            log('  ✅ Sitemap указан', 'green');
        } else {
            log('  ❌ Sitemap не указан', 'red');
        }
        
        if (robotsContent.includes('Disallow:')) {
            log('  ✅ Правила запрета настроены', 'green');
        } else {
            log('  ⚠️ Правила запрета не найдены', 'yellow');
        }
    }
    
    // Проверяем CSS для скрытого блока
    log('');
    log('🎨 Анализ CSS:', 'blue');
    if (results['public/css/style.css'].exists) {
        const cssContent = results['public/css/style.css'].content;
        
        if (cssContent.includes('.seo-keywords')) {
            log('  ✅ CSS для скрытого SEO-блока найден', 'green');
        } else {
            log('  ❌ CSS для скрытого SEO-блока не найден', 'red');
        }
        
        if (cssContent.includes('.visually-hidden')) {
            log('  ✅ CSS для скрытых элементов найден', 'green');
        } else {
            log('  ❌ CSS для скрытых элементов не найден', 'red');
        }
    }
    
    log('');
    log('📋 Рекомендации:', 'yellow');
    log('1. Запустите оптимизацию изображений: ./scripts/optimize-images.sh');
    log('2. Проверьте сайт через Google PageSpeed Insights');
    log('3. Протестируйте микроразметку через Google Rich Results Test');
    log('4. Проверьте sitemap через Google Search Console');
    log('5. Убедитесь, что robots.txt доступен по адресу: https://gornostyle72.ru/robots.txt');
    
    log('');
    log('✅ Тестирование завершено!', 'green');
}

if (require.main === module) {
    main();
}

module.exports = { checkFile, checkMetaTags, checkImages }; 