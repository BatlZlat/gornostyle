# План миграции на kuliga_schedule_slots

**Дата создания:** 18 ноября 2025  
**Цель:** Унификация системы расписания для всех инструкторов (включая Тебякина Данила) на таблице `kuliga_schedule_slots`

---

## 📋 Общая структура

### Текущее состояние:
- ❌ Бот клиентов использует `winter_schedule` для индивидуальных зимних тренировок
- ❌ Бот клиентов использует `training_sessions` для групповых зимних тренировок
- ✅ Сайт Кулиги использует `kuliga_schedule_slots` для индивидуальных бронирований
- ✅ Инструкторы Кулиги управляют `kuliga_schedule_slots` через личный кабинет

### Целевое состояние:
- ✅ Бот клиентов использует `kuliga_schedule_slots` для всех зимних тренировок
- ✅ Сайт Кулиги использует `kuliga_schedule_slots` для всех бронирований
- ✅ Все инструкторы (включая Тебякина) управляют расписанием через `kuliga_schedule_slots`
- ✅ Единая точка истины для расписания зимних тренировок
- ❌ Таблица `winter_schedule` больше не используется (помечена как deprecated)

---

## 🎯 Этапы миграции

### Этап 1: Расширение функционала личного кабинета инструктора
**Срок:** 1-2 дня  
**Файлы:** `public/trainer_kuliga.html`, `public/js/kuliga-instructor-schedule.js`, `src/routes/kuliga-instructor-schedule.js`

#### 1.1 Добавить раздел "Групповые тренировки" на странице инструктора

**Файл:** `public/trainer_kuliga.html`

Добавить новый раздел после "Массовое создание слотов":

```html
<!-- БЛОК: Управление групповыми тренировками -->
<section class="schedule-section">
    <h2>Групповые тренировки</h2>
    <p class="section-description">
        Создавайте групповые тренировки на основе своих слотов. 
        Клиенты смогут записаться через сайт или телеграм-бота.
    </p>
    
    <div class="form-group">
        <label for="group-date">Выберите дату:</label>
        <input type="date" id="group-date" name="group-date">
    </div>
    
    <div id="available-slots-for-group" style="margin-top: 15px;">
        <!-- Здесь будут отображаться свободные слоты инструктора для выбранной даты -->
    </div>
    
    <div id="group-training-form" style="display: none; margin-top: 20px;">
        <h3>Создание групповой тренировки</h3>
        <form id="createGroupTrainingForm">
            <input type="hidden" id="selected-slot-id" name="slot_id">
            
            <div class="form-row">
                <div class="form-group">
                    <label for="group-sport-type">Вид спорта:</label>
                    <select id="group-sport-type" name="sport_type" required>
                        <option value="">Выберите</option>
                        <option value="ski">Лыжи</option>
                        <option value="snowboard">Сноуборд</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="group-level">Уровень подготовки:</label>
                    <input type="text" id="group-level" name="level" 
                           placeholder="Например: Начинающие, Средний уровень" required>
                </div>
            </div>
            
            <div class="form-group">
                <label for="group-description">Описание программы:</label>
                <textarea id="group-description" name="description" rows="3" 
                          placeholder="Что будем изучать на тренировке"></textarea>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label for="group-price">Цена за человека (₽):</label>
                    <input type="number" id="group-price" name="price_per_person" 
                           min="500" step="50" value="1700" required>
                </div>
                
                <div class="form-group">
                    <label for="group-min-participants">Мин. участников:</label>
                    <input type="number" id="group-min-participants" name="min_participants" 
                           min="2" max="8" value="3" required>
                </div>
                
                <div class="form-group">
                    <label for="group-max-participants">Макс. участников:</label>
                    <input type="number" id="group-max-participants" name="max_participants" 
                           min="2" max="8" value="6" required>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn btn-primary">Создать групповую тренировку</button>
                <button type="button" class="btn btn-secondary" onclick="cancelGroupTraining()">Отмена</button>
            </div>
        </form>
    </div>
    
    <div id="my-group-trainings" style="margin-top: 30px;">
        <h3>Мои групповые тренировки</h3>
        <div id="group-trainings-list">
            <!-- Список групповых тренировок инструктора -->
        </div>
    </div>
</section>
```

#### 1.2 Добавить JavaScript для управления групповыми тренировками

**Файл:** `public/js/kuliga-instructor-schedule.js`

Добавить функции:

