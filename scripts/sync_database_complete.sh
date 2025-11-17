#!/bin/bash
set -euo pipefail

# Скрипт полной синхронизации данных между старой и новой БД
# Старая БД: 90.156.210.24
# Новая БД: 5.129.248.187 (локальная)

OLD_HOST="90.156.210.24"
OLD_USER="root"
OLD_PASS="dWDa22f.XyPjXi"
OLD_DB_USER="batl-zlat"
OLD_DB_PASS="Nemezida2324%)"
OLD_DB_NAME="skisimulator"

NEW_HOST="5.129.248.187"
NEW_USER="root"
NEW_PASS="r4Rrn-?J*bJ4Bv"
NEW_DB_USER="batl-zlat"
NEW_DB_PASS="Nemezida2324%)"
NEW_DB_NAME="skisimulator"

LOG_FILE="/tmp/sync_database_$(date +%Y%m%d_%H%M%S).log"

echo "🚀 Начало полной синхронизации БД..." | tee -a "$LOG_FILE"
echo "📅 $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Функция для выполнения SQL на старой БД
execute_old_db() {
    sshpass -p "$OLD_PASS" ssh -o StrictHostKeyChecking=no "$OLD_USER@$OLD_HOST" \
        "PGPASSWORD='$OLD_DB_PASS' psql -h 127.0.0.1 -U $OLD_DB_USER -d $OLD_DB_NAME -t -A -F'|' -c \"$1\""
}

# Функция для выполнения SQL на новой БД
execute_new_db() {
    sshpass -p "$NEW_PASS" ssh -o StrictHostKeyChecking=no "$NEW_USER@$NEW_HOST" \
        "PGPASSWORD='$NEW_DB_PASS' psql -h 127.0.0.1 -U $NEW_DB_USER -d $NEW_DB_NAME -t -A -F'|' -c \"$1\""
}

# Функция для выполнения SQL INSERT/UPDATE на новой БД
execute_new_db_write() {
    sshpass -p "$NEW_PASS" ssh -o StrictHostKeyChecking=no "$NEW_USER@$NEW_HOST" \
        "PGPASSWORD='$NEW_DB_PASS' psql -h 127.0.0.1 -U $NEW_DB_USER -d $NEW_DB_NAME -c \"$1\""
}

# 1. Синхронизация кошельков
echo "💰 Синхронизация кошельков..." | tee -a "$LOG_FILE"
all_wallets=$(execute_old_db "SELECT w.id, w.client_id, w.balance, w.last_updated, w.wallet_number FROM wallets w ORDER BY w.client_id;")

if [ -n "$all_wallets" ]; then
    count_added=0
    echo "$all_wallets" | while IFS='|' read -r id client_id balance last_updated wallet_number; do
        if [ -n "$client_id" ]; then
            # Проверяем, существует ли кошелек в новой БД
            exists=$(execute_new_db "SELECT COUNT(*) FROM wallets WHERE client_id = $client_id;")
            if [ "$exists" = "0" ]; then
                echo "  ➕ Добавление кошелька для client_id=$client_id (wallet_number=$wallet_number, balance=$balance)" | tee -a "$LOG_FILE"
                execute_new_db_write "INSERT INTO wallets (client_id, balance, last_updated, wallet_number) VALUES ($client_id, $balance, '$last_updated', '$wallet_number');" 2>&1 | tee -a "$LOG_FILE"
                count_added=$((count_added + 1))
            fi
        fi
    done
    echo "  ✅ Кошельки проверены и синхронизированы" | tee -a "$LOG_FILE"
else
    echo "  ⚠️  Не удалось получить список кошельков из старой БД" | tee -a "$LOG_FILE"
fi

# 2. Синхронизация индивидуальных тренировок
echo "" | tee -a "$LOG_FILE"
echo "🏂 Синхронизация индивидуальных тренировок..." | tee -a "$LOG_FILE"
missing_trainings=$(execute_old_db "SELECT id, client_id, child_id, trainer_id, simulator_id, preferred_date, preferred_time, duration, price, equipment_type, with_trainer, created_at, updated_at FROM individual_training_sessions ORDER BY id;")

