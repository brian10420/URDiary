-- 創建必要的擴展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 確保表已被刪除（如果存在）
DROP TABLE IF EXISTS interaction_notes CASCADE;
DROP TABLE IF EXISTS diaries CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 創建用戶表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 創建日記表
CREATE TABLE diaries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) NOT NULL,
    title VARCHAR(255),
    diary_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content TEXT NOT NULL,
    valence FLOAT,
    arousal FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 創建互動筆記表
CREATE TABLE interaction_notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) NOT NULL,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 創建索引提升查詢效能
CREATE INDEX idx_diaries_user_id ON diaries(user_id);
CREATE INDEX idx_diaries_diary_date ON diaries(diary_date);
CREATE INDEX idx_interaction_notes_user_id ON interaction_notes(user_id);
CREATE INDEX idx_interaction_notes_version ON interaction_notes(version);