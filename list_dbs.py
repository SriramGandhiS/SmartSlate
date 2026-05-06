import pymongo
import os
import certifi
from dotenv import load_dotenv

load_dotenv()
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
print(f"Connecting to: {MONGO_URI}")
client = pymongo.MongoClient(MONGO_URI, tlsCAFile=certifi.where())

try:
    dbs = client.list_database_names()
    print(f"Databases: {dbs}")
    for db_name in dbs:
        db = client[db_name]
        print(f"  DB: {db_name}, Collections: {db.list_collection_names()}")
except Exception as e:
    print(f"Error: {e}")
