/**
 * Сервис для отправки отложенных сообщений
 */

const { pool } = require('../db/index');
const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

/**
 * Отправляет отложенные сообщения, время которых наступило
 */
async function sendScheduledMessages() {
    try {
        // Получаем все сообщения, которые нужно отправить
        const result = await pool.query(
            `SELECT * FROM scheduled_messages 
            WHERE status = 'pending' 
            AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC`
        );

        const messages = result.rows;
        
        if (messages.length === 0) {
            return { sent: 0, errors: 0 };
        }

        let sent = 0;
        let errors = 0;
        const errorsList = [];

        for (const msg of messages) {
            try {
                // СНАЧАЛА отправляем сообщение, ПОТОМ обновляем статус
                if (msg.recipient_type === 'all') {
                    // Отправляем всем клиентам
                    await sendToAllClients(msg);
                } else if (msg.recipient_type === 'client') {
                    // Отправляем конкретному клиенту
                    await sendToClient(msg);
                }

                // Только после успешной отправки обновляем статус на "отправлено"
                await pool.query(
                    'UPDATE scheduled_messages SET status = $1, sent_at = NOW() WHERE id = $2',
                    ['sent', msg.id]
                );

                sent++;
            } catch (error) {
                console.error(`Ошибка отправки отложенного сообщения ID ${msg.id}:`, error);
                errors++;
                errorsList.push({ id: msg.id, error: error.message });
                
                // Оставляем статус pending для повторной попытки (он уже должен быть pending)
                // Не нужно обновлять статус, так как мы не обновляли его до отправки
            } finally {
                // Удаляем медиа файл после отправки (даже если была ошибка)
                if (msg.media_file_path && fs.existsSync(msg.media_file_path)) {
                    try {
                        fs.unlinkSync(msg.media_file_path);
                    } catch (unlinkError) {
                        console.error(`Ошибка удаления файла ${msg.media_file_path}:`, unlinkError);
                    }
                }
            }
        }

        // Уведомляем администратора о результатах
        if (messages.length > 0 && ADMIN_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
            let adminText = `📨 <b>Отправка отложенных сообщений завершена</b>\n\n✅ Отправлено: ${sent}\n❌ Ошибок: ${errors}`;
            
            if (errorsList.length > 0) {
                const errorsText = errorsList.map(e => `ID ${e.id}: ${e.error}`).join('\n');
                adminText += `\n\n<b>Ошибки:</b>\n${errorsText}`;
            }
            
            await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: ADMIN_TELEGRAM_ID, 
                    text: adminText,
                    parse_mode: 'HTML'
                })
            });
        }

        return { sent, errors };
    } catch (error) {
        console.error('Ошибка при отправке отложенных сообщений:', error);
        throw error;
    }
}

/**
 * Отправляет сообщение всем клиентам
 */
async function sendToAllClients(msg) {
    const result = await pool.query(
        'SELECT telegram_id FROM clients WHERE telegram_id IS NOT NULL'
    );
    const clients = result.rows;

    if (clients.length === 0) {
        return;
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
        try {
            if (msg.media_file_path && fs.existsSync(msg.media_file_path)) {
                // Отправляем с медиа
                const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
                const messageLength = msg.message ? msg.message.length : 0;
                
                // Если текст превышает лимит для caption, отправляем медиа без caption, затем текст отдельным сообщением
                if (messageLength > TELEGRAM_CAPTION_MAX_LENGTH) {
                    // Шаг 1: Отправляем медиа БЕЗ caption
                    const form = new FormData();
                    form.append('chat_id', client.telegram_id);
                    // НЕ добавляем caption, если текст слишком длинный
                    
                    const isVideo = msg.media_type === 'video';
                    const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
                    const fieldName = isVideo ? 'video' : 'photo';
                    
                    form.append(fieldName, fs.createReadStream(msg.media_file_path));

                    const response = await fetch(
                        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
                        { method: 'POST', body: form }
                    );

                    const responseData = await response.json();
                    if (!response.ok || !responseData.ok) {
                        throw new Error(`Ошибка отправки медиа: ${responseData.description || 'Ошибка отправки'}`);
                    }
                    
                    // Шаг 2: Отправляем полный текст отдельным сообщением
                    const textResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            chat_id: client.telegram_id, 
                            text: msg.message,
                            parse_mode: msg.parse_mode || 'HTML'
                        })
                    });
                    
                    const textResponseData = await textResponse.json();
                    if (!textResponse.ok || !textResponseData.ok) {
                        throw new Error(`Ошибка отправки текста: ${textResponseData.description || 'Ошибка отправки'}`);
                    }
                } else {
                    // Текст <= 1024 символов или пустой - отправляем как обычно
                    const form = new FormData();
                    form.append('chat_id', client.telegram_id);
                    
                    // Добавляем caption только если есть текст
                    if (msg.message && msg.message.trim()) {
                        form.append('caption', msg.message);
                        form.append('parse_mode', msg.parse_mode || 'HTML');
                    }
                    
                    const isVideo = msg.media_type === 'video';
                    const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
                    const fieldName = isVideo ? 'video' : 'photo';
                    
                    form.append(fieldName, fs.createReadStream(msg.media_file_path));

                    const response = await fetch(
                        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
                        { method: 'POST', body: form }
                    );

                    const responseData = await response.json();
                    if (!response.ok || !responseData.ok) {
                        throw new Error(responseData.description || 'Ошибка отправки');
                    }
                }
            } else {
                // Отправляем только текст
                const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        chat_id: client.telegram_id, 
                        text: msg.message,
                        parse_mode: msg.parse_mode || 'HTML'
                    })
                });
                
                const responseData = await response.json();
                if (!response.ok || !responseData.ok) {
                    throw new Error(responseData.description || 'Ошибка отправки');
                }
            }
            sent++;
        } catch (error) {
            console.error(`Ошибка отправки клиенту ${client.telegram_id}:`, error);
            errors++;
        }
    }

    console.log(`Отложенное сообщение ID ${msg.id} отправлено: ${sent} клиентам, ${errors} ошибок`);
}

