# План реализации назначения тренеров

**Дата:** 22.10.2025  
**Статус:** 🔄 В РАБОТЕ

---

## 📋 Цель

Реализовать возможность назначения тренеров на индивидуальные тренировки через админ-панель с автоматическими уведомлениями клиентам и администраторам.

---

## ✅ ВЫПОЛНЕНО

### 1. База данных

- ✅ Создана миграция `013_add_trainer_assignment_to_individual_trainings.sql`
- ✅ Добавлено поле `trainer_id` в `individual_training_sessions`
- ✅ Создан индекс `idx_individual_training_trainer`
- ✅ Обновлен `schema.sql`

**SQL:**
```sql
ALTER TABLE individual_training_sessions
ADD COLUMN trainer_id INTEGER REFERENCES trainers(id);

CREATE INDEX idx_individual_training_trainer
ON individual_training_sessions(trainer_id);
```

---

## 🎯 ЭТАПЫ РЕАЛИЗАЦИИ

### ЭТАП 1: API Endpoints ⏳

#### 1.1 GET `/api/individual-trainings/:id`

**Обновить существующий endpoint** для возврата информации о тренере:

**Файл:** `src/routes/individual-trainings.js`

**Текущий SQL:** (нужно проверить)
```sql
SELECT its.*, 
       c.full_name as participant_name,
       ...
FROM individual_training_sessions its
...
```

**Новый SQL:**
```sql
SELECT its.*, 
       c.full_name as participant_name,
       t.full_name as trainer_name,   -- NEW
       t.phone as trainer_phone,       -- NEW
       t.sport_type as trainer_sport,  -- NEW
       ...
FROM individual_training_sessions its
LEFT JOIN trainers t ON its.trainer_id = t.id  -- NEW
...
```

---

#### 1.2 GET `/api/trainers/available`

**Создать новый endpoint** для получения списка доступных тренеров.

**Файл:** `src/routes/individual-trainings.js` (или создать отдельный `src/routes/trainer-assignment.js`)

**Логика:**
```javascript
router.get('/trainers/available', async (req, res) => {
    try {
        const { equipment_type } = req.query;
        
        // Фильтруем тренеров по специализации
        const trainers = await pool.query(`
            SELECT id, full_name, phone, sport_type
            FROM trainers
            WHERE is_active = TRUE
            AND (sport_type = $1 OR sport_type = 'both')
            ORDER BY full_name
        `, [equipment_type]);
        
        res.json(trainers.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при загрузке тренеров' });
    }
});
```

---

#### 1.3 PUT `/api/individual-trainings/:id/assign-trainer`

**Создать новый endpoint** для назначения тренера.

**Файл:** `src/routes/individual-trainings.js`

**Логика:**
```javascript
router.put('/:id/assign-trainer', async (req, res) => {
    const dbClient = await pool.connect();
    try {
        const { id } = req.params;
        const { trainer_id } = req.body;
        
        await dbClient.query('BEGIN');
        
        // 1. Проверяем существование тренировки
        const trainingResult = await dbClient.query(
            'SELECT * FROM individual_training_sessions WHERE id = $1',
            [id]
        );
        
        if (trainingResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        
        const training = trainingResult.rows[0];
        
        // 2. Обновляем trainer_id
        await dbClient.query(
            'UPDATE individual_training_sessions SET trainer_id = $1, updated_at = NOW() WHERE id = $2',
            [trainer_id, id]
        );
        
        // 3. Получаем информацию о тренере и клиенте
        const trainerResult = await dbClient.query(
            'SELECT full_name, phone FROM trainers WHERE id = $1',
            [trainer_id]
        );
        
        const clientResult = await dbClient.query(
            'SELECT telegram_id, full_name FROM clients WHERE id = $1',
            [training.client_id]
        );
        
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
            
            await dbClient.query(`
                INSERT INTO trainer_payments (
                    trainer_id, individual_training_id, amount, status, created_at
                ) VALUES ($1, $2, $3, 'pending', NOW())
            `, [trainer_id, id, amount]);
        }
        
        await dbClient.query('COMMIT');
        
        // 5. Отправляем уведомление клиенту
        if (client.telegram_id) {
            await notifyClientAboutTrainer(client.telegram_id, training, trainer);
        }
        
        // 6. Отправляем уведомление в админ-бот
        await notifyAdminAboutAssignment(training, trainer, client);
        
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
```

---

### ЭТАП 2: Frontend (Admin Panel) ⏳

#### 2.1 Обновить модальное окно

**Файл:** `public/js/admin.js`, функция `viewScheduleDetails()`

**Текущий код (строка ~2172):**
```javascript
<p><strong>Тренер:</strong> ${trainerText}</p>
```

