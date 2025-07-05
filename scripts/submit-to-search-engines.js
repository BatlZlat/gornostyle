const https = require('https');
const fs = require('fs');

console.log('🔍 Скрипт отправки сайта в поисковые системы\n');

const siteUrl = 'https://gornostyle72.ru';
const sitemapUrl = `${siteUrl}/sitemap.xml`;

// Проверяем доступность sitemap
function checkSitemap() {
    return new Promise((resolve, reject) => {
        const url = new URL(sitemapUrl);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'GET'
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 200) {
                console.log('✅ Sitemap доступен:', sitemapUrl);
                resolve(true);
            } else {
                console.log('❌ Sitemap недоступен:', res.statusCode);
                reject(false);
            }
        });

        req.on('error', (err) => {
            console.log('❌ Ошибка проверки sitemap:', err.message);
            reject(false);
        });

        req.end();
    });
}

// Уведомляем Яндекс о новом sitemap
function notifyYandex() {
    return new Promise((resolve, reject) => {
        const url = `https://webmaster.yandex.ru/api/sitemap/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('✅ Яндекс уведомлен о sitemap');
                    resolve(data);
                } else {
                    console.log('⚠️ Яндекс API ответил:', res.statusCode);
                    resolve(data);
                }
            });
        }).on('error', (err) => {
            console.log('❌ Ошибка уведомления Яндекса:', err.message);
            reject(err);
        });
    });
}

// Уведомляем Google о новом sitemap
function notifyGoogle() {
    return new Promise((resolve, reject) => {
        const url = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
        
        https.get(url, (res) => {
            if (res.statusCode === 200) {
                console.log('✅ Google уведомлен о sitemap');
                resolve('OK');
            } else {
                console.log('⚠️ Google API ответил:', res.statusCode);
                resolve('Partial');
            }
        }).on('error', (err) => {
            console.log('❌ Ошибка уведомления Google:', err.message);
            reject(err);
        });
    });
}

// Создаем файл с инструкциями для вебмастера
function createWebmasterInstructions() {
    const instructions = `
# 🚀 ИНСТРУКЦИИ ПО УСКОРЕНИЮ ИНДЕКСАЦИИ

## 📊 Яндекс Вебмастер (ОБЯЗАТЕЛЬНО!)
1. Откройте: https://webmaster.yandex.ru/
2. Добавьте сайт: ${siteUrl}
3. Подтвердите права на сайт (мета-тег или файл)
4. Перейдите в "Индексирование" → "Файлы Sitemap"
5. Добавьте: ${sitemapUrl}
6. Нажмите "Проверить и добавить"

## 🌐 Google Search Console
1. Откройте: https://search.google.com/search-console/
2. Добавьте ресурс: ${siteUrl}
3. Подтвердите права на сайт
4. Перейдите в "Файлы Sitemap"
5. Добавьте: ${sitemapUrl}

## 📈 Дополнительные способы ускорения:
- Создайте профили в соцсетях (VK, Telegram)
- Разместите ссылки на сайт в справочниках
- Напишите статьи о горнолыжном тренажере
- Получите упоминания в местных СМИ

## 🔗 Полезные ссылки:
- Яндекс Справка: https://yandex.ru/support/webmaster/
- Google Справка: https://support.google.com/webmasters/

Дата создания: ${new Date().toLocaleDateString('ru-RU')}
`;

    fs.writeFileSync('SEO-INSTRUCTIONS.md', instructions);
    console.log('📝 Инструкции сохранены в файл: SEO-INSTRUCTIONS.md');
}

// Основная функция
async function main() {
    try {
        console.log('🔍 Проверяем sitemap...');
        await checkSitemap();
        
        console.log('\n📤 Уведомляем поисковые системы...');
        
        try {
            await notifyYandex();
        } catch (err) {
            console.log('⚠️ Не удалось уведомить Яндекс автоматически');
        }
        
        try {
            await notifyGoogle();
        } catch (err) {
            console.log('⚠️ Не удалось уведомить Google автоматически');
        }
        
        console.log('\n📝 Создаем инструкции...');
        createWebmasterInstructions();
        
        console.log('\n🎯 СЛЕДУЮЩИЕ ШАГИ:');
        console.log('1. Зарегистрируйтесь в Яндекс Вебмастере');
        console.log('2. Добавьте сайт и подтвердите права');
        console.log('3. Загрузите sitemap.xml');
        console.log('4. Повторите для Google Search Console');
        console.log('5. Подождите 3-7 дней для индексации');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    }
}

main(); 