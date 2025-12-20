#!/usr/bin/env node

/**
 * Скрипт для проверки соединения с mail.ru SMTP серверами
 */

const net = require('net');
const dns = require('dns').promises;

async function testConnection(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let connected = false;

        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
            connected = true;
            socket.destroy();
            resolve({ success: true, host, port });
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve({ success: false, error: 'timeout', host, port });
        });

        socket.on('error', (err) => {
            resolve({ success: false, error: err.message, host, port });
        });

        socket.connect(port, host);
    });
}

async function main() {
    console.log('🔍 Проверка соединения с mail.ru серверами...\n');

    // Проверяем резолв DNS
    try {
        console.log('📡 Проверка DNS резолва для mail.ru...');
        const addresses = await dns.resolve4('mail.ru');
        console.log(`✅ DNS резолв успешен: ${addresses.join(', ')}\n`);
    } catch (error) {
        console.error(`❌ Ошибка DNS резолва: ${error.message}\n`);
    }

    // Проверяем доступность различных портов на mail.ru
    const tests = [
        { host: 'smtp.mail.ru', port: 465, description: 'SMTP SSL (465)' },
        { host: 'smtp.mail.ru', port: 587, description: 'SMTP STARTTLS (587)' },
        { host: 'smtp.mail.ru', port: 25, description: 'SMTP (25)' },
        { host: 'pop.mail.ru', port: 995, description: 'POP3 SSL (995)' },
        { host: 'imap.mail.ru', port: 993, description: 'IMAP SSL (993)' }
    ];

    console.log('🔌 Проверка доступности портов...\n');
    for (const test of tests) {
        const result = await testConnection(test.host, test.port, 10000);
        if (result.success) {
            console.log(`✅ ${test.description} - ${test.host}:${test.port} - доступен`);
        } else {
            console.log(`❌ ${test.description} - ${test.host}:${test.port} - недоступен (${result.error})`);
        }
    }

    console.log('\n📊 Проверка завершена');
}

main().catch(error => {
    console.error('Ошибка:', error);
    process.exit(1);
});