if [ -n "$missing_trainings" ]; then
    echo "$missing_trainings" | while IFS='|' read -r id client_id child_id trainer_id simulator_id preferred_date preferred_time duration price equipment_type with_trainer created_at updated_at; do
        if [ -n "$id" ]; then
            # Проверяем, существует ли запись в новой БД
            exists=$(execute_new_db "SELECT COUNT(*) FROM individual_training_sessions WHERE id = $id;")
            if [ "$exists" = "0" ]; then
                # Экранируем NULL значения
                child_id_sql="${child_id:-NULL}"
                trainer_id_sql="${trainer_id:-NULL}"
                simulator_id_sql="${simulator_id:-NULL}"
                price_sql="${price:-0}"
                if [ "$child_id_sql" != "NULL" ]; then child_id_sql="'$child_id_sql'"; fi
                if [ "$trainer_id_sql" != "NULL" ]; then trainer_id_sql="'$trainer_id_sql'"; fi
                if [ "$simulator_id_sql" != "NULL" ]; then simulator_id_sql="'$simulator_id_sql'"; fi
                
                echo "  ➕ Добавление индивидуальной тренировки id=$id для client_id=$client_id" | tee -a "$LOG_FILE"
                execute_new_db_write "INSERT INTO individual_training_sessions (id, client_id, child_id, trainer_id, simulator_id, preferred_date, preferred_time, duration, price, equipment_type, with_trainer, created_at, updated_at) VALUES ($id, $client_id, $child_id_sql, $trainer_id_sql, $simulator_id_sql, '$preferred_date', '$preferred_time', $duration, $price_sql, '$equipment_type', ${with_trainer:-false}, '$created_at', '$updated_at') ON CONFLICT (id) DO NOTHING;" 2>&1 | tee -a "$LOG_FILE"
            fi
        fi
    done
else
    echo "  ✅ Все индивидуальные тренировки синхронизированы" | tee -a "$LOG_FILE"
fi

# 3. Синхронизация детей
echo "" | tee -a "$LOG_FILE"
echo "👶 Синхронизация детей..." | tee -a "$LOG_FILE"
missing_children=$(execute_old_db "SELECT id, parent_id, full_name, birth_date, skill_level, created_at, updated_at FROM children ORDER BY id;")

if [ -n "$missing_children" ]; then
    echo "$missing_children" | while IFS='|' read -r id parent_id full_name birth_date skill_level created_at updated_at; do
        if [ -n "$id" ]; then
            exists=$(execute_new_db "SELECT COUNT(*) FROM children WHERE id = $id;")
            if [ "$exists" = "0" ]; then
                skill_level_sql="${skill_level:-NULL}"
                birth_date_sql="${birth_date:-NULL}"
                if [ "$birth_date_sql" != "NULL" ]; then birth_date_sql="'$birth_date_sql'"; fi
                if [ "$skill_level_sql" != "NULL" ]; then skill_level_sql="'$skill_level_sql'"; fi
                
                echo "  ➕ Добавление ребенка id=$id для parent_id=$parent_id" | tee -a "$LOG_FILE"
                execute_new_db_write "INSERT INTO children (id, parent_id, full_name, birth_date, skill_level, created_at, updated_at) VALUES ($id, $parent_id, '${full_name//\'/\'\'}', $birth_date_sql, $skill_level_sql, '$created_at', '$updated_at') ON CONFLICT (id) DO NOTHING;" 2>&1 | tee -a "$LOG_FILE"
            fi
        fi
    done
else
    echo "  ✅ Все дети синхронизированы" | tee -a "$LOG_FILE"
fi

# 4. Синхронизация транзакций
echo "" | tee -a "$LOG_FILE"
echo "💳 Синхронизация транзакций..." | tee -a "$LOG_FILE"
all_transactions=$(execute_old_db "SELECT id, wallet_id, amount, type, description, card_number, created_at FROM transactions ORDER BY id;")

if [ -n "$all_transactions" ]; then
    count_added=0
    echo "$all_transactions" | while IFS='|' read -r id wallet_id amount type description card_number created_at; do
        if [ -n "$id" ]; then
            exists=$(execute_new_db "SELECT COUNT(*) FROM transactions WHERE id = $id;")
            if [ "$exists" = "0" ]; then
                description_sql="${description:-\'\'}"
                card_number_sql="${card_number:-NULL}"
                if [ "$card_number_sql" != "NULL" ]; then card_number_sql="'$card_number_sql'"; fi
                if [ "$description_sql" != "''" ]; then description_sql="'${description//\'/\'\'}'"; fi
                
                echo "  ➕ Добавление транзакции id=$id для wallet_id=$wallet_id" | tee -a "$LOG_FILE"
                execute_new_db_write "INSERT INTO transactions (id, wallet_id, amount, type, description, card_number, created_at) VALUES ($id, $wallet_id, $amount, '${type//\'/\'\'}', $description_sql, $card_number_sql, '$created_at') ON CONFLICT (id) DO NOTHING;" 2>&1 | tee -a "$LOG_FILE"
                count_added=$((count_added + 1))
            fi
        fi
    done
    echo "  ✅ Транзакции проверены и синхронизированы" | tee -a "$LOG_FILE"
else
    echo "  ⚠️  Не удалось получить список транзакций из старой БД" | tee -a "$LOG_FILE"
fi

# 5. Синхронизация training_sessions и session_participants
echo "" | tee -a "$LOG_FILE"
echo "🏋️ Синхронизация training_sessions и session_participants..." | tee -a "$LOG_FILE"
all_sessions=$(execute_old_db "SELECT id, simulator_id, trainer_id, group_id, session_date, start_time, end_time, duration, training_type, max_participants, skill_level, price, status, equipment_type, with_trainer, created_at, updated_at FROM training_sessions ORDER BY id;")

