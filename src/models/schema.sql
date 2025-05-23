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
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    skill_level INTEGER CHECK (skill_level BETWEEN 1 AND 5),
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
    type VARCHAR(20) NOT NULL, -- deposit, withdrawal, payment
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

CREATE TRIGGER update_schedule_settings_updated_at
    BEFORE UPDATE ON schedule_settings
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

-- Удаляем старую таблицу group_training_requests 