"""Các thể loại được chạy tuần tự theo đúng thứ tự trong INPUT_URLS."""

INPUT_URLS = [
"https://dtv-ebook.com.vn/hai-huoc-523.html"
]

# EPUB mới sẽ nằm trong <danh mục>/Dịch, AI, CV hoặc Chưa xác định dưới thư mục này.
OUTPUT_DIR = r"D:\Code\TTS\cawl\ebook\downloads"

# Giữ False: chỉ trạng thái "Hoàn Thành" mới được tải, không coi "CV FULL" là hoàn thành.
ALLOW_CV_FULL = False
