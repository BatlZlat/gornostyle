# 💰 Расчет зарплаты инструктора и очистка тестовых данных

## 📊 Как считается зарплата инструктора

### Формула расчета

```
Заработок инструктора = price_total × (1 - admin_percentage / 100)
Комиссия администратора = price_total × (admin_percentage / 100)
```

**Где:**
- `price_total` - общая стоимость тренировки из таблицы `kuliga_bookings`
- `admin_percentage` - процент администратора из таблицы `kuliga_instructors` (по умолчанию 20%)

### Пример расчета

**Дано:**
- Стоимость тренировки: 2700 ₽
- Процент администратора: 20%

**Расчет:**
- Заработок инструктора: `2700 × (1 - 20/100) = 2700 × 0.8 = 2160 ₽`
- Доля администратора: `2700 × 0.2 = 540 ₽`

### Какие тренировки учитываются в зарплате?

Учитываются только тренировки, которые:
1. **Завершены** (статус `completed`) ИЛИ
2. **Подтверждены** (статус `confirmed`) И уже прошли по времени

**Статусы бронирований:**
- `pending` - создано, но не оплачено → **не начисляется**
- `confirmed` - оплачено → **начисляется** (если прошло по времени)
- `completed` - тренировка проведена → **начисляется**
- `cancelled` / `refunded` - отменено/возврат → **не начисляется**

### Таблицы, участвующие в расчете

1. **`kuliga_bookings`** - бронирования (индивидуальные и групповые)
   - `price_total` - общая стоимость
   - `status` - статус бронирования
   - `instructor_id` или через `group_training_id → kuliga_group_trainings.instructor_id`
   - `date`, `start_time`, `end_time` - для определения прошедших тренировок

2. **`kuliga_instructors`** - данные инструктора
   - `admin_percentage` - процент администратора (индивидуальный для каждого)
   - По умолчанию: 20%

3. **`kuliga_instructor_payouts`** - выплаты инструкторам
   - Суммирует заработок за период
   - Статус выплаты: `pending`, `paid`, `cancelled`

---

## 🧹 Очистка тестовых данных

### ⚠️ ВАЖНО: Перед очисткой

1. **Создайте резервную копию базы данных:**
   ```bash
   pg_dump -U your_user -d skisimulator > backup_before_cleanup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Проверьте, какие данные будут удалены:**
   - Запустите SQL-запросы с `SELECT` перед удалением
   - Убедитесь, что удаляете только тестовые данные

3. **Остановите приложение** на время очистки (опционально, но рекомендуется)

### 📋 Таблицы для очистки (в порядке зависимостей)

#### 1. `kuliga_transactions` (Транзакции)

**Описание:** Все платежи, возвраты, выплаты инструкторам

**Что удалять:**
- Транзакции, связанные с тестовыми бронированиями
- Тестовые выплаты инструкторам

```sql
-- Посмотреть тестовые транзакции
SELECT * FROM kuliga_transactions 
WHERE booking_id IN (
    SELECT id FROM kuliga_bookings 
    WHERE client_id IN (
        SELECT id FROM kuliga_clients 
        WHERE full_name LIKE '%тест%' OR phone LIKE '%тест%'
    )
);

-- Удалить тестовые транзакции
DELETE FROM kuliga_transactions 
WHERE booking_id IN (
    SELECT id FROM kuliga_bookings 
    WHERE client_id IN (
        SELECT id FROM kuliga_clients 
        WHERE full_name LIKE '%тест%' OR phone LIKE '%тест%'
    )
);
```

---

#### 2. `kuliga_bookings` (Бронирования)

**Описание:** Все бронирования клиентов (индивидуальные и групповые тренировки)

**Что удалять:**
- Тестовые бронирования конкретного инструктора
- Бронирования тестовых клиентов
- Бронирования за определенный период (тестовый)

```sql
-- Посмотреть тестовые бронирования конкретного инструктора
SELECT * FROM kuliga_bookings 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND (date < '2025-12-05' OR client_id IN (
      SELECT id FROM kuliga_clients 
      WHERE full_name LIKE '%тест%'
  ));

-- Удалить тестовые бронирования
DELETE FROM kuliga_bookings 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND (date < '2025-12-05' OR client_id IN (
      SELECT id FROM kuliga_clients 
      WHERE full_name LIKE '%тест%'
  ));
```

**Вариант:** Удалить все бронирования до определенной даты:
```sql
DELETE FROM kuliga_bookings 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND date < '2025-12-05';  -- Дата начала продакшена
```

---

#### 3. `kuliga_group_trainings` (Групповые тренировки)

**Описание:** Групповые тренировки, созданные инструктором

**Что удалять:**
- Тестовые групповые тренировки инструктора
- Тренировки без бронирований (если они были только тестовые)

```sql
-- Посмотреть тестовые групповые тренировки
SELECT * FROM kuliga_group_trainings 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND (date < '2025-12-05' OR id NOT IN (
      SELECT DISTINCT group_training_id 
      FROM kuliga_bookings 
      WHERE group_training_id IS NOT NULL
  ));

