"""Build the portable practice bank without guessing text or answer keys.

Run with the bundled Python, or Python 3.10+, from any working directory.
The existing curated final_questions.json remains the source of truth.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil


PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT.parent / "_choice_work"
DIST = PROJECT / "dist"
DATA = DIST / "data"
ASSETS = DIST / "assets" / "questions"
CHAPTERS = [
    ("basics", "数据结构与算法基础"),
    ("lists", "线性表"),
    ("stacks", "栈 队列与递归"),
    ("strings", "串 数组与广义表"),
    ("trees", "树与二叉树"),
    ("graphs", "图"),
    ("search", "查找"),
    ("sort", "排序"),
]
CHAPTER_IDS = {title: slug for slug, title in CHAPTERS}
OPTION_MARK = re.compile(r"(?<![A-Za-z_])([A-DＡ-Ｄ])[.．、:：]\s*")
LABEL_PREFIX = re.compile(r"^[A-Da-dＡ-Ｄ][.．、:：]\s*")

# These source extractions contain essential notation or a matrix that cannot
# safely be represented by their existing plain text. Keep the actual scan.
SCAN_ONLY = {
    "E017": "原题的复杂度表达式包含上标，保留原图核对。",
    "E069": "原题的表达式包含上标，保留原图核对。",
    "E070": "原题的表达式包含上标，保留原图核对。",
    "E111": "原题的表达式包含上标，保留原图核对。",
    "E116": "邻接矩阵需要结合原图阅读。",
    "E117": "原题包含两个按顺序填写的空，需自行核对。",
    "E120": "原题的复杂度表达式及答案标注需结合原图核对。",
    "E130": "原题的取整公式需要结合原图阅读。",
    "E131": "原题的数组下标与存储公式需要结合原图阅读。",
    "M0948": "原题中的矩阵需要结合原图阅读。",
}


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def normalize(value: str) -> str:
    """Retain code/newlines, joining only Chinese PDF line wraps."""
    value = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"(?<=[\u4e00-\u9fff])\s*\n\s*(?=[\u4e00-\u9fff])", "", value)
    return value.strip()


def clean_options(options: list[str]) -> list[str]:
    return [normalize(LABEL_PREFIX.sub("", str(option).strip())) for option in options]


def parse_original(text: str):
    """Accept only four sequential, unambiguous A B C D option labels."""
    matches = list(OPTION_MARK.finditer(text))
    letters = [m[1].translate(str.maketrans("ＡＢＣＤ", "ABCD")) for m in matches]
    if letters != list("ABCD"):
        return None
    stem = normalize(text[: matches[0].start()])
    options = [
        normalize(text[m.end() : matches[i + 1].start() if i < 3 else len(text)])
        for i, m in enumerate(matches)
    ]
    return (stem, options) if stem and all(options) else None


def source_name(value: str):
    return re.sub(r"^\d{2,3}[_ ]", "", Path(value).stem)


def parse_answer(value: str, count: int):
    # Only explicit letter keys; never map checked circles to correct answers.
    value = str(value or "").strip().upper()
    if not value or not re.fullmatch(r"[A-D](?:[A-D]|[、,， /;；])*", value):
        return None
    indexes = sorted({ord(char) - 65 for char in value if char in "ABCD"})
    return indexes if indexes and all(i < count for i in indexes) else None


def inspect_text(q: dict):
    """Return safe text representation, key, and provenance, or scan fallback."""
    if q["id"] in SCAN_ONLY:
        return None, SCAN_ONLY[q["id"]]
    if q.get("prefer_text") and q.get("text_verified") and q.get("options"):
        return (normalize(q["stem"]), clean_options(q["options"]), q.get("answer", ""), "verified_transcription"), ""
    native = q.get("native")
    if native:
        if native.get("use_image"):
            return None, "题目中的图示、代码或公式保留原图，完成后请自行核对。"
        options = clean_options(native.get("options", []))
        if len(options) == 4 and all(options):
            return (normalize(native["stem"]), options, native.get("answer", ""), "native_text"), ""
        return None, "原题选项需要结合图示核对。"
    original = str(q.get("original_text") or "")
    options = q.get("options")
    if options and len(options) == 4 and all(str(x).strip() for x in options):
        stem = normalize(q["stem"])
        if re.search(r"如图|图示|如右图|如左图|如下图|见图|图\s*\d+\.", stem):
            return None, "本题需要结合原图阅读。"
        # Keep proprietary symbol-font fragments out of the selectable text.
        if any("\ue000" <= c <= "\uf8ff" or c == "�" for c in stem + "".join(options)):
            return None, "原题中的数学符号需要结合原图核对。"
        return (stem, clean_options(options), q.get("answer", ""), "structured_text"), ""
    if original:
        parsed = parse_original(original)
        if parsed and not q.get("images"):
            return (*parsed, q.get("answer", ""), "original_text"), ""
        # A supplementary diagram in an otherwise textual source is essential.
        if parsed and q.get("images") and not q.get("image_content"):
            return None, "本题附有必要图示，请阅读原图后自行核对。"
    return None, "原题以图片完整保留，图中圈选、勾选或红叉为原资料的作答痕迹。"


def build():
    DATA.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    originals = load(SOURCE / "final_questions.json")
    codes = load(SOURCE / "source_codes.json")
    questions = []
    image_manifest = {}
    provenance_counts = Counter()
    no_auto = []
    for q in originals:
        images = []
        for value in q.get("images", []):
            path = Path(value["file"] if isinstance(value, dict) else value)
            if not path.is_file():
                raise FileNotFoundError(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            filename = digest[:20] + path.suffix.lower()
            target = ASSETS / filename
            if not target.exists():
                shutil.copyfile(path, target)
            relative = f"assets/questions/{filename}"
            images.append(relative)
            image_manifest[relative] = {"sha256": digest, "bytes": path.stat().st_size}
        representation, scan_note = inspect_text(q)
        note = str(q.get("note") or "")
        answer = None
        if representation:
            stem, options, raw_answer, provenance = representation
            mode = "text"
            answer = parse_answer(raw_answer, len(options))
            if re.search(r"冲突|疑点|争议", note):
                answer = None
                note += " 此题不自动判分，请自行核对。"
            if "无向" in note and "入度" in note:
                answer = None
            provenance_counts[provenance] += 1
        else:
            mode = "scan"
            stem, options = "原题图示", []
            if not images:
                raise ValueError(f"No reliable text or image available: {q['id']}")
            note = " ".join(x for x in [scan_note, note] if x)
            provenance_counts["scan"] += 1
        if answer is None:
            no_auto.append({"id": q["id"], "number": q["number"], "mode": mode, "reason": note or "原资料未提供可直接匹配的答案。"})
        name = source_name(q["source"])
        search_text = " ".join(str(q.get(k) or "") for k in ["stem", "text", "subtopic", "topic"])
        questions.append({
            "id": q["id"],
            "number": q["number"],
            "chapter": CHAPTER_IDS[q["topic"]],
            "topic": q["subtopic"],
            "stem": stem,
            "options": options,
            "answer": answer,
            "answerSource": "source" if answer is not None else "none",
            "mode": mode,
            "images": images,
            "source": name,
            "sourceCode": codes.get(name, ""),
            "originalNumber": str(q["original_number"]),
            "searchText": re.sub(r"\s+", " ", search_text).strip(),
            "note": note,
        })
    chapters = [{"id": slug, "title": title, "count": sum(q["chapter"] == slug for q in questions)} for slug, title in CHAPTERS]
    bank = {
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(questions),
        "chapters": chapters,
        "questions": questions,
        "answerPolicy": "自动判分仅采用原资料中可明确匹配到选项的答案，未另行校核答案正确性。原图中的圈选、勾选和红叉不等同于正确答案。没有可用答案或符号无法完整转写的题目采用自行核对模式。",
    }
    assert len(questions) == len(originals) == 533
    assert len({q["id"] for q in questions}) == len(questions)
    assert [q["number"] for q in questions] == list(range(1, len(questions) + 1))
    assert sum(c["count"] for c in chapters) == len(questions)
    for q in questions:
        assert q["chapter"] in CHAPTER_IDS.values()
        assert q["mode"] in {"text", "scan"}
        assert q["mode"] != "scan" or (q["answer"] is None and q["images"] and not q["options"])
        assert q["mode"] != "text" or (q["stem"] and len(q["options"]) == 4 and all(q["options"]))
        assert q["answer"] is None or all(0 <= x < len(q["options"]) for x in q["answer"])
        assert all((DIST / p).is_file() for p in q["images"])
    (DATA / "questions.json").write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report = {
        "total": len(questions),
        "modes": dict(Counter(q["mode"] for q in questions)),
        "autoGraded": sum(q["answer"] is not None for q in questions),
        "selfGraded": len(no_auto),
        "multiAnswer": [q["id"] for q in questions if q["answer"] and len(q["answer"]) > 1],
        "provenance": dict(provenance_counts),
        "chapters": chapters,
        "images": len(image_manifest),
        "imageBytes": sum(x["bytes"] for x in image_manifest.values()),
        "validation": "passed",
        "answerPolicy": bank["answerPolicy"],
        "selfGradedQuestions": no_auto,
    }
    (PROJECT / "tools" / "bank-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (PROJECT / "tools" / "image-manifest.json").write_text(json.dumps(image_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "selfGradedQuestions"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    build()
    # Keep the reviewed reference answers when regenerating original assets.
    review_folder = PROJECT / 'tools' / 'answer-reviews'
    review_files = ['part-001-193.json', 'part-194-366.json', 'part-367-533.json']
    if all((review_folder / name).is_file() for name in review_files):
        import subprocess
        import sys
        subprocess.run([sys.executable, str(PROJECT / 'tools' / 'apply-answer-reviews.py'), '--refresh-baseline'], check=True)
