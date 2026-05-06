import pymongo
import os
import certifi
from dotenv import load_dotenv

load_dotenv()
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
client = pymongo.MongoClient(MONGO_URI, tlsCAFile=certifi.where())
db = client["smart_attendance"]
students_col = db["students"]
attendance_col = db["attendance"]

print(f"Total Students: {students_col.count_documents({})}")
for s in students_col.find():
    print(f"Student: {s.get('name')}")

print(f"Total Attendance Today: {attendance_col.count_documents({})}")