```javascript
// ===== ГРУППОВЫЕ ТРЕНИРОВКИ =====

// Загрузка свободных слотов для создания групповой тренировки
async function loadAvailableSlotsForGroup() {
    const dateInput = document.getElementById('group-date');
    const container = document.getElementById('available-slots-for-group');
    
    if (!dateInput.value) {
        container.innerHTML = '<p style="color: #999;">Выберите дату</p>';
        return;
    }
    
    try {
        const token = getToken();
        const response = await fetch(
            `/api/kuliga/instructor/slots?from=${dateInput.value}&to=${dateInput.value}`,
            { headers: { 'Authorization': `Bearer ${token}` }}
        );
        
        if (!response.ok) throw new Error('Ошибка загрузки слотов');
        
        const data = await response.json();
        const slots = data.slots || [];
        
        // Фильтруем только доступные слоты
        const availableSlots = slots.filter(slot => slot.status === 'available');
        
        if (availableSlots.length === 0) {
            container.innerHTML = '<p style="color: #f39c12;">На эту дату нет свободных слотов. Создайте слоты сначала.</p>';
            return;
        }
        
        container.innerHTML = `
            <p style="margin-bottom: 10px;"><strong>Свободные слоты:</strong></p>
            <div class="slots-grid">
                ${availableSlots.map(slot => `
                    <button class="slot-btn available" onclick="selectSlotForGroup(${slot.id}, '${slot.start_time}', '${slot.end_time}')">
                        ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}
                    </button>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Ошибка загрузки слотов:', error);
        showError('Не удалось загрузить свободные слоты');
    }
}

// Выбор слота для создания групповой тренировки
function selectSlotForGroup(slotId, startTime, endTime) {
    const form = document.getElementById('group-training-form');
    const slotIdInput = document.getElementById('selected-slot-id');
    
    slotIdInput.value = slotId;
    form.style.display = 'block';
    
    // Прокрутить к форме
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Отмена создания групповой тренировки
function cancelGroupTraining() {
    const form = document.getElementById('group-training-form');
    form.style.display = 'none';
    document.getElementById('createGroupTrainingForm').reset();
}

// Создание групповой тренировки
async function createGroupTraining(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const data = {
        slot_id: parseInt(formData.get('slot_id')),
        sport_type: formData.get('sport_type'),
        level: formData.get('level'),
        description: formData.get('description') || '',
        price_per_person: parseFloat(formData.get('price_per_person')),
        min_participants: parseInt(formData.get('min_participants')),
        max_participants: parseInt(formData.get('max_participants'))
    };
    
    // Валидация
    if (data.min_participants > data.max_participants) {
        showError('Минимальное количество участников не может быть больше максимального');
        return;
    }
    
    if (data.price_per_person < 500 || data.price_per_person > 10000) {
        showError('Цена должна быть от 500 до 10000 рублей');
        return;
    }
    
    try {
        const token = getToken();
        const response = await fetch('/api/kuliga/instructor/group-trainings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Ошибка создания групповой тренировки');
        }
        
        showSuccess('Групповая тренировка успешно создана!');
        
        // Сбросить форму
        e.target.reset();
        cancelGroupTraining();
        
        // Обновить списки
        loadAvailableSlotsForGroup();
        loadMyGroupTrainings();
        loadStats(); // Обновить статистику
        
    } catch (error) {
        console.error('Ошибка создания групповой тренировки:', error);
        showError(error.message || 'Не удалось создать групповую тренировку');
    }
}

// Загрузка списка групповых тренировок инструктора
async function loadMyGroupTrainings() {
    const container = document.getElementById('group-trainings-list');
    
    try {
        const token = getToken();
        const response = await fetch('/api/kuliga/instructor/group-trainings', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Ошибка загрузки групповых тренировок');
        
        const data = await response.json();
        const trainings = data.trainings || [];
        
        if (trainings.length === 0) {
            container.innerHTML = '<p style="color: #999;">У вас пока нет групповых тренировок</p>';
            return;
        }
        
        container.innerHTML = trainings.map(training => {
            const statusClass = {
                'open': 'status-open',
                'confirmed': 'status-confirmed',
                'cancelled': 'status-cancelled',
                'completed': 'status-completed'
            }[training.status] || '';
            
            const statusText = {
                'open': 'Набор открыт',
                'confirmed': 'Подтверждена',
                'cancelled': 'Отменена',
                'completed': 'Завершена'
            }[training.status] || training.status;
            
            return `
                <div class="group-training-card">
                    <div class="training-header">
                        <div>
                            <strong>${formatDate(training.date)}</strong> ${formatTime(training.start_time)} - ${formatTime(training.end_time)}
                        </div>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="training-details">
                        <p><strong>${getSportTypeLabel(training.sport_type)}</strong> • ${training.level}</p>
                        ${training.description ? `<p class="description">${training.description}</p>` : ''}
                        <p class="participants">
                            👥 Участников: ${training.current_participants}/${training.max_participants} 
                            (мин. ${training.min_participants})
                        </p>
                        <p class="price">💰 ${training.price_per_person} ₽ за человека</p>
                    </div>
                    ${training.status === 'open' ? `
                        <div class="training-actions">
                            <button class="btn btn-sm btn-danger" onclick="cancelGroupTraining(${training.id})">
                                Отменить тренировку
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Ошибка загрузки групповых тренировок:', error);
        container.innerHTML = '<p style="color: #e74c3c;">Ошибка загрузки данных</p>';
    }
}

// Отмена групповой тренировки
async function cancelGroupTrainingById(trainingId) {
    if (!confirm('Вы уверены, что хотите отменить эту тренировку? Клиентам будут отправлены уведомления.')) {
        return;
    }
    
    try {
        const token = getToken();
        const response = await fetch(`/api/kuliga/instructor/group-trainings/${trainingId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Ошибка отмены тренировки');
        }
        
        showSuccess('Тренировка отменена. Клиентам отправлены уведомления.');
        loadMyGroupTrainings();
        loadStats();
        
    } catch (error) {
        console.error('Ошибка отмены тренировки:', error);
        showError(error.message || 'Не удалось отменить тренировку');
    }
}

// Вспомогательные функции
function getSportTypeLabel(type) {
    const labels = {
        'ski': '⛷️ Лыжи',
        'snowboard': '🏂 Сноуборд'
    };
    return labels[type] || type;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    // ... существующие обработчики ...
    
    // Групповые тренировки
    const groupDateInput = document.getElementById('group-date');
    if (groupDateInput) {
        groupDateInput.addEventListener('change', loadAvailableSlotsForGroup);
    }
    
    const createGroupForm = document.getElementById('createGroupTrainingForm');
    if (createGroupForm) {
        createGroupForm.addEventListener('submit', createGroupTraining);
    }
    
    // Загрузить групповые тренировки при загрузке страницы
    loadMyGroupTrainings();
});
```

#### 1.3 Добавить API-эндпоинты для групповых тренировок

**Файл:** `src/routes/kuliga-instructor-schedule.js`

Добавить эндпоинты:

```javascript
// GET /api/kuliga/instructor/group-trainings - получить групповые тренировки инструктора
router.get('/group-trainings', verifyKuligaInstructorToken, async (req, res) => {
    try {
        const instructorId = req.instructor.id;
        
        const result = await pool.query(
            `SELECT 
                kgt.*,
                ks.start_time,
                ks.end_time
            FROM kuliga_group_trainings kgt
            JOIN kuliga_schedule_slots ks ON kgt.slot_id = ks.id
            WHERE kgt.instructor_id = $1
              AND kgt.date >= CURRENT_DATE
            ORDER BY kgt.date, kgt.start_time`,
            [instructorId]
        );
        
        res.json({ success: true, trainings: result.rows });
    } catch (error) {
        console.error('Ошибка получения групповых тренировок:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения данных' });
    }
});

