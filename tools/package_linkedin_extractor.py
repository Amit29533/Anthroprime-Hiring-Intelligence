"""Build the public download from reviewed sources, without any local artifacts."""
import hashlib
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = {
    "tools/linkedin_profile_extractor.py": "tools/linkedin_profile_extractor.py",
    "tools/linkedin_visible_profile.js": "tools/linkedin_visible_profile.js",
    "docs/LINKEDIN_LOCAL_EXTRACTOR_TESTING.md": "README.md",
}


def source_bytes(source):
    # Normalize Git's Windows/Linux checkout line endings for the same bundle.
    return (ROOT / source).read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")


def build():
    target = ROOT / "public/linkedin-local-extractor.zip"
    target.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source, destination in FILES.items():
            info = zipfile.ZipInfo(destination, (2026, 10, 9, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source_bytes(source))
    manifest = {
        "archiveSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "files": {source: hashlib.sha256(source_bytes(source)).hexdigest() for source in FILES},
    }
    (ROOT / "public/linkedin-local-extractor-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Packaged local LinkedIn extractor (3 reviewed files; no cookies or artifacts).")


if __name__ == "__main__":
    build()
