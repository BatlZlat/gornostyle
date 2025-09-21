const sgMail = require('@sendgrid/mail');
const fs = require('fs').promises;

class SendGridEmailService {
    constructor() {
        // Инициализация SendGrid с API ключом из переменных окружения
        const apiKey = process.env.SENDGRID_API_KEY;
        if (!apiKey) {
            console.warn('⚠️  SENDGRID_API_KEY не настроен в .env файле');
        } else {
            sgMail.setApiKey(apiKey);
            console.log('✅ SendGrid инициализирован');
        }
        
        this.fromEmail = process.env.SENDGRID_FROM_EMAIL || 'gornostyle72@yandex.ru';
        this.fromName = process.env.SENDGRID_FROM_NAME || 'Горностайл72';
    }

    async sendCertificateEmail(recipientEmail, certificateData) {
        try {
            if (!process.env.SENDGRID_API_KEY) {
                console.warn(`⚠️  Не удалось отправить email на ${recipientEmail}: SENDGRID_API_KEY не настроен`);
                return { success: false, error: 'SENDGRID_API_KEY не настроен' };
            }

            const { certificateId, certificateCode, recipientName, amount, message, pdfUrl } = certificateData;

            // Генерируем HTML содержимое письма
            const htmlContent = this.generateCertificateEmailHTML(certificateData);

            // Подготавливаем вложения
            const attachments = [];
            
            // Добавляем PDF сертификат как вложение
            if (pdfUrl) {
                try {
                    const pdfPath = pdfUrl.startsWith('/') 
                        ? `${__dirname}/../../public${pdfUrl}` 
                        : pdfUrl;
                    
                    console.log(`📎 Попытка прикрепить PDF: ${pdfPath}`);
                    const pdfBuffer = await fs.readFile(pdfPath);
                    
                    attachments.push({
                        content: pdfBuffer.toString('base64'),
                        filename: `certificate_${certificateCode}.pdf`,
                        type: 'application/pdf',
                        disposition: 'attachment'
                    });
                    
                    console.log(`📎 PDF вложение добавлено: ${pdfPath}`);
                } catch (pdfError) {
                    console.error('❌ Ошибка при чтении PDF файла:', pdfError);
                    // Продолжаем отправку без PDF
                }
            }

            // Настройки письма
            const mailOptions = {
                to: recipientEmail,
                from: {
                    email: this.fromEmail,
                    name: this.fromName
                },
                subject: `🎁 Ваш подарочный сертификат №${certificateCode} - Горностайл72`,
                html: htmlContent,
                attachments: attachments
            };

            console.log(`📧 Отправка email через SendGrid на ${recipientEmail}...`);
            
            // Отправляем письмо через SendGrid
            const response = await sgMail.send(mailOptions);
            
            console.log(`✅ Email с сертификатом отправлен успешно через SendGrid: ${response[0].headers['x-message-id']}`);
            
            return { 
                success: true, 
                messageId: response[0].headers['x-message-id'],
                service: 'sendgrid'
            };

        } catch (error) {
            console.error(`❌ Ошибка при отправке email через SendGrid на ${recipientEmail}:`, error.message);
            console.error('Код ошибки:', error.code);
            
            return { 
                success: false, 
                error: error.message,
                code: error.code,
                service: 'sendgrid'
            };
        }
    }

