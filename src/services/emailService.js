const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
// const SendGridEmailService = require('./sendGridEmailService'); // Временно отключен
const ResendEmailService = require('./resendEmailService');

class EmailService {
    constructor() {
        // Инициализируем Resend сервис как основной
        this.resendService = new ResendEmailService();
        // this.sendGridService = new SendGridEmailService(); // Временно отключен
        
        // Создаем transporter для отправки email
        this.transporter = nodemailer.createTransport({
            host: 'smtp.yandex.ru',
            port: 465,
            secure: true, // Используем SSL
            auth: {
                user: process.env.EMAIL_USER || 'batl-zlat@yandex.ru',
                pass: process.env.EMAIL_PASS || '' // Пароль приложения Yandex
            },
            // Увеличиваем timeout для стабильности соединения
            connectionTimeout: 10000, // 10 секунд (было 60)
            greetingTimeout: 10000,   // 10 секунд (было 30)
            socketTimeout: 30000,     // 30 секунд (было 60)
            // Дополнительные настройки для надежности
            tls: {
                rejectUnauthorized: false // Для тестирования
            }
        });

        // Проверяем настройки
        if (!process.env.EMAIL_PASS) {
            console.warn('⚠️  EMAIL_PASS не настроен в переменных окружения. Email уведомления работать не будут.');
            console.warn('💡 Для Yandex почты нужен пароль приложения, а не обычный пароль!');
        }
    }

