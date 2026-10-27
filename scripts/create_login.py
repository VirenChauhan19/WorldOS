"""Create a backend-only passphrase hash without echoing the passphrase."""
from getpass import getpass
from pathlib import Path
import argparse
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.security import password_hash, SecuritySettings

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--access', choices=('owner','judge'), default='owner')
    parser.add_argument('--expires-at', help='Required for judges: ISO timestamp with timezone, e.g. 2026-11-05T04:00:00Z')
    args = parser.parse_args()
    if args.access == 'judge':
        try:
            if SecuritySettings(judge_expires_at=args.expires_at or '').judge_deadline() <= time.time():
                raise ValueError('Judge access must expire in the future.')
        except ValueError as error:
            raise SystemExit(str(error)) from None
    elif args.expires_at:
        parser.error('--expires-at applies only to judge access.')
    target = Path(__file__).resolve().parents[1] / ('.env.judge' if args.access == 'judge' else '.env.auth')
    if target.exists():
        raise SystemExit(f"{target.name} already exists. Preserve it; use a separate reviewed credential-rotation procedure.")
    password = getpass(f"New WorldOS {args.access} passphrase (14+ characters; different for each role): ")
    if password != getpass("Confirm passphrase: "):
        raise SystemExit("Passphrases did not match; no file written.")
    try:
        encoded = password_hash(password)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    with target.open("x", encoding="utf-8") as output:
        variable = 'WORLDOS_JUDGE_PASSWORD_HASH' if args.access == 'judge' else 'WORLDOS_AUTH_PASSWORD_HASH'
        output.write(variable + "='" + encoded + "'\n")
        if args.access == 'judge':
            output.write("WORLDOS_JUDGE_ACCESS_EXPIRES_AT='" + args.expires_at + "'\n")
    print(f"Backend {args.access} sign-in configured in ignored {target.name}. Restart WorldOS. No provider credentials were changed.")