**Новый код:**
```javascript
<p><strong>Тренер (требуется):</strong> ${trainerText}</p>
${training.with_trainer ? `
    <p><strong>Назначен:</strong> 
        <span id="assigned-trainer-${trainingId}">
            ${training.trainer_name 
                ? `${training.trainer_name} (${training.trainer_phone})` 
                : '<span style="color: #ff6b6b;">Не назначен</span>'}
        </span>
    </p>
    ${!training.trainer_name ? `
        <div class="form-group" style="margin-top: 16px;">
            <label>Назначить тренера:</label>
            <select id="trainer-select-${trainingId}" class="form-control">
                <option value="">Загрузка...</option>
            </select>
            <button 
                class="btn-primary" 
                style="margin-top: 8px;"
                onclick="assignTrainer(${trainingId}, '${training.equipment_type}')">
                Назначить тренера
            </button>
        </div>
    ` : ''}
` : ''}
```

**Комментарий:**
- Показываем селектор только если `with_trainer = TRUE` и тренер еще не назначен
- Фильтруем тренеров по `equipment_type` ('ski' или 'snowboard')

---

#### 2.2 Функция загрузки тренеров

**Файл:** `public/js/admin.js`

**Добавить новую функцию:**
```javascript
// Загрузка доступных тренеров в селектор
async function loadAvailableTrainers(trainingId, equipmentType) {
    try {
        const response = await fetch(`/api/individual-trainings/trainers/available?equipment_type=${equipmentType}`);
        if (!response.ok) throw new Error('Ошибка при загрузке тренеров');
        
        const trainers = await response.json();
        const select = document.getElementById(`trainer-select-${trainingId}`);
        
        if (trainers.length === 0) {
            select.innerHTML = '<option value="">Нет доступных тренеров</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Выберите тренера...</option>' +
            trainers.map(t => `<option value="${t.id}">${t.full_name} (${t.phone})</option>`).join('');
            
    } catch (error) {
        console.error('Ошибка при загрузке тренеров:', error);
        showError('Не удалось загрузить список тренеров');
    }
}
```

---

#### 2.3 Функция назначения тренера

**Файл:** `public/js/admin.js`

**Добавить новую функцию:**
```javascript
// Назначение тренера на индивидуальную тренировку
async function assignTrainer(trainingId, equipmentType) {
    const select = document.getElementById(`trainer-select-${trainingId}`);
    const trainerId = select.value;
    
    if (!trainerId) {
        showError('Пожалуйста, выберите тренера');
        return;
    }
    
    try {
        const response = await fetch(`/api/individual-trainings/${trainingId}/assign-trainer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainer_id: trainerId })
        });
        
        if (!response.ok) throw new Error('Ошибка при назначении тренера');
        
        const result = await response.json();
        
        // Обновляем отображение
        const assignedSpan = document.getElementById(`assigned-trainer-${trainingId}`);
        assignedSpan.innerHTML = `${result.trainer_name} (${result.trainer_phone})`;
        
        // Скрываем форму назначения
        select.closest('.form-group').remove();
        
        showSuccess(`Тренер ${result.trainer_name} успешно назначен!`);
        
    } catch (error) {
        console.error('Ошибка при назначении тренера:', error);
        showError('Не удалось назначить тренера');
    }
}
```

---

#### 2.4 Автозагрузка тренеров

**Обновить `viewScheduleDetails()`:**

После добавления модального окна в DOM, вызвать загрузку тренеров:

```javascript
document.body.appendChild(modal);
modal.style.display = 'block';

// Автоматически загружаем тренеров если нужно
if (training.is_individual && training.with_trainer && !training.trainer_name) {
    loadAvailableTrainers(trainingId, training.equipment_type);
}
```

---

### ЭТАП 3: Уведомления ⏳

#### 3.1 Уведомление клиенту

**Файл:** Создать `src/services/trainer-assignment-notification.js`

```javascript
const clientBot = require('../bot/client-bot');

