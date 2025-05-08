-- 首先确定diaries表中的最大ID值
DO $$
DECLARE
    max_id INTEGER;
BEGIN
    -- 获取当前最大ID
    SELECT COALESCE(MAX(id), 0) INTO max_id FROM diaries;
    
    -- 重置序列到最大ID+1
    EXECUTE 'ALTER SEQUENCE diaries_id_seq RESTART WITH ' || (max_id + 1);
    
    -- 输出日志
    RAISE NOTICE 'Diaries序列已重置，当前最大ID: %, 新序列起始值: %', max_id, (max_id + 1);
END $$; 