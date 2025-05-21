#!/usr/bin/env python
import sys
import os
import requests
import json
import argparse

# 添加项目根目录到Python路径
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

def test_chat(model, message):
    """测试基本聊天API"""
    print(f"使用模型 {model} 测试基本聊天API...")
    try:
        payload = {
            "user_id": "test_user",
            "message": message
        }
        
        # 如果指定了模型，将其添加到请求中
        if model:
            payload["model"] = model
            
        response = requests.post(
            "http://localhost:8000/chat/",
            json=payload
        )
        
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"响应内容: {json.dumps(result, indent=2, ensure_ascii=False)}")
            
            # 输出使用的模型
            if "model_used" in result:
                print(f"\n实际使用的模型: {result['model_used']}")
        else:
            print(f"错误响应: {response.text}")
    except Exception as e:
        print(f"错误: {e}")

def test_enhanced_chat(model, message, numeric_user_id=1):
    """测试增强聊天API"""
    print(f"\n使用模型 {model} 测试增强聊天API...")
    try:
        payload = {
            "user_id": "test_user",
            "numeric_user_id": numeric_user_id,
            "message": message
        }
        
        # 如果指定了模型，将其添加到请求中
        if model:
            payload["model"] = model
            
        response = requests.post(
            "http://localhost:8000/chat/enhanced/",
            json=payload
        )
        
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"响应内容: {json.dumps(result, indent=2, ensure_ascii=False)}")
            
            # 输出使用的模型
            if "model_used" in result:
                print(f"\n实际使用的模型: {result['model_used']}")
        else:
            print(f"错误响应: {response.text}")
    except Exception as e:
        print(f"错误: {e}")

def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='测试Grok多模型支持')
    parser.add_argument('--model', '-m', choices=['grok2', 'grok3'], help='要测试的模型，不指定则使用默认模型')
    parser.add_argument('--message', '-t', default="你好，请告诉我你是哪个模型版本？", help='测试消息内容')
    parser.add_argument('--enhanced', '-e', action='store_true', help='是否使用增强聊天API')
    parser.add_argument('--user-id', '-u', type=int, default=1, help='用户ID (numeric_user_id)')
    args = parser.parse_args()
    
    # 打印测试信息
    print("=" * 50)
    print(f"模型选择测试工具")
    print("=" * 50)
    print(f"测试消息: {args.message}")
    if args.model:
        print(f"指定模型: {args.model}")
    else:
        print("使用默认模型")
    
    if args.enhanced:
        test_enhanced_chat(args.model, args.message, args.user_id)
    else:
        test_chat(args.model, args.message)
        
    print("\n测试完成！")

if __name__ == "__main__":
    main() 