async function notifyClientAboutTrainer(telegramId, training, trainer) {
    try {
        const date = new Date(training.preferred_date).toLocaleDateString('ru-RU');
        const time = training.preferred_time.slice(0, 5);
        const equipmentName = training.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд';
        
        const message = `
🎿 <b>Вам назначен инструктор!</b>

<b>Тренировка:</b> ${date} в ${time}
<b>Длительность:</b> ${training.duration} минут
<b>Тип:</b> ${equipmentName}

👨‍🏫 <b>Инструктор:</b> ${trainer.full_name}
📞 <b>Телефон:</b> ${trainer.phone}

Ждем вас на тренировку! 🏂
        `.trim();
        
        await clientBot.sendMessage(telegramId, message, { parse_mode: 'HTML' });
        
        console.log(`✅ Уведомление о назначении тренера отправлено клиенту ${telegramId}`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомления клиенту:', error);
        return false;
    }
}

module.exports = {
    notifyClientAboutTrainer
};
```

---

#### 3.2 Уведомление в админ-бот

**Файл:** `src/bot/admin-notify.js`

**Добавить функцию:**
```javascript
async function notifyAdminAboutAssignment(training, trainer, client) {
    try {
        const date = new Date(training.preferred_date).toLocaleDateString('ru-RU');
        const time = training.preferred_time.slice(0, 5);
        const equipmentName = training.equipment_type === 'ski' ? 'Лыжи' : 'Сноуборд';
        
        const message = `
✅ <b>Тренер назначен</b>

<b>Клиент:</b> ${client.full_name}
<b>Тренировка:</b> ${date} в ${time} (${training.duration} мин)
<b>Тип:</b> ${equipmentName}
<b>Инструктор:</b> ${trainer.full_name}

Клиент получил уведомление.
        `.trim();
        
        await sendAdminNotification(message);
        
        console.log('✅ Уведомление о назначении отправлено в админ-бот');
        return true;
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомления в админ-бот:', error);
        return false;
    }
}

module.exports = {
    ...existingExports,
    notifyAdminAboutAssignment
};
```

---

#### 3.3 Интеграция уведомлений в API

**В `src/routes/individual-trainings.js`:**

```javascript
const { notifyClientAboutTrainer } = require('../services/trainer-assignment-notification');
const { notifyAdminAboutAssignment } = require('../bot/admin-notify');
```

---

### ЭТАП 4: Обработка отмены тренировки ⏳

#### 4.1 Отмена выплаты тренеру

**Файл:** `src/routes/individual-trainings.js`, функция `deleteIndividualTraining()`

**Обновить логику:**
```javascript
// После BEGIN транзакции

// 1. Отменяем выплату тренеру (если была создана)
await dbClient.query(
    'DELETE FROM trainer_payments WHERE individual_training_id = $1 AND status = \'pending\'',
    [id]
);

// 2. Остальная логика удаления...
```

**Комментарий:**
- Удаляем только выплаты со статусом `pending`
- Если выплата уже `approved` или `paid`, не удаляем (нужно обсудить с владельцем)

---

## 📊 Итоговая архитектура

```
Админ-панель (Расписание)
    ↓
Кнопка "Подробнее"
    ↓
Модальное окно (индивидуальная тренировка)
    ├─ Информация о тренировке
    ├─ Информация о клиенте
    └─ [НОВОЕ] Назначение тренера
        ├─ Селектор тренеров (фильтр по специализации)
        └─ Кнопка "Назначить тренера"
            ↓
        API PUT /api/individual-trainings/:id/assign-trainer
            ├─ Обновляет trainer_id в БД
            ├─ Создает trainer_payments (если with_trainer = TRUE)
            ├─ Отправляет уведомление клиенту (Telegram)
            └─ Отправляет уведомление в админ-бот
```

---

## ✅ Критерии успеха

1. ✅ База данных обновлена (поле `trainer_id` добавлено)
2. ⏳ API endpoint `/api/individual-trainings/:id` возвращает информацию о тренере
3. ⏳ API endpoint `/trainers/available` возвращает отфильтрованных тренеров
4. ⏳ API endpoint `/api/individual-trainings/:id/assign-trainer` назначает тренера
5. ⏳ Модальное окно показывает селектор тренеров
6. ⏳ Клиент получает уведомление в боте
7. ⏳ Администратор получает уведомление в админ-боте
8. ⏳ При отмене тренировки выплата тренеру отменяется

---

## 🧪 План тестирования

### Тест 1: Назначение тренера
1. Открыть админ-панель → Расписание
2. Найти индивидуальную тренировку с `with_trainer = TRUE`
3. Нажать "Подробнее"
4. Проверить, что селектор тренеров отображается
5. Выбрать тренера
6. Нажать "Назначить тренера"
7. Проверить успешное назначение

### Тест 2: Уведомление клиенту
1. После назначения тренера
2. Проверить, что клиент получил сообщение в боте
3. Проверить корректность данных (ФИО, телефон)

### Тест 3: Уведомление в админ-бот
1. После назначения тренера
2. Проверить, что уведомление пришло в админ-бот
3. Проверить корректность данных

### Тест 4: Отмена тренировки
1. Назначить тренера на тренировку
2. Удалить тренировку
3. Проверить, что выплата тренеру отменена (удалена из `trainer_payments`)

---

## 🔄 Следующие шаги

1. **Реализовать ЭТАП 1** (API Endpoints)
2. **Реализовать ЭТАП 2** (Frontend)
3. **Реализовать ЭТАП 3** (Уведомления)
4. **Реализовать ЭТАП 4** (Отмена)
5. **Тестирование**
6. **Документация**

---

**Статус:** Готов к реализации! 🚀