// POST /api/kuliga/instructor/group-trainings - создать групповую тренировку
router.post('/group-trainings', verifyKuligaInstructorToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const instructorId = req.instructor.id;
        const {
            slot_id,
            sport_type,
            level,
            description = '',
            price_per_person,
            min_participants,
            max_participants
        } = req.body;
        
        // Валидация
        if (!slot_id || !sport_type || !level || !price_per_person || !min_participants || !max_participants) {
            return res.status(400).json({ success: false, error: 'Заполните все обязательные поля' });
        }
        
        if (min_participants > max_participants) {
            return res.status(400).json({ 
                success: false, 
                error: 'Минимальное количество участников не может быть больше максимального' 
            });
        }
        
        if (!['ski', 'snowboard'].includes(sport_type)) {
            return res.status(400).json({ success: false, error: 'Неверный вид спорта' });
        }
        
        await client.query('BEGIN');
        
        // Проверяем, что слот принадлежит инструктору и свободен
        const slotCheck = await client.query(
            `SELECT id, date, start_time, end_time, status
             FROM kuliga_schedule_slots
             WHERE id = $1 AND instructor_id = $2
             FOR UPDATE`,
            [slot_id, instructorId]
        );
        
        if (slotCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Слот не найден' });
        }
        
        const slot = slotCheck.rows[0];
        
        if (slot.status !== 'available') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: 'Этот слот уже занят или заблокирован' 
            });
        }
        
        // Создаем групповую тренировку
        const trainingResult = await client.query(
            `INSERT INTO kuliga_group_trainings (
                instructor_id, slot_id, date, start_time, end_time,
                sport_type, level, description,
                price_per_person, min_participants, max_participants,
                current_participants, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 'open')
            RETURNING *`,
            [
                instructorId, slot_id, slot.date, slot.start_time, slot.end_time,
                sport_type, level, description,
                price_per_person, min_participants, max_participants
            ]
        );
        
        // Обновляем статус слота
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'group', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [slot_id]
        );
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: 'Групповая тренировка создана',
            training: trainingResult.rows[0]
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка создания групповой тренировки:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания тренировки' });
    } finally {
        client.release();
    }
});

