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
    email VARCHAR(255),
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

-- Таблица дизайнов сертификатов
CREATE TABLE certificate_designs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url VARCHAR(255) NOT NULL,
    template_url VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица сертификатов
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(12) UNIQUE NOT NULL,
    purchaser_id INTEGER REFERENCES clients(id),
    recipient_name VARCHAR(100),
    recipient_phone VARCHAR(20),
    nominal_value DECIMAL(10,2) NOT NULL,
    design_id INTEGER REFERENCES certificate_designs(id) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- active, used, expired, cancelled
    expiry_date TIMESTAMP NOT NULL,
    activated_by_id INTEGER REFERENCES clients(id),
    activation_date TIMESTAMP,
    message TEXT,
    purchase_date TIMESTAMP NOT NULL,
    pdf_url VARCHAR(255), -- URL к PDF файлу сертификата
    image_url VARCHAR(255), -- URL к изображению сертификата (JPG)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_certificate_number CHECK (certificate_number ~ '^[0-9]{6}$'),
    CONSTRAINT check_certificate_status CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
    CONSTRAINT check_nominal_value CHECK (nominal_value >= 500 AND nominal_value <= 50000),
    CONSTRAINT check_expiry_date CHECK (expiry_date <= purchase_date + INTERVAL '1 year'),
    CONSTRAINT check_message_length CHECK (LENGTH(message) <= 100)
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
    group_status VARCHAR(50) DEFAULT 'ungrouped' -- ungrouped=не выполнена, completed=выполнена(архив), cancelled=отменена(скрыта)
);

-- Таблица индивидуальных тренировок
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

