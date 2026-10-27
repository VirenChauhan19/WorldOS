"""Check tracked/new source and built assets without printing credential values.

Known local credential values are read only for comparison, never transmitted.
This complements authentication tests; it is not a proof of absence of secrets.
"""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    paths = subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
    candidates = {ROOT/name for name in paths if name}
    candidates.update(p for p in (ROOT/'dist').rglob('*') if p.is_file())
    credentials = set()
    for name in ('.env','.env.auth','backend/.env'):
        source = ROOT/name
        if not source.is_file():
            continue
        for line in source.read_text(encoding='utf-8-sig').splitlines():
            key, separator, value = line.strip().partition('=')
            if separator and re.search(r'(API_KEY|PASSWORD_HASH|SECRET|TOKEN)$', key):
                value = value.strip().strip('\"\'')
                if len(value) >= 12:
                    credentials.add(value.encode())
    failures = []
    for path in sorted(candidates):
        if not path.is_file():
            continue
        data = path.read_bytes()
        relative = path.relative_to(ROOT).as_posix()
        if relative in {'.env','.env.auth','backend/.env'}:
            failures.append((relative,'private environment file is tracked or unignored'))
        elif any(value in data for value in credentials):
            failures.append((relative,'contains a configured credential value'))
        elif re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',data):
            failures.append((relative,'contains a private key header'))
        elif re.search(rb'\b(?:sk-[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b',data):
            failures.append((relative,'contains a credential-shaped literal'))
    for path,reason in failures:
        print(f'FAIL: {path}: {reason}')
    if not failures:
        print(f'PASS: {len(candidates)} source/build files checked; no configured credential values, private keys, or token-shaped literals found.')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