// DELETE /api/kuliga/instructor/group-trainings/:id - отменить групповую тренировку
router.delete('/group-trainings/:id', verifyKuligaInstructorToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const instructorId = req.instructor.id;
        const trainingId = parseInt(req.params.id);
        
        await client.query('BEGIN');
        
        // Проверяем, что тренировка принадлежит инструктору
        const trainingCheck = await client.query(
            `SELECT kgt.id, kgt.slot_id, kgt.status, kgt.current_participants
             FROM kuliga_group_trainings kgt
             WHERE kgt.id = $1 AND kgt.instructor_id = $2
             FOR UPDATE`,
            [trainingId, instructorId]
        );
        
        if (trainingCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Тренировка не найдена' });
        }
        
        const training = trainingCheck.rows[0];
        
        if (training.status === 'cancelled' || training.status === 'completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: 'Эту тренировку нельзя отменить' 
            });
        }
        
        // Отменяем тренировку
        await client.query(
            `UPDATE kuliga_group_trainings
             SET status = 'cancelled',
                 cancellation_reason = 'Отменена инструктором',
                 cancelled_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [trainingId]
        );
        
        // Освобождаем слот (если есть участники, слот остается group, иначе available)
        const newStatus = training.current_participants > 0 ? 'group' : 'available';
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [newStatus, training.slot_id]
        );
        
        // Если есть участники, отменяем их бронирования и возвращаем деньги
        if (training.current_participants > 0) {
            await client.query(
                `UPDATE kuliga_bookings
                 SET status = 'cancelled',
                     cancellation_reason = 'Тренировка отменена инструктором',
                     cancelled_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE group_training_id = $1
                   AND status IN ('pending', 'confirmed')`,
                [trainingId]
            );
            
            // TODO: Здесь должна быть логика возврата средств через Tinkoff
            // TODO: Отправка уведомлений клиентам
        }
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: 'Тренировка отменена',
            refunded_bookings: training.current_participants
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка отмены групповой тренировки:', error);
        res.status(500).json({ success: false, error: 'Ошибка отмены тренировки' });
    } finally {
        client.release();
    }
});
```

---

### Этап 2: Обновление бота клиентов
**Срок:** 2-3 дня  
**Файлы:** `src/bot/client-bot.js`

#### 2.1 Замена запросов к `winter_schedule` на `kuliga_schedule_slots`

**Функция:** `showNaturalSlopeAvailableDates()`

Было:
```javascript
const res = await pool.query(
    `SELECT DISTINCT date, date::text AS date_str
     FROM winter_schedule
     WHERE is_individual_training = true
       AND is_available = true
       AND date >= CURRENT_DATE
     ORDER BY date
     LIMIT 60`
);
```

Станет:
```javascript
const res = await pool.query(
    `SELECT DISTINCT ks.date, ks.date::text AS date_str
     FROM kuliga_schedule_slots ks
     JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
     WHERE ks.status = 'available'
       AND ks.date >= CURRENT_DATE
       AND ki.is_active = true
     ORDER BY ks.date
     LIMIT 60`
);
```

**Функция:** `showNaturalSlopeTimeSlots()`

Было:
```javascript
const freeSlotsRes = await pool.query(
    `SELECT time_slot FROM winter_schedule
     WHERE date = $1 
       AND is_individual_training = true
       AND is_available = true
     ORDER BY time_slot`,
    [selectedDate]
);
```

Станет:
```javascript
const freeSlotsRes = await pool.query(
    `SELECT 
        ks.id as slot_id,
        ks.start_time,
        ks.end_time,
        ki.full_name as instructor_name,
        ki.sport_type,
        ki.id as instructor_id
     FROM kuliga_schedule_slots ks
     JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
     WHERE ks.date = $1 
       AND ks.status = 'available'
       AND ki.is_active = true
     ORDER BY ks.start_time`,
    [selectedDate]
);
```

Изменить формат вывода:
```javascript
const slotButtons = freeSlotsRes.rows.map(slot => {
    const time = String(slot.start_time).substring(0, 5);
    return [`⏰ ${time} (${slot.instructor_name})`];
});
```

#### 2.2 Замена запросов к `training_sessions` на `kuliga_group_trainings`

**Функция:** `showAvailableGroupTrainings()`

Было:
```javascript
const result = await pool.query(
    `SELECT 
        ts.id,
        ts.session_date as date,
        ts.start_time,
        ts.end_time,
        ts.duration,
        g.name as group_name,
        t.full_name as trainer_name,
        t.phone as trainer_phone,
        ts.max_participants,
        ts.price,
        ts.skill_level,
        COUNT(CASE WHEN sp.status = 'confirmed' THEN 1 END) as current_participants
    FROM training_sessions ts
    LEFT JOIN groups g ON ts.group_id = g.id
    LEFT JOIN trainers t ON ts.trainer_id = t.id
    LEFT JOIN session_participants sp ON ts.id = sp.session_id
    WHERE ts.training_type = true
        AND ts.slope_type = 'natural_slope'
        AND ts.winter_training_type = 'group'
        AND ts.status = 'scheduled'
        ...`
);
```

Станет:
```javascript
const result = await pool.query(
    `SELECT 
        kgt.id,
        kgt.date,
        kgt.start_time,
        kgt.end_time,
        kgt.sport_type,
        kgt.level as group_name,
        kgt.description,
        ki.full_name as trainer_name,
        ki.phone as trainer_phone,
        kgt.max_participants,
        kgt.min_participants,
        kgt.price_per_person as price,
        kgt.current_participants,
        kgt.status
    FROM kuliga_group_trainings kgt
    JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
    WHERE kgt.status IN ('open', 'confirmed')
        AND kgt.date >= CURRENT_DATE
        AND kgt.date <= $2::date
        AND (
            kgt.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
            OR (
                kgt.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                AND kgt.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
            )
        )
        AND kgt.current_participants < kgt.max_participants
    ORDER BY kgt.date, kgt.start_time`,
    [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
);
```

#### 2.3 Обновление логики бронирования

**При записи на индивидуальную тренировку:**

Вместо обновления `winter_schedule`:
```javascript
await dbClient.query(
    `UPDATE winter_schedule 
     SET is_available = false, current_participants = 1
     WHERE id = $1`,
    [slotId]
);
```

Обновлять `kuliga_schedule_slots`:
```javascript
await dbClient.query(
    `UPDATE kuliga_schedule_slots 
     SET status = 'booked', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [slotId]
);
```

И создавать запись в `kuliga_bookings`:
```javascript
const bookingResult = await dbClient.query(
    `INSERT INTO kuliga_bookings (
        client_id, booking_type, instructor_id, slot_id,
        date, start_time, end_time, sport_type,
        participants_count, participants_names, participants_birth_years,
        price_total, price_per_person, price_id,
        status, notification_method, payer_rides
    ) VALUES ($1, 'individual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14, $15)
    RETURNING id`,
    [
        clientId, instructorId, slotId,
        date, startTime, endTime, sportType,
        participantsCount, participantsNames, participantsBirthYears,
        totalPrice, pricePerPerson, priceId,
        notificationMethod, payerRides
    ]
);
```

**При записи на групповую тренировку:**

Использовать `kuliga_group_trainings` и `kuliga_bookings`:
```javascript
// Увеличить счетчик участников
await dbClient.query(
    `UPDATE kuliga_group_trainings
     SET current_participants = current_participants + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [groupTrainingId]
);

// Создать бронирование
await dbClient.query(
    `INSERT INTO kuliga_bookings (
        client_id, booking_type, group_training_id,
        date, start_time, end_time, sport_type,
        participants_count, participants_names, participants_birth_years,
        price_total, price_per_person,
        status, notification_method, payer_rides
    ) VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13)
    RETURNING id`,
    [...]
);
```

