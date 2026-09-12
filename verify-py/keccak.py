"""
Keccak-256, implemented from the specification with no dependencies.

NOT SHA3-256. The two differ only in the domain-separation byte — SHA3 pads
with 0x06, original Keccak with 0x01 — which is exactly the mistake that makes
an "independent implementation" silently agree with nothing. The test vectors
at the bottom of this file are the guard.
"""

_ROUND_CONSTANTS = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

_ROTATION_OFFSETS = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]

_MASK = (1 << 64) - 1


def _rotl64(value: int, shift: int) -> int:
    shift %= 64
    return ((value << shift) | (value >> (64 - shift))) & _MASK


def _keccak_f1600(state: list) -> None:
    for rnd in range(24):
        # theta
        c = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl64(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x][y] ^= d[x]

        # rho and pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl64(state[x][y], _ROTATION_OFFSETS[x][y])

        # chi
        for x in range(5):
            for y in range(5):
                state[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & _MASK) & b[(x + 2) % 5][y]

        # iota
        state[0][0] ^= _ROUND_CONSTANTS[rnd]


def keccak256(data: bytes) -> bytes:
    """Keccak-256 digest of `data`."""
    rate_bytes = 136  # 1088-bit rate for a 256-bit digest
    state = [[0] * 5 for _ in range(5)]

    # pad10*1 with the original-Keccak domain byte 0x01
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % rate_bytes != 0:
        padded.append(0x00)
    padded[-1] |= 0x80

    for offset in range(0, len(padded), rate_bytes):
        block = padded[offset:offset + rate_bytes]
        for i in range(rate_bytes // 8):
            lane = int.from_bytes(block[i * 8:(i + 1) * 8], "little")
            state[i % 5][i // 5] ^= lane
        _keccak_f1600(state)

    out = bytearray()
    while len(out) < 32:
        for i in range(rate_bytes // 8):
            if len(out) >= 32:
                break
            out += state[i % 5][i // 5].to_bytes(8, "little")
        if len(out) < 32:
            _keccak_f1600(state)
    return bytes(out[:32])


def keccak256_hex(data: bytes) -> str:
    return "0x" + keccak256(data).hex()


if __name__ == "__main__":
    # Known-answer tests. If these fail, nothing downstream means anything.
    vectors = {
        b"": "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        b"abc": "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
        b"The quick brown fox jumps over the lazy dog":
            "0x4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15",
    }
    ok = True
    for data, expected in vectors.items():
        got = keccak256_hex(data)
        status = "ok " if got == expected else "FAIL"
        if got != expected:
            ok = False
        print(f"  {status} keccak256({data!r:48}) = {got}")
    raise SystemExit(0 if ok else 1)
