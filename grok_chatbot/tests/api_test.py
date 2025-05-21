import os
import sys
import time
import json
import requests
from datetime import datetime
from colorama import init, Fore, Style

# 初始化colorama
init()

# 添加项目根目录到Python路径
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# 从配置文件导入接口地址
from app.config import get_config

# 测试配置
HOST = "http://localhost:8000"  # 默认本地测试地址，可通过命令行参数覆盖
VERBOSE = False  # 是否输出详细信息

# 颜色输出函数
def print_success(message):
    print(f"{Fore.GREEN}✅ {message}{Style.RESET_ALL}")

def print_warning(message):
    print(f"{Fore.YELLOW}⚠️ {message}{Style.RESET_ALL}")

def print_error(message):
    print(f"{Fore.RED}❌ {message}{Style.RESET_ALL}")

def print_info(message):
    print(f"{Fore.CYAN}ℹ️ {message}{Style.RESET_ALL}")

def print_header(message):
    print(f"\n{Fore.BLUE}{'='*10} {message} {'='*10}{Style.RESET_ALL}")

def print_response(response, endpoint):
    """打印响应信息"""
    if VERBOSE:
        print(f"状态码: {response.status_code}")
        try:
            print(f"响应内容: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
        except:
            print(f"响应内容: {response.text}")
    
    if 200 <= response.status_code < 300:
        print_success(f"{endpoint} - 请求成功 ({response.status_code})")
        return True
    else:
        print_error(f"{endpoint} - 请求失败 ({response.status_code})")
        try:
            error_detail = response.json().get("detail", "无详细信息")
            print_error(f"错误详情: {error_detail}")
        except:
            print_error(f"错误响应: {response.text}")
        return False

class APITester:
    def __init__(self, base_url=HOST):
        self.base_url = base_url
        self.test_user_id = None
        self.test_username = f"test_user_{int(time.time())}"
        self.test_password = "test_password123"  # 固定测试密码
        self.access_token = None
        self.refresh_token = None
        self.test_diary_id = None
        self.success_count = 0
        self.fail_count = 0
        self.test_count = 0

    def run_test(self, endpoint, method="GET", data=None, auth=True, expected_status=None, headers=None, is_form_data=False):
        """运行单个API测试"""
        self.test_count += 1
        url = f"{self.base_url}{endpoint}"
        
        if headers is None:
            headers = {}
            
        if not is_form_data:
            headers["Content-Type"] = "application/json"
            
        if auth and self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        
        print_info(f"测试 [{method}] {endpoint}")
        
        try:
            if method == "GET":
                response = requests.get(url, headers=headers)
            elif method == "POST":
                if is_form_data:
                    response = requests.post(url, data=data, headers=headers)
                else:
                    response = requests.post(url, json=data, headers=headers)
            elif method == "PUT":
                if is_form_data:
                    response = requests.put(url, data=data, headers=headers)
                else:
                    response = requests.put(url, json=data, headers=headers)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers)
            else:
                print_error(f"不支持的HTTP方法: {method}")
                self.fail_count += 1
                return False
            
            if expected_status and response.status_code != expected_status:
                print_error(f"状态码不匹配: 期望 {expected_status}, 实际 {response.status_code}")
                self.fail_count += 1
                return False
            
            success = print_response(response, endpoint)
            if success:
                self.success_count += 1
            else:
                self.fail_count += 1
            return success, response
        except Exception as e:
            print_error(f"请求异常: {str(e)}")
            self.fail_count += 1
            return False, None

    def test_user_apis(self):
        """测试用户相关API"""
        print_header("测试用户API")
        
        # 创建用户
        success, response = self.run_test(
            "/users/create", 
            method="POST", 
            data={"username": self.test_username, "password": self.test_password},
            auth=False
        )
        
        if success:
            self.test_user_id = response.json().get("user_id")
            print_info(f"创建测试用户: {self.test_username}, ID: {self.test_user_id}")
        
        # 用户登录 - 使用表单数据
        form_data = {
            "username": self.test_username,
            "password": self.test_password
        }
        
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        
        success, response = self.run_test(
            "/users/login", 
            method="POST", 
            data=form_data,
            headers=headers,
            is_form_data=True,
            auth=False
        )
        
        if success:
            token_data = response.json()
            self.access_token = token_data.get("access_token")
            self.refresh_token = token_data.get("refresh_token")
            print_info(f"获取访问令牌成功")
        
        # 获取用户信息
        if self.test_user_id:
            self.run_test(f"/users/{self.test_user_id}")
        
        # 获取用户列表
        self.run_test("/users/")
        
        # 刷新令牌
        if self.access_token:
            self.run_test(
                "/users/token/refresh", 
                method="POST"
            )
            
        # 测试OAuth2标准令牌端点
        if not self.access_token:  # 如果之前登录失败，再尝试使用OAuth2标准端点
            form_data = {
                "username": self.test_username,
                "password": self.test_password
            }
            
            headers = {"Content-Type": "application/x-www-form-urlencoded"}
            
            success, response = self.run_test(
                "/users/token", 
                method="POST", 
                data=form_data,
                headers=headers,
                is_form_data=True,
                auth=False
            )
            
            if success:
                token_data = response.json()
                self.access_token = token_data.get("access_token")
                self.refresh_token = token_data.get("refresh_token")
                print_info(f"通过OAuth2标准端点获取访问令牌成功")

    def test_chat_apis(self):
        """测试聊天相关API"""
        print_header("测试聊天API")
        
        if not self.test_user_id:
            print_warning("跳过聊天API测试: 没有测试用户ID")
            return

        # 发送聊天消息
        self.run_test(
            "/chat/", 
            method="POST", 
            data={
                "user_id": str(self.test_user_id),
                "message": "Hello, I'm feeling happy today!"
            }
        )
        
        # 增强版聊天
        self.run_test(
            "/chat/enhanced/", 
            method="POST", 
            data={
                "user_id": str(self.test_user_id),
                "numeric_user_id": self.test_user_id,
                "message": "Tell me about my day."
            }
        )
        
        # 结束聊天生成日记
        success, response = self.run_test(
            "/chat/end/", 
            method="POST", 
            data={
                "user_id": str(self.test_user_id),
                "numeric_user_id": self.test_user_id,
                "exclude_interaction_notes": False
            }
        )
        
        if success and response.json().get("diary"):
            self.test_diary_id = response.json().get("diary").get("diary_id")
            print_info(f"创建测试日记: ID: {self.test_diary_id}")
        
        # 清除聊天历史
        self.run_test(
            f"/chat/clear/?user_id={self.test_user_id}", 
            method="DELETE"
        )

    def test_diary_apis(self):
        """测试日记相关API"""
        print_header("测试日记API")
        
        if not self.test_user_id:
            print_warning("跳过日记API测试: 没有测试用户ID")
            return
        
        # 生成日记
        self.run_test(
            "/generate", 
            method="POST", 
            data={
                "user_id": str(self.test_user_id),
                "numeric_user_id": self.test_user_id,
                "exclude_interaction_notes": False
            }
        )
        
        # 获取用户日记列表
        self.run_test(f"/diaries/{self.test_user_id}")
        
        # 获取特定日记
        if self.test_diary_id:
            self.run_test(f"/{self.test_diary_id}")
        
        # 更新日记
        if self.test_diary_id:
            self.run_test(
                f"/{self.test_diary_id}", 
                method="PUT", 
                data={
                    "content": "This is an updated diary entry from API test",
                    "valence": 0.8,
                    "arousal": 0.5
                }
            )
        
        # 获取情感分析
        self.run_test(f"/analytics/emotion/{self.test_user_id}")
        
        # 测试增强日记生成
        self.run_test(
            "/enhanced-generate", 
            method="POST", 
            data={
                "user_id": str(self.test_user_id),
                "numeric_user_id": self.test_user_id
            }
        )
        
        # 获取互动笔记
        self.run_test(f"/interaction-notes/{self.test_user_id}")
        
        # 更新互动笔记
        self.run_test(
            "/interaction-notes/update", 
            method="POST", 
            data={
                "user_id": str(self.test_user_id),
                "numeric_user_id": self.test_user_id
            }
        )
        
        # 删除日记
        if self.test_diary_id:
            self.run_test(f"/{self.test_diary_id}", method="DELETE")

    def run_all_tests(self):
        """运行所有API测试"""
        start_time = time.time()
        
        print_header("开始API测试")
        print_info(f"测试基地址: {self.base_url}")
        print_info(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 测试用户API
        self.test_user_apis()
        
        # 测试聊天API
        self.test_chat_apis()
        
        # 测试日记API
        self.test_diary_apis()
        
        # 打印测试统计
        print_header("测试结果统计")
        print_info(f"总计测试: {self.test_count}")
        print_success(f"成功: {self.success_count}")
        if self.fail_count > 0:
            print_error(f"失败: {self.fail_count}")
        else:
            print_success("失败: 0")
        
        duration = time.time() - start_time
        print_info(f"测试用时: {duration:.2f} 秒")

def main():
    """主函数"""
    global HOST, VERBOSE
    
    import argparse
    parser = argparse.ArgumentParser(description='测试URDiary API')
    parser.add_argument('--host', type=str, help='API 主机地址')
    parser.add_argument('--verbose', action='store_true', help='显示详细输出')
    args = parser.parse_args()
    
    if args.host:
        HOST = args.host
    
    if args.verbose:
        VERBOSE = True
    
    # 获取配置
    config = get_config()
    if not args.host and config.get("API_HOST"):
        HOST = config.get("API_HOST")
    
    tester = APITester(HOST)
    tester.run_all_tests()

if __name__ == "__main__":
    main() 