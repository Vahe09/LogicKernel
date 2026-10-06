"""Обновить копию README и ZIP пакета; работает на Linux и Windows."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parents[1]
    package = root / "backend-package"
    guide = (root / "README.md").read_text(encoding="utf-8")
    (package / "BACKEND.md").write_text(
        guide.replace("](backend-package/", "]("), encoding="utf-8"
    )
    destination = root / "LogicKernel-backend-package.zip"
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for filename in sorted(package.rglob("*")):
            if not filename.is_file():
                continue
            if "__pycache__" in filename.parts or filename.suffix in {".pyc", ".pyo"}:
                continue
            archive.write(filename, filename.relative_to(root).as_posix())
    print(destination)


if __name__ == "__main__":
    main()
