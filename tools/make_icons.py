"""Erzeugt die App-Icons (PNG) ohne externe Abhängigkeiten.  Aufruf: python3 tools/make_icons.py"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')


def png(path, size, px):
    raw = b''.join(b'\x00' + bytes(px[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)


def icon(size):
    S = 4  # Supersampling für weiche Kanten
    bg, court, line, own, opp, ball = (17, 26, 43), (27, 53, 84), (219, 231, 245), (59, 130, 246), (239, 68, 68), (245, 158, 11)
    px = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(S):
                for sx in range(S):
                    u = (x + (sx + .5) / S) / size
                    v = (y + (sy + .5) / S) / size
                    c = bg
                    # Feld 16:6.1 → quer, zentriert
                    fx0, fx1, fy0, fy1 = .12, .88, .33, .67
                    lw = .022
                    if fx0 <= u <= fx1 and fy0 <= v <= fy1:
                        c = court
                        if min(u - fx0, fx1 - u, v - fy0, fy1 - v) < lw or abs(u - .5) < lw * .9:
                            c = line
                        if abs(u - (.5 - .1425)) < lw * .45 or abs(u - (.5 + .1425)) < lw * .45:
                            c = line
                    if abs(u - .5) < lw * .9 and .28 <= v <= .72:
                        c = line
                    for (cx, cy, col) in ((.28, .43, own), (.28, .58, own), (.7, .5, opp)):
                        if (u - cx) ** 2 + (v - cy) ** 2 < .045 ** 2:
                            c = col
                    # Ziel-Kreuz
                    du, dv = u - .78, v - .385
                    if abs(du) < .04 and abs(dv) < .04 and (abs(du - dv) < .012 or abs(du + dv) < .012):
                        c = ball
                    for i in range(3):
                        acc[i] += c[i]
            o = (y * size + x) * 4
            px[o:o + 4] = bytes([acc[0] // (S * S), acc[1] // (S * S), acc[2] // (S * S), 255])
    return px


for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    png(os.path.join(OUT, name), size, icon(size))
    print('ok', name)
