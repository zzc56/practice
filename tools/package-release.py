"""Package deployment files; include server configuration only when requested."""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Create a deployment archive without account or QA data")
parser.add_argument("--include-env", action="store_true", help="Include explicitly configured server .env for a private deployment package")
args = parser.parse_args()
output = root.parent / "数据结构刷题网站_服务器部署包.zip"
files = []
for name in ["README.md", "package.json", "server.mjs", "Dockerfile", "compose.yaml", "nginx.conf", ".dockerignore", ".gitignore", ".env.example"]:
    files.append(root / name)
if args.include_env:
    if not (root / ".env").is_file():
        parser.error("Server configuration .env is missing")
    files.append(root / ".env")
files.extend(p for p in (root / "dist").rglob("*") if p.is_file())
files.extend((root / "tests").glob("*.mjs"))
files.extend(root / name for name in ["tools/serve.mjs", "tools/build-bank.py", "tools/apply-answer-reviews.py", "tools/package-release.py", "tools/focus-browser-qa.mjs"])
files.extend((root / 'tools/answer-reviews').glob('part-*.json'))
files = sorted(files, key=lambda p: p.relative_to(root).as_posix())
with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for file in files:
        assert file.is_file(), file
        archive.write(file, "ds-practice/" + file.relative_to(root).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert not any("qa-data" in name or "/data/practice.sqlite" in name for name in archive.namelist())
    assert ("ds-practice/.env" in archive.namelist()) == args.include_env
    bank = json.loads(archive.read("ds-practice/dist/data/questions.json"))
    assert len(bank["questions"]) == 533
    for q in bank["questions"]:
        for image in q["images"]:
            assert "ds-practice/dist/" + image in archive.namelist()
result = {"file": str(output), "bytes": output.stat().st_size, "files": len(files), "questions": 533,
          "server_config_included": args.include_env,
          "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
(root / "tools/release-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
