const { Resend } = require('resend');
const fs = require('fs').promises;
const path = require('path');

class ResendEmailService {
    constructor() {
        // Инициализация Resend с API ключом из переменных окружения
        const apiKey = process.env.RESEND_API_KEY;
        
        if (!apiKey) {
            console.warn('⚠️  RESEND_API_KEY не настроен в переменных окружения. Resend не будет работать.');
            this.resend = null;
        } else {
            this.resend = new Resend(apiKey);
            console.log('✅ Resend инициализирован');
        }
        
        this.fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@example.com';
        this.fromName = process.env.RESEND_FROM_NAME || 'Горностайл72';
    }

    async sendCertificateEmail(recipientEmail, certificateData) {
        try {
            if (!this.resend) {
                console.warn(`⚠️  Не удалось отправить email на ${recipientEmail}: Resend не инициализирован`);
                return { success: false, error: 'Resend не инициализирован' };
            }

            const { certificateId, certificateCode, recipientName, amount, message, pdfUrl, designImageUrl, expiry_date } = certificateData;

            // Безопасное форматирование даты
            let formattedExpiryDate = 'Дата не указана';
            try {
                const d = new Date(expiry_date);
                if (!isNaN(d.getTime())) {
                    formattedExpiryDate = d.toLocaleDateString('ru-RU');
                }
            } catch (e) {
                console.error('Ошибка форматирования даты в Resend:', e);
            }

            // Генерируем HTML содержимое письма
            const htmlContent = this.generateCertificateEmailHTML(certificateData);

            // Подготавливаем данные для отправки
            const emailData = {
                from: `${this.fromName} <${this.fromEmail}>`,
                to: [recipientEmail],
                subject: `Ваш подарочный сертификат №${certificateCode} от Горностайл72`,
                html: htmlContent,
            };

            // Добавляем PDF сертификат как вложение
            if (pdfUrl) {
                try {
                    const pdfPath = pdfUrl.startsWith('/') 
                        ? `${__dirname}/../../public${pdfUrl}` 
                        : pdfUrl;
                    
                    console.log(`📎 Попытка прикрепить PDF: ${pdfPath}`);
                    const pdfBuffer = await fs.readFile(pdfPath);
                    
                    emailData.attachments = [{
                        filename: `Сертификат_${certificateCode}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }];
                    
                    console.log(`📎 PDF вложение добавлено: ${pdfPath}`);
                } catch (pdfError) {
                    console.error('❌ Ошибка при чтении PDF файла:', pdfError);
                    // Продолжаем отправку без PDF
                }
            }

            // Отправляем письмо через Resend
            console.log(`📧 Отправка email через Resend на ${recipientEmail}...`);
            const response = await this.resend.emails.send(emailData);
            
            // Проверяем статус ответа
            if (response.error) {
                console.error(`❌ Resend вернул ошибку: ${response.error.message}`);
                return { 
                    success: false, 
                    error: response.error.message || 'Ошибка Resend',
                    service: 'resend'
                };
            }
            
            console.log(`✅ Email с сертификатом отправлен успешно через Resend: ${response.data?.id}`);
            return { 
                success: true, 
                messageId: response.data?.id,
                service: 'resend'
            };

        } catch (error) {
            console.error('❌ Ошибка Resend при отправке email:', error);
            return { 
                success: false, 
                error: error.message || 'Ошибка Resend' 
            };
        }
    }

    generateCertificateEmailHTML(certificateData) {
        const { certificateCode, recipientName, amount, message, expiry_date } = certificateData;

        // Безопасное форматирование даты
        let formattedExpiryDate = 'Дата не указана';
        try {
            const d = new Date(expiry_date);
            if (!isNaN(d.getTime())) {
                formattedExpiryDate = d.toLocaleDateString('ru-RU');
            }
        } catch (e) {
            console.error('Ошибка форматирования даты в Resend HTML:', e);
        }

        return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ваш подарочный сертификат от Горностайл72</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; color: #333; }
                .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
                .header { background-color: #3498db; color: #ffffff; padding: 20px; text-align: center; }
                .header h1 { margin: 0; font-size: 24px; }
                .content { padding: 20px 30px; line-height: 1.6; }
                .content h2 { color: #2c3e50; font-size: 20px; margin-top: 0; }
                .button { display: inline-block; background-color: #3498db; color: #ffffff; padding: 10px 20px; border-radius: 5px; text-decoration: none; margin-top: 20px; }
                .footer { background-color: #ecf0f1; color: #7f8c8d; text-align: center; padding: 15px; font-size: 12px; }
                .certificate-details { background-color: #f9f9f9; border-left: 4px solid #3498db; padding: 15px; margin-top: 20px; }
                .certificate-details p { margin: 5px 0; }
                .highlight { font-weight: bold; color: #2c3e50; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Горностайл72</h1>
                </div>
                <div class="content">
                    <h2>🎉 Ваш подарочный сертификат!</h2>
                    <p>Здравствуйте!</p>
                    <p>Вы успешно приобрели подарочный сертификат от Горностайл72. Он прикреплен к этому письму в формате PDF.</p>
                    
                    <div class="certificate-details">
                        <p><span class="highlight">Номер сертификата:</span> ${certificateCode}</p>
                        <p><span class="highlight">Номинал:</span> ${amount} руб.</p>
                        ${recipientName ? `<p><span class="highlight">Получатель:</span> ${recipientName}</p>` : ''}
                        ${message ? `<p><span class="highlight">Сообщение:</span> "${message}"</p>` : ''}
                        <p><span class="highlight">Срок действия:</span> до ${formattedExpiryDate}</p>
                    </div>

                    <p>Вы можете распечатать его или переслать получателю. Для активации и записи на тренировки используйте наш Telegram бот: <a href="https://t.me/gornostyle72_bot">@gornostyle72_bot</a></p>
                    <p>Спасибо, что выбрали нас!</p>
                    <a href="https://t.me/gornostyle72_bot" class="button">Перейти в Telegram бот</a>
                </div>
                <div class="footer">
                    <p>Это письмо отправлено автоматически. Пожалуйста, не отвечайте на него.</p>
                    <p>&copy; 2025 Горностайл72. Все права защищены.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}

module.exports = ResendEmailService;
