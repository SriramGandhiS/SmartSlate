import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()
MONGO_URI = os.environ.get("MONGO_URI")
print(f"Connecting to: {MONGO_URI}")

import certifi

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000, tlsCAFile=certifi.where())
    client.admin.command('ping')
    print("SUCCESS: MongoDB Connection Successful!")
except Exception as e:
    print(f"FAILURE: Connection Failed: {e}")
