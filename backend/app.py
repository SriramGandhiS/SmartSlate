from flask import Flask, request, jsonify, send_file, Response, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np
import os
import pickle
from datetime import datetime
import sqlite3
import base64
import time
import threading
from dotenv import load_dotenv
from ai_reporting import AttendanceAI
import pymongo
from bson.binary import Binary


# Initialize OpenCV LBPH Recognizer
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
recognizer = cv2.face.LBPHFaceRecognizer_create()
TRAINER_FILE = "trainer.yml"
LABELS_FILE = "labels.pkl"


load_dotenv()
ai_handler = AttendanceAI()

# MongoDB Configuration
import certifi
print("Connecting to MongoDB...", flush=True)
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
try:
    client = pymongo.MongoClient(MONGO_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=2000, tlsAllowInvalidCertificates=True)
    # Quick check
    client.admin.command('ping')
    print("DONE: MongoDB Connected.", flush=True)
except Exception as e:
    print(f"FAIL: MongoDB Connection Failed: {e}", flush=True)
    print("WARN: Falling back to Local Mock Mode.", flush=True)
    # Create a mock client that doesn't crash
    class MockCol:
        def find_one(self, *args, **kwargs): return None
        def find(self, *args, **kwargs): return []
        def insert_one(self, *args, **kwargs): pass
        def update_one(self, *args, **kwargs): pass
        def count_documents(self, *args, **kwargs): return 0
        def distinct(self, *args, **kwargs): return []
        def create_index(self, *args, **kwargs): pass
    class MockDB:
        def __getitem__(self, name): return MockCol()
    client = None
    db = MockDB()

students_col = db["students"]
attendance_col = db["attendance"]
config_col = db["config"]
print("MongoDB client initialized.", flush=True)

def save_recognizer():
    # No need to create directory as /tmp exists
    recognizer.save(TRAINER_FILE)
    with open(LABELS_FILE, "wb") as f:
        pickle.dump(label_map, f)
    
    # ROBUST: Sync to Cloud
    with open(TRAINER_FILE, "rb") as f:
        trainer_bin = Binary(f.read())
    with open(LABELS_FILE, "rb") as f:
        labels_bin = Binary(f.read())
    
    config_col.update_one(
        {"type": "face_model"},
        {"$set": {"trainer": trainer_bin, "labels": labels_bin, "updated_at": datetime.now()}},
        upsert=True
    )

def load_recognizer():
    global label_map
    try:
        # Try loading from cloud first for ROBUSTNESS
        model_data = config_col.find_one({"type": "face_model"})
        if model_data:
            # No need to create directory as /tmp exists
            with open(TRAINER_FILE, "wb") as f:
                f.write(model_data["trainer"])
            with open(LABELS_FILE, "wb") as f:
                f.write(model_data["labels"])
            print("DONE: Face Intelligence Synced from Cloud", flush=True)
    except Exception as e:
        print(f"WARN: Cloud sync failed: {e}. Using local cache.", flush=True)
    
    if os.path.exists(TRAINER_FILE) and os.path.exists(LABELS_FILE):
        recognizer.read(TRAINER_FILE)
        with open(LABELS_FILE, "rb") as f:
            label_map = pickle.load(f)

label_map = {} 
print("Loading recognizer...", flush=True)
load_recognizer()
print("Recognizer loaded.", flush=True)


# Initialize Flask with frontend as static folder
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app = Flask(__name__, static_folder=frontend_dir, static_url_path="")
CORS(app)

# DB Init is handled automatically by MongoDB


def base64_to_image(base64_str):
    try:
        img_data = base64.b64decode(base64_str.split(",")[1])
        np_arr = np.frombuffer(img_data, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    except:
        return None

@app.route("/start_attendance", methods=["POST"])
def start_attendance(): return jsonify({"status": "success"})

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    name, image_b64, details = data.get("name"), data.get("image"), data.get("details", "")
    if not name or not image_b64: return jsonify({"status": "error", "message": "Missing data"}), 400
    img = base64_to_image(image_b64)
    if img is None: return jsonify({"status": "error", "message": "Invalid image"}), 400
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 6)
    
    if len(faces) == 0: 
        return jsonify({"status": "error", "message": "No face detected. Please face the camera."}), 400
    if len(faces) > 1:
        return jsonify({"status": "error", "message": "Multiple faces detected! Only one person should be in the frame during registration."}), 400

    # ROBUST: Check if this face is already in our system
    (x, y, w, h) = faces[0]
    if len(label_map) > 0:
        try:
            id_, conf = recognizer.predict(gray[y:y+h, x:x+w])
            if conf < 60: # High precision check
                existing_name = label_map.get(id_, "Unknown")
                return jsonify({"status": "error", "message": f"This face is already registered as '{existing_name}'!"}), 400
        except:
            pass

    student_id = len(label_map) + 1

    label_map[student_id] = name
    face_samples, ids = [], []
    for (x, y, w, h) in faces:
        fr = gray[y:y+h, x:x+w]
        face_samples.extend([fr, cv2.flip(fr, 1)])
        ids.extend([student_id, student_id])
    recognizer.update(face_samples, np.array(ids))
    save_recognizer()
    students_col.update_one(
        {"name": name},
        {"$set": {"details": details}},
        upsert=True
    )
    return jsonify({"status": "success"})


