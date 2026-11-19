"""Hold a filesystem lock until the CLI commits or closes its input pipe."""
import ctypes
import errno
import fcntl
import hashlib
import json
import os
import plistlib
import stat
import subprocess
import sys


def reply(**fields):
    print(json.dumps(fields), flush=True)


def supported(directory):
    while not os.path.exists(directory):
        directory = os.path.dirname(directory)
    if sys.platform == "linux":
        kind = subprocess.check_output(
            ["/usr/bin/findmnt", "-n", "-o", "FSTYPE", "-T", directory]
        ).strip()
        return kind == b"ext4"
    device = subprocess.check_output(["/bin/df", "-P", directory]).splitlines()[-1].split()[0]
    if not device.startswith(b"/dev/"):
        return False
    info = plistlib.loads(subprocess.check_output(["/usr/sbin/diskutil", "info", "-plist", device]))
    return info.get("FilesystemType") == "apfs"


def commit():
    target = json.loads(input())["path"]
    parent, name = os.path.split(target)
    libc = ctypes.CDLL(None, use_errno=True)
    linux = sys.platform == "linux"
    exclusive = getattr(libc, "renameat2" if linux else "renameatx_np", None)
    if exclusive is None or not supported(parent):
        reply(code="TRANSACTION_UNSUPPORTED")
        return
    reply(status="supported")
    if json.loads(input()).get("action") != "lock":
        return
    directory_flags = os.O_DIRECTORY | os.O_NOFOLLOW
    parent_fd = os.open(parent, directory_flags)
    state_fd = os.open(".corkoro-state", directory_flags, dir_fd=parent_fd)
    # Native lookup preserves the volume's filename equivalence rules, even
    # for a concurrent init where the actual target does not exist yet.
    try:
        os.mkdir("slots", 0o700, dir_fd=state_fd)
    except FileExistsError:
        pass
    slots = os.open("slots", directory_flags, dir_fd=state_fd)
    if any(os.fstat(fd).st_dev != os.fstat(parent_fd).st_dev for fd in (state_fd, slots)):
        reply(code="TRANSACTION_UNSUPPORTED")
        return
    if linux:
        # ext4 can enable case folding per directory (FS_IOC_GETFLAGS).
        import array
        flags = array.array("l", [0])
        for fd in (slots, parent_fd):
            fcntl.ioctl(fd, 0x80006601 | (flags.itemsize << 16), flags)
            if flags[0] & 0x40000000:
                reply(code="TRANSACTION_UNSUPPORTED")
                return
    lock = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                   0o600, dir_fd=slots)
    st = os.fstat(lock)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_size:
        reply(code="UNSAFE_TRANSACTION_STATE")
        return
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        reply(code="CONFIG_BUSY")
        return
    reply(status="ready")
    request = json.loads(input())
    temp = os.path.basename(request["temp"])
    expected = request["expected"]
    if expected is not None:
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
        except FileNotFoundError:
            reply(code="CONFIG_CHANGED")
            return
        with os.fdopen(fd, "rb") as original:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
                reply(code="UNSAFE_TRANSACTION_STATE")
                return
            if "sha256:" + hashlib.sha256(original.read()).hexdigest() != expected:
                reply(code="CONFIG_CHANGED")
                return
        os.chmod(temp, stat.S_IMODE(st.st_mode) & 0o600, dir_fd=state_fd)
        try:
            os.replace(temp, name, src_dir_fd=state_fd, dst_dir_fd=parent_fd)
        except OSError as exc:
            reply(code="COMMIT_UNKNOWN" if exc.errno == errno.EIO else "IO_ERROR")
            return
    else:
        result = exclusive(state_fd, os.fsencode(temp), parent_fd, os.fsencode(name), 1 if linux else 4)
        if result:
            error = ctypes.get_errno()
            if error == errno.EEXIST:
                reply(code="CONFIG_EXISTS")
                return
            reply(code="COMMIT_UNKNOWN" if error == errno.EIO else "IO_ERROR")
            return
    reply(status="committed")


try:
    commit()
except EOFError:
    pass
except subprocess.SubprocessError:
    reply(code="TRANSACTION_UNSUPPORTED")
except OSError:
    reply(code="IO_ERROR")