#### 2.4 Обновление отображения бронирований клиента

**Функция:** `showMyBookings()`

Заменить запрос для зимних групповых тренировок с `training_sessions` на `kuliga_bookings`:

```javascript
// Вместо winterGroupResult из training_sessions:
const winterGroupResult = await pool.query(
    `SELECT 
        kb.id,
        kb.date,
        kb.start_time,
        kb.end_time,
        kb.sport_type,
        kb.participants_count,
        kb.participants_names,
        kb.price_total,
        kb.status,
        kgt.level as group_name,
        kgt.max_participants,
        kgt.current_participants,
        ki.full_name as trainer_name
    FROM kuliga_bookings kb
    LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
    LEFT JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
    WHERE kb.client_id = $1
      AND kb.booking_type = 'group'
      AND kb.status IN ('pending', 'confirmed')
      AND kb.date >= CURRENT_DATE
    ORDER BY kb.date, kb.start_time`,
    [kuligaClientId]
);
```

---

### Этап 3: Обновление сайта Кулиги
**Срок:** 1 день  
**Файлы:** `views/kuliga-landing.ejs`, `public/js/kuliga.js`, `src/routes/kuliga-public.js`

#### 3.1 Отображение групповых тренировок на лендинге

**Файл:** `src/routes/kuliga-public.js`

