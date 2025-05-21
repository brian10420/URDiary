import requests
import json

def test_chat_api():
    """Test the basic chat API"""
    print("Testing basic chat API...")
    try:
        response = requests.post(
            "http://localhost:8000/chat/",
            json={"user_id": "test_user", "message": "Hello from test script"}
        )
        print(f"Status code: {response.status_code}")
        try:
            print(f"Response: {json.dumps(response.json(), indent=2)}")
        except:
            print(f"Raw response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

def test_enhanced_chat_api():
    """Test the enhanced chat API"""
    print("\nTesting enhanced chat API...")
    try:
        response = requests.post(
            "http://localhost:8000/chat/enhanced/",
            json={
                "user_id": "test_user", 
                "numeric_user_id": 1, 
                "message": "Hello from enhanced test"
            }
        )
        print(f"Status code: {response.status_code}")
        try:
            print(f"Response: {json.dumps(response.json(), indent=2)}")
        except:
            print(f"Raw response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

def test_end_chat_api():
    """Test the end chat API"""
    print("\nTesting end chat API...")
    try:
        response = requests.post(
            "http://localhost:8000/chat/end/",
            json={
                "user_id": "test_user", 
                "numeric_user_id": 1,
                "exclude_interaction_notes": False
            }
        )
        print(f"Status code: {response.status_code}")
        try:
            print(f"Response: {json.dumps(response.json(), indent=2)}")
        except:
            print(f"Raw response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    print("=== Direct API Testing ===")
    # Test the basic chat API
    test_chat_api()
    
    # Test the enhanced chat API
    test_enhanced_chat_api()
    
    # Test the end chat API
    test_end_chat_api()
    
    print("\n=== Testing complete ===") 