const { pool } = require('../db');
const EmailService = require('./emailService');

class EmailQueueProcessor {
    constructor() {
        this.emailService = new EmailService();
        this.isProcessing = false;
        this.processingInterval = null;
        this.intervalMs = 10000; // Проверяем очередь каждые 10 секунд
    }

    /**
     * Запуск обработчика очереди email
     */
    start() {
        if (this.processingInterval) {
            console.log('📧 Email queue processor уже запущен');
            return;
        }

        console.log('🚀 Запуск Email Queue Processor...');
        this.processingInterval = setInterval(() => {
            this.processQueue().catch(error => {
                console.error('❌ Ошибка в Email Queue Processor:', error);
            });
        }, this.intervalMs);

        // Обрабатываем очередь сразу при запуске
        this.processQueue().catch(error => {
            console.error('❌ Ошибка при начальной обработке очереди:', error);
        });

        console.log(`✅ Email Queue Processor запущен (интервал: ${this.intervalMs}ms)`);
    }

    /**
     * Остановка обработчика очереди
     */
    stop() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
            console.log('🛑 Email Queue Processor остановлен');
        }
    }

    /**
     * Обработка очереди email
     */
    async processQueue() {
        if (this.isProcessing) {
            return; // Избегаем параллельной обработки
        }

        this.isProcessing = true;
        
        try {
            // Получаем до 5 email из очереди
            const result = await pool.query('SELECT * FROM get_pending_emails(5)');
            const pendingEmails = result.rows;

            if (pendingEmails.length === 0) {
                return; // Нет email для обработки
            }

            console.log(`📧 Обрабатываем ${pendingEmails.length} email из очереди...`);

            // Обрабатываем каждый email
            for (const emailTask of pendingEmails) {
                await this.processEmail(emailTask);
            }

        } catch (error) {
            console.error('❌ Ошибка при обработке очереди email:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Обработка одного email
     */
    async processEmail(emailTask) {
        const { id, certificate_id, recipient_email, certificate_data, attempts } = emailTask;
        
        console.log(`📧 Обрабатываем email #${id} для сертификата ${certificate_data.certificateCode} → ${recipient_email} (попытка ${attempts + 1})`);

        try {
            // Генерируем PDF и изображение, если они еще не созданы
            let updatedCertificateData = { ...certificate_data };
            
            if (!certificate_data.pdfUrl || !certificate_data.imageUrl) {
                console.log(`📄 Генерируем файлы для сертификата ${certificate_data.certificateCode}...`);
                
                try {
                    const certificatePdfGenerator = require('../services/certificatePdfGenerator');
                    const certificateImageGenerator = require('../services/certificateImageGenerator');
                    
                    // Получаем данные сертификата из базы
                    const certResult = await pool.query(
                        'SELECT * FROM certificates WHERE id = $1',
                        [certificate_id]
                    );
                    
                    if (certResult.rows.length > 0) {
                        const cert = certResult.rows[0];
                        const certificateFileData = {
                            certificate_number: cert.certificate_number,
                            nominal_value: cert.nominal_value,
                            recipient_name: cert.recipient_name,
                            message: cert.message,
                            expiry_date: cert.expiry_date,
                            design_id: cert.design_id
                        };
                        
                        // Генерируем PDF
                        let pdfUrl = certificate_data.pdfUrl;
                        if (!pdfUrl) {
                            try {
                                pdfUrl = await certificatePdfGenerator.generateCertificatePdf(certificateFileData);
                                console.log(`✅ PDF создан: ${pdfUrl}`);
                            } catch (pdfError) {
                                console.error('❌ Ошибка при генерации PDF:', pdfError);
                            }
                        }
                        
                        // Генерируем изображение
                        let imageUrl = certificate_data.imageUrl;
                        if (!imageUrl) {
                            try {
                                imageUrl = await certificateImageGenerator.generateCertificateImage(certificateFileData);
                                console.log(`✅ Изображение создано: ${imageUrl}`);
                            } catch (imageError) {
                                console.error('❌ Ошибка при генерации изображения:', imageError);
                            }
                        }
                        
                        // Обновляем данные в базе
                        if (pdfUrl || imageUrl) {
                            await pool.query(
                                'UPDATE certificates SET pdf_url = COALESCE($1, pdf_url), image_url = COALESCE($2, image_url) WHERE id = $3',
                                [pdfUrl, imageUrl, certificate_id]
                            );
                            
                            // Обновляем данные для email
                            updatedCertificateData.pdfUrl = pdfUrl;
                            updatedCertificateData.imageUrl = imageUrl;
                        }
                    }
                } catch (fileGenError) {
                    console.error(`❌ Ошибка при генерации файлов для сертификата ${certificate_data.certificateCode}:`, fileGenError);
                }
            }

            // Отправляем email
            const result = await this.emailService.sendCertificateEmail(recipient_email, updatedCertificateData);
            
            if (result.success) {
                // Помечаем как отправленный
                await pool.query('SELECT update_email_status($1, $2, $3)', [id, 'sent', null]);
                console.log(`✅ Email #${id} успешно отправлен на ${recipient_email}`);
            } else {
                // Помечаем как неудачный
                await pool.query('SELECT update_email_status($1, $2, $3)', [id, 'failed', result.error || 'Unknown error']);
                console.log(`❌ Email #${id} не отправлен: ${result.error}`);
            }

        } catch (error) {
            console.error(`❌ Ошибка при отправке email #${id}:`, error.message);
            
            // Определяем, нужно ли повторить попытку
            const shouldRetry = attempts < 2; // Максимум 3 попытки (0, 1, 2)
            const newStatus = shouldRetry ? 'pending' : 'failed';
            
            await pool.query('SELECT update_email_status($1, $2, $3)', [
                id, 
                newStatus, 
                error.message
            ]);

            if (shouldRetry) {
                console.log(`🔄 Email #${id} будет повторно обработан (попытка ${attempts + 2}/3)`);
            } else {
                console.log(`💀 Email #${id} окончательно провалился после 3 попыток`);
            }
        }
    }

    /**
     * Получение статистики очереди
     */
    async getQueueStats() {
        try {
            const result = await pool.query(`
                SELECT 
                    status,
                    COUNT(*) as count
                FROM email_queue 
                GROUP BY status
                ORDER BY status
            `);

            const stats = {};
            result.rows.forEach(row => {
                stats[row.status] = parseInt(row.count);
            });

            return stats;
        } catch (error) {
            console.error('Ошибка при получении статистики очереди:', error);
            return {};
        }
    }

    /**
     * Принудительная обработка конкретного email
     */
    async processEmailById(emailId) {
        try {
            const result = await pool.query(`
                SELECT id, certificate_id, recipient_email, certificate_data, attempts 
                FROM email_queue 
                WHERE id = $1 AND status IN ('pending', 'failed')
            `, [emailId]);

            if (result.rows.length === 0) {
                throw new Error(`Email с ID ${emailId} не найден или уже обработан`);
            }

            await this.processEmail(result.rows[0]);
            return true;
        } catch (error) {
            console.error(`Ошибка при принудительной обработке email ${emailId}:`, error);
            throw error;
        }
    }

    /**
     * Очистка старых записей
     */
    async cleanupOldEmails(daysOld = 30) {
        try {
            const result = await pool.query('SELECT cleanup_old_emails($1)', [daysOld]);
            const deletedCount = result.rows[0].cleanup_old_emails;
            console.log(`🧹 Удалено ${deletedCount} старых записей из очереди email`);
            return deletedCount;
        } catch (error) {
            console.error('Ошибка при очистке старых email:', error);
            throw error;
        }
    }
}

module.exports = EmailQueueProcessor;
