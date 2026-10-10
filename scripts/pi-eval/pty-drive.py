#!/usr/bin/env python3
"""
真·终端驱动器：pty 跑 TUI + pyte 真 VT 模拟，按脚本发按键，抓真实屏幕。
不是「读源码猜它会画什么」，是把它画出来的像素级字符接住。
用法: pty-drive.py <cwd> <cmd...>   脚本从 stdin:
  wait <秒> / send <文本> / key <名> / snap <标签> / size <cols>x<rows>
"""
import os, pty, sys, time, select, fcntl, termios, struct, signal
import pyte

COLS, ROWS = 100, 34

KEYS = {
    "enter": "\r", "esc": "\x1b", "tab": "\t", "bs": "\x7f", "space": " ",
    "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
    "ctrl-c": "\x03", "ctrl-d": "\x04", "ctrl-l": "\x0c", "ctrl-o": "\x0f",
    "ctrl-r": "\x12", "ctrl-p": "\x10", "pgdn": "\x1b[6~", "pgup": "\x1b[5~",
}

def main():
    cwd, cmd = sys.argv[1], sys.argv[2:]
    script = [l.rstrip("\n") for l in sys.stdin if l.strip()]

    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.ByteStream(screen)

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLUMNS"], os.environ["LINES"] = str(COLS), str(ROWS)
        os.environ.pop("CI", None)
        os.execvp(cmd[0], cmd)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))

    total = 0
    def pump(sec):
        nonlocal total
        end = time.time() + sec
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.15)
            if r:
                try:
                    d = os.read(fd, 65536)
                except OSError:
                    return False
                if not d:
                    return False
                total += len(d)
                stream.feed(d)
        return True

    alive = True
    for line in script:
        op, _, arg = line.partition(" ")
        if op == "wait":
            alive = pump(float(arg or 1))
        elif op == "send":
            os.write(fd, arg.encode())
        elif op == "key":
            for k in arg.split():
                os.write(fd, KEYS.get(k, k).encode())
                time.sleep(0.05)
        elif op == "snap":
            print(f"\n╔═════ 帧: {arg} " + "═" * max(0, 70 - len(arg)))
            lines = [l.rstrip() for l in screen.display]
            while lines and not lines[-1]:
                lines.pop()
            for l in lines:
                print("║" + l)
            print("╚" + "═" * 78)
            sys.stdout.flush()
        if not alive:
            print(f"\n[进程退出于: {line}]")
            break
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    print(f"\n[原始字节={total}]")

main()
