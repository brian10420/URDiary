#!/bin/bash

# 设置数据库连接参数 - 这些可以从环境变量或.env文件获取
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-urdairy}
DB_USER=${DB_USER:-dbuser}
DB_PASS=${DB_PASS:-yourpassword}

echo "开始重置数据库序列..."

# 执行SQL脚本
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$(dirname "$0")/reset-sequence.sql"

echo "数据库序列重置完成！" 