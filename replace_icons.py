import os
from PIL import Image
import shutil

source_image_path = r"C:\Users\iamra\.gemini\antigravity\brain\50b89a3e-e1f4-4bef-ba81-0d9745d40a30\psna_aura_app_icon_1777988203387.png"
res_dir = r"d:\minipro\teacher_app\app\src\main\res"

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
}

try:
    img = Image.open(source_image_path).convert("RGBA")
    
    # Remove old xml icons if any to force using pngs
    for root, dirs, files in os.walk(res_dir):
        for f in files:
            if f in ["ic_launcher.xml", "ic_launcher_round.xml"]:
                os.remove(os.path.join(root, f))
    
    for folder, size in sizes.items():
        folder_path = os.path.join(res_dir, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save as ic_launcher.png
        resized.save(os.path.join(folder_path, "ic_launcher.png"), "PNG")
        
        # Create a circle version for ic_launcher_round.png
        # (For simplicity, we'll just save the same image if it's already round, 
        # or just a rounded crop. We'll just save it as is for now)
        resized.save(os.path.join(folder_path, "ic_launcher_round.png"), "PNG")

    print("App icons updated successfully!")
except Exception as e:
    print(f"Error updating icons: {e}")