    // Отправка сертификата на email с PDF вложением
    async sendCertificateEmail(recipientEmail, certificateData) {
        // Используем только SMTP (Resend отключен)
        console.log(`📧 Отправка через SMTP на ${recipientEmail}...`);
        
        try {
            // Проверяем настройки перед отправкой
            if (!process.env.EMAIL_PASS) {
                console.warn(`⚠️  Не удалось отправить email на ${recipientEmail}: EMAIL_PASS не настроен`);
                return { success: false, error: 'EMAIL_PASS не настроен' };
            }

            const { certificateId, certificateCode, recipientName, amount, message, pdfUrl } = certificateData;

            // Генерируем простое HTML содержимое письма
            const htmlContent = this.generateSimpleCertificateEmailHTML(certificateData);

            // Подготавливаем вложения
            const attachments = [];
            
            // Генерируем JPG из веб-страницы сертификата
            try {
                const certificateJpgGenerator = require('./certificateJpgGenerator');
                const jpgResult = await certificateJpgGenerator.generateCertificateJpgForEmail(certificateCode);
                
                if (jpgResult.jpg_url) {
                    const jpgPath = path.join(__dirname, '../../public', jpgResult.jpg_url);
                    
                    // Пытаемся найти JPG файл с повторными попытками
                    let fileFound = false;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            await fs.access(jpgPath);
                            attachments.push({
                                filename: `Сертификат_${certificateCode}.jpg`,
                                path: jpgPath,
                                contentType: 'image/jpeg'
                            });
                            console.log(`📎 JPG вложение добавлено: ${jpgPath}`);
                            fileFound = true;
                            break;
                        } catch (error) {
                            if (attempt < 3) {
                                console.log(`⏳ JPG файл не найден (попытка ${attempt}/3), ожидание...`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } else {
                                console.warn(`⚠️  JPG файл не найден после 3 попыток: ${jpgPath}`);
                            }
                        }
                    }
                    
                    if (!fileFound) {
                        console.warn(`⚠️  JPG сертификат не будет прикреплен к email: ${jpgPath}`);
                    }
                } else if (jpgResult.pdf_url) {
                    // Fallback на PDF если JPG не удался
                    const pdfPath = path.join(__dirname, '../../public', jpgResult.pdf_url);
                    try {
                        await fs.access(pdfPath);
                        attachments.push({
                            filename: `Сертификат_${certificateCode}.pdf`,
                            path: pdfPath,
                            contentType: 'application/pdf'
                        });
                        console.log(`📎 PDF вложение добавлено (fallback): ${pdfPath}`);
                    } catch (error) {
                        console.warn(`⚠️  Fallback PDF файл не найден: ${pdfPath}`);
                    }
                }
            } catch (error) {
                console.error('Ошибка при генерации JPG для email:', error);
                
                // Fallback на старый PDF если есть
                if (pdfUrl) {
                    const pdfPath = path.join(__dirname, '../../public', pdfUrl);
                    try {
                        await fs.access(pdfPath);
                        attachments.push({
                            filename: `Сертификат_${certificateCode}.pdf`,
                            path: pdfPath,
                            contentType: 'application/pdf'
                        });
                        console.log(`📎 PDF вложение добавлено (старый fallback): ${pdfPath}`);
                    } catch (error) {
                        console.warn(`⚠️  Старый PDF файл не найден: ${pdfPath}`);
                    }
                }
            }

            const mailOptions = {
                from: {
                    name: 'Горностайл72',
                    address: process.env.EMAIL_USER || 'batl-zlat@yandex.ru'
                },
                to: recipientEmail,
                subject: `🎁 Ваш подарочный сертификат Горностайл72 готов!`,
                html: htmlContent,
                attachments: attachments
            };

            console.log(`📧 Отправка email на ${recipientEmail}...`);
            const result = await this.transporter.sendMail(mailOptions);
            console.log('✅ Email с сертификатом отправлен успешно:', result.messageId);
            return { success: true, messageId: result.messageId };

        } catch (error) {
            console.error(`❌ Ошибка при отправке email на ${recipientEmail}:`, error.message);
            
            // Детальная информация об ошибке для отладки
            if (error.code) {
                console.error(`Код ошибки: ${error.code}`);
            }
            if (error.response) {
                console.error(`Ответ сервера: ${error.response}`);
            }
            
            return { success: false, error: error.message };
        }
    }

    // Генерация простого HTML письма с информацией о сертификате
    generateSimpleCertificateEmailHTML(certificateData) {
        const { certificateId, certificateCode, recipientName, amount, message } = certificateData;
        
        // Вычисляем дату истечения (1 год от текущего момента)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        
        return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Подарочный сертификат Горностайл72</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #f8f9fa; font-family: Arial, sans-serif;">
            <!-- Основной контейнер -->
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
                <tr>
                    <td>
                        <!-- Заголовок -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px; text-align: center; border-bottom: 3px solid #3498db;">
                                    <h1 style="margin: 0; font-size: 2rem; color: #2c3e50;">🎿 Горностайл72</h1>
                                    <p style="margin: 10px 0 0 0; color: #7f8c8d; font-size: 1.1rem;">Горнолыжный тренажерный комплекс</p>
                                </td>
                            </tr>
                        </table>

                        <!-- Информация о сертификате -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 1.5rem; text-align: center;">
                                        🎁 Ваш подарочный сертификат готов!
                                    </h2>
                                    
                                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                                        <h3 style="margin: 0 0 15px 0; color: #2c3e50;">📋 Информация о сертификате:</h3>
                                        <p style="margin: 5px 0; color: #333;"><strong>Номер сертификата:</strong> ${certificateCode}</p>
                                        <p style="margin: 5px 0; color: #333;"><strong>Номинал:</strong> ${amount} рублей</p>
                                        ${recipientName ? `<p style="margin: 5px 0; color: #333;"><strong>Получатель:</strong> ${recipientName}</p>` : ''}
                                        ${message ? `<p style="margin: 5px 0; color: #333;"><strong>Сообщение:</strong> "${message}"</p>` : ''}
                                        <p style="margin: 5px 0; color: #333;"><strong>Срок действия:</strong> до ${expiryDate.toLocaleDateString('ru-RU')}</p>
                                    </div>
                                    
                                    <div style="background: #e8f5e8; padding: 15px; border-radius: 10px; border-left: 4px solid #28a745;">
                                        <p style="margin: 0; color: #155724; font-weight: bold;">
                                            📎 К письму прикреплен PDF файл с красивым сертификатом для печати!
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        </table>

                        <!-- Инструкции -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">📋 Как использовать сертификат:</h3>
                                    <ol style="margin: 0; padding-left: 20px; color: #333;">
                                        <li style="margin-bottom: 8px;"><strong>Скачайте PDF</strong> - откройте прикрепленный файл и сохраните на устройство</li>
                                        <li style="margin-bottom: 8px;"><strong>Распечатайте или поделитесь</strong> - можете распечатать сертификат или отправить PDF получателю</li>
                                        <li style="margin-bottom: 8px;"><strong>Активируйте в боте</strong> - получатель активирует сертификат через наш Telegram бот @gornostyle72_bot</li>
                                        <li style="margin-bottom: 8px;"><strong>Записывайтесь на тренировки</strong> - выбирайте удобное время и записывайтесь на индивидуальные или групповые тренировки</li>
                                    </ol>
                                </td>
                            </tr>
                        </table>

                        <!-- Важная информация -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">⏰ Важная информация:</h3>
                                    <ul style="margin: 0; padding-left: 20px; color: #333;">
                                        <li style="margin-bottom: 8px;"><strong>Срок действия:</strong> 1 год с момента покупки</li>
                                        <li style="margin-bottom: 8px;"><strong>Номинал:</strong> ${amount} рублей</li>
                                        <li style="margin-bottom: 8px;"><strong>Действует на все виды тренировок</strong></li>
                                        <li style="margin-bottom: 8px;"><strong>Подходит для любого уровня подготовки</strong></li>
                                    </ul>
                                </td>
                            </tr>
                        </table>

                        <!-- Кнопка действия -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                            <tr>
                                <td style="text-align: center;">
                                    <a href="https://t.me/gornostyle72_bot" style="display: inline-block; background: #3498db; color: white; padding: 15px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; font-size: 1.1rem;">
                                        📱 Записаться на тренировку
                                    </a>
                                </td>
                            </tr>
                        </table>

                        <!-- Контактная информация -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">📞 Контакты для записи:</h3>
                                    <p style="margin: 5px 0; color: #333;"><strong>Телефон:</strong> +7 (912) 392-49-56</p>
                                    <p style="margin: 5px 0; color: #333;"><strong>Telegram:</strong> @gornostyle72_bot</p>
                                    <p style="margin: 5px 0; color: #333;"><strong>Группа:</strong> @gornostyle72</p>
                                    <p style="margin: 5px 0; color: #333;"><strong>Адрес:</strong> г. Тюмень, с. Яр, ул. Источник, 2А</p>
                                </td>
                            </tr>
                        </table>

                        <!-- Подвал -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px;">
                            <tr>
                                <td style="padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
                                    <p style="margin: 0 0 10px 0; color: #7f8c8d; font-size: 1.1rem;">Спасибо за выбор Горностайл72! 🎿</p>
                                    <p style="margin: 0; color: #7f8c8d; font-size: 0.9rem;">
                                        Это письмо отправлено автоматически. Пожалуйста, не отвечайте на него.<br>
                                        По всем вопросам обращайтесь по указанным выше контактам.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;
    }

    // Генерация HTML содержимого письма с полноценным сертификатом (старый метод для совместимости)
    generateCertificateEmailHTML(certificateData) {
        const { certificateId, certificateCode, recipientName, amount, message, designImageUrl } = certificateData;
        
        // Вычисляем дату истечения (1 год от текущего момента)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        
        return this.generateFullCertificateHTML({
            certificate_number: certificateCode,
            nominal_value: amount,
            recipient_name: recipientName,
            message: message,
            expiry_date: expiryDate.toLocaleDateString('ru-RU'),
            design_image_url: designImageUrl
        });
    }

    // Генерация полноценного HTML сертификата для email
    generateFullCertificateHTML(certificateData) {
        const { certificate_number, nominal_value, recipient_name, message, expiry_date, design_image_url } = certificateData;
        
        return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Подарочный сертификат Горностайл72</title>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #f8f9fa; font-family: Arial, sans-serif;">
            <!-- Основной контейнер -->
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 800px; margin: 0 auto;">
                <tr>
                    <td>
                        <!-- Заголовок -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px; text-align: center; border-bottom: 3px solid #3498db;">
                                    <h1 style="margin: 0; font-size: 2rem; color: #2c3e50;">🎿 Горностайл72</h1>
                                    <p style="margin: 10px 0 0 0; color: #7f8c8d; font-size: 1.1rem;">Горнолыжный тренажерный комплекс</p>
                                </td>
                            </tr>
                        </table>

                        <!-- Сертификат -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: ${design_image_url ? `url('${design_image_url}')` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}; background-size: cover; background-position: center; background-repeat: no-repeat; border-radius: 20px; margin-bottom: 30px; position: relative;">
                            <tr>
                                <td style="padding: 40px; text-align: center; color: white; position: relative;">
                                    <!-- Затемнение фона -->
                                    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.4); border-radius: 20px;"></div>
                                    
                                    <!-- Содержимое сертификата -->
                                    <div style="position: relative; z-index: 2;">
                                        <!-- Заголовок сертификата -->
                                        <h2 style="margin: 0 0 20px 0; font-size: 1.4rem; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
                                            🎁 СЕРТИФИКАТ<br>НА ТРЕНИРОВКУ ПО ГОРНЫМ ЛЫЖАМ ИЛИ СНОУБОРДУ
                                        </h2>
                                        
                                        <!-- Номер сертификата -->
                                        <div style="font-size: 1.8rem; font-weight: bold; color: #FFD700; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); margin: 20px 0; letter-spacing: 0.1em;">
                                            № ${certificate_number}
                                        </div>
                                        
                                        <!-- Номинал -->
                                        <div style="font-size: 2.2rem; font-weight: bold; color: #FFD700; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); margin: 20px 0;">
                                            💰 ${nominal_value} руб.
                                        </div>
                                        
                                        <!-- Получатель -->
                                        ${recipient_name ? `
                                        <div style="margin: 20px 0; font-size: 1.1rem;">
                                            <strong>👤 Кому:</strong><br>${recipient_name}
                                        </div>
                                        ` : ''}
                                        
                                        <!-- Сообщение -->
                                        ${message ? `
                                        <div style="margin: 20px 0; font-size: 1rem; font-style: italic;">
                                            "${message}"
                                        </div>
                                        ` : ''}
                                        
                                        <!-- Срок действия -->
                                        <div style="margin-top: 30px; font-size: 0.9rem; opacity: 0.9;">
                                            ${(() => {
                                                try {
                                                    const d = new Date(expiry_date);
                                                    const txt = isNaN(d.getTime()) ? 'Дата не указана' : d.toLocaleDateString('ru-RU');
                                                    return `⏰ Использовать до: ${txt}`;
                                                } catch (e) {
                                                    return '⏰ Использовать до: Дата не указана';
                                                }
                                            })()}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </table>

                        <!-- Информационные блоки -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">📋 Как использовать сертификат:</h3>
                                    <ol style="margin: 0; padding-left: 20px; color: #333;">
                                        <li style="margin-bottom: 8px;">Получите сертификат - после покупки вы получили красивый сертификат с уникальным номером</li>
                                        <li style="margin-bottom: 8px;">Подарите или распечатайте - можете распечатать сертификат или отправить получателю цифровую версию</li>
                                        <li style="margin-bottom: 8px;">Активируйте в боте - получатель активирует сертификат через наш Telegram бот @gornostyle72_bot</li>
                                        <li style="margin-bottom: 8px;">Записывайтесь на тренировки - выбирайте удобное время и записывайтесь на индивидуальные или групповые тренировки</li>
                                    </ol>
                                </td>
                            </tr>
                        </table>

                        <!-- Важная информация -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">⏰ Важная информация:</h3>
                                    <ul style="margin: 0; padding-left: 20px; color: #333;">
                                        <li style="margin-bottom: 8px;"><strong>Срок действия:</strong> 1 год с момента покупки</li>
                                        <li style="margin-bottom: 8px;"><strong>Номинал:</strong> ${nominal_value} рублей</li>
                                        <li style="margin-bottom: 8px;"><strong>Действует на все виды тренировок</strong></li>
                                        <li style="margin-bottom: 8px;"><strong>Подходит для любого уровня подготовки</strong></li>
                                    </ul>
                                </td>
                            </tr>
                        </table>

                        <!-- Кнопка действия -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                            <tr>
                                <td style="text-align: center;">
                                    <a href="https://t.me/gornostyle72_bot" style="display: inline-block; background: #3498db; color: white; padding: 15px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; font-size: 1.1rem;">
                                        📱 Записаться на тренировку
                                    </a>
                                </td>
                            </tr>
                        </table>

                        <!-- Контактная информация -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 15px; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 30px;">
                                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">📞 Контакты для записи:</h3>
                                    <p style="margin: 5px 0; color: #333;"><strong>Телефон:</strong> +7 (912) 392-49-56</p>
                                    <p style="margin: 5px 0; color: #333;"><strong>Telegram:</strong> @gornostyle72_bot</p>
                                    <p style="margin: 5px 0; color: #333;"><strong>Группа:</strong> @gornostyle72</p>
                                    <p style="margin: 5px 0; color: #333;"><strong>Адрес:</strong> г. Тюмень, с. Яр, ул. Источник, 2А</p>
                                </td>
                            </tr>
                        </table>

                        <!-- Подвал -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 15px;">
                            <tr>
                                <td style="padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
                                    <p style="margin: 0 0 10px 0; color: #7f8c8d; font-size: 1.1rem;">Спасибо за выбор Горностайл72! 🎿</p>
                                    <p style="margin: 0; color: #7f8c8d; font-size: 0.9rem;">
                                        Это письмо отправлено автоматически. Пожалуйста, не отвечайте на него.<br>
                                        По всем вопросам обращайтесь по указанным выше контактам.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;
    }

    // Универсальный метод отправки email
    async sendEmail(recipientEmail, subject, htmlContent, attachments = []) {
        // Проверяем, является ли получатель Yandex адресом, привязанным к тому же аккаунту
        // Yandex может блокировать отправку на адреса того же аккаунта через SMTP
        const emailUser = process.env.EMAIL_USER || 'batl-zlat@yandex.ru';
        const isYandexSameAccount = recipientEmail.includes('@yandex.ru') && 
                                     (recipientEmail === 'gornostyle72@yandex.ru' || 
                                      recipientEmail === 'batl-zlat@yandex.ru' ||
                                      recipientEmail.includes('@yandex.ru'));
        
        // Для Yandex адресов того же аккаунта используем Resend напрямую
        if (isYandexSameAccount && recipientEmail !== 'batl.zlat87@gmail.com') {
            console.log(`📧 Обнаружен Yandex адрес того же аккаунта (${recipientEmail}), используем Resend напрямую для избежания блокировки SMTP`);
            return await this.sendViaResend(recipientEmail, subject, htmlContent, attachments);
        }
        
        // Сначала пробуем SMTP Yandex
        try {
            if (!process.env.EMAIL_PASS) {
                console.warn(`⚠️  EMAIL_PASS не настроен, пробуем Resend...`);
                throw new Error('EMAIL_PASS не настроен');
            }

            const mailOptions = {
                from: {
                    name: 'Горностайл72',
                    address: emailUser
                },
                to: recipientEmail,
                subject: subject,
                html: htmlContent,
                attachments: attachments
            };

            console.log(`📧 Попытка отправки email через SMTP Yandex на ${recipientEmail}...`);
            console.log(`📧 От кого: ${mailOptions.from.address} (${mailOptions.from.name})`);
            console.log(`📧 Тема: ${mailOptions.subject}`);
            
            // Увеличиваем таймаут для Yandex адресов (может быть медленнее)
            const timeout = recipientEmail.includes('@yandex.ru') ? 20000 : 10000;
            const sendPromise = this.transporter.sendMail(mailOptions);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`SMTP timeout: отправка заняла более ${timeout/1000} секунд`)), timeout)
            );
            
            const result = await Promise.race([sendPromise, timeoutPromise]);
            console.log('✅ Email отправлен успешно через SMTP Yandex, messageId:', result.messageId);
            console.log('✅ Ответ SMTP сервера:', result.response || 'N/A');
            return { success: true, messageId: result.messageId, response: result.response, service: 'smtp' };
        } catch (smtpError) {
            console.error(`❌ Ошибка SMTP Yandex:`, smtpError.message);
            console.log(`🔄 Пробуем отправить через Resend как fallback...`);
            
            // Fallback на Resend, если SMTP не работает
            return await this.sendViaResend(recipientEmail, subject, htmlContent, attachments, smtpError);
        }
    }
    
    // Вспомогательный метод для отправки через Resend
    async sendViaResend(recipientEmail, subject, htmlContent, attachments = [], originalError = null) {
        try {
            if (this.resendService && this.resendService.resend) {
                console.log(`📧 Попытка отправки через Resend на ${recipientEmail}...`);
                
                // Resend не поддерживает вложения в простом формате, поэтому отправляем без них
                // или конвертируем в base64 если нужно
                const emailData = {
                    from: process.env.RESEND_FROM_EMAIL || 'gornostyle@resend.dev',
                    to: recipientEmail,
                    subject: subject,
                    html: htmlContent
                };
                
                // Если есть вложения, пытаемся их добавить (Resend поддерживает base64)
                if (attachments && attachments.length > 0) {
                    console.log(`📎 Обнаружены вложения (${attachments.length}), пытаемся добавить...`);
                    try {
                        const emailAttachments = [];
                        for (const attachment of attachments) {
                            if (attachment.path) {
                                const fs = require('fs');
                                const fileBuffer = await fs.promises.readFile(attachment.path);
                                emailAttachments.push({
                                    filename: attachment.filename || 'attachment',
                                    content: fileBuffer.toString('base64'),
                                    type: attachment.contentType || 'application/octet-stream'
                                });
                            }
                        }
                        if (emailAttachments.length > 0) {
                            emailData.attachments = emailAttachments;
                            console.log(`📎 Добавлено ${emailAttachments.length} вложений`);
                        }
                    } catch (attachError) {
                        console.warn(`⚠️ Не удалось добавить вложения: ${attachError.message}`);
                    }
                }
                
                const resendResult = await this.resendService.resend.emails.send(emailData);
                
                console.log('📋 Полный ответ Resend:', JSON.stringify(resendResult, null, 2));
                const messageId = resendResult?.data?.id || resendResult?.id || null;
                if (messageId) {
                    console.log('✅ Email отправлен успешно через Resend, messageId:', messageId);
                    return { success: true, messageId: messageId, service: 'resend' };
                } else {
                    console.warn('⚠️ Resend вернул успешный ответ, но messageId отсутствует. Ответ:', resendResult);
                    return { success: true, messageId: null, service: 'resend', warning: 'messageId отсутствует в ответе' };
                }
            } else {
                console.warn('⚠️  Resend не настроен (RESEND_API_KEY отсутствует или не инициализирован)');
                throw new Error('Resend не настроен');
            }
        } catch (resendError) {
            console.error(`❌ Ошибка Resend:`, resendError.message);
            if (resendError.response) {
                console.error(`❌ Детали ошибки Resend:`, JSON.stringify(resendError.response.body || resendError.response, null, 2));
            }
            const errorMsg = originalError 
                ? `SMTP: ${originalError.message}, Resend: ${resendError.message}`
                : `Resend: ${resendError.message}`;
            console.error(`❌ Итоговая ошибка отправки email на ${recipientEmail}: ${errorMsg}`);
            return { 
                success: false, 
                error: errorMsg,
                code: originalError?.code || resendError.code,
                service: 'none'
            };
        }
    }

    // Проверка подключения к email сервису
    async verifyConnection() {
        try {
            await this.transporter.verify();
            console.log('Email сервис готов к отправке писем');
            return true;
        } catch (error) {
            console.error('Ошибка подключения к email сервису:', error);
            return false;
        }
    }
}

module.exports = EmailService;