    generateCertificateEmailHTML(certificateData) {
        const { 
            certificateCode, 
            amount, 
            recipientName, 
            message, 
            expiry_date,
            designImageUrl 
        } = certificateData;

        // Безопасное форматирование даты
        let formattedExpiryDate = 'Дата не указана';
        try {
            const d = new Date(expiry_date);
            if (!isNaN(d.getTime())) {
                formattedExpiryDate = d.toLocaleDateString('ru-RU');
            }
        } catch (e) {}

        return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Подарочный сертификат №${certificateCode}</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: #333;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                .header {
                    background: white;
                    border-radius: 15px;
                    padding: 30px;
                    text-align: center;
                    margin-bottom: 20px;
                    border-bottom: 3px solid #3498db;
                }
                .certificate {
                    background: ${designImageUrl ? `url('${process.env.BASE_URL || 'https://gornostyle72.ru'}${designImageUrl}')` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
                    background-size: cover;
                    background-position: center;
                    border-radius: 20px;
                    padding: 40px;
                    color: white;
                    text-align: center;
                    position: relative;
                    margin-bottom: 30px;
                }
                .certificate::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.4);
                    border-radius: 20px;
                }
                .certificate-content {
                    position: relative;
                    z-index: 2;
                }
                .info-block {
                    background: white;
                    border-radius: 15px;
                    padding: 30px;
                    margin-bottom: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Заголовок -->
                <div class="header">
                    <h1 style="margin: 0; font-size: 2rem; color: #2c3e50;">🎿 Горностайл72</h1>
                    <p style="margin: 10px 0 0 0; color: #7f8c8d; font-size: 1.1rem;">Горнолыжный тренажерный комплекс</p>
                </div>

                <!-- Сертификат -->
                <div class="certificate">
                    <div class="certificate-content">
                        <h2 style="margin: 0 0 20px 0; font-size: 1.4rem; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
                            🎁 СЕРТИФИКАТ<br>НА ТРЕНИРОВКУ ПО ГОРНЫМ ЛЫЖАМ ИЛИ СНОУБОРДУ
                        </h2>
                        
                        <div style="font-size: 1.8rem; font-weight: bold; color: #FFD700; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); margin: 20px 0; letter-spacing: 0.1em;">
                            № ${certificateCode}
                        </div>
                        
                        <div style="font-size: 2.2rem; font-weight: bold; color: #FFD700; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); margin: 20px 0;">
                            💰 ${amount} руб.
                        </div>
                        
                        ${recipientName ? `
                        <div style="margin: 20px 0; font-size: 1.1rem;">
                            <strong>👤 Кому:</strong><br>${recipientName}
                        </div>
                        ` : ''}
                        
                        ${message ? `
                        <div style="margin: 20px 0; font-size: 1rem; font-style: italic;">
                            "${message}"
                        </div>
                        ` : ''}
                        
                        <div style="margin-top: 30px; font-size: 0.9rem; opacity: 0.9;">
                            ⏰ Использовать до: ${formattedExpiryDate}
                        </div>
                    </div>
                </div>

                <!-- Инструкции -->
                <div class="info-block">
                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">📋 Как использовать сертификат:</h3>
                    <ol style="margin: 0; padding-left: 20px; color: #333;">
                        <li style="margin-bottom: 8px;">Получите сертификат - после покупки вы получили красивый сертификат с уникальным номером</li>
                        <li style="margin-bottom: 8px;">Подарите или распечатайте - можете распечатать сертификат или отправить получателю цифровую версию</li>
                        <li style="margin-bottom: 8px;">Активируйте в боте - получатель активирует сертификат через наш Telegram бот @gornostyle72_bot</li>
                        <li style="margin-bottom: 8px;">Записывайтесь на тренировки - выбирайте удобное время и записывайтесь на индивидуальные или групповые тренировки</li>
                    </ol>
                </div>

                <!-- Контакты -->
                <div class="info-block">
                    <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 1.2rem;">📞 Контакты для записи:</h3>
                    <p style="margin: 5px 0; color: #333;"><strong>Телефон:</strong> +7 (912) 392-49-56</p>
                    <p style="margin: 5px 0; color: #333;"><strong>Telegram:</strong> @gornostyle72_bot</p>
                    <p style="margin: 5px 0; color: #333;"><strong>Адрес:</strong> г. Тюмень, с. Яр, ул. Источник, 2А</p>
                </div>

                <!-- Кнопка действия -->
                <div style="text-align: center; margin-bottom: 20px;">
                    <a href="https://t.me/gornostyle72_bot" style="display: inline-block; background: #3498db; color: white; padding: 15px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; font-size: 1.1rem;">
                        📱 Записаться на тренировку
                    </a>
                </div>

                <!-- Подвал -->
                <div class="info-block" style="text-align: center; border-top: 1px solid #e9ecef;">
                    <p style="margin: 0 0 10px 0; color: #7f8c8d; font-size: 1.1rem;">Спасибо за выбор Горностайл72! 🎿</p>
                    <p style="margin: 0; color: #7f8c8d; font-size: 0.9rem;">
                        Это письмо отправлено автоматически. По всем вопросам обращайтесь по указанным выше контактам.
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}

module.exports = SendGridEmailService;
