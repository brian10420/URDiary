#!/usr/bin/env python3
import socket
import os
import sys
import requests

def check_api():
    try:
        response = requests.get('http://localhost:8000/docs', timeout=5)
        return response.status_code == 200
    except Exception:
        return False

if __name__ == "__main__":
    if check_api():
        sys.exit(0)
    else:
        sys.exit(1)