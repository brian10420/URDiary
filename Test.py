import requests

url = "http://127.0.0.1:8000/chat/"
data = {"message": "你好"}


response = requests.post(url, json=data)
print(response.json())
