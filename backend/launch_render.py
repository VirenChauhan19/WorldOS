"""Render-only entry point. Never use its proxy trust policy on an exposed VM."""
import os
from pathlib import Path
from pathlib import PurePosixPath
import re
from urllib.parse import urlparse


def configure_render(environment):
    if environment.get('RENDER') != 'true':
        raise ValueError('This startup command is only for Render-managed ingress.')
    hostname = environment.get('RENDER_EXTERNAL_HOSTNAME','')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com', hostname):
        raise ValueError('Render must supply its exact RENDER_EXTERNAL_HOSTNAME.')
    origins, hosts = [f'https://{hostname}'], [hostname]
    custom = environment.get('WORLDOS_PUBLIC_URL','').strip()
    if custom:
        url = urlparse(custom)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path not in {'','/'} or url.query or url.fragment or url.port not in {None,443} or '*' in custom:
            raise ValueError('WORLDOS_PUBLIC_URL must be your verified HTTPS origin.')
        origins.append(f'https://{url.hostname}'); hosts.append(url.hostname)
    data = PurePosixPath(environment.get('WORLDOS_DATA_DIR','/var/data/worldos'))
    if data.parent != PurePosixPath('/var/data') or not re.fullmatch(r'worldos(?:-[a-zA-Z0-9_-]+)?', data.name):
        raise ValueError('Render data must use a worldos directory directly inside /var/data.')
    environment.update(WORLDOS_DEPLOYMENT='public', WORLDOS_DATA_DIR=str(data),
                       WORLDOS_ALLOWED_HOSTS=','.join(dict.fromkeys(hosts)),
                       WORLDOS_CORS_ORIGINS=','.join(dict.fromkeys([*origins,'capacitor://localhost','https://localhost'])))
    from .security import SecuritySettings
    # Fail before serving anything if the deployment passphrase is absent/invalid.
    SecuritySettings('public',environment.get('WORLDOS_AUTH_PASSWORD_HASH',''),tuple(origins),tuple(hosts),
                     environment.get('WORLDOS_JUDGE_PASSWORD_HASH',''),environment.get('WORLDOS_JUDGE_ACCESS_EXPIRES_AT','')).validate()


def main():
    configure_render(os.environ)
    directory = Path(os.environ['WORLDOS_DATA_DIR'])
    if not Path('/var/data').is_mount():
        raise RuntimeError('Attach the persistent disk at /var/data before deploying.')
    if directory.is_symlink():
        raise RuntimeError('The workspace directory must not be a symlink.')
    os.umask(0o077)
    directory.mkdir(exist_ok=True)
    if os.getuid() == 0:
        # Prepare only the fixed application directory, then drop root privileges.
        os.chown(directory,10001,10001); directory.chmod(0o700)
        for name in ('worldos.sqlite3','auth.sqlite3'):
            database=directory/name
            if database.is_symlink():raise RuntimeError('Database files must not be symlinks.')
            if database.is_file():os.chown(database,10001,10001);database.chmod(0o600)
        os.setgroups([]); os.setgid(10001); os.setuid(10001)
    from .production import storage_ready
    storage_ready()
    import uvicorn
    # Render terminates HTTPS and exclusively proxies public traffic to this port.
    # Do not reuse '*' on a directly reachable server; Compose trusts one fixed IP.
    uvicorn.run('backend.main:app',host='0.0.0.0',port=int(os.environ.get('PORT','10000')),
                workers=1,proxy_headers=True,forwarded_allow_ips='*',access_log=False,limit_concurrency=32,
                timeout_keep_alive=5,timeout_graceful_shutdown=30)


if __name__ == '__main__':
    main()
