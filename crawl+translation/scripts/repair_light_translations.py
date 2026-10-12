"""Repair known mixed Chinese/Vietnamese fragments without calling an API."""

from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import current_book_directories
from app.storage.json_store import atomic_write_text


REPLACEMENTS = {
    "这不是城主府遇上的紫衣姑娘吗": "Đây chẳng phải cô nương áo tím gặp ở phủ thành chủ sao",
    "陈思灵没许悠然那么温柔": "Trần Tư Linh không dịu dàng như Hứa U Nhiên",
    "还不是轻松拿捏": "Chẳng phải vẫn dễ dàng nắm thóp sao",
    "清冷的瞥了他一眼": "lạnh nhạt liếc hắn một cái",
    "叫柳什么仙来着": "Hình như tên là Liễu gì Tiên ấy nhỉ",
    "Vương Vượng Phượng": "Vương Ánh Phượng",
    "Vương V映凤": "Vương Ánh Phượng",
    "Vương Hướng Ph凤": "Vương Ánh Phượng",
    "Vương H映 Phượng": "Vương Ánh Phượng",
    "Vương Vịnh凤": "Vương Ánh Phượng",
    "Vương Vịnh Phượng": "Vương Ánh Phượng",
    "Hứa U Thuyên": "Hứa U Nhiên",
    "Hứa U Thao": "Hứa U Nhiên",
    "Hứa U然": "Hứa U Nhiên",
    "Hứa悠然": "Hứa U Nhiên",
    "Chung Kỳ Tr甄": "Chung Kỳ Chân",
    "Chung Kỳ甄": "Chung Kỳ Chân",
    "Tôn Kỳ甄": "Tôn Kỳ Chân",
    "Công孙南": "Công Tôn Nam",
    "Công孙 Nam": "Công Tôn Nam",
    "Trần思灵": "Trần Tư Linh",
    "Nam宫": "Nam Cung",
    "Lưu Y勇": "Lưu Di Dũng",
    "Thiên Cơ các các chủ": "Thiên Cơ các chủ",
    "Thiên Cơ Cát Chủ": "Thiên Cơ các chủ",
    "Thiên Ki Cac Chủ": "Thiên Cơ các chủ",
    "Thiên Ki Cac chủ": "Thiên Cơ các chủ",
    "Thiên Cơ Các Chủ": "Thiên Cơ các chủ",
    "Thiên Ki Các": "Thiên Cơ các",
    "Thiên Cơ Cát": "Thiên Cơ các",
    "Thiên Ki Cac": "Thiên Cơ các",
    "Ki Cac Chủ": "Các chủ",
    "Cac Chủ": "Các chủ",
    "Cac chủ": "các chủ",
    "cac chủ": "các chủ",
    "Thiên Cơ C阁": "Thiên Cơ Các",
    "Thiên Cơ Gi阁": "Thiên Cơ Các",
    "Hồn Sư Hiệp Hội và Hồn C閣": "Hồn Sư Hiệp Hội và Hồn Các",
    "坦身相见": "khỏa thân đối diện",
    "续骨膏": "Tục Cốt Cao",
    "寻龙经": "Tầm Long Kinh",
    "娇喝一声": "khẽ quát một tiếng",
    "名不虚传": "danh bất hư truyền",
    "不虚传": "bất hư truyền",
    "天之骄子": "thiên chi kiêu tử",
    "天之驕子": "thiên chi kiêu tử",
    "之骄子": "chi kiêu tử",
    "之驕子": "chi kiêu tử",
    "幸灾乐祸": "vui sướng khi người khác gặp họa",
    "突飞猛进": "tiến bộ vượt bậc",
    "飞猛进": "tiến bộ vượt bậc",
    "飞猛": "tiến nhanh",
    "竞拍": "đấu giá",
    "底蕴": "nội tình",
    "好处": "lợi ích",
    "简直": "quả thực",
    "欣赏": "thưởng thức",
    "脾气": "tính khí",
    "不堪": "tệ hại",
    "盤": "bàn",
    "屈": "khuất",
    "无知": "vô tri",
    "譽": "dự",
    "荣誉": "vinh dự",
    "辞": "từ",
    "辭": "từ",
    "終": "chung",
    "终": "chung",
    "映凤": "Ánh Phượng",
    "雨秋": "Vũ Thu",
    "思灵": "Tư Linh",
    "悠然": "U Nhiên",
    "孙南": "Tôn Nam",
    "甄": "Chân",
    "然": "Nhiên",
    "凤": "Phượng",
    "根": "căn",
    "阁": "Các",
    "閣": "Các",
    "法": "pháp",
    "秀": "Tú",
    "雪": "Tuyết",
    "妹": "muội",
    "映": "Ánh",
    "卫": "Vệ",
    "畏": "sợ",
    "颜": "Nhan",
    "疾": "nhanh",
    "藏": "Tàng",
    "奔": "bôn",
    "主": "chủ",
    "牌": "lâu đời",
    "駕": "giá",
    "此": "này",
    "摆": "bày",
    "咦": "Ồ",
    "张": "Trương",
    "仙": "Tiên",
    "骄子": "kiêu tử",
    "方": "phương",
    "责": "trách",
    "鬟": "hoàn",
    "親": "thân",
    "者": "giả",
    "荐": "tiến cử",
    "势": "thế",
    "既然": "nếu đã",
    "深": "sâu",
    "機": "Cơ",
    "其次": "thứ hai",
    "凡": "Phàm",
    "界": "giới",
    "髓": "tủy",
    "机阁": "Cơ Các",
    "坛": "đàn",
    "场": "trường",
    "魂": "Hồn",
    "知": "tri",
    "涯": "bờ",
    "圃": "viên",
    "器": "khí",
    "孙": "Tôn",
    "勇": "Dũng",
    "宫": "Cung",
    "道": "nói",
}


def repair(text: str) -> str:
    for source in sorted(REPLACEMENTS, key=len, reverse=True):
        text = text.replace(source, REPLACEMENTS[source])
    return text.replace("Giang Phàm", "Phương Thần")


if __name__ == "__main__":
    _, translated_dir = current_book_directories()
    changed: list[str] = []
    for path in sorted(translated_dir.glob("*.txt")):
        original = path.read_text(encoding="utf-8")
        han_count = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", original))
        if han_count > 100:
            continue
        updated = repair(original)
        if updated != original:
            atomic_write_text(path, updated)
            changed.append(path.name)
    print(f"Repaired {len(changed)} light-error files")
    print(",".join(changed))
