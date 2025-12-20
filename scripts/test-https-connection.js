#!/usr/bin/env node

/**
 * Скрипт для проверки доступности HTTPS соединений (порт 443)
 */

const https = require('https');

async function testHTTPSConnection(host, path = '/') {
    return new Promise((resolve) => {
        const options = {
            hostname: host,
            port: 443,
            path: path,
            method: 'GET',
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            resolve({ 
                success: true, 
                host, 
                statusCode: res.statusCode,
                message: `HTTPS соединение успешно (статус: ${res.statusCode})`
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, host, error: 'timeout' });
        });

        req.on('error', (err) => {
            resolve({ success: false, host, error: err.message });
        });

        req.end();
    });
}

async function main() {
    console.log('🔍 Проверка доступности HTTPS соединений (порт 443)...\n');

    const hosts = [
        'api.unisender.com',
        'www.unisender.com',
        'google.com'
    ];

    for (const host of hosts) {
        const result = await testHTTPSConnection(host);
        if (result.success) {
            console.log(`✅ ${host} - доступен (статус: ${result.statusCode})`);
        } else {
            console.log(`❌ ${host} - недоступен (${result.error})`);
        }
    }

    console.log('\n📊 Проверка завершена');
    console.log('💡 Если HTTPS соединения работают, можно использовать Unisender API');
}

main().catch(error => {
    console.error('Ошибка:', error);
    process.exit(1);
});

