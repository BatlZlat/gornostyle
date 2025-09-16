const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

class EmailService {
    constructor() {
        // Создаем transporter для отправки email
        this.transporter = nodemailer.createTransport({
            host: 'smtp.yandex.ru',
            port: 465,
            secure: true, // Используем SSL
            auth: {
                user: process.env.EMAIL_USER || 'batl-zlat@yandex.ru',
                pass: process.env.EMAIL_PASS || '' // Пароль приложения Yandex
            }
        });

        // Проверяем настройки
        if (!process.env.EMAIL_PASS) {
            console.warn('⚠️  EMAIL_PASS не настроен в переменных окружения. Email уведомления работать не будут.');
            console.warn('💡 Для Yandex почты нужен пароль приложения, а не обычный пароль!');
        }
    }

    // Отправка сертификата на email
    async sendCertificateEmail(recipientEmail, certificateData) {
        try {
            // Проверяем настройки перед отправкой
            if (!process.env.EMAIL_PASS) {
                console.warn(`⚠️  Не удалось отправить email на ${recipientEmail}: EMAIL_PASS не настроен`);
                return { success: false, error: 'EMAIL_PASS не настроен' };
            }

            const { certificateId, certificateCode, recipientName, amount, message } = certificateData;

            // Генерируем HTML содержимое письма
            const htmlContent = this.generateCertificateEmailHTML(certificateData);

            const mailOptions = {
                from: {
                    name: 'Горностайл72',
                    address: process.env.EMAIL_USER || 'batl-zlat@yandex.ru'
                },
                to: recipientEmail,
                subject: `🎁 Ваш подарочный сертификат Горностайл72 готов!`,
                html: htmlContent,
                attachments: [
                    // TODO: В будущем можно добавить PDF сертификат как вложение
                ]
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
            
            throw error;
        }
    }

    // Генерация HTML содержимого письма
    generateCertificateEmailHTML(certificateData) {
        const { certificateId, certificateCode, recipientName, amount, message, designImageUrl } = certificateData;
        
        return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Подарочный сертификат Горностайл72</title>
            <style>
                body {
                    font-family: 'Arial', sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f8f9fa;
                }
                .container {
                    background: white;
                    border-radius: 15px;
                    padding: 40px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    border-bottom: 3px solid #3498db;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                .logo {
                    font-size: 2rem;
                    font-weight: bold;
                    color: #2c3e50;
                    margin-bottom: 10px;
                }
                .subtitle {
                    color: #7f8c8d;
                    font-size: 1.1rem;
                }
                .certificate {
                    background: ${designImageUrl ? `url('${designImageUrl}')` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
                    background-size: cover;
                    background-position: center;
                    background-repeat: no-repeat;
                    color: white;
                    padding: 30px;
                    border-radius: 15px;
                    text-align: center;
                    margin: 30px 0;
                    min-height: 300px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    position: relative;
                }
                .certificate::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.4);
                    border-radius: 15px;
                    z-index: 1;
                }
                .certificate > * {
                    position: relative;
                    z-index: 2;
                }
                .certificate-title {
                    font-size: 1.8rem;
                    font-weight: bold;
                    margin-bottom: 15px;
                }
                .certificate-code {
                    font-size: 2rem;
                    font-weight: bold;
                    background: rgba(255,255,255,0.2);
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    letter-spacing: 2px;
                }
                .certificate-amount {
                    font-size: 2.5rem;
                    font-weight: bold;
                    margin: 20px 0;
                }
                .info-section {
                    background: #e8f4f8;
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                }
                .info-title {
                    font-weight: bold;
                    color: #2c3e50;
                    margin-bottom: 10px;
                }
                .contact-info {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                    margin-top: 30px;
                }
                .btn {
                    display: inline-block;
                    background: #3498db;
                    color: white;
                    padding: 15px 30px;
                    border-radius: 25px;
                    text-decoration: none;
                    font-weight: bold;
                    margin: 20px 0;
                }
                .footer {
                    text-align: center;
                    margin-top: 40px;
                    padding-top: 20px;
                    border-top: 1px solid #e9ecef;
                    color: #7f8c8d;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🎿 Горностайл72</div>
                    <div class="subtitle">Горнолыжный тренажерный комплекс</div>
                </div>

                <h1 style="text-align: center; color: #2c3e50;">🎁 Ваш подарочный сертификат готов!</h1>
                
                <div class="certificate">
                    <div class="certificate-title">ПОДАРОЧНЫЙ СЕРТИФИКАТ</div>
                    <div class="certificate-amount">${amount} ₽</div>
                    <div style="margin: 20px 0;">
                        <strong>Получатель:</strong> ${recipientName}
                    </div>
                    ${message ? `<div style="margin: 20px 0; font-style: italic;">"${message}"</div>` : ''}
                    <div class="certificate-code">${certificateCode}</div>
                    <div style="font-size: 0.9rem; opacity: 0.9;">
                        Код сертификата для активации
                    </div>
                </div>

                <div class="info-section">
                    <div class="info-title">📋 Как использовать сертификат:</div>
                    <ol>
                        <li>Получите сертификат - после покупки вы получили красивый сертификат с уникальным номером</li>
                        <li>Подарите или распечатайте - можете распечатать сертификат или отправить получателю цифровую версию</li>
                        <li>Активируйте в боте - получатель активирует сертификат через наш Telegram бот @gornostyle72_bot</li>
                        <li>Записывайтесь на тренировки - выбирайте удобное время и записывайтесь на индивидуальные или групповые тренировки</li>
                    </ol>
                </div>

                <div class="info-section">
                    <div class="info-title">⏰ Важная информация:</div>
                    <ul>
                        <li><strong>Срок действия:</strong> 1 год с момента покупки</li>
                        <li><strong>Номинал:</strong> ${amount} рублей</li>
                        <li><strong>Действует на все виды тренировок</strong></li>
                        <li><strong>Подходит для любого уровня подготовки</strong></li>
                    </ul>
                </div>

                <div style="text-align: center;">
                    <a href="https://t.me/gornostyle72_bot" class="btn">
                        📱 Записаться на тренировку
                    </a>
                </div>

                <div class="contact-info">
                    <div class="info-title">📞 Контакты для записи:</div>
                    <p><strong>Телефон:</strong> +7 (912) 392-49-56</p>
                    <p><strong>Telegram:</strong> @gornostyle72_bot</p>
                    <p><strong>Группа:</strong> @gornostyle72</p>
                    <p><strong>Адрес:</strong> г. Тюмень, с. Яр, ул. Источник, 2А</p>
                </div>

                <div class="footer">
                    <p>Спасибо за выбор Горностайл72! 🎿</p>
                    <p style="font-size: 0.9rem;">
                        Это письмо отправлено автоматически. Пожалуйста, не отвечайте на него.<br>
                        По всем вопросам обращайтесь по указанным выше контактам.
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;
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

