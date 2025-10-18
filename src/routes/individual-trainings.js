const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const TelegramBot = require('node-telegram-bot-api');
const { notifyAdminIndividualTrainingDeleted } = require('../bot/admin-notify');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

/**
 * GET /api/individual-trainings/:id
 * Получение деталей индивидуальной тренировки с информацией об участнике
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Получаем основную информацию об индивидуальной тренировке
        const trainingQuery = `
            SELECT 
                its.id,
                its.client_id,
                its.child_id,
                its.equipment_type,
                its.with_trainer,
                its.duration,
                its.preferred_date,
                its.preferred_time,
                (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                its.simulator_id,
                its.price,
                its.created_at,
                s.name as simulator_name,
                c.full_name as client_name,
                c.phone as client_phone,
                c.birth_date as client_birth_date,
                c.telegram_id as client_telegram_id,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                ch.sport_type as child_sport_type,
                ch.skill_level as child_skill_level,
                parent.full_name as parent_name,
                parent.phone as parent_phone
            FROM individual_training_sessions its
            LEFT JOIN simulators s ON its.simulator_id = s.id
            LEFT JOIN clients c ON its.client_id = c.id
            LEFT JOIN children ch ON its.child_id = ch.id
            LEFT JOIN clients parent ON ch.parent_id = parent.id
            WHERE its.id = $1
        `;
        
        const result = await pool.query(trainingQuery, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Индивидуальная тренировка не найдена' });
        }
        
        const training = result.rows[0];
        
        // Формируем данные участника
        const participant = {
            is_child: !!training.child_id,
            full_name: training.child_id ? training.child_name : training.client_name,
            birth_date: training.child_id ? training.child_birth_date : training.client_birth_date,
            phone: training.child_id ? training.parent_phone : training.client_phone,
            skill_level: training.child_id ? training.child_skill_level : null,
            sport_type: training.child_id ? training.child_sport_type : null,
            parent_name: training.child_id ? training.parent_name : null,
            parent_phone: training.child_id ? training.parent_phone : null
        };
        
        // Формируем ответ
        const response = {
            id: training.id,
            client_id: training.client_id,
            child_id: training.child_id,
            equipment_type: training.equipment_type,
            with_trainer: training.with_trainer,
            duration: training.duration,
            preferred_date: training.preferred_date,
            start_time: training.preferred_time,
            end_time: training.end_time,
            simulator_id: training.simulator_id,
            simulator_name: training.simulator_name,
            price: training.price,
            created_at: training.created_at,
            participant: participant,
            is_individual: true
        };
        
        res.json(response);
    } catch (error) {
        console.error('Ошибка при получении деталей индивидуальной тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

/**
 * DELETE /api/individual-trainings/:id
 * Удаление индивидуальной тренировки с возвратом средств и отправкой уведомлений
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем информацию о тренировке
        const trainingResult = await client.query(`
            SELECT 
                its.id,
                its.client_id,
                its.child_id,
                its.equipment_type,
                its.with_trainer,
                its.duration,
                its.preferred_date,
                its.preferred_time,
                its.simulator_id,
                its.price,
                s.name as simulator_name,
                c.full_name as client_name,
                c.phone as client_phone,
                c.birth_date as client_birth_date,
                c.telegram_id as client_telegram_id,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                parent.full_name as parent_name,
                parent.phone as parent_phone,
                parent.telegram_id as parent_telegram_id
            FROM individual_training_sessions its
            LEFT JOIN simulators s ON its.simulator_id = s.id
            LEFT JOIN clients c ON its.client_id = c.id
            LEFT JOIN children ch ON its.child_id = ch.id
            LEFT JOIN clients parent ON ch.parent_id = parent.id
            WHERE its.id = $1
        `, [id]);
        
        if (trainingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Индивидуальная тренировка не найдена' });
        }
        
        const training = trainingResult.rows[0];
        const price = Number(training.price);
        
        console.log('Данные тренировки из БД:', {
            client_name: training.client_name,
            client_birth_date: training.client_birth_date,
            child_id: training.child_id,
            child_name: training.child_name,
            child_birth_date: training.child_birth_date
        });
        
        // Получаем кошелек клиента
        const walletResult = await client.query(
            'SELECT id, balance, wallet_number FROM wallets WHERE client_id = $1',
            [training.client_id]
        );
        
        if (walletResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Кошелек клиента не найден' });
        }
        
        const wallet = walletResult.rows[0];
        
        // Возвращаем деньги на кошелек
        const newBalance = Number(wallet.balance) + price;
        await client.query(
            'UPDATE wallets SET balance = $1, last_updated = NOW() WHERE id = $2',
            [newBalance, wallet.id]
        );
        
        // Формируем описание транзакции
        const dateObj = new Date(training.preferred_date);
        const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
        const startTime = training.preferred_time ? training.preferred_time.slice(0, 5) : '';
        const participantName = training.child_id ? training.child_name : training.client_name;
        
        // Создаем транзакцию возврата
        await client.query(
            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
            [
                wallet.id,
                price,
                'amount',
                `Возврат: Индивидуальная, ${participantName}, Дата: ${formattedDate}, Время: ${startTime}, Длительность: ${training.duration} мин.`
            ]
        );
        
        // Освобождаем слоты в расписании
        await client.query(
            `UPDATE schedule 
             SET is_booked = false 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < ($3 + ($4 || ' minutes')::interval)`,
            [training.simulator_id, training.preferred_date, training.preferred_time, training.duration]
        );
        
        // Удаляем тренировку (это также сработает через триггер, но мы уже освободили слоты выше)
        await client.query('DELETE FROM individual_training_sessions WHERE id = $1', [id]);
        
        await client.query('COMMIT');
        
        // Формируем сообщения для уведомлений
        const equipmentName = training.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд';
        const trainerText = training.with_trainer ? 'с тренером' : 'без тренера';
        
        // Отправляем уведомление клиенту
        const clientTelegramId = training.child_id ? training.parent_telegram_id : training.client_telegram_id;
        if (clientTelegramId) {
            try {
                const clientMessage = `⚠️ *Отмена индивидуальной тренировки*\n\n` +
                    `Администратор отменил вашу индивидуальную тренировку:\n\n` +
                    `👤 Участник: ${participantName}\n` +
                    `📅 Дата: ${formattedDate}\n` +
                    `⏰ Время: ${startTime}\n` +
                    `⏱ Длительность: ${training.duration} мин\n` +
                    `🎿 Тип: ${equipmentName} ${trainerText}\n` +
                    `🏔 Тренажер: ${training.simulator_name}\n\n` +
                    `💰 Возвращено на счет: ${price} ₽\n` +
                    `💳 Текущий баланс: ${newBalance} ₽\n\n` +
                    `По вопросам обращайтесь к администратору.`;
                
                await bot.sendMessage(clientTelegramId, clientMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Ошибка при отправке уведомления клиенту:', error);
            }
        }
        
        // Отправляем уведомление администраторам через централизованную функцию
        const participantBirthDate = training.child_id ? training.child_birth_date : training.client_birth_date;
        
        // Вычисляем возраст так же, как в модальном окне
        let participantAge = null;
        if (participantBirthDate) {
            const birthDate = new Date(participantBirthDate);
            participantAge = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
        }
        
        console.log('Данные для уведомления администратору:', {
            participantBirthDate,
            participantAge,
            participantName,
            is_child: !!training.child_id,
            parent_name: training.parent_name
        });
        
        await notifyAdminIndividualTrainingDeleted({
            client_name: training.client_name,
            client_phone: training.client_phone,
            participant_name: participantName,
            participant_age: participantAge,
            date: training.preferred_date,
            time: startTime,
            duration: training.duration,
            equipment_type: training.equipment_type,
            with_trainer: training.with_trainer,
            simulator_name: training.simulator_name,
            price: price,
            refund_amount: price,
            new_balance: newBalance,
            is_child: !!training.child_id,
            parent_name: training.parent_name
        });
        
        res.json({
            success: true,
            message: 'Индивидуальная тренировка успешно удалена',
            refund: {
                amount: price,
                client_name: training.client_name,
                new_balance: newBalance
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении индивидуальной тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

module.exports = router;

