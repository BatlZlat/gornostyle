const { pool } = require('./src/db');

async function applySchemaUpdate() {
    console.log('=== Применение обновления триггера email ===');
    
    const client = await pool.connect();
    
    try {
        // Обновляем функцию триггера
        const updateFunctionSQL = `
            CREATE OR REPLACE FUNCTION queue_certificate_email()
            RETURNS TRIGGER AS $$
            DECLARE
                email_data jsonb;
                client_email VARCHAR(255);
            BEGIN
                -- Получаем email клиента
                SELECT c.email INTO client_email
                FROM clients c 
                WHERE c.id = NEW.purchaser_id AND c.email IS NOT NULL;
                
                -- Если email найден, добавляем в очередь
                IF client_email IS NOT NULL THEN
                    -- Формируем данные для email БЕЗ pdfUrl
                    -- emailQueueProcessor сам сгенерирует JPG
                    SELECT jsonb_build_object(
                        'certificateId', NEW.id,
                        'certificateCode', NEW.certificate_number,
                        'recipientEmail', client_email,
                        'recipientName', COALESCE(NEW.recipient_name, c.full_name),
                        'amount', NEW.nominal_value,
                        'message', NEW.message,
                        'pdfUrl', NULL, -- НЕ передаем pdfUrl, пусть emailQueueProcessor генерирует JPG
                        'imageUrl', NEW.image_url,
                        'designId', NEW.design_id,
                        'designName', cd.name,
                        'designImageUrl', cd.image_url
                    ) INTO email_data
                    FROM clients c 
                    LEFT JOIN certificate_designs cd ON NEW.design_id = cd.id
                    WHERE c.id = NEW.purchaser_id;
                    
                    -- Добавляем в очередь email
                    INSERT INTO email_queue (certificate_id, recipient_email, certificate_data)
                    VALUES (NEW.id, client_email, email_data);
                    
                    -- Логируем
                    RAISE NOTICE 'Email queued for certificate % to % (JPG will be generated)', NEW.certificate_number, client_email;
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `;
        
        console.log('🔄 Обновляем функцию триггера...');
        await client.query(updateFunctionSQL);
        
        console.log('✅ Функция триггера обновлена!');
        console.log('📧 Теперь триггер НЕ передает pdfUrl в email данные');
        console.log('🎯 emailQueueProcessor будет генерировать JPG для всех email');
        
    } catch (error) {
        console.error('❌ Ошибка при обновлении триггера:', error.message);
    } finally {
        client.release();
        process.exit(0);
    }
}

applySchemaUpdate().catch(console.error);