@app.route("/attendance", methods=["POST"])
def attendance():
    # Deprecated for live loop: Frontend now just queries the DB, it doesn't need to send images for standard attendance.
    # We keep this strictly for manual snapshot logic if needed, but return success immediately.
    return jsonify({"status": "success", "recognized": []})

@app.route("/report")
def report():
    rows = list(attendance_col.find({}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
    # Format for frontend: [name, date, time]
    data = [[r["name"], r["date"], r["time"]] for r in rows]
    return jsonify(data)


@app.route("/report/months")
def report_months():
    months = attendance_col.distinct("date")
    months = sorted(list(set([d[:7] for d in months])), reverse=True)
    return jsonify(months)


@app.route("/report/month/<ym>")
def report_month(ym):
    rows = list(attendance_col.find({"date": {"$regex": f"^{ym}"}}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
    data = [[r["name"], r["date"], r["time"]] for r in rows]
    return jsonify(data)


@app.route("/students")
def students_list():
    rows = list(students_col.find({}, {"_id": 0, "name": 1, "details": 1}).sort("name", 1))
    return jsonify(rows)


@app.route("/student/<name>")
def student_profile(name):
    student = students_col.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}, {"_id": 0})
    if not student: return jsonify({"status": "error"}), 404
    
    all_dates = sorted(attendance_col.distinct("date"))
    recs = list(attendance_col.find({"name": student["name"]}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
    
    present_dates = set([r["date"] for r in recs])
    leave_dates = [d for d in all_dates if d not in present_dates]
    
    pct = round((len(present_dates) / len(all_dates) * 100), 2) if all_dates else 0
    return jsonify({
        "name": student["name"], 
        "details": student["details"], 
        "percentage": pct, 
        "total": len(all_dates), 
        "present": len(present_dates), 
        "leave_dates": leave_dates, 
        "records": recs
    })


@app.route("/ai/chat", methods=["POST"])
def ai_chat():
    data = request.json
    all_s = [s["name"] for s in students_col.find({}, {"name": 1})]
    today = datetime.now().strftime("%Y-%m-%d")
    recs = [(r["name"], r["time"]) for r in attendance_col.find({"date": today})]
    return jsonify({"status": "success", "response": ai_handler.chat_with_attendance(data.get("query"), recs, all_students=all_s)})


@app.route("/ai/generate_report", methods=["POST"])
def ai_generate_report():
    all_s = [s["name"] for s in students_col.find({}, {"name": 1})]
    today = datetime.now().strftime("%Y-%m-%d")
    recs = [(r["name"], r["date"], r["time"]) for r in attendance_col.find({"date": today})]
    summary = ai_handler.generate_ai_summary(recs, all_students=all_s)
    ai_handler.create_pdf_report(summary, recs)
    return jsonify({"status": "success", "summary": summary, "pdf_url": "/reports/latest"})


@app.route("/reports/latest")
def get_latest_report():
    if not os.path.exists("/tmp"):
        return jsonify({"status": "error", "message": "No reports generated yet"}), 404
    files = [f for f in os.listdir("/tmp") if f.startswith("report_") and f.endswith(".pdf")]
    if not files:
        return jsonify({"status": "error", "message": "No reports found"}), 404
    latest = max([os.path.join("/tmp", f) for f in files], key=os.path.getctime)
    return send_file(latest, as_attachment=True)


# Global Camera Shared Resource
class VideoCamera:
    def __init__(self):
        print("Starting VideoCapture(0)...")
        self.cap = cv2.VideoCapture(0)
        # Fallback to alternative camera indices if 0 fails
        if not self.cap.isOpened():
            print("Trying index 1...", flush=True)
            self.cap = cv2.VideoCapture(1)
            
        if not self.cap.isOpened():
            print("ERROR: Could not open camera!", flush=True)
        else:
            print("SUCCESS: Camera opened successfully!", flush=True)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            
        self.latest_frame = None
        self.last_scan_name = "Awaiting"
        self.last_scan_time = 0
        self.lock = threading.Lock()
        self.is_active = True # Allows controlling the loop
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self):
        # Enforce strict 10-minute (600 seconds) attendance log rule
        ATTENDANCE_COOLDOWN = 600 
        frame_skip = 0
        
        while self.is_active:
            if not self.cap.isOpened():
                time.sleep(1)
                continue
                
            success, frame = self.cap.read()
            if not success:
                time.sleep(0.1)
                continue
            
            # Recognition Logic
            try:
                frame_skip += 1
                # Run heavy detection every 3rd frame and on a smaller image
                if frame_skip % 3 == 0:
                    small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
                    gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                    self.last_faces = face_cascade.detectMultiScale(gray, 1.2, 5)
                
                faces = getattr(self, 'last_faces', [])

                for (x, y, w, h) in faces:
                    x, y, w, h = x*2, y*2, w*2, h*2 # Scale back up
                    name = "Unknown"
                    color = (0, 0, 255)
                    if len(label_map) > 0:
                        try:
                            gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                            id_, conf = recognizer.predict(gray_full[y:y+h, x:x+w])
                            # Relaxed threshold to 85 for better recognition (fixes "unverified")
                            if conf < 85:
                                name = label_map.get(id_, "Unknown")
                                color = (0, 255, 0)
                                # Log attendance
                                now = datetime.now()
                                date, t_str = now.strftime("%Y-%m-%d"), now.strftime("%H:%M:%S")
                                last = attendance_col.find_one({"name": name, "date": date}, sort=[("time", -1)])
                                if not last or (now - datetime.strptime(f"{date} {last['time']}", "%Y-%m-%d %H:%M:%S")).total_seconds() > ATTENDANCE_COOLDOWN:
                                    attendance_col.insert_one({"name": name, "date": date, "time": t_str})
                                    self.last_scan_name = name
                                    self.last_scan_time = time.time()
                                    print(f"✅ Auto-logged attendance for {name} at {t_str}")
                        except Exception as inner_e:
                            pass
                    cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                    cv2.putText(frame, name, (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
            except Exception as e:
                print(f"Camera frame processing error: {e}")
            
            ret, buffer = cv2.imencode('.jpg', frame)
            with self.lock:
                self.latest_frame = buffer.tobytes()
            time.sleep(0.01) # Faster loop, ~60 FPS capable, limited by camera

shared_camera = None

def get_camera():
    global shared_camera
    if shared_camera is None:
        print("Initializing Shared Camera...", flush=True)
        shared_camera = VideoCamera()
    return shared_camera

# Start camera at boot
print("Bootstrapping Camera System...", flush=True)
get_camera()

@app.route("/api/realtime/dashboard")
def dashboard_stats():
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        total_students = students_col.count_documents({})
        present_count = attendance_col.count_documents({"date": today})
        cam = get_camera()
        cooldown_rem = max(0, int(600 - (time.time() - cam.last_scan_time))) if cam.last_scan_time > 0 else 0
        return jsonify({
            "present_today": present_count,
            "absent_today": max(0, total_students - present_count),
            "total_students": total_students,
            "present_names": [],
            "last_user": cam.last_scan_name,
            "next_scan_in": cooldown_rem
        })
    except:
        return jsonify({"present_today": 0, "absent_today": 0, "total_students": 0, "present_names": []})

def gen_frames():
    cam = get_camera()
    while True:
        frame = None
        with cam.lock:
            frame = cam.latest_frame
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n'
                   b'Content-Length: ' + str(len(frame)).encode() + b'\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.05)

@app.route("/stop_attendance", methods=["POST"])
def stop_attendance(): return jsonify({"status": "success"})

@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/capture_frame")
def capture_frame():
    cam = get_camera()
    with cam.lock:
        if cam.latest_frame:
            return Response(cam.latest_frame, mimetype='image/jpeg')
    return "Error", 500

@app.route('/mobile_view')
def mobile_view():
    return """
    <html>
      <body style="margin:0; background:#000; display:flex; align-items:center; justify-content:center; height:100vh; overflow:hidden;">
        <img src="/video_feed" style="max-width:100%; max-height:100%; object-fit:contain;">
      </body>
    </html>
    """

@app.route("/")
def index():
    return send_file(os.path.join(frontend_dir, "index.html"))

@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(frontend_dir, path)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=8080, debug=True, threaded=True, use_reloader=False)
