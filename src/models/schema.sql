-- Таблица пользователей
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    skill_level INTEGER,
    has_child BOOLEAN DEFAULT FALSE,
    child_name VARCHAR(100),
    child_birth_date DATE,
    child_skill_level INTEGER,
    account_number VARCHAR(6) UNIQUE NOT NULL,
    telegram_id VARCHAR(100) UNIQUE,
    telegram_username VARCHAR(100),
    nickname VARCHAR(100),
    role VARCHAR(20) DEFAULT 'client', -- client, trainer, admin
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица тренажеров
CREATE TABLE simulators (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'available', -- available, maintenance, inactive
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица групп
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица тренировок
CREATE TABLE training_sessions (
    id SERIAL PRIMARY KEY,
    simulator_id INTEGER REFERENCES simulators(id),
    trainer_id INTEGER REFERENCES users(id),
    group_id INTEGER REFERENCES groups(id),
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration INTEGER NOT NULL, -- 30 или 60 минут
    is_group_session BOOLEAN DEFAULT FALSE,
    max_participants INTEGER,
    skill_level INTEGER,
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, completed, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица участников тренировок
CREATE TABLE session_participants (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES training_sessions(id),
    user_id INTEGER REFERENCES users(id),
    is_child BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed, cancelled, completed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица сертификатов
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    purchase_date TIMESTAMP NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- active, used, expired
    expiry_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица кошельков
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    balance DECIMAL(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица транзакций
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER REFERENCES wallets(id),
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(20) NOT NULL, -- deposit, withdrawal, payment
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_account_number ON users(account_number);
CREATE INDEX idx_training_sessions_date ON training_sessions(session_date);
CREATE INDEX idx_session_participants_session ON session_participants(session_id);
CREATE INDEX idx_certificates_user ON certificates(user_id);
CREATE INDEX idx_wallets_user ON wallets(user_id); 