Добавить эндпоинт для получения групповых тренировок:

```javascript
// GET /api/kuliga/group-trainings - публичный список групповых тренировок
router.get('/api/kuliga/group-trainings', async (req, res) => {
    try {
        const startDate = moment.tz(TIMEZONE).startOf('day');
        const endDate = startDate.clone().add(14, 'days').endOf('day');
        
        const result = await pool.query(
            `SELECT 
                kgt.id,
                kgt.date,
                kgt.start_time,
                kgt.end_time,
                kgt.sport_type,
                kgt.level,
                kgt.description,
                kgt.price_per_person,
                kgt.min_participants,
                kgt.max_participants,
                kgt.current_participants,
                kgt.status,
                ki.full_name as instructor_name,
                ki.photo_url as instructor_photo
            FROM kuliga_group_trainings kgt
            JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
            WHERE kgt.status IN ('open', 'confirmed')
              AND kgt.date >= $1::date
              AND kgt.date <= $2::date
              AND kgt.current_participants < kgt.max_participants
            ORDER BY kgt.date, kgt.start_time`,
            [startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')]
        );
        
        res.json({ success: true, trainings: result.rows });
    } catch (error) {
        console.error('Ошибка получения групповых тренировок:', error);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});
```

**Файл:** `public/js/kuliga.js`

Добавить функцию загрузки групповых тренировок:

```javascript
async function loadGroupTrainings() {
    try {
        const response = await fetch('/api/kuliga/group-trainings');
        const data = await response.json();
        
        if (!data.success) {
            console.error('Ошибка загрузки групповых тренировок');
            return;
        }
        
        renderGroupTrainings(data.trainings);
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

function renderGroupTrainings(trainings) {
    const container = document.getElementById('kuligaGroupList');
    
    if (!container) return;
    
    if (trainings.length === 0) {
        container.innerHTML = '<p class="no-trainings">В ближайшее время нет групповых тренировок</p>';
        return;
    }
    
    container.innerHTML = trainings.map(training => {
        const freePlaces = training.max_participants - training.current_participants;
        const dateFormatted = new Date(training.date).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: 'long',
            weekday: 'short'
        });
        
        return `
            <div class="kuliga-group-item">
                <div class="kuliga-group-item__header">
                    <h4>${training.level}</h4>
                    <span class="sport-badge">${getSportTypeLabel(training.sport_type)}</span>
                </div>
                <p class="kuliga-group-item__date">${dateFormatted}, ${training.start_time.substring(0, 5)}</p>
                ${training.description ? `<p class="kuliga-group-item__description">${training.description}</p>` : ''}
                <div class="kuliga-group-item__info">
                    <span>👥 Свободно мест: <strong>${freePlaces}</strong></span>
                    <span>💰 <strong>${training.price_per_person} ₽</strong> за человека</span>
                </div>
                <div class="kuliga-group-item__actions">
                    <button class="kuliga-group-item__book-btn" 
                            data-training-id="${training.id}"
                            data-price="${training.price_per_person}">
                        Записаться
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Добавить обработчики кнопок "Записаться"
    container.querySelectorAll('.kuliga-group-item__book-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const trainingId = e.target.dataset.trainingId;
            const price = e.target.dataset.price;
            window.location.href = `/instruktora-kuliga/booking?type=group&training_id=${trainingId}&price=${price}`;
        });
    });
}
```

---

### Этап 4: Миграция данных
**Срок:** 1 день

#### 4.1 Скрипт миграции слотов из `winter_schedule` в `kuliga_schedule_slots`

**Файл:** `scripts/migrate-winter-schedule-to-kuliga.js`

```javascript
const { pool } = require('../src/db');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';

