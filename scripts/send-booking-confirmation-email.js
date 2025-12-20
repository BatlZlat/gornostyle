#!/usr/bin/env node

/**
 * Скрипт для отправки письма с подтверждением записи на тренировку
 * Использование: node scripts/send-booking-confirmation-email.js
 */

require('dotenv').config();
const readline = require('readline');
const EmailService = require('../src/services/emailService');
const emailTemplateService = require('../src/services/email-template-service');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

function formatPrice(price) {
    return typeof price === 'string' ? price.replace(/[^\d]/g, '') : String(price || 0);
}

async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('📧 Отправка письма с подтверждением записи на тренировку');
    console.log('═══════════════════════════════════════════════════════\n');

    try {
        // Собираем данные
        const email = await question('📨 Email получателя: ');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            throw new Error('Невалидный email адрес');
        }

        const clientName = await question('👤 Имя клиента (для приветствия): ');
        if (!clientName || !clientName.trim()) {
            throw new Error('Имя клиента обязательно');
        }

        const date = await question('📅 Дата (например: 19 декабря 2025): ');
        if (!date || !date.trim()) {
            throw new Error('Дата обязательна');
        }

        const time = await question('⏰ Время (например: 14:00 - 15:00): ');
        if (!time || !time.trim()) {
            throw new Error('Время обязательно');
        }

        // Парсим время для start_time и end_time
        const timeMatch = time.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        let startTime = '';
        let endTime = '';
        if (timeMatch) {
            // Формат "14:00 - 15:00"
            startTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}:00`;
            endTime = `${timeMatch[3].padStart(2, '0')}:${timeMatch[4]}:00`;
        } else {
            // Если формат не "14:00 - 15:00", пытаемся извлечь время начала
            const singleTimeMatch = time.match(/(\d{1,2}):(\d{2})/);
            if (singleTimeMatch) {
                startTime = `${singleTimeMatch[1].padStart(2, '0')}:${singleTimeMatch[2]}:00`;
                endTime = startTime; // Используем то же время как окончание
            } else {
                throw new Error('Не удалось распарсить время. Используйте формат "14:00 - 15:00" или "14:00"');
            }
        }

        const bookingType = await question('🎯 Тип тренировки (1 - Индивидуальная, 2 - Групповая) [1]: ') || '1';
        const bookingTypeText = bookingType === '2' ? 'Групповая тренировка' : 'Индивидуальная тренировка';

        const sportTypeInput = await question('⛷️  Вид спорта (1 - Лыжи, 2 - Сноуборд) [1]: ') || '1';
        const sportTypeText = sportTypeInput === '2' ? 'Сноуборд' : 'Лыжи';
        const sportType = sportTypeInput === '2' ? 'snowboard' : 'ski';

        const instructorName = await question('👨‍🏫 Инструктор (можно оставить пустым): ') || null;

        const locationInput = await question('📍 Место (1 - Кулига-Клуб, 2 - Воронинские горки) [1]: ') || '1';
        const locationText = locationInput === '2' ? 'Воронинские горки' : 'Кулига-Клуб';
        const location = locationInput === '2' ? 'vorona' : 'kuliga';

        const priceTotal = await question('💰 Стоимость (например: 2000): ');
        if (!priceTotal || !priceTotal.trim()) {
            throw new Error('Стоимость обязательна');
        }
        const priceTotalNum = parseFloat(formatPrice(priceTotal));

        const pricePerPersonInput = await question('💵 Цена за человека (например: 2000, можно оставить пустым): ') || '';
        const pricePerPerson = pricePerPersonInput.trim() ? parseFloat(formatPrice(pricePerPersonInput)) : null;

        // Подтверждение
        console.log('\n═══════════════════════════════════════════════════════');
        console.log('📋 Данные для отправки:');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`Email: ${email}`);
        console.log(`Имя: ${clientName}`);
        console.log(`Дата: ${date}`);
        console.log(`Время: ${time}`);
        console.log(`Тип: ${bookingTypeText}`);
        console.log(`Вид спорта: ${sportTypeText}`);
        if (instructorName) {
            console.log(`Инструктор: ${instructorName}`);
        }
        console.log(`Место: ${locationText}`);
        console.log(`Стоимость: ${priceTotalNum} ₽`);
        if (pricePerPerson) {
            console.log(`Цена за человека: ${pricePerPerson} ₽`);
        }
        console.log('═══════════════════════════════════════════════════════\n');

        const confirm = await question('Отправить письмо? (y/n) [y]: ') || 'y';
        if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'да') {
            console.log('❌ Отправка отменена');
            rl.close();
            return;
        }

        // Формируем данные для шаблона
        // emailTemplateService уже является экземпляром (не классом)
        
        // Парсим дату для формата YYYY-MM-DD (нужно для внутренней обработки в шаблоне)
        // Пытаемся распарсить русскую дату "19 декабря 2025" -> "2025-12-19"
        const dateMap = {
            'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
            'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
            'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
        };
        
        let dateForTemplate = date.trim();
        const dateMatch = date.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
        if (dateMatch && dateMap[dateMatch[2].toLowerCase()]) {
            const day = dateMatch[1].padStart(2, '0');
            const month = dateMap[dateMatch[2].toLowerCase()];
            const year = dateMatch[3];
            dateForTemplate = `${year}-${month}-${day}`;
        }
        // Если не удалось распарсить, используем как есть (может быть уже в формате YYYY-MM-DD)

        const bookingData = {
            client_name: clientName.trim(),
            client_id: null, // Для ручной отправки client_id не нужен
            booking_type: bookingType === '2' ? 'group' : 'individual',
            date: dateForTemplate,
            start_time: startTime,
            end_time: endTime || startTime,
            sport_type: sportType,
            location: location,
            instructor_name: instructorName && instructorName.trim() ? instructorName.trim() : null,
            participants_count: 1, // По умолчанию
            price_total: priceTotalNum,
            price_per_person: pricePerPerson
        };

        // Генерируем HTML из шаблона
        console.log('\n🔄 Генерация письма из шаблона...');
        const htmlContent = await emailTemplateService.generateBookingConfirmationEmail(bookingData);

        // Формируем тему письма
        const dateFormatted = date; // Используем исходную дату как есть
        const timeFormatted = time.includes('-') ? time.split('-')[0].trim() : time.trim();
        const subject = `✅ Подтверждение записи на тренировку - ${dateFormatted} ${timeFormatted}`;

        // Отправляем письмо
        console.log(`📤 Отправка письма на ${email}...`);
        const emailService = new EmailService();
        const result = await emailService.sendEmail(email.trim(), subject, htmlContent);

        if (result.success) {
            console.log(`\n✅ Письмо успешно отправлено на ${email}`);
            console.log(`📧 Тема: ${subject}`);
        } else {
            console.error(`\n❌ Ошибка отправки письма: ${result.error || 'Неизвестная ошибка'}`);
            if (result.errorDetails) {
                console.error('Детали:', result.errorDetails);
            }
            process.exit(1);
        }

    } catch (error) {
        console.error(`\n❌ Ошибка: ${error.message}`);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    } finally {
        rl.close();
    }
}

// Запускаем скрипт
main().catch((error) => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
});

