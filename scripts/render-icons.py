#!/usr/bin/env python3
"""Render the 拾影 app icons. Uses only the Python standard library."""

import struct
import zlib
from pathlib import Path

BG = (31, 77, 58, 255)
INK = (246, 243, 238, 255)
SHADOW = (16, 46, 35, 255)
ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"


def bracket(x: float, y: float) -> bool:
    margin = 0.23
    arm = 0.15
    thick = 0.034
    corners = (
        (margin, margin, 1, 1),
        (1 - margin, margin, -1, 1),
        (margin, 1 - margin, 1, -1),
        (1 - margin, 1 - margin, -1, -1),
    )
    for origin_x, origin_y, dir_x, dir_y in corners:
        local_x = (x - origin_x) * dir_x
        local_y = (y - origin_y) * dir_y
        if 0 <= local_x <= arm and 0 <= local_y <= thick:
            return True
        if 0 <= local_y <= arm and 0 <= local_x <= thick:
            return True
    return False


def shade(x: float, y: float) -> tuple[int, int, int, int]:
    if bracket(x, y):
        return INK
    center_x, center_y = x - 0.5, y - 0.5
    shadow_x, shadow_y = x - 0.535, y - 0.545
    lens = (center_x * center_x + center_y * center_y) ** 0.5
    shadow = (shadow_x * shadow_x + shadow_y * shadow_y) ** 0.5
    if 0.112 < shadow < 0.168:
        return SHADOW
    if 0.108 < lens < 0.172:
        return INK
    if lens < 0.042:
        return INK
    return BG


def sample(px: int, py: int, size: int, maskable: bool) -> tuple[int, int, int, int]:
    samples = 4
    total = [0, 0, 0, 0]
    for sy in range(samples):
        for sx in range(samples):
            x = (px + (sx + 0.5) / samples) / size
            y = (py + (sy + 0.5) / samples) / size
            if maskable:
                x = 0.5 + (x - 0.5) / 0.68
                y = 0.5 + (y - 0.5) / 0.68
            if x < 0 or y < 0 or x > 1 or y > 1:
                color = BG
            else:
                color = shade(x, y)
            for index, channel in enumerate(color):
                total[index] += channel
    count = samples * samples
    return tuple(channel // count for channel in total)  # type: ignore[return-value]


def write_png(path: Path, size: int, maskable: bool = False) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(sample(x, y, size, maskable))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    write_png(ROOT / "icon-192.png", 192)
    write_png(ROOT / "icon-512.png", 512)
    write_png(ROOT / "maskable-512.png", 512, maskable=True)
    write_png(ROOT / "apple-touch-icon.png", 180)


if __name__ == "__main__":
    main()
