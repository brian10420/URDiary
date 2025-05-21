# URDiary API测试工具

此目录包含用于测试URDiary API的脚本和工具。

## 环境准备

在运行测试之前，请确保安装了所需的依赖：

```bash
pip install -r requirements.txt
```

## 测试工具说明

### api_test.py

综合API测试工具，可以测试所有的API端点。

使用方法：

```bash
python api_test.py --host http://localhost:8000 --verbose
```

参数说明：
- `--host`: 指定API服务器地址 (默认: http://localhost:8000)
- `--verbose`: 显示详细输出

### test_api_directly.py

简单的API直接测试工具，用于快速测试基本的API功能。

使用方法：

```bash
python test_api_directly.py
```

此工具会测试三个主要端点：
- 基本聊天API
- 增强聊天API
- 结束聊天API

### test_multi_model.py

多模型支持测试工具，用于测试是否正确实现了grok2和grok3的模型支持。

使用方法：

```bash
python test_multi_model.py
```

此工具会自动测试：
1. 使用默认模型的情况
2. 使用grok2模型的情况
3. 使用grok3模型的情况

### test_model_cmd.py

命令行模型测试工具，用于从命令行快速测试不同模型。

使用方法：

```bash
# 使用默认模型测试基本聊天API
python test_model_cmd.py

# 指定使用grok2模型
python test_model_cmd.py --model grok2

# 指定使用grok3模型
python test_model_cmd.py --model grok3

# 测试增强聊天API
python test_model_cmd.py --enhanced

# 自定义测试消息
python test_model_cmd.py --message "你支持哪些功能？" --model grok3
```

参数说明：
- `--model`, `-m`: 指定要测试的模型 (可选值: grok2, grok3)
- `--message`, `-t`: 指定测试消息内容 (默认: "你好，请告诉我你是哪个模型版本？")
- `--enhanced`, `-e`: 使用增强聊天API进行测试
- `--user-id`, `-u`: 指定用户ID (numeric_user_id, 默认为1)

## 测试多模型功能

要验证多模型支持是否正确实现，可以通过以下步骤进行测试：

1. 首先运行完整的多模型测试：

```bash
python test_multi_model.py
```

2. 然后分别测试不同模型的响应：

```bash
# 测试 grok2
python test_model_cmd.py --model grok2 --message "请告诉我你是哪个版本的模型"

# 测试 grok3
python test_model_cmd.py --model grok3 --message "请告诉我你是哪个版本的模型"
```

3. 检查响应中的 `model_used` 字段，确认是否与请求中指定的模型一致。

## 功能特点

- 测试所有主要API端点
- 彩色输出测试结果
- 详细的错误报告
- 支持自定义API主机地址
- 支持详细输出模式

## 安装依赖

```bash
pip install -r tests/requirements.txt
```

## 使用方法

基本用法:

```bash
python -m tests.api_test
```

指定API主机地址:

```bash
python -m tests.api_test --host http://your-api-server:8000
```

显示详细输出:

```bash
python -m tests.api_test --verbose
```

同时使用两个参数:

```bash
python -m tests.api_test --host http://your-api-server:8000 --verbose
```

## 测试凭据

测试工具使用以下凭据创建测试用户和进行登录操作：

- 用户名：动态生成（格式为 `test_user_[时间戳]`）
- 密码：`test_password123`

如果后端的用户创建/登录逻辑有变化，可能需要调整 `api_test.py` 中的相关代码。

## 测试内容

该工具会自动测试以下API端点:

### 用户相关
- 创建用户
- 用户登录
- 获取用户信息
- 获取用户列表
- 刷新令牌

### 聊天相关
- 发送聊天消息
- 增强版聊天
- 结束聊天生成日记
- 清除聊天历史

### 日记相关
- 生成日记
- 获取用户日记列表
- 获取特定日记
- 更新日记
- 获取情感分析
- 测试增强日记生成
- 获取互动笔记
- 更新互动笔记
- 删除日记

## 注意事项

- 测试会创建临时用户和日记数据，仅用于测试目的
- 建议在开发环境或测试环境中运行，避免在生产环境使用
- 如果测试成功，会显示绿色的成功消息，如有错误则显示红色的错误消息
- 测试完成后会显示总体测试统计信息（成功/失败数量和用时） 