/**
 * Отправляет сообщение конкретному клиенту
 */
async function sendToClient(msg) {
    const result = await pool.query(
        'SELECT telegram_id FROM clients WHERE id = $1',
        [msg.recipient_id]
    );

    if (result.rows.length === 0 || !result.rows[0].telegram_id) {
        throw new Error('Клиент не найден или не указан Telegram ID');
    }

    const client = result.rows[0];

    if (msg.media_file_path && fs.existsSync(msg.media_file_path)) {
        // Отправляем с медиа
        const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
        const messageLength = msg.message ? msg.message.length : 0;
        
        // Если текст превышает лимит для caption, отправляем медиа без caption, затем текст отдельным сообщением
        if (messageLength > TELEGRAM_CAPTION_MAX_LENGTH) {
            // Шаг 1: Отправляем медиа БЕЗ caption
            const form = new FormData();
            form.append('chat_id', client.telegram_id);
            // НЕ добавляем caption, если текст слишком длинный
            
            const isVideo = msg.media_type === 'video';
            const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
            const fieldName = isVideo ? 'video' : 'photo';
            
            form.append(fieldName, fs.createReadStream(msg.media_file_path));

            const response = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
                { method: 'POST', body: form }
            );

            const responseData = await response.json();
            if (!response.ok || !responseData.ok) {
                throw new Error(`Ошибка отправки медиа: ${responseData.description || 'Ошибка отправки'}`);
            }
            
            // Шаг 2: Отправляем полный текст отдельным сообщением
            const textResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: client.telegram_id, 
                    text: msg.message,
                    parse_mode: msg.parse_mode || 'HTML'
                })
            });
            
            const textResponseData = await textResponse.json();
            if (!textResponse.ok || !textResponseData.ok) {
                throw new Error(`Ошибка отправки текста: ${textResponseData.description || 'Ошибка отправки'}`);
            }
        } else {
            // Текст <= 1024 символов или пустой - отправляем как обычно
            const form = new FormData();
            form.append('chat_id', client.telegram_id);
            
            // Добавляем caption только если есть текст
            if (msg.message && msg.message.trim()) {
                form.append('caption', msg.message);
                form.append('parse_mode', msg.parse_mode || 'HTML');
            }
            
            const isVideo = msg.media_type === 'video';
            const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
            const fieldName = isVideo ? 'video' : 'photo';
            
            form.append(fieldName, fs.createReadStream(msg.media_file_path));

            const response = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
                { method: 'POST', body: form }
            );

            const responseData = await response.json();
            if (!response.ok || !responseData.ok) {
                throw new Error(responseData.description || 'Ошибка отправки');
            }
        }
    } else {
        // Отправляем только текст
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chat_id: client.telegram_id, 
                text: msg.message,
                parse_mode: msg.parse_mode || 'HTML'
            })
        });
        
        const responseData = await response.json();
        if (!response.ok || !responseData.ok) {
            throw new Error(responseData.description || 'Ошибка отправки');
        }
    }

    console.log(`Отложенное сообщение ID ${msg.id} отправлено клиенту ${client.telegram_id}`);
}

module.exports = {
    sendScheduledMessages
};