-- Удалить тестовые групповые тренировки
DELETE FROM kuliga_group_trainings 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND date < '2025-12-05';
```

**Важно:** Убедитесь, что нет связанных бронирований перед удалением!

---

#### 4. `kuliga_schedule_slots` (Слоты расписания)

**Описание:** Временные слоты в расписании инструктора

**Что удалять:**
- Прошедшие тестовые слоты
- Слоты без связанных тренировок

```sql
-- Посмотреть тестовые слоты
SELECT * FROM kuliga_schedule_slots 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND date < '2025-12-05';

-- Удалить тестовые слоты
DELETE FROM kuliga_schedule_slots 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND date < '2025-12-05';
```

---

#### 5. `kuliga_instructor_payouts` (Выплаты инструкторам)

**Описание:** Выплаты зарплаты инструкторам за периоды

**Что удалять:**
- Тестовые выплаты (если создавались)
- Неоплаченные выплаты за тестовый период

```sql
-- Посмотреть тестовые выплаты
SELECT * FROM kuliga_instructor_payouts 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND period_start < '2025-12-05';

-- Удалить тестовые выплаты (только если статус pending или они точно тестовые)
DELETE FROM kuliga_instructor_payouts 
WHERE instructor_id = YOUR_INSTRUCTOR_ID
  AND period_start < '2025-12-05'
  AND status = 'pending';  -- Удаляем только неоплаченные
```

**⚠️ Осторожно!** Не удаляйте выплаты со статусом `paid`, если они реальные!

---

#### 6. Дополнительные таблицы (если используются)

**`kuliga_programs`** - программы тренировок
```sql
-- Удалить тестовые программы (если нужно)
DELETE FROM kuliga_programs 
WHERE created_at < '2025-12-05';
```

**`kuliga_program_instructors`** - связь программ и инструкторов
```sql
-- Удалить связи тестовых программ
DELETE FROM kuliga_program_instructors 
WHERE program_id IN (
    SELECT id FROM kuliga_programs 
    WHERE created_at < '2025-12-05'
);
```

---

### 🔧 Готовый скрипт для очистки

Создайте файл `scripts/cleanup-test-kuliga-data.js`:

```javascript
const { pool } = require('../src/db/index');
require('dotenv').config();

const INSTRUCTOR_ID = process.env.CLEANUP_INSTRUCTOR_ID || null; // ID инструктора
const CLEANUP_DATE = process.env.CLEANUP_DATE || '2025-12-05'; // Дата до которой удалять
const DRY_RUN = process.env.DRY_RUN !== 'false'; // true = только показать, false = удалить

