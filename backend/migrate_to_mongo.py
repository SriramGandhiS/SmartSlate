import sqlite3
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime

load_dotenv()

# Connect to old SQLite
conn = sqlite3.connect("d:/minipro/backend/attendance.db")
c = conn.cursor()

# Connect to MongoDB
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client["psna_attendance"]

# Migrate students
c.execute("SELECT name, details FROM students")
students = c.fetchall()
for name, details in students:
    db.students.replace_one(
        {"name": name},
        {"name": name, "details": details or "", "created_at": datetime.now()},
        upsert=True
    )
print(f"Migrated {len(students)} students")

# Migrate attendance
c.execute("SELECT name, date, time FROM attendance")
records = c.fetchall()
count = 0
for name, date, time_str in records:
    existing = db.attendance.find_one({"name": name, "date": date, "time": time_str})
    if not existing:
        db.attendance.insert_one({
            "name": name,
            "date": date,
            "time": time_str,
            "created_at": datetime.now()
        })
        count += 1
print(f"Migrated {count}/{len(records)} attendance records")

conn.close()
print(f"Done! Students: {db.students.count_documents({})}, Attendance: {db.attendance.count_documents({})}")