-- Таблица ожидающих сертификатов
CREATE TABLE pending_certificates (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    wallet_number VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    message TEXT,
    nominal_value DECIMAL(10,2) NOT NULL,
    design_id INTEGER REFERENCES certificate_designs(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
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

-- Дополнительные таблицы (представления или служебные таблицы)
-- Таблица активных сертификатов (представление)
CREATE TABLE active_certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(12) UNIQUE NOT NULL,
    purchaser_id INTEGER REFERENCES clients(id),
    recipient_name VARCHAR(100),
    nominal_value DECIMAL(10,2) NOT NULL,
    design_id INTEGER REFERENCES certificate_designs(id) NOT NULL,
    expiry_date TIMESTAMP NOT NULL,
    message TEXT,
    purchase_date TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица использованных сертификатов (представление)
CREATE TABLE used_certificates (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(12) UNIQUE NOT NULL,
    purchaser_id INTEGER REFERENCES clients(id),
    recipient_name VARCHAR(100),
    nominal_value DECIMAL(10,2) NOT NULL,
    design_id INTEGER REFERENCES certificate_designs(id) NOT NULL,
    activated_by_id INTEGER REFERENCES clients(id),
    activation_date TIMESTAMP,
    message TEXT,
    purchase_date TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица полной информации о сертификатах (представление)
CREATE TABLE certificate_full_info (
    id SERIAL PRIMARY KEY,
    certificate_number VARCHAR(12) UNIQUE NOT NULL,
    purchaser_name VARCHAR(100),
    purchaser_phone VARCHAR(20),
    recipient_name VARCHAR(100),
    recipient_phone VARCHAR(20),
    nominal_value DECIMAL(10,2) NOT NULL,
    design_name VARCHAR(100),
    design_image_url VARCHAR(255),
    status VARCHAR(20),
    expiry_date TIMESTAMP,
    activated_by_name VARCHAR(100),
    activation_date TIMESTAMP,
    message TEXT,
    purchase_date TIMESTAMP,
    pdf_url VARCHAR(255),
    image_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица статистики сертификатов (представление)
CREATE TABLE certificate_stats (
    id SERIAL PRIMARY KEY,
    total_certificates INTEGER DEFAULT 0,
    active_certificates INTEGER DEFAULT 0,
    used_certificates INTEGER DEFAULT 0,
    expired_certificates INTEGER DEFAULT 0,
    total_value DECIMAL(15,2) DEFAULT 0,
    active_value DECIMAL(15,2) DEFAULT 0,
    used_value DECIMAL(15,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов
CREATE INDEX idx_clients_telegram_id ON clients(telegram_id);
CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_children_parent ON children(parent_id);
CREATE INDEX idx_trainers_is_active ON trainers(is_active);
CREATE INDEX idx_trainers_sport_type ON trainers(sport_type);
CREATE INDEX idx_administrators_username ON administrators(username);
CREATE INDEX idx_training_sessions_date ON training_sessions(session_date);
CREATE INDEX idx_training_sessions_trainer ON training_sessions(trainer_id);
CREATE INDEX idx_session_participants_session ON session_participants(session_id);
CREATE INDEX idx_session_participants_client ON session_participants(client_id);
-- Индексы для таблицы дизайнов сертификатов
CREATE INDEX idx_certificate_designs_active ON certificate_designs(is_active);
CREATE INDEX idx_certificate_designs_sort ON certificate_designs(sort_order);

-- Индексы для таблицы сертификатов
CREATE INDEX idx_certificates_number ON certificates(certificate_number);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_certificates_purchaser ON certificates(purchaser_id);
CREATE INDEX idx_certificates_design ON certificates(design_id);
CREATE INDEX idx_certificates_expiry ON certificates(expiry_date);
CREATE INDEX idx_certificates_purchase_date ON certificates(purchase_date);
CREATE INDEX idx_certificates_activated_by ON certificates(activated_by_id);
CREATE INDEX idx_certificates_purchaser_status ON certificates(purchaser_id, status);
CREATE INDEX idx_certificates_activated_by_status ON certificates(activated_by_id, status);
CREATE INDEX idx_certificates_status_expiry ON certificates(status, expiry_date);
CREATE INDEX idx_certificates_pdf_url ON certificates(pdf_url);
CREATE INDEX idx_certificates_image_url ON certificates(image_url);
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
CREATE INDEX idx_pending_certificates_wallet ON pending_certificates(wallet_number);
CREATE INDEX idx_pending_certificates_client ON pending_certificates(client_id);
CREATE INDEX idx_pending_certificates_expires ON pending_certificates(expires_at);
CREATE INDEX idx_pending_certificates_created ON pending_certificates(created_at);
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

CREATE TRIGGER update_certificate_designs_updated_at
    BEFORE UPDATE ON certificate_designs
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

-- Создаем функцию для обновления слотов при создании/отмене групповых тренировок
CREATE OR REPLACE FUNCTION update_training_sessions_slots()
RETURNS TRIGGER AS $$
BEGIN
    -- Добавляем логирование
    RAISE NOTICE 'Триггер update_training_sessions_slots: операция %', TG_OP;
    RAISE NOTICE 'Триггер update_training_sessions_slots: simulator_id = %, date = %, start_time = %, end_time = %',
        CASE WHEN TG_OP = 'INSERT' THEN NEW.simulator_id ELSE OLD.simulator_id END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.session_date ELSE OLD.session_date END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.start_time ELSE OLD.start_time END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.end_time ELSE OLD.end_time END;

    IF TG_OP = 'INSERT' THEN
        -- При создании групповой тренировки помечаем 2 временных слота как занятые
        UPDATE schedule 
        SET is_booked = true
        WHERE simulator_id = NEW.simulator_id
        AND date = NEW.session_date
        AND start_time >= NEW.start_time
        AND start_time < NEW.end_time;  -- Это покроет 2 слота по 30 мин
        RAISE NOTICE 'Триггер update_training_sessions_slots: слоты помечены как занятые';
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- При удалении групповой тренировки освобождаем 2 временных слота
        UPDATE schedule 
        SET is_booked = false
        WHERE simulator_id = OLD.simulator_id
        AND date = OLD.session_date
        AND start_time >= OLD.start_time
        AND start_time < OLD.end_time;  -- Это покроет 2 слота по 30 мин
        RAISE NOTICE 'Триггер update_training_sessions_slots: слоты освобождены';
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Создаем триггер для групповых тренировок
CREATE TRIGGER training_sessions_schedule_trigger
AFTER INSERT OR DELETE ON training_sessions
FOR EACH ROW
EXECUTE FUNCTION update_training_sessions_slots();

-- Таблица очереди email
CREATE TABLE IF NOT EXISTS email_queue (
    id SERIAL PRIMARY KEY,
    certificate_id INTEGER REFERENCES certificates(id),
    recipient_email VARCHAR(255) NOT NULL,
    certificate_data JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, sent, failed
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    sent_at TIMESTAMP
);

-- Индексы для производительности email_queue
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_created_at ON email_queue(created_at);

-- Комментарии для email_queue
COMMENT ON TABLE email_queue IS 'Очередь email для отправки сертификатов';

-- Функция триггера для добавления email в очередь при создании сертификата
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
        -- Формируем данные для email
        SELECT jsonb_build_object(
            'certificateId', NEW.id,
            'certificateCode', NEW.certificate_number,
            'recipientEmail', client_email,
            'recipientName', COALESCE(NEW.recipient_name, c.full_name),
            'amount', NEW.nominal_value,
            'message', NEW.message,
            'pdfUrl', NEW.pdf_url,
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
        RAISE NOTICE 'Email queued for certificate % to %', NEW.certificate_number, client_email;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Удаляем старый триггер если существует
DROP TRIGGER IF EXISTS certificate_email_queue_trigger ON certificates;

-- Создаем новый триггер для автоматической отправки email при создании сертификата
CREATE TRIGGER certificate_email_queue_trigger
    AFTER INSERT ON certificates
    FOR EACH ROW
    EXECUTE FUNCTION queue_certificate_email();

-- Функция для получения следующих email из очереди
CREATE OR REPLACE FUNCTION get_pending_emails(limit_count INTEGER DEFAULT 5)
RETURNS TABLE (
    id INTEGER,
    certificate_id INTEGER,
    recipient_email VARCHAR(255),
    certificate_data JSONB,
    attempts INTEGER
) AS $$
BEGIN
    -- Обновляем статус на 'processing' и возвращаем записи
    RETURN QUERY
    UPDATE email_queue 
    SET status = 'processing', 
        processed_at = CURRENT_TIMESTAMP
    WHERE email_queue.id IN (
        SELECT eq.id 
        FROM email_queue eq
        WHERE eq.status = 'pending' 
        AND eq.attempts < eq.max_attempts
        ORDER BY eq.created_at ASC
        LIMIT limit_count
        FOR UPDATE SKIP LOCKED
    )
    RETURNING email_queue.id, email_queue.certificate_id, email_queue.recipient_email, 
              email_queue.certificate_data, email_queue.attempts;
END;
$$ LANGUAGE plpgsql;

-- Функция для обновления статуса email
CREATE OR REPLACE FUNCTION update_email_status(
    email_id INTEGER,
    new_status VARCHAR(20),
    error_message TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE email_queue 
    SET status = new_status,
        attempts = attempts + 1,
        last_error = error_message,
        sent_at = CASE WHEN new_status = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
    WHERE id = email_id;
END;
$$ LANGUAGE plpgsql;

-- Функция для очистки старых записей (опционально)
CREATE OR REPLACE FUNCTION cleanup_old_emails(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM email_queue 
    WHERE (status = 'sent' OR status = 'failed') 
    AND created_at < CURRENT_TIMESTAMP - (days_old || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Комментарии для функций email queue
COMMENT ON FUNCTION queue_certificate_email() IS 'Триггер для добавления email в очередь при создании сертификата';
COMMENT ON FUNCTION get_pending_emails(INTEGER) IS 'Получение следующих email из очереди для обработки';
COMMENT ON FUNCTION update_email_status(INTEGER, VARCHAR, TEXT) IS 'Обновление статуса отправки email';
COMMENT ON FUNCTION cleanup_old_emails(INTEGER) IS 'Очистка старых записей из очереди email'; 