async function cleanupTestData() {
    const client = await pool.connect();
    
    try {
        if (!INSTRUCTOR_ID) {
            console.error('❌ Укажите CLEANUP_INSTRUCTOR_ID в переменных окружения');
            process.exit(1);
        }

        console.log(`🧹 Очистка тестовых данных для инструктора ID: ${INSTRUCTOR_ID}`);
        console.log(`📅 Дата отсечки: ${CLEANUP_DATE}`);
        console.log(`🔍 Режим: ${DRY_RUN ? 'ПРОСМОТР (DRY RUN)' : 'УДАЛЕНИЕ'}\n`);

        await client.query('BEGIN');

        // 1. Проверка и удаление транзакций
        console.log('1️⃣ Проверка транзакций...');
        const transactionsCount = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_transactions 
            WHERE booking_id IN (
                SELECT id FROM kuliga_bookings 
                WHERE instructor_id = $1 OR group_training_id IN (
                    SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
                )
                AND date < $2::date
            )
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        console.log(`   Найдено транзакций: ${transactionsCount.rows[0].count}`);

        if (!DRY_RUN && parseInt(transactionsCount.rows[0].count) > 0) {
            await client.query(`
                DELETE FROM kuliga_transactions 
                WHERE booking_id IN (
                    SELECT id FROM kuliga_bookings 
                    WHERE (instructor_id = $1 OR group_training_id IN (
                        SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
                    ))
                    AND date < $2::date
                )
            `, [INSTRUCTOR_ID, CLEANUP_DATE]);
            console.log('   ✅ Транзакции удалены');
        }

        // 2. Проверка и удаление бронирований
        console.log('\n2️⃣ Проверка бронирований...');
        const bookingsCount = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_bookings 
            WHERE (instructor_id = $1 OR group_training_id IN (
                SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
            ))
            AND date < $2::date
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        console.log(`   Найдено бронирований: ${bookingsCount.rows[0].count}`);

        if (!DRY_RUN && parseInt(bookingsCount.rows[0].count) > 0) {
            await client.query(`
                DELETE FROM kuliga_bookings 
                WHERE (instructor_id = $1 OR group_training_id IN (
                    SELECT id FROM kuliga_group_trainings WHERE instructor_id = $1
                ))
                AND date < $2::date
            `, [INSTRUCTOR_ID, CLEANUP_DATE]);
            console.log('   ✅ Бронирования удалены');
        }

        // 3. Проверка и удаление групповых тренировок
        console.log('\n3️⃣ Проверка групповых тренировок...');
        const trainingsCount = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_group_trainings 
            WHERE instructor_id = $1
            AND date < $2::date
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        console.log(`   Найдено групповых тренировок: ${trainingsCount.rows[0].count}`);

        if (!DRY_RUN && parseInt(trainingsCount.rows[0].count) > 0) {
            await client.query(`
                DELETE FROM kuliga_group_trainings 
                WHERE instructor_id = $1
                AND date < $2::date
            `, [INSTRUCTOR_ID, CLEANUP_DATE]);
            console.log('   ✅ Групповые тренировки удалены');
        }

        // 4. Проверка и удаление слотов
        console.log('\n4️⃣ Проверка слотов расписания...');
        const slotsCount = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_schedule_slots 
            WHERE instructor_id = $1
            AND date < $2::date
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        console.log(`   Найдено слотов: ${slotsCount.rows[0].count}`);

        if (!DRY_RUN && parseInt(slotsCount.rows[0].count) > 0) {
            await client.query(`
                DELETE FROM kuliga_schedule_slots 
                WHERE instructor_id = $1
                AND date < $2::date
            `, [INSTRUCTOR_ID, CLEANUP_DATE]);
            console.log('   ✅ Слоты удалены');
        }

        // 5. Проверка выплат (только pending)
        console.log('\n5️⃣ Проверка выплат...');
        const payoutsCount = await client.query(`
            SELECT COUNT(*) as count
            FROM kuliga_instructor_payouts 
            WHERE instructor_id = $1
            AND period_start < $2::date
            AND status = 'pending'
        `, [INSTRUCTOR_ID, CLEANUP_DATE]);
        console.log(`   Найдено неоплаченных выплат: ${payoutsCount.rows[0].count}`);

        if (!DRY_RUN && parseInt(payoutsCount.rows[0].count) > 0) {
            await client.query(`
                DELETE FROM kuliga_instructor_payouts 
                WHERE instructor_id = $1
                AND period_start < $2::date
                AND status = 'pending'
            `, [INSTRUCTOR_ID, CLEANUP_DATE]);
            console.log('   ✅ Выплаты удалены');
        }

        if (DRY_RUN) {
            await client.query('ROLLBACK');
            console.log('\n✅ DRY RUN завершен. Данные НЕ удалены.');
            console.log('   Для реального удаления установите DRY_RUN=false');
        } else {
            await client.query('COMMIT');
            console.log('\n✅ Очистка завершена успешно!');
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при очистке:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

cleanupTestData()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
```

### Использование скрипта

```bash
# 1. Только просмотр (безопасно)
CLEANUP_INSTRUCTOR_ID=1 CLEANUP_DATE=2025-12-05 DRY_RUN=true node scripts/cleanup-test-kuliga-data.js

# 2. Реальное удаление
CLEANUP_INSTRUCTOR_ID=1 CLEANUP_DATE=2025-12-05 DRY_RUN=false node scripts/cleanup-test-kuliga-data.js
```

---

## 📝 Рекомендации по очистке

### 1. Очистка по дате

**Рекомендуемый подход:** Удалить все данные до даты начала продакшена (например, до 5 декабря 2025).

```sql
-- Установите дату начала продакшена
SET @production_start_date = '2025-12-05';

-- Затем удаляйте все до этой даты
```

### 2. Очистка конкретного инструктора

Если нужно очистить данные только для одного инструктора:

```sql
-- Замените YOUR_INSTRUCTOR_ID на реальный ID
SET @instructor_id = YOUR_INSTRUCTOR_ID;

-- Удаляйте с фильтром по instructor_id
```

### 3. Очистка тестовых клиентов

Если создавались отдельные тестовые клиенты:

```sql
-- Найти тестовых клиентов
SELECT * FROM kuliga_clients 
WHERE full_name LIKE '%тест%' 
   OR phone LIKE '%тест%'
   OR email LIKE '%test%';

-- Удалить тестовых клиентов (после удаления всех связанных данных)
DELETE FROM kuliga_clients 
WHERE full_name LIKE '%тест%' 
   OR phone LIKE '%тест%'
   OR email LIKE '%test%';
```

---

## ✅ Чеклист после очистки

После очистки проверьте:

1. ✅ Статистика заработка инструктора обновилась
2. ✅ История тренировок показывает только реальные данные
3. ✅ Календарь инструктора не показывает тестовые слоты
4. ✅ Финансы инструктора корректны
5. ✅ Нет "висящих" ссылок на удаленные записи

---

**Важно:** Всегда создавайте резервную копию перед массовым удалением данных!

