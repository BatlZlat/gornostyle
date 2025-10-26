const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { 
    notifyClientAboutTrainerAssignment,
    notifyAdminAboutTrainerAssignment,
    notifyClientAboutTrainerChange,
    notifyAdminAboutTrainerChange,
    getTrainingAndClientData
} = require('../services/trainer-notification-service');
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
        // Сначала пытаемся найти в individual_training_sessions (тренажер)
        let trainingQuery = `
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
                its.trainer_id,
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
                parent.phone as parent_phone,
                t.full_name as trainer_name,
                t.phone as trainer_phone,
                t.sport_type as trainer_sport_type,
                'simulator' as slope_type
            FROM individual_training_sessions its
            LEFT JOIN simulators s ON its.simulator_id = s.id
            LEFT JOIN clients c ON its.client_id = c.id
            LEFT JOIN children ch ON its.child_id = ch.id
            LEFT JOIN clients parent ON ch.parent_id = parent.id
            LEFT JOIN trainers t ON its.trainer_id = t.id
            WHERE its.id = $1
        `;
        
        let result = await pool.query(trainingQuery, [id]);
        
        // Если не найдено в individual_training_sessions, ищем в training_sessions (естественный склон)
        if (result.rows.length === 0) {
            trainingQuery = `
                SELECT 
                    ts.id,
                    sp.client_id,
                    sp.child_id,
                    ts.equipment_type,
                    ts.with_trainer,
                    ts.duration,
                    ts.session_date as preferred_date,
                    ts.start_time as preferred_time,
                    ts.end_time,
                    ts.simulator_id,
                    ts.trainer_id,
                    ts.price,
                    ts.created_at,
                    NULL as simulator_name,
                    c.full_name as client_name,
                    c.phone as client_phone,
                    c.birth_date as client_birth_date,
                    c.telegram_id as client_telegram_id,
                    ch.full_name as child_name,
                    ch.birth_date as child_birth_date,
                    ch.sport_type as child_sport_type,
                    ch.skill_level as child_skill_level,
                    parent.full_name as parent_name,
                    parent.phone as parent_phone,
                    t.full_name as trainer_name,
                    t.phone as trainer_phone,
                    t.sport_type as trainer_sport_type,
                    'natural_slope' as slope_type
                FROM training_sessions ts
                LEFT JOIN session_participants sp ON ts.id = sp.session_id
                LEFT JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                LEFT JOIN clients parent ON ch.parent_id = parent.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                WHERE ts.id = $1
                AND ts.training_type = FALSE
                AND ts.slope_type = 'natural_slope'
                AND ts.status = 'scheduled'
                AND sp.status = 'confirmed'
            `;
            
            result = await pool.query(trainingQuery, [id]);
        }
        
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
            trainer_id: training.trainer_id,
            trainer_name: training.trainer_name,
            trainer_phone: training.trainer_phone,
            trainer_sport_type: training.trainer_sport_type,
            price: training.price,
            created_at: training.created_at,
            participant: participant,
            is_individual: true,
            slope_type: training.slope_type
        };
        
        res.json(response);
    } catch (error) {
        console.error('Ошибка при получении деталей индивидуальной тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

/**
 * GET /api/individual-trainings/trainers/available
 * Получение списка доступных тренеров с фильтрацией по специализации
 */
router.get('/trainers/available', async (req, res) => {
    try {
        const { equipment_type } = req.query;
        
        // Определяем фильтр по спорту
        // equipment_type: 'ski' (лыжи) или 'snowboard' (сноуборд)
        const sportType = equipment_type === 'ski' ? 'ski' : 'snowboard';
        
        // Получаем тренеров, которые специализируются на этом виде спорта или на обоих
        const trainers = await pool.query(`
            SELECT id, full_name, phone, sport_type
            FROM trainers
            WHERE is_active = TRUE
            AND (sport_type = $1 OR sport_type = 'both')
            ORDER BY full_name
        `, [sportType]);
        
        res.json(trainers.rows);
    } catch (error) {
        console.error('Ошибка при загрузке доступных тренеров:', error);
        res.status(500).json({ error: 'Ошибка при загрузке тренеров' });
    }
});

/**
 * PUT /api/individual-trainings/:id/assign-trainer
 * Назначение тренера на индивидуальную тренировку
 */
router.put('/:id/assign-trainer', async (req, res) => {
    const dbClient = await pool.connect();
    try {
        const { id } = req.params;
        const { trainer_id } = req.body;
        
        await dbClient.query('BEGIN');
        
        // 1. Проверяем существование тренировки (сначала в individual_training_sessions)
        let trainingResult = await dbClient.query(
            'SELECT * FROM individual_training_sessions WHERE id = $1',
            [id]
        );
        
        let training = null;
        let isNaturalSlope = false;
        
        // Если не найдено в individual_training_sessions, ищем в training_sessions (естественный склон)
        if (trainingResult.rows.length === 0) {
            trainingResult = await dbClient.query(`
                SELECT ts.*, sp.client_id, sp.child_id
                FROM training_sessions ts
                LEFT JOIN session_participants sp ON ts.id = sp.session_id
                WHERE ts.id = $1
                AND ts.training_type = FALSE
                AND ts.slope_type = 'natural_slope'
                AND ts.status = 'scheduled'
                AND sp.status = 'confirmed'
            `, [id]);
            
            if (trainingResult.rows.length === 0) {
                await dbClient.query('ROLLBACK');
                return res.status(404).json({ error: 'Тренировка не найдена' });
            }
            
            isNaturalSlope = true;
        }
        
        training = trainingResult.rows[0];
        
        // 2. Обновляем trainer_id (в зависимости от типа тренировки)
        if (isNaturalSlope) {
            await dbClient.query(
                'UPDATE training_sessions SET trainer_id = $1, updated_at = NOW() WHERE id = $2',
                [trainer_id, id]
            );
        } else {
            await dbClient.query(
                'UPDATE individual_training_sessions SET trainer_id = $1, updated_at = NOW() WHERE id = $2',
                [trainer_id, id]
            );
        }
        
        // 3. Получаем информацию о тренере и клиенте
        const trainerResult = await dbClient.query(
            'SELECT full_name, phone FROM trainers WHERE id = $1',
            [trainer_id]
        );
        
        const clientId = isNaturalSlope ? training.client_id : training.client_id;
        const clientResult = await dbClient.query(
            'SELECT telegram_id, full_name FROM clients WHERE id = $1',
            [clientId]
        );
        
        if (trainerResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Тренер не найден' });
        }
        
        const trainer = trainerResult.rows[0];
        const client = clientResult.rows[0];
        
        // 4. Создаем выплату тренеру (если with_trainer = TRUE)
        if (training.with_trainer) {
            // Получаем настройки ЗП тренера
            const salaryResult = await dbClient.query(`
                SELECT default_payment_type, default_percentage, default_fixed_amount
                FROM trainers
                WHERE id = $1
            `, [trainer_id]);
            
            const { default_payment_type, default_percentage, default_fixed_amount } = salaryResult.rows[0];
            
            let amount;
            if (default_payment_type === 'percentage') {
                amount = training.price * (default_percentage / 100);
            } else {
                amount = default_fixed_amount;
            }
            
            // Проверяем, нет ли уже выплаты для этой тренировки
            if (isNaturalSlope) {
                const existingPayment = await dbClient.query(
                    'SELECT id FROM trainer_payments WHERE training_session_id = $1',
                    [id]
                );
                
                if (existingPayment.rows.length === 0) {
                    await dbClient.query(`
                        INSERT INTO trainer_payments (
                            trainer_id, training_session_id, amount, payment_type, status, created_at
                        ) VALUES ($1, $2, $3, 'individual_training', 'pending', NOW())
                    `, [trainer_id, id, amount]);
                }
            } else {
                const existingPayment = await dbClient.query(
                    'SELECT id FROM trainer_payments WHERE individual_training_id = $1',
                    [id]
                );
                
                if (existingPayment.rows.length === 0) {
                    await dbClient.query(`
                        INSERT INTO trainer_payments (
                            trainer_id, individual_training_id, amount, payment_type, status, created_at
                        ) VALUES ($1, $2, $3, 'individual_training', 'pending', NOW())
                    `, [trainer_id, id, amount]);
                }
            }
        }
        
        await dbClient.query('COMMIT');
        
        console.log(`✅ Тренер ${trainer.full_name} назначен на тренировку #${id}`);
        
        // 5. Отправляем уведомления (асинхронно, не блокируем ответ)
        setImmediate(async () => {
            try {
                // Получаем полные данные для уведомлений
                const fullTrainingData = await getTrainingAndClientData(id);
                
                // Уведомление клиенту
                if (fullTrainingData.client_telegram_id) {
                    await notifyClientAboutTrainerAssignment({
                        clientTelegramId: fullTrainingData.client_telegram_id,
                        training: fullTrainingData,
                        trainer: trainer
                    });
                }
                
                // Уведомление администраторам
                await notifyAdminAboutTrainerAssignment({
                    client: {
                        full_name: fullTrainingData.client_full_name,
                        phone: fullTrainingData.client_phone
                    },
                    training: fullTrainingData,
                    trainer: trainer
                });
            } catch (notifyError) {
                console.error('❌ Ошибка при отправке уведомлений о назначении тренера:', notifyError);
            }
        });
        
        res.json({ 
            success: true,
            trainer_name: trainer.full_name,
            trainer_phone: trainer.phone
        });
        
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Ошибка при назначении тренера:', error);
        res.status(500).json({ error: 'Ошибка при назначении тренера' });
    } finally {
        dbClient.release();
    }
});

/**
 * PUT /api/individual-trainings/:id/change-trainer
 * Изменение назначенного тренера на индивидуальной тренировке
 */
router.put('/:id/change-trainer', async (req, res) => {
    const dbClient = await pool.connect();
    try {
        const { id } = req.params;
        const { trainer_id: newTrainerId } = req.body;
        
        await dbClient.query('BEGIN');
        
        // 1. Проверяем существование тренировки и получаем текущего тренера
        const trainingResult = await dbClient.query(
            'SELECT trainer_id FROM individual_training_sessions WHERE id = $1',
            [id]
        );
        
        if (trainingResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        
        const currentTrainerId = trainingResult.rows[0].trainer_id;
        
        if (!currentTrainerId) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ error: 'На тренировке нет назначенного тренера' });
        }
        
        if (currentTrainerId == newTrainerId) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ error: 'Новый тренер совпадает с текущим' });
        }
        
        // 2. Обновляем trainer_id
        await dbClient.query(
            'UPDATE individual_training_sessions SET trainer_id = $1, updated_at = NOW() WHERE id = $2',
            [newTrainerId, id]
        );
        
        // 3. Получаем информацию о новом тренере
        const trainerResult = await dbClient.query(
            'SELECT full_name, phone FROM trainers WHERE id = $1',
            [newTrainerId]
        );
        
        if (trainerResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Новый тренер не найден' });
        }
        
        const newTrainer = trainerResult.rows[0];
        
        // 4. Обновляем выплаты тренерам
        // Удаляем старую выплату (только pending)
        await dbClient.query(
            'DELETE FROM trainer_payments WHERE individual_training_id = $1 AND status = $2',
            [id, 'pending']
        );
        
        // Создаем новую выплату для нового тренера
        const trainingData = await dbClient.query(
            'SELECT price, with_trainer FROM individual_training_sessions WHERE id = $1',
            [id]
        );
        
        const training = trainingData.rows[0];
        
        if (training.with_trainer) {
            // Получаем настройки ЗП нового тренера
            const salaryResult = await dbClient.query(`
                SELECT default_payment_type, default_percentage, default_fixed_amount
                FROM trainers
                WHERE id = $1
            `, [newTrainerId]);
            
            const { default_payment_type, default_percentage, default_fixed_amount } = salaryResult.rows[0];
            
            let amount;
            if (default_payment_type === 'percentage') {
                amount = training.price * (default_percentage / 100);
            } else {
                amount = default_fixed_amount;
            }
            
            await dbClient.query(`
                INSERT INTO trainer_payments (
                    trainer_id, individual_training_id, amount, payment_type, status, created_at
                ) VALUES ($1, $2, $3, 'individual_training', 'pending', NOW())
            `, [newTrainerId, id, amount]);
        }
        
        await dbClient.query('COMMIT');
        
        // 5. Получаем информацию о старом тренере
        const oldTrainerResult = await dbClient.query(
            'SELECT full_name, phone FROM trainers WHERE id = $1',
            [currentTrainerId]
        );
        const oldTrainer = oldTrainerResult.rows[0] || { full_name: 'Неизвестен', phone: '' };
        
        console.log(`✅ Тренер изменен с ${oldTrainer.full_name} на ${newTrainer.full_name} для тренировки #${id}`);
        
        // 6. Отправляем уведомления (асинхронно, не блокируем ответ)
        setImmediate(async () => {
            try {
                // Получаем полные данные для уведомлений
                const fullTrainingData = await getTrainingAndClientData(id);
                
                // Уведомление клиенту
                if (fullTrainingData.client_telegram_id) {
                    await notifyClientAboutTrainerChange({
                        clientTelegramId: fullTrainingData.client_telegram_id,
                        training: fullTrainingData,
                        oldTrainer: oldTrainer,
                        newTrainer: newTrainer
                    });
                }
                
                // Уведомление администраторам
                await notifyAdminAboutTrainerChange({
                    client: {
                        full_name: fullTrainingData.client_full_name,
                        phone: fullTrainingData.client_phone
                    },
                    training: fullTrainingData,
                    oldTrainer: oldTrainer,
                    newTrainer: newTrainer
                });
            } catch (notifyError) {
                console.error('❌ Ошибка при отправке уведомлений об изменении тренера:', notifyError);
            }
        });
        
        res.json({ 
            success: true,
            trainer_name: newTrainer.full_name,
            trainer_phone: newTrainer.phone,
            previous_trainer_id: currentTrainerId
        });
        
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Ошибка при изменении тренера:', error);
        res.status(500).json({ error: 'Ошибка при изменении тренера' });
    } finally {
        dbClient.release();
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
        
        // Получаем информацию о тренировке (сначала ищем в individual_training_sessions)
        let trainingResult = await client.query(`
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
                parent.telegram_id as parent_telegram_id,
                'simulator' as slope_type
            FROM individual_training_sessions its
            LEFT JOIN simulators s ON its.simulator_id = s.id
            LEFT JOIN clients c ON its.client_id = c.id
            LEFT JOIN children ch ON its.child_id = ch.id
            LEFT JOIN clients parent ON ch.parent_id = parent.id
            WHERE its.id = $1
        `, [id]);
        
        // Если не найдено в individual_training_sessions, ищем в training_sessions (естественный склон)
        if (trainingResult.rows.length === 0) {
            trainingResult = await client.query(`
                SELECT 
                    ts.id,
                    sp.client_id,
                    sp.child_id,
                    ts.equipment_type,
                    ts.with_trainer,
                    ts.duration,
                    ts.session_date as preferred_date,
                    ts.start_time as preferred_time,
                    ts.simulator_id,
                    ts.price,
                    NULL as simulator_name,
                    c.full_name as client_name,
                    c.phone as client_phone,
                    c.birth_date as client_birth_date,
                    c.telegram_id as client_telegram_id,
                    ch.full_name as child_name,
                    ch.birth_date as child_birth_date,
                    parent.full_name as parent_name,
                    parent.phone as parent_phone,
                    parent.telegram_id as parent_telegram_id,
                    'natural_slope' as slope_type,
                    sp.id as participant_id
                FROM training_sessions ts
                LEFT JOIN session_participants sp ON ts.id = sp.session_id
                LEFT JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                LEFT JOIN clients parent ON ch.parent_id = parent.id
                WHERE ts.id = $1
                AND ts.training_type = FALSE
                AND ts.slope_type = 'natural_slope'
                AND ts.status = 'scheduled'
                AND sp.status = 'confirmed'
            `, [id]);
        }
        
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
        
        // Отменяем выплату тренеру (только pending выплаты) - только для тренажера
        if (training.slope_type === 'simulator') {
            await client.query(
                'DELETE FROM trainer_payments WHERE individual_training_id = $1 AND status = $2',
                [id, 'pending']
            );
            
            // Освобождаем слоты в расписании тренажера
            await client.query(
                `UPDATE schedule 
                 SET is_booked = false 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time >= $3 
                 AND start_time < ($3 + ($4 || ' minutes')::interval)`,
                [training.simulator_id, training.preferred_date, training.preferred_time, training.duration]
            );
            
            // Удаляем тренировку тренажера
            await client.query('DELETE FROM individual_training_sessions WHERE id = $1', [id]);
        } else if (training.slope_type === 'natural_slope') {
            // Для естественного склона освобождаем слот в winter_schedule
            await client.query(
                `UPDATE winter_schedule 
                 SET is_available = true, current_participants = 0
                 WHERE date = $1 
                 AND time_slot = $2 
                 AND is_individual_training = true`,
                [training.preferred_date, training.preferred_time]
            );
            
            // Удаляем участника из session_participants
            if (training.participant_id) {
                await client.query('DELETE FROM session_participants WHERE id = $1', [training.participant_id]);
            }
            
            // Удаляем саму тренировку из training_sessions
            await client.query('DELETE FROM training_sessions WHERE id = $1', [id]);
        }
        
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

