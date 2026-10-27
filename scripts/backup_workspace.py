"""SQLite online backup / offline restore into a NEW data directory only."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.backups import backup_database


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,required=True)
    action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--output',type=Path,help='New backup file; never overwrite an existing backup.')
    action.add_argument('--restore',type=Path,help='Validated backup to restore; data-dir must not already contain a workspace DB.')
    args=parser.parse_args()
    if args.restore:
        backup_database(args.restore,args.data_dir/'worldos.sqlite3')
        print('Workspace restored into the new data directory. Login sessions were not restored. Start WorldOS with WORLDOS_DATA_DIR pointing here.')
    else:
        backup_database(args.data_dir/'worldos.sqlite3',args.output)
        print('Consistent workspace backup created and integrity checked. Store an additional copy off the service disk.')


if __name__=='__main__': main()