async function migrateWinterScheduleToKuliga() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Начало миграции winter_schedule → kuliga_schedule_slots');
        
        await client.query('BEGIN');
        
        // Получаем ID Тебякина Данила из kuliga_instructors
        const instructorResult = await client.query(
            `SELECT id FROM kuliga_instructors 
             WHERE full_name ILIKE '%Тебякин%Данил%' OR full_name ILIKE '%Данил%Тебякин%'
             LIMIT 1`
        );
        
        if (instructorResult.rows.length === 0) {
            throw new Error('❌ Инструктор Тебякин Данил не найден в kuliga_instructors');
        }
        
        const instructorId = instructorResult.rows[0].id;
        console.log(`✅ Найден инструктор ID: ${instructorId}`);
        
        // Получаем все индивидуальные слоты из winter_schedule
        const slotsResult = await client.query(
            `SELECT 
                date, 
                time_slot,
                is_available,
                trainer_id
             FROM winter_schedule
             WHERE is_individual_training = true
               AND date >= CURRENT_DATE
             ORDER BY date, time_slot`
        );
        
        console.log(`📊 Найдено ${slotsResult.rows.length} слотов для миграции`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const slot of slotsResult.rows) {
            const startTime = slot.time_slot;
            const endTime = moment.tz(`${slot.date}T${startTime}`, TIMEZONE)
                .add(1, 'hour')
                .format('HH:mm:ss');
            
            const status = slot.is_available ? 'available' : 'booked';
            
            try {
                // Проверяем, существует ли уже такой слот
                const existingSlot = await client.query(
                    `SELECT id FROM kuliga_schedule_slots
                     WHERE instructor_id = $1 AND date = $2 AND start_time = $3`,
                    [instructorId, slot.date, startTime]
                );
                
                if (existingSlot.rows.length > 0) {
                    skippedCount++;
                    continue;
                }
                
                // Создаем слот в kuliga_schedule_slots
                await client.query(
                    `INSERT INTO kuliga_schedule_slots (
                        instructor_id, date, start_time, end_time, status
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [instructorId, slot.date, startTime, endTime, status]
                );
                
                migratedCount++;
                
            } catch (error) {
                console.error(`❌ Ошибка миграции слота ${slot.date} ${startTime}:`, error.message);
            }
        }
        
        await client.query('COMMIT');
        
        console.log('✅ Миграция завершена');
        console.log(`   Перенесено: ${migratedCount}`);
        console.log(`   Пропущено (уже существуют): ${skippedCount}`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка миграции:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запуск миграции
migrateWinterScheduleToKuliga()
    .then(() => {
        console.log('🎉 Миграция успешно завершена');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Миграция провалилась:', error);
        process.exit(1);
    });
```

#### 4.2 Запуск миграции

```bash
# Активировать виртуальное окружение (если нужно)
source venv-landing/bin/activate

# Запустить скрипт миграции
node scripts/migrate-winter-schedule-to-kuliga.js
```

---

### Этап 5: Deprecation `winter_schedule`
**Срок:** 0.5 дня

#### 5.1 Добавить комментарий в schema.sql

```sql
-- DEPRECATED: Таблица winter_schedule больше не используется
-- Заменена на kuliga_schedule_slots для унификации системы
-- Дата устаревания: 18 ноября 2025
-- Можно удалить после: 18 декабря 2025
CREATE TABLE winter_schedule (
    ...
);
```

#### 5.2 Переименовать таблицу (опционально)

```sql
ALTER TABLE winter_schedule RENAME TO winter_schedule_deprecated;
```

---

## 📝 Чеклист миграции

### Перед началом:
- [ ] Создать резервную копию базы данных
- [ ] Убедиться, что в `kuliga_instructors` есть запись Тебякина Данила
- [ ] Создать ветку в Git: `git checkout -b migration/kuliga-schedule-unification`

### Этап 1: Личный кабинет инструктора
- [ ] Добавить раздел "Групповые тренировки" в `trainer_kuliga.html`
- [ ] Реализовать JavaScript для управления групповыми тренировками
- [ ] Добавить API-эндпоинты `/api/kuliga/instructor/group-trainings`
- [ ] Протестировать создание групповой тренировки

### Этап 2: Обновление бота
- [ ] Заменить `showNaturalSlopeAvailableDates()` на `kuliga_schedule_slots`
- [ ] Заменить `showNaturalSlopeTimeSlots()` на `kuliga_schedule_slots`
- [ ] Заменить `showAvailableGroupTrainings()` на `kuliga_group_trainings`
- [ ] Обновить логику бронирования индивидуальных тренировок
- [ ] Обновить логику бронирования групповых тренировок
- [ ] Обновить отображение бронирований клиента
- [ ] Протестировать запись через бота

### Этап 3: Обновление сайта
- [ ] Добавить эндпоинт `/api/kuliga/group-trainings`
- [ ] Реализовать `loadGroupTrainings()` в `kuliga.js`
- [ ] Обновить страницу бронирования для групповых тренировок
- [ ] Протестировать запись через сайт

### Этап 4: Миграция данных
- [ ] Создать скрипт `migrate-winter-schedule-to-kuliga.js`
- [ ] Запустить миграцию на тестовой БД
- [ ] Проверить результаты миграции
- [ ] Запустить миграцию на продакшн БД

### Этап 5: Финализация
- [ ] Отметить `winter_schedule` как deprecated
- [ ] Обновить документацию
- [ ] Протестировать всю систему end-to-end
- [ ] Создать Pull Request
- [ ] Code Review
- [ ] Деплой на продакшн

---

## 🧪 Сценарии тестирования

### Тест 1: Создание слотов инструктором
1. Войти в личный кабинет инструктора
2. Создать слоты на следующую неделю
3. Проверить, что слоты появились в БД с `status = 'available'`

### Тест 2: Создание групповой тренировки
1. Выбрать свободный слот
2. Заполнить форму групповой тренировки
3. Создать тренировку
4. Проверить: слот изменил статус на `'group'`, запись в `kuliga_group_trainings`

### Тест 3: Запись через бота (индивидуальная)
1. Открыть бота клиента
2. Выбрать "Зимние тренировки" → "Индивидуальная"
3. Выбрать дату и время
4. Заполнить данные, оплатить
5. Проверить: запись в `kuliga_bookings`, слот → `'booked'`

### Тест 4: Запись через бота (групповая)
1. Открыть бота клиента
2. Выбрать "Зимние тренировки" → "Групповая"
3. Выбрать тренировку, записаться
4. Проверить: запись в `kuliga_bookings`, `current_participants` увеличен

### Тест 5: Запись через сайт
1. Открыть https://gornostyle72.ru/instruktora-kuliga
2. Выбрать групповую тренировку
3. Заполнить форму, оплатить
4. Проверить: запись в `kuliga_bookings`

### Тест 6: Отмена групповой тренировки инструктором
1. Войти в личный кабинет
2. Отменить групповую тренировку с участниками
3. Проверить: статус → `'cancelled'`, клиентам отправлены уведомления

---

## 🚨 Риски и митигация

### Риск 1: Потеря данных при миграции
**Митигация:** 
- Резервная копия БД перед миграцией
- Скрипт проверяет существующие слоты перед вставкой
- Транзакции для атомарности

### Риск 2: Конфликты при одновременной записи
**Митигация:**
- Использовать `FOR UPDATE` при проверке доступности слотов
- Транзакции в бронировании

### Риск 3: Ботs продолжает использовать старые таблицы
**Митигация:**
- Поэтапное обновление с тестированием
- Мониторинг логов бота после деплоя

---

## 📊 Метрики успеха

- [ ] Все слоты из `winter_schedule` перенесены в `kuliga_schedule_slots`
- [ ] Бот клиентов корректно отображает слоты из новой таблицы
- [ ] Запись через бота работает без ошибок
- [ ] Запись через сайт работает без ошибок
- [ ] Инструкторы могут создавать групповые тренировки
- [ ] Нет критических ошибок в логах 24 часа после деплоя

---

## 🎯 Итоговая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                   КЛИЕНТСКАЯ ЧАСТЬ                          │
├─────────────────────────────────────────────────────────────┤
│  • Телеграм-бот клиентов                                    │
│  • Сайт gornostyle72.ru/instruktora-kuliga                  │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      API СЛОЙ                               │
├─────────────────────────────────────────────────────────────┤
│  • /api/kuliga/availability (индивидуальные слоты)          │
│  • /api/kuliga/group-trainings (групповые тренировки)       │
│  • /api/kuliga/bookings (бронирование)                      │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  БАЗА ДАННЫХ                                │
├─────────────────────────────────────────────────────────────┤
│  ✅ kuliga_schedule_slots (расписание всех инструкторов)    │
│  ✅ kuliga_group_trainings (групповые тренировки)           │
│  ✅ kuliga_bookings (все бронирования)                      │
│  ✅ kuliga_instructors (инструкторы, включая Тебякина)      │
│  ✅ kuliga_clients (клиенты)                                │
│  ✅ kuliga_transactions (платежи)                           │
│  ❌ winter_schedule (DEPRECATED, можно удалить)             │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│                ИНСТРУКТОРСКАЯ ЧАСТЬ                         │
├─────────────────────────────────────────────────────────────┤
│  • Личный кабинет trainer_kuliga.html                       │
│  • Создание слотов расписания                               │
│  • Создание групповых тренировок                            │
│  • Управление расписанием                                   │
└─────────────────────────────────────────────────────────────┘
```

---

**Готовы начать миграцию?** 🚀

