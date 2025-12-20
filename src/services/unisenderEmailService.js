const https = require('https');
const fs = require('fs').promises;
const path = require('path');

/**
 * Сервис для отправки email через Unisender API
 * Работает через HTTPS (порт 443), не требует SMTP портов
 */
class UnisenderEmailService {
    constructor() {
        // Инициализация Unisender с API ключом из переменных окружения
        const apiKey = process.env.UNISENDER_API_KEY;
        
        if (!apiKey) {
            console.warn('⚠️  UNISENDER_API_KEY не настроен в переменных окружения. Unisender не будет работать.');
            this.apiKey = null;
        } else {
            this.apiKey = apiKey;
            console.log('✅ Unisender инициализирован');
        }
        
        this.fromEmail = process.env.UNISENDER_FROM_EMAIL || process.env.EMAIL_USER || 'batl-zlat@yandex.ru';
        this.fromName = process.env.UNISENDER_FROM_NAME || 'Горностайл72';
        this.apiUrl = 'https://api.unisender.com/ru/api';
    }

    /**
     * Отправка email через Unisender API
     * @param {string} recipientEmail - Email получателя
     * @param {string} subject - Тема письма
     * @param {string} htmlContent - HTML содержимое письма
     * @param {Array} attachments - Массив вложений (опционально)
     * @returns {Promise<Object>} Результат отправки
     */
    async sendEmail(recipientEmail, subject, htmlContent, attachments = []) {
        try {
            if (!this.apiKey) {
                return { success: false, error: 'Unisender не инициализирован (отсутствует API ключ)' };
            }

            console.log(`📧 Попытка отправки email через Unisender API на ${recipientEmail}...`);

            // Подготавливаем данные для API Unisender
            // Формат: https://www.unisender.com/ru/support/api/messages/sendemail/
            const emailData = {
                api_key: this.apiKey,
                email: recipientEmail,
                sender_name: this.fromName,
                sender_email: this.fromEmail,
                subject: subject,
                body: htmlContent,
                format: 'html'
                // list_id не требуется для транзакционных писем
            };

            // Если есть вложения, конвертируем их в base64
            if (attachments && attachments.length > 0) {
                console.log(`📎 Обнаружены вложения (${attachments.length}), обрабатываем...`);
                const emailAttachments = [];
                
                for (const attachment of attachments) {
                    try {
                        let fileContent;
                        if (attachment.path) {
                            fileContent = await fs.readFile(attachment.path);
                        } else if (attachment.content) {
                            fileContent = Buffer.from(attachment.content, 'base64');
                        } else {
                            continue;
                        }
                        
                        emailAttachments.push({
                            name: attachment.filename || 'attachment',
                            content: fileContent.toString('base64'),
                            type: attachment.contentType || 'application/octet-stream'
                        });
                    } catch (attachError) {
                        console.warn(`⚠️ Не удалось обработать вложение: ${attachError.message}`);
                    }
                }
                
                if (emailAttachments.length > 0) {
                    // Unisender API поддерживает вложения через параметр attachments
                    emailData.attachments = JSON.stringify(emailAttachments);
                }
            }

            // Отправляем запрос к Unisender API
            // Метод: sendEmail (для транзакционных писем)
            const result = await this.makeApiRequest('sendEmail', emailData);

            console.log('📋 Полный ответ Unisender:', JSON.stringify(result, null, 2));

            // Unisender возвращает {result: {email_id: "...", ...}, error: null} при успехе
            // или {error: "текст ошибки", result: null} при ошибке
            if (result.error) {
                const errorMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
                console.error(`❌ Unisender вернул ошибку: ${errorMsg}`);
                return { success: false, error: errorMsg };
            }

            if (result.result) {
                const emailId = result.result.email_id || result.result.job_id || result.result;
                console.log(`✅ Email отправлен успешно через Unisender, email_id: ${emailId}`);
                return { 
                    success: true, 
                    messageId: emailId, 
                    service: 'unisender',
                    result: result.result
                };
            } else {
                console.error(`❌ Unisender вернул некорректный ответ:`, result);
                return { success: false, error: 'Unisender вернул некорректный ответ (нет result и error)' };
            }

        } catch (error) {
            console.error(`❌ Ошибка при отправке email через Unisender:`, error.message);
            return { 
                success: false, 
                error: error.message,
                service: 'unisender'
            };
        }
    }

