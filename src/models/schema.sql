-- Таблица клиентов
CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 10),
    telegram_id VARCHAR(100) UNIQUE,
    telegram_username VARCHAR(100),
    nickname VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица детей
CREATE TABLE children (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    sport_type VARCHAR(20) NOT NULL, -- ski, snowboard
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица тренеров
CREATE TABLE trainers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    birth_date DATE NOT NULL,
    sport_type VARCHAR(20) NOT NULL, -- ski, snowboard, both
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    hire_date DATE NOT NULL,
    dismissal_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    photo_url VARCHAR(255)
);

-- Таблица администраторов
CREATE TABLE administrators (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица тренажеров
CREATE TABLE simulators (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_working BOOLEAN DEFAULT true, -- true = в работе, false = не работает
    working_hours_start TIME DEFAULT '10:00',
    working_hours_end TIME DEFAULT '21:00',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица групп
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица тренировок
CREATE TABLE training_sessions (
    id SERIAL PRIMARY KEY,
    simulator_id INTEGER REFERENCES simulators(id),
    trainer_id INTEGER REFERENCES trainers(id),
    group_id INTEGER REFERENCES groups(id),
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration INTEGER NOT NULL DEFAULT 60,
    training_type BOOLEAN DEFAULT FALSE, -- FALSE = individual, TRUE = group
    max_participants INTEGER NOT NULL,
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 10),
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, completed, cancelled
    equipment_type VARCHAR(20), -- ski, snowboard
    with_trainer BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица участников тренировок
CREATE TABLE session_participants (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES training_sessions(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),
    child_id INTEGER REFERENCES children(id),
    is_child BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed, cancelled, completed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица сертификатов
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(20) UNIQUE NOT NULL,
    purchaser_id INTEGER REFERENCES clients(id),
    purchase_date TIMESTAMP NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- active, used, expired
    expiry_date TIMESTAMP NOT NULL,
    activated_by_id INTEGER REFERENCES clients(id),
    activation_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица кошельков
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    balance DECIMAL(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    wallet_number VARCHAR(20) UNIQUE NOT NULL
);

-- Таблица транзакций
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER REFERENCES wallets(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(20) NOT NULL, -- payment, refill, amount
    description TEXT,
    card_number VARCHAR(20), -- последние 4 цифры карты
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица расписания
CREATE TABLE schedule (
    id SERIAL PRIMARY KEY,
    simulator_id INTEGER REFERENCES simulators(id),
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_holiday BOOLEAN DEFAULT FALSE,
    is_booked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица прайсов
CREATE TABLE prices (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- 'individual' или 'group'
    with_trainer BOOLEAN NOT NULL,
    duration INTEGER NOT NULL, -- в минутах
    participants INTEGER NOT NULL, -- для групповых занятий
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Таблица заявок на тренировки
CREATE TABLE training_requests (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    child_id INTEGER REFERENCES children(id),
    equipment_type VARCHAR(20) NOT NULL, -- 'ski' или 'snowboard'
    duration INTEGER NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    has_group BOOLEAN DEFAULT FALSE,
    group_size INTEGER,
    training_frequency VARCHAR(20), -- 'regular' или 'one-time'
    skill_level INTEGER CHECK (skill_level BETWEEN 0 AND 10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    group_id INTEGER REFERENCES application_groups(id),
    group_status VARCHAR(50) DEFAULT 'ungrouped'
);

-- Добавляем новую таблицу для индивидуальных тренировок
CREATE TABLE individual_training_sessions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    child_id INTEGER REFERENCES children(id),
    equipment_type VARCHAR(20) NOT NULL,
    with_trainer BOOLEAN NOT NULL,
    duration INTEGER NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    simulator_id INTEGER REFERENCES simulators(id),
    price DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица неудачных платежей
CREATE TABLE failed_payments (
    id SERIAL PRIMARY KEY,
    amount DECIMAL(10,2) NOT NULL,
    wallet_number VARCHAR(20) NOT NULL,
    sms_text TEXT NOT NULL,
    error_type VARCHAR(50) NOT NULL, -- 'wallet_not_found', 'invalid_format', etc.
    processed BOOLEAN DEFAULT FALSE, -- true если платеж был обработан вручную
    processed_by INTEGER REFERENCES administrators(id),
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица логов СМС
CREATE TABLE sms_log (
    id SERIAL PRIMARY KEY,
    sms_text TEXT NOT NULL,
    parsed_data JSONB,
    error_type VARCHAR(50),
    error_details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    processing_status VARCHAR(20) DEFAULT 'pending'
);

-- Таблица миграций
CREATE TABLE migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица групп заявок
CREATE TABLE application_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    equipment_type VARCHAR(50) NOT NULL,
    skill_level INTEGER,
    max_participants INTEGER NOT NULL DEFAULT 4,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    compatibility_score DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица участников групп заявок
CREATE TABLE application_group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES application_groups(id) ON DELETE CASCADE,
    request_id INTEGER REFERENCES training_requests(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, request_id)
);

-- Таблица сообщений
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    text TEXT NOT NULL,
    created_by INTEGER REFERENCES administrators(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица получателей сообщений
CREATE TABLE message_recipients (
    id SERIAL PRIMARY KEY,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    recipient_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица настроек группировки
CREATE TABLE grouping_settings (
    id SERIAL PRIMARY KEY,
    min_group_size INTEGER NOT NULL DEFAULT 2,
    max_group_size INTEGER NOT NULL DEFAULT 4,
    max_group_size_exception INTEGER NOT NULL DEFAULT 6,
    time_range_minutes INTEGER NOT NULL DEFAULT 30,
    min_age INTEGER NOT NULL DEFAULT 4,
    max_age_diff INTEGER NOT NULL DEFAULT 3,
    allow_mixed_groups BOOLEAN NOT NULL DEFAULT FALSE,
    date_weight INTEGER NOT NULL DEFAULT 40,
    time_weight INTEGER NOT NULL DEFAULT 30,
    equipment_weight INTEGER NOT NULL DEFAULT 20,
    age_weight INTEGER NOT NULL DEFAULT 10,
    skill_weight INTEGER NOT NULL DEFAULT 10,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов
CREATE INDEX idx_clients_telegram_id ON clients(telegram_id);
CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_children_parent ON children(parent_id);
CREATE INDEX idx_trainers_is_active ON trainers(is_active);
CREATE INDEX idx_trainers_sport_type ON trainers(sport_type);
CREATE INDEX idx_administrators_username ON administrators(username);
CREATE INDEX idx_training_sessions_date ON training_sessions(session_date);
CREATE INDEX idx_training_sessions_trainer ON training_sessions(trainer_id);
CREATE INDEX idx_session_participants_session ON session_participants(session_id);
CREATE INDEX idx_session_participants_client ON session_participants(client_id);
CREATE INDEX idx_certificates_number ON certificates(certificate_number);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_wallets_client ON wallets(client_id);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_schedule_date ON schedule(date);
CREATE INDEX idx_schedule_simulator ON schedule(simulator_id);
CREATE INDEX idx_training_requests_client ON training_requests(client_id);
CREATE INDEX idx_training_requests_status ON training_requests(status);
CREATE INDEX idx_individual_training_client ON individual_training_sessions(client_id);
CREATE INDEX idx_individual_training_child ON individual_training_sessions(child_id);
CREATE INDEX idx_individual_training_date ON individual_training_sessions(preferred_date);
CREATE INDEX idx_individual_training_simulator ON individual_training_sessions(simulator_id);
CREATE INDEX idx_failed_payments_wallet ON failed_payments(wallet_number);
CREATE INDEX idx_failed_payments_processed ON failed_payments(processed);
CREATE INDEX idx_failed_payments_created ON failed_payments(created_at);
CREATE INDEX idx_sms_log_created_at ON sms_log(created_at);
CREATE INDEX idx_sms_log_processing_status ON sms_log(processing_status);
CREATE INDEX idx_training_requests_equipment ON training_requests(equipment_type);
CREATE INDEX idx_training_requests_group_id ON training_requests(group_id);
CREATE INDEX idx_training_requests_group_status ON training_requests(group_status);
CREATE INDEX idx_training_requests_has_group ON training_requests(has_group);
CREATE INDEX idx_application_groups_date ON application_groups(preferred_date);
CREATE INDEX idx_application_groups_equipment ON application_groups(equipment_type);
CREATE INDEX idx_application_groups_skill ON application_groups(skill_level);
CREATE INDEX idx_application_groups_status ON application_groups(status);
CREATE INDEX idx_application_group_members_group ON application_group_members(group_id);
CREATE INDEX idx_application_group_members_request ON application_group_members(request_id);
CREATE INDEX idx_application_group_members_status ON application_group_members(status);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_created_by ON messages(created_by);
CREATE INDEX idx_message_recipients_message ON message_recipients(message_id);
CREATE INDEX idx_message_recipients_recipient ON message_recipients(recipient_id);
CREATE INDEX idx_message_recipients_status ON message_recipients(status);
CREATE INDEX idx_grouping_settings_active ON grouping_settings(is_active);

-- Создание триггеров для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Применение триггеров к таблицам
CREATE TRIGGER update_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_children_updated_at
    BEFORE UPDATE ON children
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trainers_updated_at
    BEFORE UPDATE ON trainers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_administrators_updated_at
    BEFORE UPDATE ON administrators
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_training_sessions_updated_at
    BEFORE UPDATE ON training_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_participants_updated_at
    BEFORE UPDATE ON session_participants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_certificates_updated_at
    BEFORE UPDATE ON certificates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schedule_updated_at
    BEFORE UPDATE ON schedule
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_application_groups_updated_at
    BEFORE UPDATE ON application_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_application_group_members_updated_at
    BEFORE UPDATE ON application_group_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_recipients_updated_at
    BEFORE UPDATE ON message_recipients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_grouping_settings_updated_at
    BEFORE UPDATE ON grouping_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_training_requests_updated_at
    BEFORE UPDATE ON training_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_individual_training_updated_at
    BEFORE UPDATE ON individual_training_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_failed_payments_updated_at
    BEFORE UPDATE ON failed_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Создаем триггер для обновления слотов при создании/отмене индивидуальных тренировок
CREATE OR REPLACE FUNCTION update_individual_training_slots()
RETURNS TRIGGER AS $$
BEGIN
    -- Добавляем логирование
    RAISE NOTICE 'Триггер update_individual_training_slots: операция %', TG_OP;
    RAISE NOTICE 'Триггер update_individual_training_slots: simulator_id = %, date = %, time = %, duration = %',
        CASE WHEN TG_OP = 'INSERT' THEN NEW.simulator_id ELSE OLD.simulator_id END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.preferred_date ELSE OLD.preferred_date END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.preferred_time ELSE OLD.preferred_time END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.duration ELSE OLD.duration END;

    IF TG_OP = 'INSERT' THEN
        -- При создании тренировки помечаем слоты как занятые
        UPDATE schedule 
        SET is_booked = true
        WHERE simulator_id = NEW.simulator_id
        AND date = NEW.preferred_date
        AND start_time >= NEW.preferred_time
        AND start_time < (NEW.preferred_time + (NEW.duration || ' minutes')::interval);
        RAISE NOTICE 'Триггер update_individual_training_slots: слоты помечены как занятые';
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- При удалении тренировки освобождаем слоты
        UPDATE schedule 
        SET is_booked = false
        WHERE simulator_id = OLD.simulator_id
        AND date = OLD.preferred_date
        AND start_time >= OLD.preferred_time
        AND start_time < (OLD.preferred_time + (OLD.duration || ' minutes')::interval);
        RAISE NOTICE 'Триггер update_individual_training_slots: слоты освобождены';
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Удаляем старый триггер, если он существует
DROP TRIGGER IF EXISTS individual_training_sessions_schedule_trigger ON individual_training_sessions;

-- Создаем новый триггер
CREATE TRIGGER individual_training_sessions_schedule_trigger
AFTER INSERT OR DELETE ON individual_training_sessions
FOR EACH ROW
EXECUTE FUNCTION update_individual_training_slots(); 