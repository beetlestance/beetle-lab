"""Stream a deterministic source bundle; no extraction or source execution."""
import gzip
import os
import re
from pathlib import Path
import stat
import sys
import tarfile


def entries(root, directory=None, depth=0):
    directory = root if directory is None else directory
    if depth > 4:
        raise ValueError("Source directory depth bound")
    names = []
    with os.scandir(directory) as cursor:
        for entry in cursor:
            if len(names) >= 512:
                raise ValueError("Source directory entry bound")
            names.append(entry.name)
    for name in sorted(names):
        path = directory / name
        yield path, path.relative_to(root).as_posix()
        if stat.S_ISDIR(os.lstat(path).st_mode):
            yield from entries(root, path, depth + 1)


def metadata(archive, path, relative):
    info = archive.gettarinfo(str(path), arcname=relative)
    if not (info.isfile() or info.isdir() or info.issym()):
        raise ValueError("Unsupported source bundle entry")
    if info.issym():
        target = info.linkname
        if not re.fullmatch(r"[A-Za-z0-9_+.@-]{1,180}", target) or target in (".", ".."):
            raise ValueError("Source link escapes its component")
        if not stat.S_ISREG(os.lstat(path.parent / target).st_mode):
            raise ValueError("Source link requires a regular sibling")
    info.uid = info.gid = info.mtime = 0
    info.uname = info.gname = ""
    info.mode = 0o755 if info.isdir() or info.mode & 0o111 else 0o644
    if info.issym():
        info.mode = 0o777
    return info


def main():
    if len(sys.argv) != 2:
        raise ValueError("Expected source payload directory")
    root = Path(sys.argv[1])
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError("Absolute regular source directory required")
    total = count = 0
    with gzip.GzipFile(fileobj=sys.stdout.buffer, mode="wb", filename="", mtime=0, compresslevel=1) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.GNU_FORMAT, dereference=False) as archive:
            for path, relative in entries(root):
                count += 1
                if count > 2048:
                    raise ValueError("Source bundle entry bound")
                info = metadata(archive, path, relative)
                total += info.size
                if info.size > 200 * 1024**2 or total > 640 * 1024**2:
                    raise ValueError("Source tar input bound")
                if info.isfile():
                    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(descriptor, "rb") as source:
                        info_stat = os.fstat(descriptor)
                        if not stat.S_ISREG(info_stat.st_mode) or info_stat.st_nlink != 1 or info_stat.st_size != info.size:
                            raise ValueError("Source file changed")
                        archive.addfile(info, source)
                        if os.fstat(descriptor).st_size != info.size:
                            raise ValueError("Source file changed")
                else:
                    archive.addfile(info)


if __name__ == "__main__":
    main()