    /**
     * Отправка сертификата на email через Unisender
     * @param {string} recipientEmail - Email получателя
     * @param {Object} certificateData - Данные сертификата
     * @returns {Promise<Object>} Результат отправки
     */
    async sendCertificateEmail(recipientEmail, certificateData) {
        try {
            const { certificateCode, recipientName, amount, message, pdfUrl } = certificateData;

            // Генерируем HTML содержимое письма
            const htmlContent = this.generateCertificateEmailHTML(certificateData);

            // Подготавливаем вложения
            const attachments = [];
            
            // Пытаемся добавить PDF сертификата
            if (pdfUrl) {
                const pdfPath = path.join(__dirname, '../../public', pdfUrl);
                try {
                    await fs.access(pdfPath);
                    attachments.push({
                        filename: `Сертификат_${certificateCode}.pdf`,
                        path: pdfPath,
                        contentType: 'application/pdf'
                    });
                    console.log(`📎 PDF вложение добавлено: ${pdfPath}`);
                } catch (error) {
                    console.warn(`⚠️ PDF файл не найден: ${pdfPath}`);
                }
            }

            const subject = `🎁 Ваш подарочный сертификат Горностайл72 готов!`;
            
            return await this.sendEmail(recipientEmail, subject, htmlContent, attachments);

        } catch (error) {
            console.error(`❌ Ошибка при отправке сертификата через Unisender:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Выполнение запроса к Unisender API
     * @param {string} method - Метод API
     * @param {Object} params - Параметры запроса
     * @returns {Promise<Object>} Ответ API
     */
    async makeApiRequest(method, params) {
        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null) {
                    postData.append(key, value);
                }
            }

            const options = {
                hostname: 'api.unisender.com',
                port: 443,
                path: `/ru/api/${method}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData.toString())
                },
                timeout: 30000
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (error) {
                        reject(new Error(`Ошибка парсинга ответа Unisender: ${error.message}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Unisender API timeout'));
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData.toString());
            req.end();
        });
    }

    /**
     * Генерация HTML для письма с сертификатом
     * @param {Object} certificateData - Данные сертификата
     * @returns {string} HTML содержимое
     */
    generateCertificateEmailHTML(certificateData) {
        const { certificateCode, recipientName, amount, message, certificate_url } = certificateData;
        
        return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ваш подарочный сертификат</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f8f9fa; font-family: Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background: white; border-radius: 15px; overflow: hidden;">
        <tr>
            <td style="padding: 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                <h1 style="margin: 0; font-size: 1.8rem;">🎁 Ваш подарочный сертификат готов!</h1>
                <p style="margin: 10px 0 0 0; font-size: 1rem; opacity: 0.9;">Горностайл72</p>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 1.1rem;">
                    Здравствуйте${recipientName ? `, ${recipientName}` : ''}!
                </p>
                <p style="margin: 0 0 20px 0; color: #555; font-size: 1rem; line-height: 1.6;">
                    Ваш подарочный сертификат №<strong>${certificateCode}</strong> на сумму <strong>${amount} ₽</strong> готов!
                </p>
                ${message ? `<p style="margin: 0 0 20px 0; color: #555; font-size: 1rem; line-height: 1.6; font-style: italic;">"${message}"</p>` : ''}
                ${certificate_url ? `
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${certificate_url}" 
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; font-size: 1rem;">
                        📄 Открыть сертификат
                    </a>
                </div>
                ` : ''}
                <p style="margin: 20px 0 0 0; color: #555; font-size: 0.95rem; line-height: 1.6;">
                    Сертификат прикреплен к этому письму в формате PDF.
                </p>
            </td>
        </tr>
        <tr>
            <td style="padding: 20px 30px; text-align: center; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <p style="margin: 0 0 10px 0; color: #7f8c8d; font-size: 0.9rem;">
                    С уважением,<br>Команда Горностайл72 🎿
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
        `;
    }
}

module.exports = UnisenderEmailService;