if [ -n "$all_sessions" ]; then
    echo "$all_sessions" | while IFS='|' read -r id simulator_id trainer_id group_id session_date start_time end_time duration training_type max_participants skill_level price status equipment_type with_trainer created_at updated_at; do
        if [ -n "$id" ]; then
            exists=$(execute_new_db "SELECT COUNT(*) FROM training_sessions WHERE id = $id;")
            if [ "$exists" = "0" ]; then
                simulator_id_sql="${simulator_id:-NULL}"
                trainer_id_sql="${trainer_id:-NULL}"
                group_id_sql="${group_id:-NULL}"
                skill_level_sql="${skill_level:-NULL}"
                if [ "$simulator_id_sql" != "NULL" ]; then simulator_id_sql="'$simulator_id_sql'"; fi
                if [ "$trainer_id_sql" != "NULL" ]; then trainer_id_sql="'$trainer_id_sql'"; fi
                if [ "$group_id_sql" != "NULL" ]; then group_id_sql="'$group_id_sql'"; fi
                if [ "$skill_level_sql" != "NULL" ]; then skill_level_sql="'$skill_level_sql'"; fi
                
                echo "  ➕ Добавление training_session id=$id" | tee -a "$LOG_FILE"
                execute_new_db_write "INSERT INTO training_sessions (id, simulator_id, trainer_id, group_id, session_date, start_time, end_time, duration, training_type, max_participants, skill_level, price, status, equipment_type, with_trainer, created_at, updated_at) VALUES ($id, $simulator_id_sql, $trainer_id_sql, $group_id_sql, '$session_date', '$start_time', '$end_time', $duration, ${training_type:-false}, $max_participants, $skill_level_sql, $price, '$status', '$equipment_type', ${with_trainer:-false}, '$created_at', '$updated_at') ON CONFLICT (id) DO NOTHING;" 2>&1 | tee -a "$LOG_FILE"
            fi
        fi
    done
    echo "  ✅ Training sessions проверены и синхронизированы" | tee -a "$LOG_FILE"
fi

all_participants=$(execute_old_db "SELECT id, session_id, client_id, child_id, is_child, status, created_at, updated_at FROM session_participants ORDER BY id;")

if [ -n "$all_participants" ]; then
    echo "$all_participants" | while IFS='|' read -r id session_id client_id child_id is_child status created_at updated_at; do
        if [ -n "$id" ]; then
            exists=$(execute_new_db "SELECT COUNT(*) FROM session_participants WHERE id = $id;")
            if [ "$exists" = "0" ]; then
                child_id_sql="${child_id:-NULL}"
                if [ "$child_id_sql" != "NULL" ]; then child_id_sql="'$child_id_sql'"; fi
                
                echo "  ➕ Добавление session_participant id=$id для session_id=$session_id, client_id=$client_id" | tee -a "$LOG_FILE"
                execute_new_db_write "INSERT INTO session_participants (id, session_id, client_id, child_id, is_child, status, created_at, updated_at) VALUES ($id, $session_id, $client_id, $child_id_sql, ${is_child:-false}, '$status', '$created_at', '$updated_at') ON CONFLICT (id) DO NOTHING;" 2>&1 | tee -a "$LOG_FILE"
            fi
        fi
    done
    echo "  ✅ Session participants проверены и синхронизированы" | tee -a "$LOG_FILE"
fi

# 6. Финальная проверка
echo "" | tee -a "$LOG_FILE"
echo "📊 Финальная проверка..." | tee -a "$LOG_FILE"
echo "Старая БД:" | tee -a "$LOG_FILE"
execute_old_db "SELECT 'clients' as table_name, COUNT(*) as count FROM clients UNION ALL SELECT 'wallets', COUNT(*) FROM wallets UNION ALL SELECT 'children', COUNT(*) FROM children UNION ALL SELECT 'individual_training_sessions', COUNT(*) FROM individual_training_sessions UNION ALL SELECT 'transactions', COUNT(*) FROM transactions ORDER BY table_name;" | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "Новая БД:" | tee -a "$LOG_FILE"
execute_new_db "SELECT 'clients' as table_name, COUNT(*) as count FROM clients UNION ALL SELECT 'wallets', COUNT(*) FROM wallets UNION ALL SELECT 'children', COUNT(*) FROM children UNION ALL SELECT 'individual_training_sessions', COUNT(*) FROM individual_training_sessions UNION ALL SELECT 'transactions', COUNT(*) FROM transactions ORDER BY table_name;" | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "✅ Синхронизация завершена!" | tee -a "$LOG_FILE"
echo "📄 Лог сохранен в: $LOG_FILE" | tee -a "$LOG_FILE"

