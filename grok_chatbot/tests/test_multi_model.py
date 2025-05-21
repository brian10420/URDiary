import requests
import json
import sys
import os
import time
from colorama import init, Fore, Style

# 初始化colorama
init()

# 添加项目根目录到Python路径
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

def print_success(message):
    print(f"{Fore.GREEN}✅ {message}{Style.RESET_ALL}")

def print_error(message):
    print(f"{Fore.RED}❌ {message}{Style.RESET_ALL}")

def print_info(message):
    print(f"{Fore.CYAN}ℹ️ {message}{Style.RESET_ALL}")

def print_header(message):
    print(f"\n{Fore.BLUE}{'='*10} {message} {'='*10}{Style.RESET_ALL}")

def test_model(model_name):
    """测试特定模型"""
    print_header(f"测试 {model_name} 模型")
    
    try:
        # 测试基本聊天API
        response = requests.post(
            "http://localhost:8000/chat/",
            json={
                "user_id": "test_user",
                "message": f"Hello, what model are you? This is a test for {model_name}",
                "model": model_name
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print_success(f"基本聊天API成功 (状态码: {response.status_code})")
            print(f"响应: {json.dumps(result, indent=2, ensure_ascii=False)}")
            
            # 验证模型是否正确
            if result.get("model_used") == model_name:
                print_success(f"模型验证成功: 使用了 {model_name}")
            else:
                print_error(f"模型验证失败: 预期 {model_name}, 实际 {result.get('model_used')}")
        else:
            print_error(f"请求失败 (状态码: {response.status_code})")
            print(f"错误: {response.text}")
    except Exception as e:
        print_error(f"测试时出错: {e}")
        return False
    
    try:
        # 测试增强聊天API
        print_info("\n测试增强聊天API...")
        response = requests.post(
            "http://localhost:8000/chat/enhanced/",
            json={
                "user_id": "test_user", 
                "numeric_user_id": 1, 
                "message": f"Tell me about your capabilities (testing {model_name})",
                "model": model_name
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print_success(f"增强聊天API成功 (状态码: {response.status_code})")
            print(f"响应: {json.dumps(result, indent=2, ensure_ascii=False)}")
            
            # 验证模型是否正确
            if result.get("model_used") == model_name:
                print_success(f"模型验证成功: 使用了 {model_name}")
            else:
                print_error(f"模型验证失败: 预期 {model_name}, 实际 {result.get('model_used')}")
        else:
            print_error(f"请求失败 (状态码: {response.status_code})")
            print(f"错误: {response.text}")
    except Exception as e:
        print_error(f"测试时出错: {e}")
        return False
    
    return True

def test_default_model():
    """测试默认模型配置"""
    print_header("测试默认模型配置")
    
    try:
        # 不指定模型，测试是否使用默认模型
        response = requests.post(
            "http://localhost:8000/chat/",
            json={
                "user_id": "test_user",
                "message": "Hello, what model are you? This is a default model test."
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print_success(f"请求成功 (状态码: {response.status_code})")
            print(f"响应: {json.dumps(result, indent=2, ensure_ascii=False)}")
            
            # 显示实际使用的模型
            used_model = result.get("model_used")
            if used_model:
                print_info(f"使用的默认模型: {used_model}")
            else:
                print_error("响应中未找到模型信息")
        else:
            print_error(f"请求失败 (状态码: {response.status_code})")
            print(f"错误: {response.text}")
    except Exception as e:
        print_error(f"测试时出错: {e}")
        return False
    
    return True

def run_all_tests():
    """运行所有模型测试"""
    start_time = time.time()
    print_header("开始多模型支持测试")
    
    # 测试默认模型
    default_result = test_default_model()
    
    # 测试Grok 2模型
    grok2_result = test_model("grok2")
    
    # 测试Grok 3模型
    grok3_result = test_model("grok3")
    
    # 打印总结
    print_header("测试结果总结")
    if default_result:
        print_success("默认模型测试: 通过")
    else:
        print_error("默认模型测试: 失败")
        
    if grok2_result:
        print_success("Grok 2模型测试: 通过")
    else:
        print_error("Grok 2模型测试: 失败")
        
    if grok3_result:
        print_success("Grok 3模型测试: 通过")
    else:
        print_error("Grok 3模型测试: 失败")
    
    duration = time.time() - start_time
    print_info(f"测试用时: {duration:.2f} 秒")

if __name__ == "__main__":
    run_all_tests() 