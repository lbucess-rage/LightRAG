-- LightRAG PostgreSQL 초기화 스크립트
-- pgvector extension 활성화

-- Vector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- UUID extension (if needed)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 확장 설치 확인
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
